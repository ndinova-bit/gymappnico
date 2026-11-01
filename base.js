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
const ONCONFLICT = { peso: "user_id,fecha", notas_ejercicio: "user_id,ejercicio" };

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
const esquemaOK = { v10: null, notas: null };

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
function e1rm(kg, reps) { return reps === 1 ? kg : kg * (1 + reps / 30); }
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

// Tipo de serie: el elegido o, si no hay, el que corresponde por repeticiones.
const TIPOS = ["fuerza", "hipertrofia", "resistencia"];
function tipoDe(x) {
  if (x.tipo_serie) return x.tipo_serie;
  return x.reps <= 5 ? "fuerza" : x.reps <= 12 ? "hipertrofia" : "resistencia";
}
// Las series de calentamiento no cuentan para récords, 1RM, volumen ni progresión.
const esTrabajo = x => x.marca !== "calentamiento";
const trab = s => s.series.filter(esTrabajo);
const sesionActual = () => db.sesiones.find(s => s.id === sesionActualId) || null;
const sesionesConSeries = () => db.sesiones.filter(s => s.series.length);

// Vibración corta al tocar (solo en celulares que la soportan).
function haptico(ms = 12) { try { navigator.vibrate?.(ms); } catch (e) {} }

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
