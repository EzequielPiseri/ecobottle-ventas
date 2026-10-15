# EcoBottle AR · Ventas en 3 preguntas

Tablero interactivo (HTML, CSS y JavaScript, sin librerías) publicado con GitHub Pages que responde y justifica:

1. ¿Cuánto vendimos?
2. ¿Cuántos pedidos contamos como venta?
3. ¿Cuál fue el ticket promedio, separando offline y online?

## De dónde salen los datos

El tablero lee el **modelo estrella del data warehouse** construido en el TP (repositorio `practica-imond`, carpeta `dw/`), no las tablas de origen:

| Archivo | Tipo | Qué aporta |
|---|---|---|
| `fact_sales_order.csv` | Hecho (un pedido por fila) | Medidas: `sales_amount`, `is_sale`, `shipping_fee`, `total_amount` |
| `dim_date.csv` | Dimensión | Mes del pedido (`year_month`) |
| `dim_channel.csv` | Dimensión | Canal online / offline |
| `dim_province.csv` | Dimensión | Provincia de la venta |
| `dim_order_status.csv` | Dimensión | Estado del pedido y la regla `is_sale` |

**Todas las transformaciones se hicieron en SQL al construir el DW** (`sql/01_dimensiones.sql` y `sql/02_hechos.sql` del TP): la regla "venta = `PAID` o `FULFILLED`" vive en `dim_order_status.is_sale` y se copia al hecho como `is_sale` y `sales_amount`; el canal y la provincia ya están resueltos como claves de dimensión.

**El tablero no transforma datos.** Une el hecho con sus dimensiones por clave subrogada (como las relaciones de Power BI), filtra por atributos de dimensión y agrega medidas:

| Pregunta | Cálculo en el tablero |
|---|---|
| 1. Ventas | `SUM(sales_amount)` |
| 2. Pedidos que cuentan como venta | cantidad de filas con `is_sale = true` |
| 3. Ticket promedio por canal | `SUM(sales_amount) / pedidos con is_sale`, agrupado por `dim_channel` |

## Respuestas

| Pregunta | Respuesta |
|---|---|
| 1. Ventas | **$382.410.636** |
| 2. Pedidos que cuentan como venta | **10.998** (10.938 `FULFILLED` + 60 `PAID`) de 11.969 |
| 3. Ticket promedio | **Online $35.152** · **Offline $34.229** |

**Matiz de la pregunta 3:** el ticket online es 2,7 % más alto porque incluye el costo de envío, que en tienda no se paga. Sin envío, los dos canales quedan prácticamente iguales ($34.041 online y $34.170 offline).

## Qué se puede hacer en el tablero

- **Filtrar** por período (todo, 2024, 2025 o un rango de meses), canal y provincia. Respuestas, gráficos y justificaciones se recalculan.
- **Hacer clic en un mes** del gráfico de ventas para filtrar el tablero a ese mes (otro clic lo quita).
- **Pasar el mouse** por los gráficos para ver los valores, o abrir la tabla de datos por mes.

## Cómo se usaron agentes

| Agente | Qué hizo |
|---|---|
| **Constructor** | Leyó la consigna y construyó el tablero sobre el modelo estrella del DW. |
| **Auditor independiente** | Recibió solo las preguntas, los CSV de origen (`raw/`) y la consigna, sin ver el trabajo del constructor. Recalculó desde cero con dos métodos (SQL y Python con `Decimal`) y revisó la calidad de datos: sin `order_id` duplicados, canal consistente con `store_id` en los 11.969 pedidos y `total_amount = subtotal + IVA + envío` en todas las filas. |

El tablero (sobre el DW) y el auditor (sobre `raw/`) dan los mismos valores al centavo. Como llegan por caminos distintos, eso también valida que las transformaciones del DW no perdieron ni duplicaron ventas. El auditor además detectó el matiz del envío en la pregunta 3.

## Estructura

```
index.html   estructura del tablero
styles.css   estilos (modo oscuro y diseño adaptable a celular)
app.js       lee el modelo estrella, filtra por dimensiones, agrega medidas y dibuja los gráficos en SVG
data/        fact_sales_order.csv y las dimensiones (copias de dw/ del TP)
```

Si el DW se regenera (`python run_sql.py` en el TP), hay que volver a copiar esos cinco CSV a `data/`.

## Ver en local

Abrir `index.html` con doble clic no funciona, porque el navegador bloquea la lectura de los CSV. Usar un servidor local, por ejemplo:

```bash
python -m http.server 8000
# y abrir http://localhost:8000
```

O la extensión **Live Server** de VS Code.
