// Tests de la lógica pura. Se corren con:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logica.js");

const cerca = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b}`);

test("1RM: Epley y reserva por RPE", () => {
  cerca(L.e1rm(100, 5), 100 * (1 + 5 / 30));
  cerca(L.e1rm(100, 5, 8), 100 * (1 + 7 / 30));          // RPE 8 = 2 en reserva
  cerca(L.e1rm(100, 5, 6), 100 * (1 + 8 / 30));          // la reserva se limita a 3
  assert.equal(L.e1rm(100, 1), 100);                      // una repetición es el máximo
  cerca(L.e1rm(100, 5, ""), L.e1rm(100, 5));              // RPE vacío = Epley clásico
});

test("clasificación de series", () => {
  const c = L.clasificarSerieBase;
  assert.equal(c({ reps: 5, kg: 50 }, 0), "fuerza");
  assert.equal(c({ reps: 7, kg: 90 }, 100), "fuerza");         // 90 % de su mejor 1RM de fuerza
  assert.equal(c({ reps: 7, kg: 80 }, 100), "hipertrofia");
  assert.equal(c({ reps: 12, kg: 60, rpe: 10 }, 0), "hipertrofia");   // el RPE no la convierte en fuerza
  assert.equal(c({ reps: 18, kg: 20, rpe: 8 }, 0), "hipertrofia");
  assert.equal(c({ reps: 18, kg: 20 }, 0), "resistencia");
  assert.equal(c({ reps: 18, kg: 20, rpe: 6 }, 0), "resistencia");
});

test("músculos por ejercicio", () => {
  const pr = n => L.principalDe(n, "Otro");
  assert.equal(pr("Sentadilla"), "Cuádriceps");
  assert.equal(pr("Sentadilla búlgara"), "Cuádriceps");
  assert.equal(pr("Press banca"), "Pecho");
  assert.equal(pr("Press militar"), "Hombro anterior");
  assert.equal(pr("Peso muerto rumano"), "Isquios");
  assert.equal(pr("Curl de piernas"), "Isquios");          // no es un curl de bíceps
  assert.equal(pr("Curl martillo"), "Bíceps");
  assert.equal(pr("Extensión de tríceps en polea"), "Tríceps");
  assert.equal(pr("Fondos en banco"), "Tríceps");
  assert.equal(pr("Fondos en paralelas"), "Pecho");
  assert.equal(pr("Elevaciones laterales"), "Hombro lateral");
  assert.equal(pr("Pájaros (elevación posterior)"), "Hombro posterior");
  assert.equal(pr("Jalón al pecho"), "Dorsales");           // "pecho" en el nombre no lo pasa a Pecho
  assert.equal(pr("Remo con barra"), "Dorsales");
  assert.equal(pr("Hip thrust"), "Glúteos");
  assert.equal(pr("Elevación de talones"), "Gemelos");
  assert.equal(pr("Plancha"), "Core");
  const sb = L.musculosDe("Sentadilla búlgara", "Piernas");
  assert.deepEqual(sb.find(x => x.m === "Glúteos"), { m: "Glúteos", f: 0.5 });
});

test("ejercicios nuevos usan el grupo; cardio no cuenta", () => {
  assert.equal(L.principalDe("Mi ejercicio raro", "Brazos"), "Bíceps");
  assert.deepEqual(L.musculosDe("Cinta", "Cardio"), []);
  assert.deepEqual(L.musculosDe("Otra cosa", "Otro"), []);
});

test("series por músculo: secundarias a la mitad, sin calentamientos", () => {
  const fn = n => L.musculosDe(n, "Otro");
  const sesiones = [
    { fecha: "2026-11-02", series: [
      { ejercicio: "Press banca", marca: "calentamiento" },
      { ejercicio: "Press banca" }, { ejercicio: "Press banca" }, { ejercicio: "Press banca" }] },
    { fecha: "2026-11-05", series: [{ ejercicio: "Press banca" }, { ejercicio: "Fondos en banco" }] },
    { fecha: "2026-10-01", series: [{ ejercicio: "Press banca" }] }              // fuera de la ventana
  ];
  const r = L.seriesPorMusculo(sesiones, "2026-11-01", fn);
  assert.equal(r["Pecho"].directas, 4);
  assert.equal(r["Pecho"].dias, 2);
  cerca(r["Hombro anterior"].efectivas, 2);              // 4 series de press × 0,5
  cerca(r["Tríceps"].efectivas, 2 + 1);                  // 4 × 0,5 + 1 de fondos en banco
});

test("incrementos de carga por ejercicio", () => {
  assert.equal(L.incrementoDe("Sentadilla"), 5);
  assert.equal(L.incrementoDe("Peso muerto"), 5);
  assert.equal(L.incrementoDe("Press banca"), 2.5);
  assert.equal(L.incrementoDe("Press inclinado con mancuernas"), 2);
  assert.equal(L.incrementoDe("Elevaciones laterales"), 2);
  assert.equal(L.incrementoDe("Curl de bíceps con barra"), 2.5);
  assert.equal(L.incrementoDe("Sentadilla goblet"), 2);
});

test("doble progresión", () => {
  const xs = (...r) => r.map(reps => ({ kg: 60, reps }));
  // Todas llegaron al tope: sube la carga y vuelve al rango bajo.
  assert.deepEqual(L.progresarDoble({ xs: xs(12, 12, 12), rmin: 8, rmax: 12, inc: 2.5, descarga: false }), { kg: 62.5, reps: 8, subio: true });
  // Falta una: mismo peso, una repetición más que la peor serie.
  assert.deepEqual(L.progresarDoble({ xs: xs(12, 11, 10), rmin: 8, rmax: 12, inc: 2.5, descarga: false }), { kg: 60, reps: 11, subio: false });
  // Nunca pasa del tope.
  assert.equal(L.progresarDoble({ xs: xs(12, 12, 11), rmin: 8, rmax: 12, inc: 2.5, descarga: false }).reps, 12);
  // Semana de descarga: 10 % menos, redondeado al paso del ejercicio, sin subir.
  assert.deepEqual(L.progresarDoble({ xs: xs(12, 12, 12), rmin: 8, rmax: 12, inc: 5, descarga: true }), { kg: 60, reps: 8, subio: false });
  assert.equal(L.progresarDoble({ xs: [{ kg: 100, reps: 8 }], rmin: 8, rmax: 12, inc: 5, descarga: true }).kg, 90);
});

test("cómo llegás hoy", () => {
  assert.equal(L.ajustarSeries(3, "cansado"), 2);
  assert.equal(L.ajustarSeries(1, "cansado"), 1);
  assert.equal(L.ajustarSeries(4, "normal"), 4);
  assert.equal(L.ajustarSeries(4, "bien"), 4);
});

test("sustitutos del mismo músculo", () => {
  const cat = [
    { nombre: "Press banca", grupo: "Pecho" }, { nombre: "Cruces en polea", grupo: "Pecho" },
    { nombre: "Aperturas con mancuernas", grupo: "Pecho" }, { nombre: "Sentadilla", grupo: "Piernas" },
    { nombre: "Jalón al pecho", grupo: "Espalda" }
  ];
  assert.deepEqual(L.sustitutos("Press banca", cat), ["Aperturas con mancuernas", "Cruces en polea"]);
  assert.deepEqual(L.sustitutos("Sentadilla", cat), []);
});

// ---------- descarga ----------
const HOY = "2026-11-07";                                 // sábado
const sumar = (f, n) => { const d = new Date(f + "T00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const sesion = (fecha, ejercicio, kg, reps = 5, rpe = null) => ({ fecha, series: [{ ejercicio, kg, reps, rpe }] });

test("descarga: sin datos no recomienda", () => {
  assert.equal(L.senalesDescarga([], HOY).recomendar, false);
  assert.equal(L.senalesDescarga([sesion("2026-11-03", "Press banca", 80)], HOY).recomendar, false);
});

test("descarga: baja el 1RM en dos ejercicios", () => {
  const f = [-30, -23, -16, -3];
  const ses = [];
  ["Press banca", "Sentadilla"].forEach(ej => f.forEach((d, i) => ses.push(sesion(sumar(HOY, d), ej, i === 3 ? 85 : 100))));
  const r = L.senalesDescarga(ses, HOY);
  assert.equal(r.recomendar, true);
  assert.match(r.motivos[0], /Bajó tu 1RM/);
});

test("descarga: un solo ejercicio en baja no alcanza", () => {
  const f = [-30, -23, -16, -3];
  const ses = f.map((d, i) => sesion(sumar(HOY, d), "Press banca", i === 3 ? 85 : 100));
  assert.equal(L.senalesDescarga(ses, HOY).recomendar, false);
});

test("descarga: ocho semanas seguidas con buen ritmo", () => {
  const ses = [];
  for (let w = 0; w < 9; w++) { const lunes = sumar("2026-11-02", -7 * w); ses.push(sesion(lunes, "Press banca", 80), sesion(sumar(lunes, 3), "Sentadilla", 100)); }
  const r = L.senalesDescarga(ses.filter(s => s.fecha <= HOY), HOY);
  assert.equal(r.recomendar, true);
  assert.ok(r.motivos.some(m => /semanas seguidas/.test(m)));
});

test("descarga: sube el esfuerzo (RPE)", () => {
  const ses = [];
  for (let i = 0; i < 6; i++) ses.push(sesion(sumar(HOY, -40 + i * 3), "Press banca", 80, 8, 7));   // antes: RPE 7
  for (let i = 0; i < 6; i++) ses.push(sesion(sumar(HOY, -12 + i * 2), "Press banca", 80, 8, 9));   // ahora: RPE 9
  // Cada sesión de prueba tiene una sola serie: se repiten para llegar a 10 por período.
  const dup = ses.flatMap(s => [s, { ...s, series: [...s.series, ...s.series] }]);
  const r = L.senalesDescarga(dup, HOY);
  assert.ok(r.motivos.some(m => /RPE/.test(m)), JSON.stringify(r));
});
