// ============================================================
// base.js — configuración, estado compartido y utilidades.
// Los archivos .js se cargan en orden desde index.html y comparten
// las variables globales: base → almacen → sync → auth → descanso →
// sesion → rutinas → progreso → datos → app.
// ============================================================

// ---------- Configuración ----------
const SUPABASE_URL = "https://wgyjzybkugqmggrybqia.supabase.co";
const SUPABASE_KEY = "sb_publishable_T59BVTQY4QQ99-ZIUIJg5A_cxt1skFI";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const K_META = "gymapp_meta", K_BORRADOR = "gymapp_borrador";
// Para peso la clave de conflicto es (usuario, fecha); para notas, (usuario, ejercicio); para el resto, el id.
const ONCONFLICT = { peso: "user_id,fecha", notas_ejercicio: "user_id,ejercicio", preferencias: "user_id" };

// ---------- Estado ----------
function DB_VACIA() { return { rutinas: [], sesiones: [], peso: [], ejercicios: [], notas: [] }; }
let user = null;
let db = DB_VACIA();
let cola = [];            // cambios pendientes de subir, en orden
let ajustes = Object.assign({ meta: null, dias: 3, offline: false, hitos: [], hitosInit: false, calmo: true, descanso: 90, avisos: false }, leerJSON(K_META, {}));
let rangoPeso = 30;       // días del gráfico de peso (0 = todo)
let sesionActualId = null;
let modoRecuperacion = false;
let cuenta = null;        // fila de la tabla cuentas: aprobado, es_admin, nombre
let cargandoCuenta = false;
let sincronizando = false;
let ultimoError = "";
const charts = {};
// Columnas nuevas de la migración v10. null = todavía no se comprobó.
const esquemaOK = { v10: null, notas: null, prefs: null };

