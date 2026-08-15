import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ======================================================
// 01 — PARÁMETROS
// ======================================================

const valoresIniciales = {
  columnas: 15,
  filas: 15,
  separacion: 1.2,
  amplitud: 3.0,
  frecuencia: 0.4,
  rotacion: 0.3,
  aleatoriedad: 0.0,
  semilla: 42,
};

const parametros = { ...valoresIniciales };

// ======================================================
// 02 — ESCENA
// ======================================================

const viewport = document.querySelector("#viewport");

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x0b0b0c);

const camara = new THREE.PerspectiveCamera(
  42,
  viewport.clientWidth / viewport.clientHeight,
  0.1,
  200
);

camara.position.set(18, 16, 18);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

viewport.appendChild(renderer.domElement);

const controlesOrbita = new OrbitControls(camara, renderer.domElement);
controlesOrbita.enableDamping = true;
controlesOrbita.target.set(0, 1.2, 0);

// Iluminación general.
const luzHemisferica = new THREE.HemisphereLight(0xf3efe5, 0x202229, 1.7);
escena.add(luzHemisferica);

// Luz principal.
const luzPrincipal = new THREE.DirectionalLight(0xffffff, 3.1);
luzPrincipal.position.set(8, 14, 9);
luzPrincipal.castShadow = true;
escena.add(luzPrincipal);

// Luz secundaria para suavizar el contraste.
const luzRelleno = new THREE.DirectionalLight(0xc8d8ff, 0.8);
luzRelleno.position.set(-8, 6, -6);
escena.add(luzRelleno);

// Plano base.
const suelo = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({
    color: 0x101114,
    roughness: 1,
    metalness: 0,
  })
);

suelo.rotation.x = -Math.PI / 2;
suelo.position.y = -0.03;
suelo.receiveShadow = true;
escena.add(suelo);

// Grilla de referencia para leer mejor escala y posición.
const grilla = new THREE.GridHelper(50, 50, 0x35383d, 0x202227);
grilla.position.y = 0.001;
escena.add(grilla);

// ======================================================
// 03 — OBJETO GENERATIVO
// ======================================================

const grupoCampo = new THREE.Group();
escena.add(grupoCampo);

// Cilindro base compartido por todas las torres.
const geometriaModulo = new THREE.CylinderGeometry(0.38, 0.38, 1, 24);

const materialModulo = new THREE.MeshStandardMaterial({
  color: 0xd7d2c8,
  roughness: 0.58,
  metalness: 0.03,
});

// Agente que recorre el campo e influye en la altura de los modulos.
const configuracionAgente = {
  velocidad: 5.0,
  radioInfluencia: 3.5,
  intensidad: 1.0,
  alturaMinima: 0.25,
  intensidadMusical: 4.0,
  escalaMusicalPelota: 1.8,
};

const radioPelota = 0.48;
const geometriaPelota = new THREE.SphereGeometry(radioPelota, 32, 16);
const pelota = new THREE.Mesh(
  geometriaPelota,
  new THREE.MeshStandardMaterial({
    color: 0xff2020,
    roughness: 0.35,
    metalness: 0.05,
  })
);

pelota.position.y = radioPelota;
pelota.castShadow = true;
escena.add(pelota);

// Segunda pelota: se mueve sola al doble de velocidad y rebota en los bordes.
const pelotaAutomatica = new THREE.Mesh(
  geometriaPelota,
  new THREE.MeshStandardMaterial({
    color: 0x2080ff,
    roughness: 0.35,
    metalness: 0.05,
  })
);

pelotaAutomatica.position.set(2, radioPelota, 2);
pelotaAutomatica.castShadow = true;
escena.add(pelotaAutomatica);

const anguloInicial = Math.random() * Math.PI * 2;
const direccionAutomatica = new THREE.Vector2(
  Math.cos(anguloInicial),
  Math.sin(anguloInicial)
);

const reloj = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const posicionMouse = new THREE.Vector2();
const objetivoPelota = new THREE.Vector3();
const puntoInterseccion = new THREE.Vector3();
const planoMovimiento = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// "Chill Beat" de Maddy, publicada bajo licencia CC0 en Wikimedia Commons.
const urlCancion =
  "https://upload.wikimedia.org/wikipedia/commons/9/9f/Chill_Beat.ogg";
const reproductor = new Audio();
reproductor.crossOrigin = "anonymous";
reproductor.src = urlCancion;
reproductor.controls = true;
reproductor.loop = true;
reproductor.preload = "metadata";
reproductor.style.position = "fixed";
reproductor.style.left = "20px";
reproductor.style.bottom = "20px";
reproductor.style.zIndex = "10";
reproductor.style.maxWidth = "calc(100vw - 40px)";
document.body.appendChild(reproductor);

