// Tablero de ventas EcoBottle AR
// Lee las tablas MART del data warehouse (sql/05_marts.sql del TP), donde
// los KPIs ya vienen calculados para cada combinación de filtros.
// El tablero NO calcula: busca la fila que corresponde a los filtros
// elegidos y la muestra. Sin librerías: SVG y JavaScript puro.

// ---------------------------------------------------------------------
// Constantes de presentación
// ---------------------------------------------------------------------
const ORDEN_ESTADOS = ["FULFILLED", "PAID", "CANCELLED", "REFUNDED", "CREATED"]; // solo el orden visual
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const CANALES = ["ONLINE", "OFFLINE"];

// ---------------------------------------------------------------------
// Formatos (solo presentación: no cambian ningún valor)
// ---------------------------------------------------------------------
const fPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fEntero = new Intl.NumberFormat("es-AR");
const fPct = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fCompacto = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

const pesos = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : fPesos.format(v));
const pesosCompacto = (v) => "$ " + fCompacto.format(v);
const etiquetaMes = (ym) => `${MESES_CORTOS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
const etiquetaMesLarga = (ym) => `${MESES_CORTOS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

// ---------------------------------------------------------------------
// Lectura de CSV (respeta comillas)
// ---------------------------------------------------------------------
function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  const [cols, ...datos] = filas.filter((f) => f.length > 1 || f[0] !== "");
  return datos.map((v) => Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""])));
}
const num = (t) => (t === "" || t === undefined ? null : Number(t));

// ---------------------------------------------------------------------
// Datos: índices para buscar filas del mart (sin calcular nada)
// ---------------------------------------------------------------------
const KPI = new Map();      // "período|canal|provincia" → fila de mart_sales_kpi
const ESTADO = new Map();   // "período|canal|provincia" → filas de mart_order_status
let MESES = [];
let PROVINCIAS = [];

const clave = (periodo, canal, prov) => `${periodo}|${canal}|${prov}`;

function preparar(kpi, estados) {
  for (const f of kpi) {
    KPI.set(clave(f.period, f.channel, f.province), {
      pedidosTotal: num(f.orders_total),
      pedidosVenta: num(f.sale_orders),
      pedidosNoVenta: num(f.non_sale_orders),
      proporcionVenta: num(f.sale_order_share),
      ventas: num(f.sales_amount),
      ventasSinIva: num(f.sales_net_amount),
      iva: num(f.sales_tax_amount),
      envio: num(f.sales_shipping_amount),
      montoNoVenta: num(f.non_sale_amount),
      ticket: num(f.ticket_amount),
      ticketSinIva: num(f.ticket_net_amount),
      ticketSinEnvio: num(f.ticket_no_shipping),
    });
  }
  for (const f of estados) {
    const k = clave(f.period, f.channel, f.province);
    if (!ESTADO.has(k)) ESTADO.set(k, {});
    ESTADO.get(k)[f.status_code] = {
      descripcion: f.status_description,
      esVenta: f.is_sale === "true",
      pedidos: num(f.orders),
      monto: num(f.total_amount),
    };
  }
  MESES = [...new Set(kpi.filter((f) => f.period_type === "month").map((f) => f.period))].sort();
  PROVINCIAS = [...new Set(kpi.map((f) => f.province))].filter((p) => p !== "Todas").sort((a, b) => a.localeCompare(b, "es"));
}

// ---------------------------------------------------------------------
// Estado de los filtros
// ---------------------------------------------------------------------
const estadoInicial = () => ({ anio: "Todo", mes: "", canal: "Todos", prov: "Todas", iva: "con" });
let F = null;

const periodo = () => F.mes || F.anio;
const mesesVisibles = () => (F.mes ? [F.mes] : F.anio === "Todo" ? MESES : MESES.filter((m) => m.startsWith(F.anio)));
const fila = (per, canal = F.canal, prov = F.prov) => KPI.get(clave(per, canal, prov));
const ventasDe = (r) => (r ? (F.iva === "con" ? r.ventas : r.ventasSinIva) : null);
const ticketDe = (r) => (r ? (F.iva === "con" ? r.ticket : r.ticketSinIva) : null);
const etiquetaIva = () => (F.iva === "con" ? "con IVA" : "sin IVA");

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
const colorCanal = (c) => css(c === "ONLINE" ? "--online" : "--offline");
const nombreCanal = (c) => (c === "ONLINE" ? "Online" : "Offline");
const canalesVisibles = () => (F.canal === "Todos" ? CANALES : [F.canal]);

