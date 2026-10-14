// Tablero de ventas EcoBottle AR
// Lee los CSV de origen, aplica las reglas de la consigna y recalcula todo
// cada vez que cambia un filtro. Sin librerías: SVG y JavaScript puro.

// ---------------------------------------------------------------------
// Reglas y constantes
// ---------------------------------------------------------------------
const ESTADOS = ["FULFILLED", "PAID", "CANCELLED", "REFUNDED", "CREATED"];
const DESC = {
  FULFILLED: "Entregado o comprado en tienda",
  PAID: "Pagado, sin entregar",
  CANCELLED: "Cancelado",
  REFUNDED: "Entregado y reembolsado",
  CREATED: "Creado, sin pagar",
};
const REGLA_CONSIGNA = ["PAID", "FULFILLED"]; // estados que cuentan como venta
const MONTOS = {
  total: "total_amount (con IVA y envío)",
  sinEnvio: "total sin envío (con IVA)",
  neto: "subtotal (sin IVA ni envío)",
};
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];


// ---------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------
const fPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fEntero = new Intl.NumberFormat("es-AR");
const fPct = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fCompacto = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

const pesos = (cent) => fPesos.format(cent / 100);
const pesosCompacto = (v) => "$ " + fCompacto.format(v);
const pesosMillones = (cent) => "$ " + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(cent / 1e8) + " M";
const etiquetaMes = (ym) => `${MESES_CORTOS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
const etiquetaMesLarga = (ym) => `${MESES_CORTOS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

// ---------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------
// Los montos se guardan en centavos enteros para que las sumas sean exactas.
const aCent = (t) => Math.round(parseFloat(t) * 100);

function parsearCSV(texto) {
  const lineas = texto.trim().split(/\r?\n/);
  const cols = lineas[0].split(",");
  return lineas.slice(1).map((l) => {
    const v = l.split(",");
    const fila = {};
    cols.forEach((c, i) => { fila[c] = v[i] ?? ""; });
    return fila;
  });
}

let PEDIDOS = [];      // un objeto por pedido, ya preparado
let MESES = [];        // "2024-01" … "2025-09"
let PROVINCIAS = [];

function preparar(ventas, direcciones, provincias) {
  const nombreProv = Object.fromEntries(provincias.map((p) => [p.province_id, p.name]));
  const provDeDireccion = Object.fromEntries(direcciones.map((d) => [d.address_id, nombreProv[d.province_id]]));

  PEDIDOS = ventas.map((p) => {
    const online = p.store_id === "";
    const total = aCent(p.total_amount);
    return {
      ym: p.order_date.slice(0, 7),
      canal: online ? "online" : "offline",
      prov: provDeDireccion[p.shipping_address_id] ?? "Desconocida",
      estado: p.status,
      total,
      sinEnvio: total - aCent(p.shipping_fee),
      neto: aCent(p.subtotal),
    };
  });
  MESES = [...new Set(PEDIDOS.map((p) => p.ym))].sort();
  PROVINCIAS = [...new Set(PEDIDOS.map((p) => p.prov))].sort((a, b) => a.localeCompare(b, "es"));
}

// ---------------------------------------------------------------------
// Estado de los filtros
// ---------------------------------------------------------------------
const estadoInicial = () => ({
  desde: MESES[0], hasta: MESES[MESES.length - 1],
  canal: "todos", prov: "todas", monto: "total",
  estados: new Set(REGLA_CONSIGNA),
  rangoPrevio: null, // para deshacer el clic en un mes
});
let F = null;

function calcular() {
  const base = PEDIDOS.filter((p) =>
    p.ym >= F.desde && p.ym <= F.hasta &&
    (F.canal === "todos" || p.canal === F.canal) &&
    (F.prov === "todas" || p.prov === F.prov));

  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, { pedidos: 0, cent: 0 }]));
  const canal = { online: { pedidos: 0, cent: 0, sinEnvio: 0 }, offline: { pedidos: 0, cent: 0, sinEnvio: 0 } };
  const meses = Object.fromEntries(MESES.filter((m) => m >= F.desde && m <= F.hasta)
    .map((m) => [m, { online: { pedidos: 0, cent: 0 }, offline: { pedidos: 0, cent: 0 } }]));

  for (const p of base) {
    const monto = p[F.monto];
    porEstado[p.estado].pedidos += 1;
    porEstado[p.estado].cent += monto;
    if (!F.estados.has(p.estado)) continue;
    const c = canal[p.canal];
    c.pedidos += 1;
    c.cent += monto;
    c.sinEnvio += p.sinEnvio;
    meses[p.ym][p.canal].pedidos += 1;
    meses[p.ym][p.canal].cent += monto;
  }
  const pedidos = canal.online.pedidos + canal.offline.pedidos;
  const cent = canal.online.cent + canal.offline.cent;
  return { totalBase: base.length, porEstado, canal, meses, pedidos, cent };
}

