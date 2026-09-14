import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/core/purchases", () => mocks);

import { postPurchaseRequest } from "../src/api/purchases";

describe("purchase date input security boundary", () => {
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

  it("accepts an omitted purchasedAt and valid ISO dates", async () => {
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "auth-1" });

    const result = await postPurchaseRequest({ ...validInput(), purchasedAt: "2026-09-14T12:00:00.000Z" });

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
  });

  it("accepts a valid Date object", async () => {
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "auth-1" });

    const result = await postPurchaseRequest({ ...validInput(), purchasedAt: new Date("2026-09-14T12:00:00.000Z") });

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
  });

  it("rejects malformed dates before reaching the purchase core", async () => {
    for (const purchasedAt of ["not-a-date", "", "   "]) {
      const result = await postPurchaseRequest({ ...validInput(), purchasedAt });
      expect(result).toEqual({ status: 400, body: { error: "PURCHASE_DATE_INVALID" } });
    }
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects invalid Date objects before reaching the purchase core", async () => {
    const result = await postPurchaseRequest({ ...validInput(), purchasedAt: new Date("invalid") });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_DATE_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects oversized date strings before reaching the purchase core", async () => {
    const result = await postPurchaseRequest({ ...validInput(), purchasedAt: "2".repeat(65) });

    expect(result).toEqual({ status: 400, body: { error: "PURCHASE_DATE_INVALID" } });
    expect(mocks.requestPurchaseReceipt).not.toHaveBeenCalled();
  });
});
