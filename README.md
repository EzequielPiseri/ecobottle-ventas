# EcoBottle AR · Ventas en 3 preguntas

Tablero interactivo (HTML, CSS y JavaScript, sin librerías) publicado con GitHub Pages que responde y justifica:

1. ¿Cuánto vendimos?
2. ¿Cuántos pedidos contamos como venta?
3. ¿Cuál fue el ticket promedio, separando offline y online?

## De dónde salen los datos

Los KPIs se calculan **en SQL, dentro del data warehouse del TP** (repositorio `practica-imond`), y se **materializan en tablas mart**. El tablero solo las lee: busca la fila que corresponde a los filtros elegidos y la muestra. **No suma, no promedia ni divide.**

```
raw/ (origen) ──► modelo estrella (sql/01 y 02) ──► tablas mart (sql/05_marts.sql) ──► este tablero
                  transformaciones y reglas          KPIs ya calculados               solo visualiza
```

| Tabla mart | Una fila es… | Qué trae |
|---|---|---|
| `mart_sales_kpi` | un período × canal × provincia | ventas con y sin IVA, pedidos totales y válidos, ticket con y sin IVA, ticket sin envío, IVA y envío de las ventas |
| `mart_order_status` | un período × canal × provincia × estado | pedidos y monto por estado, con la marca `is_sale` |

**Por qué una fila por cada combinación de filtros:** un promedio ya calculado no se puede volver a agregar (el ticket de 2025 no es el promedio de los tickets de cada mes). Por eso SQL calcula todas las combinaciones que ofrece el tablero con `GROUPING SETS` (vía `CUBE`):

- **Período:** el total, cada año (2024, 2025) y cada mes.
- **Canal:** Todos, ONLINE u OFFLINE.
- **Provincia:** Todas o cada provincia.

Las filas "Todos" y "Todas" son los totales calculados en SQL, no sumas que haga el tablero. El SQL está en [`sql/05_marts.sql`](./sql/05_marts.sql), copiado del TP.

**Reglas aplicadas en el DW:** venta = pedido con `is_sale = true` (estados `PAID` o `FULFILLED`, definido en `dim_order_status`); sin IVA = `total_amount − tax_amount` (se descuenta el impuesto y se mantiene el envío, que es ingreso de la empresa).

## Respuestas

| Pregunta | Con IVA | Sin IVA |
|---|---|---|
| 1. Ventas | **$382.410.636** | **$317.333.400** |
| 2. Pedidos que cuentan como venta | **10.998** (10.938 `FULFILLED` + 60 `PAID`) de 11.969 | (igual) |
| 3. Ticket online | **$35.152** | $29.244 |
| 3. Ticket offline | **$34.229** | $28.298 |

**Matiz de la pregunta 3:** el ticket online es más alto porque incluye el costo de envío, que en tienda no se paga. Sin envío (`ticket_no_shipping`), los dos canales quedan prácticamente iguales: $34.041 online y $34.170 offline.

## Qué se puede hacer en el tablero

- **Filtrar** por período (todo, 2024, 2025 o un mes), canal, provincia y monto (con o sin IVA). Cada combinación tiene su fila en el mart.
- **Hacer clic en un mes** del gráfico de ventas para ver solo ese mes; otro clic vuelve al período.
- **Pasar el mouse** por los gráficos para ver los valores, o abrir la tabla de datos por mes.

## Cómo se usaron agentes

| Agente | Qué hizo |
|---|---|
| **Constructor** | Leyó la consigna, armó las tablas mart en SQL y construyó el tablero sobre ellas. |
| **Auditor independiente** | Recibió solo las preguntas, los CSV de origen (`raw/`) y la consigna, sin ver el trabajo del constructor. Recalculó desde cero con dos métodos (SQL y Python con `Decimal`) y revisó la calidad de datos: sin `order_id` duplicados, canal consistente con `store_id` en los 11.969 pedidos y `total_amount = subtotal + IVA + envío` en todas las filas. |

El mart (calculado sobre el modelo estrella) y el auditor (sobre `raw/`) dan los mismos valores al centavo. Como llegan por caminos distintos, eso valida también que las transformaciones del DW no perdieron ni duplicaron ventas. El auditor además detectó el matiz del envío en la pregunta 3.

## Estructura

```
index.html                  estructura del tablero
styles.css                  estilos (modo oscuro y diseño adaptable a celular)
app.js                      lee los marts, busca la fila de los filtros y dibuja los gráficos en SVG
data/mart_sales_kpi.csv     KPIs por período × canal × provincia
data/mart_order_status.csv  pedidos por estado
sql/05_marts.sql            SQL que genera los marts (copia del TP)
```

Para actualizar los datos: en el TP, correr `python run_sql.py` y copiar `dw/mart_sales_kpi.csv` y `dw/mart_order_status.csv` a `data/`.

## Ver en local

Abrir `index.html` con doble clic no funciona, porque el navegador bloquea la lectura de los CSV. Usar un servidor local, por ejemplo 3:

```bash
python -m http.server 8000
# y abrir http://localhost:8000                                                                                                                           
```

O la extensión **Live Server** de VS Code.
