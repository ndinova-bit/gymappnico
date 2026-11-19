// ============================================================
// sesion.js — planilla de la sesión, "¿Qué entreno hoy?",
// resumen final, notas por ejercicio e historial.
// ============================================================

// El borrador es la planilla en pantalla: bloques por ejercicio y sus filas.
// Las filas tildadas ya son series guardadas (serieId); las demás son el plan.
let borrador = null;
const MARCAS = ["normal", "calentamiento", "descendente"];

function guardarBorrador() {
  try {
    if (borrador) localStorage.setItem(K_BORRADOR, JSON.stringify(borrador));
    else localStorage.removeItem(K_BORRADOR);
  } catch (e) {}
}
function restaurarBorrador() {
  if (borrador) return;
  borrador = leerJSON(K_BORRADOR, null);
  if (borrador?.sesionId && db.sesiones.some(s => s.id === borrador.sesionId)) sesionActualId = borrador.sesionId;
  if (borrador?.fecha) $("s-fecha").value = borrador.fecha;
}
function asegurarBorrador() {
  if (!borrador) borrador = { sesionId: null, fecha: $("s-fecha").value || hoy(), rutinaId: null, bloques: [] };
  return borrador;
}

function asegurarSesion() {
  let ses = sesionActual();
  if (ses) return ses;
  const b = asegurarBorrador();
  ses = { id: uid(), fecha: b.fecha || hoy(), notas: null, rutina_id: b.rutinaId || null, series: [] };
  db.sesiones.push(ses);
  db.sesiones.sort((a, c) => a.fecha.localeCompare(c.fecha));
  sesionActualId = ses.id;
  b.sesionId = ses.id;
  guardarBorrador();
  encolar({ t: "ins", tabla: "sesiones", fila: { id: ses.id, user_id: user.id, fecha: ses.fecha, rutina_id: ses.rutina_id } });
  return ses;
}

