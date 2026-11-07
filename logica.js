// ============================================================
// logica.js — lógica pura: sin pantalla, sin Supabase, sin variables globales de la app.
// Se carga primero en index.html y también la usan los tests (node --test).
// ============================================================
(function (g) {
  const sinTildes = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // ---------- 1RM y tipo de serie ----------
  // 1RM estimado (Epley). Si la serie tiene RPE, se suman las repeticiones que te quedaban en reserva
  // (10 − RPE) para estimar cuántas habrías hecho hasta el fallo. La reserva se limita a 3 repeticiones:
  // la estimación del esfuerzo es poco precisa lejos del fallo (Robinson 2024), así que con RPE bajos
  // el resultado queda del lado conservador. Sin RPE, es Epley clásico con las repeticiones hechas.
  function e1rm(kg, reps, rpe) {
    const r = Number(rpe);
    const reserva = rpe != null && rpe !== "" && r >= 1 && r <= 10 ? Math.min(3, 10 - r) : 0;
    const n = reps + reserva;
    return n <= 1 ? kg : kg * (1 + n / 30);
  }
  const tipoViejo = reps => reps <= 5 ? "fuerza" : reps <= 12 ? "hipertrofia" : "resistencia";

  // Clasifica una serie a partir de repeticiones, carga y esfuerzo.
  // refKg = mejor 1RM de fuerza de ese ejercicio (0 si no hay).
  function clasificarSerieBase(x, refKg) {
    const reps = Number(x.reps), rpe = x.rpe == null || x.rpe === "" ? null : Number(x.rpe);
    if (reps <= 5) return "fuerza";
    if (reps <= 8 && refKg > 0 && x.kg >= refKg * 0.85) return "fuerza";
    if (reps <= 15) return "hipertrofia";
    return rpe !== null && rpe >= 8 ? "hipertrofia" : "resistencia";
  }

  // ---------- Músculos ----------
  // Cada ejercicio trabaja un músculo principal (1) y otros que ayudan (0,5).
  // Se deduce del nombre, así sirve también para los ejercicios que agregues vos.
  const MUSCULOS = ["Pecho", "Dorsales", "Espalda alta", "Hombro anterior", "Hombro lateral", "Hombro posterior",
    "Bíceps", "Tríceps", "Cuádriceps", "Isquios", "Glúteos", "Gemelos", "Core"];
  const REGLAS = [
    [/curl de piernas|curl femoral|isquio|nordic/, [["Isquios", 1]]],
    [/hip thrust|puente de gluteo/, [["Glúteos", 1], ["Isquios", .5]]],
    [/peso muerto rumano|rumano|buenos dias|good morning/, [["Isquios", 1], ["Glúteos", .5]]],
    [/peso muerto/, [["Glúteos", 1], ["Isquios", .5], ["Espalda alta", .5]]],
    [/patada de gluteo|abduccion/, [["Glúteos", 1]]],
    [/bulgara|zancada|desplante|estocada|step up/, [["Cuádriceps", 1], ["Glúteos", .5]]],
    [/extension de piernas|sissy|extension de cuadriceps/, [["Cuádriceps", 1]]],
    [/sentadilla|prensa|hack|goblet|squat/, [["Cuádriceps", 1], ["Glúteos", .5]]],
    [/gemelo|talones|pantorrilla|calf/, [["Gemelos", 1]]],
    [/fondos en banco|press frances|triceps|jm press|rompecraneos/, [["Tríceps", 1]]],
    [/curl|biceps|predicador|martillo/, [["Bíceps", 1]]],
    [/elevaciones laterales|elevacion lateral|vuelos laterales/, [["Hombro lateral", 1]]],
    [/pajaros|face pull|posterior|reverse fly/, [["Hombro posterior", 1], ["Espalda alta", .5]]],
    [/press militar|press arnold|press de hombro|sobre la cabeza|push press|overhead/, [["Hombro anterior", 1], ["Hombro lateral", .5], ["Tríceps", .5]]],
    [/fondos|dips/, [["Pecho", 1], ["Tríceps", 1], ["Hombro anterior", .5]]],
    [/press banca|press inclinado|press declinado|press en maquina de pecho|press de pecho|press con mancuernas|flexiones|push up|pec deck/, [["Pecho", 1], ["Hombro anterior", .5], ["Tríceps", .5]]],
    [/aperturas|cruces|\bpec\b/, [["Pecho", 1]]],
    [/dominadas|jalon|pullover|pull up|chin up/, [["Dorsales", 1], ["Bíceps", .5]]],
    [/remo|\brow\b/, [["Dorsales", 1], ["Espalda alta", 1], ["Bíceps", .5]]],
    [/encogimientos|trapecio|shrug/, [["Espalda alta", 1]]],
    [/plancha|abdominal|crunch|elevacion de piernas|rueda|\bcore\b|pallof|oblicuo|plank/, [["Core", 1]]]
  ];
  const DE_GRUPO = { Pecho: "Pecho", Espalda: "Dorsales", Hombros: "Hombro lateral", Piernas: "Cuádriceps", Glúteos: "Glúteos", Brazos: "Bíceps", Core: "Core" };
  // Devuelve [{ m: músculo, f: 1 o 0,5 }]. Cardio y "Otro" no cuentan como series de músculo.
  function musculosDe(nombre, grupo) {
    const n = sinTildes(nombre);
    for (const [re, lista] of REGLAS) if (re.test(n)) return lista.map(([m, f]) => ({ m, f }));
    const m = DE_GRUPO[grupo];
    return m ? [{ m, f: 1 }] : [];
  }
  const principalDe = (nombre, grupo) => musculosDe(nombre, grupo).find(x => x.f === 1)?.m || null;

  // Series efectivas por músculo desde una fecha: las del músculo principal cuentan 1 y las que ayudan, 0,5.
  // "dias" = en cuántos días distintos se lo trabajó como principal. Los calentamientos no cuentan.
  function seriesPorMusculo(sesiones, desde, musculosFn) {
    const out = {};
    MUSCULOS.forEach(m => out[m] = { efectivas: 0, directas: 0, dias: new Set() });
    sesiones.forEach(s => {
      if (s.fecha < desde) return;
      (s.series || []).forEach(x => {
        if (x.marca === "calentamiento") return;
        musculosFn(x.ejercicio).forEach(({ m, f }) => {
          if (!out[m]) return;
          out[m].efectivas += f;
          if (f === 1) { out[m].directas++; out[m].dias.add(s.fecha); }
        });
      });
    });
    MUSCULOS.forEach(m => out[m].dias = out[m].dias.size);
    return out;
  }
  // Rango orientativo de series efectivas por semana (10 a 20 como referencia general).
  const RANGOS_SERIES = { default: [10, 20], "Hombro anterior": [0, 20], "Core": [4, 16] };
  const rangoDe = m => RANGOS_SERIES[m] || RANGOS_SERIES.default;

  // ---------- Incrementos de carga ----------
  // Cuánto subir cuando toca subir: depende del tipo de ejercicio (un salto de 5 kg en una elevación lateral no existe).
  function incrementoDe(nombre) {
    const n = sinTildes(nombre);
    if (/mancuerna|goblet|bulgara|martillo|elevaciones|pajaros|aperturas/.test(n)) return 2;
    if (/sentadilla|peso muerto|prensa|hack|hip thrust|zancada|gemelo|talones/.test(n)) return 5;
    return 2.5;
  }
  const redondearA = (kg, paso) => Math.round(kg / paso) * paso;

  // Doble progresión: si todas las series del peso más alto llegaron al tope de repeticiones, se sube la carga.
  function progresarDoble({ xs, rmin, rmax, inc, descarga }) {
    const kgTop = Math.max(...xs.map(x => x.kg));
    const deTop = xs.filter(x => x.kg === kgTop);
    let subio = kgTop > 0 && deTop.every(x => x.reps >= rmax);
    let kg = subio ? kgTop + inc : kgTop;
    const reps = subio ? rmin : Math.min(rmax, Math.max(rmin, Math.min(...deTop.map(x => x.reps)) + 1));
    if (descarga && kg > 0) { kg = redondearA(kg * 0.9, inc); subio = false; }
    return { kg, reps, subio };
  }

  // ---------- Cómo llegás hoy ----------
  // Si llegás cansado se baja una serie por ejercicio (nunca menos de una).
  function ajustarSeries(n, estado) {
    return estado === "cansado" ? Math.max(1, n - 1) : n;
  }

  // ---------- Sustitutos ----------
  function sustitutos(nombre, catalogo, max = 8) {
    const base = catalogo.find(e => e.nombre === nombre);
    const m = principalDe(nombre, base?.grupo);
    if (!m) return [];
    return catalogo.filter(e => e.nombre !== nombre && principalDe(e.nombre, e.grupo) === m)
      .map(e => e.nombre).sort((a, b) => a.localeCompare(b)).slice(0, max);
  }

  // ---------- ¿Toca una semana de descarga? ----------
  const pad2 = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const sumar = (f, n) => { const d = new Date(f + "T00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const lunesDeF = f => { const d = new Date(f + "T00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
  const diasEntreF = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5);

  // Mira tres señales: (A) bajó el 1RM estimado en 2 o más ejercicios, (B) subió el esfuerzo (RPE) respecto de las semanas
  // anteriores, (C) llevás 8 semanas seguidas con 2 o más sesiones. Es una sugerencia, no una orden.
  function senalesDescarga(sesiones, hoyISO) {
    const motivos = [];
    const desde42 = sumar(hoyISO, -42);
    const con = sesiones.filter(s => (s.series || []).length && s.fecha >= desde42 && s.fecha <= hoyISO)
      .slice().sort((a, b) => a.fecha.localeCompare(b.fecha));

    // A) 1RM estimado en baja
    const porEj = {};
    con.forEach(s => {
      const mejor = {};
      s.series.forEach(x => {
        if (x.marca === "calentamiento" || !(x.kg > 0) || x.reps > 12) return;
        mejor[x.ejercicio] = Math.max(mejor[x.ejercicio] || 0, e1rm(x.kg, x.reps, x.rpe));
      });
      Object.entries(mejor).forEach(([ej, v]) => (porEj[ej] = porEj[ej] || []).push(v));
    });
    const enBaja = Object.entries(porEj).filter(([, v]) => v.length >= 3 && v[v.length - 1] < Math.max(...v.slice(-4, -1)) * 0.97).map(([ej]) => ej);
    if (enBaja.length >= 2) motivos.push(`Bajó tu 1RM estimado en ${enBaja.length} ejercicios (${enBaja.slice(0, 3).join(", ")}).`);

    // B) RPE de las últimas 2 semanas vs. las 4 anteriores
    const corte = sumar(hoyISO, -14);
    const rpes = (desde, hasta) => con.filter(s => s.fecha >= desde && s.fecha < hasta)
      .flatMap(s => s.series.filter(x => x.marca !== "calentamiento" && x.rpe != null && x.rpe !== "").map(x => Number(x.rpe)));
    const rec = rpes(corte, sumar(hoyISO, 1)), ant = rpes(desde42, corte);
    if (rec.length >= 10 && ant.length >= 10) {
      const pr = rec.reduce((a, b) => a + b, 0) / rec.length, pa = ant.reduce((a, b) => a + b, 0) / ant.length;
      if (pr - pa >= 0.7) motivos.push(`El esfuerzo (RPE) subió de ${pa.toFixed(1)} a ${pr.toFixed(1)} en las últimas 2 semanas.`);
    }

    // C) semanas seguidas con 2 o más sesiones (la semana en curso no corta la racha)
    const porSemana = {};
    sesiones.filter(s => (s.series || []).length && s.fecha <= hoyISO).forEach(s => { const k = lunesDeF(s.fecha); porSemana[k] = (porSemana[k] || 0) + 1; });
    let k = lunesDeF(hoyISO), seguidas = 0;
    if ((porSemana[k] || 0) < 2) k = sumar(k, -7);
    while ((porSemana[k] || 0) >= 2) { seguidas++; k = sumar(k, -7); }
    if (seguidas >= 8) motivos.push(`Llevás ${seguidas} semanas seguidas entrenando con buen ritmo.`);

    return { recomendar: motivos.length > 0, motivos };
  }

  const API = {
    e1rm, tipoViejo, clasificarSerieBase,
    MUSCULOS, musculosDe, principalDe, seriesPorMusculo, rangoDe, RANGOS_SERIES,
    incrementoDe, redondearA, progresarDoble, ajustarSeries, sustitutos, senalesDescarga, sinTildes,
    diasEntreF
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else Object.assign(g, API);
})(typeof window !== "undefined" ? window : globalThis);
