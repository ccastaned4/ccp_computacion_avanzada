import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ============================================================
// REFUERZO ESTRUCTURAL COLECTIVO
// Bioimpresión 3D en tierra · hueso + colágeno + agua + tierra
//
// INPUT      → geometría de la estructura XX (ángulo, altura, grosor)
// REGLAS     → riesgo por zona + refuerzo colectivo vía MQTT
// ESTADO     → refuerzosPorZona (compartido entre todas las personas conectadas)
// OUTPUT     → color/grosor de cada zona + estabilidad global de la estructura
//
// EDITA ESTAS TRES CONSTANTES con los datos de TU propio deployment EMQX
// (ver Anexo · Crear un broker MQTT gratuito con EMQX Cloud). No subas la
// contraseña al repositorio: se pide en la interfaz en tiempo de ejecución.
// ============================================================
const BROKER = "wss://TU-HOST:8084/mqtt";
const USUARIO = "TU-USUARIO";
const TOPIC_BASE = "uai/mcd/2026/proyecto-final/bioimpresion-tierra";
const TOPIC_EVENTOS = `${TOPIC_BASE}/eventos/refuerzo`;

// ------------------------------------------------------------
// PARÁMETROS DEL SISTEMA (ajustables y explicables en la presentación)
// ------------------------------------------------------------
const ALTURA_TOTAL = 6;              // altura de referencia de la estructura (para normalizar)
const ANGULO_REF = 70;               // ángulo de voladizo (°) considerado "riesgo máximo"
const SEGMENTOS_POR_VIGA = 4;        // en cuántas zonas se divide cada viga
const GROSOR_MIN = 0.09;
const GROSOR_POR_REFUERZO = 0.035;
const MAX_REFUERZOS_POR_ZONA = 4;
const UMBRAL_RIESGO_ALTO = 0.55;

// Ponderación de la REGLA 01: qué tan importante es cada factor en el riesgo.
// Suman 1.0 para que el resultado quede entre 0 y 1.
const PESO_ANGULO = 0.5;   // el ángulo de voladizo es el factor que más pesa
const PESO_ALTURA = 0.3;   // el peso acumulado de capas superiores
const PESO_GROSOR = 0.2;   // un elemento más grueso reduce el riesgo

document.querySelector("#topic-eventos").textContent = TOPIC_EVENTOS;

// ------------------------------------------------------------
// DOM
// ------------------------------------------------------------
const nombreInput = document.querySelector("#nombre");
const contrasenaInput = document.querySelector("#contrasena");
const botonConectar = document.querySelector("#boton-conectar");
const estadoPunto = document.querySelector("#estado-punto");
const estadoTexto = document.querySelector("#estado-texto");
const clienteIdTexto = document.querySelector("#cliente-id");

const zonaVacia = document.querySelector("#zona-vacia");
const zonaInfo = document.querySelector("#zona-info");
const zIdTexto = document.querySelector("#z-id");
const zAnguloTexto = document.querySelector("#z-angulo");
const zAlturaTexto = document.querySelector("#z-altura");
const zRiesgoTexto = document.querySelector("#z-riesgo");
const zGrosorTexto = document.querySelector("#z-grosor");
const zCountTexto = document.querySelector("#z-count");
const zMensaje = document.querySelector("#z-mensaje");
const botonReforzar = document.querySelector("#boton-reforzar");
const botonReiniciar = document.querySelector("#boton-reiniciar");

const refuerzosLista = document.querySelector("#refuerzos-lista");

let cliente, clientId, nombre;
let zonaSeleccionada = null;
let totalRefuerzos = 0;
const participantes = new Set();

botonConectar.addEventListener("click", conectar);
botonReforzar.addEventListener("click", () => {
  if (zonaSeleccionada) publicarRefuerzo(zonaSeleccionada);
});

