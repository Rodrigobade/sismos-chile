/* app.js — Sismos Chile
   Fuentes: Centro Sismológico Nacional (vía api.gael.cloud) y USGS.
   Sin publicidad, sin rastreo, sin backend propio. */

'use strict';

const CSN_URL  = 'https://api.gael.cloud/general/public/sismos';
const USGS_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const TZ = 'America/Santiago';
const REFRESCO_MS = 120000;          // 2 min
const CACHE_KEY = 'sismos-chile:v1';
const PREF_KEY  = 'sismos-chile:prefs';

/* ---------- estado ---------- */

const estado = {
  sismos: [],
  actualizado: null,
  cargando: false,
  error: null,
  vistos: new Set(),        // ids ya notificados
  posicion: null,           // [lat, lon] del usuario, si lo autoriza
  prefs: cargarPrefs()
};

function cargarPrefs() {
  const base = { magMin: 0, dias: 7, umbralAviso: 5.0, avisos: false, tema: 'auto' };
  try { return Object.assign(base, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
  catch { return base; }
}

function guardarPrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(estado.prefs)); } catch {}
}

/* ---------- tiempo ---------- */

/* Desfase de una zona horaria respecto a UTC, en ms, para un instante dado.
   Evita hardcodear el horario de verano chileno. */
function desfaseTZ(tz, utcMs) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs));
  const p = {};
  for (const x of partes) p[x.type] = x.value;
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return comoUTC - utcMs;
}

/* "2026-08-25 16:31:14" en hora de Chile -> epoch ms UTC. */
function horaChileAEpoch(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(texto || '');
  if (!m) return NaN;
  const [, Y, M, D, h, mi, s] = m.map(Number);
  const ingenuo = Date.UTC(Y, M - 1, D, h, mi, s);
  // Dos pasadas: la primera estimación basta salvo justo en el cambio de hora.
  let utc = ingenuo - desfaseTZ(TZ, ingenuo);
  utc = ingenuo - desfaseTZ(TZ, utc);
  return utc;
}

const fmtHora = new Intl.DateTimeFormat('es-CL', {
  timeZone: TZ, day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false
});

function horaLocal(ms) {
  return fmtHora.format(new Date(ms)).replace('.', '');
}

function haceCuanto(ms) {
  const seg = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seg < 60) return 'recién';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const dias = Math.round(hrs / 24);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
}

/* ---------- geografía ---------- */

const R_TIERRA = 6371;

function normalizar(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const RUMBOS = {
  n: 0, nne: 22.5, ne: 45, ene: 67.5, e: 90, ese: 112.5, se: 135, sse: 157.5,
  s: 180, sso: 202.5, ssw: 202.5, so: 225, sw: 225, oso: 247.5, wsw: 247.5,
  o: 270, w: 270, ono: 292.5, wnw: 292.5, no: 315, nw: 315, nno: 337.5, nnw: 337.5
};

/* Punto a `km` de (lat, lon) siguiendo el rumbo `grados`. */
function destino(lat, lon, km, grados) {
  const d = km / R_TIERRA;
  const t = grados * Math.PI / 180;
  const f1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(
    Math.sin(t) * Math.sin(d) * Math.cos(f1),
    Math.cos(d) - Math.sin(f1) * Math.sin(f2)
  );
  return [f2 * 180 / Math.PI, ((l2 * 180 / Math.PI + 540) % 360) - 180];
}

/* Estima el epicentro desde "49 km al SE de Socaire". Devuelve null si no
   reconoce la localidad — preferimos no inventar una posición. */
function estimarDesdeReferencia(ref) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*km\s+al\s+([A-Za-zÑñ]{1,3})\s+de\s+(.+)$/i.exec(ref || '');
  if (!m) {
    const base = LOCALIDADES[normalizar(ref)];
    return base ? { lat: base[0], lon: base[1] } : null;
  }
  const km = parseFloat(m[1].replace(',', '.'));
  const rumbo = RUMBOS[normalizar(m[2])];
  const base = LOCALIDADES[normalizar(m[3])];
  if (base == null || rumbo == null) return null;
  const [lat, lon] = destino(base[0], base[1], km, rumbo);
  return { lat, lon };
}

