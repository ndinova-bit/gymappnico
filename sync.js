// ============================================================
// sync.js — cola de cambios y sincronización con Supabase.
// ============================================================

// Columnas que agrega la migración v10. Si todavía no se ejecutó,
// se sacan antes de subir para que el servidor no rechace la fila.
const CAMPOS_V10 = { series: ["marca", "superserie"], rutinas: ["esquema"] };
function limpiar(tabla, obj) {
  if (esquemaOK.v10 !== false) return obj;
  const quitar = CAMPOS_V10[tabla] || [];
  if (!quitar.length) return obj;
  const f = x => { const y = { ...x }; quitar.forEach(k => delete y[k]); return y; };
  return Array.isArray(obj) ? obj.map(f) : f(obj);
}

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
    case "ins": return t.upsert(limpiar(op.tabla, op.fila), { onConflict: ONCONFLICT[op.tabla] || "id" });
    case "upd": {
      const cambios = limpiar(op.tabla, op.cambios);
      if (!Object.keys(cambios).length) return Promise.resolve({ error: null });
      return t.update(cambios).eq("id", op.id);
    }
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
function encolarVarios(ops) {
  cola.push(...ops);
  guardarTodo();
  renderTodo();
  sincronizar();
}

// Comprueba una sola vez por apertura si la base ya tiene las migraciones v10 y v11.
async function detectarEsquema() {
  if (esquemaOK.v10 === null) {
    const [a, b] = await Promise.all([
      sb.from("series").select("marca,superserie").limit(1),
      sb.from("rutinas").select("esquema").limit(1)
    ]);
    if ((a.error && !a.error.code) || (b.error && !b.error.code)) throw new Error("sin red");
    esquemaOK.v10 = !a.error && !b.error;
  }
  if (esquemaOK.notas === null) {
    const n = await sb.from("notas_ejercicio").select("id").limit(1);
    if (n.error && !n.error.code) throw new Error("sin red");
    esquemaOK.notas = !n.error;
  }
  if (esquemaOK.prefs === null) {
    const n = await sb.from("preferencias").select("id").limit(1);
    if (n.error && !n.error.code) throw new Error("sin red");
    esquemaOK.prefs = !n.error;
    $("aviso-v11").classList.toggle("hidden", esquemaOK.prefs !== false);
  }
}

const ERR_COLUMNA = ["42703", "PGRST204"];   // columna inexistente

// Cuándo se bajaron los datos de la nube por última vez. Los cambios propios se suben enseguida,
// pero bajar todo el historial se hace al abrir, al volver la conexión, al volver a la app o cada 5 minutos.
let ultimaBajada = 0;
const CADA_BAJADA = 5 * 60 * 1000;

async function sincronizar() {
  pintarEstado();
  if (!user || !cuenta?.aprobado || !navigator.onLine || ajustes.offline || sincronizando) return;
  sincronizando = true;
  try {
    await almacenListo;
    // Con la copia local de la cuenta puede no haber una sesión confirmada todavía: no se sube nada hasta tenerla.
    if (!(await sb.auth.getSession()).data?.session) return;
    await detectarEsquema();
    const habiaCola = cola.length > 0;
    while (cola.length) {
      const op = cola[0];
      // Notas y preferencias sin su tabla creada: quedan solo en este celular.
      if (op.tabla === "notas_ejercicio" && esquemaOK.notas === false) { cola.shift(); guardarTodo(); continue; }
      if (op.tabla === "preferencias" && esquemaOK.prefs === false) { cola.shift(); guardarTodo(); continue; }
      const { error } = await ejecutar(op);
      if (error) {
        // Sin "code" suele ser un corte de red: se conserva el cambio y se reintenta después.
        if (!error.code || error.status === 401 || ["PGRST301", "PGRST302"].includes(error.code)) break;
        // Falta una columna nueva: se marca y se reintenta sin ella.
        if (ERR_COLUMNA.includes(error.code) && esquemaOK.v10 !== false) { esquemaOK.v10 = false; continue; }
        // Un error del servidor no debe trabar la cola.
        ultimoError = "Un cambio fue rechazado: " + error.message;
      } else {
        ultimoError = "";
      }
      cola.shift();
      guardarTodo();
      pintarEstado();
    }
    if (!cola.length && (habiaCola || Date.now() - ultimaBajada > CADA_BAJADA)) await descargar();
  } catch (e) {
    // Sin red: se reintenta más tarde.
  } finally {
    sincronizando = false;
    pintarEstado();
  }
}

// Huella de los datos que se muestran. Sirve para no redibujar la pantalla si la nube no trae nada nuevo.
function firmaDatos(d) {
  return JSON.stringify([
    (d.rutinas || []).map(r => [r.id, r.nombre, r.ejercicios, r.esquema ?? null]),
    (d.sesiones || []).map(s => [s.id, s.fecha, s.notas ?? null, (s.series || []).map(x =>
      [x.id, x.ejercicio, x.reps, x.kg, x.rpe ?? null, x.descanso_seg ?? null, x.tipo_serie ?? null, x.marca || "normal", x.superserie ?? null])]),
    (d.peso || []).map(p => [p.fecha, p.kg]),
    (d.ejercicios || []).map(e => [e.id, e.nombre, e.grupo, e.tipo, e.met]),
    (d.notas || []).map(n => [n.id, n.ejercicio, n.nota])
  ]);
}

