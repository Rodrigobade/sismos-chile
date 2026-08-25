/* traer-incendios.js — se ejecuta en GitHub Actions, no en el navegador.

   FIRMS no manda cabeceras CORS, así que la app no puede consultarlo directo
   desde el teléfono. Y la llave no puede ir en el código, porque el repositorio
   es público.

   La salida a las dos cosas: este script corre en GitHub Actions cada pocas
   horas con la llave guardada como secreto del repositorio, y deja un
   `incendios.json` chico junto a la app. El navegador lee ese archivo desde su
   mismo origen: sin CORS, sin llave expuesta y sin servidor que mantener.
*/

'use strict';

const fs = require('fs');
const path = require('path');

const LLAVE = process.env.FIRMS_MAP_KEY;
const DIAS = 2;
const AREA = '-76,-56.5,-66,-17';            // oeste,sur,este,norte
const FUENTES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'];
const SALIDA = path.join(__dirname, '..', 'incendios.json');

if (!LLAVE) {
  console.error('Falta FIRMS_MAP_KEY. Agrégala como secreto del repositorio.');
  process.exit(1);
}

/* El CSV de FIRMS cambia de columnas según el satélite, así que se lee por
   nombre de columna y nunca por posición. */
function leerCSV(texto) {
  const lineas = texto.trim().split(/\r?\n/);
  if (lineas.length < 2) return [];
  const cols = lineas[0].split(',').map(c => c.trim().toLowerCase());
  return lineas.slice(1).map(l => {
    const v = l.split(',');
    const o = {};
    cols.forEach((c, i) => { o[c] = (v[i] || '').trim(); });
    return o;
  });
}

/* MODIS informa la confianza como porcentaje y VIIRS como letra. */
function confianza(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'h' || s === 'high') return 'alta';
  if (s === 'n' || s === 'nominal') return 'media';
  if (s === 'l' || s === 'low') return 'baja';
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n >= 80 ? 'alta' : n >= 50 ? 'media' : 'baja';
  return 'media';
}

async function traer(fuente) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${LLAVE}/${fuente}/${AREA}/${DIAS}`;
  const r = await fetch(url);
  const texto = await r.text();
  if (!r.ok || /invalid|error/i.test(texto.slice(0, 60))) {
    console.warn(`${fuente}: ${r.status} ${texto.slice(0, 80)}`);
    return [];
  }
  const filas = leerCSV(texto);
  console.log(`${fuente}: ${filas.length} detecciones`);
  return filas.map(f => ({
    lat: +parseFloat(f.latitude).toFixed(4),
    lon: +parseFloat(f.longitude).toFixed(4),
    fecha: f.acq_date,
    hora: String(f.acq_time || '').padStart(4, '0'),   // UTC, HHMM
    frp: Math.round(parseFloat(f.frp) || 0),            // potencia radiativa, MW
    conf: confianza(f.confidence),
    noche: String(f.daynight || '').toUpperCase() === 'N',
    sat: fuente.split('_')[0] === 'MODIS' ? 'MODIS' : 'VIIRS'
  })).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lon));
}

/* Dos satélites ven el mismo incendio: se juntan las detecciones que caen a
   menos de ~1 km y en la misma hora, y se conserva la de mayor potencia. */
function agrupar(detecciones) {
  const vistas = new Map();
  for (const d of detecciones) {
    const clave = `${d.fecha}|${d.hora.slice(0, 2)}|${d.lat.toFixed(2)}|${d.lon.toFixed(2)}`;
    const previa = vistas.get(clave);
    if (!previa || d.frp > previa.frp) vistas.set(clave, d);
  }
  return [...vistas.values()].sort((a, b) =>
    (b.fecha + b.hora).localeCompare(a.fecha + a.hora) || b.frp - a.frp);
}

(async () => {
  const listas = await Promise.all(FUENTES.map(traer));
  const focos = agrupar(listas.flat());

  const salida = {
    generado: new Date().toISOString(),
    dias: DIAS,
    fuente: 'NASA FIRMS (VIIRS y MODIS, near real-time)',
    focos
  };

  // Solo escribimos si cambió algo, para no llenar el historial de commits.
  const previo = fs.existsSync(SALIDA) ? JSON.parse(fs.readFileSync(SALIDA, 'utf8')) : null;
  if (previo && JSON.stringify(previo.focos) === JSON.stringify(focos)) {
    console.log('Sin cambios: no se reescribe.');
    return;
  }

  fs.writeFileSync(SALIDA, JSON.stringify(salida) + '\n');
  console.log(`${focos.length} focos escritos en incendios.json`);
})();
