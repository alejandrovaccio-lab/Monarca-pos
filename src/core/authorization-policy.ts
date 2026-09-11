import { AUTHORIZATION_TYPES } from "./authorization";

export type AuthorizationRisk = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AuthorizationMode = "NORMAL" | "APPROVAL";

export type AuthorizationPolicy = {
  risk: AuthorizationRisk;
  mode: AuthorizationMode;
  reason: string;
};

const POLICIES: Record<string, AuthorizationPolicy> = {
  PRICE_CHANGE: { risk: "MEDIUM", mode: "APPROVAL", reason: "Cambio deliberado de precio" },
  MARGIN_CHANGE: { risk: "HIGH", mode: "APPROVAL", reason: "Cambio de margen objetivo" },
  DISCOUNT_EXCEPTION: { risk: "MEDIUM", mode: "APPROVAL", reason: "Descuento fuera de política" },
  SALE_CANCEL: { risk: "HIGH", mode: "APPROVAL", reason: "Cancelación posterior de venta" },
  SALE_REFUND: { risk: "HIGH", mode: "APPROVAL", reason: "Devolución posterior de venta" },
  INVENTORY_ADJUSTMENT: { risk: "MEDIUM", mode: "APPROVAL", reason: "Ajuste manual de existencia" },
  WASTE_EXCEPTION: { risk: "MEDIUM", mode: "APPROVAL", reason: "Merma fuera de operación normal" },
  SHRINKAGE_EXCEPTION: { risk: "HIGH", mode: "APPROVAL", reason: "Diferencia de inventario sensible" },
  COST_CHANGE: { risk: "HIGH", mode: "APPROVAL", reason: "Cambio de costo" },
  TAX_CHANGE: { risk: "CRITICAL", mode: "APPROVAL", reason: "Cambio de tratamiento fiscal" },
  REGISTER_EXCEPTION: { risk: "HIGH", mode: "APPROVAL", reason: "Excepción de caja" },
  ACCESS_CHANGE: { risk: "CRITICAL", mode: "APPROVAL", reason: "Cambio de acceso o permisos" },
  ORDER_ADJUSTMENT: { risk: "MEDIUM", mode: "APPROVAL", reason: "Ajuste excepcional de pedido" },
  OTHER: { risk: "HIGH", mode: "APPROVAL", reason: "Operación excepcional no clasificada" }
};

export function getAuthorizationPolicy(type: string): AuthorizationPolicy {
  if (!AUTHORIZATION_TYPES.has(type)) {
    return { risk: "NONE", mode: "NORMAL", reason: "Operación normal fuera del flujo de autorizaciones" };
  }
  return POLICIES[type] ?? POLICIES.OTHER;
}

export function requiresAuthorization(type: string): boolean {
  return getAuthorizationPolicy(type).mode === "APPROVAL";
}

export function isCriticalAuthorization(type: string): boolean {
  return getAuthorizationPolicy(type).risk === "CRITICAL";
}
