// ============================================================
// auth.js — ingreso, aprobación, recuperación de clave y navegación.
// ============================================================

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
  confirmarPendiente();
  if (cola.length && !confirm(`Hay ${cola.length} cambio(s) sin subir. Si salís, se pierden. ¿Continuar?`)) return;
  cola = []; db = DB_VACIA(); sesionActualId = null; borrador = null;
  localStorage.removeItem(K_BORRADOR);
  guardarTodo();
  await sb.auth.signOut();
};

let almacenOK = false;
almacenListo.then(() => { almacenOK = true; mostrarVista(); });

function mostrarVista() {
  const recup = modoRecuperacion;
  const aprobado = !!cuenta?.aprobado;
  const cargando = !!user && !recup && (cargandoCuenta || !almacenOK);
  const logueado = !!user && !recup && !cargando && aprobado;
  const pendiente = !!user && !recup && !cargando && !aprobado;
  $("nueva").classList.toggle("hidden", !recup);
  $("auth").classList.toggle("hidden", recup || !!user);
  $("pendiente").classList.toggle("hidden", !pendiente);
  $("cargando").classList.toggle("hidden", !cargando);
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
    await almacenListo;
    if (user) await cargarCuenta();
    cargandoCuenta = false;
    mostrarVista();
    restaurarBorrador();
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

// ---------- Navegación con transición ----------
function irA(tab) {
  const b = document.querySelector(`#tabs button[data-tab="${tab}"]`);
  document.querySelectorAll("#tabs button").forEach(x => { x.classList.remove("on"); x.removeAttribute("aria-current"); });
  b.classList.add("on");
  b.setAttribute("aria-current", "page");
  document.querySelectorAll("#app > section").forEach(s => s.classList.add("hidden"));
  const v = $("vista-" + tab);
  v.classList.remove("hidden", "entra");
  void v.offsetWidth;
  v.classList.add("entra");
  window.scrollTo(0, 0);
  if (tab === "progreso") renderProgreso();
  if (tab === "peso") renderPeso();
  if (tab === "datos") renderAdmin();
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { haptico(8); irA(b.dataset.tab); });
