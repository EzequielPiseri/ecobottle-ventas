// EcoBottle AR · Ventas en 3 preguntas
// Lee data/sales_order.csv y calcula las respuestas en el navegador.

// Reglas de la consigna (README, "Cómo leer los datos")
const ESTADOS_VENTA = new Set(["PAID", "FULFILLED"]);
const ORDEN_ESTADOS = ["FULFILLED", "PAID", "CANCELLED", "REFUNDED", "CREATED"];
const DESC_ESTADOS = {
  FULFILLED: "Entregado o comprado en tienda",
  PAID: "Pagado, sin entregar",
  CANCELLED: "Cancelado",
  REFUNDED: "Entregado y reembolsado",
  CREATED: "Creado, sin pagar",
};

// Resultados de los otros dos cálculos (ver "Cómo se usaron agentes")
const CONSTRUCTOR_SQL = { ventas: 382410636, pedidos: 10998, ticketOnline: 35152.08, ticketOffline: 34228.75 };
const AUDITOR = { ventas: 382410636, pedidos: 10998, ticketOnline: 35152.08, ticketOffline: 34228.75 };

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const pesos2 = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat("es-AR");
const pct = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Los montos se suman en centavos (enteros) para evitar errores de redondeo.
const aCentavos = (texto) => Math.round(parseFloat(texto) * 100);

function parsearCSV(texto) {
  const lineas = texto.trim().split(/\r?\n/);
  const cols = lineas[0].split(",");
  return lineas.slice(1).map((linea) => {
    const valores = linea.split(",");
    const fila = {};
    cols.forEach((c, i) => { fila[c] = valores[i]; });
    return fila;
  });
}

function calcular(pedidos) {
  const porEstado = {};
  const canal = {
    online: { pedidos: 0, cent: 0, centSinEnvio: 0 },
    offline: { pedidos: 0, cent: 0, centSinEnvio: 0 },
  };
  let inconsistencias = 0;

  for (const p of pedidos) {
    const total = aCentavos(p.total_amount);
    const e = (porEstado[p.status] ??= { pedidos: 0, cent: 0 });
    e.pedidos += 1;
    e.cent += total;

    const esOnline = p.store_id === "";
    // Control: channel_id 1 = ONLINE debe coincidir con store_id vacío
    if (esOnline !== (p.channel_id === "1")) inconsistencias += 1;

    if (ESTADOS_VENTA.has(p.status)) {
      const c = canal[esOnline ? "online" : "offline"];
      c.pedidos += 1;
      c.cent += total;
      c.centSinEnvio += total - aCentavos(p.shipping_fee);
    }
  }

  const pedidosVenta = canal.online.pedidos + canal.offline.pedidos;
  const centVenta = canal.online.cent + canal.offline.cent;
  return { total: pedidos.length, porEstado, canal, pedidosVenta, centVenta, inconsistencias };
}

function pintarPregunta1(r) {
  document.getElementById("r1").innerHTML =
    `${pesos.format(r.centVenta / 100)}<small>en ${entero.format(r.pedidosVenta)} pedidos válidos, de enero 2024 a septiembre 2025</small>`;

  const tbody = document.querySelector("#tabla-estados tbody");
  let centExcluido = 0;
  tbody.innerHTML = ORDEN_ESTADOS.filter((s) => r.porEstado[s]).map((s) => {
    const e = r.porEstado[s];
    const esVenta = ESTADOS_VENTA.has(s);
    if (!esVenta) centExcluido += e.cent;
    return `<tr class="${esVenta ? "" : "excluido"}">
      <td><code>${s}</code> · ${DESC_ESTADOS[s]}</td>
      <td class="${esVenta ? "si" : "no"}">${esVenta ? "Sí" : "No"}</td>
      <td class="n">${entero.format(e.pedidos)}</td>
      <td class="n">${pesos.format(e.cent / 100)}</td>
    </tr>`;
  }).join("");

  document.querySelector("#tabla-estados tfoot").innerHTML =
    `<tr><td>Ventas válidas</td><td></td><td class="n">${entero.format(r.pedidosVenta)}</td><td class="n">${pesos.format(r.centVenta / 100)}</td></tr>`;

  document.getElementById("nota1").textContent =
    `Quedan afuera ${pesos.format(centExcluido / 100)} de pedidos cancelados, reembolsados o sin pagar. ` +
    `Sumar los ${entero.format(r.porEstado.REFUNDED?.pedidos ?? 0)} reembolsados sería un error: se entregaron, pero el dinero se devolvió.`;
}

function pintarPregunta2(r) {
  const proporcion = r.pedidosVenta / r.total;
  document.getElementById("r2").innerHTML =
    `${entero.format(r.pedidosVenta)} pedidos<small>${pct.format(proporcion)} de los ${entero.format(r.total)} pedidos del sistema</small>`;

  const f = r.porEstado.FULFILLED?.pedidos ?? 0;
  const p = r.porEstado.PAID?.pedidos ?? 0;
  document.getElementById("texto2").innerHTML =
    `Se cuentan los pedidos en estado <code>FULFILLED</code> (${entero.format(f)}) más los <code>PAID</code> (${entero.format(p)}): ` +
    `${entero.format(f)} + ${entero.format(p)} = <strong>${entero.format(r.pedidosVenta)}</strong>. ` +
    `Los <code>PAID</code> cuentan aunque todavía no se entregaron, porque el cobro ya se concretó.`;

  const colores = { FULFILLED: "var(--verde)", PAID: "var(--verde-claro)", CANCELLED: "var(--rojo)", REFUNDED: "var(--ocre)", CREATED: "var(--gris)" };
  const presentes = ORDEN_ESTADOS.filter((s) => r.porEstado[s]);
  document.getElementById("barra2").innerHTML = presentes
    .map((s) => `<span style="flex:${r.porEstado[s].pedidos};background:${colores[s]}" title="${s}: ${entero.format(r.porEstado[s].pedidos)}"></span>`)
    .join("");
  document.getElementById("leyenda2").innerHTML = presentes
    .map((s) => `<li><i style="background:${colores[s]}"></i>${s} ${entero.format(r.porEstado[s].pedidos)} (${pct.format(r.porEstado[s].pedidos / r.total)})</li>`)
    .join("");
}

