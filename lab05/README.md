# Impresión Colectiva

Proyecto final · Computación Avanzada · MCD UAI · 2026

Artefacto web colaborativo inspirado en el sistema MQTT de `lab-04`. Varias personas deforman en
tiempo real una pieza que comienza como cilindro, prisma cuadrado o prisma hexagonal y crece como una impresión 3D: una capa por segundo
durante diez segundos. Al terminar, la interacción se congela y la malla puede descargarse como STL.

## Arquitectura: INPUT → REGLA → ESTADO → OUTPUT

```text
INPUT
  cada participante arrastra un punto 3D, ajusta el ancho con la rueda y el espesor con un slider
      ↓
REGLA
  una vez por segundo se promedian los controles activos
  promedio X/Z → centro del siguiente anillo
  promedio radio → ancho del siguiente anillo
  promedio espesor → separación vertical respecto de la capa anterior
      ↓
ESTADO COMPARTIDO
  sesión + secuencia ordenada de capas publicada por MQTT
      ↓
OUTPUT
  malla 3D cerrada → congelado automático a los 10 s → archivo STL
```

## Geometría

Antes de comenzar se elige una sección circular (48 vértices), cuadrada (4) o hexagonal (6). La pieza
comienza como un prisma corto de radio `1`. Durante la sesión se agregan diez capas, una cada `1000 ms`,
para un total de once capas visibles. Para cada vértice de una sección se usa:

```text
v(j) = (centroX + cos(θj)·radio, altura, centroZ + sin(θj)·radio)
θj   = j / 48 · 2π
```

Los anillos consecutivos se unen mediante triángulos. La base y la tapa también se triangulan, por lo
que el resultado es una malla cerrada apta para exportar con `STLExporter` de Three.js.

## Decisión colectiva

Cada navegador publica su control más reciente. La persona que inicia la impresión actúa como reloj
de la sesión y, cada segundo, calcula:

```text
centroX_capa = promedio(X de participantes activos)
centroZ_capa = promedio(Z de participantes activos)
radio_capa   = promedio(radio de participantes activos)
espesor_capa = promedio(espesor de participantes activos)
y_capa       = y_anterior + espesor_capa
```

Luego publica la capa consolidada. Así todos reciben exactamente la misma secuencia en vez de generar
versiones locales potencialmente distintas. Si alguien entra tarde, quien inició la sesión le envía
una instantánea con las capas ya construidas.

## MQTT

Broker WebSocket seguro:

```js
const BROKER = "wss://rd7b7d2a.ala.us-east-1.emqxsl.com:8084/mqtt";
const USUARIO = "mcd_user";
const CONTRASENA_MQTT = "";
const TOPIC = "mcd/prueba";
```

La contraseña queda vacía y normalmente se introduce en la interfaz. Nunca debe subirse al repositorio.

Todos los mensajes viajan por `mcd/prueba` como JSON. Tipos utilizados:

- `hola`: anuncia participantes y solicita sincronización.
- `iniciar`: define identificador, creador, tiempo inicial y geometría de la sesión.
- `control`: comparte X, Z, radio y espesor de un participante.
- `capa`: distribuye una capa consolidada.
- `estado`: sincroniza a una persona que acaba de entrar.
- `finalizar`: congela la pieza y habilita la exportación.
- `reinicio`: devuelve todos los navegadores al cilindro inicial.

También está disponible `publicarMQTT(datos)` en la consola del navegador para publicar objetos de
prueba; la función aplica `JSON.stringify()` automáticamente.

## Uso

1. Servir `lab05/` mediante Live Server u otro servidor HTTP.
2. Abrir la URL en dos pestañas o dispositivos.
3. Escribir nombres distintos y la misma contraseña MQTT.
4. Conectar ambas personas.
5. Iniciar la impresión desde una pestaña.
6. Arrastrar el punto luminoso, usar la rueda para el ancho y cambiar el espesor en ambas pestañas.
7. Confirmar que ambas muestran la misma pieza terminada.
8. Descargar el STL con **Exportar modelo STL**.

No hay bundler ni etapa de compilación. El proyecto sigue siendo HTML, CSS y JavaScript estático,
compatible con GitHub Pages.
