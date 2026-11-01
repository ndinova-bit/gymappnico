// ============================================================
// app.js — dibujo general y arranque. Va último en index.html.
// ============================================================

function refrescarSelects() {
  const sel = $("s-rutina");
  const previa = borrador?.rutinaId || sel.value;
  sel.innerHTML = '<option value="">Cargar una rutina…</option>' + db.rutinas.map(r => `<option value="${r.id}">${esc(r.nombre)}</option>`).join("");
  sel.value = db.rutinas.some(r => r.id === previa) ? previa : "";
  $("ej-list").innerHTML = ejerciciosConocidos().map(e => `<option value="${esc(e)}">`).join("");
  if (!$("s-fecha").value) $("s-fecha").value = borrador?.fecha || hoy();
  if (!$("pc-fecha").value) $("pc-fecha").value = hoy();
}

function renderTodo() {
  refrescarSelects();
  renderSesion();
  renderPicker();
  renderRutinas();
  if (!$("vista-progreso").classList.contains("hidden")) renderProgreso();
  if (!$("vista-peso").classList.contains("hidden")) renderPeso();
  pintarEstado();
  $("aviso-migracion").classList.toggle("hidden", esquemaOK.v10 !== false && esquemaOK.notas !== false);
}

// Registro del service worker (permite usar la app sin conexión y mostrar avisos).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

$("s-fecha").value = hoy();
$("pc-fecha").value = hoy();
$("ej-nuevo-grupo").innerHTML = GRUPOS.map(g => `<option>${g}</option>`).join("");
$("pref-dias").value = String(ajustes.dias);
$("pref-descanso").value = String(ajustes.descanso || 90);
if (![...$("pref-descanso").options].some(o => o.value === $("pref-descanso").value)) $("pref-descanso").value = "90";
aplicarTema();
pintarOffline();
pintarAvisos();
almacenListo.then(() => { restaurarBorrador(); renderTodo(); });
