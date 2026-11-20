// ============================================================
// panel.js — tablero de inicio, logros (nivel e insignias) y mini gráficos.
// Todo se calcula con tus datos: no usa tablas nuevas. Va antes de app.js.
// ============================================================

let tableroAnimado = false;

// ---------- Gráficos pequeños (SVG) ----------
function svgAnillo(frac, tam = 112, g = 11) {
  const r = (tam - g) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
  const m = tam / 2;
  return `<svg class="anillo" width="${tam}" height="${tam}" viewBox="0 0 ${tam} ${tam}" aria-hidden="true">
    <defs><linearGradient id="gAnillo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--cyan)"/><stop offset="1" style="stop-color:var(--lime)"/></linearGradient></defs>
    <circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${g}"/>
    <circle class="anillo-v" cx="${m}" cy="${m}" r="${r}" fill="none" stroke="url(#gAnillo)" stroke-width="${g}" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" style="--c:${c.toFixed(1)};--off:${(c * (1 - f)).toFixed(1)}" transform="rotate(-90 ${m} ${m})"/>
  </svg>`;
}
function svgSpark(vals, w = 88, h = 30) {
  if (!vals || vals.length < 2) return "";
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const pts = vals.map((v, i) => [2 + i / (vals.length - 1) * (w - 4), h - 4 - (v - mn) / rg * (h - 9)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const u = pts[pts.length - 1];
  const sube = vals[vals.length - 1] >= vals[0];
  return `<svg class="spark ${sube ? "sube" : "baja"}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${u[0].toFixed(1)}" cy="${u[1].toFixed(1)}" r="3" fill="currentColor"/></svg>`;
}
// Evolución del 1RM estimado de un ejercicio en sus últimas sesiones (cualquier tipo de serie hasta 15 repeticiones).
function tendenciaEj(ej) {
  const vals = sesionesConSeries().slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(s => {
    const xs = trab(s).filter(x => x.ejercicio === ej && x.kg > 0 && x.reps > 0 && x.reps <= 15);
    return xs.length ? Math.max(...xs.map(x => e1rm(x.kg, x.reps, x.rpe))) : null;
  }).filter(v => v !== null).slice(-8);
  return vals.length >= 3 ? svgSpark(vals, 84, 28) : "";
}

// ---------- Datos compartidos ----------
function datosPanel() {
  const ses = sesionesConSeries().slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
  const p = calcularProgreso();
  const meta = ajustes.dias || 3;
  const semanasMeta = p.semanas.filter(w => w.ses >= meta).length;
  const recs = ultimosRecords(ses, s => [...new Set(trab(s).map(x => x.ejercicio))], e1rmSesion, 200);
  const volTotal = ses.reduce((a, s) => a + trab(s).reduce((b, x) => b + x.kg * x.reps, 0), 0);
  const nivel = nivelDe(puntosXP({ sesiones: p.sesiones, records: p.records, semanasMeta }));
  const ins = insignias({ sesiones: p.sesiones, records: p.records, rachaMeta: p.rachas.objetivo, volTotal });
  return { ses, p, meta, recs, volTotal, nivel, ins };
}
const saludoHora = () => { const h = new Date().getHours(); return h < 6 ? "Buenas noches" : h < 13 ? "Buen día" : h < 20 ? "Buenas tardes" : "Buenas noches"; };
const haceCuanto = f => { const n = diasEntre(f, hoy()); return n <= 0 ? "hoy" : n === 1 ? "ayer" : `hace ${n} días`; };
const miles = n => Math.round(n).toLocaleString("es-AR");

// ---------- Tablero (arriba de Sesión) ----------
function renderTablero() {
  const el = $("tablero");
  if (!el) return;
  const d = datosPanel();
  const dias = semanaDias(d.ses, hoy());
  const hechos = dias.filter(x => x.sesiones > 0).length;
  const falta = Math.max(0, d.meta - hechos);
  const mensaje = !d.p.sesiones ? "Registrá tu primera sesión para empezar"
    : hechos >= d.meta ? "Meta de la semana cumplida"
    : `${falta === 1 ? "Te falta" : "Te faltan"} ${falta} ${falta === 1 ? "día" : "días"} para tu meta`;
  const sem = d.p.semanas;
  const vol = sem.length ? sem[sem.length - 1].vol : 0, volAnt = sem.length > 1 ? sem[sem.length - 2].vol : 0;
  const delta = volAnt > 0 ? Math.round((vol / volAnt - 1) * 100) : null;
  const hace30 = sumarDias(hoy(), -30);
  const recs30 = d.recs.filter(r => r.fecha >= hace30).length;
  const racha = d.p.rachas.objetivo;
  const nombre = (typeof cuenta !== "undefined" && cuenta?.nombre ? String(cuenta.nombre).split(" ")[0] : "");
  const anim = !tableroAnimado && d.p.sesiones > 0;
  if (anim) tableroAnimado = true;
  const n = d.nivel;
  el.className = "card tablero" + (anim ? " tb-anim" : "");
  el.innerHTML = `
    <div class="tb-cab">
      <div class="tb-saludo"><b>${saludoHora()}${nombre ? ", " + esc(nombre) : ""}</b><span class="mut">${esc(new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }))}</span></div>
      <div class="tb-nivel" title="Nivel ${n.nivel} · ${n.nombre}"><div class="hex"><b>${n.nivel}</b></div><span>${n.nombre}</span></div>
    </div>
    <div class="tb-semana">
      <div class="tb-anillo">${svgAnillo(hechos / d.meta)}<div class="tb-anillo-c"><b>${hechos}</b><span>de ${d.meta}</span></div></div>
      <div class="tb-texto"><b>Esta semana</b><span>${esc(mensaje)}</span></div>
    </div>
    <div class="tb-dias" role="list" aria-label="Días de esta semana">
      ${dias.map(x => `<div class="tb-dia${x.sesiones ? " hecho" : ""}${x.hoy ? " hoy" : ""}${x.futuro ? " futuro" : ""}" role="listitem" aria-label="${esc(fechaCorta(x.fecha))}${x.sesiones ? ", entrenaste" : ""}">
        <span class="tb-bola">${x.sesiones ? "✓" : ""}</span><span class="tb-letra">${x.letra}</span></div>`).join("")}
    </div>
    <div class="tb-kpis">
      <div class="tb-kpi"><span class="tb-k-t">Volumen semanal</span><b>${miles(vol)} <small>kg</small></b>
        <span class="tb-k-p">${delta === null ? "&nbsp;" : `<i class="${delta >= 0 ? "pos" : "neg"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} %</i> vs. anterior`}</span>${svgSpark(sem.slice(-8).map(x => x.vol), 96, 26)}</div>
      <div class="tb-kpi"><span class="tb-k-t">Racha</span><b>${racha ? "🔥" : "💤"} ${racha}</b>
        <span class="tb-k-p">${racha === 1 ? "semana seguida" : "semanas seguidas"} en meta</span></div>
      <div class="tb-kpi"><span class="tb-k-t">Récords</span><b>⭐ ${recs30}</b>
        <span class="tb-k-p">últimos 30 días</span></div>
    </div>
    <div class="tb-xp" role="img" aria-label="Nivel ${n.nivel}, ${Math.round(n.pct * 100)} por ciento hacia el siguiente">
      <div class="tb-xp-t"><span>Nivel ${n.nivel} · ${n.nombre}</span><span class="mut">${miles(n.hasta - n.xp)} pts para el nivel ${n.nivel + 1}</span></div>
      <div class="lg-barra"><div style="width:${Math.round(n.pct * 100)}%"></div></div>
    </div>`;
}

// ---------- Logros (en Progreso) ----------
function renderLogros() {
  const el = $("logros");
  if (!el) return;
  const d = datosPanel(), n = d.nivel;
  const ganadas = d.ins.filter(i => i.ok).length;
  el.innerHTML = `
    <div class="lg-nivel">
      <div class="hex grande"><b>${n.nivel}</b></div>
      <div class="lg-nivel-t"><b>Nivel ${n.nivel} · ${n.nombre}</b>
        <div class="lg-barra"><div style="width:${Math.round(n.pct * 100)}%"></div></div>
        <span class="mut">${miles(n.xp)} pts · faltan ${miles(n.hasta - n.xp)} para el nivel ${n.nivel + 1}</span></div>
    </div>
    <p class="mut lg-reglas">Sumás puntos con cada sesión (100), récord (60) y semana en meta (150).</p>
    <div class="lg-tit">Insignias <span class="mut">${ganadas} de ${d.ins.length}</span></div>
    <div class="lg-grid">
      ${d.ins.map(i => `
        <div class="lg-ins${i.ok ? " ok" : ""}" title="${esc(i.desc)}">
          <span class="lg-ico">${i.icono}</span><b>${esc(i.titulo)}</b>
          ${i.ok ? '<span class="lg-listo">Lograda</span>' : `<div class="lg-barra fina"><div style="width:${Math.round(i.v / i.max * 100)}%"></div></div><span class="mut lg-av">${fmtKg(Math.round(i.v * 10) / 10)} / ${i.max}</span>`}
        </div>`).join("")}
    </div>
    <div class="lg-tit">Últimos récords <span class="mut">1RM estimado</span></div>
    ${d.recs.length ? d.recs.slice(0, 5).map(r => `
      <div class="lg-rec">
        <span class="lg-trofeo">🏆</span>
        <div class="lg-rec-n"><b>${esc(nombreBonito(r.ej))}</b><span class="mut">${haceCuanto(r.fecha)}</span></div>
        <div class="lg-rec-v"><b>${fmtKg(Math.round(r.valor * 10) / 10)} kg</b><span class="pos">+${r.pct.toFixed(1).replace(".", ",")} %</span></div>
      </div>`).join("") : '<p class="mut">Todavía no superaste ninguna marca. Cuando subas tu mejor 1RM de un ejercicio, aparece acá.</p>'}`;
}
