/* clima.js — tiempo actual y pronóstico a 7 días.
   Fuente: Open-Meteo (modelo numérico, sin llave ni registro).

   Es un modelo, no una estación ni un aviso oficial. Los avisos y alertas
   meteorológicas oficiales los emite la Dirección Meteorológica de Chile,
   y esta sección lo dice en pantalla en vez de simular autoridad. */

'use strict';

const CLIMA_URL = 'https://api.open-meteo.com/v1/forecast';
const CLIMA_CACHE = 'sismos-chile:clima:v1';
const CLIMA_REFRESCO_MS = 900000;   // 15 min

/* Ciudades de referencia, al menos una por región. */
const CIUDADES = [
  ['Arica', -18.478, -70.313], ['Iquique', -20.213, -70.152],
  ['Calama', -22.454, -68.929], ['Antofagasta', -23.650, -70.400],
  ['Copiapó', -27.366, -70.332], ['Vallenar', -28.576, -70.759],
  ['La Serena', -29.907, -71.253], ['Ovalle', -30.601, -71.199],
  ['Illapel', -31.633, -71.166], ['Los Andes', -32.834, -70.598],
  ['Valparaíso', -33.047, -71.612], ['Viña del Mar', -33.024, -71.552],
  ['San Antonio', -33.593, -71.607], ['Santiago', -33.459, -70.645],
  ['Rancagua', -34.170, -70.744], ['San Fernando', -34.586, -70.989],
  ['Pichilemu', -34.388, -72.001], ['Curicó', -34.983, -71.239],
  ['Talca', -35.426, -71.655], ['San Javier', -35.594, -71.730],
  ['Linares', -35.846, -71.593], ['Constitución', -35.333, -72.412],
  ['Cauquenes', -35.967, -72.353], ['Parral', -36.143, -71.826],
  ['Chillán', -36.607, -72.103], ['Concepción', -36.827, -73.050],
  ['Los Ángeles', -37.470, -72.354], ['Angol', -37.795, -72.716],
  ['Temuco', -38.736, -72.590], ['Villarrica', -39.286, -72.228],
  ['Valdivia', -39.814, -73.246], ['Osorno', -40.573, -73.135],
  ['Puerto Montt', -41.469, -72.942], ['Castro', -42.482, -73.762],
  ['Coyhaique', -45.572, -72.068], ['Puerto Natales', -51.729, -72.507],
  ['Punta Arenas', -53.163, -70.917], ['Puerto Williams', -54.934, -67.616],
  ['Isla de Pascua', -27.113, -109.350]
];

/* Códigos WMO que devuelve Open-Meteo. */
const TIEMPO = {
  0:  ['Despejado', '☀️'],            1:  ['Mayormente despejado', '🌤️'],
  2:  ['Parcialmente nublado', '⛅'],  3:  ['Nublado', '☁️'],
  45: ['Neblina', '🌫️'],              48: ['Neblina con escarcha', '🌫️'],
  51: ['Llovizna débil', '🌦️'],       53: ['Llovizna', '🌦️'],
  55: ['Llovizna intensa', '🌧️'],     56: ['Llovizna helada', '🌧️'],
  57: ['Llovizna helada intensa', '🌧️'],
  61: ['Lluvia débil', '🌦️'],         63: ['Lluvia', '🌧️'],
  65: ['Lluvia intensa', '🌧️'],       66: ['Lluvia helada', '🌧️'],
  67: ['Lluvia helada intensa', '🌧️'],
  71: ['Nieve débil', '🌨️'],          73: ['Nieve', '🌨️'],
  75: ['Nieve intensa', '❄️'],         77: ['Granos de nieve', '🌨️'],
  80: ['Chubascos débiles', '🌦️'],    81: ['Chubascos', '🌧️'],
  82: ['Chubascos violentos', '⛈️'],   85: ['Chubascos de nieve', '🌨️'],
  86: ['Chubascos de nieve intensos', '❄️'],
  95: ['Tormenta eléctrica', '⛈️'],    96: ['Tormenta con granizo', '⛈️'],
  99: ['Tormenta con granizo fuerte', '⛈️']
};

const describir = c => TIEMPO[c] || ['—', '·'];

