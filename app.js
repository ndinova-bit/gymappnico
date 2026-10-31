// ---------- Configuración ----------
const SUPABASE_URL = "https://wgyjzybkugqmggrybqia.supabase.co";
const SUPABASE_KEY = "sb_publishable_T59BVTQY4QQ99-ZIUIJg5A_cxt1skFI";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const K_CACHE = "gymapp_cache", K_COLA = "gymapp_cola", K_META = "gymapp_meta";
// Para peso la clave de conflicto es (usuario, fecha); para el resto, el id.
const ONCONFLICT = { peso: "user_id,fecha" };

// ---------- Estado ----------
function DB_VACIA() { return { rutinas: [], sesiones: [], peso: [], ejercicios: [] }; }
let user = null;
let db = Object.assign(DB_VACIA(), leerJSON(K_CACHE, null));
let cola = leerJSON(K_COLA, []);      // cambios pendientes de subir, en orden
let ajustes = Object.assign({ meta: null, dias: 3, offline: false, hitos: [], hitosInit: false }, leerJSON(K_META, {}));
let rangoPeso = 30;   // días del gráfico de peso (0 = todo)
let sesionActualId = null;
let modoRecuperacion = false;
let cuenta = null;              // fila de la tabla cuentas: aprobado, es_admin, nombre
let cargandoCuenta = false;
let sincronizando = false;
let ultimoError = "";
const charts = {};

// ---------- Utilidades ----------
const $ = id => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const num = v => parseFloat(String(v).replace(",", "."));
const fmt = (n, d = 1) => (n === null || isNaN(n)) ? "—" : Number(n).toFixed(d);
function hoy() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function e1rm(kg, reps) { return reps === 1 ? kg : kg * (1 + reps / 30); }
// Tipo de serie: el elegido o, si no hay, el que corresponde por repeticiones.
const TIPOS = ["fuerza", "hipertrofia", "resistencia"];
function tipoDe(x) {
  if (x.tipo_serie) return x.tipo_serie;
  return x.reps <= 5 ? "fuerza" : x.reps <= 12 ? "hipertrofia" : "resistencia";
}
function leerJSON(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch (e) { return def; } }
function guardarTodo() {
  localStorage.setItem(K_CACHE, JSON.stringify(db));
  localStorage.setItem(K_COLA, JSON.stringify(cola));
  localStorage.setItem(K_META, JSON.stringify(ajustes));
}
const sesionActual = () => db.sesiones.find(s => s.id === sesionActualId) || null;

function toast(texto) {
  const t = $("toast");
  t.textContent = texto;
  t.classList.add("ver");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("ver"), 2800);
}

// Paleta neón para gráficos
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
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, animation: { duration: 900 } }, config.options || {});
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

// ---------- Sincronización ----------
function pintarEstado() {
  const el = $("estado");
  if (!user) return el.classList.add("hidden");
  const sinRed = !navigator.onLine || !!ajustes.offline;
  if (!sinRed && !cola.length && !ultimoError) return el.classList.add("hidden");
  el.classList.remove("hidden");
  if (sinRed) el.textContent = `Sin conexión · ${cola.length} cambio(s) guardados en este celular`;
  else if (cola.length) el.textContent = `Subiendo ${cola.length} cambio(s)…`;
  else el.textContent = ultimoError;
}

function ejecutar(op) {
  const t = sb.from(op.tabla);
  switch (op.t) {
    case "ins": return t.upsert(op.fila, { onConflict: ONCONFLICT[op.tabla] || "id" });
    case "upd": return t.update(op.cambios).eq("id", op.id);
    case "del": return t.delete().eq("id", op.id);
    case "delFecha": return t.delete().eq("fecha", op.fecha);
  }
}

function encolar(op) {
  cola.push(op);
  guardarTodo();
  renderTodo();
  sincronizar();
}

async function sincronizar() {
  pintarEstado();
  if (!user || !cuenta?.aprobado || !navigator.onLine || ajustes.offline || sincronizando) return;
  sincronizando = true;
  try {
    while (cola.length) {
      const { error } = await ejecutar(cola[0]);
      if (error) {
        // Sin "code" suele ser un corte de red: se conserva el cambio y se reintenta después.
        if (!error.code) break;
        // Un error del servidor no debe trabar la cola.
        ultimoError = "Un cambio fue rechazado: " + error.message;
      } else {
        ultimoError = "";
      }
      cola.shift();
      guardarTodo();
      pintarEstado();
    }
    if (!cola.length) await descargar();
  } catch (e) {
    // Sin red: se reintenta más tarde.
  } finally {
    sincronizando = false;
    pintarEstado();
  }
}

async function descargar() {
  const [r, s, p, e] = await Promise.all([
    sb.from("rutinas").select("id,nombre,ejercicios,created_at").order("created_at"),
    sb.from("sesiones").select("id,fecha,series(id,ejercicio,reps,kg,rpe,descanso_seg,tipo_serie,created_at)").order("fecha"),
    sb.from("peso").select("fecha,kg").order("fecha"),
    sb.from("ejercicios").select("id,user_id,nombre,grupo,tipo,met").order("nombre")
  ]);
  for (const res of [r, s, p, e]) if (res.error) throw res.error;
  // Si mientras bajaba hubo cambios locales nuevos, no se pisan: se suben primero.
  if (cola.length) return;
  s.data.forEach(ses => ses.series.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  db = { rutinas: r.data, sesiones: s.data, peso: p.data, ejercicios: e.data };
  guardarTodo();
  renderTodo();
}

window.addEventListener("online", sincronizar);
window.addEventListener("offline", pintarEstado);
setInterval(sincronizar, 30000);

// ---------- Login ----------
$("auth-entrar").onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $("auth-email").value.trim(), password: $("auth-pass").value });
  if (error) $("auth-msg").textContent = "No se pudo entrar: " + error.message;
};
$("auth-crear").onclick = async () => {
  const { error } = await sb.auth.signUp({
    email: $("auth-email").value.trim(),
    password: $("auth-pass").value,
    options: { data: { nombre: $("auth-nombre").value.trim() } }
  });
  $("auth-msg").textContent = error
    ? "No se pudo crear la cuenta: " + error.message
    : "Cuenta creada. Si pide confirmación, revisá tu correo. Después esperá que te aprueben.";
};
$("auth-olvide").onclick = async () => {
  const email = $("auth-email").value.trim();
  if (!email) { $("auth-msg").textContent = "Escribí tu correo primero."; return; }
  // Vuelve a esta misma página; ahí se abre la pantalla de nueva contraseña.
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $("auth-msg").textContent = error
    ? "No se pudo enviar el correo: " + error.message
    : "Te enviamos un correo para cambiar la contraseña. Revisá también spam.";
};
$("nueva-guardar").onclick = async () => {
  const p = $("nueva-pass").value;
  if (p.length < 6) { $("nueva-msg").textContent = "Mínimo 6 caracteres."; return; }
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) { $("nueva-msg").textContent = "No se pudo guardar: " + error.message; return; }
  modoRecuperacion = false;
  history.replaceState(null, "", location.pathname);
  $("nueva-pass").value = "";
  toast("Contraseña actualizada");
  mostrarVista();
  setTimeout(() => { renderTodo(); sincronizar(); }, 0);
};
$("salir").onclick = async () => {
  if (cola.length && !confirm(`Hay ${cola.length} cambio(s) sin subir. Si salís, se pierden. ¿Continuar?`)) return;
  cola = []; db = DB_VACIA(); sesionActualId = null;
  guardarTodo();
  await sb.auth.signOut();
};

function mostrarVista() {
  const recup = modoRecuperacion;
  const aprobado = !!cuenta?.aprobado;
  const logueado = !!user && !recup && !cargandoCuenta && aprobado;
  const pendiente = !!user && !recup && !cargandoCuenta && !aprobado;
  $("nueva").classList.toggle("hidden", !recup);
  $("auth").classList.toggle("hidden", recup || !!user);
  $("pendiente").classList.toggle("hidden", !pendiente);
  $("app").classList.toggle("hidden", !logueado);
  $("tabs").classList.toggle("hidden", !logueado);
  $("salir").classList.toggle("hidden", !user || recup);
}

async function cargarCuenta() {
  const { data, error } = await sb.from("cuentas")
    .select("id,correo,nombre,aprobado,es_admin").eq("id", user.id).maybeSingle();
  cuenta = error ? null : data;
}

sb.auth.onAuthStateChange((event, session) => {
  // El enlace del correo de recuperación dispara este evento.
  if (event === "PASSWORD_RECOVERY") modoRecuperacion = true;
  user = session?.user ?? null;
  cuenta = null;
  cargandoCuenta = !!user;
  mostrarVista();
  // Diferido para no hacer consultas dentro del callback de autenticación.
  setTimeout(async () => {
    if (user) await cargarCuenta();
    cargandoCuenta = false;
    mostrarVista();
    renderTodo();
    sincronizar();
  }, 0);
});

$("pend-reintentar").onclick = async () => {
  cargandoCuenta = true;
  mostrarVista();
  await cargarCuenta();
  cargandoCuenta = false;
  mostrarVista();
  renderTodo();
  sincronizar();
};

// ---------- Navegación ----------
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#tabs button").forEach(x => { x.classList.remove("on"); x.removeAttribute("aria-current"); });
  b.classList.add("on");
  b.setAttribute("aria-current", "page");
  document.querySelectorAll("#app > section").forEach(s => s.classList.add("hidden"));
  $("vista-" + b.dataset.tab).classList.remove("hidden");
  window.scrollTo(0, 0);
  if (b.dataset.tab === "progreso") renderProgreso();
  if (b.dataset.tab === "peso") renderPeso();
  if (b.dataset.tab === "datos") renderAdmin();
});

