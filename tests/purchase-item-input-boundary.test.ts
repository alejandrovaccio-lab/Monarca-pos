import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/core/purchases", () => mocks);

import { postPurchaseRequest } from "../src/api/purchases";

describe("purchase item input security boundary", () => {
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
    items: [{ productId: "product-1", quantity: 1, unitCost: 10, taxRate: 16 }],
  });

  it("accepts item values at every configured maximum", async () => {
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "auth-1" });
    const input = {
      ...validInput(),
      items: [{ productId: "p".repeat(128), quantity: 1_000_000, unitCost: 1_000_000_000, taxRate: 100 }],
    };

    const result = await postPurchaseRequest(input);

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
    expect(mocks.requestPurchaseReceipt).toHaveBeenCalledWith(input);
  });

  it("rejects an oversized productId before reaching the purchase core", async () => {
    const result = await postPurchaseRequest({ ...validInput(), items: [{ productId: "p".repeat(129), quantity: 1, unitCost: 10 }] });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_ITEM_INPUT_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects zero, negative, infinite, and oversized quantities", async () => {
    for (const quantity of [0, -1, Infinity, 1_000_001]) {
      const result = await postPurchaseRequest({ ...validInput(), items: [{ productId: "product-1", quantity, unitCost: 10 }] });
      expect(result).toEqual({ status: 400, body: { error: "PURCHASE_ITEM_INPUT_INVALID" } });
    }
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects negative, non-finite, and oversized unit costs", async () => {
    for (const unitCost of [-1, Infinity, 1_000_000_001]) {
      const result = await postPurchaseRequest({ ...validInput(), items: [{ productId: "product-1", quantity: 1, unitCost }] });
      expect(result).toEqual({ status: 400, body: { error: "PURCHASE_ITEM_INPUT_INVALID" } });
    }
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects tax rates outside 0 to 100 or non-finite values", async () => {
    for (const taxRate of [-1, 101, Infinity]) {
      const result = await postPurchaseRequest({ ...validInput(), items: [{ productId: "product-1", quantity: 1, unitCost: 10, taxRate }] });
      expect(result).toEqual({ status: 400, body: { error: "PURCHASE_ITEM_INPUT_INVALID" } });
    }
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects malformed item objects before reaching the purchase core", async () => {
    const result = await postPurchaseRequest({ ...validInput(), items: [{ productId: "product-1", quantity: "1" as unknown as number, unitCost: 10 }] });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_ITEM_INPUT_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });
});
