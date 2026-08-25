# Sismos Chile

**https://rodrigobade.github.io/sismos-chile/**

Cuatro cosas útiles en una sola app, con fuentes oficiales y sin publicidad:
**sismos**, **farmacias de turno**, **clima** y **calidad del aire**.

Es una PWA: se instala en el teléfono desde el navegador, pesa menos de 100 KB
y funciona sin conexión con los últimos datos descargados.

## Qué la diferencia de las apps de emergencias que hay en Play Store

| | Apps de plantilla típicas | Esta |
|---|---|---|
| Tamaño | ~33 MB | ~90 KB |
| SDKs de publicidad | 10 a 13 | 0 |
| Rastreo | Firebase, Facebook, analytics | ninguno |
| Contenido | RSS y sitios ajenos dentro de un WebView | datos estructurados de 5 catálogos oficiales |
| Mapas | WebView a un sitio externo | mapa propio, funciona sin conexión |
| Alcance | amarrada a una comuna | todo Chile, y el mundo para sismos |
| Permisos | teléfono, arranque, notificaciones, batería | ninguno obligatorio |

## Secciones y de dónde salen los datos

| Sección | Fuente | Qué entrega |
|---|---|---|
| **Sismos** | CSN (Universidad de Chile) vía `api.gael.cloud` + USGS | Chile desde magnitud 2.5, o el mundo desde 4.0 |
| **Farmacias de turno** | MINSAL, `midas.minsal.cl` | ~333 farmacias en ~237 comunas, con horario, teléfono y coordenadas |
| **Clima** | Open-Meteo | tiempo actual y pronóstico a 7 días |
| **Calidad del aire** | SINCA, Ministerio del Medio Ambiente | 121 estaciones e índice ICAP oficial |

Ninguna pide clave ni registro, y todas responden con `Access-Control-Allow-Origin: *`.

## Decisiones que no son obvias leyendo el código

**Sismos.** Los dos catálogos se fusionan por hora (±90 s) y magnitud (±0.8).
El CSN manda para Chile pero no entrega coordenadas; cuando el mismo sismo está
en USGS se toman de ahí. Si no está, el epicentro se **estima** desde la
referencia ("49 km al SE de Socaire") con el diccionario de `geo.js`, y esos
puntos se dibujan con relleno tenue y borde punteado para no hacerlos pasar por
dato medido.

**Aire.** La respuesta del SINCA pesa 1,5 MB porque trae 24 horas de cada
contaminante de cada estación; se destila a la última medición antes de
guardarla. Las cifras reales se leen del *tooltip*: la columna `valor` viene
desplazada +10 para que las barras chicas se vean en el gráfico del sitio
original. El índice ICAP solo está definido para material particulado, así que
para los gases se muestra la concentración y se dice que no hay categoría
oficial.

**Farmacias.** El registro trae coordenadas erróneas en algunos locales (una
farmacia de Talca cargada con la latitud de Talcahuano) y teléfonos truncados
como `+560`. Ambos se validan antes de usarlos: sin coordenada plausible no se
calcula distancia, y sin teléfono válido no se ofrece el botón de llamar. Un
turno que "cierra" antes de abrir cruza la medianoche y se interpreta así.

**Mapas.** Hay dos con la misma maquinaria. El de Chile **estira el eje
este-oeste tres veces**, porque a escala real un país de 4300 × 180 km es una
cinta ilegible en un teléfono. El del mundo no lo necesita, pero usa una escala
distinta para que puntos y etiquetas se vean del mismo tamaño en pantalla. Los
dos son mapas de ubicación, no cartografía.

**Clima.** La consulta se hace con las coordenadas de una ciudad de la lista,
nunca con las del usuario. Si autoriza la ubicación, se usa solo dentro del
teléfono para preseleccionar la ciudad más cercana.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | estructura y pestañas |
| `app.css` | estilos, temas claro y oscuro |
| `app.js` | armazón: estado, mapa, registro de secciones, sismos |
| `aire.js`, `farmacias.js`, `clima.js` | una sección cada uno |
| `geo.js` | localidades chilenas y contorno de Chile |
| `mundo.js` | contorno de los continentes (Natural Earth, dominio público) |
| `sw.js` | service worker |
| `privacidad.html` | aviso de privacidad |
| `server.js` | servidor local, **solo para probar** |

Cada sección se inscribe sola con `registrarSeccion(id, {...})`, así que agregar
una no obliga a tocar las demás.

## Probarla en el computador

```bash
node "C:/Users/ONE-TOUCH/Documents/Sismos Chile/server.js"
```

Y abrir <http://localhost:5177>.

## Instalarla en el teléfono

Abre <https://rodrigobade.github.io/sismos-chile/> en Chrome y usa
*Menú (⋮) → Instalar aplicación*. En iPhone, en Safari: *Compartir → Agregar a
inicio*.

Cada `git push` a `main` republica el sitio solo, en un par de minutos.

## Si haces cambios y no se ven

El service worker guarda una copia de los archivos con estrategia
*stale-while-revalidate*: la primera vez que abras después de un cambio verás la
versión vieja, y la segunda ya sale la nueva. Para forzarlo, sube el número de
`CACHE` en `sw.js`.

## Límites conocidos

- **No es un sistema de alerta temprana.** Los sismos aparecen después de
  ocurridos. Ante una emergencia mandan las instrucciones de **SENAPRED**.
- El pronóstico es un **modelo numérico**. Los avisos meteorológicos oficiales
  los emite la **Dirección Meteorológica de Chile**.
- Los horarios de farmacias los declara cada local ante el MINSAL.
- Los avisos de sismo llegan solo con la app abierta o en segundo plano
  reciente. Un aviso con la app cerrada necesita push desde un servidor, que
  esta app deliberadamente no tiene.

### Lo que no se pudo hacer, y por qué

- **Alertas oficiales de SENAPRED**: no publican un feed consumible.
- **Tsunami (SHOA)**: su sitio bloquea las consultas (403).
- **Incendios forestales**: CONAF y SERNAGEOMIN solo publican RSS de prensa
  institucional, sin CORS y sin datos de emergencia. La alternativa real es
  NASA FIRMS, que necesita una llave gratuita que debe pedir el titular.
- **Cortes de luz**: las eléctricas no publican datos abiertos; sus mapas son
  sitios cerrados.

## Sobre los datos personales

La app no manda nada a ningún servidor propio, porque no existe. La ubicación,
si se autoriza, se usa solo dentro del teléfono y nunca se guarda ni se
transmite. Las preferencias y la última copia de los datos viven en el
`localStorage` del navegador. Ver [privacidad.html](privacidad.html).