function conectar() {
  nombre = nombreInput.value.trim();
  const contrasena = contrasenaInput.value;
  if (!nombre || !contrasena) return cambiarEstadoConexion("error", "Falta nombre o contraseña");

  const slug = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "usuario";
  const idCorto = Math.random().toString(16).slice(2, 6).toUpperCase();
  clientId = `navegador-${slug}-${idCorto}`;
  clienteIdTexto.textContent = clientId;

  nombreInput.disabled = contrasenaInput.disabled = botonConectar.disabled = true;
  cambiarEstadoConexion("conectando", "Conectando…");

  cliente = window.mqtt.connect(BROKER, { clientId, username: USUARIO, password: contrasena, reconnectPeriod: 2000, connectTimeout: 10000, clean: true });

  cliente.on("connect", () => {
    cambiarEstadoConexion("conectado", "Conectado a EMQX");
    botonConectar.textContent = "Conectado ✓";
    botonConectar.classList.add("conectado");
    participantes.add(clientId);
    actualizarParticipantes();
    if (zonaSeleccionada) botonReforzar.disabled = false;
    cliente.subscribe(TOPIC_EVENTOS, error => {
      if (error) console.error("Error al suscribirse:", error);
    });
  });

  cliente.on("message", (topic, payload) => procesarEvento(payload));
  cliente.on("reconnect", () => cambiarEstadoConexion("conectando", "Reconectando…"));
  cliente.on("offline", () => cambiarEstadoConexion("error", "Sin conexión"));
  cliente.on("error", error => { console.error(error); cambiarEstadoConexion("error", "Error de conexión"); });
}

function cambiarEstadoConexion(tipo, texto) {
  estadoPunto.className = "estado-punto";
  if (tipo) estadoPunto.classList.add(tipo);
  estadoTexto.textContent = texto;
}

// ------------------------------------------------------------
// REGLA 01 — geometría de la estructura XX
// Cada viga es una curva Bézier entre un anclaje en el suelo y el ápice
// donde cruza con la otra viga. Se combó hacia afuera a propósito: así el
// ángulo de voladizo NO es constante y el punto más riesgoso no siempre
// coincide con el punto más alto (como ocurre en impresión real).
// ------------------------------------------------------------
function construirVigas() {
  const unidades = [-2.6, 2.6]; // centros de los dos módulos "X" → forman "XX"
  const vigas = [];
  unidades.forEach((cx, unidadIdx) => {
    const apiceY = ALTURA_TOTAL;
    // Beam A: anclaje inferior izquierdo → ápice superior derecho
    vigas.push({
      id: `x${unidadIdx + 1}-a`,
      v0: new THREE.Vector3(cx - 1.6, 0, 0),
      vc: new THREE.Vector3(cx + 2.3, apiceY * 0.55, 0),
      v2: new THREE.Vector3(cx + 1.6, apiceY, 0),
    });
    // Beam B: anclaje inferior derecho → ápice superior izquierdo (cruza con A)
    vigas.push({
      id: `x${unidadIdx + 1}-b`,
      v0: new THREE.Vector3(cx + 1.6, 0, 0),
      vc: new THREE.Vector3(cx - 2.3, apiceY * 0.55, 0),
      v2: new THREE.Vector3(cx - 1.6, apiceY, 0),
    });
  });
  return vigas;
}

// Estado compartido: cuántos refuerzos ha recibido cada zona (empieza en 0
// para todas — se llena en vivo con los mensajes MQTT del grupo).
const refuerzosPorZona = new Map();
const zonas = new Map(); // zonaId -> { mesh, angleDeg, alturaNorm, curva:{p0,p1} }

function grosorDeZona(zonaId) {
  const n = refuerzosPorZona.get(zonaId) || 0;
  return GROSOR_MIN + n * GROSOR_POR_REFUERZO;
}

// REGLA 02 — combina ángulo + altura + grosor en un único puntaje de riesgo (0–1)
function riesgoDeZona(zonaId) {
  const z = zonas.get(zonaId);
  if (!z) return 0;
  const anguloNorm = THREE.MathUtils.clamp(z.angleDeg / ANGULO_REF, 0, 1);
  const grosorActual = grosorDeZona(zonaId);
  const grosorMax = GROSOR_MIN + MAX_REFUERZOS_POR_ZONA * GROSOR_POR_REFUERZO;
  const grosorNorm = THREE.MathUtils.clamp((grosorActual - GROSOR_MIN) / (grosorMax - GROSOR_MIN), 0, 1);
  const riesgo = PESO_ANGULO * anguloNorm + PESO_ALTURA * z.alturaNorm + PESO_GROSOR * (1 - grosorNorm);
  return THREE.MathUtils.clamp(riesgo, 0, 1);
}

const COLOR_OK = new THREE.Color(0x8fb59b);    // bajo riesgo
const COLOR_RIESGO = new THREE.Color(0xc67f74); // alto riesgo

