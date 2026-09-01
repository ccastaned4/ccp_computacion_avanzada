import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

// ============================================================
// IMPRESIÓN COLECTIVA · CONFIGURACIÓN MQTT
// ============================================================
const BROKER = "wss://rd7b7d2a.ala.us-east-1.emqxsl.com:8084/mqtt";
const USUARIO = "mcd_user";
const CONTRASENA_MQTT = ""; // Opcional para pruebas locales. No subas una contraseña real.
const TOPIC = "mcd/prueba";

// Una capa se consolida cada segundo durante diez segundos.
const DURACION_MS = 10_000;
const INTERVALO_CAPA_MS = 1_000;
const CAPAS_NUEVAS = DURACION_MS / INTERVALO_CAPA_MS;
const TOTAL_CAPAS = CAPAS_NUEVAS + 1;
const ALTURA_CAPA = 0.42;
const SEGMENTOS_RADIALES = 48;
const MAX_DESPLAZAMIENTO = 0.9;

const $ = selector => document.querySelector(selector);
const nombreInput = $("#nombre");
const contrasenaInput = $("#contrasena");
const botonConectar = $("#boton-conectar");
const botonIniciar = $("#boton-iniciar");
const botonExportar = $("#boton-exportar");
const botonReiniciar = $("#boton-reiniciar");
const controlX = $("#control-x");
const controlZ = $("#control-z");
const controlRadio = $("#control-radio");
const controlesDOM = [controlX, controlZ, controlRadio];

$("#topic-eventos").textContent = TOPIC;

let cliente = null;
let clientId = null;
let nombre = "";
let sesionId = null;
let creadorSesion = null;
let inicioSesion = 0;
let estadoSesion = "preparada";
let relojCapas = null;
let publicacionPendiente = false;
let capas = [capaInicial()];
const participantes = new Map();
const controlesParticipantes = new Map();

function capaInicial() {
  return { indice: 0, x: 0, z: 0, radio: 1, y: ALTURA_CAPA };
}

botonConectar.addEventListener("click", conectar);
botonIniciar.addEventListener("click", () => publicar({
  tipo: "iniciar",
  sesionId: `${clientId}-${Date.now()}`,
  creador: clientId,
  inicio: Date.now(),
}));
botonReiniciar.addEventListener("click", () => publicar({ tipo: "reinicio" }));
botonExportar.addEventListener("click", exportarSTL);

controlesDOM.forEach(control => control.addEventListener("input", () => {
  actualizarSalidas();
  actualizarPreview();
  if (!publicacionPendiente) {
    publicacionPendiente = true;
    requestAnimationFrame(() => {
      publicacionPendiente = false;
      publicarControl();
    });
  }
}));

