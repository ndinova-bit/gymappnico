// ============================================================
// datos.js — peso corporal, preferencias, usuarios, copias,
// exportar e importar CSV (propio, Strong y Hevy) y borrado total.
// ============================================================

// ---------- Peso ----------
$("pc-guardar").onclick = () => {
  const fecha = $("pc-fecha").value || hoy();
  const kg = num($("pc-kg").value);
  if (!kg || kg < 20 || kg > 400) return alert("Ingresá un peso válido.");
  db.peso = db.peso.filter(p => p.fecha !== fecha);
  db.peso.push({ fecha, kg });
  db.peso.sort((a, b) => a.fecha.localeCompare(b.fecha));
  encolar({ t: "ins", tabla: "peso", fila: { user_id: user.id, fecha, kg } });
  $("pc-kg").value = "";
  haptico(15);
  toast(`Peso guardado · ${kg} kg`);
};
function borrarPeso(fecha) {
  const p = db.peso.find(x => x.fecha === fecha);
  if (!p) return;
  db.peso = db.peso.filter(x => x !== p);
  guardarTodo();
  renderTodo();
  renderPeso();
  conDeshacer(`Peso del ${fecha} borrado`,
    () => encolar({ t: "delFecha", tabla: "peso", fecha }),
    () => { db.peso.push(p); db.peso.sort((a, b) => a.fecha.localeCompare(b.fecha)); renderPeso(); });
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
      <b style="color:var(--cyan)">${p.fecha}</b><span class="num-grande">${fmtKg(p.kg)} kg</span>
      <button class="btn peligro mini fijo" onclick="borrarPeso('${p.fecha}')" aria-label="Borrar peso del ${p.fecha}">Borrar</button>
    </div>`).join("") : '<p class="mut">Todavía no cargaste ningún peso.</p>';
}

// ---------- Preferencias ----------
function pintarOffline() {
  $("pref-offline").textContent = ajustes.offline ? "Sin conexión forzado · tocá para volver" : "Automático · tocá para forzar";
  $("pref-offline").classList.toggle("modo-off", !!ajustes.offline);
  $("pref-offline").setAttribute("aria-pressed", !!ajustes.offline);
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
$("pref-descanso").onchange = () => {
  ajustes.descanso = parseInt($("pref-descanso").value) || 90;
  guardarTodo();
  toast(`Descanso por defecto: ${fmtTiempo(ajustes.descanso)}`);
};
function pintarAvisos() {
  const sinSoporte = !("Notification" in window);
  const b = $("pref-avisos");
  b.disabled = sinSoporte;
  b.textContent = sinSoporte ? "No disponible en este navegador"
    : ajustes.avisos && Notification.permission === "granted" ? "Activados · tocá para quitar"
    : Notification.permission === "denied" ? "Bloqueados en el navegador" : "Desactivados · tocá para activar";
  b.setAttribute("aria-pressed", !!ajustes.avisos);
}
$("pref-avisos").onclick = async () => {
  if (ajustes.avisos) { ajustes.avisos = false; guardarTodo(); return pintarAvisos(); }
  const p = await Notification.requestPermission();
  ajustes.avisos = p === "granted";
  guardarTodo();
  pintarAvisos();
  if (p === "granted") notificar("Avisos activados", "Te aviso cuando termine el descanso aunque bloquees el celular.");
  else if (p === "denied") alert("El navegador bloqueó los avisos. Podés habilitarlos desde la configuración del sitio.");
};

// Tema visual y modo gimnasio: se guardan en el celular y se aplican al abrir la app.
function aplicarTema() {
  const tema = ajustes.tema || "neon";
  document.documentElement.dataset.tema = tema;
  const cs = getComputedStyle(document.documentElement);
  ["cyan", "mag", "lime", "sun", "vio", "red"].forEach(k => { const v = cs.getPropertyValue("--" + k).trim(); if (v) NEON[k] = v; });
  Chart.defaults.plugins.tooltip.borderColor = NEON.cyan;
  Chart.defaults.plugins.tooltip.titleColor = NEON.cyan;
  document.body.classList.toggle("gym", !!ajustes.gym);
  $("pref-tema").value = tema;
  $("pref-gym").textContent = ajustes.gym ? "Activada · tocá para quitar" : "Desactivada";
  $("pref-gym").setAttribute("aria-pressed", !!ajustes.gym);
  document.body.classList.toggle("calmo", ajustes.calmo !== false);
  $("pref-calmo").textContent = ajustes.calmo !== false ? "Solo momentos clave" : "Siempre animada";
  const color = { neon: "#05060d", acero: "#0c0d10", retro: "#0d0802" }[tema];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}
$("pref-tema").onchange = () => {
  ajustes.tema = $("pref-tema").value;
  guardarTodo();
  aplicarTema();
  if (!$("vista-progreso").classList.contains("hidden")) renderProgreso();
};
$("pref-gym").onclick = () => { ajustes.gym = !ajustes.gym; guardarTodo(); aplicarTema(); };
$("pref-calmo").onclick = () => { ajustes.calmo = ajustes.calmo === false; guardarTodo(); aplicarTema(); };

// ---------- Usuarios (solo administrador) ----------
async function renderAdmin() {
  const card = $("admin-card");
  if (!cuenta?.es_admin) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const { data, error } = await sb.from("cuentas")
    .select("id,correo,nombre,aprobado,es_admin,creado").order("creado", { ascending: false });
  if (error) { $("admin-lista").innerHTML = `<p class="mut">No se pudo cargar: ${esc(error.message)}</p>`; return; }
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

// ---------- Exportar ----------
function descargarArchivo(nombre, contenido, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("d-exportar").onclick = () => descargarArchivo("gymapp-" + hoy() + ".json", JSON.stringify(db, null, 2), "application/json");

// CSV con punto y coma y coma decimal: se abre bien en Excel en español.
const COLS_CSV = ["fecha", "ejercicio", "serie", "kg", "reps", "rpe", "tipo", "marca", "superserie", "descanso_seg", "nota_sesion"];
function celdaCSV(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
$("d-csv").onclick = () => {
  const filas = [COLS_CSV.join(";")];
  sesionesConSeries().forEach(s => {
    const n = {};
    s.series.forEach(x => {
      n[x.ejercicio] = (n[x.ejercicio] || 0) + 1;
      filas.push([s.fecha, x.ejercicio, n[x.ejercicio], String(x.kg).replace(".", ","), x.reps, x.rpe == null ? "" : String(x.rpe).replace(".", ","),
        tipoDe(x), x.marca || "normal", x.superserie || "", x.descanso_seg ?? "", s.notas || ""].map(celdaCSV).join(";"));
    });
  });
  descargarArchivo("gymapp-series-" + hoy() + ".csv", "﻿" + filas.join("\r\n"), "text/csv;charset=utf-8");
};

// ---------- Importar CSV ----------
function leerCSV(texto) {
  texto = texto.replace(/^﻿/, "");
  const primera = texto.split(/\r?\n/)[0];
  const cuenta = c => (primera.match(new RegExp("\\" + c, "g")) || []).length;
  const sep = [";", ",", "\t"].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas = [];
  let fila = [], celda = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda); celda = "";
      if (fila.some(x => x !== "")) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some(x => x !== "")) filas.push(fila);
  return filas;
}

// Nombres en inglés de Strong y Hevy → ejercicios del catálogo.
const MAPA_EJ = {
  "bench press": "Press banca", "squat": "Sentadilla", "deadlift": "Peso muerto", "overhead press": "Press militar",
  "shoulder press": "Press militar", "military press": "Press militar", "bent over row": "Remo con barra",
  "barbell row": "Remo con barra", "pull up": "Dominadas", "chin up": "Dominadas", "lat pulldown": "Jalón al pecho",
  "bicep curl": "Curl de bíceps con barra", "biceps curl": "Curl de bíceps con barra", "hammer curl": "Curl martillo",
  "triceps pushdown": "Extensión de tríceps en polea", "tricep pushdown": "Extensión de tríceps en polea",
  "lateral raise": "Elevaciones laterales", "leg press": "Prensa 45°", "leg extension": "Extensión de piernas",
  "lying leg curl": "Curl de piernas", "seated leg curl": "Curl de piernas", "leg curl": "Curl de piernas",
  "hip thrust": "Hip thrust", "romanian deadlift": "Peso muerto rumano", "incline bench press": "Press inclinado con barra",
  "chest fly": "Aperturas con mancuernas", "dumbbell fly": "Aperturas con mancuernas", "seated cable row": "Remo en polea baja",
  "seated row": "Remo en polea baja", "face pull": "Face pull", "plank": "Plancha", "standing calf raise": "Elevación de talones",
  "calf raise": "Elevación de talones", "seated calf raise": "Gemelo sentado", "bulgarian split squat": "Sentadilla búlgara",
  "goblet squat": "Sentadilla goblet", "dip": "Fondos en paralelas", "chest dip": "Fondos en paralelas", "bench dip": "Fondos en banco",
  "skullcrusher": "Press francés", "preacher curl": "Curl predicador", "arnold press": "Press Arnold", "t bar row": "Remo en T",
  "hack squat": "Sentadilla hack", "dumbbell row": "Remo con mancuerna", "cable crossover": "Cruces en polea",
  "reverse fly": "Pájaros (elevación posterior)", "rear delt fly": "Pájaros (elevación posterior)",
  "overhead triceps extension": "Extensión de tríceps sobre la cabeza", "cable curl": "Curl en polea",
  "chest press": "Press en máquina de pecho", "close grip lat pulldown": "Jalón agarre cerrado", "glute kickback": "Patada de glúteo en polea"
};
function mapearEjercicio(nombre, cat) {
  if (cat.has(nombre)) return nombre;
  const limpio = nombre.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  const m = MAPA_EJ[limpio] || MAPA_EJ[limpio.replace(/s$/, "")];
  return m && cat.has(m) ? m : nombre;
}
function adivinarGrupo(n) {
  const s = n.toLowerCase();
  if (/bench|chest|fly|pec|pecho|press banca|apertura/.test(s)) return "Pecho";
  if (/row|pull|lat|chin|remo|jal[oó]n|dominada/.test(s)) return "Espalda";
  if (/shoulder|lateral|overhead|delt|militar|hombro|arnold/.test(s)) return "Hombros";
  if (/squat|leg|lunge|calf|sentadilla|prensa|pierna|gemelo|talon/.test(s)) return "Piernas";
  if (/glute|hip|thrust|gl[uú]teo/.test(s)) return "Glúteos";
  if (/curl|tricep|bicep|skull|extension|b[ií]ceps|tr[ií]ceps/.test(s)) return "Brazos";
  if (/plank|crunch|ab |abs|core|plancha|abdominal/.test(s)) return "Core";
  if (/run|bike|row machine|cardio|treadmill|cinta|bici/.test(s)) return "Cardio";
  return "Otro";
}
const MESES_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function fechaDe(txt) {
  txt = String(txt || "").trim();
  let m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = txt.match(/^(\d{1,2}) (\w{3})\w* (\d{4})/);            // Hevy: 26 Oct 2024, 18:02
  if (m && MESES_EN[m[2].toLowerCase()]) return `${m[3]}-${pad(MESES_EN[m[2].toLowerCase()])}-${pad(+m[1])}`;
  m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);            // 26/10/2024
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  const d = new Date(txt);
  return isNaN(d) ? null : fechaISO(d);
}

function interpretarCSV(filas) {
  const cab = filas[0].map(h => h.trim().toLowerCase());
  const col = (...n) => { for (const x of n) { const i = cab.indexOf(x); if (i >= 0) return i; } return -1; };
  const get = (f, i) => i >= 0 ? (f[i] ?? "").trim() : "";
  let formato, out = [];
  if (col("exercise_title") >= 0 && col("start_time") >= 0) {
    formato = "Hevy";
    const iT = col("title"), iS = col("start_time"), iE = col("exercise_title"), iKg = col("weight_kg"), iLb = col("weight_lbs"),
      iR = col("reps"), iP = col("rpe"), iTy = col("set_type"), iSS = col("superset_id");
    filas.slice(1).forEach(f => {
      const kg = iKg >= 0 ? num(get(f, iKg)) : num(get(f, iLb)) * 0.4536;
      out.push({ clave: get(f, iS) + "|" + get(f, iT), fecha: fechaDe(get(f, iS)), ej: get(f, iE), kg: isNaN(kg) ? 0 : Math.round(kg * 100) / 100,
        reps: parseInt(get(f, iR)), rpe: num(get(f, iP)), marca: { warmup: "calentamiento", dropset: "descendente" }[get(f, iTy).toLowerCase()] || "normal",
        ss: get(f, iSS) ? "S" + get(f, iSS) : null, nota: "" });
    });
  } else if (col("exercise name") >= 0 && col("date") >= 0) {
    formato = "Strong";
    const iD = col("date"), iW = col("workout name"), iE = col("exercise name"), iO = col("set order"), iKg = col("weight"),
      iU = col("weight unit"), iR = col("reps"), iP = col("rpe"), iN = col("workout notes");
    filas.slice(1).forEach(f => {
      let kg = num(get(f, iKg));
      if (get(f, iU).toLowerCase().startsWith("lb")) kg *= 0.4536;
      const orden = get(f, iO).toUpperCase();
      out.push({ clave: get(f, iD) + "|" + get(f, iW), fecha: fechaDe(get(f, iD)), ej: get(f, iE), kg: isNaN(kg) ? 0 : Math.round(kg * 100) / 100,
        reps: parseInt(get(f, iR)), rpe: num(get(f, iP)), marca: orden === "W" ? "calentamiento" : orden === "D" ? "descendente" : "normal", ss: null, nota: get(f, iN) });
    });
  } else if (col("fecha") >= 0 && col("ejercicio") >= 0) {
    formato = "esta app";
    const iF = col("fecha"), iE = col("ejercicio"), iKg = col("kg"), iR = col("reps"), iP = col("rpe"), iT = col("tipo"),
      iM = col("marca"), iSS = col("superserie"), iD = col("descanso_seg"), iN = col("nota_sesion");
    filas.slice(1).forEach(f => {
      out.push({ clave: get(f, iF), fecha: fechaDe(get(f, iF)), ej: get(f, iE), kg: num(get(f, iKg)) || 0, reps: parseInt(get(f, iR)),
        rpe: num(get(f, iP)), tipo: TIPOS.includes(get(f, iT)) ? get(f, iT) : null, marca: MARCAS.includes(get(f, iM)) ? get(f, iM) : "normal",
        ss: get(f, iSS) || null, desc: parseInt(get(f, iD)), nota: get(f, iN) });
    });
  } else return null;
  out = out.filter(x => x.fecha && x.ej && x.reps >= 1 && x.reps <= 100 && x.kg >= 0 && x.kg <= 1000);
  return { formato, filas: out };
}

$("d-importar").onclick = () => $("d-archivo").click();
$("d-archivo").onchange = async () => {
  const archivo = $("d-archivo").files[0];
  $("d-archivo").value = "";
  if (!archivo) return;
  if (archivo.size > 15e6) return alert("El archivo es muy grande (más de 15 MB).");
  const filas = leerCSV(await archivo.text());
  const r = filas.length > 1 ? interpretarCSV(filas) : null;
  if (!r || !r.filas.length) return alert("No reconocí el archivo. Sirven los CSV exportados desde esta app, Strong o Hevy.");
  const cat = new Set(catalogo().map(e => e.nombre));
  const fechasExistentes = new Set(sesionesConSeries().map(s => s.fecha));
  const sesiones = new Map();
  let salteadas = 0;
  r.filas.forEach(x => {
    if (fechasExistentes.has(x.fecha)) { salteadas++; return; }
    if (!sesiones.has(x.clave)) sesiones.set(x.clave, { fecha: x.fecha, nota: x.nota, filas: [] });
    sesiones.get(x.clave).filas.push(x);
  });
  const nombres = new Set();
  sesiones.forEach(s => s.filas.forEach(x => { x.ej = mapearEjercicio(x.ej, cat); nombres.add(x.ej); }));
  const nuevosEj = [...nombres].filter(n => !cat.has(n));
  const nSeries = [...sesiones.values()].reduce((a, s) => a + s.filas.length, 0);
  if (!sesiones.size) return alert(`Todas las fechas del archivo ya tienen sesiones cargadas (${salteadas} series salteadas).`);
  const fechas = [...sesiones.values()].map(s => s.fecha).sort();
  if (!confirm(`Archivo de ${r.formato}: ${sesiones.size} sesiones y ${nSeries} series, del ${fechas[0]} al ${fechas[fechas.length - 1]}.`
    + (nuevosEj.length ? `\nSe agregan ${nuevosEj.length} ejercicios nuevos al catálogo.` : "")
    + (salteadas ? `\nSe saltean ${salteadas} series de fechas que ya tenés cargadas.` : "")
    + "\n\n¿Importar?")) return;

  const ops = [];
  const ejFilas = nuevosEj.map(n => ({ id: uid(), user_id: user.id, nombre: n, grupo: adivinarGrupo(n), tipo: "fuerza", met: 5 }));
  if (ejFilas.length) { db.ejercicios.push(...ejFilas); ops.push({ t: "ins", tabla: "ejercicios", fila: ejFilas }); }
  const sesFilas = [], serieFilas = [];
  let t0 = Date.now() - nSeries * 1000;
  sesiones.forEach(s => {
    const ses = { id: uid(), fecha: s.fecha, notas: s.nota || null, series: [] };
    s.filas.forEach(x => {
      const serie = { id: uid(), user_id: user.id, sesion_id: ses.id, ejercicio: x.ej, reps: x.reps, kg: x.kg,
        rpe: x.rpe >= 1 && x.rpe <= 10 ? x.rpe : null, descanso_seg: x.desc > 0 ? x.desc : null,
        tipo_serie: x.tipo || tipoDe({ reps: x.reps }), marca: x.marca, superserie: x.ss,
        created_at: new Date(t0 += 1000).toISOString() };
      ses.series.push(serie);
      const { created_at, ...f } = serie;
      serieFilas.push(f);
    });
    db.sesiones.push(ses);
    sesFilas.push({ id: ses.id, user_id: user.id, fecha: ses.fecha, notas: ses.notas });
  });
  db.sesiones.sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (let i = 0; i < sesFilas.length; i += 400) ops.push({ t: "ins", tabla: "sesiones", fila: sesFilas.slice(i, i + 400) });
  for (let i = 0; i < serieFilas.length; i += 400) ops.push({ t: "ins", tabla: "series", fila: serieFilas.slice(i, i + 400) });
  encolarVarios(ops);
  toast(`Importadas ${sesiones.size} sesiones`);
};

// ---------- Borrar todo ----------
$("d-borrar").onclick = async () => {
  if (!navigator.onLine) return alert("Necesitás conexión para borrar todo.");
  if (!confirm("¿Borrar TODOS tus datos de la nube? No se puede deshacer.")) return;
  if (prompt('Para confirmar, escribí BORRAR') !== "BORRAR") return;
  confirmarPendiente();
  const tablas = ["series", "sesiones", "rutinas", "peso", "ejercicios"];
  if (esquemaOK.notas) tablas.push("notas_ejercicio");
  for (const t of tablas) {
    const { error } = await sb.from(t).delete().eq("user_id", user.id);
    if (error) return alert("Error al borrar " + t + ": " + error.message);
  }
  cola = []; db = DB_VACIA(); sesionActualId = null; borrador = null;
  guardarBorrador();
  guardarTodo();
  renderTodo();
  alert("Datos borrados.");
};
