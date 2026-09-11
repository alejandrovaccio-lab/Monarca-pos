import { describe, expect, it } from "vitest";
import {
  getAuthorizationPolicy,
  isCriticalAuthorization,
  requiresAuthorization
} from "../src/core/authorization-policy";

describe("authorization risk policy", () => {
  it("keeps normal operations outside the approval flow", () => {
    expect(getAuthorizationPolicy("SALE_CREATE")).toEqual({
      risk: "NONE",
      mode: "NORMAL",
      reason: "Operación normal fuera del flujo de autorizaciones"
    });
    expect(requiresAuthorization("SALE_CREATE")).toBe(false);
  });

  it("requires one targeted approval for sensitive operations", () => {
    for (const type of ["PRICE_CHANGE", "DISCOUNT_EXCEPTION", "SALE_CANCEL", "SALE_REFUND", "INVENTORY_ADJUSTMENT", "ORDER_ADJUSTMENT"]) {
      expect(requiresAuthorization(type)).toBe(true);
      expect(getAuthorizationPolicy(type).mode).toBe("APPROVAL");
    }
  });

  it("marks financial, fiscal and access changes as higher risk", () => {
    expect(getAuthorizationPolicy("COST_CHANGE").risk).toBe("HIGH");
    expect(getAuthorizationPolicy("REGISTER_EXCEPTION").risk).toBe("HIGH");
    expect(getAuthorizationPolicy("TAX_CHANGE").risk).toBe("CRITICAL");
    expect(getAuthorizationPolicy("ACCESS_CHANGE").risk).toBe("CRITICAL");
    expect(isCriticalAuthorization("TAX_CHANGE")).toBe(true);
    expect(isCriticalAuthorization("ACCESS_CHANGE")).toBe(true);
  });

  it("does not require a second approval layer by policy", () => {
    const approvalTypes = ["PRICE_CHANGE", "SALE_CANCEL", "SALE_REFUND", "INVENTORY_ADJUSTMENT", "TAX_CHANGE", "ACCESS_CHANGE"];
    for (const type of approvalTypes) {
      expect(getAuthorizationPolicy(type).mode).toBe("APPROVAL");
    }
  });
});