// ---------------------------------------------------------------------
// Gráfico 1: ventas por mes, apiladas por canal (clic = elegir ese mes)
// ---------------------------------------------------------------------
function graficoMeses() {
  const cont = document.getElementById("g-meses");
  const W = cont.clientWidth, H = 260;
  const m = { l: 56, r: 8, t: 12, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const meses = mesesVisibles();
  const canales = canalesVisibles();
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Ventas por mes y canal" });

  // El total de cada mes viene de su propia fila del mart; el tablero no suma
  const totalMes = (k) => ventasDe(fila(k));
  const max = Math.max(0, ...meses.map((k) => totalMes(k) ?? 0));
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
  const base = m.t + ih;

  meses.forEach((k, i) => {
    const cx = m.l + banda * i + banda / 2;
    const x0 = cx - bw / 2;
    const g = el("g", { class: "marca", tabindex: 0, role: "button",
      "aria-label": `${etiquetaMesLarga(k)}: ${pesos(totalMes(k))}. Clic para ver solo este mes` }, svg);

    // Segmentos apilados (dibujo): cada uno con el valor de su fila del mart
    let tope = base;
    canales.forEach((c, j) => {
      const v = ventasDe(fila(k, c)) ?? 0;
      const h = (v / ymax) * ih;
      if (h <= 0) return;
      const gap = j > 0 ? 2 : 0;
      const alto = Math.max(0, h - gap);
      const yTop = tope - gap - alto;
      const ultimo = j === canales.length - 1;
      const d = ultimo ? barraVertical(x0, yTop, bw, alto) : `M${x0},${tope - gap}V${yTop}H${x0 + bw}V${tope - gap}Z`;
      el("path", { d, fill: colorCanal(c) }, g);
      tope = yTop;
    });
    el("rect", { x: m.l + banda * i, y: m.t, width: banda, height: ih, fill: "transparent" }, g);

    if (i % cadaCuanto === 0 || meses.length === 1) {
      texto(svg, cx, H - 10, etiquetaMes(k), { class: "eje", "text-anchor": "middle" });
    }

    const filas = canales.map((c) => [colorCanal(c), nombreCanal(c), pesos(ventasDe(fila(k, c)))]);
    if (canales.length > 1) filas.push([null, "Total", pesos(totalMes(k))]);
    const tip = (e) => mostrarTooltip(e, `${etiquetaMesLarga(k)} · ${etiquetaIva()}`, filas);
    g.addEventListener("pointermove", tip);
    g.addEventListener("focus", tip);
    g.addEventListener("pointerleave", ocultarTooltip);
    g.addEventListener("blur", ocultarTooltip);
    const elegir = () => {
      ocultarTooltip();
      if (F.mes === k) F.mes = "";
      else { F.mes = k; if (F.anio !== "Todo") F.anio = k.slice(0, 4); }
      render();
    };
    g.addEventListener("click", elegir);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(); } });
  });
  cont.replaceChildren(svg);

  // Tabla equivalente
  const tabla = document.getElementById("t-meses");
  tabla.replaceChildren();
  const cab = tabla.createTHead().insertRow();
  ["Mes", ...canales.map(nombreCanal), "Total", "Pedidos válidos", "Ticket"].forEach((t, i) => {
    const th = document.createElement("th");
    th.textContent = t;
    if (i) th.className = "n";
    cab.appendChild(th);
  });
  const cuerpo = tabla.createTBody();
  meses.forEach((k) => {
    const r = fila(k);
    const tr = cuerpo.insertRow();
    [etiquetaMesLarga(k), ...canales.map((c) => pesos(ventasDe(fila(k, c)))), pesos(ventasDe(r)),
      r ? fEntero.format(r.pedidosVenta) : "—", pesos(ticketDe(r))].forEach((v, i) => {
      const td = tr.insertCell();
      td.textContent = v;
      if (i) td.className = "n";
    });
  });
}