// ---------- Utilidades ----------
const $ = id => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const num = v => parseFloat(String(v).replace(",", "."));
const fmt = (n, d = 1) => (n === null || n === undefined || isNaN(n)) ? "—" : Number(n).toFixed(d);
const fmtKg = n => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(".", ",");
const r25 = k => Math.round(k / 2.5) * 2.5;
function hoy() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
// e1rm() y las reglas de clasificación viven en logica.js (se cargan antes que este archivo).
function leerJSON(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch (e) { return def; } }
const DIA_MS = 864e5;
const promedio = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const fmtTiempo = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const mmss = s => s === null ? "—" : fmtTiempo(Math.round(s));
const pad = n => String(n).padStart(2, "0");
const fechaISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lunesDe = f => { const d = new Date(f + "T00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fechaISO(d); };
const sumarDias = (f, n) => { const d = new Date(f + "T00:00"); d.setDate(d.getDate() + n); return fechaISO(d); };
const diasEntre = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / DIA_MS);

// ---------- Tipo de serie: fuerza / hipertrofia / resistencia ----------
// Criterio (Schoenfeld 2017 y 2021; Robinson/Refalo 2023-24):
//  - La fuerza máxima se gana con cargas altas: 1 a 5 repeticiones.
//  - La hipertrofia se logra en un rango amplio de cargas (de 6 a 30+ repeticiones) si las series
//    terminan cerca del fallo (0 a 3 repeticiones en reserva, o sea RPE 7 a 10).
//  - Por eso el RPE NO convierte una serie de muchas repeticiones en «fuerza»: un RPE 10 con 12 repeticiones
//    es hipertrofia. El RPE solo decide en las series muy largas (16 o más): cerca del fallo (RPE 8+) siguen
//    siendo hipertrofia; lejos del fallo o sin RPE, son resistencia muscular.
//  - La carga también cuenta: 6 a 8 repeticiones con el 85 % o más de tu mejor 1RM de fuerza es fuerza.
const TIPOS = ["fuerza", "hipertrofia", "resistencia"];

// Mejor 1RM de fuerza por ejercicio (solo series de 1 a 5 repeticiones, sin calentamientos).
// Se calcula una vez por tanda de dibujo y se descarta enseguida, así siempre está al día.
let _refFuerza = null;
function refFuerza(ej) {
  if (!_refFuerza) {
    _refFuerza = {};
    try {
      db.sesiones.forEach(s => s.series.forEach(x => {
        if (x.marca === "calentamiento" || !(x.reps >= 1 && x.reps <= 5) || !(x.kg > 0)) return;
        const v = e1rm(x.kg, x.reps, x.rpe);
        if (v > (_refFuerza[x.ejercicio] || 0)) _refFuerza[x.ejercicio] = v;
      }));
    } catch (e) {}
    setTimeout(() => { _refFuerza = null; }, 0);
  }
  return _refFuerza[ej] || 0;
}

// Clasifica una serie a partir de repeticiones, carga y esfuerzo (la regla está en logica.js).
function clasificarSerie(x) {
  return clasificarSerieBase(x, x.ejercicio ? refFuerza(x.ejercicio) : 0);
}

// Tipo de una serie ya guardada. No se modifica nada en la base:
//  - Si el tipo guardado difiere de la regla vieja (solo por repeticiones), lo eligió la persona (o lo
//    clasificó esta regla al guardar) y se respeta tal cual.
//  - Si coincide con la regla vieja, se vuelve a leer con la regla nueva (repeticiones + carga + esfuerzo).
function tipoDe(x) {
  if (x.tipo_serie && x.tipo_serie !== tipoViejo(x.reps)) return x.tipo_serie;
  return clasificarSerie(x);
}
// Nombre corto para mostrar.
const ETQ_TIPO = { fuerza: "Fuerza", hipertrofia: "Hipertrofia", resistencia: "Resistencia" };
// Las series de calentamiento no cuentan para récords, 1RM, volumen ni progresión.
const esTrabajo = x => x.marca !== "calentamiento";
const trab = s => s.series.filter(esTrabajo);
const sesionActual = () => db.sesiones.find(s => s.id === sesionActualId) || null;
const sesionesConSeries = () => db.sesiones.filter(s => s.series.length);

// Vibración corta al tocar (solo en celulares que la soportan).
function haptico(ms = 12) { try { navigator.vibrate?.(ms); } catch (e) {} }

// ---------- Paneles (reemplazan a alert, confirm y prompt) ----------
// Hoja que sube desde abajo. Todas devuelven una promesa: hay que usar await.
let _panelRes = null, _panelFoco = null, _panelBotones = [];
function cerrarPanel(valor) {
  $("panel").classList.add("hidden");
  document.body.classList.remove("con-panel");
  const r = _panelRes;
  _panelRes = null;
  if (r) r(typeof valor === "function" ? valor() : valor);
  try { _panelFoco?.focus?.(); } catch (e) {}
}
function mostrarPanel({ titulo, cuerpo, botones }) {
  if (_panelRes) cerrarPanel(null);
  _panelOpciones = null;
  return new Promise(res => {
    _panelRes = res;
    _panelFoco = document.activeElement;
    _panelBotones = botones;
    $("panel-tit").textContent = titulo || "";
    $("panel-cuerpo").innerHTML = cuerpo || "";
    $("panel-botones").innerHTML = botones.map((b, i) => `<button class="btn ${b.clase || "sec"}" data-i="${i}">${esc(b.texto)}</button>`).join("");
    $("panel").classList.remove("hidden");
    document.body.classList.add("con-panel");
    const primero = $("panel-cuerpo").querySelector("input, select, textarea");
    setTimeout(() => (primero || $("panel-botones").lastElementChild)?.focus(), 40);
  });
}
$("panel-botones").onclick = e => {
  const b = e.target.closest("button[data-i]");
  if (b) cerrarPanel(_panelBotones[+b.dataset.i].valor);
};
$("panel").querySelector(".panel-fondo").onclick = () => cerrarPanel(null);
document.addEventListener("keydown", e => {
  if ($("panel").classList.contains("hidden")) return;
  if (e.key === "Escape") cerrarPanel(null);
  if (e.key === "Enter" && e.target.matches("#panel-cuerpo input")) { e.preventDefault(); $("panel-botones").lastElementChild?.click(); }
});
// Los botones de elección única (como el RPE) dentro de un panel.
$("panel-cuerpo").addEventListener("click", e => {
  const c = e.target.closest(".pf-chips button[data-v]");
  if (!c) return;
  const grupo = c.parentElement;
  const ya = c.classList.contains("on");
  grupo.querySelectorAll("button").forEach(x => x.classList.remove("on"));
  if (!ya) c.classList.add("on");
  grupo.dataset.v = ya ? "" : c.dataset.v;
  haptico(8);
});

const textoHTML = t => esc(t).replace(/\n/g, "<br>");
function avisar(texto, titulo = "Atención") {
  return mostrarPanel({ titulo, cuerpo: `<p class="panel-txt">${textoHTML(texto)}</p>`, botones: [{ texto: "Entendido", valor: true, clase: "cy" }] });
}
async function confirmar(texto, { titulo = "¿Seguro?", ok = "Aceptar", peligro = false } = {}) {
  const r = await mostrarPanel({
    titulo, cuerpo: `<p class="panel-txt">${textoHTML(texto)}</p>`,
    botones: [{ texto: "Cancelar", valor: false }, { texto: ok, valor: true, clase: peligro ? "peligro" : "cy" }]
  });
  return r === true;
}
// Formulario corto. campos: [{ id, label, valor, tipo: "texto" | "numero" | "area" | "lista" | "chips", opciones, ayuda }]
// Devuelve un objeto { id: valor } o null si se cancela.
function pedirDatos({ titulo, texto, campos, ok = "Guardar" }) {
  const html = campos.map(c => {
    const id = "pf-" + c.id, v = c.valor ?? "";
    let campo;
    if (c.tipo === "area") campo = `<textarea id="${id}" rows="3" maxlength="${c.max || 300}">${esc(v)}</textarea>`;
    else if (c.tipo === "lista") campo = `<select id="${id}">${c.opciones.map(o => { const [ov, ot] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}"${String(ov) === String(v) ? " selected" : ""}>${esc(ot)}</option>`; }).join("")}</select>`;
    else if (c.tipo === "chips") campo = `<div id="${id}" class="chips pf-chips" data-v="${esc(v)}">${c.opciones.map(o => `<button type="button" class="chip${String(o) === String(v) ? " on" : ""}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
    else campo = `<input id="${id}" type="text" inputmode="${c.tipo === "numero" ? "decimal" : "text"}" value="${esc(v)}" autocomplete="off"${c.max ? ` maxlength="${c.max}"` : ""}>`;
    return `<div class="pf"><label for="${id}">${esc(c.label)}</label>${campo}${c.ayuda ? `<small class="mut">${esc(c.ayuda)}</small>` : ""}</div>`;
  }).join("");
  const leer = () => Object.fromEntries(campos.map(c => {
    const el = $("pf-" + c.id);
    return [c.id, c.tipo === "chips" ? (el.dataset.v ?? "") : el.value];
  }));
  return mostrarPanel({
    titulo, cuerpo: (texto ? `<p class="panel-txt">${textoHTML(texto)}</p>` : "") + html,
    botones: [{ texto: "Cancelar", valor: null }, { texto: ok, valor: leer, clase: "cy" }]
  });
}
// Lista de opciones para elegir una. opciones: [{ valor, texto, detalle }]. Devuelve el valor o null.
function elegirOpcion({ titulo, texto, opciones }) {
  const p = mostrarPanel({
    titulo,
    cuerpo: (texto ? `<p class="panel-txt">${textoHTML(texto)}</p>` : "") +
      `<div class="panel-lista">${opciones.map((o, i) => `<button class="panel-op" data-op="${i}"><b>${esc(o.texto)}</b>${o.detalle ? `<span class="mut">${esc(o.detalle)}</span>` : ""}</button>`).join("")}</div>`,
    botones: [{ texto: "Cancelar", valor: null }]
  });
  _panelOpciones = opciones;   // después de mostrarPanel, que limpia las opciones anteriores
  return p;
}
// Los botones de elegirOpcion cierran el panel con el valor de la opción.
$("panel-cuerpo").addEventListener("click", e => {
  const b = e.target.closest(".panel-op");
  if (!b || !_panelOpciones) return;
  cerrarPanel(_panelOpciones[+b.dataset.op].valor);
});
let _panelOpciones = null;

// ---------- Avisos ----------
function toast(texto) {
  const t = $("toast");
  t.textContent = texto;
  t.classList.add("ver");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("ver"), 2800);
}

// Deshacer: el borrado se aplica en pantalla al instante y se sube recién
// cuando pasan 5 segundos sin tocar "Deshacer".
let pendienteBorrar = null;
function conDeshacer(texto, confirmar, revertir) {
  confirmarPendiente();
  pendienteBorrar = { confirmar, revertir };
  $("deshacer-txt").textContent = texto;
  $("deshacer").classList.add("ver");
  clearTimeout(conDeshacer.t);
  conDeshacer.t = setTimeout(confirmarPendiente, 5000);
}
function confirmarPendiente() {
  clearTimeout(conDeshacer.t);
  $("deshacer").classList.remove("ver");
  if (!pendienteBorrar) return;
  const c = pendienteBorrar.confirmar;
  pendienteBorrar = null;
  c();
}
$("deshacer-btn").onclick = () => {
  clearTimeout(conDeshacer.t);
  $("deshacer").classList.remove("ver");
  if (!pendienteBorrar) return;
  const r = pendienteBorrar.revertir;
  pendienteBorrar = null;
  r();
  haptico(20);
  guardarTodo();
  renderTodo();
  toast("Listo, quedó como estaba");
};
window.addEventListener("pagehide", confirmarPendiente);
document.addEventListener("visibilitychange", () => { if (document.hidden) confirmarPendiente(); });

// ---------- Gráficos ----------
const NEON = { cyan: "#00f0ff", mag: "#ff2bd6", lime: "#b6ff3b", sun: "#ffe600", vio: "#8b5cf6", red: "#ff3b6b" };
Chart.defaults.color = "#7f8bb0";
Chart.defaults.borderColor = "rgba(0,240,255,.08)";
Chart.defaults.font.family = "'Trebuchet MS', system-ui, sans-serif";
Chart.defaults.plugins.tooltip.backgroundColor = "rgba(8,10,22,.95)";
Chart.defaults.plugins.tooltip.borderColor = NEON.cyan;
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.titleColor = NEON.cyan;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;

function dibujar(id, config) {
  if (charts[id]) charts[id].destroy();
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, animation: { duration: 700 } }, config.options || {});
  charts[id] = new Chart($(id), config);
}
function degradado(hex) {
  return (c) => {
    const { ctx, chartArea } = c.chart;
    if (!chartArea) return hex + "33";
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, hex + "66");
    g.addColorStop(1, hex + "00");
    return g;
  };
}

// ---------- Catálogo ----------
const GRUPOS = ["Pecho", "Espalda", "Hombros", "Piernas", "Glúteos", "Brazos", "Core", "Cardio", "Otro"];
function catalogo() {
  return (db.ejercicios || []).slice().sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nombre.localeCompare(b.nombre));
}
function metDe(nombre) {
  const x = (db.ejercicios || []).find(e => e.nombre === nombre);
  return x ? Number(x.met) : 5;
}
const grupoDe = nombre => { const x = (db.ejercicios || []).find(e => e.nombre === nombre); return x ? x.grupo : "Otro"; };
function ejerciciosConocidos() {
  const set = new Set();
  db.sesiones.forEach(s => s.series.forEach(x => set.add(x.ejercicio)));
  db.rutinas.forEach(r => r.ejercicios.forEach(e => set.add(e)));
  (db.ejercicios || []).forEach(x => set.add(x.nombre));
  return [...set].sort();
}

// Bloques de la planilla con el menú "Más" abierto (solo en pantallas chicas).
const masAbiertos = new Set();