let contextoAudio = null;
let analizadorAudio = null;
let datosAudio = null;
let energiaAudio = 0;

// El navegador permite crear el analizador despues de una accion del usuario.
reproductor.addEventListener("play", () => {
  if (!contextoAudio) {
    contextoAudio = new AudioContext();
    analizadorAudio = contextoAudio.createAnalyser();
    analizadorAudio.fftSize = 256;
    datosAudio = new Uint8Array(analizadorAudio.frequencyBinCount);

    const fuenteAudio = contextoAudio.createMediaElementSource(reproductor);
    fuenteAudio.connect(analizadorAudio);
    analizadorAudio.connect(contextoAudio.destination);
  }

  contextoAudio.resume();
});

// Mide principalmente los graves, donde se concentra el pulso de la cancion.
function actualizarEnergiaAudio() {
  if (!analizadorAudio || reproductor.paused) {
    energiaAudio *= 0.9;
    return;
  }

  analizadorAudio.getByteFrequencyData(datosAudio);
  const cantidadGraves = Math.max(1, Math.floor(datosAudio.length * 0.2));
  let sumaGraves = 0;

  for (let indice = 0; indice < cantidadGraves; indice++) {
    sumaGraves += datosAudio[indice];
  }

  const energiaObjetivo = sumaGraves / cantidadGraves / 255;

  // Respuesta rapida al golpe y descenso suave entre pulsos.
  const respuesta = energiaObjetivo > energiaAudio ? 0.45 : 0.12;
  energiaAudio = THREE.MathUtils.lerp(
    energiaAudio,
    energiaObjetivo,
    respuesta
  );
}

// Convierte la posicion del cursor en un punto del plano XZ del campo.
renderer.domElement.addEventListener("pointermove", (event) => {
  const limitesViewport = renderer.domElement.getBoundingClientRect();

  posicionMouse.x =
    ((event.clientX - limitesViewport.left) / limitesViewport.width) * 2 - 1;
  posicionMouse.y =
    -((event.clientY - limitesViewport.top) / limitesViewport.height) * 2 + 1;

  raycaster.setFromCamera(posicionMouse, camara);

  if (raycaster.ray.intersectPlane(planoMovimiento, puntoInterseccion)) {
    objetivoPelota.copy(puntoInterseccion);
  }
});

// ======================================================
// 04 — REGLAS GENERATIVAS
// ======================================================
// Estas funciones representan decisiones de diseño.
// Si cambian estas reglas, cambia la familia de resultados.

// Regla A:
// posición → distancia al centro → onda → altura
function calcularAlturaModulo(x, z) {
  const distancia = Math.sqrt(x * x + z * z);

  const onda =
    Math.sin(distancia * parametros.frecuencia) *
    parametros.amplitud;

  const ruido =
    aleatoriedadConSemilla(x, z, parametros.semilla) *
    parametros.aleatoriedad;

  return Math.max(0.25, 1.2 + onda + ruido);
}

// Regla B:
// la orientación depende de la dirección radial respecto al centro.
function calcularRotacionModulo(x, z) {
  const direccion = Math.atan2(z, x);
  return direccion * parametros.rotacion;
}

// ======================================================
// 05 — GENERAR CAMPO
// ======================================================

function generarCampo() {
  limpiarCampo();

  const ancho = (parametros.columnas - 1) * parametros.separacion;
  const profundidad = (parametros.filas - 1) * parametros.separacion;

  for (let columna = 0; columna < parametros.columnas; columna++) {
    for (let fila = 0; fila < parametros.filas; fila++) {
      const x = columna * parametros.separacion - ancho / 2;
      const z = fila * parametros.separacion - profundidad / 2;

      const altura = calcularAlturaModulo(x, z);
      const rotacion = calcularRotacionModulo(x, z);

      const modulo = new THREE.Mesh(geometriaModulo, materialModulo);

      // Escalamos solo en Y para modificar la altura.
      modulo.scale.y = altura;

      // Conservamos la altura generativa para poder volver suavemente a ella.
      modulo.userData.alturaBase = altura;

      // La geometría crece hacia arriba y hacia abajo desde su centro.
      // Por eso elevamos el módulo la mitad de su altura.
      modulo.position.set(x, altura / 2, z);

      modulo.rotation.y = rotacion;
      modulo.castShadow = true;
      modulo.receiveShadow = true;

      grupoCampo.add(modulo);
    }
  }
}

function limpiarCampo() {
  while (grupoCampo.children.length > 0) {
    grupoCampo.remove(grupoCampo.children[0]);
  }
}

