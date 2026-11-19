// ============================================================
// rutinas.js — catálogo, rutinas, plan semanal y programas.
// ============================================================

let rutinaBorrador = [];
let rutinaEditandoId = null;

function renderPicker() {
  const grupos = {};
  catalogo().forEach(e => (grupos[e.grupo] = grupos[e.grupo] || []).push(e.nombre));
  $("r-picker").innerHTML = Object.entries(grupos).map(([g, nombres]) => `
    <div class="pick-grupo">
      <div class="pick-tit">${esc(g)}</div>
      <div class="chips">${nombres.map(n => `<button class="chip${rutinaBorrador.includes(n) ? " on" : ""}" data-pick="${esc(n)}" aria-pressed="${rutinaBorrador.includes(n)}">${esc(n)}</button>`).join("")}</div>
    </div>`).join("") || '<p class="mut">Todavía no hay ejercicios en el catálogo.</p>';
  $("r-elegidos").textContent = rutinaBorrador.length ? "Elegidos: " + rutinaBorrador.join(" · ") : "Ninguno elegido todavía.";
}
$("r-picker").onclick = e => {
  const b = e.target.closest("button[data-pick]");
  if (!b) return;
  const n = b.dataset.pick;
  rutinaBorrador = rutinaBorrador.includes(n) ? rutinaBorrador.filter(x => x !== n) : [...rutinaBorrador, n];
  haptico(8);
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
function filaRutina(r) {
  return { id: r.id, user_id: user.id, nombre: r.nombre, ejercicios: r.ejercicios, esquema: r.esquema ?? null };
}
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
  const i = db.rutinas.findIndex(x => x.id === id);
  // Al editar se conserva el esquema del programa (series, reps y descanso).
  const r = { id, nombre, ejercicios: [...rutinaBorrador], esquema: i >= 0 ? db.rutinas[i].esquema ?? null : null };
  if (i >= 0) db.rutinas[i] = r; else db.rutinas.push(r);
  encolar({ t: "ins", tabla: "rutinas", fila: filaRutina(r) });
  rutinaEditandoId = null;
  $("r-guardar").textContent = "Guardar rutina";
  $("r-nombre").value = ""; rutinaBorrador = []; renderPicker();
  toast(i >= 0 ? "Rutina actualizada" : "Rutina guardada");
};
function borrarRutina(id) {
  const r = db.rutinas.find(x => x.id === id);
  if (!r) return;
  const pos = db.rutinas.indexOf(r);
  db.rutinas = db.rutinas.filter(x => x !== r);
  guardarTodo();
  renderTodo();
  conDeshacer(`Rutina «${r.nombre}» borrada`,
    () => encolar({ t: "del", tabla: "rutinas", id }),
    () => db.rutinas.splice(pos, 0, r));
}

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
  if (elegidos.length < 3) tomar([...POOLS.fuerza[tipoDia], ...POOLS.hipertrofia[tipoDia]], 5, false);
  return elegidos;
}
// Series, repeticiones y descanso por ejercicio según el objetivo.
function esquemaPara(ejercicios, objetivo) {
  const ej = {};
  ejercicios.forEach((n, i) => {
    if (objetivo === "hipertrofia") ej[n] = { s: 3, rmin: 8, rmax: 12, d: 90 };
    else if (i === 0) ej[n] = { s: 4, rmin: 3, rmax: 5, d: 150 };
    else ej[n] = objetivo === "fuerza" ? { s: 3, rmin: 8, rmax: 10, d: 120 } : { s: 3, rmin: 8, rmax: 12, d: 90 };
  });
  return ej;
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

const esDePlan = r => /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado) · /.test(r.nombre);
const esDePrograma = r => r.nombre.startsWith("Programa · ");
function reemplazarRutinas(filtro, texto) {
  const viejas = db.rutinas.filter(filtro);
  if (viejas.length && !confirm(`Ya tenés ${viejas.length} rutinas ${texto}. ¿Reemplazarlas?`)) return false;
  viejas.forEach(r => { db.rutinas = db.rutinas.filter(x => x.id !== r.id); cola.push({ t: "del", tabla: "rutinas", id: r.id }); });
  return true;
}