// ---------------------------------------------------------------------
// Utilidades de SVG y tooltip
// ---------------------------------------------------------------------
const NS = "http://www.w3.org/2000/svg";
function el(nombre, attrs = {}, padre) {
  const n = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (padre) padre.appendChild(n);
  return n;
}
function texto(padre, x, y, contenido, attrs = {}) {
  const t = el("text", { x, y, ...attrs }, padre);
  t.textContent = contenido;
  return t;
}
// Barra con extremo de datos redondeado (4px) y base recta
function barraVertical(x, y, w, h, r = 4) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function barraHorizontal(x, y, w, h, r = 4) {
  r = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}
function escalaLinda(max, ticks = 4) {
  if (max <= 0) return { max: 1, paso: 1 };
  const bruto = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= bruto);
  return { max: Math.ceil(max / paso) * paso, paso };
}

const tooltip = document.getElementById("tooltip");
function mostrarTooltip(evento, titulo, filas) {
  tooltip.replaceChildren();
  const t = document.createElement("div");
  t.className = "tt-tit";
  t.textContent = titulo;
  tooltip.appendChild(t);
  for (const [color, nombre, valor] of filas) {
    const f = document.createElement("div");
    f.className = "tt-fila";
    if (color) {
      const k = document.createElement("span");
      k.className = "tt-key";
      k.style.background = color;
      f.appendChild(k);
    }
    const n = document.createElement("span");
    n.textContent = nombre;
    const v = document.createElement("strong");
    v.textContent = valor;
    f.append(n, v);
    tooltip.appendChild(f);
  }
  tooltip.hidden = false;
  const r = tooltip.getBoundingClientRect();
  const px = evento.clientX ?? evento.target.getBoundingClientRect().right;
  const py = evento.clientY ?? evento.target.getBoundingClientRect().top;
  let x = px + 14, y = py - r.height - 10;
  if (x + r.width > window.innerWidth - 8) x = px - r.width - 14;
  if (y < 8) y = py + 16;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}