// ---------------------------------------------------------------------
// Gráfico 2: pedidos por estado (de mart_order_status)
// ---------------------------------------------------------------------
function graficoEstados() {
  const cont = document.getElementById("g-estados");
  const datos = ESTADO.get(clave(periodo(), F.canal, F.prov)) ?? {};
  const estados = ORDEN_ESTADOS.filter((e) => datos[e]);
  const W = cont.clientWidth;
  const alto = 40, m = { l: Math.min(210, W * 0.45), r: 64, t: 4 };
  const H = m.t + alto * Math.max(1, estados.length);
  const iw = W - m.l - m.r;
  const max = Math.max(1, ...estados.map((e) => datos[e].pedidos));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "Pedidos por estado" });

  estados.forEach((e, i) => {
    const d = datos[e];
    const y0 = m.t + i * alto;
    const g = el("g", { class: "marca", tabindex: 0,
      "aria-label": `${e}: ${fEntero.format(d.pedidos)} pedidos, ${d.esVenta ? "cuenta" : "no cuenta"} como venta` }, svg);
    el("rect", { x: 0, y: y0, width: W, height: alto, fill: "transparent" }, g);
    texto(g, 0, y0 + 17, e, { class: `etq-barra${d.esVenta ? "" : " no"}`, "font-weight": 600 });
    texto(g, 0, y0 + 32, d.descripcion, { class: "eje" });
    const w = (d.pedidos / max) * iw;
    if (w > 0) el("path", { d: barraHorizontal(m.l, y0 + 10, Math.max(w, 2), 18), fill: d.esVenta ? css("--si") : css("--no") }, g);
    texto(g, m.l + w + 6, y0 + 23, fEntero.format(d.pedidos), { class: "valor-barra" });
    const tip = (ev) => mostrarTooltip(ev, `${e} · ${d.descripcion}`, [
      [null, "Pedidos", fEntero.format(d.pedidos)],
      [null, "Monto (total_amount)", pesos(d.monto)],
      [null, "is_sale", d.esVenta ? "true" : "false"],
    ]);
    g.addEventListener("pointermove", tip);
    g.addEventListener("focus", tip);
    g.addEventListener("pointerleave", ocultarTooltip);
    g.addEventListener("blur", ocultarTooltip);
  });
  cont.replaceChildren(svg);
}