$("pl-generar").onclick = () => {
  if (!plDias.length) return alert("Elegí al menos un día.");
  if (!reemplazarRutinas(esDePlan, "de un plan semanal")) return;
  const nombresCat = new Set(catalogo().map(e => e.nombre));
  const plantilla = PLANTILLAS[Math.min(plDias.length, 6)];
  const creadas = [], ops = [];
  const usados = new Set();
  const etiqueta = { fuerza: "fuerza", hipertrofia: "hipertrofia", ambos: "fuerza + hipertrofia" }[plObjetivo];
  plDias.slice(0, plantilla.length).forEach((dia, i) => {
    const [titulo, tipoDia] = plantilla[i];
    const ejercicios = elegirEjercicios(tipoDia, plObjetivo, usados, nombresCat);
    if (!ejercicios.length) return;
    ejercicios.forEach(n => usados.add(n));
    const r = { id: uid(), nombre: `${DIAS_NOMBRE[dia]} · ${titulo} (${etiqueta})`, ejercicios, esquema: { prog: "plan", inicio: hoy(), ciclo: 0, ej: esquemaPara(ejercicios, plObjetivo) } };
    db.rutinas.push(r);
    ops.push({ t: "ins", tabla: "rutinas", fila: filaRutina(r) });
    creadas.push(r.nombre);
  });
  encolarVarios(ops);
  $("pl-guia").innerHTML = creadas.length
    ? `<div class="objetivo">${creadas.map(esc).join("<br>")}</div>
       <p class="mut"><b>Cómo entrenar:</b> ${esc(GUIA[plObjetivo])}</p>
       <p class="mut">Al elegir la rutina en Sesión, la planilla ya trae las series, las repeticiones y el peso sugerido.</p>`
    : '<p class="mut">No encontré ejercicios de esos grupos en tu catálogo. Agregá algunos en "Nuevo ejercicio".</p>';
  toast(`Plan creado · ${creadas.length} rutinas`);
};

// ---------- Programas conocidos ----------
// Progresión doble: cuando todas las series llegan al tope de repeticiones, se sube la carga.
// Cada 4 semanas, una de descarga (menos series y 10 % menos de peso).
const PROGRAMAS = {
  ppl: { nombre: "Empuje / Tirón / Piernas", desc: "6 días · dos vueltas por semana", dias: [["Empuje A", "push"], ["Tirón A", "pull"], ["Piernas A", "legs"], ["Empuje B", "push"], ["Tirón B", "pull"], ["Piernas B", "legs"]] },
  ppl3: { nombre: "Empuje / Tirón / Piernas · 3 días", desc: "3 días · cada grupo una vez por semana, ideal con poco tiempo", dias: [["Empuje", "push"], ["Tirón", "pull"], ["Piernas", "legs"]],
    // Con una sola vuelta por semana, cada día lleva una lista propia y completa.
    fijos: {
      push: ["Press banca", "Press militar", "Press inclinado con mancuernas", "Elevaciones laterales", "Extensión de tríceps en polea"],
      pull: ["Dominadas", "Remo con barra", "Face pull", "Curl de bíceps con barra", "Curl martillo"],
      legs: ["Sentadilla", "Peso muerto rumano", "Prensa 45°", "Curl de piernas", "Elevación de talones"]
    } },
  tp: { nombre: "Torso / Pierna", desc: "4 días · cada músculo 2 veces por semana", dias: [["Torso A", "sup"], ["Pierna A", "inf"], ["Torso B", "sup"], ["Pierna B", "inf"]] },
  fb: { nombre: "Full body", desc: "3 días · ideal para empezar o con poco tiempo", dias: [["Full body A", "fb"], ["Full body B", "fb"], ["Full body C", "fb"]] },
  w531: { nombre: "5/3/1", desc: "4 días · fuerza en los 4 básicos, ciclos de 4 semanas" }
};
// 5/3/1: un básico por día y accesorios.
const D531 = [
  { tit: "Press militar", base: "Press militar", inc: 2.5, acc: ["Dominadas", "Fondos en paralelas", "Elevaciones laterales", "Face pull"] },
  { tit: "Peso muerto", base: "Peso muerto", inc: 5, acc: ["Curl de piernas", "Hip thrust", "Plancha", "Remo con mancuerna"] },
  { tit: "Press banca", base: "Press banca", inc: 2.5, acc: ["Remo con barra", "Jalón al pecho", "Extensión de tríceps en polea", "Curl martillo"] },
  { tit: "Sentadilla", base: "Sentadilla", inc: 5, acc: ["Prensa 45°", "Peso muerto rumano", "Elevación de talones", "Extensión de piernas"] }
];
function mejorE1rm(ej) {
  let m = 0;
  sesionesConSeries().forEach(s => trab(s).forEach(x => { if (x.ejercicio === ej && x.reps <= 10) m = Math.max(m, e1rm(x.kg, x.reps, x.rpe)); }));
  return m;
}

