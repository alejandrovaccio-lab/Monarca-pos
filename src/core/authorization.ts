export const AUTHORIZATION_ROLES = [
  "CAJERO",
  "ENCARGADO_TIENDA",
  "GERENTE",
  "ADMINISTRADOR"
] as const;

export type AuthorizationRole = (typeof AUTHORIZATION_ROLES)[number];

export type AuthorizationRequest = {
  type: string;
  reason: string;
  requestedBy: string;
  branchId: string;
};

export function requiresAuthorization(role: AuthorizationRole, sensitiveChange: boolean): boolean {
  return sensitiveChange && role === "CAJERO";
}
