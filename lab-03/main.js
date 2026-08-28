import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const URL_AURORAS = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

async function cargarAuroras() {
  try {
    // Obtiene el JSON público más reciente desde NOAA OVATION.
    const respuesta = await fetch(URL_AURORAS);
    if (!respuesta.ok) {
      throw new Error(`Error al cargar auroras: ${respuesta.status}`);
    }

    const datos = await respuesta.json();
    console.log("Datos completos de NOAA:", datos);
    console.log("Observation Time:", datos["Observation Time"]);
    console.log("Forecast Time:", datos["Forecast Time"]);
    console.log("Primeras 10 coordenadas:", datos.coordinates.slice(0, 10));

    const coordenadasValidas = datos.coordinates.filter(
      (coordenada) =>
        Array.isArray(coordenada) &&
        coordenada.length >= 3 &&
        coordenada.every(Number.isFinite)
    );
    console.log(
      "Puntos del hemisferio norte:",
      coordenadasValidas.filter(([, latitud]) => latitud >= 0).length
    );
    console.log(
      "Puntos del hemisferio sur:",
      coordenadasValidas.filter(([, latitud]) => latitud < 0).length
    );

    // NOAA entrega cada dato como [longitud, latitud, intensidad].
    crearCampoAuroras(datos.coordinates);
  } catch (error) {
    // Si NOAA no responde, la escena 3D continúa funcionando normalmente.
    console.error("No fue posible cargar los datos de auroras.", error);
  }
}

const viewport = document.querySelector("#viewport");
const escena = new THREE.Scene();
escena.background = new THREE.Color(0x000000);

