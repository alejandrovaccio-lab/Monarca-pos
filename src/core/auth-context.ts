import { AsyncLocalStorage } from "node:async_hooks";

export type AuthenticatedContext = {
  userId: string;
  branchId: string;
  organizationId: string;
};

const storage = new AsyncLocalStorage<AuthenticatedContext>();

export function setAuthenticatedContext(context: AuthenticatedContext) {
  storage.enterWith(context);
}

export function getAuthenticatedContext() {
  return storage.getStore();
}
