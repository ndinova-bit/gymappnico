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
  if (!$("vista-historial").classList.contains("hidden")) renderHistorialTab();
  pintarEstado();
  $("aviso-migracion").classList.toggle("hidden", esquemaOK.v10 !== false && esquemaOK.notas !== false);
}

// Registro del service worker (permite usar la app sin conexión y mostrar avisos).
// Cuando hay una versión nueva, no se aplica sola (podría cortar una sesión): aparece un aviso y vos elegís cuándo.
if ("serviceWorker" in navigator) {
  let recargando = false;
  const avisarNueva = reg => {
    $("nueva-version").classList.remove("hidden");
    $("nv-actualizar").onclick = () => reg.waiting?.postMessage("SKIP_WAITING");
  };
  navigator.serviceWorker.register("sw.js").then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) avisarNueva(reg);
    reg.addEventListener("updatefound", () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener("statechange", () => {
        if (nuevo.state === "installed" && navigator.serviceWorker.controller) avisarNueva(reg);
      });
    });
    const buscar = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (!document.hidden) buscar(); });
    setInterval(buscar, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });
}

$("s-fecha").value = hoy();
$("pc-fecha").value = hoy();
$("ej-nuevo-grupo").innerHTML = GRUPOS.map(g => `<option>${g}</option>`).join("");
$("pref-dias").value = String(ajustes.dias);
$("pref-descanso").value = String(ajustes.descanso || 90);
if (![...$("pref-descanso").options].some(o => o.value === $("pref-descanso").value)) $("pref-descanso").value = "90";
aplicarTema();
if (window.innerWidth >= 1100) $("desc-manual").open = true;
pintarOffline();
pintarAvisos();
almacenListo.then(() => { restaurarBorrador(); renderTodo(); });
