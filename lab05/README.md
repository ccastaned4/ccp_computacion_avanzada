# Refuerzo Estructural Colectivo

Proyecto Final · Computación Avanzada · MCD UAI · 2026

Artefacto computacional para el tema de tesis: **mejorar la imprimibilidad 3D en tierra de un
biomaterial de hueso, colágeno, agua y tierra**, inspirado en referentes como la casa Gaia (WASP +
Mario Cucinella Architects, impresión con tierra cruda local).

Construido sobre el starter "Sistema Colectivo" que entregó el profesor (misma base MQTT + Three.js,
misma paleta visual), pero con geometría, reglas y payload rediseñados para este tema.

## La idea

Una estructura en forma de **XX** (dos módulos en cruce, cada uno hecho de dos vigas curvas que se
cruzan) representa un elemento impreso en capas de tierra. Cada viga se divide en zonas. Cada zona
tiene un **riesgo de falla por voladizo** calculado a partir de su geometría. Varias personas
conectadas simultáneamente pueden inspeccionar la estructura y **reforzar colectivamente** las zonas
más riesgosas con el compuesto (hueso + colágeno), lo que reduce su riesgo y sube la
**estabilidad global** de la pieza — visible para todos en tiempo real.

## Arquitectura (INPUT → REGLAS → ESTADO → OUTPUT)

```
INPUT
  geometría de cada zona: ángulo de voladizo, altura, grosor
  + acción de una persona: "reforzar zona X"
       ↓
REGLAS
  REGLA 1 — riesgo = 0.5·ángulo_norm + 0.3·altura_norm + 0.2·(1 − grosor_norm)
  REGLA 2 — cada refuerzo aumenta el grosor de la zona (hasta un máximo)
  REGLA 3 — estabilidad global = 1 − promedio(riesgo de todas las zonas)
       ↓
ESTADO (compartido vía MQTT, igual para todas las personas conectadas)
  refuerzosPorZona: cuántos refuerzos acumula cada una de las 16 zonas
       ↓
OUTPUT
  color de cada zona (verde → rojo según riesgo)
  grosor de cada zona (según refuerzos)
  métricas colectivas: estabilidad global, zonas de riesgo alto, refuerzos totales, participantes
```

## Por qué esta regla de riesgo (y no una simulación estructural real)

Detectar puntos débiles "de verdad" requeriría un análisis de esfuerzos (FEA) con datos físicos del
biomaterial, fuera del alcance de un curso de computación. En su lugar usamos un **proxy geométrico
explicable**: el ángulo de voladizo es el criterio más citado en impresión 3D en tierra/arcilla para
saber si una capa puede sostenerse sin soporte; la altura acumulada representa el peso de las capas
superiores; el grosor representa cuánto material reforzado ya se aplicó ahí. Los pesos (0.5 / 0.3 /
0.2) son una decisión de diseño del equipo — se pueden ajustar y ese ajuste es, en sí mismo, parte de
la conversación de la presentación.

## Topics y payload

Un solo canal para los eventos de refuerzo (broker propio, no el de la clase):

```
uai/mcd/2026/proyecto-final/bioimpresion-tierra/eventos/refuerzo
```

```json
{
  "tipo": "refuerzo",
  "zonaId": "x1-b-s3",
  "nombre": "Ceci",
  "clientId": "navegador-ceci-A82F",
  "compuesto": "hueso-colageno",
  "timestamp": 1787869200000
}
```

Cada cliente conectado se suscribe a ese mismo topic, así que cuando alguien refuerza una zona, todas
las personas conectadas ven el cambio de color/grosor y las métricas actualizarse al instante — eso es
lo que hace que sea un sistema **colectivo** y no una simulación individual.

El mismo canal admite dos eventos ligeros adicionales, sin cambiar la estructura de topics:

- `tipo: "hola"`: anuncia el `nombre`, `clientId` y `timestamp` al conectarse. Los clientes presentes
  responden una vez para que quien acaba de entrar pueda contar participantes sin esperar un refuerzo.
- `tipo: "reinicio"`: anuncia el `nombre`, `clientId` y `timestamp`; todos los clientes ponen en cero
  los refuerzos de sus 16 zonas. Sirve para reiniciar una demostración de forma sincronizada.

Los tres eventos son efímeros (`retain: false`). Por eso “Participantes” representa los navegadores que
se han anunciado durante la sesión actual, no un sistema permanente de presencia con desconexiones.

## Antes de usarlo: crea tu propio broker MQTT

Este proyecto **no reutiliza el broker de la clase** (para no chocar con otros grupos ni depender de su
cuota). Sigan el anexo del curso — *Crear un broker MQTT gratuito con EMQX Cloud* — y al terminar,
reemplacen estas tres constantes al inicio de `main.js`:

```js
const BROKER = "wss://TU-HOST:8084/mqtt";
const USUARIO = "TU-USUARIO";
```

La contraseña **nunca se escribe en el código** — se pide en la interfaz cuando alguien se conecta.

## Ejecutar en local

Este proyecto usa ES modules e importmaps, así que necesita servirse por HTTP (no funciona abriendo
`index.html` directamente con doble clic). Cualquiera de estas opciones sirve:

- VS Code + extensión Live Server → clic derecho en `index.html` → "Open with Live Server".
- `npx serve .` desde esta carpeta.
- `python3 -m http.server` desde esta carpeta y abrir `http://localhost:8000`.

## Publicar en GitHub Pages

1. Copien esta carpeta como `/project/` dentro del repositorio del curso (o de su propio repo).
2. Push a GitHub.
3. En **Settings → Pages**, activen Pages sobre la rama y carpeta correspondiente.
4. Prueben la URL pública en otro computador o en una ventana de incógnito — y prueben que dos
   pestañas conectadas a la vez se ven reforzar zonas entre sí (esa es la prueba mínima de que el
   sistema colectivo funciona).

## Parámetros ajustables

Todos están comentados al inicio de `main.js`: cuántos segmentos tiene cada viga
(`SEGMENTOS_POR_VIGA`), el ángulo que se considera riesgo máximo (`ANGULO_REF`), cuánto refuerza cada
clic (`GROSOR_POR_REFUERZO`), el máximo de refuerzos por zona, el umbral de "riesgo alto", y los tres
pesos de la regla de riesgo.

## Siguientes pasos (si el proyecto continuara)

- Reemplazar los pesos fijos de la regla de riesgo por valores calibrados con datos reales de impresión
  del biomaterial (ensayos de voladizo máximo por mezcla hueso/colágeno/agua/tierra).
- Persistencia del estado (retained messages o un pequeño backend) para que la estructura no se
  reinicie cuando se recarga la página.
- Reemplazar el clic manual por datos entrantes de un sensor o de un análisis de imagen de una
  impresión real, conservando la misma arquitectura input → regla → estado → output.
