import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/core/purchases", () => mocks);

import { postPurchaseRequest } from "../src/api/purchases";

describe("purchase request input security boundary", () => {
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

  it("accepts reason at the 1000-character limit", async () => {
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "auth-1" });
    const input = { ...validInput(), reason: "r".repeat(1000) };

    const result = await postPurchaseRequest(input);

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
    expect(mocks.requestPurchaseReceipt).toHaveBeenCalledWith(input);
  });

  it("rejects reason over 1000 characters before reaching the purchase core", async () => {
    const result = await postPurchaseRequest({ ...validInput(), reason: "r".repeat(1001) });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_REASON_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("accepts folio at the 128-character limit", async () => {
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "auth-1" });
    const input = { ...validInput(), folio: "f".repeat(128) };

    const result = await postPurchaseRequest(input);

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
    expect(mocks.requestPurchaseReceipt).toHaveBeenCalledWith(input);
  });

  it("rejects folio over 128 characters before reaching the purchase core", async () => {
    const result = await postPurchaseRequest({ ...validInput(), folio: "f".repeat(129) });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_FOLIO_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("accepts exactly 100 purchase items", async () => {
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "auth-1" });
    const input = { ...validInput(), items: Array.from({ length: 100 }, (_, index) => ({ productId: `product-${index}`, quantity: 1, unitCost: 10 })) };

    const result = await postPurchaseRequest(input);

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
    expect(mocks.requestPurchaseReceipt).toHaveBeenCalledWith(input);
  });

  it("rejects more than 100 purchase items before reaching the purchase core", async () => {
    const input = { ...validInput(), items: Array.from({ length: 101 }, (_, index) => ({ productId: `product-${index}`, quantity: 1, unitCost: 10 })) };

    const result = await postPurchaseRequest(input);

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_ITEMS_LIMIT_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects a non-array items payload at runtime", async () => {
    const result = await postPurchaseRequest({ ...validInput(), items: null as unknown as never[] });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_ITEMS_LIMIT_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });
});