function pintarPregunta3(r) {
  const t = (c) => c.cent / 100 / c.pedidos;
  const tOn = t(r.canal.online);
  const tOff = t(r.canal.offline);
  const max = Math.max(tOn, tOff);

  const tarjeta = (clase, nombre, c, ticket) => `
    <div class="canal ${clase}">
      <p class="etq">${nombre}</p>
      <p class="valor">${pesos.format(ticket)}</p>
      <div class="pista"><span style="width:${(ticket / max) * 100}%"></span></div>
      <p class="det">${pesos.format(c.cent / 100)} ÷ ${entero.format(c.pedidos)} pedidos</p>
    </div>`;
  document.getElementById("r3").innerHTML =
    tarjeta("online", "Online (web)", r.canal.online, tOn) +
    tarjeta("offline", "Offline (tiendas)", r.canal.offline, tOff);

  const fila = (nombre, c) =>
    `<tr><td>${nombre}</td><td class="n">${entero.format(c.pedidos)}</td><td class="n">${pesos.format(c.cent / 100)}</td><td class="n">${pesos2.format(c.cent / 100 / c.pedidos)}</td></tr>`;
  const total = { pedidos: r.pedidosVenta, cent: r.centVenta };
  document.querySelector("#tabla-canal tbody").innerHTML =
    fila("Online", r.canal.online) + fila("Offline", r.canal.offline) + fila("<strong>Total</strong>", total);

  const sinEnvio = (c) => c.centSinEnvio / 100 / c.pedidos;
  const dif = tOn / tOff - 1;
  document.getElementById("nota3").innerHTML =
    `El ticket online es ${pct.format(dif)} más alto, pero <strong>la diferencia la explica el costo de envío</strong>, que solo pagan los pedidos online. ` +
    `Sin envío, el ticket queda en ${pesos.format(sinEnvio(r.canal.online))} online contra ${pesos.format(sinEnvio(r.canal.offline))} offline: prácticamente iguales. ` +
    `Control de calidad: el canal según <code>store_id</code> coincide con <code>channel_id</code> en todos los pedidos (${entero.format(r.inconsistencias)} diferencias).`;
}

function pintarVerificacion(r) {
  const js = {
    ventas: r.centVenta / 100,
    pedidos: r.pedidosVenta,
    ticketOnline: Math.round(r.canal.online.cent / r.canal.online.pedidos) / 100,
    ticketOffline: Math.round(r.canal.offline.cent / r.canal.offline.pedidos) / 100,
  };
  const filas = [
    ["Ventas", "ventas", pesos.format],
    ["Pedidos válidos", "pedidos", entero.format],
    ["Ticket online", "ticketOnline", pesos2.format],
    ["Ticket offline", "ticketOffline", pesos2.format],
  ];
  let todoCoincide = true;
  document.querySelector("#tabla-verif tbody").innerHTML = filas.map(([nombre, k, fmt]) => {
    const ok = Math.abs(js[k] - CONSTRUCTOR_SQL[k]) < 0.01 && Math.abs(js[k] - AUDITOR[k]) < 0.01;
    if (!ok) todoCoincide = false;
    return `<tr><td>${nombre}</td><td class="n">${fmt(CONSTRUCTOR_SQL[k])}</td><td class="n">${fmt(AUDITOR[k])}</td><td class="n ${ok ? "coincide" : "no"}">${fmt(js[k])} ${ok ? "✓" : "✗"}</td></tr>`;
  }).join("");
  document.getElementById("nota-verif").textContent = todoCoincide
    ? "Los tres cálculos, hechos por caminos distintos, dan exactamente lo mismo."
    : "Atención: algún cálculo no coincide. Revisar los datos de data/sales_order.csv.";
}

async function iniciar() {
  const estado = document.getElementById("estado");
  try {
    const resp = await fetch("data/sales_order.csv");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const pedidos = parsearCSV(await resp.text());
    const r = calcular(pedidos);
    pintarPregunta1(r);
    pintarPregunta2(r);
    pintarPregunta3(r);
    pintarVerificacion(r);
    estado.textContent = `Calculado en vivo sobre ${entero.format(r.total)} pedidos de data/sales_order.csv`;
    estado.classList.add("ok");
  } catch (err) {
    estado.textContent =
      "No se pudieron leer los datos. Si abriste el archivo con doble clic, el navegador bloquea la lectura: " +
      "abrilo desde GitHub Pages o con un servidor local (por ejemplo, la extensión Live Server de VS Code).";
    estado.classList.add("error");
    console.error(err);
  }
}

iniciar();
