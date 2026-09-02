import { type MonarcaRole, canApprove } from "../core/permissions";
import { requireSession } from "./auth";

export async function requireRole(token: string, requiredRole: MonarcaRole) {
  const context = await requireSession(token);
  if (!context) return null;
  const roles = context.roles as MonarcaRole[];
  const allowed = roles.some((role) => canApprove(role, requiredRole));
  return allowed ? context : null;
}

export async function requireSensitiveAuthorization(token: string) {
  return requireRole(token, "ENCARGADO_TIENDA");
}
