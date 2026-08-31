# Reglas de autorización y rentabilidad v1

## Principio de autorización

Todo cambio sensible que pueda afectar precio, margen, inventario, impuestos, descuentos, movimientos extraordinarios o datos administrativos debe requerir autorización según el nivel de permiso configurado.

### Niveles

- Colaborador/Cajero: operación normal dentro de límites autorizados; no puede modificar parámetros sensibles.
- Encargado de tienda: puede autorizar ajustes operativos de su sucursal dentro de límites establecidos.
- Gerente: puede autorizar cambios de mayor impacto y excepciones.
- Administración/Dirección: puede autorizar cambios globales, fiscales, maestros o políticas corporativas.

La aplicación deberá identificar quién solicita, quién autoriza, qué cambió, motivo, sucursal, fecha/hora y valores anterior/nuevo. La autorización no debe poder autoaprobarse cuando la política requiera un nivel superior.

## Precio y margen

La fórmula comercial base es:

`precio objetivo = costo base / (1 - margen objetivo)`

- Margen 35%: costo / 0.65.
- Margen 45%: costo / 0.55.

El porcentaje objetivo puede variar por producto/categoría y debe poder considerar características operativas como merma y quebranto esperados.

El sistema distinguirá entre:

1. costo de adquisición;
2. costo/rendimiento efectivo;
3. margen comercial objetivo;
4. pérdidas esperadas por merma/quebranto;
5. precio público vigente;
6. precio recomendado por el sistema.

El precio recomendado es una sugerencia. Un cambio del precio público vigente requiere autorización cuando la política de permisos lo determine.

## Merma y quebranto

Merma y quebranto se registran como eventos independientes, con producto, cantidad, costo, sucursal, responsable, fecha/hora, motivo y autorización cuando corresponda.

Estos eventos impactan reportes de inventario y rentabilidad, pero no se convierten automáticamente en margen comercial.

## Cambios sensibles

Requieren autorización configurable, como mínimo:

- cambio de precio público;
- cambio de margen objetivo;
- descuento fuera de límites;
- cancelación o devolución excepcional;
- ajuste extraordinario de inventario;
- merma/quebranto fuera de tolerancia;
- modificación de costos maestros;
- cambios de impuestos o configuración fiscal;
- apertura/cierre excepcional de caja;
- cambios de permisos o accesos.

## Auditoría

Toda autorización genera un registro inmutable de auditoría. Las operaciones autorizadas deben conservar la referencia al evento de autorización para reconstruir la cadena `solicitud -> autorización -> ejecución`.

## Próxima implementación

Estas reglas deberán reflejarse en el esquema Prisma mediante entidades de autorización, políticas y auditoría, y posteriormente en guards/services del backend. Los límites concretos serán configurables por organización y sucursal.