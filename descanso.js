// ============================================================
// descanso.js — cronómetro, temporizador, panel con anillo y avisos.
// ============================================================

// El último descanso medido con el cronómetro se guarda en la próxima serie.
let descansoPendiente = null;
let rsInicio = null, rsId = null, tmId = null, tmFin = null, tmAvisoT = null, audioCtx = null;
let tmTotal = 0;           // segundos del último temporizador iniciado
let restInicio = null;     // momento en que se marcó la última serie (para medir el descanso real)

$("rs-toggle").onclick = () => {
  if (rsId) {
    clearInterval(rsId); rsId = null;
    descansoPendiente = Math.round((Date.now() - rsInicio) / 1000);
    $("rs-toggle").textContent = "Iniciar";
    $("rs-info").textContent = "último descanso: " + fmtTiempo(descansoPendiente);
    toast("Descanso registrado · " + fmtTiempo(descansoPendiente));
    return;
  }
  rsInicio = Date.now();
  $("rs-toggle").textContent = "Detener";
  abrirModo("cron");
  rsId = setInterval(() => $("rs-cron").textContent = fmtTiempo(Math.floor((Date.now() - rsInicio) / 1000)), 250);
};
$("rs-reset").onclick = () => {
  clearInterval(rsId); rsId = null; rsInicio = null; descansoPendiente = null;
  $("rs-cron").textContent = "0:00";
  $("rs-toggle").textContent = "Iniciar";
  $("rs-info").textContent = "entre series";
};

// El audio se habilita dentro de un toque para que el celular lo permita después.
function prepararAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {}
}
function pitido(t0, frec, dur) {
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = "sine"; o.frequency.value = frec;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function avisarFin() {
  try { navigator.vibrate?.([300, 150, 300, 150, 500]); } catch (e) {}
  try {
    if (audioCtx) {
      const t = audioCtx.currentTime;
      pitido(t, 880, 0.18); pitido(t + 0.25, 880, 0.18); pitido(t + 0.5, 1320, 0.4);
    }
  } catch (e) {}
  if (document.hidden) notificar("Terminó el descanso", "Volvé a la serie 💪");
}
// Aviso del sistema: aparece aunque estés en otra app o con la pantalla bloqueada
// (en iPhone, solo con la app instalada en la pantalla de inicio).
async function notificar(titulo, cuerpo) {
  if (!ajustes.avisos || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) reg.showNotification(titulo, { body: cuerpo, tag: "descanso", renotify: true, icon: "icon-192.png", badge: "icon-192.png", vibrate: [300, 150, 300] });
  } catch (e) {}
}

// Color según lo que falta: naranja de 20 a 11 s, rojo de 10 a 1 s.
function colorResta(el, resta) {
  el.classList.toggle("alerta", resta > 10 && resta <= 20);
  el.classList.toggle("urgente", resta > 0 && resta <= 10);
}
function tickTemporizador() {
  const resta = Math.ceil((tmFin - Date.now()) / 1000);
  if (resta <= 0) {
    clearInterval(tmId); tmId = null;
    clearTimeout(tmAvisoT);
    $("tm-estado").textContent = "¡Terminó el descanso!";
    $("tm-cron").textContent = "0:00";
    $("tm-cron").classList.add("fin");
    colorResta($("tm-cron"), 0);
    avisarFin();
    pintarModo();
    return;
  }
  $("tm-estado").textContent = "Quedan " + fmtTiempo(resta);
  $("tm-cron").textContent = fmtTiempo(resta);
  colorResta($("tm-cron"), resta);
}
function iniciarTemporizador(seg) {
  clearInterval(tmId);
  clearTimeout(tmAvisoT);
  $("tm-cron").classList.remove("fin");
  tmFin = Date.now() + seg * 1000;
  tmTotal = seg;
  abrirModo("tm");
  tickTemporizador();
  tmId = setInterval(tickTemporizador, 250);
  // Con la app en segundo plano los intervalos se frenan: este aviso va aparte.
  tmAvisoT = setTimeout(() => { if (tmId) tickTemporizador(); }, seg * 1000 + 50);
}
function cancelarTemporizador() {
  clearInterval(tmId); tmId = null;
  clearTimeout(tmAvisoT);
  tmFin = null;
  $("tm-cron").textContent = "--:--";
  $("tm-cron").classList.remove("fin");
  colorResta($("tm-cron"), 0);
}
$("tm-iniciar").onclick = () => {
  const seg = parseInt($("tm-seg").value);
  if (!seg || seg < 1) return avisar("Poné una cantidad de segundos.");
  prepararAudio();
  iniciarTemporizador(seg);
};
$("tm-cancelar").onclick = () => {
  cancelarTemporizador();
  $("tm-estado").textContent = "Temporizador cancelado.";
};
// Al volver a la app, el reloj se pone al día enseguida.
document.addEventListener("visibilitychange", () => { if (!document.hidden && tmId) tickTemporizador(); });