// ---------- Descanso ----------
// El último descanso medido se guarda en la próxima serie que agregues.
let descansoPendiente = null;
let rsInicio = null, rsId = null, tmId = null, tmFin = null, audioCtx = null;
const fmtTiempo = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

$("rs-toggle").onclick = () => {
  if (rsId) {
    clearInterval(rsId); rsId = null;
    descansoPendiente = Math.round((Date.now() - rsInicio) / 1000);
    $("rs-toggle").textContent = "Iniciar";
    $("rs-info").textContent = "último descanso: " + fmtTiempo(descansoPendiente);
    toast("Descanso registrado · " + fmtTiempo(descansoPendiente));
    renderPasos();
    return;
  }
  rsInicio = Date.now();
  $("rs-toggle").textContent = "Detener";
  abrirModo("cron");
  rsId = setInterval(() => $("rs-cron").textContent = fmtTiempo(Math.floor((Date.now() - rsInicio) / 1000)), 250);
};
$("rs-reset").onclick = () => {
  clearInterval(rsId); rsId = null; rsInicio = null; descansoPendiente = null;
  renderPasos();
  $("rs-cron").textContent = "0:00";
  $("rs-toggle").textContent = "Iniciar";
  $("rs-info").textContent = "entre series";
};

function avisarFin() {
  try { navigator.vibrate?.([300, 150, 300]); } catch (e) {}
  try {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    o.connect(audioCtx.destination); o.frequency.value = 880;
    o.start(); o.stop(audioCtx.currentTime + 0.6);
  } catch (e) {}
}
$("tm-iniciar").onclick = () => {
  const seg = parseInt($("tm-seg").value);
  if (!seg || seg < 1) return alert("Poné una cantidad de segundos.");
  // Se crea el audio dentro del toque para que el celular lo permita después.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {}
  clearInterval(tmId);
  $("tm-cron").classList.remove("fin");
  tmFin = Date.now() + seg * 1000;
  tmTotal = seg;
  abrirModo("tm");
  const tick = () => {
    const resta = Math.ceil((tmFin - Date.now()) / 1000);
    if (resta <= 0) {
      clearInterval(tmId); tmId = null;
      $("tm-estado").textContent = "¡Terminó el descanso!";
      $("tm-cron").textContent = "0:00";
      $("tm-cron").classList.add("fin");
      avisarFin();
      return;
    }
    $("tm-estado").textContent = "Quedan " + fmtTiempo(resta);
    $("tm-cron").textContent = fmtTiempo(resta);
  };
  tick();
  tmId = setInterval(tick, 250);
};
$("tm-cancelar").onclick = () => {
  clearInterval(tmId); tmId = null;
  $("tm-estado").textContent = "Temporizador cancelado.";
  $("tm-cron").textContent = "--:--";
  tmFin = null;
  $("tm-cron").classList.remove("fin");
};

// ---------- Modo descanso a pantalla completa ----------
const CIRC = 2 * Math.PI * 98;
const modoEl = $("modo");
let modoTipo = null;       // "cron" | "tm" | null
let tmTotal = 0;           // segundos del último temporizador iniciado
let wakeLock = null;

