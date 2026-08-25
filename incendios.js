/* incendios.js — focos de calor detectados por satélite.
   Fuente: NASA FIRMS (VIIRS y MODIS, near real-time).

   No consulta a FIRMS directamente: FIRMS no manda cabeceras CORS y su llave
   no puede quedar expuesta en un repositorio público. Un flujo de GitHub
   Actions hace la consulta cada tres horas y deja `incendios.json` junto a la
   app; acá solo se lee ese archivo, desde el mismo origen.

   Un foco de calor NO es un incendio confirmado: el satélite detecta calor, y
   eso puede ser una quema agrícola, una faena industrial o un reflejo. La
   sección lo dice en pantalla en vez de alarmar. */

'use strict';

/* Módulo aislado en su propio ámbito. Son scripts clásicos, no módulos ES:
   sin este envoltorio dos archivos que declaren una función con el mismo
   nombre se pisan en el ámbito global, y el que carga último gana. */
(function () {

const INCENDIOS_URL = 'incendios.json';
const FUEGO_CACHE = 'sismos-chile:incendios:v1';
const FUEGO_REFRESCO_MS = 1800000;   // 30 min

const fuego = {
  focos: [],
  generado: null,
  actualizado: null,
  cargando: false,
  error: null,
  iniciado: false,
  sinDatos: false,
  horas: 24
};

/* La potencia radiativa (FRP, en megawatts) es lo más cercano a "qué tan
   grande es". Los cortes son los que usa la propia NASA para describir focos. */
function nivelFuego(frp) {
  if (frp >= 100) return { clase: 'n6', texto: 'Muy intenso', orden: 4 };
  if (frp >= 50)  return { clase: 'n5', texto: 'Intenso', orden: 3 };
  if (frp >= 20)  return { clase: 'n4', texto: 'Moderado', orden: 2 };
  if (frp >= 5)   return { clase: 'n3', texto: 'Bajo', orden: 1 };
  return { clase: 'n2', texto: 'Muy bajo', orden: 0 };
}

/* FIRMS entrega fecha y hora en UTC: "2026-08-25" + "1436". */
function epochDe(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.fecha || '');
  if (!m) return NaN;
  const h = String(f.hora || '0000').padStart(4, '0');
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +h.slice(0, 2), +h.slice(2));
}

async function traerIncendios() {
  if (fuego.cargando) return;
  fuego.cargando = true;
  pintarEstadoFuego();

  try {
    const r = await fetch(INCENDIOS_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 404) {
      fuego.sinDatos = true;
      fuego.error = null;
    } else if (!r.ok) {
      throw new Error('incendios ' + r.status);
    } else {
      const d = await r.json();
      fuego.focos = (d.focos || []).map(f => Object.assign({}, f, {
        t: epochDe(f),
        id: 'fuego:' + f.lat + ',' + f.lon + ',' + f.fecha + f.hora
      })).filter(f => Number.isFinite(f.t));
      fuego.generado = Date.parse(d.generado) || null;
      fuego.actualizado = Date.now();
      fuego.sinDatos = false;
      fuego.error = null;
      try {
        localStorage.setItem(FUEGO_CACHE, JSON.stringify({
          t: fuego.actualizado, generado: fuego.generado, focos: fuego.focos
        }));
      } catch {}
    }
  } catch {
    fuego.error = navigator.onLine
      ? 'No se pudo leer el archivo de focos.'
      : 'Sin conexión. Mostrando los últimos focos guardados.';
  }

  fuego.cargando = false;
  if (estado.vista === 'incendios') pintarIncendios();
}

function restaurarCacheFuego() {
  try {
    const c = JSON.parse(localStorage.getItem(FUEGO_CACHE) || 'null');
    if (c && Array.isArray(c.focos)) {
      fuego.focos = c.focos;
      fuego.generado = c.generado;
      fuego.actualizado = c.t;
    }
  } catch {}
}

/* ---------- vista ---------- */

function focosFiltrados() {
  const corte = Date.now() - fuego.horas * 3600000;
  return fuego.focos
    .filter(f => f.t >= corte)
    .map(f => Object.assign({}, f, {
      nivel: nivelFuego(f.frp),
      dist: estado.posicion ? distanciaKm(estado.posicion, [f.lat, f.lon]) : null
    }))
    .sort((a, b) => b.frp - a.frp || b.t - a.t);
}

function pintarEstadoFuego() {
  const el = $('#estado');
  if (fuego.cargando && !fuego.focos.length) {
    el.textContent = 'Leyendo focos…'; el.className = 'estado'; return;
  }
  if (fuego.error) { el.textContent = fuego.error; el.className = 'estado alerta'; return; }
  // Si el archivo no existe pero quedaron focos guardados, mostrarlos y decir
  // que son viejos es más útil que dejar la pantalla en blanco.
  if (fuego.sinDatos) {
    el.textContent = fuego.focos.length
      ? 'El archivo de focos no está disponible; esto es lo último guardado.'
      : 'Los focos todavía no se han generado.';
    el.className = 'estado alerta'; return;
  }
  el.textContent = fuego.generado
    ? `Satélite consultado ${haceCuanto(fuego.generado)} · NASA FIRMS`
    : '';
  el.className = 'estado';
}