// ---------- Panel de descanso con anillo ----------
const CIRC = 2 * Math.PI * 98;
const modoEl = $("modo");
let modoTipo = null;       // "cron" | "tm" | null
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
  colorResta(modoEl, 0);
  $("modo-arco").style.strokeDasharray = CIRC;
  modoEl.classList.remove("hidden");
  pintarModo();
  clearInterval(abrirModo.t);
  abrirModo.t = setInterval(pintarModo, 200);
  pantallaActiva(true);
}
function cerrarModo() {
  clearInterval(abrirModo.t);
  modoEl.classList.add("hidden");
  modoEl.classList.remove("fin");
  colorResta(modoEl, 0);
  modoTipo = null;
  pantallaActiva(false);
}
function pintarModo() {
  if (!modoTipo) return;
  $("modo-ajuste").classList.toggle("hidden", !(modoTipo === "tm" && tmId));
  const arco = $("modo-arco");
  $("modo-sig").textContent = modoTipo === "tm" ? (proximaSerieTexto() || "") : "";
  if (modoTipo === "cron") {
    colorResta(modoEl, 0);
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
  $("modo-tipo").textContent = "Descanso";
  const terminado = !tmId && tmFin && Date.now() >= tmFin;
  if (terminado) {
    modoEl.classList.add("fin");
    colorResta(modoEl, 0);
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
  colorResta(modoEl, tmId ? resta : 0);
  arco.style.strokeDashoffset = CIRC * (1 - Math.min(1, resta / total));
  $("modo-accion").textContent = tmId ? "Saltar descanso" : "Iniciar";
  $("modo-sub").textContent = tmId ? "de " + fmtTiempo(tmTotal) : "Elegí los segundos en la pantalla principal";
}
$("modo-accion").onclick = () => {
  if (modoTipo === "cron") return $("rs-toggle").click();
  if (modoEl.classList.contains("fin")) return cerrarModo();
  if (tmId) { cancelarTemporizador(); $("tm-estado").textContent = "Descanso salteado."; return cerrarModo(); }
  $("tm-iniciar").click();
};
$("modo-cerrar").onclick = cerrarModo;
document.querySelector(".modo-fondo").onclick = cerrarModo;
// Ajuste del temporizador en marcha: -15 s, +15 s, +30 s.
document.querySelectorAll("#modo-ajuste button").forEach(b => b.onclick = () => {
  if (!tmId || !tmFin) return;
  const d = parseInt(b.dataset.s);
  tmFin += d * 1000;
  tmTotal = Math.max(1, tmTotal + d);
  clearTimeout(tmAvisoT);
  tmAvisoT = setTimeout(() => { if (tmId) tickTemporizador(); }, Math.max(0, tmFin - Date.now()) + 50);
  pintarModo();
});
// Tocar cualquiera de los relojes de la tarjeta vuelve a abrir el panel.
$("rs-cron").parentElement.onclick = () => abrirModo("cron");
$("tm-cron").parentElement.onclick = () => abrirModo("tm");