function distanciaKm(a, b) {
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLon = (b[1] - a[1]) * Math.PI / 180;
  const la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R_TIERRA * Math.asin(Math.sqrt(h)));
}

/* ---------- datos ---------- */

async function traerCSN() {
  const r = await fetch(CSN_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error('CSN ' + r.status);
  const crudo = await r.json();
  return crudo.map(s => {
    const t = horaChileAEpoch(s.Fecha);
    const pos = estimarDesdeReferencia(s.RefGeografica);
    return {
      id: 'csn:' + t + ':' + s.Magnitud,
      t,
      mag: parseFloat(s.Magnitud),
      prof: parseFloat(s.Profundidad),
      lugar: s.RefGeografica,
      lat: pos ? pos.lat : null,
      lon: pos ? pos.lon : null,
      exacto: false,
      fuente: 'CSN'
    };
  }).filter(s => Number.isFinite(s.t) && Number.isFinite(s.mag));
}

/* USGS entrega las referencias en inglés ("41 km ESE of Tinogasta, Argentina").
   Las pasamos al español para que la lista se lea toda igual. */
const RUMBOS_EN = {
  N: 'N', NNE: 'NNE', NE: 'NE', ENE: 'ENE', E: 'E', ESE: 'ESE', SE: 'SE', SSE: 'SSE',
  S: 'S', SSW: 'SSO', SW: 'SO', WSW: 'OSO', W: 'O', WNW: 'ONO', NW: 'NO', NNW: 'NNO'
};

function traducirLugar(p) {
  if (!p) return '';
  let m = /^(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i.exec(p);
  if (m) return `${m[1]} km al ${RUMBOS_EN[m[2].toUpperCase()] || m[2]} de ${m[3]}`;
  m = /^offshore\s+(.+)$/i.exec(p);
  if (m) return `Frente a la costa de ${m[1]}`;
  m = /^(.+?)\s+region$/i.exec(p);
  if (m) return `Región de ${m[1]}`;
  m = /^near\s+(.+)$/i.exec(p);
  if (m) return `Cerca de ${m[1]}`;
  return p;
}

async function traerUSGS(dias) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    format: 'geojson', starttime: desde,
    minlatitude: '-57', maxlatitude: '-17',
    minlongitude: '-76', maxlongitude: '-66',
    minmagnitude: '2.5', orderby: 'time', limit: '500'
  });
  const r = await fetch(`${USGS_URL}?${q}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('USGS ' + r.status);
  const g = await r.json();
  return g.features.map(f => ({
    id: 'usgs:' + f.id,
    t: f.properties.time,
    mag: f.properties.mag,
    prof: Math.round(f.geometry.coordinates[2]),
    lugar: traducirLugar(f.properties.place),
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    exacto: true,
    fuente: 'USGS'
  })).filter(s => Number.isFinite(s.t) && Number.isFinite(s.mag));
}

/* El CSN manda para Chile; de USGS tomamos las coordenadas cuando el mismo
   sismo aparece en ambos, y agregamos los que el CSN todavía no publica. */
function fusionar(csn, usgs) {
  const usadas = new Set();
  const salida = csn.map(s => {
    let mejor = null, mejorDt = Infinity;
    usgs.forEach((u, i) => {
      if (usadas.has(i)) return;
      const dt = Math.abs(u.t - s.t);
      if (dt <= 90000 && Math.abs(u.mag - s.mag) <= 0.8 && dt < mejorDt) {
        mejor = i; mejorDt = dt;
      }
    });
    if (mejor === null) return s;
    usadas.add(mejor);
    const u = usgs[mejor];
    return Object.assign({}, s, { lat: u.lat, lon: u.lon, exacto: true, tambienUSGS: true });
  });

  usgs.forEach((u, i) => { if (!usadas.has(i)) salida.push(u); });
  salida.sort((a, b) => b.t - a.t);
  return salida;
}

async function actualizar({ silencioso = false } = {}) {
  if (estado.cargando) return;
  estado.cargando = true;
  if (!silencioso) pintarEstado();

  const dias = estado.prefs.dias;
  const [rc, ru] = await Promise.allSettled([traerCSN(), traerUSGS(dias)]);
  const csn  = rc.status === 'fulfilled' ? rc.value : [];
  const usgs = ru.status === 'fulfilled' ? ru.value : [];

  estado.cargando = false;

  if (!csn.length && !usgs.length) {
    estado.error = navigator.onLine
      ? 'No se pudo consultar ninguna fuente.'
      : 'Sin conexión. Mostrando los últimos datos guardados.';
    if (!estado.sismos.length) restaurarCache();
    pintar();
    return;
  }

  estado.error = (rc.status === 'rejected' || ru.status === 'rejected')
    ? 'Una de las dos fuentes no respondió; los datos pueden estar incompletos.'
    : null;

  const previos = new Set(estado.sismos.map(s => s.id));
  estado.sismos = fusionar(csn, usgs);
  estado.actualizado = Date.now();
  guardarCache();

  if (previos.size) avisarNuevos(estado.sismos.filter(s => !previos.has(s.id)));
  pintar();
}

function guardarCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      t: estado.actualizado, sismos: estado.sismos.slice(0, 200)
    }));
  } catch {}
}

function restaurarCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && Array.isArray(c.sismos)) { estado.sismos = c.sismos; estado.actualizado = c.t; }
  } catch {}
}

/* ---------- avisos ---------- */

function avisarNuevos(nuevos) {
  if (!estado.prefs.avisos || Notification.permission !== 'granted') return;
  const fuertes = nuevos.filter(s => s.mag >= estado.prefs.umbralAviso && !estado.vistos.has(s.id));
  for (const s of fuertes.slice(0, 3)) {
    estado.vistos.add(s.id);
    new Notification(`Sismo ${s.mag.toFixed(1)}`, {
      body: `${s.lugar} · ${s.prof} km de profundidad · ${horaLocal(s.t)}`,
      tag: s.id
    });
  }
}

async function pedirAvisos(activar) {
  if (!activar) { estado.prefs.avisos = false; guardarPrefs(); return; }
  if (!('Notification' in window)) { alert('Este navegador no soporta avisos.'); return false; }
  let permiso = Notification.permission;
  if (permiso === 'default') permiso = await Notification.requestPermission();
  estado.prefs.avisos = permiso === 'granted';
  guardarPrefs();
  return estado.prefs.avisos;
}

/* ---------- presentación ---------- */

/* Escala de color por magnitud. Los cortes siguen la percepción real:
   <3 casi imperceptible, 3-4 se siente, 4-5 se siente claro, 5-6 puede dañar,
   6+ destructivo. */
function nivel(mag) {
  if (mag < 3)   return { clase: 'n1', texto: 'Leve' };
  if (mag < 4)   return { clase: 'n2', texto: 'Menor' };
  if (mag < 5)   return { clase: 'n3', texto: 'Moderado' };
  if (mag < 6)   return { clase: 'n4', texto: 'Fuerte' };
  if (mag < 7)   return { clase: 'n5', texto: 'Mayor' };
  return { clase: 'n6', texto: 'Severo' };
}

function nombrePeriodo() {
  return { 1: 'las últimas 24 horas', 3: 'los últimos 3 días',
           7: 'la última semana', 30: 'el último mes' }[estado.prefs.dias]
         || `los últimos ${estado.prefs.dias} días`;
}

function filtrados() {
  const corte = Date.now() - estado.prefs.dias * 86400000;
  return estado.sismos.filter(s => s.mag >= estado.prefs.magMin && s.t >= corte);
}

const $ = sel => document.querySelector(sel);

function pintar() {
  pintarEstado();
  const lista = filtrados();
  pintarResumen(lista);
  pintarLista(lista);
  pintarMapa(lista);
}

function pintarEstado() {
  const el = $('#estado');
  if (estado.cargando && !estado.sismos.length) { el.textContent = 'Consultando…'; el.className = 'estado'; return; }
  if (estado.error) { el.textContent = estado.error; el.className = 'estado alerta'; return; }
  el.textContent = estado.actualizado
    ? `Actualizado ${haceCuanto(estado.actualizado)} · CSN + USGS`
    : '';
  el.className = 'estado';
}

function pintarResumen(lista) {
  const ultimo = lista[0];
  const cont = $('#resumen');
  if (!ultimo) { cont.innerHTML = '<p class="vacio">No hay sismos con estos filtros.</p>'; return; }
  const n = nivel(ultimo.mag);
  const dist = estado.posicion && ultimo.lat != null
    ? `<span class="dist">a ${distanciaKm(estado.posicion, [ultimo.lat, ultimo.lon])} km de ti</span>` : '';
  cont.innerHTML = `
    <button class="ultimo ${n.clase}" data-id="${ultimo.id}">
      <span class="ultimo-etq">Último sismo</span>
      <span class="ultimo-mag">${ultimo.mag.toFixed(1)}</span>
      <span class="ultimo-lugar">${escapar(ultimo.lugar)}</span>
      <span class="ultimo-meta">${haceCuanto(ultimo.t)} · ${ultimo.prof} km de profundidad ${dist}</span>
    </button>
    <p class="conteo">${lista.length === 1 ? '1 sismo' : lista.length + ' sismos'} en ${nombrePeriodo()}</p>`;
}

function pintarLista(lista) {
  const cont = $('#lista');
  if (!lista.length) { cont.innerHTML = ''; return; }
  cont.innerHTML = lista.map(s => {
    const n = nivel(s.mag);
    const dist = estado.posicion && s.lat != null
      ? ` · a ${distanciaKm(estado.posicion, [s.lat, s.lon])} km` : '';
    return `
      <button class="fila" data-id="${s.id}">
        <span class="mag ${n.clase}">${s.mag.toFixed(1)}</span>
        <span class="fila-txt">
          <span class="lugar">${escapar(s.lugar)}</span>
          <span class="meta">${horaLocal(s.t)} · ${s.prof} km${dist}${
            s.fuente === 'USGS' ? ' · <span class="badge">USGS</span>' : ''}</span>
        </span>
        <span class="hace">${haceCuanto(s.t)}</span>
      </button>`;
  }).join('');
}

function escapar(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- mapa ---------- */

/* Proyección equirectangular con corrección por latitud media: para un país
   angosto y largo es suficiente y no necesita librerías. */
const MAPA = { lonMin: -76.5, lonMax: -66, latMin: -56.5, latMax: -17 };
const COS_LAT = Math.cos(-36 * Math.PI / 180);

/* Chile mide 4300 km de largo por 180 de ancho: a escala real queda una cinta
   de pocos píxeles en un teléfono. Estiramos el eje este-oeste para que el país
   llene la pantalla. Es un mapa de ubicación, no cartográfico. */
const EXAGERA = 3;

const ANCHO = (MAPA.lonMax - MAPA.lonMin) * COS_LAT * 10 * EXAGERA;
const ALTO  = (MAPA.latMax - MAPA.latMin) * 10;

const proj = (lat, lon) => [
  (lon - MAPA.lonMin) * COS_LAT * 10 * EXAGERA,
  (MAPA.latMax - lat) * 10
];

const vista = { x: 0, y: 0, w: ANCHO, h: ALTO };
let vistaFijada = false;   // true una vez que el usuario mueve el mapa

/* Chile es muy angosto y muy largo: si mostramos el país entero en una
   pantalla de teléfono queda una franja diminuta al centro. Por eso el mapa
   abre encuadrado en la zona donde efectivamente hubo sismos. */
function aspectoMapa() {
  const r = $('#mapa').getBoundingClientRect();
  return r.width && r.height ? r.width / r.height : 0.55;
}

function aplicarVista() {
  $('#mapa').setAttribute('viewBox', `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
}

