// ============================================================
// progreso.js — peso, entrenamiento, ranking, sobrecarga, rachas,
// hitos, mapa corporal, series por músculo y calendario anual.
// Los calentamientos no cuentan en nada de esto.
// ============================================================

function ritmoSemanal(datos) {
  // Pendiente de regresión lineal de los últimos 42 días, en kg por semana.
  const corte = Date.now() / DIA_MS - 42;
  const pts = datos.map(p => [new Date(p.fecha).getTime() / DIA_MS, p.kg]).filter(([x]) => x >= corte);
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let numer = 0, den = 0;
  pts.forEach(([x, y]) => { numer += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return den ? (numer / den) * 7 : null;
}

function volumenSemanas(n) {
  const hoyMs = new Date(hoy()).getTime();
  const out = [];
  for (let w = n - 1; w >= 0; w--) {
    const hasta = hoyMs - w * 7 * DIA_MS;
    const desde = hasta - 7 * DIA_MS;
    let vol = 0;
    db.sesiones.forEach(s => {
      const t = new Date(s.fecha).getTime();
      if (t > desde && t <= hasta) trab(s).forEach(x => vol += x.kg * x.reps);
    });
    out.push({ label: new Date(hasta).toISOString().slice(5, 10), vol: Math.round(vol) });
  }
  return out;
}

function renderProgresoPeso() {
  const corte = rangoPeso ? Date.now() - rangoPeso * DIA_MS : -Infinity;
  const datos = db.peso.filter(p => new Date(p.fecha).getTime() >= corte);
  const m = ajustes.meta;
  if (!datos.length) {
    $("pr-kpis").innerHTML = "";
    $("pr-meta").innerHTML = "";
    $("pr-rango").textContent = "";
    $("pr-vacio").textContent = "Cargá tu peso en la pestaña Peso para ver tu progreso acá.";
    if (charts["pr-peso-chart"]) { charts["pr-peso-chart"].destroy(); delete charts["pr-peso-chart"]; }
    return;
  }
  const ini = datos[0], ult = datos[datos.length - 1];
  const cambio = ult.kg - ini.kg;
  const ritmo = ritmoSemanal(datos);
  const restante = m ? ult.kg - m : null;
  $("pr-rango").textContent = datos.length > 1 ? `${ini.fecha} → ${ult.fecha}` : ult.fecha;
  $("pr-vacio").textContent = datos.length < 2 ? "Con un solo registro todavía no hay tendencia. Cargá otro peso más adelante." : "";
  $("pr-kpis").innerHTML = `
    <div class="kpi"><small>Peso actual</small><b>${fmt(ult.kg)}<span>kg</span></b></div>
    <div class="kpi c2"><small>Cambio total</small><b class="${cambio > 0 ? "neg" : cambio < 0 ? "pos" : ""}">${cambio > 0 ? "+" : ""}${fmt(cambio)}<span>kg</span></b></div>
    <div class="kpi c3"><small>Ritmo</small><b>${ritmo === null ? "—" : (ritmo > 0 ? "+" : "") + fmt(ritmo)}<span>${ritmo === null ? "" : "kg/sem"}</span></b></div>
    <div class="kpi c4"><small>Para tu meta</small><b>${m ? (restante > 0 ? fmt(restante) : "¡LISTO!") : "—"}<span>${m && restante > 0 ? "kg" : m ? "" : "sin meta"}</span></b></div>`;
  if (m && ini.kg !== m) {
    const avance = Math.max(0, Math.min(100, (ini.kg - ult.kg) / (ini.kg - m) * 100));
    $("pr-meta").innerHTML = `
      <div class="mut">Avance hacia <b style="color:var(--sun)">${m} kg</b>: <b style="color:var(--lime)">${Math.round(avance)}%</b></div>
      <div class="barra"><div style="width:${avance}%"></div></div>`;
  } else {
    $("pr-meta").innerHTML = m ? `<div class="mut">¡Estás en tu meta de ${m} kg!</div>` : `<div class="mut">Podés fijar una meta en la pestaña Peso.</div>`;
  }
  const avg7 = datos.map((_, i) => {
    const v = datos.slice(Math.max(0, i - 6), i + 1);
    return Math.round(v.reduce((a, p) => a + p.kg, 0) / v.length * 10) / 10;
  });
  const sets = [
    { label: "Peso", data: datos.map(p => p.kg), borderColor: NEON.cyan, backgroundColor: degradado(NEON.cyan), fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: "#05060d", pointBorderColor: NEON.cyan, pointBorderWidth: 2, pointHoverRadius: 7, borderWidth: 3 },
    { label: "Promedio 7 registros", data: avg7, borderColor: NEON.mag, borderWidth: 3, tension: .45, pointRadius: 0, fill: false }
  ];
  if (m) sets.push({ label: "Meta", data: datos.map(() => m), borderColor: NEON.sun, borderDash: [8, 6], pointRadius: 0, borderWidth: 2 });
  dibujar("pr-peso-chart", {
    type: "line",
    data: { labels: datos.map(p => p.fecha.slice(5)), datasets: sets },
    options: { scales: { y: { ticks: { callback: v => v + " kg" } } } }
  });
}

function renderEntrenamiento() {
  const semanas = volumenSemanas(8);
  const actual = semanas[semanas.length - 1].vol;
  const anterior = semanas[semanas.length - 2].vol;
  const dif = anterior ? Math.round((actual - anterior) / anterior * 100) : null;
  const corte = new Date(hoy()).getTime() - 30 * DIA_MS;
  const sesiones30 = db.sesiones.filter(s => s.series.length && new Date(s.fecha).getTime() >= corte).length;
  $("en-kpis").innerHTML = `
    <div class="kpi"><small>Sesiones (30 días)</small><b>${sesiones30}</b></div>
    <div class="kpi c2"><small>Volumen esta semana</small><b>${actual.toLocaleString("es-AR")}<span>kg</span></b></div>
    <div class="kpi c3"><small>Vs. semana anterior</small><b class="${dif > 0 ? "pos" : dif < 0 ? "neg" : ""}">${dif === null ? "—" : (dif > 0 ? "+" : "") + dif + "%"}</b></div>`;
  dibujar("en-semanas-chart", {
    type: "bar",
    data: {
      labels: semanas.map(s => s.label),
      datasets: [{
        label: "Volumen (kg)", data: semanas.map(s => s.vol),
        backgroundColor: semanas.map((_, i) => i === semanas.length - 1 ? NEON.lime : NEON.vio + "cc"),
        borderColor: semanas.map((_, i) => i === semanas.length - 1 ? NEON.lime : NEON.mag),
        borderWidth: 2, borderRadius: 10, borderSkipped: false
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });
}

function renderProgresoEjercicio() {
  const ejs = ejerciciosConocidos();
  const sel = $("p-ej");
  const actual = sel.value;
  sel.innerHTML = ejs.map(e => `<option>${esc(e)}</option>`).join("");
  if (actual && ejs.includes(actual)) sel.value = actual;
  const ej = sel.value;
  const metrica = $("p-metrica").value;
  const puntos = [];
  db.sesiones.forEach(s => {
    const xs = trab(s).filter(x => x.ejercicio === ej);
    if (!xs.length) return;
    let v;
    if (metrica === "max") v = Math.max(...xs.map(x => x.kg));
    if (metrica === "e1rm") v = Math.max(...xs.map(x => e1rm(x.kg, x.reps)));
    if (metrica === "vol") v = xs.reduce((a, x) => a + x.kg * x.reps, 0);
    puntos.push({ x: s.fecha.slice(5), y: Math.round(v * 10) / 10, f: s.fecha });
  });
  dibujar("p-chart", {
    type: "line",
    data: { labels: puntos.map(p => p.x), datasets: [{
      label: metrica, data: puntos.map(p => p.y),
      borderColor: NEON.mag, backgroundColor: degradado(NEON.mag), fill: true, tension: .35,
      pointRadius: 5, pointBackgroundColor: NEON.sun, pointBorderColor: "#05060d", pointBorderWidth: 2, borderWidth: 3
    }] },
    options: { plugins: { legend: { display: false } } }
  });
  if (puntos.length) {
    const mejor = puntos.reduce((a, b) => b.y > a.y ? b : a);
    const delta = Math.round((puntos[puntos.length - 1].y - puntos[0].y) * 10) / 10;
    $("p-stats").innerHTML = `
      <div class="kpi"><small>Último</small><b>${puntos[puntos.length - 1].y}</b></div>
      <div class="kpi c4"><small>Récord (${mejor.f})</small><b>${mejor.y}</b></div>
      <div class="kpi c3"><small>Desde el inicio</small><b class="${delta > 0 ? "pos" : delta < 0 ? "neg" : ""}">${delta > 0 ? "+" : ""}${delta}</b></div>
      <div class="kpi c2"><small>Sesiones</small><b>${puntos.length}</b></div>`;
  } else {
    $("p-stats").innerHTML = '<p class="mut">Sin datos para este ejercicio todavía.</p>';
  }
}

// ---------- Estadísticas, ranking y sobrecarga ----------
// El 1RM solo sale de series de fuerza: en hipertrofia las repeticiones altas lo distorsionan.
function e1rmSesion(ses, ej) {
  const xs = trab(ses).filter(x => x.ejercicio === ej && tipoDe(x) === "fuerza");
  return xs.length ? Math.max(...xs.map(x => e1rm(x.kg, x.reps))) : null;
}
function ejerciciosEnSesiones() {
  const set = new Set();
  sesionesConSeries().forEach(s => trab(s).forEach(x => set.add(x.ejercicio)));
  return [...set];
}

function renderEstadisticas() {
  const ses = sesionesConSeries();
  const todas = ses.flatMap(trab);
  const corte30 = new Date(hoy()).getTime() - 30 * DIA_MS;
  const ses30 = ses.filter(s => new Date(s.fecha).getTime() >= corte30);
  const series30 = ses30.flatMap(trab);
  const tonelaje = todas.reduce((a, x) => a + x.kg * x.reps, 0);
  const descs = todas.filter(x => x.descanso_seg != null).map(x => x.descanso_seg);
  const kcal30 = ses30.reduce((a, s) => a + estimarSesion(s).kcal, 0);
  const conPeso = !!pesoRef();
  let mejor = null, records = 0;
  ejerciciosEnSesiones().forEach(ej => {
    const todasE = ses.map(s => e1rmSesion(s, ej) ?? 0);
    const m = Math.max(...todasE);
    if (!mejor || m > mejor.v) mejor = { ej, v: m };
    const antes = ses.filter(s => new Date(s.fecha).getTime() < corte30).map(s => e1rmSesion(s, ej) ?? 0);
    const mejorAntes = antes.length ? Math.max(...antes) : 0;
    const ult = ses30.map(s => e1rmSesion(s, ej) ?? 0);
    if (mejorAntes > 0 && ult.length && Math.max(...ult) > mejorAntes) records++;
  });
  $("st-kpis").innerHTML = `
    <div class="kpi"><small>Sesiones</small><b>${ses.length}</b></div>
    <div class="kpi c2"><small>Series totales</small><b>${todas.length}</b></div>
    <div class="kpi c3"><small>Tonelaje total</small><b>${Math.round(tonelaje).toLocaleString("es-AR")}<span>kg</span></b></div>
    <div class="kpi c4"><small>Frecuencia</small><b>${fmt(ses30.length / 4)}<span>ses/sem</span></b></div>
    <div class="kpi"><small>Descanso promedio</small><b>${mmss(promedio(descs))}</b></div>
    <div class="kpi c2"><small>Récords (30 días)</small><b>${records}</b></div>
    <div class="kpi c3"><small>Mejor 1RM</small><b>${mejor && mejor.v ? fmt(mejor.v, 0) : "—"}<span>${mejor && mejor.v ? "kg · " + esc(mejor.ej) : ""}</span></b></div>
    <div class="kpi c4"><small>Kcal (30 días)</small><b>${conPeso ? kcal30.toLocaleString("es-AR") : "—"}<span>${conPeso ? "kcal" : "cargá peso"}</span></b></div>`;
  const grupos = {};
  series30.forEach(x => { const g = grupoDe(x.ejercicio); grupos[g] = (grupos[g] || 0) + x.kg * x.reps; });
  const labels = Object.keys(grupos);
  const colores = [NEON.cyan, NEON.mag, NEON.lime, NEON.sun, NEON.vio, NEON.red];
  dibujar("st-grupos-chart", {
    type: "bar",
    data: { labels, datasets: [{ label: "Volumen 30 días (kg)", data: labels.map(l => Math.round(grupos[l])),
      backgroundColor: labels.map((_, i) => colores[i % colores.length] + "cc"), borderRadius: 10, borderWidth: 0 }] },
    options: { plugins: { legend: { display: false } } }
  });
  $("st-kcal-nota").textContent = conPeso
    ? "Calorías: estimación orientativa (MET × peso × tiempo bajo carga). No reemplaza una medición."
    : "Cargá tu peso para estimar calorías.";
}

// Compara el 1RM promedio de las primeras sesiones con el de las últimas.
function rankingEjercicios() {
  return ejerciciosEnSesiones().map(ej => {
    const ses = sesionesConSeries().filter(s => trab(s).some(x => x.ejercicio === ej && tipoDe(x) === "fuerza"));
    if (ses.length < 2) return null;
    const vals = ses.map(s => e1rmSesion(s, ej));
    const k = Math.min(3, Math.floor(ses.length / 2));
    const ini = promedio(vals.slice(0, k)), fin = promedio(vals.slice(-k));
    const pct = ini ? (fin - ini) / ini * 100 : 0;
    return { ej, pct, n: ses.length, mejor: Math.max(...vals) };
  }).filter(Boolean);
}
let filtroEj = "mejoran";
function renderRanking() {
  const r = rankingEjercicios();
  const lista = filtroEj === "mejoran" ? r.filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct)
    : filtroEj === "bajan" ? r.filter(x => x.pct < 0).sort((a, b) => a.pct - b.pct)
    : r.sort((a, b) => b.pct - a.pct);
  $("ej-ranking").innerHTML = lista.length ? lista.map(x => `
    <button class="row filas fila-btn" data-ver="${esc(x.ej)}">
      <div style="flex:1 1 60%;text-align:left"><b>${esc(x.ej)}</b><div class="mut">${x.n} sesiones · mejor 1RM ${fmt(x.mejor)} kg</div></div>
      <b class="${x.pct > 0 ? "pos" : x.pct < 0 ? "neg" : ""}">${x.pct > 0 ? "+" : ""}${fmt(x.pct)}%</b>
    </button>`).join("") : '<p class="mut">Sin ejercicios para mostrar. Necesitás al menos 2 sesiones por ejercicio con series de fuerza.</p>';
}
$("ej-filtro").onclick = e => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  filtroEj = b.dataset.f;
  document.querySelectorAll("#ej-filtro .chip").forEach(c => c.classList.toggle("on", c === b));
  renderRanking();
};
$("ej-ranking").onclick = e => {
  const fila = e.target.closest("[data-ver]");
  if (!fila) return;
  $("p-ej").value = fila.dataset.ver;
  renderProgreso();
  $("p-chart").scrollIntoView({ behavior: "smooth", block: "center" });
};

// Reglas de sobrecarga progresiva sobre la última sesión de cada ejercicio.
function recomendaciones() {
  const ses = sesionesConSeries();
  const out = [];
  ejerciciosEnSesiones().forEach(ej => {
    const hist = ses.filter(s => trab(s).some(x => x.ejercicio === ej && tipoDe(x) === "fuerza"));
    if (!hist.length) return;
    const ult = hist[hist.length - 1];
    const xs = trab(ult).filter(x => x.ejercicio === ej && tipoDe(x) === "fuerza");
    const kgMax = Math.max(...xs.map(x => x.kg));
    const repsMin = Math.min(...xs.map(x => x.reps));
    const rpeProm = promedio(xs.map(x => x.rpe).filter(v => v != null));
    const descProm = promedio(xs.map(x => x.descanso_seg).filter(v => v != null));
    const e1Ult = e1rmSesion(ult, ej);
    const ePrev = hist.length > 1 ? e1rmSesion(hist[hist.length - 2], ej) : null;
    const tres = hist.slice(-3).map(s => e1rmSesion(s, ej));
    const estancado = tres.length === 3 && Math.max(...tres) - Math.min(...tres) <= Math.max(...tres) * 0.01;
    let tipo, consejo;
    if (ePrev && e1Ult < ePrev * 0.97) {
      tipo = "baja";
      consejo = "Bajó tu 1RM estimado. Revisá descanso, sueño y carga; si se repite la próxima sesión, bajá un 5-10 % y volvé a construir.";
    } else if (estancado) {
      tipo = "estancado";
      consejo = "Llevás 3 sesiones sin subir. Cambiá el rango de repeticiones (por ejemplo de 5 a 8) o sumá una serie.";
    } else if ((rpeProm !== null && rpeProm >= 9) || repsMin < 5) {
      tipo = "mantener";
      consejo = "Esta carga te exige al límite. Mantenela y buscá una repetición más antes de subir.";
    } else if ((rpeProm !== null && rpeProm <= 7.5 && repsMin >= 8) || (rpeProm === null && repsMin >= 10)) {
      tipo = "sube";
      consejo = kgMax > 0 ? `Subí a ${fmt(kgMax + 2.5)} kg la próxima vez.` : "Sumá peso o una serie: con peso corporal la sobrecarga viene por repeticiones.";
    } else {
      tipo = "reps";
      consejo = "Sumá una repetición por serie hasta llegar al rango alto y recién después subí la carga.";
    }
    if (descProm !== null && repsMin < 6 && descProm < 120) consejo += " Para cargas altas conviene descansar 2 a 3 minutos.";
    const objetivo = {
      sube: kgMax > 0 ? `${fmt(kgMax + 2.5)} kg × ${repsMin} reps` : `${repsMin + 1} reps`,
      reps: `${kgMax} kg · ${repsMin + 1} reps mínimas`,
      mantener: `${kgMax} kg · mismas reps`,
      baja: `${fmt(kgMax * 0.95)} kg`,
      estancado: "cambiá el rango de reps"
    }[tipo];
    out.push({ ej, tipo, consejo, objetivo });
  });
  return out;
}
// Ejercicios de hipertrofia: la progresión se mira en repeticiones, no en 1RM.
function recHipertrofia(ej, ses) {
  const hist = ses.filter(s => trab(s).some(x => x.ejercicio === ej && tipoDe(x) === "hipertrofia"));
  if (!hist.length) return null;
  const xs = trab(hist[hist.length - 1]).filter(x => x.ejercicio === ej && tipoDe(x) === "hipertrofia");
  const kgMax = Math.max(...xs.map(x => x.kg));
  const repsMin = Math.min(...xs.map(x => x.reps));
  const rpeProm = promedio(xs.map(x => x.rpe).filter(v => v != null));
  if (rpeProm !== null && rpeProm >= 9) return { ej, tipo: "mantener", consejo: "Las series están muy cerca del fallo: mantené la carga y buscá una repetición más.", objetivo: `${fmt(kgMax)} kg · mismas reps` };
  if (repsMin >= 12 && kgMax > 0) return { ej, tipo: "sube", consejo: "Llegaste al rango alto en todas las series: subí la carga y volvé a empezar desde el rango bajo.", objetivo: `${fmt(kgMax + 2.5)} kg × ${repsMin} reps` };
  return { ej, tipo: "reps", consejo: "Sumá una repetición por serie hasta llegar a 12 y después subí la carga.", objetivo: `${fmt(kgMax)} kg · ${repsMin + 1} reps mínimas` };
}
function recomendacionesTodas() {
  const ses = sesionesConSeries();
  const out = recomendaciones();
  ejerciciosEnSesiones().forEach(ej => {
    if (out.some(x => x.ej === ej)) return;
    const r = recHipertrofia(ej, ses);
    if (r) out.push(r);
  });
  return out;
}
const ORDEN_PLAN = { baja: 0, estancado: 1, mantener: 2, reps: 3, sube: 4 };
const ETQ_PLAN = { baja: "Bajó", estancado: "Estancado", mantener: "Al límite", reps: "Sumá reps", sube: "Subí carga" };
function htmlPlan(lista) {
  const color = { baja: "neg", sube: "pos" };
  return lista.map(x => `
    <div class="plan-item" style="display:block">
      <div><b style="color:var(--sun)">${esc(x.ej)}</b> <span class="${color[x.tipo] || ""}">${ETQ_PLAN[x.tipo]}</span></div>
      <div class="mut">${esc(x.consejo)}</div>
      <div style="margin-top:6px">Próxima vez: <b>${esc(x.objetivo)}</b></div>
    </div>`).join("");
}
function renderPlan() {
  const r = recomendacionesTodas().sort((a, b) => ORDEN_PLAN[a.tipo] - ORDEN_PLAN[b.tipo]);
  $("plan").innerHTML = r.length ? htmlPlan(r) : '<p class="mut">Cuando tengas 2 sesiones con el mismo ejercicio, acá aparece qué hacer la próxima vez.</p>';
}
$("so-analizar").onclick = () => {
  const color = { baja: "neg", sube: "pos" };
  const r = recomendacionesTodas().sort((a, b) => ORDEN_PLAN[a.tipo] - ORDEN_PLAN[b.tipo]);
  $("so-resultado").innerHTML = r.length ? `
    <p class="mut">Sobrecarga progresiva: subir de a poco la carga, las repeticiones o las series. Orientativo; no reemplaza a tu profesor.</p>
    ${r.map(x => `
      <div class="row filas">
        <div style="flex:1 1 70%"><b style="color:var(--sun)">${esc(x.ej)}</b> <span class="${color[x.tipo] || ""}">${ETQ_PLAN[x.tipo]}</span><div class="mut">${esc(x.consejo)}</div></div>
      </div>`).join("")}` : '<p class="mut">Necesitás al menos 2 sesiones con el mismo ejercicio para dar recomendaciones.</p>';
};

// ---------- Rachas e hitos ----------
const UMBRALES = { ses: [10, 25, 50, 100, 200], rec: [1, 5, 10, 25, 50], racha: [4, 8, 12, 24, 52], meta: [25, 50, 75, 100] };
// Cuenta las semanas seguidas que cumplen. La semana en curso no corta la racha si todavía no terminó.
function rachaActual(flags) {
  let arr = flags.slice();
  if (arr.length && !arr[arr.length - 1]) arr = arr.slice(0, -1);
  let n = 0;
  for (let i = arr.length - 1; i >= 0 && arr[i]; i--) n++;
  return n;
}
function avanceMeta() {
  const m = ajustes.meta;
  if (!m || !db.peso.length) return null;
  const ini = db.peso[0].kg, ult = db.peso[db.peso.length - 1].kg;
  if (ini === m) return 100;
  return Math.max(0, Math.min(100, (ini - ult) / (ini - m) * 100));
}
function calcularProgreso() {
  const ses = sesionesConSeries().slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
  const semanas = {};
  const sem = k => (semanas[k] = semanas[k] || { ses: 0, vol: 0, kcal: 0, records: 0 });
  const mejorPrevio = {};
  const pesoOK = !!pesoRef();
  let records = 0;
  ses.forEach(s => {
    const w = sem(lunesDe(s.fecha));
    w.ses++;
    w.vol += trab(s).reduce((a, x) => a + x.kg * x.reps, 0);
    if (pesoOK) w.kcal += estimarSesion(s).kcal;
    new Set(trab(s).map(x => x.ejercicio)).forEach(ej => {
      const v = e1rmSesion(s, ej);
      if (v === null) return;
      if (mejorPrevio[ej] && v > mejorPrevio[ej]) { w.records++; records++; }
      mejorPrevio[ej] = Math.max(mejorPrevio[ej] || 0, v);
    });
  });
  const hoyK = lunesDe(hoy());
  const primera = ses.length ? lunesDe(ses[0].fecha) : hoyK;
  const lista = [];
  for (let k = primera; k <= hoyK; k = sumarDias(k, 7)) lista.push(k);
  const w = lista.map(k => semanas[k] || { ses: 0, vol: 0, kcal: 0, records: 0 });
  const cumple = {
    objetivo: w.map(x => x.ses >= ajustes.dias),
    record: w.map(x => x.records > 0),
    kcal: w.map((x, i) => i > 0 && x.kcal > 0 && x.kcal > w[i - 1].kcal),
    volumen: w.map((x, i) => i > 0 && x.vol > w[i - 1].vol)
  };
  const rachas = {};
  Object.keys(cumple).forEach(c => rachas[c] = rachaActual(cumple[c]));
  return { sesiones: ses.length, records, semanas: w, rachas };
}
function barraHito(nombre, valor, umbrales, unidad) {
  const sig = umbrales.find(u => u > valor);
  if (sig === undefined) return `
    <div class="plan-item" style="display:block">
      <div class="row" style="margin:0"><b>${nombre}</b><span class="mut" style="margin-left:auto">¡Conseguidos!</span></div>
      <div class="barra gruesa"><div style="width:100%"></div></div>
    </div>`;
  const ant = [0, ...umbrales].filter(u => u <= valor).pop();
  const pct = Math.round((valor - ant) / (sig - ant) * 100);
  return `
    <div class="plan-item" style="display:block">
      <div class="row" style="margin:0"><b>${nombre}</b><span class="mut" style="margin-left:auto">${fmt(valor, 0)} / ${sig}${unidad}</span></div>
      <div class="barra gruesa" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${nombre}"><div style="width:${pct}%"></div></div>
      <div class="mut">Próximo hito: ${sig}${unidad} · faltan ${fmt(sig - valor, 0)}${unidad}</div>
    </div>`;
}
function renderRachasHitos(p) {
  const r = p.rachas;
  const etiquetas = { objetivo: `Semanas en meta (${ajustes.dias} días)`, record: "Semanas con récord", kcal: "Semanas quemando más", volumen: "Semanas con más carga" };
  $("rachas").innerHTML = Object.keys(etiquetas).map(k => `
    <div class="racha"><small>${etiquetas[k]}</small><b><span class="llama">${r[k] ? "🔥" : "💤"}</span> ${r[k]}</b><small>seguidas</small></div>`).join("");
  const av = avanceMeta();
  $("hitos").innerHTML =
    barraHito("Sesiones", p.sesiones, UMBRALES.ses, "") +
    barraHito("Récords de kilos", p.records, UMBRALES.rec, "") +
    barraHito("Semanas en meta", r.objetivo, UMBRALES.racha, "") +
    (av !== null ? barraHito("Meta de peso", av, UMBRALES.meta, "%") : `<p class="mut">Fijá una meta de peso en la pestaña Peso para ver ese hito.</p>`);
}
function logrosHitos(p) {
  const out = [];
  UMBRALES.ses.filter(u => p.sesiones >= u).forEach(u => out.push({ k: `ses-${u}`, t: `${u} sesiones completadas` }));
  UMBRALES.rec.filter(u => p.records >= u).forEach(u => out.push({ k: `rec-${u}`, t: `${u} récord${u > 1 ? "es" : ""} de kilos` }));
  UMBRALES.racha.filter(u => p.rachas.objetivo >= u).forEach(u => out.push({ k: `racha-${u}`, t: `${u} semanas seguidas en tu meta` }));
  const av = avanceMeta();
  if (av !== null) UMBRALES.meta.filter(u => av >= u).forEach(u => out.push({ k: `meta-${u}`, t: `${u} % hacia tu meta de peso` }));
  return out;
}
// La primera vez marca los hitos ya conseguidos sin festejarlos; después avisa solo los nuevos.
function revisarHitos(p) {
  const logros = logrosHitos(p);
  if (!ajustes.hitosInit) {
    ajustes.hitos = logros.map(x => x.k);
    ajustes.hitosInit = true;
    guardarTodo();
    return;
  }
  const nuevos = logros.filter(x => !ajustes.hitos.includes(x.k));
  if (!nuevos.length) return;
  ajustes.hitos = [...ajustes.hitos, ...nuevos.map(x => x.k)];
  guardarTodo();
  mostrarHito("¡Hito conseguido!", nuevos[nuevos.length - 1].t);
}
function mostrarHito(titulo, sub) {
  const h = $("hito");
  h.innerHTML = `<span class="estrella">🏆</span><b>${esc(titulo)}</b><span>${esc(sub)}</span>`;
  h.classList.remove("hidden");
  h.style.animation = "none"; void h.offsetWidth; h.style.animation = "";
  haptico(40);
  clearTimeout(mostrarHito.t);
  mostrarHito.t = setTimeout(() => h.classList.add("hidden"), 3500);
}

// ---------- Mapa corporal ----------
function renderMapa() {
  const corte = new Date(hoy()).getTime() - 7 * DIA_MS;
  const vol = {};
  sesionesConSeries().forEach(s => {
    if (new Date(s.fecha).getTime() <= corte) return;
    trab(s).forEach(x => { const g = grupoDe(x.ejercicio); vol[g] = (vol[g] || 0) + x.kg * x.reps; });
  });
  const max = Math.max(0, ...Object.values(vol));
  document.querySelectorAll("#mapa-svg [data-g]").forEach(el => {
    const r = max ? (vol[el.dataset.g] || 0) / max : 0;
    el.style.fill = r ? "var(--cyan)" : "#ffffff";
    el.style.fillOpacity = r ? (0.2 + 0.8 * r).toFixed(2) : "0.06";
  });
  const filas = Object.entries(vol).sort((a, b) => b[1] - a[1]);
  $("mapa-lista").innerHTML = filas.length ? filas.map(([g, v]) => `
    <div style="margin-top:8px">
      <div class="row" style="margin:0"><b>${esc(g)}</b><span class="mut" style="margin-left:auto">${Math.round(v).toLocaleString("es-AR")} kg</span></div>
      <div class="barra"><div style="width:${Math.round(v / max * 100)}%"></div></div>
    </div>`).join("") : '<p class="mut">Sin entrenamientos en los últimos 7 días.</p>';
}

// ---------- Series por músculo (últimos 7 días) ----------
// Rango orientativo de 10 a 20 series efectivas por semana para cada grupo.
const RANGO_SERIES = [10, 20];
function renderVolGrupos() {
  const corte = sumarDias(hoy(), -6);
  const n = {};
  GRUPOS_MUSC.forEach(g => n[g] = 0);
  sesionesConSeries().forEach(s => {
    if (s.fecha < corte) return;
    trab(s).forEach(x => { const g = grupoDe(x.ejercicio); if (g in n) n[g]++; });
  });
  const tope = 26;
  $("vg-lista").innerHTML = GRUPOS_MUSC.map(g => {
    const v = n[g];
    const estado = v < RANGO_SERIES[0] ? ["bajo", "Poco"] : v <= RANGO_SERIES[1] ? ["ok", "En rango"] : ["alto", "Mucho"];
    return `
      <div class="vg">
        <div class="vg-cab"><b>${esc(g)}</b><span class="vg-est ${estado[0]}">${estado[1]}</span><span class="mut vg-n">${v} series</span></div>
        <div class="vg-barra" role="img" aria-label="${esc(g)}: ${v} series, ${estado[1]}">
          <div class="vg-zona" style="left:${RANGO_SERIES[0] / tope * 100}%;width:${(RANGO_SERIES[1] - RANGO_SERIES[0]) / tope * 100}%"></div>
          <div class="vg-val ${estado[0]}" style="width:${Math.min(100, v / tope * 100)}%"></div>
        </div>
      </div>`;
  }).join("");
}

// ---------- Calendario anual ----------
function renderCalendario() {
  const porDia = {};
  sesionesConSeries().forEach(s => { porDia[s.fecha] = (porDia[s.fecha] || 0) + trab(s).reduce((a, x) => a + x.kg * x.reps, 0) + 1; });
  const vals = Object.values(porDia).sort((a, b) => a - b);
  const q = p => vals.length ? vals[Math.floor((vals.length - 1) * p)] : 0;
  const cortes = [q(.25), q(.5), q(.75)];
  const nivel = v => !v ? 0 : v <= cortes[0] ? 1 : v <= cortes[1] ? 2 : v <= cortes[2] ? 3 : 4;
  const h = hoy();
  const inicio = sumarDias(lunesDe(h), -52 * 7);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  let celdas = "", etiquetas = "", dias = 0, mesPrev = -1;
  for (let w = 0; w <= 52; w++) {
    const lunes = sumarDias(inicio, w * 7);
    const mes = new Date(lunes + "T00:00").getMonth();
    etiquetas += `<span>${mes !== mesPrev ? meses[mes] : ""}</span>`;
    mesPrev = mes;
    for (let d = 0; d < 7; d++) {
      const f = sumarDias(lunes, d);
      if (f > h) { celdas += `<i class="cal-c fut"></i>`; continue; }
      const v = porDia[f] || 0;
      if (v) dias++;
      celdas += `<i class="cal-c n${nivel(v)}" data-f="${f}" title="${f}"></i>`;
    }
  }
  $("cal-meses").innerHTML = etiquetas;
  $("cal-grilla").innerHTML = celdas;
  const sc = $("cal-scroll");
  sc.scrollLeft = sc.scrollWidth;
  const semanasActivas = new Set(Object.keys(porDia).filter(f => f >= inicio).map(lunesDe)).size;
  $("cal-resumen").innerHTML = `<b>${dias}</b> días entrenados en el último año · <b>${semanasActivas}</b> semanas con al menos una sesión`;
}
$("cal-grilla").onclick = e => {
  const c = e.target.closest("[data-f]");
  if (!c) return;
  const ses = sesionesConSeries().filter(s => s.fecha === c.dataset.f);
  if (!ses.length) return toast(`${c.dataset.f}: sin entrenamiento`);
  const ejs = [...new Set(ses.flatMap(s => s.series.map(x => x.ejercicio)))];
  toast(`${c.dataset.f}: ${ejs.slice(0, 3).join(", ")}${ejs.length > 3 ? "…" : ""}`);
};

function renderProgreso() {
  renderProgresoPeso();
  renderEntrenamiento();
  renderProgresoEjercicio();
  renderEstadisticas();
  renderRanking();
  const p = calcularProgreso();
  renderRachasHitos(p);
  renderPlan();
  renderMapa();
  renderVolGrupos();
  renderCalendario();
  revisarHitos(p);
}
$("p-ej").onchange = renderProgreso;
$("p-metrica").onchange = renderProgreso;
$("rango-filtro").onclick = e => {
  const b = e.target.closest("button[data-r]");
  if (!b) return;
  rangoPeso = parseInt(b.dataset.r);
  document.querySelectorAll("#rango-filtro .chip").forEach(c => c.classList.toggle("on", c === b));
  renderProgresoPeso();
};
