import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/core/purchases", () => mocks);

import { postPurchaseRequest } from "../src/api/purchases";

describe("purchase identifier security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = () => ({
    branchId: "branch-1",
    requestedById: "user-1",
    employeeId: "emp-1",
    supplierId: "supplier-1",
    folio: "FAC-1",
    reason: "Resurtido",
    items: [{ productId: "product-1", quantity: 1, unitCost: 10 }],
  });

  it.each([
    ["branchId", "branchId"],
    ["requestedById", "requestedById"],
    ["employeeId", "employeeId"],
    ["supplierId", "supplierId"],
  ])("accepts %s at the 128-character limit", async (_, field) => {
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "auth-1" });
    const input = { ...validInput(), [field]: "x".repeat(128) };

    const result = await postPurchaseRequest(input);

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
    expect(mocks.requestPurchaseReceipt).toHaveBeenCalledWith(input);
  });

  it.each([
    ["branchId", "branchId"],
    ["requestedById", "requestedById"],
    ["employeeId", "employeeId"],
    ["supplierId", "supplierId"],
  ])("rejects %s over the 128-character limit before reaching the purchase core", async (_, field) => {
    const result = await postPurchaseRequest({ ...validInput(), [field]: "x".repeat(129) });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_IDENTIFIER_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ["branchId", "branchId"],
    ["requestedById", "requestedById"],
    ["employeeId", "employeeId"],
    ["supplierId", "supplierId"],
  ])("rejects empty %s before reaching the purchase core", async (_, field) => {
    const result = await postPurchaseRequest({ ...validInput(), [field]: "   " });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_IDENTIFIER_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });
});
