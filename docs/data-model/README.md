# Modelo de datos v1 — Monarca OS

## Objetivo

Definir el modelo conceptual inicial de Monarca OS antes de implementar PostgreSQL/Prisma. El diseño prioriza multiempresa, multisucursal, trazabilidad, inventario por movimientos y crecimiento hacia franquicias.

## Jerarquía organizacional

`Organization -> Branch -> Register`

- **Organization**: empresa/entidad operadora.
- **Branch**: sucursal física.
- **Register**: caja/POS perteneciente a una sucursal.

## Identidad y acceso

`User -> Role -> Permission`

Los usuarios pueden tener acceso a una o varias sucursales mediante una relación explícita. El colaborador operativo se modela separado de la identidad de acceso para conservar historial laboral y permitir que un colaborador tenga cambios de puesto o sucursal.

Entidades principales: `User`, `Role`, `Permission`, `UserBranchAccess`, `Employee`, `EmployeeAssignment`.

## Catálogo

`Category -> Product`

Un producto puede venderse por pieza, peso, volumen u otra unidad configurada. Las imágenes, etiquetas y códigos se mantienen como datos del catálogo, no como lógica del POS.

Entidades: `Category`, `Product`, `ProductImage`, `ProductLabel`, `UnitOfMeasure`, `Barcode`.

## Costos y precios

Cada producto conserva historial de costos y configuración comercial. El margen objetivo es independiente por producto y puede variar según categoría o reglas futuras.

Regla base:

`precio_sugerido = costo_base / (1 - margen_objetivo)`

Ejemplos: 35% -> dividir entre 0.65; 45% -> dividir entre 0.55.

Entidades: `ProductCost`, `PriceRule`, `ProductPrice`, `MarginConfiguration`.

Merma y quebranto **no son margen**. Se registran como pérdidas operativas separadas y pueden alimentar el cálculo de precio recomendado/rentabilidad.

## Inventario

La existencia se explica mediante un libro de movimientos.

`InventoryBalance` es una vista/estado derivado; `InventoryMovement` es la fuente de trazabilidad.

Tipos iniciales: compra/entrada, venta/salida, merma, quebranto, transferencia, ajuste, transformación-consumo y transformación-producción.

Cada movimiento operativo debe poder identificar organización, sucursal, producto, cantidad, unidad, fecha/hora, usuario y/o colaborador responsable, y documento de origen cuando aplique.

## Compras

`Supplier -> Purchase -> PurchaseItem`

Las compras actualizan inventario y alimentan historial de costos. Deben conservar proveedor, sucursal receptora, fecha, cantidades, costo unitario e impuestos cuando correspondan.

## Ventas y cajas

`RegisterSession -> Sale -> SaleItem -> Payment`

Una venta identifica sucursal, caja, sesión de caja, cajero/responsable y, cuando aplique, vendedor. Esto permite que vendedor y cajero sean personas distintas.

`SaleItem` conserva producto, cantidad, unidad, precio aplicado, descuento e información necesaria para reconstruir el importe.

## Transformaciones y rendimiento

`Transformation -> TransformationInput / TransformationOutput`

Permite convertir materias primas en productos vendibles y registrar merma/rendimiento. Cada transformación queda vinculada a sucursal y responsable.

## Clientes y pedidos

`Customer -> Order -> OrderItem`

Los pedidos soportan origen WhatsApp, pickup u otros canales futuros. El pedido conserva sucursal, cliente, horario solicitado, estado, responsable de preparación y relación con la venta cuando se complete.

## Documentos

Tickets, comprobantes y futuras facturas se modelan como documentos vinculados a la operación correspondiente. La generación visual se mantiene separada del núcleo transaccional.

## Auditoría

`AuditLog` registra acciones relevantes: creación, modificación, cancelación, cambios de precio, ajustes de inventario, movimientos sensibles y cambios administrativos. Debe conservar actor, organización, sucursal cuando aplique, entidad afectada, valores relevantes y fecha/hora.

## Reglas estructurales

1. Las operaciones transaccionales no deben depender de datos globales ambiguos.
2. Toda operación de sucursal debe identificar `branch_id`.
3. Toda operación de caja debe identificar `register_id` y sesión cuando aplique.
4. Inventario se audita mediante movimientos, no mediante modificaciones silenciosas de existencias.
5. Merma y quebranto permanecen separados.
6. Costos históricos no se sobrescriben.
7. Los precios aplicados en una venta deben quedar congelados en `SaleItem`, aunque el catálogo cambie después.
8. Las cancelaciones y devoluciones deben generar trazabilidad, no borrar ventas históricas.
9. Los identificadores internos serán UUID; los folios legibles serán independientes.
10. Fechas de servidor se almacenarán en UTC y la presentación usará la zona horaria de la sucursal.
11. Los importes monetarios usarán tipos decimales, nunca `float`.
12. El esquema debe permitir futuras franquicias sin rediseñar las entidades centrales.

## Próximo paso

Convertir este modelo conceptual en un esquema Prisma normalizado, revisar claves, índices, restricciones y estrategia de migraciones antes de crear la primera migración de PostgreSQL.
