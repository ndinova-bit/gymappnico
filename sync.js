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

// Comprueba una sola vez por apertura si la base ya tiene la migración v10.
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
}

const ERR_COLUMNA = ["42703", "PGRST204"];   // columna inexistente

async function sincronizar() {
  pintarEstado();
  if (!user || !cuenta?.aprobado || !navigator.onLine || ajustes.offline || sincronizando) return;
  sincronizando = true;
  try {
    await almacenListo;
    await detectarEsquema();
    while (cola.length) {
      const op = cola[0];
      // Notas por ejercicio sin la tabla creada: quedan solo en este celular.
      if (op.tabla === "notas_ejercicio" && esquemaOK.notas === false) { cola.shift(); guardarTodo(); continue; }
      const { error } = await ejecutar(op);
      if (error) {
        // Sin "code" suele ser un corte de red: se conserva el cambio y se reintenta después.
        if (!error.code) break;
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
    if (!cola.length) await descargar();
  } catch (e) {
    // Sin red: se reintenta más tarde.
  } finally {
    sincronizando = false;
    pintarEstado();
  }
}

async function descargar() {
  const v10 = esquemaOK.v10 !== false;
  const colSeries = "id,ejercicio,reps,kg,rpe,descanso_seg,tipo_serie,created_at" + (v10 ? ",marca,superserie" : "");
  const [r, s, p, e, n] = await Promise.all([
    sb.from("rutinas").select("id,nombre,ejercicios,created_at" + (v10 ? ",esquema" : "")).order("created_at"),
    sb.from("sesiones").select(`id,fecha,notas,series(${colSeries})`).order("fecha"),
    sb.from("peso").select("fecha,kg").order("fecha"),
    sb.from("ejercicios").select("id,user_id,nombre,grupo,tipo,met").order("nombre"),
    esquemaOK.notas ? sb.from("notas_ejercicio").select("id,ejercicio,nota") : Promise.resolve({ data: null })
  ]);
  for (const res of [r, s, p, e, n]) if (res.error) throw res.error;
  // Si mientras bajaba hubo cambios locales nuevos (o un borrado esperando "Deshacer"), no se pisan.
  if (cola.length || pendienteBorrar) return;
  s.data.forEach(ses => ses.series.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  db = { rutinas: r.data, sesiones: s.data, peso: p.data, ejercicios: e.data, notas: n.data ?? db.notas ?? [] };
  guardarTodo();
  renderTodo();
}

window.addEventListener("online", sincronizar);
window.addEventListener("offline", pintarEstado);
setInterval(sincronizar, 30000);