/* Ajusta ancho/alto al aspecto real del elemento y centra en (cx, cy). */
function encuadrar(cx, cy, w, h) {
  const a = aspectoMapa();
  if (w / h < a) w = h * a; else h = w / a;
  vista.w = w; vista.h = h;
  vista.x = cx - w / 2; vista.y = cy - h / 2;
  limitarVista();
  aplicarVista();
}

function vistaPais() {
  encuadrar(ANCHO / 2, ALTO / 2, ANCHO, ALTO);
}

function vistaDatos(lista) {
  const pts = lista.filter(s => s.lat != null).map(s => proj(s.lat, s.lon));
  if (pts.length < 2) { vistaPais(); return; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padX = Math.max(8, (x1 - x0) * 0.2);
  const padY = Math.max(8, (y1 - y0) * 0.12);
  encuadrar((x0 + x1) / 2, (y0 + y1) / 2,
            (x1 - x0) + 2 * padX, (y1 - y0) + 2 * padY);
}

/* Mantiene el centro del encuadre dentro del país, sin impedir alejarse. */
function limitarVista() {
  const cx = vista.x + vista.w / 2, cy = vista.y + vista.h / 2;
  vista.x += Math.min(Math.max(cx, 0), ANCHO) - cx;
  vista.y += Math.min(Math.max(cy, 0), ALTO) - cy;
}

function ruta(puntos, cerrar) {
  return puntos.map((p, i) => {
    const [x, y] = proj(p[1], p[0]);
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ') + (cerrar ? ' Z' : '');
}

function pintarMapa(lista) {
  const svg = $('#mapa');
  const conPos = lista.filter(s => s.lat != null && s.lon != null);

  const puntos = conPos.slice().reverse().map(s => {
    const [x, y] = proj(s.lat, s.lon);
    const r = Math.max(2, (s.mag - 1) * 1.4);
    const n = nivel(s.mag);
    const clase = 'pt ' + n.clase + (s.exacto ? '' : ' estimado');
    return `<circle class="${clase}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" data-id="${s.id}"><title>${escapar(s.mag.toFixed(1) + ' — ' + s.lugar)}</title></circle>`;
  }).join('');

  const ciudades = MAPA_CIUDADES.map(([nombre, lat, lon]) => {
    const [x, y] = proj(lat, lon);
    return `<circle class="ciudad" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2"/>
            <text class="etq" x="${(x + 5).toFixed(1)}" y="${(y + 2.6).toFixed(1)}">${nombre}</text>`;
  }).join('');

  const yo = estado.posicion ? (() => {
    const [x, y] = proj(estado.posicion[0], estado.posicion[1]);
    return `<circle class="yo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`;
  })() : '';

  svg.innerHTML = `
    <path class="tierra" d="${ruta(CHILE_OUTLINE, true)}"/>
    <path class="tierra" d="${ruta(CHILOE_OUTLINE, true)}"/>
    ${ciudades}${puntos}${yo}`;

  if (vistaFijada) aplicarVista(); else vistaPais();
}

/* Zoom y desplazamiento manipulando el viewBox: sin librerías y sin tiles. */
function conectarMapa() {
  const svg = $('#mapa');
  let arrastre = null, pinza = null;

  const escalaPantalla = () => vista.w / svg.getBoundingClientRect().width;

  function zoom(factor, cx, cy) {
    const nuevoW = Math.min(ANCHO * 3, Math.max(ANCHO / 40, vista.w * factor));
    const k = nuevoW / vista.w;
    vista.x = cx - (cx - vista.x) * k;
    vista.y = cy - (cy - vista.y) * k;
    vista.w = nuevoW;
    vista.h = vista.h * k;
    vistaFijada = true;
    limitarVista();
    aplicarVista();
  }

  function desplazar(dx, dy) {
    vista.x -= dx; vista.y -= dy;
    vistaFijada = true;
    limitarVista();
    aplicarVista();
  }

  function aSVG(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return [
      vista.x + (clientX - r.left) / r.width * vista.w,
      vista.y + (clientY - r.top) / r.height * vista.h
    ];
  }

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const [cx, cy] = aSVG(e.clientX, e.clientY);
    zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, cx, cy);
  }, { passive: false });

  svg.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinza = separacion(e.touches);
      arrastre = null;
    } else if (e.touches.length === 1) {
      arrastre = { x: e.touches[0].clientX, y: e.touches[0].clientY, movido: false };
    }
  }, { passive: true });

  svg.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinza) {
      e.preventDefault();
      const d = separacion(e.touches);
      const [cx, cy] = aSVG(
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2
      );
      zoom(pinza / d, cx, cy);
      pinza = d;
    } else if (e.touches.length === 1 && arrastre) {
      e.preventDefault();
      const k = escalaPantalla();
      desplazar((e.touches[0].clientX - arrastre.x) * k, (e.touches[0].clientY - arrastre.y) * k);
      arrastre.x = e.touches[0].clientX;
      arrastre.y = e.touches[0].clientY;
      arrastre.movido = true;
    }
  }, { passive: false });

  svg.addEventListener('touchend', () => { pinza = null; arrastre = null; }, { passive: true });

  svg.addEventListener('mousedown', e => {
    arrastre = { x: e.clientX, y: e.clientY, movido: false };
  });
  window.addEventListener('mousemove', e => {
    if (!arrastre) return;
    const k = escalaPantalla();
    desplazar((e.clientX - arrastre.x) * k, (e.clientY - arrastre.y) * k);
    arrastre.x = e.clientX; arrastre.y = e.clientY; arrastre.movido = true;
  });
  let arrastroRecien = false;
  window.addEventListener('mouseup', () => {
    arrastroRecien = !!(arrastre && arrastre.movido);
    arrastre = null;
  });

  // Un arrastre sobre el mapa no debe abrir la ficha del sismo que quedó debajo.
  svg.addEventListener('click', e => {
    if (arrastroRecien) { arrastroRecien = false; return; }
    const c = e.target.closest('circle.pt');
    if (c) abrirDetalle(c.dataset.id);
  });

  $('#zoom-mas').addEventListener('click', () => zoom(1 / 1.4, vista.x + vista.w / 2, vista.y + vista.h / 2));
  $('#zoom-menos').addEventListener('click', () => zoom(1.4, vista.x + vista.w / 2, vista.y + vista.h / 2));
  // Alterna entre el país completo y un encuadre ceñido a los sismos visibles.
  let ceñido = false;
  $('#zoom-reset').addEventListener('click', () => {
    vistaFijada = true;
    ceñido = !ceñido;
    if (ceñido) vistaDatos(filtrados()); else vistaPais();
  });

  // Al girar el teléfono cambia el aspecto: reencuadramos sin perder el centro.
  let reajuste;
  window.addEventListener('resize', () => {
    clearTimeout(reajuste);
    reajuste = setTimeout(() => {
      encuadrar(vista.x + vista.w / 2, vista.y + vista.h / 2, vista.w, vista.h);
    }, 150);
  });
}