const camara = new THREE.PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);
camara.position.set(0, 0.7, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
viewport.appendChild(renderer.domElement);

const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;
controles.enablePan = false;
controles.minDistance = 7;
controles.maxDistance = 24;
controles.autoRotate = true;
controles.autoRotateSpeed = 0.25;
controles.target.set(0, 0, 0);

const cargadorTexturas = new THREE.TextureLoader();
const materialTierra = new THREE.MeshBasicMaterial({ color: 0x020407 });

const tierra = new THREE.Mesh(
  new THREE.SphereGeometry(4, 96, 96),
  materialTierra
);
tierra.rotation.y = -0.55;
escena.add(tierra);

function crearTexturaAscii(imagenMapa) {
  const columnas = 180;
  const filas = 90;
  const celda = 12;
  const muestra = document.createElement("canvas");
  muestra.width = columnas;
  muestra.height = filas;
  const contextoMuestra = muestra.getContext("2d", { willReadFrequently: true });
  contextoMuestra.drawImage(imagenMapa, 0, 0, columnas, filas);
  const pixeles = contextoMuestra.getImageData(0, 0, columnas, filas).data;

  const canvas = document.createElement("canvas");
  canvas.width = columnas * celda;
  canvas.height = filas * celda;
  const contexto = canvas.getContext("2d");
  contexto.fillStyle = "#020407";
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.font = `bold ${celda}px monospace`;
  contexto.textAlign = "center";
  contexto.textBaseline = "middle";

  const caracteres = "MNHDYSO0+/:;=-";
  const indiceFondo = 0;
  const fondo = [pixeles[indiceFondo], pixeles[1], pixeles[2], pixeles[3]];

  for (let fila = 0; fila < filas; fila += 1) {
    for (let columna = 0; columna < columnas; columna += 1) {
      const indice = (fila * columnas + columna) * 4;
      const diferencia =
        Math.abs(pixeles[indice] - fondo[0]) +
        Math.abs(pixeles[indice + 1] - fondo[1]) +
        Math.abs(pixeles[indice + 2] - fondo[2]) +
        Math.abs(pixeles[indice + 3] - fondo[3]);
      const esContinente = diferencia > 45;

      if (esContinente) {
        const patron = (columna * 7 + fila * 13) % caracteres.length;
        contexto.fillStyle = patron % 5 === 0 ? "#75b5d8" : "#edf7fc";
        contexto.fillText(
          caracteres[patron],
          columna * celda + celda / 2,
          fila * celda + celda / 2
        );
      } else if ((columna * 17 + fila * 31) % 89 === 0) {
        contexto.fillStyle = "rgba(120, 175, 205, 0.35)";
        contexto.fillText("·", columna * celda + celda / 2, fila * celda + celda / 2);
      }
    }
  }

  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return textura;
}

// Convierte el mapa equirectangular de continentes en caracteres ASCII.
cargadorTexturas.load(
  "https://upload.wikimedia.org/wikipedia/commons/c/c0/Equirectangular_projection_world_map_without_borders.svg",
  (texturaOriginal) => {
    materialTierra.map = crearTexturaAscii(texturaOriginal.image);
    materialTierra.needsUpdate = true;
    texturaOriginal.dispose();
  },
  undefined,
  (error) => console.error("No fue posible crear la textura ASCII.", error)
);

// Una esfera posterior ligeramente mayor dibuja solo el contorno exterior.
const contornoTierra = new THREE.Mesh(
  new THREE.SphereGeometry(4.035, 96, 96),
  new THREE.MeshBasicMaterial({
    color: 0xd9eef8,
    side: THREE.BackSide,
  })
);
escena.add(contornoTierra);

escena.add(new THREE.AmbientLight(0x385878, 0.55));
const sol = new THREE.DirectionalLight(0xffffff, 3.8);
sol.position.set(-5, 3, 8);
escena.add(sol);

let grupoAuroras;
const UMBRAL_AURORA = 5;
const RADIO_TIERRA = 4;
const SEGMENTOS_FILAMENTO = 6;
// Controles de calibracion visual de la aurora.
const ALTURA_MAXIMA_AURORA = 1.25;
const OPACIDAD_MAXIMA_AURORA = 0.32;
const BRILLO_MAXIMO_AURORA = 0.92;
const EXPONENTE_INTENSIDAD = 1.5;
let materialAurora;

function crearCampoAurorasAnterior(coordenadas) {
  if (!Array.isArray(coordenadas)) {
    throw new Error("El campo coordinates de NOAA no es un arreglo.");
  }

  // Elimina los velos anteriores antes de construir una nueva lectura.
  if (grupoAuroras) {
    escena.remove(grupoAuroras);
    grupoAuroras.traverse((objeto) => {
      if (objeto.geometry) objeto.geometry.dispose();
      if (objeto.material) objeto.material.dispose();
    });
  }

  // Organiza la intensidad por longitud y latitud para formar una retícula.
  const intensidades = new Map(
    coordenadas
      .filter(
        (coordenada) =>
          Array.isArray(coordenada) &&
          coordenada.length >= 3 &&
          coordenada.every(Number.isFinite)
      )
      .map(([longitud, latitud, intensidad]) => [
        `${longitud},${latitud}`,
        intensidad,
      ])
  );

  // Muestrea cada 2 grados y omite toda región bajo el umbral de actividad.
  const paso = 2;
  const longitudes = [];
  const latitudes = [];
  for (let longitud = 0; longitud < 360; longitud += paso) longitudes.push(longitud);
  for (let latitud = -90; latitud <= 90; latitud += paso) latitudes.push(latitud);

  const capas = [
    { posiciones: [], colores: [], direcciones: [], radios: [], amplitudes: [], fases: [], opacidad: 0.2 },
    { posiciones: [], colores: [], direcciones: [], radios: [], amplitudes: [], fases: [], opacidad: 0.42 },
    { posiciones: [], colores: [], direcciones: [], radios: [], amplitudes: [], fases: [], opacidad: 0.78 },
  ];

  function obtenerPunto(longitud, latitud) {
    const intensidad = intensidades.get(`${longitud},${latitud}`) ?? 0;
    if (intensidad < UMBRAL_AURORA) return null;

    const normalizada = THREE.MathUtils.clamp(intensidad / 30, 0, 1);
    const longitudRad = THREE.MathUtils.degToRad(longitud);
    const latitudRad = THREE.MathUtils.degToRad(latitud);
    const direccion = new THREE.Vector3(
      -Math.cos(latitudRad) * Math.cos(longitudRad),
      Math.sin(latitudRad),
      Math.cos(latitudRad) * Math.sin(longitudRad)
    ).normalize();

    return {
      direccion,
      intensidad,
      normalizada,
      radio: 4.08 + normalizada * 0.78,
      amplitud: 0.008 + normalizada * 0.045,
      fase: longitudRad * 2.5 + latitudRad * 3,
      latitud,
    };
  }

  function agregarVertice(capa, punto) {
    const posicion = punto.direccion.clone().multiplyScalar(punto.radio);
    capa.posiciones.push(posicion.x, posicion.y, posicion.z);
    capa.direcciones.push(punto.direccion.x, punto.direccion.y, punto.direccion.z);
    capa.radios.push(punto.radio);
    capa.amplitudes.push(punto.amplitud);
    capa.fases.push(punto.fase);

    const oscuro = new THREE.Color(0x241f78);
    const brillante = new THREE.Color(0x58ff9a);
    const color = oscuro.lerp(brillante, punto.normalizada);
    capa.colores.push(color.r, color.g, color.b);
  }

  function agregarSegmento(puntoA, puntoB) {
    if (!puntoA || !puntoB) return;
    const intensidadMedia = (puntoA.intensidad + puntoB.intensidad) / 2;
    const indiceCapa = intensidadMedia >= 20 ? 2 : intensidadMedia >= 10 ? 1 : 0;
    agregarVertice(capas[indiceCapa], puntoA);
    agregarVertice(capas[indiceCapa], puntoB);
  }

  // Conecta vecinos activos en ambos sentidos para formar bandas abiertas.
  latitudes.forEach((latitud, fila) => {
    longitudes.forEach((longitud, columna) => {
      const actual = obtenerPunto(longitud, latitud);
      const derecha = obtenerPunto(
        longitudes[(columna + 1) % longitudes.length],
        latitud
      );
      agregarSegmento(actual, derecha);

      if (fila < latitudes.length - 1) {
        const abajo = obtenerPunto(longitud, latitudes[fila + 1]);
        agregarSegmento(actual, abajo);
      }
    });
  });

  grupoAuroras = new THREE.Group();
  capas.forEach((capa) => {
    if (capa.posiciones.length === 0) return;

    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(capa.posiciones, 3)
    );
    geometria.setAttribute("color", new THREE.Float32BufferAttribute(capa.colores, 3));
    geometria.userData = {
      direcciones: new Float32Array(capa.direcciones),
      radios: new Float32Array(capa.radios),
      amplitudes: new Float32Array(capa.amplitudes),
      fases: new Float32Array(capa.fases),
    };

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: capa.opacidad,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    grupoAuroras.add(new THREE.LineSegments(geometria, material));
  });

  grupoAuroras.rotation.y = tierra.rotation.y;
  escena.add(grupoAuroras);
}