function conectar() {
  nombre = nombreInput.value.trim();
  const password = CONTRASENA_MQTT || contrasenaInput.value;
  if (!nombre || !password) return cambiarConexion("error", "Falta nombre o contraseña");
  if (!window.mqtt) return cambiarConexion("error", "No se pudo cargar MQTT.js");

  const slug = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "usuario";
  clientId = `impresora-${slug}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
  $("#cliente-id").textContent = clientId;
  nombreInput.disabled = contrasenaInput.disabled = botonConectar.disabled = true;
  cambiarConexion("conectando", "Conectando…");

  cliente = window.mqtt.connect(BROKER, {
    clientId, username: USUARIO, password, clean: true,
    reconnectPeriod: 2_000, connectTimeout: 10_000,
  });

  cliente.on("connect", () => {
    console.log("Estado de conexión MQTT: conectado");
    cambiarConexion("conectado", "Conectado a EMQX");
    botonConectar.textContent = "Conectado ✓";
    botonConectar.classList.add("conectado");
    botonIniciar.disabled = estadoSesion !== "preparada";
    botonReiniciar.disabled = false;
    cliente.subscribe(TOPIC, error => {
      if (error) return cambiarConexion("error", "Conectado, pero sin acceso al canal MQTT");
      publicar({ tipo: "hola" });
    });
  });
  cliente.on("message", (topic, payload) => procesarMensaje(topic, payload));
  cliente.on("reconnect", () => cambiarConexion("conectando", "Reconectando…"));
  cliente.on("offline", () => cambiarConexion("error", "Sin conexión; intentando reconectar"));
  cliente.on("error", error => {
    console.error("Estado de conexión MQTT: error", error);
    cambiarConexion("error", /not authorized|password|connack/i.test(error.message)
      ? "Usuario o contraseña MQTT incorrectos" : `Error MQTT: ${error.message}`);
  });
}

function publicar(datos) {
  if (!cliente?.connected) return false;
  const mensaje = { ...datos, nombre, clientId, timestamp: Date.now() };
  cliente.publish(TOPIC, JSON.stringify(mensaje), { qos: 0, retain: false });
  return true;
}

function publicarMQTT(datos) {
  return publicar(datos);
}
window.publicarMQTT = publicarMQTT;

function publicarControl() {
  if (estadoSesion !== "imprimiendo") return;
  publicar({ tipo: "control", sesionId, control: leerControles() });
}

function leerControles() {
  return {
    x: Number(controlX.value) / 100 * MAX_DESPLAZAMIENTO,
    z: Number(controlZ.value) / 100 * MAX_DESPLAZAMIENTO,
    radio: Number(controlRadio.value) / 100,
  };
}

function procesarMensaje(topic, payload) {
  const texto = payload.toString();
  console.log("Topic:", topic);
  console.log("Mensaje recibido:", texto);
  let m;
  try {
    m = JSON.parse(texto);
    console.log("JSON parseado:", m);
  } catch (error) {
    console.warn("Mensaje MQTT sin JSON válido", error);
    return;
  }
  if (!m?.tipo || !m.clientId) return;
  participantes.set(m.clientId, m.nombre || "Sin nombre");
  actualizarParticipantes();

  if (m.tipo === "hola") {
    if (m.clientId !== clientId && !m.respuestaA) publicar({ tipo: "hola", respuestaA: m.clientId });
    if (creadorSesion === clientId && estadoSesion !== "preparada") publicarEstadoCompleto(m.clientId);
    return;
  }
  if (m.tipo === "estado" && (!m.para || m.para === clientId)) return recibirEstado(m);
  if (m.tipo === "iniciar") return comenzarSesion(m);
  if (m.tipo === "control" && m.sesionId === sesionId) {
    controlesParticipantes.set(m.clientId, validarControl(m.control));
    actualizarPreview();
    return;
  }
  if (m.tipo === "capa" && m.sesionId === sesionId) return recibirCapa(m.capa);
  if (m.tipo === "finalizar" && m.sesionId === sesionId) return finalizarSesion();
  if (m.tipo === "reinicio") prepararSesion();
}

function comenzarSesion(m) {
  if (!m.sesionId || !Number.isFinite(m.inicio)) return;
  detenerRelojCapas();
  sesionId = m.sesionId;
  creadorSesion = m.creador;
  inicioSesion = m.inicio;
  estadoSesion = "imprimiendo";
  capas = [capaInicial()];
  controlesParticipantes.clear();
  controlesParticipantes.set(clientId, leerControles());
  actualizarMalla();
  habilitarControles(true);
  botonIniciar.disabled = botonExportar.disabled = true;
  botonReiniciar.disabled = false;
  $("#estado-sesion").textContent = "Imprimiendo";
  publicarControl();
  if (creadorSesion === clientId) iniciarRelojCapas();
}

function iniciarRelojCapas() {
  relojCapas = window.setInterval(() => {
    const transcurrido = Date.now() - inicioSesion;
    const capasEsperadas = Math.min(CAPAS_NUEVAS, Math.floor(transcurrido / INTERVALO_CAPA_MS));
    while (capas.length - 1 < capasEsperadas) {
      const indice = capas.length;
      const promedio = promedioControles();
      publicar({
        tipo: "capa", sesionId,
        capa: { indice, ...promedio, y: (indice + 1) * ALTURA_CAPA },
      });
      // Se agrega ahora para que un intervalo retrasado no publique dos veces el mismo índice.
      recibirCapa({ indice, ...promedio, y: (indice + 1) * ALTURA_CAPA });
    }
    if (transcurrido >= DURACION_MS && capas.length >= TOTAL_CAPAS) {
      publicar({ tipo: "finalizar", sesionId });
      finalizarSesion();
    }
  }, 100);
}

function promedioControles() {
  const lista = [...controlesParticipantes.values()];
  if (!lista.length) return leerControles();
  const suma = lista.reduce((acc, valor) => ({
    x: acc.x + valor.x, z: acc.z + valor.z, radio: acc.radio + valor.radio,
  }), { x: 0, z: 0, radio: 0 });
  return { x: suma.x / lista.length, z: suma.z / lista.length, radio: suma.radio / lista.length };
}

function validarControl(control = {}) {
  return {
    x: THREE.MathUtils.clamp(Number(control.x) || 0, -MAX_DESPLAZAMIENTO, MAX_DESPLAZAMIENTO),
    z: THREE.MathUtils.clamp(Number(control.z) || 0, -MAX_DESPLAZAMIENTO, MAX_DESPLAZAMIENTO),
    radio: THREE.MathUtils.clamp(Number(control.radio) || 1, 0.55, 1.45),
  };
}

function recibirCapa(capa) {
  if (!capa || !Number.isInteger(capa.indice) || capa.indice < 1 || capa.indice > CAPAS_NUEVAS) return;
  capas[capa.indice] = { indice: capa.indice, ...validarControl(capa), y: (capa.indice + 1) * ALTURA_CAPA };
  capas = capas.filter(Boolean).sort((a, b) => a.indice - b.indice);
  actualizarMalla();
}

function finalizarSesion() {
  if (estadoSesion === "finalizada") return;
  detenerRelojCapas();
  estadoSesion = "finalizada";
  habilitarControles(false);
  botonExportar.disabled = false;
  botonIniciar.disabled = true;
  $("#estado-sesion").textContent = "Modelo listo";
  $("#tiempo").textContent = "0.0 s";
  $("#progreso").style.width = "100%";
}

function prepararSesion() {
  detenerRelojCapas();
  sesionId = creadorSesion = null;
  inicioSesion = 0;
  estadoSesion = "preparada";
  capas = [capaInicial()];
  controlesParticipantes.clear();
  actualizarMalla();
  habilitarControles(false);
  botonIniciar.disabled = !cliente?.connected;
  botonExportar.disabled = true;
  botonReiniciar.disabled = !cliente?.connected;
  $("#estado-sesion").textContent = "Preparada";
  $("#tiempo").textContent = "10.0 s";
  $("#progreso").style.width = "0%";
}

function publicarEstadoCompleto(para) {
  publicar({ tipo: "estado", para, sesionId, creador: creadorSesion, inicio: inicioSesion, estado: estadoSesion, capas });
}

function recibirEstado(m) {
  if (!m.sesionId || !Array.isArray(m.capas)) return;
  sesionId = m.sesionId;
  creadorSesion = m.creador;
  inicioSesion = m.inicio;
  estadoSesion = m.estado;
  capas = m.capas.map(capa => ({ ...capa, ...validarControl(capa) }));
  actualizarMalla();
  habilitarControles(estadoSesion === "imprimiendo");
  botonIniciar.disabled = true;
  botonExportar.disabled = estadoSesion !== "finalizada";
  $("#estado-sesion").textContent = estadoSesion === "finalizada" ? "Modelo listo" : "Imprimiendo";
  if (estadoSesion === "imprimiendo") publicarControl();
}

function detenerRelojCapas() {
  if (relojCapas) window.clearInterval(relojCapas);
  relojCapas = null;
}

function habilitarControles(activos) {
  controlesDOM.forEach(control => { control.disabled = !activos; });
}

function actualizarSalidas() {
  $("#salida-x").value = leerControles().x.toFixed(2);
  $("#salida-z").value = leerControles().z.toFixed(2);
  $("#salida-radio").value = leerControles().radio.toFixed(2);
}

function actualizarParticipantes() {
  $("#participantes").textContent = participantes.size;
}

function cambiarConexion(tipo, texto) {
  $("#estado-punto").className = `estado-punto${tipo ? ` ${tipo}` : ""}`;
  $("#estado-texto").textContent = texto;
}

// ============================================================
// GEOMETRÍA: anillos apilados que forman una malla cerrada.
// ============================================================
let escena, camara, renderer, controlesCamara, pieza, preview;
iniciarEscena();
actualizarMalla();
actualizarSalidas();
animar();

function iniciarEscena() {
  const contenedor = $("#escena-impresion");
  escena = new THREE.Scene();
  escena.background = new THREE.Color(0x0b0b0c);
  escena.fog = new THREE.Fog(0x0b0b0c, 11, 24);
  camara = new THREE.PerspectiveCamera(38, contenedor.clientWidth / contenedor.clientHeight, 0.1, 100);
  camara.position.set(7.5, 5.8, 9.5);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  contenedor.appendChild(renderer.domElement);

  controlesCamara = new OrbitControls(camara, renderer.domElement);
  controlesCamara.enableDamping = true;
  controlesCamara.target.set(0, 2.3, 0);

  escena.add(new THREE.HemisphereLight(0xfff1d6, 0x25282d, 1.8));
  const luz = new THREE.DirectionalLight(0xffffff, 3);
  luz.position.set(6, 10, 7);
  escena.add(luz);
  const relleno = new THREE.DirectionalLight(0x8da9c7, 1.4);
  relleno.position.set(-6, 4, -5);
  escena.add(relleno);

  const suelo = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 1 }),
  );
  suelo.rotation.x = -Math.PI / 2;
  escena.add(suelo);

  pieza = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xb98b65, roughness: 0.78, metalness: 0.02, side: THREE.DoubleSide }),
  );
  escena.add(pieza);

  preview = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xd8d2c4, transparent: true, opacity: 0.8 }),
  );
  escena.add(preview);
}

function crearGeometria(listaCapas) {
  const anillos = [
    { ...listaCapas[0], y: 0 },
    ...listaCapas,
  ];
  const posiciones = [];
  const indices = [];

  anillos.forEach(anillo => {
    for (let j = 0; j < SEGMENTOS_RADIALES; j++) {
      const angulo = j / SEGMENTOS_RADIALES * Math.PI * 2;
      posiciones.push(
        anillo.x + Math.cos(angulo) * anillo.radio,
        anillo.y,
        anillo.z + Math.sin(angulo) * anillo.radio,
      );
    }
  });

  for (let i = 0; i < anillos.length - 1; i++) {
    for (let j = 0; j < SEGMENTOS_RADIALES; j++) {
      const siguiente = (j + 1) % SEGMENTOS_RADIALES;
      const a = i * SEGMENTOS_RADIALES + j;
      const b = i * SEGMENTOS_RADIALES + siguiente;
      const c = (i + 1) * SEGMENTOS_RADIALES + j;
      const d = (i + 1) * SEGMENTOS_RADIALES + siguiente;
      indices.push(a, c, b, b, c, d);
    }
  }

  const centroInferior = posiciones.length / 3;
  posiciones.push(anillos[0].x, anillos[0].y, anillos[0].z);
  const centroSuperior = posiciones.length / 3;
  const ultimo = anillos.at(-1);
  posiciones.push(ultimo.x, ultimo.y, ultimo.z);
  const offsetSuperior = (anillos.length - 1) * SEGMENTOS_RADIALES;
  for (let j = 0; j < SEGMENTOS_RADIALES; j++) {
    const siguiente = (j + 1) % SEGMENTOS_RADIALES;
    indices.push(centroInferior, siguiente, j);
    indices.push(centroSuperior, offsetSuperior + j, offsetSuperior + siguiente);
  }

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
  geometria.setIndex(indices);
  geometria.computeVertexNormals();
  geometria.computeBoundingSphere();
  return geometria;
}

function actualizarMalla() {
  pieza.geometry.dispose();
  pieza.geometry = crearGeometria(capas);
  $("#capas").textContent = `${capas.length} / ${TOTAL_CAPAS}`;
  actualizarPreview();
}

function actualizarPreview() {
  if (!preview) return;
  const control = estadoSesion === "imprimiendo" ? promedioControles() : leerControles();
  const y = Math.min((capas.length + 1) * ALTURA_CAPA, (TOTAL_CAPAS + 1) * ALTURA_CAPA);
  const puntos = [];
  for (let j = 0; j < SEGMENTOS_RADIALES; j++) {
    const angulo = j / SEGMENTOS_RADIALES * Math.PI * 2;
    puntos.push(new THREE.Vector3(control.x + Math.cos(angulo) * control.radio, y, control.z + Math.sin(angulo) * control.radio));
  }
  preview.geometry.dispose();
  preview.geometry = new THREE.BufferGeometry().setFromPoints(puntos);
  preview.visible = estadoSesion !== "finalizada";
}

function exportarSTL() {
  if (estadoSesion !== "finalizada") return;
  const datos = new STLExporter().parse(pieza, { binary: true });
  const blob = new Blob([datos], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `impresion-colectiva-${sesionId || Date.now()}.stl`;
  enlace.click();
  URL.revokeObjectURL(url);
}

function animar() {
  requestAnimationFrame(animar);
  controlesCamara.update();
  if (estadoSesion === "imprimiendo") {
    const transcurrido = Math.max(0, Date.now() - inicioSesion);
    const restante = Math.max(0, DURACION_MS - transcurrido);
    $("#tiempo").textContent = `${(restante / 1_000).toFixed(1)} s`;
    $("#progreso").style.width = `${Math.min(100, transcurrido / DURACION_MS * 100)}%`;
  }
  renderer.render(escena, camara);
}

window.addEventListener("resize", () => {
  const contenedor = $("#escena-impresion");
  camara.aspect = contenedor.clientWidth / contenedor.clientHeight;
  camara.updateProjectionMatrix();
  renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
});