const ocultarTooltip = () => { tooltip.hidden = true; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------------------------------------------------------------------
// Gráfico 1: ventas por mes, apiladas por canal (clic = filtrar mes)
// ---------------------------------------------------------------------
function graficoMeses(r) {
  const cont = document.getElementById("g-meses");
  const W = cont.clientWidth, H = 260;
  const m = { l: 56, r: 8, t: 12, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const meses = Object.keys(r.meses);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Ventas por mes y canal" });
  const max = Math.max(0, ...meses.map((k) => r.meses[k].online.cent + r.meses[k].offline.cent)) / 100;
  const { max: ymax, paso } = escalaLinda(max);
  const y = (v) => m.t + ih - (v / ymax) * ih;

  for (let v = 0; v <= ymax + 1e-9; v += paso) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "base" : "eje-linea" }, svg);
    texto(svg, m.l - 8, y(v) + 4, pesosCompacto(v), { class: "eje", "text-anchor": "end" });
  }
  if (!meses.length || max === 0) {
    texto(svg, W / 2, H / 2, "No hay ventas con estos filtros", { class: "vacio", "text-anchor": "middle" });
    cont.replaceChildren(svg);
    return;
  }

  const banda = iw / meses.length;
  const bw = Math.min(24, banda * 0.62);
  const cadaCuanto = banda >= 38 ? 1 : banda >= 18 ? 3 : 6;
  const unSoloMes = F.desde === F.hasta;

  meses.forEach((k, i) => {
    const d = r.meses[k];
    const cx = m.l + banda * i + banda / 2;
    const x0 = cx - bw / 2;
    const vOn = d.online.cent / 100, vOff = d.offline.cent / 100;
    const g = el("g", { class: "marca", tabindex: 0, role: "button", "aria-label": `${etiquetaMesLarga(k)}: ${pesos(d.online.cent + d.offline.cent)}. Clic para filtrar` }, svg);

    // Apilado: online abajo, offline arriba, con 2px de superficie entre segmentos
    const hOn = (vOn / ymax) * ih, hOff = (vOff / ymax) * ih;
    const gap = hOn > 0 && hOff > 0 ? 2 : 0;
    const base = m.t + ih;
    if (hOn > 0) {
      const top = hOff > 0 ? `M${x0},${base}V${base - hOn}H${x0 + bw}V${base}Z` : barraVertical(x0, base - hOn, bw, hOn);
      el("path", { d: top, fill: css("--online") }, g);
    }
    if (hOff > 0) {
      const h = Math.max(0, hOff - gap);
      el("path", { d: barraVertical(x0, base - hOn - gap - h, bw, h), fill: css("--offline") }, g);
    }
    // Zona de clic más grande que la barra
    el("rect", { x: m.l + banda * i, y: m.t, width: banda, height: ih, fill: "transparent" }, g);

    if (i % cadaCuanto === 0 || unSoloMes) {
      texto(svg, cx, H - 10, etiquetaMes(k), { class: "eje", "text-anchor": "middle" });
    }

    const filas = [];
    if (F.canal !== "offline") filas.push([css("--online"), "Online", pesos(d.online.cent)]);
    if (F.canal !== "online") filas.push([css("--offline"), "Offline", pesos(d.offline.cent)]);
    filas.push([null, "Total", pesos(d.online.cent + d.offline.cent)]);
    const tip = (e) => mostrarTooltip(e, etiquetaMesLarga(k), filas);
    g.addEventListener("pointermove", tip);
    g.addEventListener("focus", tip);
    g.addEventListener("pointerleave", ocultarTooltip);
    g.addEventListener("blur", ocultarTooltip);
    const elegir = () => { ocultarTooltip(); alternarMes(k); };
    g.addEventListener("click", elegir);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(); } });
  });
  cont.replaceChildren(svg);

  // Tabla equivalente (el gráfico nunca es la única forma de leer los datos)
  const tabla = document.getElementById("t-meses");
  tabla.replaceChildren();
  const cab = tabla.createTHead().insertRow();
  ["Mes", "Online", "Offline", "Total", "Pedidos válidos"].forEach((t, i) => {
    const th = document.createElement("th");
    th.textContent = t;
    if (i) th.className = "n";
    cab.appendChild(th);
  });
  const cuerpo = tabla.createTBody();
  meses.forEach((k) => {
    const d = r.meses[k];
    const fila = cuerpo.insertRow();
    [etiquetaMesLarga(k), pesos(d.online.cent), pesos(d.offline.cent), pesos(d.online.cent + d.offline.cent),
      fEntero.format(d.online.pedidos + d.offline.pedidos)].forEach((v, i) => {
      const td = fila.insertCell();
      td.textContent = v;
      if (i) td.className = "n";
    });
  });
}