function animarAurorasAnterior(tiempo) {
  if (!grupoAuroras) return;

  grupoAuroras.children.forEach((lineas) => {
    const posiciones = lineas.geometry.attributes.position.array;
    const { direcciones, radios, amplitudes, fases } = lineas.geometry.userData;

    for (let indice = 0; indice < radios.length; indice += 1) {
      // Respiración lenta y continua, modulada por la intensidad local.
      const onda = Math.sin(tiempo * 0.00035 + fases[indice]) * amplitudes[indice];
      const radioAnimado = radios[indice] + onda;
      posiciones[indice * 3] = direcciones[indice * 3] * radioAnimado;
      posiciones[indice * 3 + 1] = direcciones[indice * 3 + 1] * radioAnimado;
      posiciones[indice * 3 + 2] = direcciones[indice * 3 + 2] * radioAnimado;
    }

    lineas.geometry.attributes.position.needsUpdate = true;
  });
}

// Reemplaza la reticula de lineas por filamentos radiales. Al estar declarada
// despues de la version anterior, esta es la implementacion que usa la carga NOAA.
function crearCampoAuroras(coordenadas) {
  if (!Array.isArray(coordenadas)) {
    throw new Error("El campo coordinates de NOAA no es un arreglo.");
  }

  if (grupoAuroras) {
    escena.remove(grupoAuroras);
    grupoAuroras.traverse((objeto) => {
      if (objeto.geometry) objeto.geometry.dispose();
      if (objeto.material) objeto.material.dispose();
    });
  }

  const puntosActivos = coordenadas.filter(
    (coordenada) =>
      Array.isArray(coordenada) &&
      coordenada.length >= 3 &&
      coordenada.every(Number.isFinite) &&
      coordenada[2] >= UMBRAL_AURORA
  );
  const posiciones = [];
  const normales = [];
  const tangentes = [];
  const alturas = [];
  const intensidades = [];
  const fases = [];
  const indices = [];

  puntosActivos.forEach(([longitud, latitud, intensidad]) => {
    const longitudRad = THREE.MathUtils.degToRad(longitud);
    const latitudRad = THREE.MathUtils.degToRad(latitud);

    // 1. Conversion latitud/longitud: situa el dato NOAA sobre la esfera.
    const normal = new THREE.Vector3(
      -Math.cos(latitudRad) * Math.cos(longitudRad),
      Math.sin(latitudRad),
      Math.cos(latitudRad) * Math.sin(longitudRad)
    ).normalize();

    // 2. Direccion normal: el filamento crece desde el centro hacia afuera,
    // nunca siguiendo simplemente el eje Y global.
    const tangente = new THREE.Vector3(-normal.z, 0, normal.x);
    if (tangente.lengthSq() < 0.0001) tangente.set(1, 0, 0);
    tangente.normalize();

    // intensidad NOAA normalizada
    const intensidadNormalizada = THREE.MathUtils.clamp(
      (intensidad - UMBRAL_AURORA) / 35,
      0,
      1
    );
    // extension radial segun intensidad: la curva acentua diferencias locales
    // sin cambiar la posicion geografica ni la normal de crecimiento.
    const respuesta = Math.pow(intensidadNormalizada, EXPONENTE_INTENSIDAD);
    const alturaFilamento = THREE.MathUtils.lerp(0.025, ALTURA_MAXIMA_AURORA, respuesta);
    const variacion = 0.94 + 0.1 * Math.sin(longitudRad * 7 + latitudRad * 11);
    const ancho = (0.009 + respuesta * 0.035) * variacion;
    const fase = longitudRad * 2.7 + latitudRad * 4.1;
    const primerVertice = posiciones.length / 3;

    for (let nivel = 0; nivel <= SEGMENTOS_FILAMENTO; nivel += 1) {
      const alturaNormalizada = nivel / SEGMENTOS_FILAMENTO;
      const radio = RADIO_TIERRA + 0.035 + alturaFilamento * alturaNormalizada;
      const estrechamiento = Math.sin(alturaNormalizada * Math.PI) * 0.55 + 0.45;

      for (const lado of [-1, 1]) {
        const posicion = normal
          .clone()
          .multiplyScalar(radio)
          .addScaledVector(tangente, lado * ancho * estrechamiento);
        posiciones.push(posicion.x, posicion.y, posicion.z);
        normales.push(normal.x, normal.y, normal.z);
        tangentes.push(tangente.x, tangente.y, tangente.z);
        alturas.push(alturaNormalizada);
        intensidades.push(respuesta);
        fases.push(fase);
      }
    }

    for (let nivel = 0; nivel < SEGMENTOS_FILAMENTO; nivel += 1) {
      const a = primerVertice + nivel * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
  geometria.setAttribute("aNormalRadial", new THREE.Float32BufferAttribute(normales, 3));
  geometria.setAttribute("aTangente", new THREE.Float32BufferAttribute(tangentes, 3));
  geometria.setAttribute("aAltura", new THREE.Float32BufferAttribute(alturas, 1));
  geometria.setAttribute("aIntensidad", new THREE.Float32BufferAttribute(intensidades, 1));
  geometria.setAttribute("aFase", new THREE.Float32BufferAttribute(fases, 1));
  geometria.setIndex(indices);
  geometria.computeBoundingSphere();

  materialAurora = new THREE.ShaderMaterial({
    uniforms: {
      uTiempo: { value: 0 },
      uOpacidadMaxima: { value: OPACIDAD_MAXIMA_AURORA },
      uBrilloMaximo: { value: BRILLO_MAXIMO_AURORA },
    },
    vertexShader: `
      uniform float uTiempo;
      attribute vec3 aNormalRadial;
      attribute vec3 aTangente;
      attribute float aAltura;
      attribute float aIntensidad;
      attribute float aFase;
      varying float vAltura;
      varying float vIntensidad;

      void main() {
        vAltura = aAltura;
        vIntensidad = aIntensidad;
        float onda = sin(uTiempo * 0.7 + aFase + aAltura * 5.0);
        vec3 animada = position;
        animada += aTangente * onda * aAltura * (0.012 + aIntensidad * 0.035);
        animada += aNormalRadial * onda * aAltura * (0.004 + aIntensidad * 0.012);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(animada, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAltura;
      varying float vIntensidad;
      uniform float uOpacidadMaxima;
      uniform float uBrilloMaximo;

      void main() {
        // gradiente cromatico segun altura, identico en norte y sur
        vec3 violeta = vec3(0.15, 0.09, 0.72);
        vec3 verde = vec3(0.08, 0.82, 0.32);
        vec3 magenta = vec3(0.78, 0.08, 0.32);
        float recorridoColor = vAltura * mix(0.58, 1.0, vIntensidad);
        vec3 colorInferior = mix(violeta, verde, smoothstep(0.0, 0.48, recorridoColor));
        vec3 color = mix(colorInferior, magenta, smoothstep(0.58, 1.0, recorridoColor));

        // brillo segun intensidad
        float desvanecido = smoothstep(0.0, 0.12, vAltura)
          * (1.0 - smoothstep(0.82, 1.0, vAltura));
        float opacidad = desvanecido * mix(0.045, uOpacidadMaxima, vIntensidad);
        float brillo = mix(0.55, uBrilloMaximo, vIntensidad);

        // limite para evitar saturacion blanca incluso con blending aditivo
        vec3 colorLimitado = min(color * brillo, vec3(0.82));
        gl_FragColor = vec4(colorLimitado, opacidad);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  grupoAuroras = new THREE.Group();
  grupoAuroras.add(new THREE.Mesh(geometria, materialAurora));
  grupoAuroras.rotation.y = tierra.rotation.y;
  escena.add(grupoAuroras);
}

function animarAuroras(tiempo) {
  if (materialAurora) materialAurora.uniforms.uTiempo.value = tiempo * 0.001;
}

function crearEstrellas() {
  const posiciones = [];
  for (let i = 0; i < 1800; i += 1) {
    const radio = 80 + Math.random() * 320;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    posiciones.push(
      radio * Math.sin(phi) * Math.cos(theta),
      radio * Math.cos(phi),
      radio * Math.sin(phi) * Math.sin(theta)
    );
  }

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
  return new THREE.Points(
    geometria,
    new THREE.PointsMaterial({ color: 0x9fb2c4, size: 0.18 })
  );
}

escena.add(crearEstrellas());

function ajustarVentana() {
  const ancho = viewport.clientWidth;
  const altura = viewport.clientHeight;
  camara.aspect = ancho / altura;
  camara.updateProjectionMatrix();
  renderer.setSize(ancho, altura);
}

function animar(tiempo = 0) {
  requestAnimationFrame(animar);
  animarAuroras(tiempo);
  controles.update();
  renderer.render(escena, camara);
}

window.addEventListener("resize", ajustarVentana);

// Consulta NOAA y genera el campo de auroras al iniciar el programa.
cargarAuroras();
animar();
