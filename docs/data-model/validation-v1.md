# Validación técnica — Prisma Schema v1

## Revisión realizada

El esquema v1 se revisa antes de cualquier migración para evitar consolidar decisiones difíciles de cambiar después.

### Decisiones confirmadas

- UUID como identificador interno.
- Decimal para importes, costos, precios y cantidades medibles.
- Organization como límite de datos de negocio.
- Branch como límite operativo de sucursal.
- RegisterSession como límite de una jornada/sesión de caja.
- SaleItem conserva snapshots de nombre, precio y costo para preservar el historial.
- InventoryMovement es la fuente de trazabilidad del inventario.
- ProductCost mantiene historial en lugar de sobrescribir costos.
- Merma y quebranto tienen tipos de movimiento independientes.
- Vendedor y cajero pueden ser personas distintas.
- Transformaciones conservan entradas y salidas.
- AuditLog conserva actor y estado anterior/posterior cuando corresponda.

## Correcciones/pendientes antes de migración

1. Incorporar una estrategia explícita para impuestos por producto/venta, incluyendo IVA/IEPS y futuras reglas fiscales mexicanas, sin codificar tasas directamente en el catálogo.
2. Revisar la relación Order.saleId: deberá convertirse en una relación formal con Sale o eliminarse en favor de una tabla de enlace, según la regla de negocio final.
3. Definir precisión de cantidades por unidad y reglas de redondeo para productos vendidos por peso.
4. Definir estados y folios para devoluciones/cancelaciones antes de producción.
5. Definir soft-delete/archive para catálogo y entidades administrativas, evitando borrar historial transaccional.
6. Añadir parámetros de inventario por sucursal: stock mínimo, máximo, punto de reorden y cobertura/días de venta.
7. Añadir configuración de merma/quebranto y parámetros de rentabilidad por producto o categoría.
8. Definir índices adicionales después de conocer las consultas principales del POS y reportes.
9. Separar datos sensibles de autenticación del perfil operativo cuando se implemente el proveedor de identidad.
10. Añadir constraints de consistencia en migración donde PostgreSQL pueda garantizar reglas críticas.

## Regla de migración

No ejecutar la primera migración de producción hasta cerrar estos pendientes y probar `prisma validate` y `prisma format`.

## Próximo paso técnico

Crear la capa de configuración y documentación fiscal, inventario y pricing; después ajustar el schema y preparar la primera migración PostgreSQL.