// Mueve la pelota hacia el mouse y deforma los modulos dentro de su radio.
function actualizarAgente(delta) {
  const limiteX = ((parametros.columnas - 1) * parametros.separacion) / 2;
  const limiteZ = ((parametros.filas - 1) * parametros.separacion) / 2;

  objetivoPelota.x = THREE.MathUtils.clamp(objetivoPelota.x, -limiteX, limiteX);
  objetivoPelota.z = THREE.MathUtils.clamp(objetivoPelota.z, -limiteZ, limiteZ);

  // Avanza hacia el cursor a una velocidad constante, sin saltos bruscos.
  const distanciaX = objetivoPelota.x - pelota.position.x;
  const distanciaZ = objetivoPelota.z - pelota.position.z;
  const distanciaObjetivo = Math.sqrt(distanciaX * distanciaX + distanciaZ * distanciaZ);
  const paso = configuracionAgente.velocidad * delta;

  if (distanciaObjetivo > 0.001) {
    const proporcion = Math.min(paso / distanciaObjetivo, 1);
    pelota.position.x += distanciaX * proporcion;
    pelota.position.z += distanciaZ * proporcion;
  }

  // La pelota permanece dentro de los limites actuales del campo.
  pelota.position.x = THREE.MathUtils.clamp(pelota.position.x, -limiteX, limiteX);
  pelota.position.z = THREE.MathUtils.clamp(pelota.position.z, -limiteZ, limiteZ);

  // La segunda pelota avanza al doble de velocidad.
  const pasoAutomatico = configuracionAgente.velocidad * 2 * delta;
  pelotaAutomatica.position.x += direccionAutomatica.x * pasoAutomatico;
  pelotaAutomatica.position.z += direccionAutomatica.y * pasoAutomatico;

  // Al alcanzar un borde, se corrige la posicion y se invierte ese eje.
  if (
    pelotaAutomatica.position.x <= -limiteX ||
    pelotaAutomatica.position.x >= limiteX
  ) {
    pelotaAutomatica.position.x = THREE.MathUtils.clamp(
      pelotaAutomatica.position.x,
      -limiteX,
      limiteX
    );
    direccionAutomatica.x *= -1;
  }

  if (
    pelotaAutomatica.position.z <= -limiteZ ||
    pelotaAutomatica.position.z >= limiteZ
  ) {
    pelotaAutomatica.position.z = THREE.MathUtils.clamp(
      pelotaAutomatica.position.z,
      -limiteZ,
      limiteZ
    );
    direccionAutomatica.y *= -1;
  }

  // Este factor mantiene la suavidad aunque cambie la tasa de fotogramas.
  const suavizado = 1 - Math.exp(-7 * delta);

  // La pelota azul crece con los graves y vuelve suavemente a su escala normal.
  const escalaObjetivoAutomatica =
    1 + energiaAudio * configuracionAgente.escalaMusicalPelota;
  const escalaAutomatica = THREE.MathUtils.lerp(
    pelotaAutomatica.scale.x,
    escalaObjetivoAutomatica,
    suavizado
  );
  pelotaAutomatica.scale.setScalar(escalaAutomatica);

  let moduloMasCercano = null;
  let distanciaMasCercana = Infinity;
  let moduloMasCercanoAutomatico = null;
  let distanciaMasCercanaAutomatica = Infinity;

  grupoCampo.children.forEach((modulo) => {
    const dx = modulo.position.x - pelota.position.x;
    const dz = modulo.position.z - pelota.position.z;
    const distanciaManual = Math.sqrt(dx * dx + dz * dz);
    const dxAutomatico = modulo.position.x - pelotaAutomatica.position.x;
    const dzAutomatico = modulo.position.z - pelotaAutomatica.position.z;
    const distanciaAutomatica = Math.sqrt(
      dxAutomatico * dxAutomatico + dzAutomatico * dzAutomatico
    );

    if (distanciaManual < distanciaMasCercana) {
      distanciaMasCercana = distanciaManual;
      moduloMasCercano = modulo;
    }

    if (distanciaAutomatica < distanciaMasCercanaAutomatica) {
      distanciaMasCercanaAutomatica = distanciaAutomatica;
      moduloMasCercanoAutomatico = modulo;
    }

    // Se usa la pelota mas cercana para calcular la atraccion de cada torre.
    const distancia = Math.min(distanciaManual, distanciaAutomatica);

    const proximidad = THREE.MathUtils.clamp(
      1 - distancia / configuracionAgente.radioInfluencia,
      0,
      1
    );

    // La curva cuadratica concentra la atraccion cerca de la pelota.
    const influencia = proximidad * proximidad;
    const atraccion = THREE.MathUtils.clamp(
      influencia * configuracionAgente.intensidad,
      0,
      1
    );

    // Cerca del atractor la torre desciende; en el centro llega al nivel minimo.
    // El ritmo modifica la amplitud de altura sin perder la forma generativa.
    const alturaBaseMusical =
      modulo.userData.alturaBase +
      energiaAudio * configuracionAgente.intensidadMusical;
    const alturaObjetivo = THREE.MathUtils.lerp(
      alturaBaseMusical,
      configuracionAgente.alturaMinima,
      atraccion
    );
    const alturaActual = THREE.MathUtils.lerp(
      modulo.scale.y,
      alturaObjetivo,
      suavizado
    );

    modulo.scale.y = alturaActual;
    // Al centrar cada cilindro a media altura, su base permanece en y = 0.
    modulo.position.y = alturaActual / 2;
  });

  // La pelota sigue la cima de la torre mas cercana y queda apoyada sobre ella.
  if (moduloMasCercano) {
    const alturaObjetivoPelota = moduloMasCercano.scale.y + radioPelota;
    pelota.position.y = THREE.MathUtils.lerp(
      pelota.position.y,
      alturaObjetivoPelota,
      suavizado
    );
  }

  if (moduloMasCercanoAutomatico) {
    const alturaObjetivoAutomatica =
      moduloMasCercanoAutomatico.scale.y +
      radioPelota * pelotaAutomatica.scale.y;
    pelotaAutomatica.position.y = THREE.MathUtils.lerp(
      pelotaAutomatica.position.y,
      alturaObjetivoAutomatica,
      suavizado
    );
  }
}