// ---------------------------------------------------------------------
// Gráfico 2: pedidos por estado (clic = incluir/excluir de la venta)
// ---------------------------------------------------------------------
function graficoEstados(r) {
  const cont = document.getElementById("g-estados");
  const W = cont.clientWidth;
  const fila = 40, m = { l: Math.min(210, W * 0.45), r: 64, t: 4 };
  const H = m.t + fila * ESTADOS.length;
  const iw = W - m.l - m.r;
  const max = Math.max(1, ...ESTADOS.map((e) => r.porEstado[e].pedidos));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "Pedidos por estado" });

  ESTADOS.forEach((e, i) => {
    const d = r.porEstado[e];
    const cuenta = F.estados.has(e);
    const y0 = m.t + i * fila;
    const g = el("g", { class: "marca", tabindex: 0, role: "button", "aria-pressed": String(cuenta),
      "aria-label": `${e}: ${fEntero.format(d.pedidos)} pedidos, ${cuenta ? "cuenta" : "no cuenta"} como venta. Clic para cambiar` }, svg);
    el("rect", { x: 0, y: y0, width: W, height: fila, fill: "transparent" }, g);
    texto(g, 0, y0 + 17, e, { class: `etq-barra${cuenta ? "" : " no"}`, "font-weight": 600 });
    texto(g, 0, y0 + 32, DESC[e], { class: "eje" });
    const w = (d.pedidos / max) * iw;
    if (w > 0) el("path", { d: barraHorizontal(m.l, y0 + 10, Math.max(w, 2), 18), fill: cuenta ? css("--si") : css("--no") }, g);
    texto(g, m.l + w + 6, y0 + 23, fEntero.format(d.pedidos), { class: "valor-barra" });

    const tip = (ev) => mostrarTooltip(ev, `${e} · ${DESC[e]}`, [
      [null, "Pedidos", fEntero.format(d.pedidos)],
      [null, "Monto", pesos(d.cent)],
      [null, "¿Cuenta como venta?", cuenta ? "Sí" : "No"],
    ]);
    g.addEventListener("pointermove", tip);
    g.addEventListener("focus", tip);
    g.addEventListener("pointerleave", ocultarTooltip);
    g.addEventListener("blur", ocultarTooltip);
    const cambiar = () => {
      F.estados.has(e) ? F.estados.delete(e) : F.estados.add(e);
      ocultarTooltip();
      render();
    };
    g.addEventListener("click", cambiar);
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); cambiar(); } });
  });
  cont.replaceChildren(svg);
}

