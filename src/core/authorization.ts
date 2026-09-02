import { canExecuteSensitiveChange, type MonarcaRole } from "./permissions";

export type AuthorizationRequest = {
  type: string;
  reason: string;
  requestedBy: string;
  branchId: string;
};

export function authorizeSensitiveChange(role: MonarcaRole): boolean {
  return canExecuteSensitiveChange(role);
}