async function pantallaActiva(on) {
  try {
    if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
function abrirModo(tipo) {
  modoTipo = tipo;
  modoEl.classList.remove("fin");
  $("modo-arco").style.strokeDasharray = CIRC;
  modoEl.classList.remove("hidden");
  pintarModo();
  clearInterval(abrirModo.t);
  abrirModo.t = setInterval(pintarModo, 200);
  pantallaActiva(true);
  try { document.documentElement.requestFullscreen?.(); } catch (e) {}
}
function cerrarModo() {
  clearInterval(abrirModo.t);
  modoEl.classList.add("hidden");
  modoEl.classList.remove("fin");
  modoTipo = null;
  pantallaActiva(false);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
function pintarModo() {
  if (!modoTipo) return;
  const arco = $("modo-arco");
  if (modoTipo === "cron") {
    const corriendo = !!rsId;
    const seg = rsInicio && corriendo ? Math.floor((Date.now() - rsInicio) / 1000) : (descansoPendiente ?? 0);
    $("modo-tipo").textContent = "Cronómetro de descanso";
    $("modo-tiempo").textContent = fmtTiempo(seg);
    // En el cronómetro, el anillo da una vuelta por minuto.
    arco.style.strokeDashoffset = CIRC * (1 - (seg % 60) / 60);
    $("modo-accion").textContent = corriendo ? "Detener" : "Iniciar";
    $("modo-sub").textContent = corriendo
      ? "Tocá Detener cuando quieras arrancar la serie"
      : (descansoPendiente !== null ? "Último descanso: " + fmtTiempo(descansoPendiente) : "Tocá Iniciar para empezar a descansar");
    return;
  }
  // Temporizador
  $("modo-tipo").textContent = "Temporizador";
  const terminado = !tmId && tmFin && Date.now() >= tmFin;
  if (terminado) {
    modoEl.classList.add("fin");
    $("modo-tiempo").textContent = "0:00";
    arco.style.strokeDashoffset = CIRC;
    $("modo-sub").textContent = "¡Listo! Volvé a la serie";
    $("modo-accion").textContent = "Cerrar";
    return;
  }
  modoEl.classList.remove("fin");
  const resta = tmId && tmFin ? Math.max(0, Math.ceil((tmFin - Date.now()) / 1000)) : (parseInt($("tm-seg").value) || 0);
  const total = tmId ? (tmTotal || 1) : Math.max(1, parseInt($("tm-seg").value) || 1);
  $("modo-tiempo").textContent = fmtTiempo(resta);
  arco.style.strokeDashoffset = CIRC * (1 - Math.min(1, resta / total));
  $("modo-accion").textContent = tmId ? "Cancelar" : "Iniciar";
  $("modo-sub").textContent = tmId ? "Quedan " + fmtTiempo(resta) : "Elegí los segundos en la pantalla principal";
}
$("modo-accion").onclick = () => {
  if (modoTipo === "cron") return $("rs-toggle").click();
  if (modoEl.classList.contains("fin")) return cerrarModo();
  if (tmId) return $("tm-cancelar").click();
  $("tm-iniciar").click();
};
$("modo-cerrar").onclick = cerrarModo;

// ---------- Sesión ----------
function ejerciciosConocidos() {
  const set = new Set();
  db.sesiones.forEach(s => s.series.forEach(x => set.add(x.ejercicio)));
  db.rutinas.forEach(r => r.ejercicios.forEach(e => set.add(e)));
  (db.ejercicios || []).forEach(x => set.add(x.nombre));
  return [...set].sort();
}

function refrescarSelects() {
  const sel = $("s-rutina");
  const previa = sel.value;
  sel.innerHTML = '<option value="">Elegí una rutina</option>' + db.rutinas.map(r => `<option value="${r.id}">${esc(r.nombre)}</option>`).join("");
  sel.value = previa;
  $("ej-list").innerHTML = ejerciciosConocidos().map(e => `<option value="${esc(e)}">`).join("");
  if (!$("s-fecha").value) $("s-fecha").value = hoy();
  if (!$("pc-fecha").value) $("pc-fecha").value = hoy();
}

$("s-rutina").onchange = () => {
  const r = db.rutinas.find(x => x.id === $("s-rutina").value);
  $("s-chips").innerHTML = r
    ? r.ejercicios.map(e => `<button class="chip" data-ej="${esc(e)}">${esc(e)}</button>`).join("")
    : "";
};
$("s-chips").onclick = e => {
  const b = e.target.closest("button[data-ej]");
  if (b) { $("s-ej").value = b.dataset.ej; renderObjetivo(); }
};

function asegurarSesion() {
  let ses = sesionActual();
  if (ses) return ses;
  ses = { id: uid(), fecha: $("s-fecha").value || hoy(), series: [] };
  db.sesiones.push(ses);
  sesionActualId = ses.id;
  encolar({ t: "ins", tabla: "sesiones", fila: { id: ses.id, user_id: user.id, fecha: ses.fecha } });
  return ses;
}

// Récord anterior de un ejercicio, sin contar la sesión abierta
function mejorKgPrevio(ej, excluirSesionId) {
  let mejor = 0;
  db.sesiones.forEach(s => {
    if (s.id === excluirSesionId) return;
    s.series.forEach(x => { if (x.ejercicio === ej && x.kg > mejor) mejor = x.kg; });
  });
  return mejor;
}

$("s-agregar").onclick = () => {
  const ej = $("s-ej").value.trim();
  const n = parseInt($("s-series").value) || 1;
  const reps = parseInt($("s-reps").value);
  const kg = num($("s-peso").value) || 0;
  const rpeTxt = $("s-rpe").value.trim();
  const rpe = rpeTxt === "" ? null : num(rpeTxt);
  if (!ej || !reps) return alert("Completá ejercicio y repeticiones.");
  if (reps < 1 || reps > 100) return alert("Las repeticiones tienen que estar entre 1 y 100.");
  if (kg < 0 || kg > 1000) return alert("Los kilos tienen que estar entre 0 y 1000.");
  if (rpe !== null && (isNaN(rpe) || rpe < 1 || rpe > 10)) return alert("El RPE tiene que ser un número del 1 al 10. Si no lo sabés, dejalo vacío.");
  const ses = asegurarSesion();
  const previo = mejorKgPrevio(ej, ses.id);
  const elegido = $("s-tipo").value;
  const tipo = elegido === "auto" ? tipoDe({ reps }) : elegido;
  const filas = [];
  for (let i = 0; i < n; i++) {
    filas.push({ id: uid(), user_id: user.id, sesion_id: ses.id, ejercicio: ej, reps, kg, rpe, descanso_seg: descansoPendiente, tipo_serie: tipo, created_at: new Date().toISOString() });
  }
  ses.series.push(...filas);
  encolar({ t: "ins", tabla: "series", fila: filas.map(({ created_at, ...f }) => f) });
  if (descansoPendiente !== null) {
    descansoPendiente = null;
    $("rs-info").textContent = "entre series";
  }
  $("s-ej").value = "";
  if (kg > 0 && kg > previo) toast(`🔥 Nuevo récord en ${ej}: ${kg} kg`);
  else toast(`+${n} serie${n > 1 ? "s" : ""} · ${ej}`);
  revisarHitos(calcularProgreso());
};

function quitarSesion(id) {
  db.sesiones = db.sesiones.filter(s => s.id !== id);
  if (sesionActualId === id) sesionActualId = null;
  encolar({ t: "del", tabla: "sesiones", id });
}

$("s-cerrar").onclick = () => {
  const ses = sesionActual();
  if (ses && !ses.series.length) quitarSesion(ses.id);
  sesionActualId = null;
  guardarTodo();
  renderTodo();
  toast("Sesión cerrada");
};

function borrarSerie(sesId, serieId) {
  const ses = db.sesiones.find(s => s.id === sesId);
  if (!ses) return;
  ses.series = ses.series.filter(x => x.id !== serieId);
  encolar({ t: "del", tabla: "series", id: serieId });
  if (!ses.series.length) quitarSesion(sesId);
}

function editarSerie(sesId, serieId) {
  const ses = db.sesiones.find(s => s.id === sesId);
  const s = ses?.series.find(x => x.id === serieId);
  if (!s) return;
  const kgNuevo = prompt("Kilos", s.kg);
  if (kgNuevo === null) return;
  const repsNuevas = prompt("Repeticiones", s.reps);
  if (repsNuevas === null) return;
  const tipoNuevo = prompt("Tipo: fuerza, hipertrofia o resistencia", tipoDe(s));
  if (tipoNuevo === null) return;
  s.kg = num(kgNuevo) || 0;
  s.reps = parseInt(repsNuevas) || s.reps;
  const t = tipoNuevo.trim().toLowerCase();
  s.tipo_serie = TIPOS.includes(t) ? t : tipoDe(s);
  encolar({ t: "upd", tabla: "series", id: serieId, cambios: { kg: s.kg, reps: s.reps, tipo_serie: s.tipo_serie } });
}

function cambiarFecha(sesId, fecha) {
  const ses = db.sesiones.find(s => s.id === sesId);
  if (!ses || !fecha) return;
  ses.fecha = fecha;
  db.sesiones.sort((a, b) => a.fecha.localeCompare(b.fecha));
  encolar({ t: "upd", tabla: "sesiones", id: sesId, cambios: { fecha } });
}

function borrarSesionConfirm(id) {
  if (confirm("¿Borrar esta sesión y todas sus series?")) quitarSesion(id);
}

// ---------- Calorías (estimación orientativa) ----------
// Tiempo bajo carga por serie: 45 s de esfuerzo + el descanso registrado (o 90 s si no hay dato).
// Calorías = MET × peso (kg) × horas. No reemplaza una medición.
function pesoRef() { return db.peso.length ? db.peso[db.peso.length - 1].kg : null; }
function estimarSesion(ses) {
  const peso = pesoRef();
  let seg = 0, kcal = 0;
  ses.series.forEach(x => {
    const s = 45 + (x.descanso_seg ?? 90);
    seg += s;
    if (peso) kcal += metDe(x.ejercicio) * peso * (s / 3600);
  });
  return { min: Math.round(seg / 60), kcal: Math.round(kcal), conPeso: !!peso };
}

function renderSesion() {
  const ses = sesionActual();
  $("s-info").textContent = ses ? ses.fecha : "sin sesión abierta";
  renderPasos();
  renderObjetivo();
  if (ses && ses.series.length) {
    const e = estimarSesion(ses);
    $("s-kcal").textContent = e.conPeso
      ? `Estimado: ~${e.kcal} kcal · ~${e.min} min (orientativo)`
      : `Cargá tu peso para estimar calorías · ~${e.min} min`;
  } else {
    $("s-kcal").textContent = "";
  }
  if (!ses) {
    $("s-tabla").innerHTML = `<tr><td colspan="6" class="mut">Agregá una serie para empezar.</td></tr>`;
  } else {
    const grupos = {};
    ses.series.forEach(x => (grupos[x.ejercicio] = grupos[x.ejercicio] || []).push(x));
    $("s-tabla").innerHTML = Object.entries(grupos).map(([ej, arr]) => `
      <tr>
        <td><b>${esc(ej)}</b></td><td>${arr.length}</td>
        <td>${arr.map(x => x.reps).join(", ")}</td>
        <td>${[...new Set(arr.map(x => x.kg))].join(", ")}</td>
        <td>${arr.map(x => x.rpe ?? "-").join(", ")}</td>
        <td><button class="btn sec mini" onclick="borrarSerie('${ses.id}','${arr[arr.length - 1].id}')">−1</button></td>
      </tr>`).join("") || `<tr><td colspan="6" class="mut">Sin series todavía.</td></tr>`;
  }

  const hist = db.sesiones.filter(s => s.id !== sesionActualId && s.series.length).slice(-10).reverse();
  $("s-historial").innerHTML = hist.length ? hist.map(s => {
    const ejs = [...new Set(s.series.map(x => x.ejercicio))].join(", ");
    const vol = s.series.reduce((a, x) => a + x.reps * x.kg, 0);
    return `
      <details class="hist">
        <summary><b>${s.fecha}</b><span class="mut">${esc(ejs)} · ${s.series.length} series · ${Math.round(vol)} kg</span></summary>
        <div class="cuerpo">
          <div class="row">
            <input type="date" value="${s.fecha}" style="max-width:190px" onchange="cambiarFecha('${s.id}', this.value)">
            <button class="btn peligro mini fijo" onclick="borrarSesionConfirm('${s.id}')">Borrar sesión</button>
          </div>
          <table>
            <thead><tr><th>Ejercicio</th><th>Reps</th><th>Kg</th><th>RPE</th><th></th></tr></thead>
            <tbody>${s.series.map(x => `
              <tr>
                <td>${esc(x.ejercicio)}</td><td>${x.reps}</td><td>${x.kg}</td><td>${x.rpe ?? "-"}</td>
                <td style="white-space:nowrap">
                  <button class="btn sec mini" onclick="editarSerie('${s.id}','${x.id}')">Editar</button>
                  <button class="btn peligro mini" onclick="borrarSerie('${s.id}','${x.id}')">×</button>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </details>`;
  }).join("") : '<p class="mut">Todavía no hay sesiones cerradas.</p>';
}

// ---------- Rutinas ----------
// ---------- Catálogo de ejercicios ----------
const GRUPOS = ["Pecho", "Espalda", "Hombros", "Piernas", "Glúteos", "Brazos", "Core", "Cardio", "Otro"];
let rutinaBorrador = [];

function catalogo() {
  return (db.ejercicios || []).slice().sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nombre.localeCompare(b.nombre));
}
function metDe(nombre) {
  const x = (db.ejercicios || []).find(e => e.nombre === nombre);
  return x ? Number(x.met) : 5;
}
function renderPicker() {
  const grupos = {};
  catalogo().forEach(e => (grupos[e.grupo] = grupos[e.grupo] || []).push(e.nombre));
  $("r-picker").innerHTML = Object.entries(grupos).map(([g, nombres]) => `
    <div style="margin-bottom:12px">
      <div class="mut" style="font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${esc(g)}</div>
      <div class="chips">${nombres.map(n => `<button class="chip${rutinaBorrador.includes(n) ? " on" : ""}" data-pick="${esc(n)}">${esc(n)}</button>`).join("")}</div>
    </div>`).join("") || '<p class="mut">Todavía no hay ejercicios en el catálogo.</p>';
  $("r-elegidos").textContent = rutinaBorrador.length ? "Elegidos: " + rutinaBorrador.join(" · ") : "Ninguno elegido todavía.";
}
$("r-picker").onclick = e => {
  const b = e.target.closest("button[data-pick]");
  if (!b) return;
  const n = b.dataset.pick;
  rutinaBorrador = rutinaBorrador.includes(n) ? rutinaBorrador.filter(x => x !== n) : [...rutinaBorrador, n];
  renderPicker();
};
$("ej-nuevo-guardar").onclick = () => {
  const nombre = $("ej-nuevo-nombre").value.trim();
  const grupo = $("ej-nuevo-grupo").value;
  const tipo = $("ej-nuevo-tipo").value;
  if (!nombre) return alert("Escribí el nombre del ejercicio.");
  if (catalogo().some(e => e.nombre.toLowerCase() === nombre.toLowerCase())) return alert("Ya existe un ejercicio con ese nombre.");
  const fila = { id: uid(), user_id: user.id, nombre, grupo, tipo, met: tipo === "cardio" ? 7 : 5 };
  db.ejercicios.push(fila);
  encolar({ t: "ins", tabla: "ejercicios", fila });
  $("ej-nuevo-nombre").value = "";
  toast("Ejercicio agregado · " + nombre);
};

// ---------- Rutinas ----------
// Editar una rutina: carga su nombre y ejercicios; al guardar reemplaza la misma fila.
let rutinaEditandoId = null;
function editarRutina(id) {
  const r = db.rutinas.find(x => x.id === id);
  if (!r) return;
  rutinaEditandoId = id;
  $("r-nombre").value = r.nombre;
  rutinaBorrador = [...r.ejercicios];
  $("r-guardar").textContent = "Guardar cambios";
  renderPicker();
  $("r-nombre").scrollIntoView({ behavior: "smooth", block: "center" });
}

$("r-guardar").onclick = () => {
  const nombre = $("r-nombre").value.trim();
  if (!nombre || !rutinaBorrador.length) return alert("Poné nombre y elegí al menos un ejercicio.");
  const id = rutinaEditandoId || uid();
  const r = { id, nombre, ejercicios: [...rutinaBorrador] };
  const i = db.rutinas.findIndex(x => x.id === id);
  if (i >= 0) db.rutinas[i] = r; else db.rutinas.push(r);
  encolar({ t: "ins", tabla: "rutinas", fila: { id, user_id: user.id, nombre, ejercicios: r.ejercicios } });
  rutinaEditandoId = null;
  $("r-guardar").textContent = "Guardar rutina";
  $("r-nombre").value = ""; rutinaBorrador = []; renderPicker();
  toast(i >= 0 ? "Rutina actualizada" : "Rutina guardada");
};

// ---------- Plan semanal ----------
const DIAS_NOMBRE = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado" };
let plDias = [1, 3, 5];
let plObjetivo = "ambos";
const PLANTILLAS = {
  1: [["Full body", "fb"]],
  2: [["Full body A", "fb"], ["Full body B", "fb"]],
  3: [["Full body A", "fb"], ["Full body B", "fb"], ["Full body C", "fb"]],
  4: [["Tren superior A", "sup"], ["Tren inferior A", "inf"], ["Tren superior B", "sup"], ["Tren inferior B", "inf"]],
  5: [["Empuje", "push"], ["Tirón", "pull"], ["Piernas", "legs"], ["Hombros y brazos", "arms"], ["Full body", "fb"]],
  6: [["Empuje A", "push"], ["Tirón A", "pull"], ["Piernas A", "legs"], ["Empuje B", "push"], ["Tirón B", "pull"], ["Piernas B", "legs"]]
};
// Ejercicios sugeridos por tipo de día. Solo se usan los que existan en tu catálogo.
const SLOTS = {
  fb: ["Sentadilla", "Press banca", "Remo con barra", "Press militar", "Curl de piernas", "Plancha"],
  sup: ["Press banca", "Remo con barra", "Press militar", "Curl de bíceps con barra", "Extensión de tríceps en polea"],
  inf: ["Sentadilla", "Peso muerto rumano", "Hip thrust", "Curl de piernas", "Elevación de talones"],
  push: ["Press banca", "Press militar", "Elevaciones laterales", "Extensión de tríceps en polea"],
  pull: ["Dominadas", "Remo con barra", "Pájaros (elevación posterior)", "Curl de bíceps con barra"],
  legs: ["Sentadilla", "Peso muerto rumano", "Hip thrust", "Extensión de piernas", "Elevación de talones"],
  arms: ["Curl de bíceps con barra", "Curl martillo", "Extensión de tríceps en polea", "Press francés", "Elevaciones laterales"]
};
// Fuerza: básicos con carga alta. Hipertrofia: más variedad y ejercicios de aislamiento.
const POOLS = {
  fuerza: {
    fb: ["Sentadilla", "Press banca", "Remo con barra", "Press militar", "Peso muerto"],
    sup: ["Press banca", "Press inclinado con barra", "Remo con barra", "Press militar", "Dominadas"],
    inf: ["Sentadilla", "Peso muerto rumano", "Sentadilla búlgara", "Prensa 45°", "Hip thrust"],
    push: ["Press banca", "Press inclinado con barra", "Press militar", "Fondos en paralelas", "Press francés"],
    pull: ["Dominadas", "Remo con barra", "Remo en T", "Peso muerto", "Remo con mancuerna"],
    legs: ["Sentadilla", "Peso muerto rumano", "Sentadilla búlgara", "Prensa 45°", "Hip thrust"],
    arms: ["Press francés", "Curl de bíceps con barra", "Fondos en paralelas", "Curl martillo", "Extensión de tríceps sobre la cabeza"]
  },
  hipertrofia: {
    fb: ["Aperturas con mancuernas", "Jalón al pecho", "Elevaciones laterales", "Curl de piernas", "Extensión de piernas", "Plancha"],
    sup: ["Aperturas con mancuernas", "Jalón agarre cerrado", "Elevaciones laterales", "Curl martillo", "Extensión de tríceps en polea"],
    inf: ["Hip thrust", "Curl de piernas", "Extensión de piernas", "Sentadilla hack", "Gemelo sentado"],
    push: ["Cruces en polea", "Press en máquina de pecho", "Elevaciones laterales", "Extensión de tríceps en polea", "Press Arnold"],
    pull: ["Jalón al pecho", "Remo en polea baja", "Pájaros (elevación posterior)", "Face pull", "Curl predicador"],
    legs: ["Sentadilla goblet", "Hip thrust", "Curl de piernas", "Extensión de piernas", "Patada de glúteo en polea"],
    arms: ["Curl predicador", "Curl martillo", "Extensión de tríceps sobre la cabeza", "Fondos en banco", "Curl en polea"]
  }
};
// Elige hasta 5 ejercicios para el día. Evita los ya usados en el plan mientras el catálogo alcance.
function elegirEjercicios(tipoDia, objetivo, usados, cat) {
  const elegidos = [];
  const tomar = (lista, max, soloNuevos) => {
    for (const n of lista) {
      if (elegidos.length >= max) break;
      if (!cat.has(n) || elegidos.includes(n)) continue;
      if (soloNuevos && usados.has(n)) continue;
      elegidos.push(n);
    }
  };
  if (objetivo === "ambos") {
    tomar(POOLS.fuerza[tipoDia], 1, true);
    tomar(POOLS.hipertrofia[tipoDia], 5, true);
  } else {
    tomar(POOLS[objetivo][tipoDia], 5, true);
  }
  // Si el catálogo no alcanza para variar, completa aunque se repitan.
  if (elegidos.length < 3) tomar([...POOLS.fuerza[tipoDia], ...POOLS.hipertrofia[tipoDia]], 5, false);
  return elegidos;
}

const GUIA = {
  fuerza: "Primer ejercicio de cada día: 4 series de 3 a 5 repeticiones, RPE 8, con 2 a 3 minutos de descanso. Los demás: 3 series de 8 a 10 repeticiones.",
  hipertrofia: "Todos los ejercicios: 3 series de 8 a 12 repeticiones, RPE 7 a 8, con 90 segundos de descanso.",
  ambos: "Primer ejercicio de cada día: 4 series de 3 a 5 repeticiones (fuerza), RPE 8, con 2 a 3 minutos de descanso. Los demás: 3 series de 8 a 12 repeticiones (hipertrofia), RPE 7 a 8, con 90 segundos."
};

$("pl-dias").onclick = e => {
  const b = e.target.closest("button[data-d]");
  if (!b) return;
  const d = +b.dataset.d;
  plDias = plDias.includes(d) ? plDias.filter(x => x !== d) : [...plDias, d].sort((a, b) => a - b);
  b.classList.toggle("on", plDias.includes(d));
};
$("pl-goal").onclick = e => {
  const b = e.target.closest("button[data-g]");
  if (!b) return;
  plObjetivo = b.dataset.g;
  document.querySelectorAll("#pl-goal .chip").forEach(c => c.classList.toggle("on", c === b));
};

$("pl-generar").onclick = () => {
  if (!plDias.length) return alert("Elegí al menos un día.");
  // Un plan nuevo reemplaza al anterior: se borran las rutinas que empiezan con un día de la semana.
  const esDePlan = r => /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado) · /.test(r.nombre);
  const viejas = db.rutinas.filter(esDePlan);
  if (viejas.length && !confirm(`Ya tenés ${viejas.length} rutinas de un plan. ¿Reemplazarlas por el nuevo?`)) return;
  viejas.forEach(r => {
    db.rutinas = db.rutinas.filter(x => x.id !== r.id);
    encolar({ t: "del", tabla: "rutinas", id: r.id });
  });
  const nombresCat = new Set(catalogo().map(e => e.nombre));
  const plantilla = PLANTILLAS[Math.min(plDias.length, 6)];
  const creadas = [];
  const usados = new Set();
  const etiqueta = { fuerza: "fuerza", hipertrofia: "hipertrofia", ambos: "fuerza + hipertrofia" }[plObjetivo];
  plDias.slice(0, plantilla.length).forEach((dia, i) => {
    const [titulo, tipoDia] = plantilla[i];
    const ejercicios = elegirEjercicios(tipoDia, plObjetivo, usados, nombresCat);
    if (!ejercicios.length) return;
    ejercicios.forEach(n => usados.add(n));
    const nombre = `${DIAS_NOMBRE[dia]} · ${titulo} (${etiqueta})`;
    const id = uid();
    db.rutinas.push({ id, nombre, ejercicios });
    encolar({ t: "ins", tabla: "rutinas", fila: { id, user_id: user.id, nombre, ejercicios } });
    creadas.push(nombre);
  });
  $("pl-guia").innerHTML = creadas.length
    ? `<div class="objetivo">${creadas.map(esc).join("<br>")}</div>
       <p class="mut"><b>Cómo entrenar:</b> ${esc(GUIA[plObjetivo])}</p>
       <p class="mut">Las series y repeticiones no se guardan en la rutina: usá esta guía al cargar cada serie. El tipo automático se asigna según las repeticiones.</p>`
    : '<p class="mut">No encontré ejercicios de esos grupos en tu catálogo. Agregá algunos en "Nuevo ejercicio".</p>';
  toast(`Plan creado · ${creadas.length} rutinas`);
};

function borrarRutina(id) {
  if (!confirm("¿Borrar esta rutina? Las sesiones registradas no se borran.")) return;
  db.rutinas = db.rutinas.filter(r => r.id !== id);
  encolar({ t: "del", tabla: "rutinas", id });
}

function renderRutinas() {
  // Las rutinas de un plan se muestran en orden de la semana; las demás van al final.
  const ordenDia = r => { const i = Object.values(DIAS_NOMBRE).findIndex(d => r.nombre.startsWith(d + " · ")); return i < 0 ? 99 : i; };
  $("r-lista").innerHTML = db.rutinas.length ? db.rutinas.slice().sort((a, b) => ordenDia(a) - ordenDia(b)).map(r => `
    <div class="row filas">
      <div style="flex:1 1 60%"><b style="color:var(--sun)">${esc(r.nombre)}</b><div class="mut">${esc(r.ejercicios.join(" · "))}</div></div>
      <div class="row" style="flex:0 0 auto;margin:0;gap:6px">
        <button class="btn sec mini fijo" onclick="editarRutina('${r.id}')">Editar</button>
        <button class="btn peligro mini fijo" onclick="borrarRutina('${r.id}')">Borrar</button>
      </div>
    </div>`).join("") : '<p class="mut">Creá tu primera rutina.</p>';
}

// ---------- Peso ----------
$("pc-guardar").onclick = () => {
  const fecha = $("pc-fecha").value || hoy();
  const kg = num($("pc-kg").value);
  if (!kg) return alert("Ingresá el peso.");
  db.peso = db.peso.filter(p => p.fecha !== fecha);
  db.peso.push({ fecha, kg });
  db.peso.sort((a, b) => a.fecha.localeCompare(b.fecha));
  encolar({ t: "ins", tabla: "peso", fila: { user_id: user.id, fecha, kg } });
  $("pc-kg").value = "";
  toast(`Peso guardado · ${kg} kg`);
};

function borrarPeso(fecha) {
  if (!confirm("¿Borrar este registro de peso?")) return;
  db.peso = db.peso.filter(p => p.fecha !== fecha);
  encolar({ t: "delFecha", tabla: "peso", fecha });
}

$("meta-guardar").onclick = () => {
  const m = num($("meta-kg").value);
  if (!m) return alert("Ingresá un peso objetivo válido.");
  ajustes.meta = m;
  guardarTodo();
  renderTodo();
  toast(`Meta fijada en ${m} kg`);
};
$("meta-borrar").onclick = () => {
  ajustes.meta = null;
  $("meta-kg").value = "";
  guardarTodo();
  renderTodo();
};

function renderPeso() {
  if (ajustes.meta && !$("meta-kg").value) $("meta-kg").value = ajustes.meta;
  $("pc-lista").innerHTML = db.peso.length ? db.peso.slice().reverse().slice(0, 14).map(p => `
    <div class="row filas">
      <b style="color:var(--cyan)">${p.fecha}</b><span style="font-size:20px;font-weight:800">${p.kg} kg</span>
      <button class="btn peligro mini fijo" onclick="borrarPeso('${p.fecha}')">Borrar</button>
    </div>`).join("") : '<p class="mut">Todavía no cargaste ningún peso.</p>';
}

// ---------- Progreso ----------
function ritmoSemanal(datos) {
  // Pendiente de regresión lineal de los últimos 42 días, en kg por semana.
  const corte = Date.now() / 864e5 - 42;
  const pts = datos
    .map(p => [new Date(p.fecha).getTime() / 864e5, p.kg])
    .filter(([x]) => x >= corte);
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let numer = 0, den = 0;
  pts.forEach(([x, y]) => { numer += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return den ? (numer / den) * 7 : null;
}

function volumenSemanas(n) {
  const hoyMs = new Date(hoy()).getTime();
  const out = [];
  for (let w = n - 1; w >= 0; w--) {
    const hasta = hoyMs - w * 7 * 864e5;
    const desde = hasta - 7 * 864e5;
    let vol = 0;
    db.sesiones.forEach(s => {
      const t = new Date(s.fecha).getTime();
      if (t > desde && t <= hasta) s.series.forEach(x => vol += x.kg * x.reps);
    });
    out.push({ label: new Date(hasta).toISOString().slice(5, 10), vol: Math.round(vol) });
  }
  return out;
}

function renderProgresoPeso() {
  const corte = rangoPeso ? Date.now() - rangoPeso * DIA_MS : -Infinity;
  const datos = db.peso.filter(p => new Date(p.fecha).getTime() >= corte);
  const m = ajustes.meta;

  if (!datos.length) {
    $("pr-kpis").innerHTML = "";
    $("pr-meta").innerHTML = "";
    $("pr-rango").textContent = "";
    $("pr-vacio").textContent = "Cargá tu peso en la pestaña Peso para ver tu progreso acá.";
    if (charts["pr-peso-chart"]) { charts["pr-peso-chart"].destroy(); delete charts["pr-peso-chart"]; }
    return;
  }

  const ini = datos[0], ult = datos[datos.length - 1];
  const cambio = ult.kg - ini.kg;
  const ritmo = ritmoSemanal(datos);
  const restante = m ? ult.kg - m : null;
  $("pr-rango").textContent = datos.length > 1 ? `${ini.fecha} → ${ult.fecha}` : ult.fecha;
  $("pr-vacio").textContent = datos.length < 2 ? "Con un solo registro todavía no hay tendencia. Cargá otro peso más adelante." : "";

  $("pr-kpis").innerHTML = `
    <div class="kpi"><small>Peso actual</small><b>${fmt(ult.kg)}<span>kg</span></b></div>
    <div class="kpi c2"><small>Cambio total</small><b class="${cambio > 0 ? "neg" : cambio < 0 ? "pos" : ""}">${cambio > 0 ? "+" : ""}${fmt(cambio)}<span>kg</span></b></div>
    <div class="kpi c3"><small>Ritmo</small><b>${ritmo === null ? "—" : (ritmo > 0 ? "+" : "") + fmt(ritmo)}<span>${ritmo === null ? "" : "kg/sem"}</span></b></div>
    <div class="kpi c4"><small>Para tu meta</small><b>${m ? (restante > 0 ? fmt(restante) : "¡LISTO!") : "—"}<span>${m && restante > 0 ? "kg" : m ? "" : "sin meta"}</span></b></div>`;

  if (m && ini.kg !== m) {
    const avance = Math.max(0, Math.min(100, (ini.kg - ult.kg) / (ini.kg - m) * 100));
    $("pr-meta").innerHTML = `
      <div class="mut">Avance hacia <b style="color:var(--sun)">${m} kg</b>: <b style="color:var(--lime)">${Math.round(avance)}%</b></div>
      <div class="barra"><div style="width:${avance}%"></div></div>`;
  } else {
    $("pr-meta").innerHTML = m ? `<div class="mut">¡Estás en tu meta de ${m} kg!</div>` : `<div class="mut">Podés fijar una meta en la pestaña Peso.</div>`;
  }

  const avg7 = datos.map((_, i) => {
    const v = datos.slice(Math.max(0, i - 6), i + 1);
    return Math.round(v.reduce((a, p) => a + p.kg, 0) / v.length * 10) / 10;
  });
  const sets = [
    { label: "Peso", data: datos.map(p => p.kg), borderColor: NEON.cyan, backgroundColor: degradado(NEON.cyan), fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: "#05060d", pointBorderColor: NEON.cyan, pointBorderWidth: 2, pointHoverRadius: 7, borderWidth: 3 },
    { label: "Promedio 7 registros", data: avg7, borderColor: NEON.mag, borderWidth: 3, tension: .45, pointRadius: 0, fill: false }
  ];
  if (m) sets.push({ label: "Meta", data: datos.map(() => m), borderColor: NEON.sun, borderDash: [8, 6], pointRadius: 0, borderWidth: 2 });
  dibujar("pr-peso-chart", {
    type: "line",
    data: { labels: datos.map(p => p.fecha.slice(5)), datasets: sets },
    options: { scales: { y: { ticks: { callback: v => v + " kg" } } } }
  });
}

function renderEntrenamiento() {
  const semanas = volumenSemanas(8);
  const actual = semanas[semanas.length - 1].vol;
  const anterior = semanas[semanas.length - 2].vol;
  const dif = anterior ? Math.round((actual - anterior) / anterior * 100) : null;
  const corte = new Date(hoy()).getTime() - 30 * 864e5;
  const sesiones30 = db.sesiones.filter(s => s.series.length && new Date(s.fecha).getTime() >= corte).length;

  $("en-kpis").innerHTML = `
    <div class="kpi"><small>Sesiones (30 días)</small><b>${sesiones30}</b></div>
    <div class="kpi c2"><small>Volumen esta semana</small><b>${actual.toLocaleString("es-AR")}<span>kg</span></b></div>
    <div class="kpi c3"><small>Vs. semana anterior</small><b class="${dif > 0 ? "pos" : dif < 0 ? "neg" : ""}">${dif === null ? "—" : (dif > 0 ? "+" : "") + dif + "%"}</b></div>`;

  dibujar("en-semanas-chart", {
    type: "bar",
    data: {
      labels: semanas.map(s => s.label),
      datasets: [{
        label: "Volumen (kg)", data: semanas.map(s => s.vol),
        backgroundColor: semanas.map((_, i) => i === semanas.length - 1 ? NEON.lime : NEON.vio + "cc"),
        borderColor: semanas.map((_, i) => i === semanas.length - 1 ? NEON.lime : NEON.mag),
        borderWidth: 2, borderRadius: 10, borderSkipped: false
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });
}

function renderProgresoEjercicio() {
  const ejs = ejerciciosConocidos();
  const sel = $("p-ej");
  const actual = sel.value;
  sel.innerHTML = ejs.map(e => `<option>${esc(e)}</option>`).join("");
  if (actual && ejs.includes(actual)) sel.value = actual;
  const ej = sel.value;
  const metrica = $("p-metrica").value;
  const puntos = [];
  db.sesiones.forEach(s => {
    const xs = s.series.filter(x => x.ejercicio === ej);
    if (!xs.length) return;
    let v;
    if (metrica === "max") v = Math.max(...xs.map(x => x.kg));
    if (metrica === "e1rm") v = Math.max(...xs.map(x => e1rm(x.kg, x.reps)));
    if (metrica === "vol") v = xs.reduce((a, x) => a + x.kg * x.reps, 0);
    puntos.push({ x: s.fecha.slice(5), y: Math.round(v * 10) / 10, f: s.fecha });
  });
  dibujar("p-chart", {
    type: "line",
    data: { labels: puntos.map(p => p.x), datasets: [{
      label: metrica, data: puntos.map(p => p.y),
      borderColor: NEON.mag, backgroundColor: degradado(NEON.mag), fill: true, tension: .35,
      pointRadius: 5, pointBackgroundColor: NEON.sun, pointBorderColor: "#05060d", pointBorderWidth: 2, borderWidth: 3
    }] },
    options: { plugins: { legend: { display: false } } }
  });
  if (puntos.length) {
    const mejor = puntos.reduce((a, b) => b.y > a.y ? b : a);
    const delta = Math.round((puntos[puntos.length - 1].y - puntos[0].y) * 10) / 10;
    $("p-stats").innerHTML = `
      <div class="kpi"><small>Último</small><b>${puntos[puntos.length - 1].y}</b></div>
      <div class="kpi c4"><small>Récord (${mejor.f})</small><b>${mejor.y}</b></div>
      <div class="kpi c3"><small>Desde el inicio</small><b class="${delta > 0 ? "pos" : delta < 0 ? "neg" : ""}">${delta > 0 ? "+" : ""}${delta}</b></div>
      <div class="kpi c2"><small>Sesiones</small><b>${puntos.length}</b></div>`;
  } else {
    $("p-stats").innerHTML = '<p class="mut">Sin datos para este ejercicio todavía.</p>';
  }
}

// ---------- Estadísticas, ranking y sobrecarga ----------
const DIA_MS = 864e5;
const sesionesConSeries = () => db.sesiones.filter(s => s.series.length);
const grupoDe = nombre => { const x = (db.ejercicios || []).find(e => e.nombre === nombre); return x ? x.grupo : "Otro"; };
const promedio = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const mmss = s => s === null ? "—" : fmtTiempo(Math.round(s));
// El 1RM solo sale de series de fuerza: en hipertrofia las repeticiones altas lo distorsionan.
function e1rmSesion(ses, ej) {
  const xs = ses.series.filter(x => x.ejercicio === ej && tipoDe(x) === "fuerza");
  return xs.length ? Math.max(...xs.map(x => e1rm(x.kg, x.reps))) : null;
}
function ejerciciosEnSesiones() {
  const set = new Set();
  sesionesConSeries().forEach(s => s.series.forEach(x => set.add(x.ejercicio)));
  return [...set];
}

function renderEstadisticas() {
  const ses = sesionesConSeries();
  const todas = ses.flatMap(s => s.series);
  const corte30 = new Date(hoy()).getTime() - 30 * DIA_MS;
  const ses30 = ses.filter(s => new Date(s.fecha).getTime() >= corte30);
  const series30 = ses30.flatMap(s => s.series);
  const tonelaje = todas.reduce((a, x) => a + x.kg * x.reps, 0);
  const descs = todas.filter(x => x.descanso_seg != null).map(x => x.descanso_seg);
  const kcal30 = ses30.reduce((a, s) => a + estimarSesion(s).kcal, 0);
  const conPeso = !!pesoRef();

  let mejor = null, records = 0;
  ejerciciosEnSesiones().forEach(ej => {
    const todasE = ses.map(s => e1rmSesion(s, ej) ?? 0);
    const m = Math.max(...todasE);
    if (!mejor || m > mejor.v) mejor = { ej, v: m };
    const antes = ses.filter(s => new Date(s.fecha).getTime() < corte30).map(s => e1rmSesion(s, ej) ?? 0);
    const mejorAntes = antes.length ? Math.max(...antes) : 0;
    const ult = ses30.map(s => e1rmSesion(s, ej) ?? 0);
    if (mejorAntes > 0 && ult.length && Math.max(...ult) > mejorAntes) records++;
  });

  $("st-kpis").innerHTML = `
    <div class="kpi"><small>Sesiones</small><b>${ses.length}</b></div>
    <div class="kpi c2"><small>Series totales</small><b>${todas.length}</b></div>
    <div class="kpi c3"><small>Tonelaje total</small><b>${Math.round(tonelaje).toLocaleString("es-AR")}<span>kg</span></b></div>
    <div class="kpi c4"><small>Frecuencia</small><b>${fmt(ses30.length / 4)}<span>ses/sem</span></b></div>
    <div class="kpi"><small>Descanso promedio</small><b>${mmss(promedio(descs))}</b></div>
    <div class="kpi c2"><small>Récords (30 días)</small><b>${records}</b></div>
    <div class="kpi c3"><small>Mejor 1RM</small><b>${mejor ? fmt(mejor.v, 0) : "—"}<span>${mejor ? "kg · " + esc(mejor.ej) : ""}</span></b></div>
    <div class="kpi c4"><small>Kcal (30 días)</small><b>${conPeso ? kcal30.toLocaleString("es-AR") : "—"}<span>${conPeso ? "kcal" : "cargá peso"}</span></b></div>`;

  const grupos = {};
  series30.forEach(x => { const g = grupoDe(x.ejercicio); grupos[g] = (grupos[g] || 0) + x.kg * x.reps; });
  const labels = Object.keys(grupos);
  const colores = [NEON.cyan, NEON.mag, NEON.lime, NEON.sun, NEON.vio, NEON.red];
  dibujar("st-grupos-chart", {
    type: "bar",
    data: { labels, datasets: [{ label: "Volumen 30 días (kg)", data: labels.map(l => Math.round(grupos[l])),
      backgroundColor: labels.map((_, i) => colores[i % colores.length] + "cc"), borderRadius: 10, borderWidth: 0 }] },
    options: { plugins: { legend: { display: false } } }
  });
  $("st-kcal-nota").textContent = conPeso
    ? "Calorías: estimación orientativa (MET × peso × tiempo bajo carga). No reemplaza una medición."
    : "Cargá tu peso para estimar calorías.";
}

// Compara el 1RM promedio de las primeras sesiones con el de las últimas.
function rankingEjercicios() {
  return ejerciciosEnSesiones().map(ej => {
    const ses = sesionesConSeries().filter(s => s.series.some(x => x.ejercicio === ej && tipoDe(x) === "fuerza"));
    if (ses.length < 2) return null;
    const vals = ses.map(s => e1rmSesion(s, ej));
    const k = Math.min(3, Math.floor(ses.length / 2));
    const ini = promedio(vals.slice(0, k)), fin = promedio(vals.slice(-k));
    const pct = ini ? (fin - ini) / ini * 100 : 0;
    return { ej, pct, n: ses.length, mejor: Math.max(...vals) };
  }).filter(Boolean);
}

let filtroEj = "mejoran";
function renderRanking() {
  const r = rankingEjercicios();
  const lista = filtroEj === "mejoran" ? r.filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct)
    : filtroEj === "bajan" ? r.filter(x => x.pct < 0).sort((a, b) => a.pct - b.pct)
    : r.sort((a, b) => b.pct - a.pct);
  $("ej-ranking").innerHTML = lista.length ? lista.map(x => `
    <div class="row filas" data-ver="${esc(x.ej)}" style="cursor:pointer">
      <div style="flex:1 1 60%"><b>${esc(x.ej)}</b><div class="mut">${x.n} sesiones · mejor 1RM ${fmt(x.mejor)} kg</div></div>
      <b class="${x.pct > 0 ? "pos" : x.pct < 0 ? "neg" : ""}">${x.pct > 0 ? "+" : ""}${fmt(x.pct)}%</b>
    </div>`).join("") : '<p class="mut">Sin ejercicios para mostrar. Necesitás al menos 2 sesiones por ejercicio.</p>';
}
$("ej-filtro").onclick = e => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  filtroEj = b.dataset.f;
  document.querySelectorAll("#ej-filtro .chip").forEach(c => c.classList.toggle("on", c === b));
  renderRanking();
};
$("ej-ranking").onclick = e => {
  const fila = e.target.closest("[data-ver]");
  if (!fila) return;
  $("p-ej").value = fila.dataset.ver;
  renderProgreso();
  $("p-chart").scrollIntoView({ behavior: "smooth", block: "center" });
};

// Reglas de sobrecarga progresiva sobre la última sesión de cada ejercicio.
function recomendaciones() {
  const ses = sesionesConSeries();
  const out = [];
  ejerciciosEnSesiones().forEach(ej => {
    const hist = ses.filter(s => s.series.some(x => x.ejercicio === ej && tipoDe(x) === "fuerza"));
    if (!hist.length) return;
    const ult = hist[hist.length - 1];
    const xs = ult.series.filter(x => x.ejercicio === ej && tipoDe(x) === "fuerza");
    const kgMax = Math.max(...xs.map(x => x.kg));
    const repsMin = Math.min(...xs.map(x => x.reps));
    const rpeProm = promedio(xs.map(x => x.rpe).filter(v => v != null));
    const descProm = promedio(xs.map(x => x.descanso_seg).filter(v => v != null));
    const e1Ult = e1rmSesion(ult, ej);
    const ePrev = hist.length > 1 ? e1rmSesion(hist[hist.length - 2], ej) : null;
    const tres = hist.slice(-3).map(s => e1rmSesion(s, ej));
    const estancado = tres.length === 3 && Math.max(...tres) - Math.min(...tres) <= Math.max(...tres) * 0.01;

    let tipo, consejo;
    if (ePrev && e1Ult < ePrev * 0.97) {
      tipo = "baja";
      consejo = "Bajó tu 1RM estimado. Revisá descanso, sueño y carga; si se repite la próxima sesión, bajá un 5-10 % y volvé a construir.";
    } else if (estancado) {
      tipo = "estancado";
      consejo = "Llevás 3 sesiones sin subir. Cambiá el rango de repeticiones (por ejemplo de 5 a 8) o sumá una serie.";
    } else if ((rpeProm !== null && rpeProm >= 9) || repsMin < 5) {
      tipo = "mantener";
      consejo = "Esta carga te exige al límite. Mantenela y buscá una repetición más antes de subir.";
    } else if ((rpeProm !== null && rpeProm <= 7.5 && repsMin >= 8) || (rpeProm === null && repsMin >= 10)) {
      tipo = "sube";
      consejo = kgMax > 0
        ? `Subí a ${fmt(kgMax + 2.5)} kg la próxima vez.`
        : "Sumá peso o una serie: con peso corporal la sobrecarga viene por repeticiones.";
    } else {
      tipo = "reps";
      consejo = "Sumá una repetición por serie hasta llegar al rango alto y recién después subí la carga.";
    }
    if (descProm !== null && repsMin < 6 && descProm < 120) consejo += " Para cargas altas conviene descansar 2 a 3 minutos.";
    const objetivo = {
      sube: kgMax > 0 ? `${fmt(kgMax + 2.5)} kg × ${repsMin} reps` : `${repsMin + 1} reps`,
      reps: `${kgMax} kg · ${repsMin + 1} reps mínimas`,
      mantener: `${kgMax} kg · mismas reps`,
      baja: `${fmt(kgMax * 0.95)} kg`,
      estancado: "cambiá el rango de reps"
    }[tipo];
    out.push({ ej, tipo, consejo, objetivo });
  });
  return out;
}

// Ejercicios de hipertrofia: la progresión se mira en repeticiones, no en 1RM.
function recHipertrofia(ej, ses) {
  const hist = ses.filter(s => s.series.some(x => x.ejercicio === ej && tipoDe(x) === "hipertrofia"));
  if (!hist.length) return null;
  const xs = hist[hist.length - 1].series.filter(x => x.ejercicio === ej && tipoDe(x) === "hipertrofia");
  const kgMax = Math.max(...xs.map(x => x.kg));
  const repsMin = Math.min(...xs.map(x => x.reps));
  const rpeProm = promedio(xs.map(x => x.rpe).filter(v => v != null));
  if (rpeProm !== null && rpeProm >= 9) {
    return { ej, tipo: "mantener", consejo: "Las series están muy cerca del fallo: mantené la carga y buscá una repetición más.", objetivo: `${fmt(kgMax)} kg · mismas reps` };
  }
  if (repsMin >= 12 && kgMax > 0) {
    return { ej, tipo: "sube", consejo: "Llegaste al rango alto en todas las series: subí la carga y volvé a empezar desde el rango bajo.", objetivo: `${fmt(kgMax + 2.5)} kg × ${repsMin} reps` };
  }
  return { ej, tipo: "reps", consejo: "Sumá una repetición por serie hasta llegar a 12 y después subí la carga.", objetivo: `${fmt(kgMax)} kg · ${repsMin + 1} reps mínimas` };
}

// Fuerza primero; los ejercicios que solo tienen hipertrofia usan la regla de repeticiones.
function recomendacionesTodas() {
  const ses = sesionesConSeries();
  const out = recomendaciones();
  ejerciciosEnSesiones().forEach(ej => {
    if (out.some(x => x.ej === ej)) return;
    const r = recHipertrofia(ej, ses);
    if (r) out.push(r);
  });
  return out;
}

$("so-analizar").onclick = () => {
  const orden = { baja: 0, estancado: 1, mantener: 2, reps: 3, sube: 4 };
  const etiqueta = { baja: "Bajó", estancado: "Estancado", mantener: "Al límite", reps: "Sumá reps", sube: "Subí carga" };
  const color = { baja: "neg", estancado: "", mantener: "", reps: "", sube: "pos" };
  const r = recomendacionesTodas().sort((a, b) => orden[a.tipo] - orden[b.tipo]);
  $("so-resultado").innerHTML = r.length ? `
    <p class="mut">Sobrecarga progresiva: subir de a poco la carga, las repeticiones o las series. Orientativo; no reemplaza a tu profesor.</p>
    ${r.map(x => `
      <div class="row filas">
        <div style="flex:1 1 70%"><b style="color:var(--sun)">${esc(x.ej)}</b> <span class="${color[x.tipo]}">${etiqueta[x.tipo]}</span><div class="mut">${esc(x.consejo)}</div></div>
      </div>`).join("")}` : '<p class="mut">Necesitás al menos 2 sesiones con el mismo ejercicio para dar recomendaciones.</p>';
};

// ---------- Semanas, rachas e hitos ----------
const pad = n => String(n).padStart(2, "0");
const fechaISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lunesDe = f => { const d = new Date(f + "T00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fechaISO(d); };
const sumarDias = (f, n) => { const d = new Date(f + "T00:00"); d.setDate(d.getDate() + n); return fechaISO(d); };
const UMBRALES = { ses: [10, 25, 50, 100, 200], rec: [1, 5, 10, 25, 50], racha: [4, 8, 12, 24, 52], meta: [25, 50, 75, 100] };

// Cuenta las semanas seguidas que cumplen. La semana en curso no corta la racha si todavía no terminó.
function rachaActual(flags) {
  let arr = flags.slice();
  if (arr.length && !arr[arr.length - 1]) arr = arr.slice(0, -1);
  let n = 0;
  for (let i = arr.length - 1; i >= 0 && arr[i]; i--) n++;
  return n;
}

function avanceMeta() {
  const m = ajustes.meta;
  if (!m || !db.peso.length) return null;
  const ini = db.peso[0].kg, ult = db.peso[db.peso.length - 1].kg;
  if (ini === m) return 100;
  return Math.max(0, Math.min(100, (ini - ult) / (ini - m) * 100));
}

function calcularProgreso() {
  const ses = sesionesConSeries().slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
  const semanas = {};
  const sem = k => (semanas[k] = semanas[k] || { ses: 0, vol: 0, kcal: 0, records: 0 });
  const mejorPrevio = {};
  const pesoOK = !!pesoRef();
  let records = 0;
  ses.forEach(s => {
    const w = sem(lunesDe(s.fecha));
    w.ses++;
    w.vol += s.series.reduce((a, x) => a + x.kg * x.reps, 0);
    if (pesoOK) w.kcal += estimarSesion(s).kcal;
    new Set(s.series.map(x => x.ejercicio)).forEach(ej => {
      const v = e1rmSesion(s, ej);
      if (mejorPrevio[ej] && v > mejorPrevio[ej]) { w.records++; records++; }
      mejorPrevio[ej] = Math.max(mejorPrevio[ej] || 0, v);
    });
  });
  const hoyK = lunesDe(hoy());
  const primera = ses.length ? lunesDe(ses[0].fecha) : hoyK;
  const lista = [];
  for (let k = primera; k <= hoyK; k = sumarDias(k, 7)) lista.push(k);
  const w = lista.map(k => semanas[k] || { ses: 0, vol: 0, kcal: 0, records: 0 });
  const cumple = {
    objetivo: w.map(x => x.ses >= ajustes.dias),
    record: w.map(x => x.records > 0),
    kcal: w.map((x, i) => i > 0 && x.kcal > 0 && x.kcal > w[i - 1].kcal),
    volumen: w.map((x, i) => i > 0 && x.vol > w[i - 1].vol)
  };
  const rachas = {};
  Object.keys(cumple).forEach(c => rachas[c] = rachaActual(cumple[c]));
  return { sesiones: ses.length, records, semanas: w, rachas };
}

function barraHito(nombre, valor, umbrales, unidad) {
  const sig = umbrales.find(u => u > valor);
  if (sig === undefined) return `
    <div class="plan-item" style="display:block">
      <div class="row" style="margin:0"><b>${nombre}</b><span class="mut" style="margin-left:auto">¡Conseguidos!</span></div>
      <div class="barra gruesa"><div style="width:100%"></div></div>
    </div>`;
  const ant = [0, ...umbrales].filter(u => u <= valor).pop();
  const pct = Math.round((valor - ant) / (sig - ant) * 100);
  return `
    <div class="plan-item" style="display:block">
      <div class="row" style="margin:0"><b>${nombre}</b><span class="mut" style="margin-left:auto">${fmt(valor, 0)} / ${sig}${unidad}</span></div>
      <div class="barra gruesa"><div style="width:${pct}%"></div></div>
      <div class="mut">Próximo hito: ${sig}${unidad} · faltan ${fmt(sig - valor, 0)}${unidad}</div>
    </div>`;
}

function renderRachasHitos(p) {
  const r = p.rachas;
  const etiquetas = {
    objetivo: `Semanas en meta (${ajustes.dias} días)`,
    record: "Semanas con récord",
    kcal: "Semanas quemando más",
    volumen: "Semanas con más carga"
  };
  $("rachas").innerHTML = Object.keys(etiquetas).map(k => `
    <div class="racha"><small>${etiquetas[k]}</small><b><span class="llama">${r[k] ? "🔥" : "💤"}</span> ${r[k]}</b><small>seguidas</small></div>`).join("");
  const av = avanceMeta();
  $("hitos").innerHTML =
    barraHito("Sesiones", p.sesiones, UMBRALES.ses, "") +
    barraHito("Récords de kilos", p.records, UMBRALES.rec, "") +
    barraHito("Semanas en meta", r.objetivo, UMBRALES.racha, "") +
    (av !== null ? barraHito("Meta de peso", av, UMBRALES.meta, "%") : `<p class="mut">Fijá una meta de peso en la pestaña Peso para ver ese hito.</p>`);
}

function logrosHitos(p) {
  const out = [];
  UMBRALES.ses.filter(u => p.sesiones >= u).forEach(u => out.push({ k: `ses-${u}`, t: `${u} sesiones completadas` }));
  UMBRALES.rec.filter(u => p.records >= u).forEach(u => out.push({ k: `rec-${u}`, t: `${u} récord${u > 1 ? "es" : ""} de kilos` }));
  UMBRALES.racha.filter(u => p.rachas.objetivo >= u).forEach(u => out.push({ k: `racha-${u}`, t: `${u} semanas seguidas en tu meta` }));
  const av = avanceMeta();
  if (av !== null) UMBRALES.meta.filter(u => av >= u).forEach(u => out.push({ k: `meta-${u}`, t: `${u} % hacia tu meta de peso` }));
  return out;
}

// La primera vez marca los hitos ya conseguidos sin festejarlos; después avisa solo los nuevos.
function revisarHitos(p) {
  const logros = logrosHitos(p);
  if (!ajustes.hitosInit) {
    ajustes.hitos = logros.map(x => x.k);
    ajustes.hitosInit = true;
    guardarTodo();
    return;
  }
  const nuevos = logros.filter(x => !ajustes.hitos.includes(x.k));
  if (!nuevos.length) return;
  ajustes.hitos = [...ajustes.hitos, ...nuevos.map(x => x.k)];
  guardarTodo();
  mostrarHito("¡Hito conseguido!", nuevos[nuevos.length - 1].t);
}

function mostrarHito(titulo, sub) {
  const h = $("hito");
  h.innerHTML = `<span class="estrella">🏆</span><b>${esc(titulo)}</b><span>${esc(sub)}</span>`;
  h.classList.remove("hidden");
  h.style.animation = "none"; void h.offsetWidth; h.style.animation = "";
  clearTimeout(mostrarHito.t);
  mostrarHito.t = setTimeout(() => h.classList.add("hidden"), 3500);
}

// ---------- Progresión estructurada ----------
const ORDEN_PLAN = { baja: 0, estancado: 1, mantener: 2, reps: 3, sube: 4 };
function htmlPlan(lista) {
  const etq = { baja: "Bajó", estancado: "Estancado", mantener: "Al límite", reps: "Sumá reps", sube: "Subí carga" };
  const color = { baja: "neg", sube: "pos" };
  return lista.map(x => `
    <div class="plan-item" style="display:block">
      <div><b style="color:var(--sun)">${esc(x.ej)}</b> <span class="${color[x.tipo] || ""}">${etq[x.tipo]}</span></div>
      <div class="mut">${esc(x.consejo)}</div>
      <div style="margin-top:6px">Próxima vez: <b>${esc(x.objetivo)}</b></div>
    </div>`).join("");
}
function renderPlan() {
  const r = recomendacionesTodas().sort((a, b) => ORDEN_PLAN[a.tipo] - ORDEN_PLAN[b.tipo]);
  $("plan").innerHTML = r.length ? htmlPlan(r)
    : '<p class="mut">Cuando tengas 2 sesiones con el mismo ejercicio, acá aparece qué hacer la próxima vez.</p>';
}

// ---------- Pasos y objetivo en la sesión ----------
function renderPasos() {
  const ses = sesionActual();
  $("paso-1").classList.toggle("ok", !!$("s-rutina").value || !!ses);
  $("paso-2").classList.toggle("ok", !!ses && ses.series.length > 0);
  $("paso-3").classList.toggle("ok", descansoPendiente !== null);
  $("s-estado-sesion").textContent = ses ? `${ses.series.length} series · ${ses.fecha}` : "sin sesión";
}
// Última sesión cerrada con ese ejercicio (no cuenta la sesión que está abierta).
function ultimaSesionDe(ej) {
  const previas = db.sesiones
    .filter(s => s.id !== sesionActualId && s.series.some(x => x.ejercicio === ej))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!previas.length) return null;
  return { fecha: previas[0].fecha, xs: previas[0].series.filter(x => x.ejercicio === ej) };
}
function resumenUltima(u) {
  const grupos = {};
  u.xs.forEach(x => (grupos[tipoDe(x)] = grupos[tipoDe(x)] || []).push(x));
  return Object.entries(grupos).map(([t, arr]) => {
    const kgs = [...new Set(arr.map(x => x.kg))].join(" / ");
    const reps = arr.map(x => x.reps).join(", ");
    const rpe = promedio(arr.map(x => x.rpe).filter(v => v != null));
    const desc = promedio(arr.map(x => x.descanso_seg).filter(v => v != null));
    const nombreTipo = t.charAt(0).toUpperCase() + t.slice(1);
    return `<b>${nombreTipo}</b>: ${arr.length} series · ${esc(reps)} reps · ${kgs} kg`
      + (rpe !== null ? ` · RPE ${fmt(rpe, 1)}` : "")
      + (desc !== null ? ` · descanso ${fmtTiempo(Math.round(desc))}` : "");
  }).join("<br>");
}

function renderObjetivo() {
  const ej = $("s-ej").value.trim();
  const r = ej ? recomendacionesTodas().find(x => x.ej === ej) : null;
  $("s-objetivo").classList.toggle("hidden", !r);
  if (r) $("s-objetivo").innerHTML = `Próxima vez en <b>${esc(ej)}</b>: ${esc(r.objetivo)}<div class="mut" style="margin-top:4px">${esc(r.consejo)}</div>`;
  const u = ej ? ultimaSesionDe(ej) : null;
  $("s-ultima").classList.toggle("hidden", !u);
  if (u) $("s-ultima").innerHTML = `Última vez (${u.fecha}):<br>${resumenUltima(u)}`;
}
$("s-ej").addEventListener("input", renderObjetivo);

// ---------- Preferencias ----------
function pintarOffline() {
  $("pref-offline").textContent = ajustes.offline ? "Sin conexión forzado · tocá para volver" : "Automático · tocá para forzar";
  $("pref-offline").classList.toggle("modo-off", !!ajustes.offline);
}
$("pref-offline").onclick = () => {
  ajustes.offline = !ajustes.offline;
  guardarTodo();
  pintarOffline();
  pintarEstado();
  if (!ajustes.offline) sincronizar();
};
$("pref-dias").onchange = () => {
  ajustes.dias = parseInt($("pref-dias").value) || 3;
  guardarTodo();
  renderTodo();
};
$("rango-filtro").onclick = e => {
  const b = e.target.closest("button[data-r]");
  if (!b) return;
  rangoPeso = parseInt(b.dataset.r);
  document.querySelectorAll("#rango-filtro .chip").forEach(c => c.classList.toggle("on", c === b));
  renderProgresoPeso();
};

function renderProgreso() {
  renderProgresoPeso();
  renderEntrenamiento();
  renderProgresoEjercicio();
  renderEstadisticas();
  renderRanking();
  const p = calcularProgreso();
  renderRachasHitos(p);
  renderPlan();
  revisarHitos(p);
}
$("p-ej").onchange = renderProgreso;
$("p-metrica").onchange = renderProgreso;

// ---------- Usuarios (solo administrador) ----------
async function renderAdmin() {
  const card = $("admin-card");
  if (!cuenta?.es_admin) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const { data, error } = await sb.from("cuentas")
    .select("id,correo,nombre,aprobado,es_admin,creado").order("creado", { ascending: false });
  if (error) { $("admin-lista").innerHTML = `<p class="mut">No se pudo cargar: ${esc(error.message)}</p>`; return; }
  // Pendientes primero, para que se vean enseguida
  const lista = data.slice().sort((a, b) => Number(a.aprobado) - Number(b.aprobado));
  $("admin-lista").innerHTML = lista.length ? lista.map(c => `
    <div class="row filas">
      <div style="flex:1 1 60%">
        <b style="color:${c.aprobado ? "var(--lime)" : "var(--sun)"}">${esc(c.nombre || "Sin nombre")}</b>
        <div class="mut">${esc(c.correo || "")} · ${c.aprobado ? "aprobado" : "pendiente"}${c.es_admin ? " · admin" : ""}</div>
      </div>
      ${c.id === user.id ? "" : c.aprobado
        ? `<button class="btn peligro mini fijo" onclick="cambiarAcceso('${c.id}', false)">Quitar acceso</button>`
        : `<button class="btn cy mini fijo" onclick="cambiarAcceso('${c.id}', true)">Aprobar</button>`}
    </div>`).join("") : '<p class="mut">Todavía no hay cuentas.</p>';
}

async function cambiarAcceso(id, aprobar) {
  const { error } = await sb.from("cuentas").update({ aprobado: aprobar }).eq("id", id);
  if (error) return alert("Error: " + error.message);
  toast(aprobar ? "Usuario aprobado" : "Acceso quitado");
  renderAdmin();
}

// ---------- Datos ----------
$("d-exportar").onclick = () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gymapp-" + hoy() + ".json";
  a.click();
};

$("d-borrar").onclick = async () => {
  if (!navigator.onLine) return alert("Necesitás conexión para borrar todo.");
  if (!confirm("¿Borrar TODOS tus datos de la nube? No se puede deshacer.")) return;
  if (prompt('Para confirmar, escribí BORRAR') !== "BORRAR") return;
  for (const t of ["series", "sesiones", "rutinas", "peso", "ejercicios"]) {
    const { error } = await sb.from(t).delete().eq("user_id", user.id);
    if (error) return alert("Error al borrar " + t + ": " + error.message);
  }
  cola = []; db = DB_VACIA(); sesionActualId = null;
  guardarTodo();
  renderTodo();
  alert("Datos borrados.");
};

// ---------- Render general ----------
function renderTodo() {
  refrescarSelects();
  renderSesion();
  renderPicker();
  renderRutinas();
  if (!$("vista-progreso").classList.contains("hidden")) renderProgreso();
  if (!$("vista-peso").classList.contains("hidden")) renderPeso();
  pintarEstado();
}

// Registro del service worker (permite usar la app sin conexión)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

$("s-fecha").value = hoy();
$("pc-fecha").value = hoy();
$("ej-nuevo-grupo").innerHTML = GRUPOS.map(g => `<option>${g}</option>`).join("");
$("pref-dias").value = String(ajustes.dias);
pintarOffline();
refrescarSelects();
renderTodo();