// ------------------------------------------------------------
// ESCENA 3D
// ------------------------------------------------------------
let escena, camara, renderer, controles, grupoEstructura, raycaster, mouse;

iniciarEscena();
construirVigas().forEach(agregarViga);
recomputarTodo();
animar();

function iniciarEscena() {
  const c = document.querySelector("#escena-estructura");
  escena = new THREE.Scene();
  escena.background = new THREE.Color(0x0b0b0c);
  camara = new THREE.PerspectiveCamera(38, c.clientWidth / c.clientHeight, 0.1, 200);
  camara.position.set(8.5, 6.5, 13.5);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(c.clientWidth, c.clientHeight);
  c.appendChild(renderer.domElement);
  controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true;
  controles.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controles.autoRotateSpeed = 0.28;
  controles.target.set(0, 3, 0);

  escena.add(new THREE.HemisphereLight(0xfff4df, 0x22252b, 1.7));
  const luz = new THREE.DirectionalLight(0xffffff, 2.5);
  luz.position.set(6, 10, 6);
  escena.add(luz);
  const contraluz = new THREE.DirectionalLight(0x8fa8c7, 1.8);
  contraluz.position.set(-7, 5, -5);
  escena.add(contraluz);

  const suelo = new THREE.Mesh(
    new THREE.CircleGeometry(6.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 1 })
  );
  suelo.rotation.x = -Math.PI / 2;
  escena.add(suelo);

  grupoEstructura = new THREE.Group();
  escena.add(grupoEstructura);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  let pointerDown = null;
  renderer.domElement.addEventListener("pointerdown", e => { pointerDown = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!pointerDown) return;
    const dist = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    pointerDown = null;
    if (dist > 6) return; // fue un arrastre de la cámara, no un clic
    seleccionarDesdePuntero(e);
  });
}

function seleccionarDesdePuntero(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camara);
  const hits = raycaster.intersectObjects(grupoEstructura.children, false);
  if (hits.length) seleccionarZona(hits[0].object.userData.zonaId);
}

function agregarViga(viga) {
  const curva = new THREE.QuadraticBezierCurve3(viga.v0, viga.vc, viga.v2);
  const puntos = curva.getPoints(SEGMENTOS_POR_VIGA);
  for (let i = 0; i < SEGMENTOS_POR_VIGA; i++) {
    const p0 = puntos[i], p1 = puntos[i + 1];
    const zonaId = `${viga.id}-s${i + 1}`;
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const largo = dir.length();
    const angleDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(dir.clone().normalize().y, -1, 1)));
    const alturaNorm = THREE.MathUtils.clamp(((p0.y + p1.y) / 2) / ALTURA_TOTAL, 0, 1);

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(GROSOR_MIN, GROSOR_MIN, largo, 12),
      new THREE.MeshStandardMaterial({ color: COLOR_OK.clone(), roughness: 0.48, metalness: 0.04 })
    );
    mesh.position.copy(p0).lerp(p1, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.userData.zonaId = zonaId;
    grupoEstructura.add(mesh);

    zonas.set(zonaId, { mesh, angleDeg, alturaNorm, p0, p1, largo });
    refuerzosPorZona.set(zonaId, 0);
  }
}

// OUTPUT — cada vez que cambia el estado de una zona, se redibuja: color por
// riesgo y grosor por refuerzo acumulado.
function actualizarVisualZona(zonaId) {
  const z = zonas.get(zonaId);
  if (!z) return;
  const riesgo = riesgoDeZona(zonaId);
  const grosor = grosorDeZona(zonaId);

  z.mesh.geometry.dispose();
  z.mesh.geometry = new THREE.CylinderGeometry(grosor, grosor, z.largo, 12);
  z.mesh.material.color.copy(COLOR_OK).lerp(COLOR_RIESGO, riesgo);
  const seleccionada = zonaSeleccionada === zonaId;
  z.mesh.material.emissive.set(seleccionada ? 0xd8d2c4 : 0x000000);
  z.mesh.material.emissiveIntensity = seleccionada ? 0.42 : 0;

  if (zonaSeleccionada === zonaId) mostrarInfoZona(zonaId);
}

function recomputarTodo() {
  for (const zonaId of zonas.keys()) actualizarVisualZona(zonaId);
  actualizarMetricas();
}