function pintarIncendios() {
  pintarEstadoFuego();
  const lista = focosFiltrados();
  pintarResumenFuego(lista);
  pintarListaFuego(lista);
  pintarLeyendaFuego();
  pintarMapa(lista.slice().reverse().map(f => ({
    lat: f.lat, lon: f.lon,
    r: 2 + f.nivel.orden * 1.1,
    clase: f.nivel.clase,
    id: f.id,
    titulo: `${f.frp} MW — ${f.nivel.texto}`
  })));
  $('#creditos').innerHTML =
    'Focos de calor de <strong>NASA FIRMS</strong> (VIIRS y MODIS). ' +
    'Un foco de calor <strong>no es un incendio confirmado</strong>: puede ser ' +
    'una quema agrícola o una faena. La información oficial de incendios ' +
    'forestales la entrega <strong>CONAF</strong>.';
}

function pintarResumenFuego(lista) {
  const cont = $('#resumen');
  if (fuego.sinDatos && !fuego.focos.length) {
    cont.innerHTML = '<p class="vacio">Todavía no se ha generado el archivo de focos. ' +
      'Se actualiza solo cada tres horas.</p>';
    return;
  }
  if (!lista.length) {
    cont.innerHTML = '<p class="vacio">Sin focos de calor detectados en este periodo. ' +
      'Es lo normal fuera de temporada de incendios.</p>';
    return;
  }

  const f = lista[0];
  const dist = f.dist != null ? ` · a ${f.dist} km de ti` : '';
  cont.innerHTML = `
    <button class="ultimo ${f.nivel.clase}" data-id="${escapar(f.id)}">
      <span class="ultimo-etq">Foco más intenso</span>
      <span class="ultimo-mag">${f.frp}</span>
      <span class="ultimo-lugar">${f.nivel.texto} · ${f.frp} MW</span>
      <span class="ultimo-meta">${escapar(horaLocal(f.t))} · ${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}${dist}</span>
    </button>
    <p class="conteo">${lista.length === 1 ? '1 foco detectado' : lista.length + ' focos detectados'} en ${
      fuego.horas === 24 ? 'las últimas 24 horas' : 'las últimas ' + fuego.horas + ' horas'}</p>
    <p class="conteo nota">Un foco de calor es calor visto desde el satélite, no un
       incendio confirmado. Puede ser una quema agrícola o una faena industrial.</p>`;
}

function pintarListaFuego(lista) {
  $('#lista-incendios').innerHTML = lista.map(f => {
    const derecha = f.dist != null ? `${f.dist} km` : haceCuanto(f.t);
    return `
      <button class="fila" data-id="${escapar(f.id)}">
        <span class="mag ${f.nivel.clase}">${f.frp}</span>
        <span class="fila-txt">
          <span class="lugar">${f.nivel.texto} · ${f.frp} MW</span>
          <span class="meta">${escapar(horaLocal(f.t))} · ${f.lat.toFixed(3)}, ${f.lon.toFixed(3)} · confianza ${escapar(f.conf)}</span>
        </span>
        <span class="hace">${escapar(derecha)}</span>
      </button>`;
  }).join('');
}

function pintarLeyendaFuego() {
  $('#leyenda').innerHTML = [
    ['n2', '&lt;5 MW'], ['n3', '5–20'], ['n4', '20–50'], ['n5', '50–100'], ['n6', '100+']
  ].map(([c, t]) => `<li><i class="${c}"></i>${t}</li>`).join('');
}

function abrirFichaFuego(id) {
  const f = fuego.focos.find(x => x.id === id);
  if (!f) return;
  const n = nivelFuego(f.frp);
  const dist = estado.posicion
    ? `<div class="dato"><dt>Distancia desde ti</dt><dd>${distanciaKm(estado.posicion, [f.lat, f.lon])} km</dd></div>` : '';

  $('#detalle-cuerpo').innerHTML = `
    <div class="det-cab ${n.clase}">
      <span class="det-mag">${f.frp}</span>
      <span class="det-nivel">${n.texto}</span>
    </div>
    <h2>Foco de calor</h2>
    <dl>
      <div class="dato"><dt>Potencia radiativa</dt><dd>${f.frp} MW</dd></div>
      <div class="dato"><dt>Detectado</dt><dd>${escapar(horaLocal(f.t))} (${haceCuanto(f.t)})</dd></div>
      <div class="dato"><dt>Coordenadas</dt><dd>${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}</dd></div>
      <div class="dato"><dt>Confianza</dt><dd>${escapar(f.conf)}</dd></div>
      <div class="dato"><dt>Momento</dt><dd>${f.noche ? 'de noche' : 'de día'}</dd></div>
      ${dist}
      <div class="dato"><dt>Satélite</dt><dd>${escapar(f.sat)} · NASA FIRMS</dd></div>
    </dl>
    <p class="fina">Esto es calor detectado desde órbita, no un incendio confirmado.
       Ante una emergencia, CONAF atiende el <strong>130</strong>.</p>
    <div class="det-acciones">
      <a class="btn" target="_blank" rel="noopener"
         href="https://www.google.com/maps?q=${f.lat.toFixed(4)},${f.lon.toFixed(4)}">Ver en mapa</a>
    </div>`;
  $('#detalle').showModal();
}

/* ---------- arranque ---------- */

function iniciarIncendios() {
  if (!fuego.iniciado) {
    fuego.iniciado = true;
    restaurarCacheFuego();
    setInterval(() => {
      if (!document.hidden && estado.vista === 'incendios') traerIncendios();
    }, FUEGO_REFRESCO_MS);
  }
  traerIncendios();
}

registrarSeccion('incendios', {
  usaMapa: true,
  iniciar: iniciarIncendios,
  pintar: pintarIncendios,
  abrirFicha: abrirFichaFuego,
  refrescar: traerIncendios
});

document.addEventListener('DOMContentLoaded', () => {
  $('#f-horas').addEventListener('change', e => {
    fuego.horas = +e.target.value;
    pintarIncendios();
  });
});

})();
