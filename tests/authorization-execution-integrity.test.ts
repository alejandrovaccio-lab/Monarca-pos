import { describe, expect, it } from "vitest";

import { assertAuthorizationExecution, authorizationIntegrityHash } from "../src/core/authorization";

const authorization = {
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  type: "PRICE_CHANGE",
  status: "APPROVED",
  reason: "Cambio autorizado",
  entityType: "ProductPrice",
  entityId: "product-1",
  beforeData: { price: 10 },
  requestedData: { price: 12 },
  integrityHash: "",
};

authorization.integrityHash = authorizationIntegrityHash(authorization);

describe("Authorization execution integrity", () => {
  it("allows execution only when scope, target and requested data match the approved authorization", () => {
    expect(() => assertAuthorizationExecution({
      authorization,
      organizationId: "org-1",
      branchId: "branch-1",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-1",
      currentData: { price: 10 },
      requestedData: { price: 12 },
    })).not.toThrow();
  });

  it("rejects execution of an authorization that is not approved", () => {
    expect(() => assertAuthorizationExecution({
      authorization: { ...authorization, status: "REJECTED" },
      organizationId: "org-1",
      branchId: "branch-1",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-1",
    })).toThrow("AUTHORIZATION_NOT_APPROVED");
  });

  it("rejects execution against a different organization or branch", () => {
    expect(() => assertAuthorizationExecution({
      authorization,
      organizationId: "org-2",
      branchId: "branch-1",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-1",
    })).toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");

    expect(() => assertAuthorizationExecution({
      authorization,
      organizationId: "org-1",
      branchId: "branch-2",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-1",
    })).toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
  });

  it("rejects execution against a different operation or entity", () => {
    expect(() => assertAuthorizationExecution({
      authorization,
      organizationId: "org-1",
      branchId: "branch-1",
      type: "DISCOUNT_EXCEPTION",
      entityType: "ProductPrice",
      entityId: "product-1",
    })).toThrow("AUTHORIZATION_EXECUTION_MISMATCH");

    expect(() => assertAuthorizationExecution({
      authorization,
      organizationId: "org-1",
      branchId: "branch-1",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-2",
    })).toThrow("AUTHORIZATION_EXECUTION_MISMATCH");
  });

  it("rejects execution when the approved target state differs from the requested operation", () => {
    expect(() => assertAuthorizationExecution({
      authorization,
      organizationId: "org-1",
      branchId: "branch-1",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-1",
      requestedData: { price: 15 },
    })).toThrow("AUTHORIZATION_EXECUTION_MISMATCH");
  });

  it("rejects execution when the underlying record changed after authorization", () => {
    expect(() => assertAuthorizationExecution({
      authorization,
      organizationId: "org-1",
      branchId: "branch-1",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-1",
      currentData: { price: 11 },
      requestedData: { price: 12 },
    })).toThrow("AUTHORIZATION_STATE_CHANGED");
  });

  it("rejects a tampered authorization integrity hash", () => {
    expect(() => assertAuthorizationExecution({
      authorization: { ...authorization, requestedData: { price: 99 } },
      organizationId: "org-1",
      branchId: "branch-1",
      type: "PRICE_CHANGE",
      entityType: "ProductPrice",
      entityId: "product-1",
    })).toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
  });
});
