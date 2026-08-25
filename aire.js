/* aire.js — calidad del aire en tiempo real.
   Fuente: SINCA, Sistema de Información Nacional de Calidad del Aire del
   Ministerio del Medio Ambiente. Usa los mismos ayudantes que app.js. */

'use strict';

const SINCA_URL = 'https://sinca.mma.gob.cl/index.php/json/listadomapa2k19';
const AIRE_CACHE = 'sismos-chile:aire:v1';
const AIRE_REFRESCO_MS = 600000;   // 10 min: los datos son horarios

const CONTAMINANTES = {
  PM25:  { nombre: 'MP-2,5',  largo: 'Material particulado fino' },
  PM10:  { nombre: 'MP-10',   largo: 'Material particulado' },
  '0001': { nombre: 'SO₂',    largo: 'Dióxido de azufre' },
  '0003': { nombre: 'NO₂',    largo: 'Dióxido de nitrógeno' },
  '0004': { nombre: 'CO',     largo: 'Monóxido de carbono' },
  '0008': { nombre: 'O₃',     largo: 'Ozono' }
};

const aire = {
  estaciones: [],
  actualizado: null,
  cargando: false,
  error: null,
  iniciado: false,
  contaminante: 'PM25',
  region: ''
};

/* Tramos oficiales del Índice de Calidad del Aire por Partículas (ICAP).
   Son los mismos que gatillan las alertas ambientales en invierno. */
function nivelAire(icap) {
  if (icap == null)  return { clase: 'sin', texto: 'Sin dato', orden: -1 };
  if (icap <= 50)    return { clase: 'n1', texto: 'Bueno', orden: 0 };
  if (icap <= 100)   return { clase: 'n2', texto: 'Regular', orden: 1 };
  if (icap <= 200)   return { clase: 'n3', texto: 'Alerta', orden: 2 };
  if (icap <= 300)   return { clase: 'n5', texto: 'Preemergencia', orden: 3 };
  return { clase: 'n6', texto: 'Emergencia', orden: 4 };
}

/* El tooltip del gráfico es lo único que trae las cifras reales:
   "<strong>5 µg∕m<sup>3</sup></strong> 10 ICAP<br><em>2026-08-25 16:00 hrs.</em>"
   La columna "valor" no sirve: viene desplazada +10 para que las barras
   pequeñas se vean en el gráfico del sitio. */
function leerTooltip(html) {
  const texto = String(html || '')
    .replace(/<sup>3<\/sup>/gi, '3')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&micro;/g, 'µ')
    .replace(/&#8260;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/no disponible/i.test(texto)) return null;

  const mIcap = /(-?\d+(?:[.,]\d+)?)\s*ICAP/i.exec(texto);
  const mConc = /^(-?\d+(?:[.,]\d+)?)\s*(µg\/m3|ppm|ppb)?/i.exec(texto);
  const num = s => s == null ? null : parseFloat(String(s).replace(',', '.'));

  return {
    icap: mIcap ? num(mIcap[1]) : null,
    valor: mConc ? num(mConc[1]) : null,
    unidad: mConc && mConc[2] ? mConc[2].replace('µg/m3', 'µg/m³') : ''
  };
}

/* Del histórico de 24 horas nos quedamos con la última medición que
   efectivamente tenga dato. */
function ultimaMedicion(serie) {
  const filas = (serie && serie.info && serie.info.rows) || [];
  for (let i = filas.length - 1; i >= 0; i--) {
    const c = filas[i].c || [];
    const leido = leerTooltip(c[3] && c[3].v);
    if (!leido) continue;
    return Object.assign({ hora: c[0] && c[0].v }, leido);
  }
  return null;
}

function limpiarHtml(s) {
  return String(s || '')
    .replace(/&oacute;/g, 'ó').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&amp;/g, '&');
}

/* La respuesta cruda pesa ~1,5 MB (24 horas de cada contaminante de cada
   estación). Guardamos solo la última medición: unos pocos KB. */
function destilar(crudo) {
  return crudo.map(e => {
    const medidas = {};
    for (const serie of e.realtime || []) {
      if (!CONTAMINANTES[serie.code]) continue;
      const m = ultimaMedicion(serie);
      if (m) medidas[serie.code] = m;
    }
    return {
      id: 'sinca:' + e.key,
      nombre: limpiarHtml(e.nombre),
      comuna: limpiarHtml(e.comuna),
      region: limpiarHtml(e.region),
      lat: e.latitud, lon: e.longitud,
      medidas
    };
  }).filter(e =>
    Object.keys(e.medidas).length &&
    Number.isFinite(e.lat) && Number.isFinite(e.lon)
  );
}