// REGLA 03 — estabilidad global = 1 - promedio del riesgo de todas las zonas
function actualizarMetricas() {
  const ids = [...zonas.keys()];
  const riesgos = ids.map(riesgoDeZona);
  const promedio = riesgos.reduce((a, b) => a + b, 0) / riesgos.length;
  const estabilidad = Math.round((1 - promedio) * 100);
  const riesgoAlto = riesgos.filter(r => r >= UMBRAL_RIESGO_ALTO).length;

  document.querySelector("#m-estabilidad").textContent = `${estabilidad}%`;
  document.querySelector("#m-riesgo-alto").textContent = `${riesgoAlto} / ${ids.length}`;
  document.querySelector("#m-refuerzos").textContent = totalRefuerzos;
}

function actualizarParticipantes() {
  document.querySelector("#m-participantes").textContent = participantes.size;
}

function seleccionarZona(zonaId) {
  if (!zonaId) return;
  const anterior = zonaSeleccionada;
  zonaSeleccionada = zonaId;
  if (anterior && anterior !== zonaId) actualizarVisualZona(anterior);
  actualizarVisualZona(zonaId);
  zonaVacia.hidden = true;
  zonaInfo.hidden = false;
  mostrarInfoZona(zonaId);
  botonReforzar.disabled = !(cliente && cliente.connected);
}

function mostrarInfoZona(zonaId) {
  const z = zonas.get(zonaId);
  const riesgo = riesgoDeZona(zonaId);
  const n = refuerzosPorZona.get(zonaId) || 0;
  zIdTexto.textContent = zonaId;
  zAnguloTexto.textContent = `${z.angleDeg.toFixed(0)}°`;
  zAlturaTexto.textContent = `${(z.alturaNorm * ALTURA_TOTAL).toFixed(1)} m`;
  zRiesgoTexto.textContent = `${Math.round(riesgo * 100)}%`;
  zGrosorTexto.textContent = grosorDeZona(zonaId).toFixed(3);
  zCountTexto.textContent = n;
  zMensaje.textContent = n >= MAX_REFUERZOS_POR_ZONA ? "Esta zona ya alcanzó el refuerzo máximo." : "";
  botonReforzar.disabled = !(cliente && cliente.connected) || n >= MAX_REFUERZOS_POR_ZONA;
}

// ------------------------------------------------------------
// COLECTIVO — publicar y recibir refuerzos vía MQTT
// ------------------------------------------------------------
function publicarRefuerzo(zonaId) {
  if (!cliente?.connected) return;
  const mensaje = {
    tipo: "refuerzo",
    zonaId,
    nombre,
    clientId,
    compuesto: "hueso-colageno",
    timestamp: Date.now(),
  };
  cliente.publish(TOPIC_EVENTOS, JSON.stringify(mensaje), { qos: 0, retain: false });
}

function procesarEvento(payload) {
  try {
    const m = JSON.parse(payload.toString());
    if (m.tipo !== "refuerzo" || !zonas.has(m.zonaId)) return;

    const actual = refuerzosPorZona.get(m.zonaId) || 0;
    if (actual >= MAX_REFUERZOS_POR_ZONA) return;
    refuerzosPorZona.set(m.zonaId, actual + 1);
    totalRefuerzos += 1;
    participantes.add(m.clientId);

    actualizarVisualZona(m.zonaId);
    actualizarMetricas();
    actualizarParticipantes();
    agregarAlFeed(m);
  } catch (e) {
    console.error("Mensaje inválido:", e);
  }
}

function agregarAlFeed(m) {
  const vacio = refuerzosLista.querySelector(".vacio");
  if (vacio) vacio.remove();
  const hora = new Date(m.timestamp || Date.now()).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fila = document.createElement("div");
  fila.className = "refuerzo-fila";
  fila.innerHTML = `<span>${m.nombre || "Sin nombre"}</span><code>${m.zonaId}</code><small>${hora}</small>`;
  refuerzosLista.prepend(fila);
  while (refuerzosLista.children.length > 12) refuerzosLista.lastChild.remove();
}

// ------------------------------------------------------------
function animar() {
  requestAnimationFrame(animar);
  controles.update();
  renderer.render(escena, camara);
}

window.addEventListener("resize", () => {
  const c = document.querySelector("#escena-estructura");
  camara.aspect = c.clientWidth / c.clientHeight;
  camara.updateProjectionMatrix();
  renderer.setSize(c.clientWidth, c.clientHeight);
});