// ---------------------------------------------------------------------
// Gráfico 3: ticket promedio por mes y canal (valores del mart)
// ---------------------------------------------------------------------
function graficoTicket() {
  const cont = document.getElementById("g-ticket");
  const W = cont.clientWidth, H = 240;
  const m = { l: 56, r: 12, t: 12, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const meses = mesesVisibles();
  const canales = canalesVisibles();
  const val = (k, c) => ticketDe(fila(k, c));
  const todos = meses.flatMap((k) => canales.map((c) => val(k, c))).filter((v) => v !== null);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Ticket promedio por mes y canal" });
  if (!todos.length) {
    texto(svg, W / 2, H / 2, "No hay ventas con estos filtros", { class: "vacio", "text-anchor": "middle" });
    cont.replaceChildren(svg);
    return;
  }
  // Escala del eje (dibujo): margen alrededor de los datos
  let lo = Math.min(...todos), hi = Math.max(...todos);
  const pad = Math.max((hi - lo) * 0.15, 500);
  lo -= pad; hi += pad;
  const paso = escalaLinda(hi - lo, 4).paso;
  lo = Math.floor(lo / paso) * paso; hi = Math.ceil(hi / paso) * paso;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const x = (i) => (meses.length === 1 ? m.l + iw / 2 : m.l + (i / (meses.length - 1)) * iw);

  for (let v = lo; v <= hi + 1e-9; v += paso) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "eje-linea" }, svg);
    texto(svg, m.l - 8, y(v) + 4, pesosCompacto(v), { class: "eje", "text-anchor": "end" });
  }
  const cadaCuanto = iw / meses.length >= 38 ? 1 : iw / meses.length >= 18 ? 3 : 6;
  meses.forEach((k, i) => {
    if (i % cadaCuanto === 0) texto(svg, x(i), H - 10, etiquetaMes(k), { class: "eje", "text-anchor": "middle" });
  });

  for (const c of canales) {
    let d = "", abierto = false;
    meses.forEach((k, i) => {
      const v = val(k, c);
      if (v === null) { abierto = false; return; }
      d += `${abierto ? "L" : "M"}${x(i)},${y(v)}`;
      abierto = true;
    });
    el("path", { d, fill: "none", stroke: colorCanal(c), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    if (meses.length === 1 && val(meses[0], c) !== null) el("circle", { cx: x(0), cy: y(val(meses[0], c)), r: 4, fill: colorCanal(c) }, svg);
  }

  const cruz = el("line", { y1: m.t, y2: m.t + ih, class: "cruz", visibility: "hidden" }, svg);
  const puntos = canales.map((c) => el("circle", { r: 4, fill: colorCanal(c), stroke: css("--tarjeta"), "stroke-width": 2, visibility: "hidden" }, svg));
  const capa = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
  capa.addEventListener("pointermove", (e) => {
    const caja = svg.getBoundingClientRect();
    const px = ((e.clientX - caja.left) / caja.width) * W;
    const i = meses.length === 1 ? 0 : Math.max(0, Math.min(meses.length - 1, Math.round(((px - m.l) / iw) * (meses.length - 1))));
    cruz.setAttribute("x1", x(i)); cruz.setAttribute("x2", x(i)); cruz.setAttribute("visibility", "visible");
    canales.forEach((c, j) => {
      const v = val(meses[i], c);
      if (v === null) { puntos[j].setAttribute("visibility", "hidden"); return; }
      puntos[j].setAttribute("cx", x(i)); puntos[j].setAttribute("cy", y(v)); puntos[j].setAttribute("visibility", "visible");
    });
    mostrarTooltip(e, `${etiquetaMesLarga(meses[i])} · ${etiquetaIva()}`,
      canales.map((c) => [colorCanal(c), nombreCanal(c), val(meses[i], c) === null ? "sin ventas" : pesos(val(meses[i], c))]));
  });
  capa.addEventListener("pointerleave", () => {
    ocultarTooltip();
    cruz.setAttribute("visibility", "hidden");
    puntos.forEach((p) => p.setAttribute("visibility", "hidden"));
  });
  cont.replaceChildren(svg);
}

// ---------------------------------------------------------------------
// Respuestas y justificación (valores leídos del mart, sin cálculos)
// ---------------------------------------------------------------------
function descripcionFiltros() {
  const partes = [F.mes ? etiquetaMesLarga(F.mes) : F.anio === "Todo" ? "ene 2024 a sep 2025" : `año ${F.anio}`];
  if (F.canal !== "Todos") partes.push(F.canal === "ONLINE" ? "solo online" : "solo offline");
  if (F.prov !== "Todas") partes.push(F.prov);
  partes.push(etiquetaIva());
  return partes.join(" · ");
}

function respuestas() {
  const per = periodo();
  const r = fila(per);
  const filtros = descripcionFiltros();
  const estados = ESTADO.get(clave(per, F.canal, F.prov)) ?? {};
  const deVenta = ORDEN_ESTADOS.filter((e) => estados[e]?.esVenta);
  const noVenta = ORDEN_ESTADOS.filter((e) => estados[e] && !estados[e].esVenta);

  // Pregunta 1
  document.getElementById("k-ventas").textContent = pesos(ventasDe(r));
  document.getElementById("k-ventas-det").textContent = filtros;
  document.getElementById("j1").innerHTML = r
    ? `Fila de <code>mart_sales_kpi</code> para estos filtros: <strong>${pesos(r.ventas)}</strong> con IVA ` +
      `(<code>sales_amount</code>) y <strong>${pesos(r.ventasSinIva)}</strong> sin IVA (<code>sales_net_amount</code>). ` +
      `De la venta con IVA, ${pesos(r.iva)} son IVA y ${pesos(r.envio)} envío. ` +
      `Quedaron afuera ${fEntero.format(r.pedidosNoVenta)} pedidos que no son venta (${noVenta.join(", ") || "ninguno"}), por ${pesos(r.montoNoVenta ?? 0)}.`
    : "No hay pedidos con estos filtros.";

  // Pregunta 2
  document.getElementById("k-pedidos").textContent = r ? fEntero.format(r.pedidosVenta) : "—";
  document.getElementById("k-pedidos-det").textContent = r
    ? `${fPct.format(r.proporcionVenta)} de los ${fEntero.format(r.pedidosTotal)} pedidos del período`
    : "Sin pedidos con estos filtros";
  document.getElementById("j2").innerHTML = r
    ? `<code>sale_orders</code> = <strong>${fEntero.format(r.pedidosVenta)}</strong>: los pedidos cuyo estado tiene <code>is_sale = true</code> en <code>dim_order_status</code> (solo PAID y FULFILLED). ` +
      `En este período: ${deVenta.map((e) => `${e} ${fEntero.format(estados[e].pedidos)}`).join(", ")}. El detalle por estado sale de <code>mart_order_status</code>.`
    : "No hay pedidos con estos filtros.";

  // Pregunta 3: una fila del mart por canal
  const rOn = fila(per, "ONLINE"), rOff = fila(per, "OFFLINE");
  const verOn = F.canal !== "OFFLINE", verOff = F.canal !== "ONLINE";
  document.getElementById("k-ticket-on").textContent = verOn ? pesos(ticketDe(rOn)) : "—";
  document.getElementById("k-ticket-off").textContent = verOff ? pesos(ticketDe(rOff)) : "—";
  document.getElementById("k-on").classList.toggle("apagado", !verOn);
  document.getElementById("k-off").classList.toggle("apagado", !verOff);
  document.getElementById("k-ticket-det").textContent = filtros;

  const linea = (nombre, x) => x && x.pedidosVenta
    ? `${nombre}: <strong>${pesos(ticketDe(x))}</strong> (<code>${F.iva === "con" ? "ticket_amount" : "ticket_net_amount"}</code>, ${fEntero.format(x.pedidosVenta)} pedidos)`
    : `${nombre}: sin ventas`;
  const partes = [];
  if (verOn) partes.push(linea("Online", rOn));
  if (verOff) partes.push(linea("Offline", rOff));
  let j3 = partes.join(". ") + ".";
  if (verOn && verOff && rOn?.pedidosVenta && rOff?.pedidosVenta) {
    j3 += ` Sin el envío, que solo pagan los pedidos online (<code>ticket_no_shipping</code>, con IVA): ${pesos(rOn.ticketSinEnvio)} online y ${pesos(rOff.ticketSinEnvio)} offline.`;
  }
  document.getElementById("j3").innerHTML = j3;
}

// ---------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------
function marcarSegmentado(id, valor) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.valor === valor)));
}
function opcionesMes() {
  const sel = document.getElementById("f-mes");
  const meses = F.anio === "Todo" ? MESES : MESES.filter((m) => m.startsWith(F.anio));
  sel.replaceChildren(new Option(F.anio === "Todo" ? "Todos los meses" : `Todo ${F.anio}`, ""));
  for (const k of meses) sel.add(new Option(etiquetaMesLarga(k), k));
  sel.value = F.mes;
}
function sincronizarControles() {
  marcarSegmentado("f-anio", F.anio === "Todo" ? "todo" : F.anio);
  marcarSegmentado("f-canal", F.canal === "Todos" ? "todos" : F.canal.toLowerCase());
  marcarSegmentado("f-iva", F.iva);
  opcionesMes();
  document.getElementById("f-prov").value = F.prov;
}