// ---------------------------------------------------------------------
// Gráfico 3: ticket promedio por mes y canal (líneas con cruz de lectura)
// ---------------------------------------------------------------------
function graficoTicket(r) {
  const cont = document.getElementById("g-ticket");
  const W = cont.clientWidth, H = 240;
  const m = { l: 56, r: 12, t: 12, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const meses = Object.keys(r.meses);
  const series = ["online", "offline"].filter((c) => F.canal === "todos" || F.canal === c);
  const val = (k, c) => {
    const d = r.meses[k][c];
    return d.pedidos ? d.cent / 100 / d.pedidos : null;
  };
  const todos = meses.flatMap((k) => series.map((c) => val(k, c))).filter((v) => v !== null);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Ticket promedio por mes y canal" });
  if (!todos.length) {
    texto(svg, W / 2, H / 2, "No hay ventas con estos filtros", { class: "vacio", "text-anchor": "middle" });
    cont.replaceChildren(svg);
    return;
  }
  // Eje con margen alrededor de los datos (en líneas no hace falta arrancar en 0)
  let lo = Math.min(...todos), hi = Math.max(...todos);
  const pad = Math.max((hi - lo) * 0.15, 500);
  lo -= pad; hi += pad;
  const paso = escalaLinda(hi - lo, 4).paso;
  lo = Math.floor(lo / paso) * paso; hi = Math.ceil(hi / paso) * paso;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const x = (i) => meses.length === 1 ? m.l + iw / 2 : m.l + (i / (meses.length - 1)) * iw;

  for (let v = lo; v <= hi + 1e-9; v += paso) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "eje-linea" }, svg);
    texto(svg, m.l - 8, y(v) + 4, pesosCompacto(v), { class: "eje", "text-anchor": "end" });
  }
  const cadaCuanto = iw / meses.length >= 38 ? 1 : iw / meses.length >= 18 ? 3 : 6;
  meses.forEach((k, i) => {
    if (i % cadaCuanto === 0) texto(svg, x(i), H - 10, etiquetaMes(k), { class: "eje", "text-anchor": "middle" });
  });

  for (const c of series) {
    let d = "", abierto = false;
    meses.forEach((k, i) => {
      const v = val(k, c);
      if (v === null) { abierto = false; return; }
      d += `${abierto ? "L" : "M"}${x(i)},${y(v)}`;
      abierto = true;
    });
    el("path", { d, fill: "none", stroke: css(`--${c}`), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    if (meses.length === 1) el("circle", { cx: x(0), cy: y(val(meses[0], c)), r: 4, fill: css(`--${c}`) }, svg);
  }

  // Capa de lectura: la cruz encuentra el mes más cercano
  const cruz = el("line", { y1: m.t, y2: m.t + ih, class: "cruz", visibility: "hidden" }, svg);
  const puntos = series.map((c) => el("circle", { r: 4, fill: css(`--${c}`), stroke: css("--tarjeta"), "stroke-width": 2, visibility: "hidden" }, svg));
  const capa = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
  capa.addEventListener("pointermove", (e) => {
    const caja = svg.getBoundingClientRect();
    const px = ((e.clientX - caja.left) / caja.width) * W;
    const i = meses.length === 1 ? 0 : Math.max(0, Math.min(meses.length - 1, Math.round(((px - m.l) / iw) * (meses.length - 1))));
    cruz.setAttribute("x1", x(i)); cruz.setAttribute("x2", x(i)); cruz.setAttribute("visibility", "visible");
    series.forEach((c, j) => {
      const v = val(meses[i], c);
      if (v === null) { puntos[j].setAttribute("visibility", "hidden"); return; }
      puntos[j].setAttribute("cx", x(i)); puntos[j].setAttribute("cy", y(v)); puntos[j].setAttribute("visibility", "visible");
    });
    mostrarTooltip(e, etiquetaMesLarga(meses[i]), series.map((c) => {
      const v = val(meses[i], c);
      return [css(`--${c}`), c === "online" ? "Online" : "Offline", v === null ? "sin ventas" : fPesos.format(v)];
    }));
  });
  capa.addEventListener("pointerleave", () => {
    ocultarTooltip();
    cruz.setAttribute("visibility", "hidden");
    puntos.forEach((p) => p.setAttribute("visibility", "hidden"));
  });
  cont.replaceChildren(svg);
}

// ---------------------------------------------------------------------
// Respuestas y justificación
// ---------------------------------------------------------------------
function descripcionFiltros() {
  const partes = [];
  partes.push(F.desde === MESES[0] && F.hasta === MESES[MESES.length - 1]
    ? "ene 2024 a sep 2025"
    : F.desde === F.hasta ? etiquetaMesLarga(F.desde) : `${etiquetaMesLarga(F.desde)} a ${etiquetaMesLarga(F.hasta)}`);
  if (F.canal !== "todos") partes.push(F.canal === "online" ? "solo online" : "solo offline");
  if (F.prov !== "todas") partes.push(F.prov);
  return partes.join(" · ");
}

function respuestas(r) {
  const filtros = descripcionFiltros();
  const incluidos = ESTADOS.filter((e) => F.estados.has(e));
  const excluidos = ESTADOS.filter((e) => !F.estados.has(e) && r.porEstado[e].pedidos > 0);
  const centFuera = excluidos.reduce((s, e) => s + r.porEstado[e].cent, 0);
  const pedFuera = excluidos.reduce((s, e) => s + r.porEstado[e].pedidos, 0);

  // Pregunta 1
  document.getElementById("k-ventas").textContent = pesos(r.cent);
  document.getElementById("k-ventas-det").textContent = filtros;
  document.getElementById("j1").innerHTML =
    `Suma de <code>${F.monto === "total" ? "total_amount" : F.monto === "neto" ? "subtotal" : "total_amount − shipping_fee"}</code> de los ` +
    `${fEntero.format(r.pedidos)} pedidos que cuentan como venta = <strong>${pesos(r.cent)}</strong>. ` +
    (pedFuera ? `Quedan afuera ${fEntero.format(pedFuera)} pedidos por ${pesos(centFuera)} (${excluidos.join(", ")}).` : "No queda ningún pedido afuera.");

  // Pregunta 2
  document.getElementById("k-pedidos").textContent = fEntero.format(r.pedidos);
  document.getElementById("k-pedidos-det").textContent = r.totalBase
    ? `${fPct.format(r.pedidos / r.totalBase)} de los ${fEntero.format(r.totalBase)} pedidos del período`
    : "Sin pedidos con estos filtros";
  const sumandos = incluidos.map((e) => `${e} (${fEntero.format(r.porEstado[e].pedidos)})`);
  document.getElementById("j2").innerHTML = incluidos.length
    ? `${sumandos.join(" + ")} = <strong>${fEntero.format(r.pedidos)}</strong> pedidos. ` +
      (F.estados.has("PAID") ? "Los PAID cuentan aunque no se entregaron, porque el cobro ya se concretó. " : "") +
      (F.estados.has("REFUNDED") ? "Ojo: los REFUNDED no deberían contar, porque el dinero se devolvió." : "")
    : "No hay ningún estado incluido: activá alguno en el gráfico 2.";

  // Pregunta 3
  const t = (c) => (c.pedidos ? c.cent / c.pedidos : null);
  const tOn = t(r.canal.online), tOff = t(r.canal.offline);
  const mostrar = (id, idCaja, v, visible) => {
    document.getElementById(id).textContent = visible && v !== null ? fPesos.format(v / 100) : "—";
    document.getElementById(idCaja).classList.toggle("apagado", !visible);
  };
  mostrar("k-ticket-on", "k-on", tOn, F.canal !== "offline");
  mostrar("k-ticket-off", "k-off", tOff, F.canal !== "online");

  let det = "", j3 = "";
  const linea = (nombre, c) => `${nombre}: ${pesos(c.cent)} ÷ ${fEntero.format(c.pedidos)} = <strong>${fPesos.format(c.cent / c.pedidos / 100)}</strong>`;
  if (tOn !== null && tOff !== null) {
    const dif = tOn / tOff - 1;
    det = `Online ${dif >= 0 ? "+" : ""}${fPct.format(dif)} frente a offline`;
    j3 = `${linea("Online", r.canal.online)}. ${linea("Offline", r.canal.offline)}. `;
    if (F.monto === "total") {
      const sOn = r.canal.online.sinEnvio / r.canal.online.pedidos, sOff = r.canal.offline.sinEnvio / r.canal.offline.pedidos;
      j3 += `Gran parte de la diferencia es el envío, que solo pagan los pedidos online: sin envío quedan en ${fPesos.format(sOn / 100)} online y ${fPesos.format(sOff / 100)} offline. Probalo con el filtro "Monto".`;
    }
  } else if (tOn !== null) {
    j3 = `${linea("Online", r.canal.online)}.`;
  } else if (tOff !== null) {
    j3 = `${linea("Offline", r.canal.offline)}.`;
  } else {
    j3 = "No hay ventas con estos filtros.";
  }
  document.getElementById("k-ticket-det").textContent = det || filtros;
  document.getElementById("j3").innerHTML = j3;

  // Aviso cuando la vista no sigue la regla de la consigna
  const reglaCambiada = !(F.estados.size === REGLA_CONSIGNA.length && REGLA_CONSIGNA.every((e) => F.estados.has(e)));
  const avisos = [];
  if (reglaCambiada) avisos.push(`estás contando como venta ${incluidos.length ? incluidos.join(", ") : "ningún estado"} (la consigna cuenta PAID y FULFILLED)`);
  if (F.monto !== "total") avisos.push(`el monto es ${MONTOS[F.monto]} en lugar de total_amount`);
  const aviso = document.getElementById("aviso");
  aviso.hidden = !avisos.length;
  if (avisos.length) aviso.textContent = `Vista de exploración: ${avisos.join(" y ")}. Usá "Restablecer" para volver a las respuestas oficiales.`;
}

// ---------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------
function marcarSegmentado(id, valor) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.valor === valor)));
}
function sincronizarControles() {
  const primero = MESES[0], ultimo = MESES[MESES.length - 1];
  const anio = F.desde === primero && F.hasta === ultimo ? "todo"
    : F.desde === `${F.desde.slice(0, 4)}-01` && F.hasta === (F.desde.slice(0, 4) === ultimo.slice(0, 4) ? ultimo : `${F.desde.slice(0, 4)}-12`) && F.desde.slice(0, 4) === F.hasta.slice(0, 4)
      ? F.desde.slice(0, 4) : null;
  marcarSegmentado("f-anio", anio);
  marcarSegmentado("f-canal", F.canal);
  document.getElementById("f-desde").value = F.desde;
  document.getElementById("f-hasta").value = F.hasta;
  document.getElementById("f-prov").value = F.prov;
  document.getElementById("f-monto").value = F.monto;
}
function alternarMes(k) {
  if (F.desde === k && F.hasta === k && F.rangoPrevio) {
    [F.desde, F.hasta] = F.rangoPrevio;
    F.rangoPrevio = null;
  } else {
    if (!F.rangoPrevio) F.rangoPrevio = [F.desde, F.hasta];
    F.desde = F.hasta = k;
  }
  render();
}