// ======================================================
// 06 — ALEATORIEDAD CONTROLADA
// ======================================================
// Devuelve un valor repetible entre -1 y 1.
// Una misma semilla produce siempre el mismo patrón.

function aleatoriedadConSemilla(x, z, semilla) {
  const valor =
    Math.sin(
      x * 12.9898 +
      z * 78.233 +
      semilla * 37.719
    ) * 43758.5453;

  const normalizado = valor - Math.floor(valor);

  return normalizado * 2 - 1;
}

// ======================================================
// 07 — INTERFAZ
// ======================================================

const controles = {
  columnas: document.querySelector("#columnas"),
  filas: document.querySelector("#filas"),
  separacion: document.querySelector("#separacion"),
  amplitud: document.querySelector("#amplitud"),
  frecuencia: document.querySelector("#frecuencia"),
  rotacion: document.querySelector("#rotacion"),
  aleatoriedad: document.querySelector("#aleatoriedad"),
  semilla: document.querySelector("#semilla"),
};

const valoresVisibles = {
  columnas: document.querySelector("#columnas-valor"),
  filas: document.querySelector("#filas-valor"),
  separacion: document.querySelector("#separacion-valor"),
  amplitud: document.querySelector("#amplitud-valor"),
  frecuencia: document.querySelector("#frecuencia-valor"),
  rotacion: document.querySelector("#rotacion-valor"),
  aleatoriedad: document.querySelector("#aleatoriedad-valor"),
  semilla: document.querySelector("#semilla-valor"),
};

function actualizarParametro(nombre, valor) {
  const parametrosEnteros = ["columnas", "filas", "semilla"];

  parametros[nombre] = parametrosEnteros.includes(nombre)
    ? Number.parseInt(valor, 10)
    : Number.parseFloat(valor);

  valoresVisibles[nombre].value = parametrosEnteros.includes(nombre)
    ? parametros[nombre]
    : parametros[nombre].toFixed(2);

  generarCampo();
}

Object.entries(controles).forEach(([nombre, control]) => {
  control.addEventListener("input", (event) => {
    actualizarParametro(nombre, event.target.value);
  });
});

document.querySelector("#regenerar").addEventListener("click", () => {
  parametros.semilla = Math.floor(Math.random() * 100) + 1;

  controles.semilla.value = parametros.semilla;
  valoresVisibles.semilla.value = parametros.semilla;

  generarCampo();
});

document.querySelector("#restablecer").addEventListener("click", () => {
  Object.assign(parametros, valoresIniciales);

  const parametrosEnteros = ["columnas", "filas", "semilla"];

  Object.entries(controles).forEach(([nombre, control]) => {
    control.value = parametros[nombre];

    valoresVisibles[nombre].value = parametrosEnteros.includes(nombre)
      ? parametros[nombre]
      : parametros[nombre].toFixed(2);
  });

  generarCampo();
});

// ======================================================
// 08 — BUCLE DE ANIMACIÓN
// ======================================================

function animar() {
  requestAnimationFrame(animar);

  const delta = Math.min(reloj.getDelta(), 0.1);
  actualizarEnergiaAudio();
  actualizarAgente(delta);

  controlesOrbita.update();
  renderer.render(escena, camara);
}

function ajustarVentana() {
  const ancho = viewport.clientWidth;
  const altura = viewport.clientHeight;

  camara.aspect = ancho / altura;
  camara.updateProjectionMatrix();

  renderer.setSize(ancho, altura);
}

window.addEventListener("resize", ajustarVentana);

generarCampo();
animar();
