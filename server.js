/* server.js — servidor estático mínimo para probar la app en el navegador.
   No hace falta para publicarla: la app son archivos sueltos. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const PUERTO = process.env.PORT || 5177;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const archivo = path.join(RAIZ, path.normalize(rel).replace(/^[/\\]+/, ''));

  if (!archivo.startsWith(RAIZ)) { res.writeHead(403).end('403'); return; }

  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(datos);
  });
}).listen(PUERTO, () => console.log(`Sismos Chile en http://localhost:${PUERTO}`));