function armarFiltros() {
  const prov = document.getElementById("f-prov");
  prov.replaceChildren(new Option("Todas", "Todas"));
  for (const p of PROVINCIAS) prov.add(new Option(p, p));

  document.querySelectorAll("#f-anio button").forEach((b) => b.addEventListener("click", () => {
    F.anio = b.dataset.valor === "todo" ? "Todo" : b.dataset.valor;
    F.mes = "";
    render();
  }));
  document.getElementById("f-mes").addEventListener("change", (e) => { F.mes = e.target.value; render(); });
  document.querySelectorAll("#f-canal button").forEach((b) => b.addEventListener("click", () => {
    F.canal = b.dataset.valor === "todos" ? "Todos" : b.dataset.valor.toUpperCase();
    render();
  }));
  document.querySelectorAll("#f-iva button").forEach((b) => b.addEventListener("click", () => { F.iva = b.dataset.valor; render(); }));
  prov.addEventListener("change", () => { F.prov = prov.value; render(); });
  document.getElementById("f-reset").addEventListener("click", () => { F = estadoInicial(); render(); });
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
function render() {
  sincronizarControles();
  respuestas();
  graficoMeses();
  graficoEstados();
  graficoTicket();
}

async function iniciar() {
  const estado = document.getElementById("estado");
  try {
    const leer = async (archivo) => {
      const resp = await fetch(`data/${archivo}`);
      if (!resp.ok) throw new Error(`${archivo}: HTTP ${resp.status}`);
      return parsearCSV(await resp.text());
    };
    const [kpi, estados] = await Promise.all(["mart_sales_kpi.csv", "mart_order_status.csv"].map(leer));
    preparar(kpi, estados);
    F = estadoInicial();
    armarFiltros();
    render();
    estado.textContent = "KPIs leídos de las tablas mart del data warehouse (mart_sales_kpi y mart_order_status)";
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
