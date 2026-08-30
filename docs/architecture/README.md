# Arquitectura de Monarca OS

## Propósito

Monarca OS es la plataforma operativa de Mercadito Esquina, diseñada desde el inicio para múltiples sucursales, cajas, colaboradores y futuras franquicias.

## Principios

1. Modularidad: cada dominio de negocio debe tener responsabilidades claras.
2. Multiempresa y multisucursal: los datos operativos deben poder asociarse con su organización y sucursal.
3. Trazabilidad: las operaciones importantes deben conservar usuario/colaborador, sucursal y fecha/hora.
4. Inventario por movimientos: las existencias deben poder explicarse mediante entradas, ventas, mermas, quebrantos, transferencias y transformaciones.
5. Merma y quebranto se registran por separado del margen comercial.
6. Escalabilidad: comenzar como monolito modular y mantener límites claros para evolucionar si el crecimiento lo justifica.
7. Preparación offline: el POS debe poder operar temporalmente sin conexión y sincronizar posteriormente.
8. Identidad visual compartida entre POS, tickets, etiquetas y catálogo digital.

## Stack técnico establecido

- Frontend: Next.js + TypeScript.
- Backend: NestJS + TypeScript.
- Base de datos: PostgreSQL.
- ORM: Prisma.
- Almacenamiento de archivos: S3-compatible.
- Cliente: web responsive/PWA, preparado para PC, tablet, móvil y terminal táctil.

## Dominios iniciales

- Organización y sucursales.
- Usuarios, colaboradores, roles y permisos.
- Productos y catálogo.
- Precios y costos.
- Ventas y cajas.
- Inventario.
- Compras y proveedores.
- Merma y quebranto.
- Transformaciones y rendimiento.
- Clientes y pedidos.
- Tickets y documentos.
- Reportes.
- Auditoría.
- Integraciones futuras.
