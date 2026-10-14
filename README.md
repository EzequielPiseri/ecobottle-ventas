# EcoBottle AR · Ventas en 3 preguntas

Tablero interactivo (HTML, CSS y JavaScript, sin librerías) publicado con GitHub Pages que responde y justifica:

1. ¿Cuánto vendimos?
2. ¿Cuántos pedidos contamos como venta?
3. ¿Cuál fue el ticket promedio, separando offline y online?

Los números se calculan **en el navegador** leyendo `data/sales_order.csv`, `data/address.csv` y `data/province.csv` (copias de `raw/` del repositorio de la cátedra) y se recalculan con cada filtro.

## Qué se puede hacer en el tablero

- **Filtrar** por período (todo, 2024, 2025 o un rango de meses), canal, provincia y definición del monto (con o sin IVA y envío). Todas las respuestas, gráficos y justificaciones se recalculan.
- **Hacer clic en un mes** del gráfico de ventas para filtrar el tablero a ese mes (otro clic lo quita).
- **Hacer clic en un estado** del gráfico 2 para incluirlo o excluirlo de la venta y ver cuánto cambian las respuestas. El tablero avisa cuando la vista no sigue la regla de la consigna; "Restablecer" vuelve a las respuestas oficiales.
- **Pasar el mouse** por los gráficos para ver los valores, o abrir la tabla de datos por mes.

## Respuestas

| Pregunta | Respuesta |
|---|---|
| 1. Ventas | **$382.410.636** |
| 2. Pedidos que cuentan como venta | **10.998** (10.938 `FULFILLED` + 60 `PAID`) de 11.969 |
| 3. Ticket promedio | **Online $35.152** · **Offline $34.229** |

## Reglas aplicadas (de la consigna)

- **Venta:** pedido en estado `PAID` o `FULFILLED`. No cuentan `CREATED`, `CANCELLED` ni `REFUNDED`.
- **Monto:** `total_amount` = subtotal + IVA (21 %) + costo de envío.
- **Canal:** online si `store_id` está vacío; offline (tienda) si tiene tienda.
- **Ticket promedio:** ventas del canal ÷ pedidos válidos del canal.

**Matiz de la pregunta 3:** el ticket online es 2,7 % más alto porque incluye el costo de envío, que en tienda no se paga. Sin envío, los dos canales quedan prácticamente iguales ($34.041 online y $34.170 offline).

## Cómo se usaron agentes

| Agente | Qué hizo |
|---|---|
| **Constructor** | Leyó la consigna, extrajo las reglas, calculó las respuestas con SQL (DuckDB) y construyó el sitio. |
| **Auditor independiente** | Recibió solo las preguntas, los CSV y la consigna, sin ver el trabajo del constructor. Recalculó con dos métodos (SQL y Python puro con `Decimal`) y revisó la calidad de datos: sin `order_id` duplicados, canal (`channel_id`) consistente con `store_id` en los 11.969 pedidos y `total_amount = subtotal + IVA + envío` en todas las filas. |
| **El tablero** | Tercer cálculo, en JavaScript, sobre los mismos CSV. Con la regla de la consigna y sin filtros da los mismos valores que los otros dos. |

Los tres cálculos coinciden al centavo. El auditor además detectó el matiz del envío en la pregunta 3.

## Estructura

```
index.html            estructura del tablero
styles.css            estilos (modo oscuro y diseño adaptable a celular)
app.js                lee los CSV, aplica filtros, calcula y dibuja los gráficos en SVG
data/                 sales_order.csv, address.csv y province.csv (datos de origen)
```

## Ver en local

Abrir `index.html` con doble clic no funciona, porque el navegador bloquea la lectura del CSV. Usar un servidor local, por ejemplo:

```bash
python -m http.server 8000
# y abrir http://localhost:8000
```

O la extensión **Live Server** de VS Code.