async function descargar() {
  const v10 = esquemaOK.v10 !== false;
  const colSeries = "id,ejercicio,reps,kg,rpe,descanso_seg,tipo_serie,created_at" + (v10 ? ",marca,superserie" : "");
  const [r, s, p, e, n, pf] = await Promise.all([
    sb.from("rutinas").select("id,nombre,ejercicios,created_at" + (v10 ? ",esquema" : "")).order("created_at"),
    sb.from("sesiones").select(`id,fecha,notas,series(${colSeries})`).order("fecha"),
    sb.from("peso").select("fecha,kg").order("fecha"),
    sb.from("ejercicios").select("id,user_id,nombre,grupo,tipo,met").order("nombre"),
    esquemaOK.notas ? sb.from("notas_ejercicio").select("id,ejercicio,nota") : Promise.resolve({ data: null }),
    esquemaOK.prefs ? sb.from("preferencias").select("datos,actualizado").maybeSingle() : Promise.resolve({ data: null })
  ]);
  for (const res of [r, s, p, e, n, pf]) if (res.error) throw res.error;
  // Si mientras bajaba hubo cambios locales nuevos (o un borrado esperando "Deshacer"), no se pisan.
  if (cola.length || pendienteBorrar) return;
  ultimaBajada = Date.now();
  s.data.forEach(ses => ses.series.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  const nuevo = { rutinas: r.data, sesiones: s.data, peso: p.data, ejercicios: e.data, notas: n.data ?? db.notas ?? [] };
  const prefsCambiaron = recibirPrefs(pf.data);
  // Sin novedades: no se toca la pantalla (así no se pierde el foco mientras escribís).
  if (firmaDatos(nuevo) === firmaDatos(db)) { if (prefsCambiaron) { guardarTodo(); renderTodo(); } return; }
  db = nuevo;
  guardarTodo();
  renderTodo();
}

// ---------- Preferencias en la nube ----------
// Se sincronizan la meta de peso, los días por semana, el descanso, el tema, las animaciones y los hitos.
// Lo que depende del aparato (modo sin conexión, avisos, pantalla de gimnasio) queda en cada celular.
const CLAVES_PREFS = ["meta", "dias", "descanso", "tema", "calmo", "hitos", "hitosInit"];
const PREFS_BASE = { meta: null, dias: 3, descanso: 90, tema: "neon", calmo: true, hitos: [], hitosInit: false };
const subPrefs = () => Object.fromEntries(CLAVES_PREFS.map(k => [k, ajustes[k] ?? PREFS_BASE[k]]));
let _prefsFirma = JSON.stringify(subPrefs());
// Primera vez con esta versión: si ya tenías ajustes propios, cuentan como "lo último que cambiaste".
if (ajustes.prefsTs === undefined) ajustes.prefsTs = _prefsFirma !== JSON.stringify(PREFS_BASE) ? Date.now() : 0;

// Se llama desde guardarTodo(): si cambió algo sincronizable, lo deja en la cola.
function revisarPrefs() {
  const f = JSON.stringify(subPrefs());
  if (f === _prefsFirma) return;
  _prefsFirma = f;
  ajustes.prefsTs = Date.now();
  encolarPrefs();
}
function encolarPrefs() {
  if (!user || esquemaOK.prefs === false) return;
  const fila = { user_id: user.id, datos: subPrefs(), actualizado: new Date(ajustes.prefsTs).toISOString() };
  cola = cola.filter(o => o.tabla !== "preferencias");     // solo importa la última versión
  cola.push({ t: "ins", tabla: "preferencias", fila });
  setTimeout(sincronizar, 0);
}
// Compara con lo que hay en la nube. Devuelve true si cambió algo en este celular.
function recibirPrefs(remoto) {
  const local = ajustes.prefsTs || 0;
  if (!remoto) { if (local > 0 && esquemaOK.prefs) encolarPrefs(); return false; }
  const rt = Date.parse(remoto.actualizado) || 0;
  if (rt > local) {
    Object.assign(ajustes, remoto.datos || {});
    ajustes.prefsTs = rt;
    _prefsFirma = JSON.stringify(subPrefs());
    aplicarPrefs();
    return true;
  }
  if (local > rt) encolarPrefs();
  return false;
}

window.addEventListener("online", () => { ultimaBajada = 0; sincronizar(); });
window.addEventListener("offline", pintarEstado);
// Cada 30 s se intenta subir lo pendiente; los datos de la nube se bajan solo cada tanto (ver arriba).
setInterval(sincronizar, 30000);
// Al volver a la app después de un rato, se pone todo al día.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - ultimaBajada > 60000) { ultimaBajada = 0; sincronizar(); }
});
