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
  localStorage.removeItem(K_CUENTA);
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

// Copia de la cuenta en el celular: permite abrir la app sin conexión.
const K_CUENTA = "gymapp_cuenta";
function guardarCuentaLocal() {
  try { if (user && cuenta) localStorage.setItem(K_CUENTA, JSON.stringify({ user: { id: user.id, email: user.email }, cuenta })); } catch (e) {}
}
function cuentaLocal() {
  try { return JSON.parse(localStorage.getItem(K_CUENTA)); } catch (e) { return null; }
}

async function cargarCuenta() {
  let data = null, error = null;
  try {
    // Con mala señal la consulta puede quedar colgada: se espera 6 segundos como máximo.
    ({ data, error } = await Promise.race([
      sb.from("cuentas").select("id,correo,nombre,aprobado,es_admin").eq("id", user.id).maybeSingle(),
      new Promise(r => setTimeout(() => r({ data: null, error: { message: "tiempo agotado" } }), 6000))
    ]));
  } catch (e) { error = e; }
  if (!error) { cuenta = data; if (data) guardarCuentaLocal(); return; }
  // Sin conexión o con error de red: se usa la copia guardada si es de la misma cuenta.
  const l = cuentaLocal();
  cuenta = l && l.user.id === user.id ? l.cuenta : null;
}

sb.auth.onAuthStateChange((event, session) => {
  // El enlace del correo de recuperación dispara este evento.
  if (event === "PASSWORD_RECOVERY") modoRecuperacion = true;
  if (!session) { try { localStorage.removeItem(K_CUENTA); } catch (e) {} }
  // Si la app ya está abierta con esta misma cuenta (por ejemplo, con la copia local), no se vuelve a la pantalla de carga.
  const yaAbierta = !!(user && session?.user && user.id === session.user.id && cuenta);
  user = session?.user ?? null;
  if (!yaAbierta) { cuenta = null; cargandoCuenta = !!user; }
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

// Arranque sin conexión: si Supabase no confirma la sesión enseguida (o no hay red),
// se abre la app con los datos guardados en el celular. Si luego la sesión se confirma, sigue igual.
setTimeout(async () => {
  if (user) return;
  const l = cuentaLocal();
  if (!l?.cuenta?.aprobado || !l.user?.id) return;
  await almacenListo;
  if (user) return;
  user = l.user; cuenta = l.cuenta; cargandoCuenta = false;
  mostrarVista();
  restaurarBorrador();
  renderTodo();
}, navigator.onLine ? 8000 : 1200);

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
