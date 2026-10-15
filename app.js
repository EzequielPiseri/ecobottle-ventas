// Tablero de ventas EcoBottle AR
// Lee el modelo estrella del data warehouse (fact_sales_order + dimensiones)
// y solo FILTRA por dimensiones y AGREGA medidas. Las transformaciones y la
// regla de negocio ya están resueltas en el DW (sql/01 y sql/02 del TP).
// Sin librerías: SVG y JavaScript puro.

// ---------------------------------------------------------------------
// Constantes de presentación
// ---------------------------------------------------------------------
const ORDEN_ESTADOS = ["FULFILLED", "PAID", "CANCELLED", "REFUNDED", "CREATED"]; // solo el orden visual
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
const etiquetaMes = (ym) => `${MESES_CORTOS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
const etiquetaMesLarga = (ym) => `${MESES_CORTOS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

// ---------------------------------------------------------------------
// Lectura de CSV
// ---------------------------------------------------------------------
// Los montos se pasan a centavos enteros para que las sumas sean exactas.
const aCent = (t) => Math.round(parseFloat(t) * 100);

// Lector de CSV que respeta comillas (dim_order_status tiene "Creado, sin pagar").
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

// ---------------------------------------------------------------------
// Modelo: hecho + dimensiones (como las relaciones de Power BI)
// ---------------------------------------------------------------------
let PEDIDOS = [];     // filas de fact_sales_order con los atributos de sus dimensiones
let MESES = [];       // "2024-01" … "2025-09"
let PROVINCIAS = [];
let ESTADOS = [];     // códigos de dim_order_status, en orden visual
let DIM_ESTADO = {};  // status_code → { descripcion, esVenta }

function preparar({ hecho, fecha, canal, provincia, estado }) {
  // Cada dimensión se indexa por su clave subrogada, igual que una relación 1 a N
  const mesDe = Object.fromEntries(fecha.map((d) => [d.date_key, d.year_month]));
  const canalDe = Object.fromEntries(canal.map((c) => [c.channel_key, c.code === "ONLINE" ? "online" : "offline"]));
  const provDe = Object.fromEntries(provincia.map((p) => [p.province_key, p.name]));
  const estadoDe = Object.fromEntries(estado.map((e) => [e.order_status_key, e.status_code]));
  DIM_ESTADO = Object.fromEntries(estado.map((e) => [e.status_code, { descripcion: e.description, esVenta: e.is_sale === "true" }]));

  PEDIDOS = hecho.map((f) => ({
    ym: mesDe[f.order_date_key],
    canal: canalDe[f.channel_key],
    prov: provDe[f.province_key],
    estado: estadoDe[f.order_status_key],
    // Medidas del hecho, tal como las dejó el DW
    esVenta: f.is_sale === "true",          // regla de negocio ya aplicada en el DW
    ventas: aCent(f.sales_amount),          // total_amount si es venta, 0 si no
    total: aCent(f.total_amount),           // monto del pedido (para el gráfico de estados)
    envio: aCent(f.shipping_fee),
  }));
  MESES = [...new Set(PEDIDOS.map((p) => p.ym))].sort();
  PROVINCIAS = [...new Set(PEDIDOS.map((p) => p.prov))].sort((a, b) => a.localeCompare(b, "es"));
  ESTADOS = ORDEN_ESTADOS.filter((e) => DIM_ESTADO[e]);
}

// ---------------------------------------------------------------------
// Estado de los filtros (solo cortes por dimensiones)
// ---------------------------------------------------------------------
const estadoInicial = () => ({
  desde: MESES[0], hasta: MESES[MESES.length - 1],
  canal: "todos", prov: "todas",
  rangoPrevio: null, // para deshacer el clic en un mes
});
let F = null;

// Agregación: filtrar por dimensiones y sumar medidas
function calcular() {
  const base = PEDIDOS.filter((p) =>
    p.ym >= F.desde && p.ym <= F.hasta &&
    (F.canal === "todos" || p.canal === F.canal) &&
    (F.prov === "todas" || p.prov === F.prov));

  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, { pedidos: 0, cent: 0 }]));
  const canal = { online: { pedidos: 0, cent: 0, envio: 0 }, offline: { pedidos: 0, cent: 0, envio: 0 } };
  const meses = Object.fromEntries(MESES.filter((m) => m >= F.desde && m <= F.hasta)
    .map((m) => [m, { online: { pedidos: 0, cent: 0 }, offline: { pedidos: 0, cent: 0 } }]));

  for (const p of base) {
    porEstado[p.estado].pedidos += 1;
    porEstado[p.estado].cent += p.total;
    if (!p.esVenta) continue;              // COUNT/SUM ... WHERE is_sale
    const c = canal[p.canal];
    c.pedidos += 1;
    c.cent += p.ventas;                    // SUM(sales_amount)
    c.envio += p.envio;
    meses[p.ym][p.canal].pedidos += 1;
    meses[p.ym][p.canal].cent += p.ventas;
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
    const cuenta = DIM_ESTADO[e].esVenta;   // viene de dim_order_status.is_sale
    const y0 = m.t + i * fila;
    const g = el("g", { class: "marca", tabindex: 0,
      "aria-label": `${e}: ${fEntero.format(d.pedidos)} pedidos, ${cuenta ? "cuenta" : "no cuenta"} como venta` }, svg);
    el("rect", { x: 0, y: y0, width: W, height: fila, fill: "transparent" }, g);
    texto(g, 0, y0 + 17, e, { class: `etq-barra${cuenta ? "" : " no"}`, "font-weight": 600 });
    texto(g, 0, y0 + 32, DIM_ESTADO[e].descripcion, { class: "eje" });
    const w = (d.pedidos / max) * iw;
    if (w > 0) el("path", { d: barraHorizontal(m.l, y0 + 10, Math.max(w, 2), 18), fill: cuenta ? css("--si") : css("--no") }, g);
    texto(g, m.l + w + 6, y0 + 23, fEntero.format(d.pedidos), { class: "valor-barra" });

    const tip = (ev) => mostrarTooltip(ev, `${e} · ${DIM_ESTADO[e].descripcion}`, [
      [null, "Pedidos", fEntero.format(d.pedidos)],
      [null, "Monto (total_amount)", pesos(d.cent)],
      [null, "is_sale", cuenta ? "true" : "false"],
    ]);
    g.addEventListener("pointermove", tip);
    g.addEventListener("focus", tip);
    g.addEventListener("pointerleave", ocultarTooltip);
    g.addEventListener("blur", ocultarTooltip);
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
  const incluidos = ESTADOS.filter((e) => DIM_ESTADO[e].esVenta);
  const excluidos = ESTADOS.filter((e) => !DIM_ESTADO[e].esVenta && r.porEstado[e].pedidos > 0);
  const centFuera = excluidos.reduce((s, e) => s + r.porEstado[e].cent, 0);
  const pedFuera = excluidos.reduce((s, e) => s + r.porEstado[e].pedidos, 0);

  // Pregunta 1
  document.getElementById("k-ventas").textContent = pesos(r.cent);
  document.getElementById("k-ventas-det").textContent = filtros;
  document.getElementById("j1").innerHTML =
    `<code>SUM(fact_sales_order.sales_amount)</code> = <strong>${pesos(r.cent)}</strong>. ` +
    `El DW ya dejó <code>sales_amount</code> = <code>total_amount</code> en las ventas válidas y 0 en el resto, así que el tablero solo suma. ` +
    (pedFuera ? `Los ${fEntero.format(pedFuera)} pedidos que no son venta (${excluidos.join(", ")}, ${pesos(centFuera)}) suman 0.` : "");

  // Pregunta 2
  document.getElementById("k-pedidos").textContent = fEntero.format(r.pedidos);
  document.getElementById("k-pedidos-det").textContent = r.totalBase
    ? `${fPct.format(r.pedidos / r.totalBase)} de los ${fEntero.format(r.totalBase)} pedidos del período`
    : "Sin pedidos con estos filtros";
  const sumandos = incluidos.map((e) => `${e} (${fEntero.format(r.porEstado[e].pedidos)})`);
  document.getElementById("j2").innerHTML =
    `Pedidos de <code>fact_sales_order</code> con <code>is_sale = true</code>: ${sumandos.join(" + ")} = <strong>${fEntero.format(r.pedidos)}</strong>. ` +
    `La regla "venta = PAID o FULFILLED" vive en <code>dim_order_status.is_sale</code> y el DW la copió al hecho.`;

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
    const sOn = (r.canal.online.cent - r.canal.online.envio) / r.canal.online.pedidos;
    const sOff = (r.canal.offline.cent - r.canal.offline.envio) / r.canal.offline.pedidos;
    const explica = Math.abs(sOn - sOff) < Math.abs(tOn - tOff) * 0.25;
    j3 += `Sin el envío (<code>shipping_fee</code>, que solo pagan los pedidos online) quedan en ${fPesos.format(sOn / 100)} online y ${fPesos.format(sOff / 100)} offline` +
      (explica ? ": la diferencia es casi toda el envío." : ": el envío explica solo una parte de la diferencia.");
  } else if (tOn !== null) {
    j3 = `${linea("Online", r.canal.online)}.`;
  } else if (tOff !== null) {
    j3 = `${linea("Offline", r.canal.offline)}.`;
  } else {
    j3 = "No hay ventas con estos filtros.";
  }
  document.getElementById("k-ticket-det").textContent = det || filtros;
  document.getElementById("j3").innerHTML = j3;

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
    const archivos = ["fact_sales_order.csv", "dim_date.csv", "dim_channel.csv", "dim_province.csv", "dim_order_status.csv"];
    const [hecho, fecha, canal, provincia, estadoPedido] = await Promise.all(archivos.map(leer));
    preparar({ hecho, fecha, canal, provincia, estado: estadoPedido });
    F = estadoInicial();
    armarFiltros();
    render();
    estado.textContent = `Calculado en vivo sobre ${fEntero.format(PEDIDOS.length)} pedidos de fact_sales_order (modelo estrella del DW)`;
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