// ---------- Historial de un ejercicio ----------
// Récord anterior de un ejercicio (sin calentamientos y sin contar la sesión indicada).
function mejorKgPrevio(ej, excluirSesionId, tipo = null) {
  let mejor = 0;
  db.sesiones.forEach(s => {
    if (s.id === excluirSesionId) return;
    s.series.forEach(x => { if (x.ejercicio === ej && esTrabajo(x) && (!tipo || tipoDe(x) === tipo) && x.kg > mejor) mejor = x.kg; });
  });
  return mejor;
}
// Tipo de serie que predomina en una lista de series.
function tipoDominante(xs) {
  const c = {};
  xs.forEach(x => { const t = tipoDe(x); c[t] = (c[t] || 0) + 1; });
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
}
// ¿Qué tipo de trabajo toca hoy en este ejercicio? Sale del rango de repeticiones del programa
// o, si no hay, del tipo que hiciste la última vez dentro de esta misma rutina. null = no se sabe.
function tipoObjetivo(ej) {
  const rutId = borrador?.rutinaId;
  if (!rutId) return null;
  const e = db.rutinas.find(r => r.id === rutId)?.esquema?.ej?.[ej];
  if (e && e.rmin) return tipoDe({ reps: Math.round((e.rmin + (e.rmax || e.rmin)) / 2) });
  const prev = db.sesiones
    .filter(s => s.id !== sesionActualId && s.rutina_id === rutId && s.series.some(x => x.ejercicio === ej && esTrabajo(x)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  return prev ? tipoDominante(prev.series.filter(x => x.ejercicio === ej && esTrabajo(x))) : null;
}
// Última sesión (que no sea la abierta) con ese ejercicio; xs = series de trabajo.
// Si se sabe qué tipo toca hoy (fuerza, hipertrofia…), solo cuentan sesiones donde hiciste ese tipo:
// así los kilos de una serie pesada de 4 reps no se mezclan con los de una de 10.
function ultimaSesionDe(ej) {
  const tipo = tipoObjetivo(ej);
  const previas = db.sesiones
    .filter(s => s.id !== sesionActualId && s.series.some(x => x.ejercicio === ej && esTrabajo(x))
      && (!tipo || tipoDominante(s.series.filter(x => x.ejercicio === ej && esTrabajo(x))) === tipo))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!previas.length) return null;
  return { fecha: previas[0].fecha, xs: previas[0].series.filter(x => x.ejercicio === ej && esTrabajo(x)) };
}

// ---------- Programas: semana y cargas ----------
function semanaPrograma(esq) {
  if (!esq?.inicio || !esq.ciclo) return 1;
  return Math.floor(Math.max(0, diasEntre(esq.inicio, hoy())) / 7) % esq.ciclo + 1;
}
function cicloPrograma(esq) {
  if (!esq?.inicio || !esq.ciclo) return 0;
  return Math.floor(Math.max(0, diasEntre(esq.inicio, hoy())) / (7 * esq.ciclo));
}
const W531 = {
  1: [[.65, 5, "5"], [.75, 5, "5"], [.85, 5, "5+"]],
  2: [[.70, 3, "3"], [.80, 3, "3"], [.90, 3, "3+"]],
  3: [[.75, 5, "5"], [.85, 3, "3"], [.95, 1, "1+"]],
  4: [[.40, 5, "5"], [.50, 5, "5"], [.60, 5, "5"]]
};
// Devuelve las filas sugeridas y un texto de objetivo para un ejercicio con esquema.
function planDeEjercicio(ej, e, esq) {
  const sem = semanaPrograma(esq);
  const descarga = !!esq.ciclo && sem === esq.ciclo;
  if (e.w531 && esq.tm?.[ej]) {
    const tm = esq.tm[ej] + cicloPrograma(esq) * (esq.inc?.[ej] || 2.5);
    return {
      filas: W531[sem].map(([p, r, t]) => ({ kg: r25(tm * p), reps: r, etq: `${Math.round(p * 100)}% · ${t}` })),
      meta: `5/3/1 · semana ${sem} de 4${sem === 4 ? " (descarga)" : ""} · máximo de entrenamiento ${fmtKg(r25(tm))} kg${sem < 4 ? " · la última serie, todas las reps que puedas" : ""}`
    };
  }
  const n = descarga ? Math.max(1, Math.ceil(e.s * 0.6)) : e.s;
  const u = ultimaSesionDe(ej);
  let kg = "", reps = e.rmin, subio = false;
  if (u) {
    const kgTop = Math.max(...u.xs.map(x => x.kg));
    const deTop = u.xs.filter(x => x.kg === kgTop);
    subio = kgTop > 0 && deTop.every(x => x.reps >= e.rmax);
    kg = subio ? kgTop + 2.5 : kgTop;
    reps = subio ? e.rmin : Math.min(e.rmax, Math.max(e.rmin, Math.min(...deTop.map(x => x.reps)) + 1));
    if (descarga && kg > 0) { kg = r25(kg * 0.9); subio = false; }
  }
  const semTxt = descarga ? "Semana de descarga: menos series y 10 % menos de peso · " : esq.ciclo ? `Semana ${sem} de ${esq.ciclo} · ` : "";
  return {
    filas: Array.from({ length: n }, () => ({ kg, reps, etq: "" })),
    meta: `${semTxt}Objetivo ${n} × ${e.rmin}${e.rmax !== e.rmin ? "-" + e.rmax : ""} reps${subio ? " · ¡llegaste arriba, subí la carga!" : ""}`
  };
}

// ---------- Bloques y filas ----------
function filaNueva(okg, oreps, marca = "normal", etq = "") {
  return { id: uid(), serieId: null, kg: "", reps: "", rpe: "", marca, hecho: false,
    okg: okg === "" || okg == null ? "" : String(okg), oreps: oreps == null ? "" : String(oreps), etq };
}
function filaDeSerie(x) {
  return { id: uid(), serieId: x.id, kg: String(x.kg), reps: String(x.reps), rpe: x.rpe == null ? "" : String(x.rpe),
    marca: x.marca || "normal", hecho: true, okg: "", oreps: "", etq: "" };
}
function nuevoBloque(ej, desde = null) {
  const b = { id: uid(), ej, ss: null, desc: null, meta: "", filas: [] };
  const rut = db.rutinas.find(r => r.id === borrador?.rutinaId);
  const e = rut?.esquema?.ej?.[ej];
  if (desde) {
    // Repetir una sesión: copia sus series como plan.
    desde.forEach(x => b.filas.push(filaNueva(x.kg, x.reps, x.marca || "normal")));
  } else if (e) {
    const p = planDeEjercicio(ej, e, rut.esquema);
    b.desc = e.d || null;
    b.meta = p.meta;
    p.filas.forEach(f => b.filas.push(filaNueva(f.kg, f.reps, "normal", f.etq)));
  } else {
    const u = ultimaSesionDe(ej);
    if (u) u.xs.forEach(x => b.filas.push(filaNueva(x.kg, x.reps, x.marca === "descendente" ? "descendente" : "normal")));
    else for (let i = 0; i < 3; i++) b.filas.push(filaNueva("", 10));
  }
  return b;
}
const buscarBloque = id => borrador?.bloques.find(b => b.id === id);

// Cargar una rutina en la planilla.
function cargarRutina(id) {
  const r = db.rutinas.find(x => x.id === id);
  if (!r) return;
  const bor = asegurarBorrador();
  const hayHechas = bor.bloques.some(b => b.filas.some(f => f.hecho));
  if (!hayHechas) bor.bloques = [];
  bor.rutinaId = id;
  const sa = sesionActual();
  if (sa && sa.rutina_id !== id) { sa.rutina_id = id; encolar({ t: "upd", tabla: "sesiones", id: sa.id, cambios: { rutina_id: id } }); }
  r.ejercicios.forEach(ej => { if (!bor.bloques.some(b => b.ej === ej)) bor.bloques.push(nuevoBloque(ej)); });
  $("s-rutina").value = id;
  guardarBorrador();
  renderSesion();
  toast(`${r.nombre} · ${r.ejercicios.length} ejercicios`);
}
$("s-rutina").onchange = () => { if ($("s-rutina").value) cargarRutina($("s-rutina").value); };

$("s-agregar-ej").onclick = () => {
  const ej = $("s-ej").value.trim();
  if (!ej) return alert("Escribí o elegí un ejercicio.");
  const bor = asegurarBorrador();
  bor.bloques.push(nuevoBloque(ej));
  $("s-ej").value = "";
  guardarBorrador();
  renderSesion();
  document.querySelector(`[data-b="${bor.bloques[bor.bloques.length - 1].id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
};
$("s-ej").addEventListener("keydown", e => { if (e.key === "Enter") $("s-agregar-ej").click(); });

$("s-fecha").onchange = () => {
  const f = $("s-fecha").value || hoy();
  if (borrador) { borrador.fecha = f; guardarBorrador(); }
  if (sesionActual()) cambiarFecha(sesionActualId, f);
};

// ---------- Marcar y desmarcar series ----------
function valorFila(f) {
  const kgTxt = f.kg !== "" ? f.kg : f.okg;
  const repsTxt = f.reps !== "" ? f.reps : f.oreps;
  const kg = kgTxt === "" ? 0 : num(kgTxt);
  const reps = parseInt(repsTxt);
  const rpe = f.rpe === "" ? null : num(f.rpe);
  if (!reps || reps < 1 || reps > 100) return { error: "Poné las repeticiones (entre 1 y 100)." };
  if (isNaN(kg) || kg < 0 || kg > 1000) return { error: "Los kilos tienen que estar entre 0 y 1000." };
  if (rpe !== null && (isNaN(rpe) || rpe < 1 || rpe > 10)) return { error: "El RPE va del 1 al 10. Si no lo sabés, dejalo vacío." };
  return { kg, reps, rpe };
}

function marcarHecha(b, f) {
  const v = valorFila(f);
  if (v.error) return alert(v.error);
  prepararAudio();
  confirmarPendiente();
  const ses = asegurarSesion();
  // Descanso real antes de esta serie: el del cronómetro manual o el medido desde la serie anterior.
  let desc = null;
  if (rsId) $("rs-toggle").click();
  if (descansoPendiente !== null) desc = descansoPendiente;
  else if (restInicio) desc = Math.round((Date.now() - restInicio) / 1000);
  if (desc !== null && desc > 1800) desc = null;   // más de 30 min: no es un descanso
  descansoPendiente = null;
  $("rs-info").textContent = "entre series";
  const previo = mejorKgPrevio(b.ej, ses.id);
  const serie = {
    id: uid(), user_id: user.id, sesion_id: ses.id, ejercicio: b.ej, reps: v.reps, kg: v.kg, rpe: v.rpe,
    descanso_seg: desc, tipo_serie: tipoDe({ reps: v.reps, kg: v.kg, rpe: v.rpe, ejercicio: b.ej }), marca: f.marca, superserie: b.ss,
    created_at: new Date().toISOString()
  };
  ses.series.push(serie);
  Object.assign(f, { serieId: serie.id, hecho: true, kg: String(v.kg), reps: String(v.reps), rpe: v.rpe == null ? "" : String(v.rpe) });
  guardarBorrador();
  haptico(25);
  cerrarModo();
  cancelarTemporizador();
  restInicio = Date.now();
  const { created_at, ...fila } = serie;
  encolar({ t: "ins", tabla: "series", fila });

  if (esTrabajo(serie) && v.kg > 0 && previo > 0 && v.kg > previo) mostrarHito("¡Nuevo récord!", `${b.ej}: ${fmtKg(v.kg)} kg`);
  revisarHitos(calcularProgreso());

  // ¿Sigue otro ejercicio de la superserie o una descendente? Entonces sin descanso.
  const sigSS = siguienteEnSuperserie(b);
  const idx = b.filas.indexOf(f);
  const sigFila = b.filas[idx + 1];
  if (sigSS) {
    toast(`Superserie: seguí con ${sigSS.ej}`);
    document.querySelector(`[data-b="${sigSS.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (sigFila && !sigFila.hecho && sigFila.marca === "descendente") {
    toast("Descendente: bajá el peso y seguí sin descanso");
    return;
  }
  if (!hayFilasPendientes()) { toast("¡Terminaste todo lo planeado! Tocá «Terminar sesión»"); return; }
  // Prioridad: calentamiento (60 s) > descanso del programa > el que sueles tomar en este ejercicio > el medido recién > el de Preferencias.
  const seg = f.marca === "calentamiento" ? 60
    : (b.ss ? borrador.bloques.find(x => x.ss === b.ss && x.desc)?.desc : b.desc)
      || (b.ss ? null : descansoHabitual(b.ej))
      || (desc && desc >= 15 ? desc : null) || ajustes.descanso || 90;
  $("tm-seg").value = seg;
  iniciarTemporizador(seg);
}

// Descanso habitual de un ejercicio: la mediana de lo que descansaste entre series de trabajo
// en tus últimas 3 sesiones con ese ejercicio, dentro de la misma rutina. La primera serie de cada sesión no cuenta,
// porque su "descanso" incluye el cambio de máquina. Hacen falta al menos 2 datos.
function descansoHabitual(ej) {
  const rut = borrador?.rutinaId || null;
  const medir = lista => {
    const vals = [];
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-3).forEach(s => {
      s.series.filter(x => x.ejercicio === ej && esTrabajo(x)).slice(1).forEach(x => {
        if (x.descanso_seg >= 20 && x.descanso_seg <= 600) vals.push(x.descanso_seg);
      });
    });
    if (vals.length < 2) return null;
    vals.sort((a, b) => a - b);
    return Math.round(vals[Math.floor(vals.length / 2)] / 5) * 5;
  };
  const conEj = db.sesiones.filter(s => s.series.some(x => x.ejercicio === ej));
  // Con rutina elegida: solo cuentan las sesiones de esa misma rutina.
  if (rut) {
    const propio = medir(conEj.filter(s => s.rutina_id === rut));
    if (propio) return propio;
    // Sin datos en esta rutina: se usa lo anterior sin rutina registrada (sesiones viejas o libres).
    return medir(conEj.filter(s => !s.rutina_id));
  }
  return medir(conEj.filter(s => !s.rutina_id));
}

function siguienteEnSuperserie(b) {
  if (!b.ss) return null;
  const grupo = borrador.bloques.filter(x => x.ss === b.ss);
  const i = grupo.indexOf(b);
  for (let k = i + 1; k < grupo.length; k++) if (grupo[k].filas.some(x => !x.hecho)) return grupo[k];
  return null;
}
// Texto "kg×reps" de la sesión anterior para cada fila: las series normales con las normales
// y los dropsets con los dropsets, en orden.
function referenciaAnterior(b, u) {
  const mapa = new Map();
  if (!u) return mapa;
  const lista = { normal: u.xs.filter(x => x.marca !== "descendente"), descendente: u.xs.filter(x => x.marca === "descendente") };
  const n = { normal: 0, descendente: 0 };
  b.filas.forEach(f => {
    if (f.marca === "calentamiento") return;
    const clave = f.marca === "descendente" ? "descendente" : "normal";
    const x = lista[clave][n[clave]++];
    if (x) mapa.set(f.id, `${fmtKg(x.kg)}×${x.reps}`);
  });
  return mapa;
}

// Dropset: agrega series descendentes (~20 % menos de peso cada una) justo después de la serie
// indicada (o del final del ejercicio si no se indica). Se hacen seguidas, sin descanso.
// Si a esa serie ya le siguen dropsets, suma uno más a la cadena.
function agregarDropset(b, desde = null) {
  let idx = desde ? b.filas.indexOf(desde) : b.filas.length - 1;
  if (idx < 0) return;
  if (b.filas[idx].marca === "calentamiento") { toast("Un dropset va después de una serie de trabajo, no del calentamiento"); return; }
  while (b.filas[idx + 1]?.marca === "descendente") idx++;
  const ref = b.filas[idx];
  const base = num(ref.kg || ref.okg);
  const reps = parseInt(ref.reps || ref.oreps) || 10;
  const cuantas = ref.marca === "descendente" ? 1 : 2;
  let kg = isNaN(base) ? 0 : base;
  const nuevas = [];
  for (let i = 0; i < cuantas; i++) {
    if (kg > 0) { const bajo = r25(kg * 0.8); kg = bajo < kg ? bajo : Math.max(0, kg - 2.5); }
    nuevas.push(filaNueva(kg > 0 ? kg : "", reps, "descendente"));
  }
  b.filas.splice(idx + 1, 0, ...nuevas);
  haptico(10);
  toast("Dropset agregado: bajá el peso y seguí sin descanso hasta el fallo");
}
const hayFilasPendientes = () => !!borrador?.bloques.some(b => b.filas.some(f => !f.hecho));
function proximaSerieTexto() {
  for (const b of borrador?.bloques || []) {
    const f = b.filas.find(x => !x.hecho);
    if (f) {
      const kg = f.kg || f.okg, reps = f.reps || f.oreps;
      return `Próxima: ${b.ej}${kg !== "" ? " · " + fmtKg(num(kg)) + " kg" : ""}${reps ? " × " + reps : ""}`;
    }
  }
  return "";
}

function desmarcar(b, f) {
  const ses = sesionActual();
  const serie = ses?.series.find(x => x.id === f.serieId);
  if (!serie) { f.hecho = false; f.serieId = null; renderSesion(); return; }
  ses.series = ses.series.filter(x => x.id !== serie.id);
  f.hecho = false; f.serieId = null;
  guardarBorrador();
  renderSesion();
  conDeshacer(`Serie de ${b.ej} desmarcada`,
    () => encolar({ t: "del", tabla: "series", id: serie.id }),
    () => { ses.series.push(serie); ses.series.sort((a, c) => a.created_at.localeCompare(c.created_at)); f.hecho = true; f.serieId = serie.id; guardarBorrador(); });
}

function actualizarHecha(b, f) {
  const ses = sesionActual();
  const s = ses?.series.find(x => x.id === f.serieId);
  if (!s) return;
  const v = valorFila(f);
  if (v.error) { alert(v.error); renderSesion(); return; }
  Object.assign(s, { kg: v.kg, reps: v.reps, rpe: v.rpe, tipo_serie: tipoDe({ reps: v.reps, kg: v.kg, rpe: v.rpe, ejercicio: s.ejercicio }) });
  encolar({ t: "upd", tabla: "series", id: s.id, cambios: { kg: s.kg, reps: s.reps, rpe: s.rpe, tipo_serie: s.tipo_serie } });
}

// ---------- Acciones de la planilla ----------
const pl = $("planilla");
pl.addEventListener("input", e => {
  const inp = e.target.closest("input[data-campo]");
  if (!inp) return;
  const b = buscarBloque(inp.closest("[data-b]").dataset.b);
  const f = b?.filas.find(x => x.id === inp.closest("[data-f]").dataset.f);
  if (!f) return;
  f[inp.dataset.campo] = inp.value.trim();
  guardarBorrador();
});
pl.addEventListener("change", e => {
  const inp = e.target.closest("input[data-campo]");
  if (!inp) return;
  const b = buscarBloque(inp.closest("[data-b]").dataset.b);
  const f = b?.filas.find(x => x.id === inp.closest("[data-f]").dataset.f);
  if (f?.hecho) actualizarHecha(b, f);
});
pl.addEventListener("click", e => {
  const btn = e.target.closest("[data-acc]");
  if (!btn) return;
  const b = buscarBloque(btn.closest("[data-b]")?.dataset.b);
  if (!b) return;
  const f = btn.closest("[data-f]") ? b.filas.find(x => x.id === btn.closest("[data-f]").dataset.f) : null;
  const acc = btn.dataset.acc;
  if (acc === "ok" && f) { if (f.hecho) desmarcar(b, f); else marcarHecha(b, f); return; }
  if (acc === "marca" && f) {
    f.marca = MARCAS[(MARCAS.indexOf(f.marca) + 1) % MARCAS.length];
    haptico(8);
    if (f.hecho) {
      const s = sesionActual()?.series.find(x => x.id === f.serieId);
      if (s) { s.marca = f.marca; encolar({ t: "upd", tabla: "series", id: s.id, cambios: { marca: f.marca } }); }
    }
    toast({ normal: "Serie normal", calentamiento: "Calentamiento: no cuenta para récords", descendente: "Descendente: sin descanso antes" }[f.marca]);
  }
  if (acc === "add") {
    const ult = b.filas[b.filas.length - 1];
    b.filas.push(filaNueva(ult ? (ult.kg || ult.okg) : "", ult ? (ult.reps || ult.oreps) : 10));
  }
  if (acc === "drop") agregarDropset(b);
  if (acc === "dropfila") agregarDropset(b, b.filas.find(x => x.id === btn.dataset.fref));
  if (acc === "cal") {
    const ref = Math.max(0, ...b.filas.filter(x => x.marca !== "calentamiento").map(x => num(x.kg || x.okg) || 0), mejorKgPrevio(b.ej, null, tipoObjetivo(b.ej)) * 0.8);
    if (!ref) return alert("Primero poné el peso de trabajo para calcular el calentamiento.");
    b.filas.unshift(filaNueva(r25(ref * 0.5), 8, "calentamiento"), filaNueva(r25(ref * 0.7), 5, "calentamiento"), filaNueva(r25(ref * 0.85), 3, "calentamiento"));
    toast("Calentamiento: 50 %, 70 % y 85 % del peso de trabajo");
  }
  if (acc === "mas") { if (masAbiertos.has(b.id)) masAbiertos.delete(b.id); else masAbiertos.add(b.id); }
  if (acc === "ss") alternarSuperserie(b);
  if (acc === "nota") editarNotaEjercicio(b.ej);
  if (acc === "quitar") return quitarBloque(b);
  if (acc === "subir" || acc === "bajar") {
    const arr = borrador.bloques, i = arr.indexOf(b), j = acc === "subir" ? i - 1 : i + 1;
    if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (acc === "borrarfila" && f && !f.hecho) b.filas = b.filas.filter(x => x !== f);
  guardarBorrador();
  renderSesion();
});

function alternarSuperserie(b) {
  const arr = borrador.bloques, i = arr.indexOf(b);
  if (b.ss) {
    const id = b.ss;
    b.ss = null;
    const resto = arr.filter(x => x.ss === id);
    if (resto.length < 2) resto.forEach(x => x.ss = null);
    toast("Superserie separada");
    return;
  }
  const sig = arr[i + 1];
  if (!sig) return toast("Agregá otro ejercicio abajo para unirlo en superserie");
  const usadas = new Set(arr.map(x => x.ss).filter(Boolean));
  const letra = sig.ss || "ABCDEFGH".split("").find(l => !usadas.has(l)) || "Z";
  b.ss = letra; sig.ss = letra;
  toast(`Superserie ${letra}: ${b.ej} + ${sig.ej}, sin descanso entre ellos`);
}

function quitarBloque(b) {
  const ses = sesionActual();
  const ids = new Set(b.filas.filter(f => f.hecho).map(f => f.serieId));
  const quitadas = ses ? ses.series.filter(x => ids.has(x.id)) : [];
  const pos = borrador.bloques.indexOf(b);
  borrador.bloques = borrador.bloques.filter(x => x !== b);
  if (ses) ses.series = ses.series.filter(x => !ids.has(x.id));
  guardarBorrador();
  renderSesion();
  conDeshacer(`${b.ej} quitado`,
    () => { if (quitadas.length) encolarVarios(quitadas.map(x => ({ t: "del", tabla: "series", id: x.id }))); },
    () => { borrador.bloques.splice(pos, 0, b); if (ses) { ses.series.push(...quitadas); ses.series.sort((a, c) => a.created_at.localeCompare(c.created_at)); } guardarBorrador(); });
}

// ---------- Notas fijas por ejercicio ----------
const notaDe = ej => (db.notas || []).find(n => n.ejercicio === ej)?.nota || "";
function editarNotaEjercicio(ej) {
  const n = prompt(`Nota fija para ${ej} (ej.: asiento en 4, agarre cerrado). Aparece cada vez que lo hacés.`, notaDe(ej));
  if (n === null) return;
  const texto = n.trim().slice(0, 200);
  let fila = db.notas.find(x => x.ejercicio === ej);
  if (!fila) { fila = { id: uid(), ejercicio: ej, nota: texto }; db.notas.push(fila); }
  fila.nota = texto;
  encolar({ t: "ins", tabla: "notas_ejercicio", fila: { id: fila.id, user_id: user.id, ejercicio: ej, nota: texto } });
  toast(texto ? "Nota guardada" : "Nota borrada");
}

// ---------- Repetir y terminar ----------
$("s-repetir").onclick = () => {
  const previas = sesionesConSeries().filter(s => s.id !== sesionActualId).sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!previas.length) return alert("No hay una sesión anterior para repetir.");
  const origen = previas[0];
  const bor = asegurarBorrador();
  const porEj = {};
  origen.series.forEach(x => (porEj[x.ejercicio] = porEj[x.ejercicio] || []).push(x));
  Object.entries(porEj).forEach(([ej, xs]) => {
    if (bor.bloques.some(b => b.ej === ej)) return;
    const b = nuevoBloque(ej, xs);
    b.ss = xs[0].superserie || null;
    bor.bloques.push(b);
  });
  guardarBorrador();
  renderSesion();
  toast(`Cargada la sesión del ${origen.fecha}: tildá cada serie al hacerla`);
};

function quitarSesion(id) {
  db.sesiones = db.sesiones.filter(s => s.id !== id);
  if (sesionActualId === id) sesionActualId = null;
  encolar({ t: "del", tabla: "sesiones", id });
}

$("s-cerrar").onclick = () => {
  confirmarPendiente();
  const ses = sesionActual();
  cerrarModo();
  cancelarTemporizador();
  if (rsId) $("rs-reset").click();
  restInicio = null;
  if (ses && !ses.series.length) quitarSesion(ses.id);
  const conSeries = ses && ses.series.length ? ses : null;
  sesionActualId = null;
  borrador = null;
  guardarBorrador();
  $("s-rutina").value = "";
  $("s-fecha").value = hoy();
  renderTodo();
  if (conSeries) mostrarResumen(conSeries);
  else toast("Sesión cerrada");
};

// ---------- Resumen al terminar ----------
function resumenDe(ses) {
  const t = trab(ses);
  const vol = t.reduce((a, x) => a + x.kg * x.reps, 0);
  const ejs = [...new Set(ses.series.map(x => x.ejercicio))];
  const tiempos = ses.series.map(x => Date.parse(x.created_at)).filter(Boolean).sort((a, b) => a - b);
  const est = estimarSesion(ses);
  const min = tiempos.length > 1 ? Math.round((tiempos[tiempos.length - 1] - tiempos[0]) / 60000) + 1 : est.min;
  const records = [];
  ejs.forEach(ej => {
    const xs = t.filter(x => x.ejercicio === ej);
    if (!xs.length) return;
    const kg = Math.max(...xs.map(x => x.kg));
    const previo = mejorKgPrevio(ej, ses.id);
    if (kg > 0 && previo > 0 && kg > previo) records.push(`${ej}: ${fmtKg(kg)} kg (antes ${fmtKg(previo)})`);
  });
  // Sesión anterior parecida: la última que comparta al menos la mitad de los ejercicios.
  const previa = db.sesiones
    .filter(s => s.id !== ses.id && s.series.length && s.fecha <= ses.fecha)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .find(s => { const e2 = new Set(s.series.map(x => x.ejercicio)); return ejs.filter(e => e2.has(e)).length >= Math.ceil(ejs.length / 2); });
  let comp = null;
  if (previa) {
    const comunes = new Set(ejs.filter(e => previa.series.some(x => x.ejercicio === e)));
    const v1 = t.filter(x => comunes.has(x.ejercicio)).reduce((a, x) => a + x.kg * x.reps, 0);
    const v0 = trab(previa).filter(x => comunes.has(x.ejercicio)).reduce((a, x) => a + x.kg * x.reps, 0);
    if (v0 > 0) comp = { fecha: previa.fecha, pct: Math.round((v1 - v0) / v0 * 100) };
  }
  return { vol, series: t.length, ejs: ejs.length, min, kcal: est.conPeso ? est.kcal : null, records, comp };
}
function mostrarResumen(ses) {
  const r = resumenDe(ses);
  $("res-cuerpo").innerHTML = `
    <div class="res-titulo">${r.records.length ? "¡Sesión con récords!" : "¡Sesión terminada!"}</div>
    <div class="mut">${esc(ses.fecha)}</div>
    <div class="kpis res-kpis">
      <div class="kpi"><small>Duración</small><b>${r.min}<span>min</span></b></div>
      <div class="kpi c2"><small>Volumen</small><b>${Math.round(r.vol).toLocaleString("es-AR")}<span>kg</span></b></div>
      <div class="kpi c3"><small>Series</small><b>${r.series}<span>${r.ejs} ejerc.</span></b></div>
      <div class="kpi c4"><small>Calorías</small><b>${r.kcal === null ? "—" : "~" + r.kcal}<span>${r.kcal === null ? "cargá peso" : "orientativo"}</span></b></div>
    </div>
    ${r.comp ? `<p class="res-comp ${r.comp.pct > 0 ? "pos" : r.comp.pct < 0 ? "neg" : ""}">${r.comp.pct > 0 ? "▲ +" : r.comp.pct < 0 ? "▼ " : "= "}${r.comp.pct}% de volumen que la vez anterior (${esc(r.comp.fecha)}) en los mismos ejercicios</p>` : ""}
    ${r.records.length ? `<div class="res-records"><b>🏆 Récords</b>${r.records.map(x => `<div>${esc(x)}</div>`).join("")}</div>` : ""}`;
  $("resumen").classList.remove("hidden");
  if (r.records.length) haptico(60);
}
$("res-cerrar").onclick = () => $("resumen").classList.add("hidden");
$("resumen").querySelector(".res-fondo").onclick = () => $("resumen").classList.add("hidden");

// ---------- Editar historial ----------
function borrarSerie(sesId, serieId) {
  const ses = db.sesiones.find(s => s.id === sesId);
  const serie = ses?.series.find(x => x.id === serieId);
  if (!serie) return;
  ses.series = ses.series.filter(x => x.id !== serieId);
  guardarTodo();
  renderTodo();
  conDeshacer(`Serie de ${serie.ejercicio} borrada`,
    () => encolar({ t: "del", tabla: "series", id: serieId }),
    () => { ses.series.push(serie); ses.series.sort((a, b) => a.created_at.localeCompare(b.created_at)); });
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
$("s-nota").onchange = () => {
  const ses = sesionActual();
  if (!ses) return toast("Tildá una serie primero para guardar la nota");
  ses.notas = $("s-nota").value.trim();
  encolar({ t: "upd", tabla: "sesiones", id: ses.id, cambios: { notas: ses.notas || null } });
};
function editarNota(sesId) {
  const ses = db.sesiones.find(s => s.id === sesId);
  if (!ses) return;
  const n = prompt("Nota de la sesión (cómo te sentiste, sueño, molestias)", ses.notas || "");
  if (n === null) return;
  ses.notas = n.trim();
  encolar({ t: "upd", tabla: "sesiones", id: sesId, cambios: { notas: ses.notas || null } });
}
function borrarSesionConfirm(id) {
  const ses = db.sesiones.find(s => s.id === id);
  if (!ses) return;
  const pos = db.sesiones.indexOf(ses);
  db.sesiones = db.sesiones.filter(s => s !== ses);
  guardarTodo();
  renderTodo();
  conDeshacer(`Sesión del ${ses.fecha} borrada`,
    () => encolar({ t: "del", tabla: "sesiones", id }),
    () => db.sesiones.splice(pos, 0, ses));
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

// ---------- ¿Qué entreno hoy? ----------
const GRUPOS_MUSC = ["Pecho", "Espalda", "Hombros", "Piernas", "Glúteos", "Brazos", "Core"];
const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function ultimoPorGrupo() {
  const ult = {};
  sesionesConSeries().forEach(s => trab(s).forEach(x => {
    const g = grupoDe(x.ejercicio);
    if (!ult[g] || s.fecha > ult[g]) ult[g] = s.fecha;
  }));
  return ult;
}
// Días desde la última sesión que se parece a la rutina (comparte 60 % de sus ejercicios).
function diasDesdeRutina(r) {
  const set = new Set(r.ejercicios);
  const s = sesionesConSeries().slice().reverse().find(s => {
    const e = new Set(s.series.map(x => x.ejercicio));
    return [...set].filter(x => e.has(x)).length >= Math.ceil(set.size * 0.6);
  });
  return s ? diasEntre(s.fecha, hoy()) : 30;
}
function sugerenciaHoy() {
  const ult = ultimoPorGrupo();
  const dias = g => ult[g] ? diasEntre(ult[g], hoy()) : 30;
  const hoyNombre = DIAS_SEMANA[new Date().getDay()];
  let mejor = null;
  db.rutinas.forEach(r => {
    const gs = [...new Set(r.ejercicios.map(grupoDe))].filter(g => GRUPOS_MUSC.includes(g));
    if (!gs.length) return;
    let score = promedio(gs.map(g => Math.min(dias(g), 4)));
    if (gs.some(g => dias(g) < 1)) score -= 4;
    if (r.nombre.startsWith(hoyNombre + " · ")) score += 3;
    score += Math.min(diasDesdeRutina(r), 10) * 0.25;
    if (!mejor || score > mejor.score) mejor = { r, score, gs };
  });
  const cansados = GRUPOS_MUSC.filter(g => dias(g) < 2 && ult[g]);
  const frescos = GRUPOS_MUSC.filter(g => dias(g) >= 2).sort((a, b) => dias(b) - dias(a));
  return { mejor, cansados, frescos, dias };
}
function renderHoy() {
  const abierta = !!(sesionActual() || borrador?.bloques.length);
  $("hoy").classList.toggle("hidden", abierta);
  if (abierta) return;
  const s = sugerenciaHoy();
  const chip = g => `<span class="musc ${s.dias(g) < 2 ? "cansado" : "fresco"}">${esc(g)} <small>${s.dias(g) >= 30 ? "—" : s.dias(g) === 0 ? "hoy" : s.dias(g) + " d"}</small></span>`;
  if (s.mejor) {
    const frescosR = s.mejor.gs.filter(g => s.dias(g) >= 2);
    $("hoy-cuerpo").innerHTML = `
      <div class="hoy-rutina">${esc(s.mejor.r.nombre)}</div>
      <div class="mut">${frescosR.length ? esc(frescosR.join(", ")) + " ya descansaron." : "Algunos músculos de esta rutina todavía se están recuperando."}</div>
      <div class="muscs">${GRUPOS_MUSC.map(chip).join("")}</div>
      <div class="row" style="margin:12px 0 0"><button class="btn cy" id="hoy-empezar">Empezar esta rutina</button></div>`;
    $("hoy-empezar").onclick = () => { haptico(15); cargarRutina(s.mejor.r.id); };
  } else {
    $("hoy-cuerpo").innerHTML = `
      <div class="mut">${s.frescos.length ? "Lo más descansado: <b>" + esc(s.frescos.slice(0, 3).join(", ")) + "</b>." : "Creá una rutina para que te sugiera cuál hacer."}</div>
      <div class="muscs">${GRUPOS_MUSC.map(chip).join("")}</div>`;
  }
}

// ---------- Dibujo de la planilla ----------
function reconciliar() {
  if (!borrador) return;
  const ses = sesionActual();
  const ids = new Set(ses ? ses.series.map(x => x.id) : []);
  borrador.bloques.forEach(b => b.filas.forEach(f => { if (f.hecho && !ids.has(f.serieId)) { f.hecho = false; f.serieId = null; } }));
  if (ses) {
    const usados = new Set(borrador.bloques.flatMap(b => b.filas.map(f => f.serieId)).filter(Boolean));
    ses.series.forEach(x => {
      if (usados.has(x.id)) return;
      let b = borrador.bloques.find(b => b.ej === x.ejercicio);
      if (!b) { b = { id: uid(), ej: x.ejercicio, ss: x.superserie || null, desc: null, meta: "", filas: [] }; borrador.bloques.push(b); }
      const libre = b.filas.find(f => !f.hecho);
      const fila = filaDeSerie(x);
      if (libre) b.filas.splice(b.filas.indexOf(libre), 0, fila); else b.filas.push(fila);
    });
  }
}

function renderPlanilla() {
  if (!borrador && sesionActual()) borrador = { sesionId: sesionActualId, fecha: sesionActual().fecha, rutinaId: sesionActual().rutina_id || null, bloques: [] };
  reconciliar();
  const bl = borrador?.bloques || [];
  if (!bl.length) {
    pl.innerHTML = `<p class="mut vacio">Elegí una rutina, tocá «Repetir última sesión» o agregá un ejercicio para armar la planilla.</p>`;
    return;
  }
  const totF = bl.reduce((a, b) => a + b.filas.length, 0);
  const hechasT = bl.reduce((a, b) => a + b.filas.filter(f => f.hecho).length, 0);
  const progreso = `<div class="pl-prog" aria-label="Progreso de la sesión"><span>${hechasT}/${totF} series</span><div class="barra"><div style="width:${totF ? Math.round(hechasT / totF * 100) : 0}%"></div></div><button class="chip" data-foco="">Modo foco</button></div>`;
  pl.innerHTML = progreso + bl.map((b, i) => {
    const u = ultimaSesionDe(b.ej);
    const nota = notaDe(b.ej);
    let nTrab = 0;
    const refs = referenciaAnterior(b, u);
    const filas = b.filas.map((f, k) => {
      const esCal = f.marca === "calentamiento";
      const tiraDrop = !esCal && b.filas[k + 1]?.marca !== "descendente"
        ? `<button class="f-drop" data-acc="dropfila" data-fref="${f.id}" aria-label="Agregar dropset después de esta serie">↓ ${f.marca === "descendente" ? "otro descenso" : "dropset"}</button>` : "";
      const etiqueta = esCal ? "C" : f.marca === "descendente" ? "D" : String(++nTrab);
      const ant = f.etq || refs.get(f.id) || "—";
      return `
        <div class="fila ${f.hecho ? "hecha" : ""} ${esCal ? "cal" : ""} ${f.marca === "descendente" ? "drop" : ""}" data-f="${f.id}">
          <button class="f-num" data-acc="marca" aria-label="Tipo de serie: ${f.marca}. Tocá para cambiar">${etiqueta}</button>
          <span class="f-ant">${esc(ant)}</span>
          <input data-campo="kg" inputmode="decimal" value="${esc(f.kg)}" placeholder="${esc(f.okg ? fmtKg(num(f.okg)) : "kg")}" aria-label="Kilos">
          <input data-campo="reps" inputmode="numeric" value="${esc(f.reps)}" placeholder="${esc(f.oreps || "reps")}" aria-label="Repeticiones">
          <input data-campo="rpe" inputmode="decimal" value="${esc(f.rpe)}" placeholder="–" aria-label="RPE del 1 al 10">
          <button class="f-ok" data-acc="ok" aria-pressed="${f.hecho}" aria-label="${f.hecho ? "Desmarcar serie" : "Marcar serie hecha"}">✓</button>
          ${f.hecho ? "" : `<button class="f-x" data-acc="borrarfila" aria-label="Quitar fila">×</button>`}
        </div>${tiraDrop}`;
    }).join("");
    const hechas = b.filas.filter(f => f.hecho).length;
    return `
      <div class="bloque ${b.ss ? "ss ss-" + b.ss : ""}" data-b="${b.id}">
        <div class="bl-cab">
          <div class="bl-tit"><b>${esc(b.ej)}</b>${b.ss ? `<span class="ss-tag">Superserie ${b.ss}</span>` : ""}</div>
          <span class="bl-cont">${hechas}/${b.filas.length}</span>
          <button class="bl-mov" data-foco="${b.id}" aria-label="Ver este ejercicio en grande">⤢</button>
          <button class="bl-mov" data-acc="subir" aria-label="Subir ejercicio" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="bl-mov" data-acc="bajar" aria-label="Bajar ejercicio" ${i === bl.length - 1 ? "disabled" : ""}>↓</button>
        </div>
        ${nota ? `<div class="bl-nota">📝 ${esc(nota)}</div>` : ""}
        ${b.meta ? `<div class="bl-meta">${esc(b.meta)}</div>` : ""}
        <div class="fila cab"><span>Serie</span><span>Antes</span><span>Kg</span><span>Reps</span><span>RPE</span><span></span></div>
        ${filas}
        <div class="bl-acc ${masAbiertos.has(b.id) ? "mas-abierto" : ""}">
          <button class="chip" data-acc="add">+ Serie</button>
          <button class="chip" data-acc="cal">+ Calentamiento</button>
          <button class="chip chip-mas" data-acc="mas" aria-expanded="${masAbiertos.has(b.id)}">${masAbiertos.has(b.id) ? "Menos ▴" : "Más ▾"}</button>
          <button class="chip chip-sec" data-acc="ss">${b.ss ? "Separar" : "Superserie ↓"}</button>
          <button class="chip chip-sec" data-acc="nota">Nota</button>
          <button class="chip peligro chip-sec" data-acc="quitar">Quitar</button>
        </div>
      </div>`;
  }).join("");
}

function renderSesion() {
  const ses = sesionActual();
  const bor = borrador;
  const nHechas = ses ? ses.series.length : 0;
  $("s-estado-sesion").textContent = ses ? `${nHechas} series · ${ses.fecha}` : (bor?.bloques.length ? "planilla lista" : "sin sesión");
  if (document.activeElement !== $("s-nota")) $("s-nota").value = ses?.notas || "";
  $("s-nota").classList.toggle("hidden", !ses);
  if (ses && ses.series.length) {
    const e = estimarSesion(ses);
    $("s-kcal").textContent = e.conPeso ? `Estimado: ~${e.kcal} kcal · ~${e.min} min (orientativo)` : `Cargá tu peso para estimar calorías · ~${e.min} min`;
  } else $("s-kcal").textContent = "";
  $("s-cerrar").classList.toggle("hidden", !(ses || bor?.bloques.length));
  renderHoy();
  renderPlanilla();
  renderHistorial();
  renderFoco();
}

function renderHistorial() {
  const hist = db.sesiones.filter(s => s.id !== sesionActualId && s.series.length).slice(-10).reverse();
  const marcaTxt = x => x.marca === "calentamiento" ? " <span class='tag'>C</span>" : x.marca === "descendente" ? " <span class='tag'>D</span>" : "";
  $("s-historial").innerHTML = hist.length ? hist.map(s => {
    const lista = [...new Set(s.series.map(x => x.ejercicio))];
    const vol = trab(s).reduce((a, x) => a + x.reps * x.kg, 0);
    const rut = s.rutina_id ? db.rutinas.find(r => r.id === s.rutina_id)?.nombre : null;
    const grupos = [...new Set(lista.map(grupoDe))].filter(g => g !== "Otro").slice(0, 3).join(" · ");
    const titulo = rut || grupos || "Sesión";
    const vista = lista.slice(0, 3).map(nombreBonito).join(", ") + (lista.length > 3 ? ` +${lista.length - 3}` : "");
    return `
      <details class="hist">
        <summary>
          <span class="h-fecha">${esc(fechaCorta(s.fecha))}</span>
          <span class="h-cuerpo">
            <b class="h-tit">${esc(nombreBonito(titulo))}</b>
            <span class="mut h-ejs">${esc(vista)}</span>
            <span class="h-chips"><i>${trab(s).length} series</i><i>${Math.round(vol).toLocaleString("es-AR")} kg</i>${s.notas ? `<i title="${esc(s.notas)}">📝 nota</i>` : ""}</span>
          </span>
        </summary>
        <div class="cuerpo">
          <div class="row">
            <input type="date" value="${s.fecha}" style="max-width:190px" onchange="cambiarFecha('${s.id}', this.value)" aria-label="Fecha de la sesión">
            <button class="btn sec mini fijo" onclick="editarNota('${s.id}')">Nota</button>
            <button class="btn peligro mini fijo" onclick="borrarSesionConfirm('${s.id}')">Borrar sesión</button>
          </div>
          <table>
            <thead><tr><th>Ejercicio</th><th>Reps</th><th>Kg</th><th>RPE</th><th></th></tr></thead>
            <tbody>${s.series.map(x => `
              <tr>
                <td>${esc(nombreBonito(x.ejercicio))}${marcaTxt(x)}</td><td>${x.reps}</td><td>${fmtKg(x.kg)}</td><td>${x.rpe ?? "-"}</td>
                <td style="white-space:nowrap">
                  <button class="btn sec mini" onclick="editarSerie('${s.id}','${x.id}')">Editar</button>
                  <button class="btn peligro mini" onclick="borrarSerie('${s.id}','${x.id}')" aria-label="Borrar serie">×</button>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </details>`;
  }).join("") : '<p class="mut">Todavía no hay sesiones cerradas.</p>';
}


// ============================================================
// Modo foco: una serie a la vez, en grande. Se desliza para pasar a la siguiente.
// ============================================================
let focoFilaId = null;
let focoDir = 0;      // -1 = vino de la izquierda, 1 = vino de la derecha (animación)
const focoAbierto = () => !$("foco").classList.contains("hidden");
const listaFoco = () => (borrador?.bloques || []).flatMap(b => b.filas.map(f => ({ b, f })));
const primeraPendiente = (lista, desde = 0) => {
  for (let i = desde; i < lista.length; i++) if (!lista[i].f.hecho) return i;
  return -1;
};

function abrirFoco(bloqueId) {
  const lista = listaFoco();
  if (!lista.length) return toast("Primero armá la planilla: elegí una rutina o agregá un ejercicio");
  let i = -1;
  if (bloqueId) i = lista.findIndex(x => x.b.id === bloqueId && !x.f.hecho);
  if (i < 0) i = primeraPendiente(lista);
  if (i < 0) i = 0;
  focoFilaId = lista[i].f.id;
  focoDir = 0;
  $("foco").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderFoco(true);
}
function cerrarFoco() {
  $("foco").classList.add("hidden");
  document.body.style.overflow = "";
  focoFilaId = null;
}
function irAFoco(delta) {
  const lista = listaFoco();
  const i = lista.findIndex(x => x.f.id === focoFilaId);
  const j = i + delta;
  if (j < 0 || j >= lista.length) { haptico(6); return; }
  focoFilaId = lista[j].f.id;
  focoDir = delta;
  haptico(8);
  renderFoco(true);
}

function renderFoco(forzar = false) {
  if (!focoAbierto()) return;
  const el = $("foco");
  // No se redibuja mientras escribís (el teclado se cerraría).
  if (!forzar && el.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  const lista = listaFoco();
  if (!lista.length) return cerrarFoco();
  let i = lista.findIndex(x => x.f.id === focoFilaId);
  if (i < 0) { i = Math.max(0, primeraPendiente(lista)); focoFilaId = lista[i].f.id; }
  const { b, f } = lista[i];
  const bi = borrador.bloques.indexOf(b);
  const u = ultimaSesionDe(b.ej);
  const refs = referenciaAnterior(b, u);
  let nSerie = 0, totSeries = b.filas.filter(x => x.marca !== "calentamiento" && x.marca !== "descendente").length;
  for (const x of b.filas) { if (x.marca !== "calentamiento" && x.marca !== "descendente") nSerie++; if (x === f) break; }
  const esCal = f.marca === "calentamiento", esDrop = f.marca === "descendente";
  const titulo = esCal ? "Calentamiento" : esDrop ? "Dropset ↓" : `Serie ${nSerie} de ${totSeries}`;
  const ant = f.etq || refs.get(f.id) || "";
  const total = lista.length, hechas = lista.filter(x => x.f.hecho).length;
  const puntos = b.filas.map(x => `<i class="${x.hecho ? "ok" : ""} ${x.id === f.id ? "ahora" : ""} ${x.marca === "descendente" ? "d" : ""}"></i>`).join("");
  const kgPh = f.okg ? fmtKg(num(f.okg)) : "kg";
  const rpes = [6, 7, 8, 9, 10].map(n => `<button class="${num(f.rpe) === n ? "on" : ""}" data-fa="rpe" data-v="${n}" aria-pressed="${num(f.rpe) === n}">${n}</button>`).join("");
  const nota = notaDe(b.ej);
  el.innerHTML = `
    <div class="fo-top">
      <button class="fo-x" data-fa="cerrar" aria-label="Cerrar modo foco">✕</button>
      <div class="fo-prog"><span>${hechas}/${total} series</span><div class="barra"><div style="width:${total ? Math.round(hechas / total * 100) : 0}%"></div></div></div>
    </div>
    <div class="fo-card ${focoDir > 0 ? "de-der" : focoDir < 0 ? "de-izq" : ""} ${esDrop ? "drop" : ""} ${esCal ? "cal" : ""} ${f.hecho ? "hecha" : ""}">
      <div class="fo-ej">Ejercicio ${bi + 1} de ${borrador.bloques.length}${b.ss ? " · Superserie " + b.ss : ""}</div>
      <h2 class="fo-nombre">${esc(b.ej)}</h2>
      <div class="fo-serie">${titulo}</div>
      <div class="fo-puntos" aria-hidden="true">${puntos}</div>
      ${b.meta ? `<div class="fo-meta">${esc(b.meta)}</div>` : ""}
      ${nota ? `<div class="fo-meta">📝 ${esc(nota)}</div>` : ""}
      ${esDrop ? `<div class="fo-meta fo-aviso">Dropset: bajá el peso y seguí sin descansar, hasta el fallo.</div>` : ""}
      <div class="fo-ant">${ant ? `La vez anterior: <b>${esc(ant)}</b>` : "Sin dato de la vez anterior"}</div>
      <div class="fo-campo">
        <label for="fo-kg">Kilos</label>
        <div class="fo-fila">
          <button data-fa="kg" data-v="-2.5" aria-label="Menos 2,5 kilos">−</button>
          <input id="fo-kg" data-campo="kg" inputmode="decimal" value="${esc(f.kg)}" placeholder="${esc(kgPh)}" aria-label="Kilos">
          <button data-fa="kg" data-v="2.5" aria-label="Más 2,5 kilos">+</button>
        </div>
      </div>
      <div class="fo-campo">
        <label for="fo-reps">Repeticiones</label>
        <div class="fo-fila">
          <button data-fa="reps" data-v="-1" aria-label="Una repetición menos">−</button>
          <input id="fo-reps" data-campo="reps" inputmode="numeric" value="${esc(f.reps)}" placeholder="${esc(f.oreps || "reps")}" aria-label="Repeticiones">
          <button data-fa="reps" data-v="1" aria-label="Una repetición más">+</button>
        </div>
      </div>
      <div class="fo-campo">
        <label>RPE <small>(qué tan duro fue, opcional)</small></label>
        <div class="fo-rpe">${rpes}</div>
      </div>
      <button class="fo-ok ${f.hecho ? "des" : ""}" data-fa="ok">${f.hecho ? "✓ Hecha · tocá para desmarcar" : esDrop ? "✓ Dropset hecho" : "✓ Serie hecha"}</button>
      <div class="fo-mas">
        <button class="chip" data-fa="drop">↓ Dropset después de esta</button>
        <button class="chip" data-fa="add">+ Serie</button>
      </div>
    </div>
    <div class="fo-nav">
      <button data-fa="ant" ${i === 0 ? "disabled" : ""} aria-label="Serie anterior">‹ Anterior</button>
      <span class="fo-hint">Deslizá ↔</span>
      <button data-fa="sig" ${i === lista.length - 1 ? "disabled" : ""} aria-label="Serie siguiente">Siguiente ›</button>
    </div>`;
  focoDir = 0;
}

// Después de marcar una serie, el foco pasa solo a la siguiente pendiente.
function avanzarFocoTrasHecha(b) {
  const lista = listaFoco();
  const ss = siguienteEnSuperserie(b);
  let j = -1;
  if (ss) j = lista.findIndex(x => x.b === ss && !x.f.hecho);
  if (j < 0) {
    const i = lista.findIndex(x => x.f.id === focoFilaId);
    j = primeraPendiente(lista, i + 1);
    if (j < 0) j = primeraPendiente(lista);
  }
  if (j >= 0) { focoDir = 1; focoFilaId = lista[j].f.id; }
  else toast("¡Terminaste todo lo planeado! Cerrá el foco y tocá «Terminar sesión»");
}

$("foco").addEventListener("input", e => {
  const inp = e.target.closest("input[data-campo]");
  if (!inp) return;
  const x = listaFoco().find(y => y.f.id === focoFilaId);
  if (!x) return;
  x.f[inp.dataset.campo] = inp.value.trim();
  guardarBorrador();
});
$("foco").addEventListener("change", e => {
  const inp = e.target.closest("input[data-campo]");
  const x = inp && listaFoco().find(y => y.f.id === focoFilaId);
  if (x?.f.hecho) actualizarHecha(x.b, x.f);
});
$("foco").addEventListener("click", e => {
  const btn = e.target.closest("[data-fa]");
  if (!btn) return;
  const a = btn.dataset.fa;
  if (a === "cerrar") return cerrarFoco();
  if (a === "ant") return irAFoco(-1);
  if (a === "sig") return irAFoco(1);
  const x = listaFoco().find(y => y.f.id === focoFilaId);
  if (!x) return;
  const { b, f } = x;
  if (a === "kg" || a === "reps") {
    const campo = a;
    const base = num(f[campo] !== "" ? f[campo] : (f["o" + campo] !== "" ? f["o" + campo] : 0)) || 0;
    const paso = num(btn.dataset.v);
    const nuevo = Math.max(0, Math.round((base + paso) * 100) / 100);
    f[campo] = campo === "kg" ? fmtKg(nuevo) : String(Math.round(nuevo));
    $(campo === "kg" ? "fo-kg" : "fo-reps").value = f[campo];
    haptico(6);
    guardarBorrador();
    if (f.hecho) actualizarHecha(b, f);
    return;
  }
  if (a === "rpe") {
    const n = btn.dataset.v;
    f.rpe = String(f.rpe) === n ? "" : n;
    guardarBorrador();
    if (f.hecho) actualizarHecha(b, f);
    return renderFoco(true);
  }
  if (a === "ok") {
    if (f.hecho) { desmarcar(b, f); return renderFoco(true); }
    marcarHecha(b, f);
    if (f.hecho) { haptico(20); avanzarFocoTrasHecha(b); }
    return renderFoco(true);
  }
  if (a === "drop") { agregarDropset(b, f); guardarBorrador(); renderSesion(); return renderFoco(true); }
  if (a === "add") {
    const ult = b.filas[b.filas.length - 1];
    b.filas.push(filaNueva(ult ? (ult.kg || ult.okg) : "", ult ? (ult.reps || ult.oreps) : 10));
    guardarBorrador(); renderSesion(); return renderFoco(true);
  }
});

// Deslizar: izquierda = siguiente, derecha = anterior.
(() => {
  let x0 = null, y0 = null;
  const el = $("foco");
  el.addEventListener("touchstart", e => {
    if (e.target.closest("input")) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) irAFoco(dx < 0 ? 1 : -1);
  }, { passive: true });
})();
document.addEventListener("keydown", e => {
  if (!focoAbierto()) return;
  if (e.key === "Escape") cerrarFoco();
  else if (e.key === "ArrowRight" && !e.target.closest?.("input")) irAFoco(1);
  else if (e.key === "ArrowLeft" && !e.target.closest?.("input")) irAFoco(-1);
});

// Botones «Modo foco» y «⤢» de la planilla.
pl.addEventListener("click", e => {
  const btn = e.target.closest("[data-foco]");
  if (btn) abrirFoco(btn.dataset.foco || null);
});