function renderProgramas() {
  $("pg-lista").innerHTML = Object.entries(PROGRAMAS).map(([k, p]) => `
    <button class="prog" data-prog="${k}">
      <b>${esc(p.nombre)}</b><span class="mut">${esc(p.desc)}</span>
    </button>`).join("");
  const act = db.rutinas.filter(esDePrograma);
  const esq = act.find(r => r.esquema)?.esquema;
  $("pg-actual").innerHTML = act.length && esq
    ? `<div class="objetivo">Programa activo: <b>${esc(PROGRAMAS[esq.prog]?.nombre || "")}</b> · semana ${semanaPrograma(esq)} de ${esq.ciclo}${semanaPrograma(esq) === esq.ciclo ? " (descarga)" : ""} · desde ${esc(esq.inicio)}</div>`
    : "";
}
$("pg-lista").onclick = e => {
  const b = e.target.closest("[data-prog]");
  if (!b) return;
  crearPrograma(b.dataset.prog);
};
function crearPrograma(k) {
  const p = PROGRAMAS[k];
  if (esquemaOK.v10 === false) return alert("Para usar programas falta ejecutar la migración v10 en Supabase (SQL Editor). Sin eso, las series y repeticiones del programa no se pueden guardar.");
  const cat = new Set(catalogo().map(e => e.nombre));
  if (!confirm(`¿Crear el programa ${p.nombre}? Empieza esta semana (${hoy()}).`)) return;
  const inicio = lunesDe(hoy());
  const nuevas = [];
  if (k === "w531") {
    for (const d of D531) {
      if (!cat.has(d.base)) continue;
      let base = mejorE1rm(d.base);
      if (!base) {
        const r = prompt(`No tengo datos de ${d.base}. ¿Cuántos kilos levantás para 5 repeticiones?`);
        if (r === null) return;
        base = e1rm(num(r) || 0, 5);
        if (!base) continue;
      }
      const acc = d.acc.filter(n => cat.has(n)).slice(0, 3);
      const ej = { [d.base]: { s: 3, w531: true, rmin: 1, rmax: 5, d: 180 } };
      acc.forEach(n => ej[n] = { s: 3, rmin: 10, rmax: 12, d: 75 });
      nuevas.push({ id: uid(), nombre: `Programa · 5/3/1 · ${d.tit}`, ejercicios: [d.base, ...acc],
        esquema: { prog: k, inicio, ciclo: 4, tm: { [d.base]: r25(base * 0.9) }, inc: { [d.base]: d.inc }, ej } });
    }
  } else {
    const usados = new Set();
    p.dias.forEach(([tit, tipoDia]) => {
      const fijos = (p.fijos?.[tipoDia] || []).filter(n => cat.has(n));
      const ejercicios = fijos.length >= 3 ? fijos : elegirEjercicios(tipoDia, "ambos", usados, cat);
      if (!ejercicios.length) return;
      ejercicios.forEach(n => usados.add(n));
      nuevas.push({ id: uid(), nombre: `Programa · ${tit}`, ejercicios, esquema: { prog: k, inicio, ciclo: 4, ej: esquemaPara(ejercicios, "ambos") } });
    });
  }
  if (!nuevas.length) return alert("No encontré los ejercicios del programa en tu catálogo.");
  if (!reemplazarRutinas(esDePrograma, "de otro programa")) return;
  db.rutinas.push(...nuevas);
  encolarVarios(nuevas.map(r => ({ t: "ins", tabla: "rutinas", fila: filaRutina(r) })));
  const creadas = nuevas;
  toast(`Programa creado · ${creadas.length} rutinas`);
}

function renderRutinas() {
  // Rutinas de programa primero, después las del plan en orden de la semana y al final las sueltas.
  const orden = r => esDePrograma(r) ? -1 : (() => { const i = Object.values(DIAS_NOMBRE).findIndex(d => r.nombre.startsWith(d + " · ")); return i < 0 ? 99 : i; })();
  $("r-lista").innerHTML = db.rutinas.length ? db.rutinas.slice().sort((a, b) => orden(a) - orden(b)).map(r => {
    const e = r.esquema?.ej || {};
    const detalle = r.ejercicios.map(n => e[n] ? `${n} (${e[n].w531 ? "5/3/1" : e[n].s + "×" + e[n].rmin + (e[n].rmax !== e[n].rmin ? "-" + e[n].rmax : "")})` : n).join(" · ");
    return `
    <div class="row filas">
      <div style="flex:1 1 60%"><b style="color:var(--sun)">${esc(r.nombre)}</b><div class="mut">${esc(detalle)}</div></div>
      <div class="row" style="flex:0 0 auto;margin:0;gap:6px">
        <button class="btn sec mini fijo" onclick="editarRutina('${r.id}')">Editar</button>
        <button class="btn peligro mini fijo" onclick="borrarRutina('${r.id}')">Borrar</button>
      </div>
    </div>`;
  }).join("") : '<p class="mut">Creá tu primera rutina o elegí un programa.</p>';
  renderProgramas();
}