async function traerAire() {
  if (aire.cargando) return;
  aire.cargando = true;
  pintarEstadoAire();

  try {
    const r = await fetch(SINCA_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('SINCA ' + r.status);
    aire.estaciones = destilar(await r.json());
    aire.actualizado = Date.now();
    aire.error = null;
    try {
      localStorage.setItem(AIRE_CACHE, JSON.stringify({
        t: aire.actualizado, estaciones: aire.estaciones
      }));
    } catch {}
  } catch (e) {
    aire.error = navigator.onLine
      ? 'No se pudo consultar el SINCA.'
      : 'Sin conexión. Mostrando la última medición guardada.';
  }

  aire.cargando = false;
  if (estado.vista === 'aire') pintarAire();
}

function restaurarCacheAire() {
  try {
    const c = JSON.parse(localStorage.getItem(AIRE_CACHE) || 'null');
    if (c && Array.isArray(c.estaciones)) {
      aire.estaciones = c.estaciones;
      aire.actualizado = c.t;
    }
  } catch {}
}

/* ---------- vista ---------- */

/* El ICAP es el Índice de Calidad del Aire *por Partículas*: solo está
   definido para MP-2,5 y MP-10. Para los gases el SINCA no entrega índice,
   así que mostramos la concentración medida y no inventamos una categoría. */
const esParticula = code => code === 'PM25' || code === 'PM10';

function lectura(code, m) {
  if (esParticula(code)) {
    return { num: m.icap, sufijo: 'ICAP', nivel: nivelAire(m.icap), orden: m.icap ?? -1 };
  }
  if (m.valor == null) {
    return { num: null, sufijo: '', nivel: nivelAire(null), orden: -1 };
  }
  return {
    num: m.valor,
    sufijo: m.unidad,
    nivel: { clase: 'gas', texto: CONTAMINANTES[code].nombre, orden: 0 },
    orden: m.valor
  };
}

function estacionesFiltradas() {
  return aire.estaciones
    .filter(e => e.medidas[aire.contaminante])
    .filter(e => !aire.region || e.region === aire.region)
    .map(e => {
      const m = e.medidas[aire.contaminante];
      const l = lectura(aire.contaminante, m);
      return Object.assign({}, e, { m, l, nivel: l.nivel });
    })
    .sort((a, b) => b.l.orden - a.l.orden);
}

function pintarEstadoAire() {
  const el = $('#estado');
  if (aire.cargando && !aire.estaciones.length) {
    el.textContent = 'Consultando el SINCA…'; el.className = 'estado'; return;
  }
  if (aire.error) { el.textContent = aire.error; el.className = 'estado alerta'; return; }
  el.textContent = aire.actualizado
    ? `Actualizado ${haceCuanto(aire.actualizado)} · SINCA (Ministerio del Medio Ambiente)`
    : '';
  el.className = 'estado';
}

function pintarAire() {
  pintarEstadoAire();
  const lista = estacionesFiltradas();
  llenarRegiones();
  pintarResumenAire(lista);
  pintarListaAire(lista);
  pintarLeyendaAire();
  pintarMapa(lista.slice().reverse().map(e => ({
    lat: e.lat, lon: e.lon,
    r: e.nivel.orden < 0 ? 2 : 2.6 + e.nivel.orden * 1.1,
    clase: e.nivel.clase,
    id: e.id,
    titulo: `${e.nombre} — ${e.nivel.texto}`
  })));
  $('#creditos').innerHTML =
    'Datos del <strong>SINCA</strong>, Ministerio del Medio Ambiente. ' +
    'El índice ICAP es el mismo que se usa para decretar alertas, ' +
    'preemergencias y emergencias ambientales.';
}

function llenarRegiones() {
  const sel = $('#f-region');
  if (sel.dataset.lleno) return;
  const regiones = [...new Set(aire.estaciones.map(e => e.region))].sort();
  if (!regiones.length) return;
  sel.insertAdjacentHTML('beforeend',
    regiones.map(r => `<option value="${escapar(r)}">${escapar(r)}</option>`).join(''));
  sel.dataset.lleno = '1';
  sel.value = aire.region;
}

function pintarResumenAire(lista) {
  const cont = $('#resumen');
  if (!lista.length) {
    cont.innerHTML = '<p class="vacio">No hay mediciones para este filtro.</p>';
    return;
  }

  // Si conocemos la ubicación, lo que importa es la estación de al lado;
  // si no, la peor del país.
  let e, etiqueta;
  if (estado.posicion) {
    e = lista.reduce((mejor, x) =>
      distanciaKm(estado.posicion, [x.lat, x.lon]) <
      distanciaKm(estado.posicion, [mejor.lat, mejor.lon]) ? x : mejor);
    etiqueta = `Estación más cercana · a ${distanciaKm(estado.posicion, [e.lat, e.lon])} km`;
  } else {
    e = lista[0];
    etiqueta = aire.region ? 'Peor medición de la región' : 'Peor medición del país';
  }

  const cont2 = CONTAMINANTES[aire.contaminante];
  const nota = esParticula(aire.contaminante)
    ? ''
    : '<p class="conteo nota">El índice ICAP solo aplica al material particulado. ' +
      'Para los gases se muestra la concentración medida, sin categoría oficial.</p>';

  cont.innerHTML = `
    <button class="ultimo ${e.nivel.clase}" data-id="${escapar(e.id)}">
      <span class="ultimo-etq">${escapar(etiqueta)}</span>
      <span class="ultimo-mag">${e.l.num ?? '—'}</span>
      <span class="ultimo-lugar">${escapar(e.nombre)}</span>
      <span class="ultimo-meta">${escapar(e.nivel.texto)} · ${cont2.nombre} ${e.m.valor ?? '—'} ${escapar(e.m.unidad)} · ${escapar(e.m.hora || '')}</span>
    </button>
    <p class="conteo">${lista.length === 1 ? '1 estación' : lista.length + ' estaciones'} midiendo ${cont2.largo.toLowerCase()}</p>${nota}`;
}

function pintarListaAire(lista) {
  $('#lista-aire').innerHTML = lista.map(e => `
    <button class="fila" data-id="${escapar(e.id)}">
      <span class="mag ${e.nivel.clase}">${e.l.num ?? '—'}</span>
      <span class="fila-txt">
        <span class="lugar">${escapar(e.nombre)}</span>
        <span class="meta">${escapar(e.comuna)} · ${e.m.valor ?? '—'} ${escapar(e.m.unidad)}</span>
      </span>
      <span class="hace">${escapar(e.nivel.texto)}</span>
    </button>`).join('');
}

function pintarLeyendaAire() {
  $('#leyenda').innerHTML = [
    ['n1', 'Bueno'], ['n2', 'Regular'], ['n3', 'Alerta'],
    ['n5', 'Preemerg.'], ['n6', 'Emerg.']
  ].map(([c, t]) => `<li><i class="${c}"></i>${t}</li>`).join('');
}

function abrirDetalleAire(id) {
  const e = aire.estaciones.find(x => x.id === id);
  if (!e) return;
  const code = e.medidas[aire.contaminante] ? aire.contaminante : Object.keys(e.medidas)[0];
  const principal = e.medidas[code];
  const l = lectura(code, principal);
  const n = l.nivel;

  const filas = Object.entries(e.medidas).map(([code, m]) => {
    const c = CONTAMINANTES[code];
    return `<div class="dato"><dt>${c.largo} (${c.nombre})</dt>
            <dd>${m.valor ?? '—'} ${escapar(m.unidad)}${m.icap != null ? ` · ${m.icap} ICAP` : ''}</dd></div>`;
  }).join('');

  const dist = estado.posicion
    ? `<div class="dato"><dt>Distancia desde ti</dt><dd>${distanciaKm(estado.posicion, [e.lat, e.lon])} km</dd></div>` : '';

  $('#detalle-cuerpo').innerHTML = `
    <div class="det-cab ${n.clase}">
      <span class="det-mag">${l.num ?? '—'}</span>
      <span class="det-nivel">${n.texto}</span>
    </div>
    <h2>${escapar(e.nombre)}</h2>
    <dl>
      <div class="dato"><dt>Comuna</dt><dd>${escapar(e.comuna)}</dd></div>
      <div class="dato"><dt>Región</dt><dd>${escapar(e.region)}</dd></div>
      <div class="dato"><dt>Medición</dt><dd>${escapar(principal.hora || '')}</dd></div>
      ${dist}${filas}
      <div class="dato"><dt>Fuente</dt><dd>SINCA · MMA</dd></div>
    </dl>
    <div class="det-acciones">
      <a class="btn" target="_blank" rel="noopener"
         href="https://www.google.com/maps?q=${e.lat.toFixed(4)},${e.lon.toFixed(4)}">Ver en mapa</a>
    </div>`;
  $('#detalle').showModal();
}

/* ---------- arranque ---------- */

function iniciarAire() {
  if (aire.iniciado) return;
  aire.iniciado = true;
  restaurarCacheAire();
  traerAire();
  setInterval(() => {
    if (!document.hidden && estado.vista === 'aire') traerAire();
  }, AIRE_REFRESCO_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  $('#f-region').addEventListener('change', e => { aire.region = e.target.value; pintarAire(); });
  $('#f-contaminante').addEventListener('change', e => {
    aire.contaminante = e.target.value;
    pintarAire();
  });
});