function separacion(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

/* ---------- detalle ---------- */

function abrirDetalle(id) {
  const s = estado.sismos.find(x => x.id === id);
  if (!s) return;
  const n = nivel(s.mag);
  const dist = estado.posicion && s.lat != null
    ? `<div class="dato"><dt>Distancia desde ti</dt><dd>${distanciaKm(estado.posicion, [s.lat, s.lon])} km</dd></div>` : '';
  const coords = s.lat != null
    ? `<div class="dato"><dt>Coordenadas</dt><dd>${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}${s.exacto ? '' : ' <em>(estimadas)</em>'}</dd></div>` : '';

  $('#detalle-cuerpo').innerHTML = `
    <div class="det-cab ${n.clase}">
      <span class="det-mag">${s.mag.toFixed(1)}</span>
      <span class="det-nivel">${n.texto}</span>
    </div>
    <h2>${escapar(s.lugar)}</h2>
    <dl>
      <div class="dato"><dt>Hora local</dt><dd>${horaLocal(s.t)} (${haceCuanto(s.t)})</dd></div>
      <div class="dato"><dt>Profundidad</dt><dd>${s.prof} km</dd></div>
      ${coords}${dist}
      <div class="dato"><dt>Fuente</dt><dd>${s.fuente}${s.tambienUSGS ? ' + USGS' : ''}</dd></div>
    </dl>
    <div class="det-acciones">
      <button id="compartir" class="btn">Compartir</button>
      ${s.lat != null ? `<a class="btn" target="_blank" rel="noopener"
         href="https://www.google.com/maps?q=${s.lat.toFixed(4)},${s.lon.toFixed(4)}">Ver en mapa</a>` : ''}
    </div>`;

  const dlg = $('#detalle');
  dlg.showModal();
  const btn = $('#compartir');
  if (btn) btn.addEventListener('click', () => compartir(s));
}

async function compartir(s) {
  const texto = `Sismo ${s.mag.toFixed(1)} — ${s.lugar}\n${horaLocal(s.t)} · ${s.prof} km de profundidad\nFuente: ${s.fuente}`;
  if (navigator.share) { try { await navigator.share({ text: texto }); return; } catch {} }
  try { await navigator.clipboard.writeText(texto); $('#compartir').textContent = 'Copiado'; } catch {}
}

/* ---------- ubicación ---------- */

function pedirUbicacion() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    p => { estado.posicion = [p.coords.latitude, p.coords.longitude]; pintar(); },
    () => { $('#estado').textContent = 'No se pudo obtener tu ubicación.'; },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
}