const clima = {
  datos: null,
  lugar: null,          // { nombre, lat, lon }
  actualizado: null,
  cargando: false,
  error: null,
  iniciado: false
};

function lugarGuardado() {
  const guardado = estado.prefs.ciudad;
  const hit = CIUDADES.find(c => c[0] === guardado);
  const [nombre, lat, lon] = hit || CIUDADES.find(c => c[0] === 'Talca');
  return { nombre, lat, lon };
}

async function traerClima() {
  if (clima.cargando || !clima.lugar) return;
  clima.cargando = true;
  pintarEstadoClima();

  const q = new URLSearchParams({
    latitude: clima.lugar.lat.toFixed(4),
    longitude: clima.lugar.lon.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    forecast_days: '7',
    timezone: TZ
  });

  try {
    const r = await fetch(`${CLIMA_URL}?${q}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Open-Meteo ' + r.status);
    clima.datos = await r.json();
    clima.actualizado = Date.now();
    clima.error = null;
    try {
      localStorage.setItem(CLIMA_CACHE, JSON.stringify({
        t: clima.actualizado, lugar: clima.lugar, datos: clima.datos
      }));
    } catch {}
  } catch {
    clima.error = navigator.onLine
      ? 'No se pudo consultar el pronóstico.'
      : 'Sin conexión. Mostrando el último pronóstico guardado.';
  }

  clima.cargando = false;
  if (estado.vista === 'clima') pintarClima();
}

function restaurarCacheClima() {
  try {
    const c = JSON.parse(localStorage.getItem(CLIMA_CACHE) || 'null');
    if (c && c.datos) { clima.datos = c.datos; clima.lugar = c.lugar; clima.actualizado = c.t; }
  } catch {}
}

/* ---------- vista ---------- */

function pintarEstadoClima() {
  const el = $('#estado');
  if (clima.cargando && !clima.datos) {
    el.textContent = 'Consultando el pronóstico…'; el.className = 'estado'; return;
  }
  if (clima.error) { el.textContent = clima.error; el.className = 'estado alerta'; return; }
  el.textContent = clima.actualizado
    ? `Actualizado ${haceCuanto(clima.actualizado)} · Open-Meteo (modelo)`
    : '';
  el.className = 'estado';
}

/* Días que merecen una advertencia. Umbrales conservadores y explicados,
   para no gritar por cualquier chubasco. */
function avisosDe(daily) {
  const avisos = [];
  for (let i = 0; i < daily.time.length; i++) {
    const cod = daily.weather_code[i];
    const viento = daily.wind_speed_10m_max[i];
    const lluvia = daily.precipitation_sum[i];
    const motivos = [];
    if (cod >= 95) motivos.push('tormenta eléctrica');
    if (cod === 82) motivos.push('chubascos violentos');
    if (viento >= 60) motivos.push(`viento de ${Math.round(viento)} km/h`);
    if (lluvia >= 25) motivos.push(`${Math.round(lluvia)} mm de agua`);
    if (motivos.length) avisos.push({ i, dia: daily.time[i], motivos });
  }
  return avisos;
}

const fmtDia = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, weekday: 'short', day: 'numeric' });

function nombreDia(iso, i) {
  if (i === 0) return 'Hoy';
  if (i === 1) return 'Mañana';
  const [Y, M, D] = iso.split('-').map(Number);
  return fmtDia.format(new Date(Date.UTC(Y, M - 1, D, 12))).replace('.', '');
}

function pintarClima() {
  pintarEstadoClima();
  llenarCiudades();

  if (!clima.datos) { $('#resumen').innerHTML = ''; $('#lista-clima').innerHTML = ''; return; }

  const c = clima.datos.current, d = clima.datos.daily;
  const [texto, icono] = describir(c.weather_code);

  $('#resumen').innerHTML = `
    <div class="clima-ahora">
      <div class="clima-cab">
        <span class="clima-icono">${icono}</span>
        <div>
          <span class="clima-temp">${Math.round(c.temperature_2m)}°</span>
          <span class="clima-cond">${escapar(texto)}</span>
        </div>
        <span class="clima-lugar">${escapar(clima.lugar.nombre)}</span>
      </div>
      <div class="clima-datos">
        ${celda('Sensación', Math.round(c.apparent_temperature) + '°')}
        ${celda('Humedad', c.relative_humidity_2m + '%')}
        ${celda('Viento', Math.round(c.wind_speed_10m) + ' km/h')}
        ${celda('Ráfagas', Math.round(c.wind_gusts_10m) + ' km/h')}
        ${celda('Máx. hoy', Math.round(d.temperature_2m_max[0]) + '°')}
        ${celda('Mín. hoy', Math.round(d.temperature_2m_min[0]) + '°')}
      </div>
    </div>`;

  const avisos = avisosDe(d);
  const bloqueAvisos = avisos.length ? `
    <div class="avisos">
      <strong>Atención en los próximos días</strong>
      <ul>${avisos.map(a =>
        `<li>${escapar(nombreDia(a.dia, a.i))}: ${escapar(a.motivos.join(', '))}</li>`).join('')}</ul>
      <p class="fina">Esto sale de un modelo numérico, no es un aviso oficial.
         Los avisos, alertas y alarmas meteorológicas los emite la
         <strong>Dirección Meteorológica de Chile</strong>.</p>
    </div>` : '';

  $('#lista-clima').innerHTML = bloqueAvisos + '<div class="pronostico">' +
    d.time.map((iso, i) => {
      const [t2, ic] = describir(d.weather_code[i]);
      const prob = d.precipitation_probability_max[i];
      return `
        <div class="dia">
          <span class="dia-nombre">${escapar(nombreDia(iso, i))}</span>
          <span class="dia-icono" title="${escapar(t2)}">${ic}</span>
          <span class="dia-lluvia">${prob != null ? prob + '%' : ''}</span>
          <span class="dia-temps"><b>${Math.round(d.temperature_2m_max[i])}°</b>
            <span>${Math.round(d.temperature_2m_min[i])}°</span></span>
        </div>`;
    }).join('') + '</div>';

  $('#creditos').innerHTML =
    'Pronóstico de <strong>Open-Meteo</strong>, un modelo numérico global. ' +
    'No reemplaza los avisos oficiales de la <strong>Dirección Meteorológica de Chile</strong>.';
}

function celda(etq, valor) {
  return `<div class="clima-celda"><span class="cv">${escapar(valor)}</span>
          <span class="ce">${escapar(etq)}</span></div>`;
}

function llenarCiudades() {
  const sel = $('#f-ciudad');
  if (!sel.dataset.lleno) {
    sel.innerHTML = CIUDADES.map(([n]) =>
      `<option value="${escapar(n)}">${escapar(n)}</option>`).join('');
    sel.dataset.lleno = '1';
  }
  if (clima.lugar && CIUDADES.some(c => c[0] === clima.lugar.nombre)) {
    sel.value = clima.lugar.nombre;
  }
}

/* La ciudad más cercana a la posición del usuario: evita pedirle que la
   busque en una lista de 39. */
function ciudadMasCercana(pos) {
  let mejor = CIUDADES[0], mejorD = Infinity;
  for (const c of CIUDADES) {
    const d = distanciaKm(pos, [c[1], c[2]]);
    if (d < mejorD) { mejor = c; mejorD = d; }
  }
  return { nombre: mejor[0], lat: mejor[1], lon: mejor[2] };
}

/* ---------- arranque ---------- */

function iniciarClima() {
  if (!clima.iniciado) {
    clima.iniciado = true;
    restaurarCacheClima();
    setInterval(() => {
      if (!document.hidden && estado.vista === 'clima') traerClima();
    }, CLIMA_REFRESCO_MS);
  }
  if (!clima.lugar) {
    clima.lugar = estado.posicion ? ciudadMasCercana(estado.posicion) : lugarGuardado();
  }
  traerClima();
}

registrarSeccion('clima', {
  usaMapa: false,
  iniciar: iniciarClima,
  pintar: pintarClima,
  abrirFicha: () => {},
  refrescar: traerClima
});

document.addEventListener('DOMContentLoaded', () => {
  $('#f-ciudad').addEventListener('change', e => {
    const c = CIUDADES.find(x => x[0] === e.target.value);
    if (!c) return;
    clima.lugar = { nombre: c[0], lat: c[1], lon: c[2] };
    estado.prefs.ciudad = c[0];
    guardarPrefs();
    clima.datos = null;
    traerClima();
  });
});
