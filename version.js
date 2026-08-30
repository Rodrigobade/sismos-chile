/* version.js — sella una versión nueva antes de publicar.

   Por qué existe: GitHub Pages sirve los archivos con `Cache-Control: max-age=600`,
   así que durante diez minutos el navegador sigue usando su copia vieja aunque
   el servidor ya tenga la nueva. Peor aún, el service worker se instala pidiendo
   esos mismos archivos y termina guardando los viejos.

   La solución es que cada versión tenga URLs distintas. Este script pone el
   mismo número en index.html, privacidad.html y sw.js.

   Uso:  node version.js          (sube uno)
         node version.js 12       (fija esa versión)
*/

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const PATRON_CACHE = /const CACHE = 'sismos-chile-v(\d+)';/;

function versionActual() {
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const m = PATRON_CACHE.exec(sw);
  if (!m) throw new Error('No encontré la versión en sw.js');
  return +m[1];
}

function sellar(v) {
  // sw.js: nombre de caché y lista de archivos
  const swPath = path.join(RAIZ, 'sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(PATRON_CACHE, `const CACHE = 'sismos-chile-v${v}';`);
  // El guion importa: sin él, geo-chile.js se queda sin sellar y se vuelve el
  // único archivo que puede quedar viejo en la caché del navegador.
  sw = sw.replace(/'([a-z-]+\.(?:html|css|js|webmanifest|svg))(\?v=\d+)?'/g,
                  (_, archivo) => `'${archivo}?v=${v}'`);
  fs.writeFileSync(swPath, sw);

  // páginas: cada <link> y <script> propio lleva la versión
  for (const pagina of ['index.html', 'privacidad.html']) {
    const p = path.join(RAIZ, pagina);
    let h = fs.readFileSync(p, 'utf8');
    h = h.replace(/(href|src)="([a-z-]+\.(?:css|js|webmanifest))(\?v=\d+)?"/g,
                  (_, attr, archivo) => `${attr}="${archivo}?v=${v}"`);
    fs.writeFileSync(p, h);
  }

  return v;
}

const arg = process.argv[2];
const nueva = arg ? +arg : versionActual() + 1;
if (!Number.isInteger(nueva) || nueva < 1) {
  console.error('Versión inválida:', arg);
  process.exit(1);
}
sellar(nueva);
console.log(`Versión ${nueva} sellada en sw.js, index.html y privacidad.html.`);
console.log('Ahora: git add -A && git commit && git push');