/* ---------- tema ---------- */

function aplicarTema() {
  const t = estado.prefs.tema;
  document.documentElement.dataset.tema = t === 'auto' ? '' : t;
  if (t === 'auto') delete document.documentElement.dataset.tema;
}

/* ---------- arranque ---------- */

function conectarControles() {
  const magMin = $('#f-mag'), dias = $('#f-dias'), umbral = $('#f-umbral'), avisos = $('#f-avisos');

  magMin.value = estado.prefs.magMin;
  dias.value = estado.prefs.dias;
  umbral.value = estado.prefs.umbralAviso;
  avisos.checked = estado.prefs.avisos;

  $('#f-mag-val').textContent = magMin.value === '0' ? 'todas' : '≥ ' + (+magMin.value).toFixed(1);
  $('#f-umbral-val').textContent = '≥ ' + (+umbral.value).toFixed(1);

  magMin.addEventListener('input', () => {
    estado.prefs.magMin = +magMin.value;
    $('#f-mag-val').textContent = magMin.value === '0' ? 'todas' : '≥ ' + (+magMin.value).toFixed(1);
    guardarPrefs(); pintar();
  });

  dias.addEventListener('change', () => {
    estado.prefs.dias = +dias.value;
    guardarPrefs(); actualizar();
  });

  umbral.addEventListener('input', () => {
    estado.prefs.umbralAviso = +umbral.value;
    $('#f-umbral-val').textContent = '≥ ' + (+umbral.value).toFixed(1);
    guardarPrefs();
  });

  avisos.addEventListener('change', async () => {
    const ok = await pedirAvisos(avisos.checked);
    avisos.checked = !!ok && estado.prefs.avisos;
  });

  $('#btn-refrescar').addEventListener('click', () => actualizar());
  $('#btn-ubicacion').addEventListener('click', pedirUbicacion);
  $('#btn-ajustes').addEventListener('click', () => $('#ajustes').showModal());
  $('#btn-tema').addEventListener('click', () => {
    const orden = ['auto', 'light', 'dark'];
    estado.prefs.tema = orden[(orden.indexOf(estado.prefs.tema) + 1) % 3];
    guardarPrefs(); aplicarTema();
  });

  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    const cerrar = d.querySelector('.cerrar');
    if (cerrar) cerrar.addEventListener('click', () => d.close());
  });

  document.body.addEventListener('click', e => {
    const f = e.target.closest('.fila, .ultimo');
    if (f) abrirDetalle(f.dataset.id);
  });
}

function iniciar() {
  aplicarTema();
  restaurarCache();
  conectarControles();
  conectarMapa();
  if (estado.sismos.length) pintar();
  actualizar();

  setInterval(() => { if (!document.hidden) actualizar({ silencioso: true }); }, REFRESCO_MS);
  setInterval(() => { if (!document.hidden) pintar(); }, 60000);   // refresca los "hace X"
  document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizar({ silencioso: true }); });
  window.addEventListener('online', () => actualizar());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
