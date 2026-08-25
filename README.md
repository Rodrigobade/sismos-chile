# Sismos Chile

**https://rodrigobade.github.io/sismos-chile/**

App de sismos en Chile: lista en tiempo real, mapa de epicentros, filtros y avisos.
Es una PWA — se instala en el teléfono desde el navegador y funciona sin conexión
con los últimos datos descargados.

## Qué la diferencia de las apps de sismos que hay en Play Store

| | Apps de plantilla típicas | Esta |
|---|---|---|
| Tamaño | ~33 MB | ~60 KB |
| SDKs de publicidad | 10 a 13 | 0 |
| Rastreo | Firebase, Facebook, analytics | ninguno |
| Contenido | RSS dentro de un WebView | datos estructurados de dos catálogos |
| Mapa | WebView a un sitio externo | mapa propio, funciona sin conexión |
| Permisos | teléfono, arranque, notificaciones, batería | ninguno obligatorio |

## Fuentes de datos

- **CSN** — Centro Sismológico Nacional de la Universidad de Chile, vía
  `api.gael.cloud/general/public/sismos`. Es la fuente oficial para Chile y la
  que manda en la lista.
- **USGS** — `earthquake.usgs.gov/fdsnws/event/1/query`, acotado a la ventana
  de Chile. Aporta las coordenadas exactas y los sismos que el CSN todavía no
  publica.

Los dos catálogos se fusionan por hora (±90 s) y magnitud (±0.8). Cuando un
sismo del CSN no aparece en USGS, el epicentro se **estima** a partir de la
referencia geográfica ("49 km al SE de Socaire") usando el diccionario de
localidades de `geo.js`. Esos puntos se dibujan con relleno tenue y borde
punteado para no hacerlos pasar por dato medido.

Ninguna de las dos API pide clave ni tiene cuota publicada, y ambas responden
con `Access-Control-Allow-Origin: *`.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | estructura de la página |
| `app.css` | estilos, temas claro/oscuro |
| `app.js` | datos, fusión de catálogos, mapa, avisos |
| `geo.js` | diccionario de localidades y contorno de Chile |
| `sw.js` | service worker (funcionar sin conexión) |
| `manifest.webmanifest` | datos de instalación |
| `server.js` | servidor local, **solo para probar** |

## Probarla en el computador

```bash
node "C:/Users/ONE-TOUCH/Documents/Sismos Chile/server.js"
```

Y abrir <http://localhost:5177>.

## Instalarla en el teléfono

Abre <https://rodrigobade.github.io/sismos-chile/> en Chrome y usa
*Menú (⋮) → Instalar aplicación* (o *Agregar a la pantalla principal*). En iPhone,
en Safari: *Compartir → Agregar a inicio*. Queda con ícono propio y abre a
pantalla completa, sin barra del navegador.

Cada `git push` a `main` republica el sitio solo, en un par de minutos.

## Si haces cambios y no se ven

El service worker guarda una copia de los archivos. La estrategia es
*stale-while-revalidate*: la primera vez que abras después de un cambio verás
la versión vieja, y la segunda ya sale la nueva. Para forzarlo, sube el número
de `CACHE` en `sw.js` (`sismos-chile-v1` → `v2`).

## Límites conocidos

- El mapa **estira el eje este-oeste** para que Chile llene la pantalla del
  teléfono. Es un mapa de ubicación, no cartográfico: las distancias
  horizontales no están a escala.
- Los avisos llegan solo con la app abierta o en segundo plano reciente. Un
  aviso real con la app cerrada necesita push desde un servidor, que esta app
  deliberadamente no tiene.
- **Esto no es un sistema de alerta temprana.** Los sismos aparecen después de
  ocurridos, cuando el CSN o USGS los publican. Ante una emergencia, mandan las
  instrucciones de SENAPRED.

## Sobre los datos personales

La app no manda nada a ningún servidor propio. La ubicación, si se autoriza, se
usa solo dentro del teléfono para calcular distancias y nunca se guarda ni se
transmite. Las preferencias y la última copia de los sismos viven en el
`localStorage` del navegador.