function armarFiltros() {
  const desde = document.getElementById("f-desde"), hasta = document.getElementById("f-hasta");
  for (const k of MESES) {
    desde.add(new Option(etiquetaMesLarga(k), k));
    hasta.add(new Option(etiquetaMesLarga(k), k));
  }
  const prov = document.getElementById("f-prov");
  for (const p of PROVINCIAS) prov.add(new Option(p, p));

  document.querySelectorAll("#f-anio button").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.valor;
    F.rangoPrevio = null;
    if (v === "todo") { F.desde = MESES[0]; F.hasta = MESES[MESES.length - 1]; }
    else { const del = MESES.filter((m) => m.startsWith(v)); F.desde = del[0]; F.hasta = del[del.length - 1]; }
    render();
  }));
  document.querySelectorAll("#f-canal button").forEach((b) => b.addEventListener("click", () => { F.canal = b.dataset.valor; render(); }));
  desde.addEventListener("change", () => { F.desde = desde.value; if (F.hasta < F.desde) F.hasta = F.desde; F.rangoPrevio = null; render(); });
  hasta.addEventListener("change", () => { F.hasta = hasta.value; if (F.desde > F.hasta) F.desde = F.hasta; F.rangoPrevio = null; render(); });
  prov.addEventListener("change", () => { F.prov = prov.value; render(); });
  document.getElementById("f-monto").addEventListener("change", (e) => { F.monto = e.target.value; render(); });
  document.getElementById("f-reset").addEventListener("click", () => { F = estadoInicial(); render(); });
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
function render() {
  sincronizarControles();
  const r = calcular();
  respuestas(r);
  graficoMeses(r);
  graficoEstados(r);
  graficoTicket(r);
}

async function iniciar() {
  const estado = document.getElementById("estado");
  try {
    const leer = async (archivo) => {
      const resp = await fetch(`data/${archivo}`);
      if (!resp.ok) throw new Error(`${archivo}: HTTP ${resp.status}`);
      return parsearCSV(await resp.text());
    };
    const [ventas, direcciones, provincias] = await Promise.all(
      ["sales_order.csv", "address.csv", "province.csv"].map(leer));
    preparar(ventas, direcciones, provincias);
    F = estadoInicial();
    armarFiltros();
    render();
    estado.textContent = `Calculado en vivo sobre ${fEntero.format(PEDIDOS.length)} pedidos de data/sales_order.csv`;
    estado.classList.add("ok");

    let espera;
    window.addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(render, 150); });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  } catch (err) {
    estado.textContent = "No se pudieron leer los datos. Si abriste el archivo con doble clic, el navegador bloquea la lectura: " +
      "abrilo desde GitHub Pages o con un servidor local (por ejemplo, la extensión Live Server de VS Code).";
    estado.classList.add("error");
    console.error(err);
  }
}

iniciar();
