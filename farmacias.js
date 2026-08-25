/* farmacias.js — farmacias de turno.
   Fuente: MINSAL, servicio público de farmacias de turno del día.
   Cubre todo Chile: no está amarrada a una comuna. */

'use strict';

const FARMACIAS_URL = 'https://midas.minsal.cl/farmacia_v2/WS/getLocalesTurnos.php';
const FARM_CACHE = 'sismos-chile:farmacias:v1';
const FARM_REFRESCO_MS = 1800000;   // 30 min: los turnos cambian una vez al día

const farm = {
  locales: [],
  actualizado: null,
  cargando: false,
  error: null,
  iniciado: false,
  comuna: '',
  soloAbiertas: false
};

/* Chile continental e insular, con holgura. Sirve para descartar coordenadas
   erróneas del propio registro: hay locales cargados con la latitud de otra
   región, y ordenarlos por distancia los pondría en cualquier parte. */
function coordenadaPlausible(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
         lat < -17 && lat > -56.5 && lon < -66 && lon > -110;
}

function titulo(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[\s(/-])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase())
    .trim();
}

function hhmm(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function aMinutos(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/* Minutos transcurridos del día en hora de Chile. */
function minutosAhoraChile() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  const o = {};
  for (const x of p) o[x.type] = x.value;
  return (+o.hour % 24) * 60 + (+o.minute);
}

/* Un turno que cierra "antes" de abrir cruza la medianoche. */
function estaAbierta(l) {
  if (l.abre == null || l.cierra == null) return null;
  const ahora = minutosAhoraChile();
  return l.cierra >= l.abre
    ? ahora >= l.abre && ahora <= l.cierra
    : ahora >= l.abre || ahora <= l.cierra;
}

function normalizarTelefono(t) {
  const limpio = String(t || '').replace(/[^\d+]/g, '');
  // El registro trae basura como "+560" o números truncados.
  return limpio.replace(/^\+?56/, '').length >= 8 ? limpio : '';
}

function destilar(crudo) {
  return crudo.map(f => {
    const lat = parseFloat(f.local_lat), lon = parseFloat(f.local_lng);
    const ok = coordenadaPlausible(lat, lon);
    return {
      id: 'farm:' + f.local_id,
      nombre: titulo(f.local_nombre),
      comuna: titulo(f.comuna_nombre),
      localidad: titulo(f.localidad_nombre),
      direccion: titulo(f.local_direccion),
      telefono: normalizarTelefono(f.local_telefono),
      apertura: hhmm(f.funcionamiento_hora_apertura),
      cierre: hhmm(f.funcionamiento_hora_cierre),
      abre: aMinutos(f.funcionamiento_hora_apertura),
      cierra: aMinutos(f.funcionamiento_hora_cierre),
      lat: ok ? lat : null,
      lon: ok ? lon : null,
      fecha: f.fecha
    };
  }).filter(f => f.nombre);
}

async function traerFarmacias() {
  if (farm.cargando) return;
  farm.cargando = true;
  pintarEstadoFarm();

  try {
    const r = await fetch(FARMACIAS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('MINSAL ' + r.status);
    farm.locales = destilar(await r.json());
    farm.actualizado = Date.now();
    farm.error = null;
    try {
      localStorage.setItem(FARM_CACHE, JSON.stringify({
        t: farm.actualizado, locales: farm.locales
      }));
    } catch {}
  } catch {
    farm.error = navigator.onLine
      ? 'No se pudo consultar el registro del MINSAL.'
      : 'Sin conexión. Mostrando los turnos guardados.';
  }

  farm.cargando = false;
  if (estado.vista === 'farmacias') pintarFarmacias();
}

function restaurarCacheFarm() {
  try {
    const c = JSON.parse(localStorage.getItem(FARM_CACHE) || 'null');
    if (c && Array.isArray(c.locales)) { farm.locales = c.locales; farm.actualizado = c.t; }
  } catch {}
}

/* ---------- vista ---------- */

function farmaciasFiltradas() {
  let lista = farm.locales.map(f => Object.assign({}, f, {
    abierta: estaAbierta(f),
    dist: estado.posicion && f.lat != null
      ? distanciaKm(estado.posicion, [f.lat, f.lon]) : null
  }));

  if (farm.comuna) lista = lista.filter(f => f.comuna === farm.comuna);
  if (farm.soloAbiertas) lista = lista.filter(f => f.abierta !== false);

  // Con ubicación mandan los kilómetros; sin ella, orden alfabético para que
  // la lista sea predecible en vez de aleatoria.
  if (estado.posicion) {
    lista.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
  } else {
    lista.sort((a, b) =>
      a.comuna.localeCompare(b.comuna, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  }
  return lista;
}

function pintarEstadoFarm() {
  const el = $('#estado');
  if (farm.cargando && !farm.locales.length) {
    el.textContent = 'Consultando los turnos de hoy…'; el.className = 'estado'; return;
  }
  if (farm.error) { el.textContent = farm.error; el.className = 'estado alerta'; return; }
  el.textContent = farm.actualizado
    ? `Actualizado ${haceCuanto(farm.actualizado)} · MINSAL`
    : '';
  el.className = 'estado';
}

function pintarFarmacias() {
  pintarEstadoFarm();
  llenarComunas();
  const lista = farmaciasFiltradas();
  pintarResumenFarm(lista);
  pintarListaFarm(lista);
  $('#creditos').innerHTML =
    'Turnos publicados por el <strong>Ministerio de Salud</strong>. ' +
    'Los horarios los declara cada local: si vas de madrugada, conviene llamar antes.';
}

function llenarComunas() {
  const sel = $('#f-comuna');
  if (sel.dataset.lleno || !farm.locales.length) return;
  const comunas = [...new Set(farm.locales.map(f => f.comuna))].sort((a, b) => a.localeCompare(b, 'es'));
  sel.insertAdjacentHTML('beforeend',
    comunas.map(c => `<option value="${escapar(c)}">${escapar(c)}</option>`).join(''));
  sel.dataset.lleno = '1';
  sel.value = farm.comuna;
}

function pintarResumenFarm(lista) {
  const cont = $('#resumen');
  if (!lista.length) {
    cont.innerHTML = '<p class="vacio">No hay farmacias de turno con este filtro.</p>';
    return;
  }

  const f = lista[0];
  const etiqueta = estado.posicion && f.dist != null
    ? `La más cercana · a ${f.dist} km`
    : (farm.comuna ? `De turno en ${f.comuna}` : 'De turno hoy');
  const abiertas = lista.filter(x => x.abierta === true).length;

  cont.innerHTML = `
    <button class="ultimo ${f.abierta === false ? 'sin' : 'n1'}" data-id="${escapar(f.id)}">
      <span class="ultimo-etq">${escapar(etiqueta)}</span>
      <span class="ultimo-mag">${f.abierta === false ? '✕' : '✚'}</span>
      <span class="ultimo-lugar">${escapar(f.nombre)}</span>
      <span class="ultimo-meta">${escapar(f.direccion)}, ${escapar(f.comuna)} · ${escapar(f.apertura)} a ${escapar(f.cierre)}</span>
    </button>
    <p class="conteo">${lista.length === 1 ? '1 farmacia de turno' : lista.length + ' farmacias de turno'}${
      abiertas ? ` · ${abiertas} abierta${abiertas === 1 ? '' : 's'} ahora` : ''}</p>`;
}

function pintarListaFarm(lista) {
  $('#lista-farmacias').innerHTML = lista.map(f => {
    const marca = f.abierta === true ? 'n1' : f.abierta === false ? 'sin' : 'gas';
    const derecha = f.dist != null ? `${f.dist} km`
                  : f.abierta === true ? 'Abierta'
                  : f.abierta === false ? 'Cerrada' : '';
    return `
      <button class="fila" data-id="${escapar(f.id)}">
        <span class="mag ${marca}">${f.abierta === false ? '✕' : '✚'}</span>
        <span class="fila-txt">
          <span class="lugar">${escapar(f.nombre)}</span>
          <span class="meta">${escapar(f.direccion)} · ${escapar(f.comuna)} · ${escapar(f.apertura)}–${escapar(f.cierre)}</span>
        </span>
        <span class="hace">${escapar(derecha)}</span>
      </button>`;
  }).join('');
}

function abrirFichaFarm(id) {
  const f = farm.locales.find(x => x.id === id);
  if (!f) return;
  const abierta = estaAbierta(f);
  const dist = estado.posicion && f.lat != null
    ? `<div class="dato"><dt>Distancia desde ti</dt><dd>${distanciaKm(estado.posicion, [f.lat, f.lon])} km</dd></div>` : '';
  const sinCoord = f.lat == null
    ? '<div class="dato"><dt>Ubicación</dt><dd><em>el registro no trae coordenadas válidas</em></dd></div>' : '';

  $('#detalle-cuerpo').innerHTML = `
    <div class="det-cab ${abierta === false ? 'sin' : 'n1'}">
      <span class="det-mag">✚</span>
      <span class="det-nivel">${abierta === true ? 'Abierta ahora' : abierta === false ? 'Cerrada ahora' : 'De turno'}</span>
    </div>
    <h2>${escapar(f.nombre)}</h2>
    <dl>
      <div class="dato"><dt>Dirección</dt><dd>${escapar(f.direccion)}</dd></div>
      <div class="dato"><dt>Comuna</dt><dd>${escapar(f.comuna)}</dd></div>
      <div class="dato"><dt>Horario de turno</dt><dd>${escapar(f.apertura)} a ${escapar(f.cierre)}</dd></div>
      ${f.telefono ? `<div class="dato"><dt>Teléfono</dt><dd>${escapar(f.telefono)}</dd></div>` : ''}
      ${dist}${sinCoord}
      <div class="dato"><dt>Fuente</dt><dd>MINSAL</dd></div>
    </dl>
    <div class="det-acciones">
      ${f.telefono ? `<a class="btn" href="tel:${escapar(f.telefono)}">Llamar</a>` : ''}
      <a class="btn" target="_blank" rel="noopener" href="${
        f.lat != null
          ? `https://www.google.com/maps/dir/?api=1&destination=${f.lat.toFixed(5)},${f.lon.toFixed(5)}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.direccion + ', ' + f.comuna + ', Chile')}`
      }">Cómo llegar</a>
    </div>`;
  $('#detalle').showModal();
}

/* ---------- arranque ---------- */

function iniciarFarmacias() {
  if (farm.iniciado) return;
  farm.iniciado = true;
  restaurarCacheFarm();
  traerFarmacias();
  setInterval(() => {
    if (!document.hidden && estado.vista === 'farmacias') traerFarmacias();
  }, FARM_REFRESCO_MS);
}

registrarSeccion('farmacias', {
  usaMapa: false,          // a escala de país una farmacia es un punto inútil
  iniciar: iniciarFarmacias,
  pintar: pintarFarmacias,
  abrirFicha: abrirFichaFarm,
  refrescar: traerFarmacias
});

document.addEventListener('DOMContentLoaded', () => {
  $('#f-comuna').addEventListener('change', e => { farm.comuna = e.target.value; pintarFarmacias(); });
  $('#f-abiertas').addEventListener('change', e => { farm.soloAbiertas = e.target.checked; pintarFarmacias(); });
});
