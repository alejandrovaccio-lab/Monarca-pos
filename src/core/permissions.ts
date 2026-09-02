export const ROLE_LEVELS = {
  CAJERO: 10,
  ENCARGADO_TIENDA: 20,
  GERENTE: 30,
  ADMINISTRADOR: 40
} as const;

export type MonarcaRole = keyof typeof ROLE_LEVELS;

export function canApprove(requesterRole: MonarcaRole, requiredRole: MonarcaRole): boolean {
  return ROLE_LEVELS[requesterRole] >= ROLE_LEVELS[requiredRole];
}

export function canExecuteSensitiveChange(role: MonarcaRole): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS.ENCARGADO_TIENDA;
}
