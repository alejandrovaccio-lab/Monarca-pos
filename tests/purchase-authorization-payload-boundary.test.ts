import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canApproveAuthorization: vi.fn(),
  findUniqueAuthorization: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: mocks.canApproveAuthorization,
  requestAuthorization: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    authorizationRequest: { findUnique: mocks.findUniqueAuthorization },
    $transaction: mocks.transaction,
  },
}));

import { executeApprovedPurchaseReceipt } from "../src/core/purchases";

const baseAuthorization = (requestedData: unknown) => ({
  id: "auth-1",
  status: "APPROVED",
  entityType: "Purchase",
  entityId: "purchase-1",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedData,
  reason: "Compra autorizada",
});

const validRequestedData = () => ({
  purchaseId: "purchase-1",
  branchId: "branch-1",
  supplierId: "supplier-1",
  folio: "F-001",
  employeeId: "employee-1",
  purchasedAt: new Date().toISOString(),
  items: [{ productId: "product-1", quantity: 2, unitCost: 10, taxRate: 16 }],
});

describe("purchase execution persisted authorization payload boundary", () => {
  it("rejects a non-object requestedData before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(baseAuthorization(null));

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with more than 100 items before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), items: Array.from({ length: 101 }, () => ({ productId: "product-1", quantity: 1, unitCost: 1 })) }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with an oversized product identifier before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), items: [{ productId: "p".repeat(129), quantity: 1, unitCost: 1 }] }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with an invalid numeric item value before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), items: [{ productId: "product-1", quantity: Number.POSITIVE_INFINITY, unitCost: 1 }] }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization payload with an oversized folio before opening the transaction", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({ ...validRequestedData(), folio: "F".repeat(129) }),
    );

    await expect(executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts the configured maximum item count at the payload boundary", async () => {
    mocks.canApproveAuthorization.mockResolvedValue(true);
    mocks.findUniqueAuthorization.mockResolvedValue(
      baseAuthorization({
        ...validRequestedData(),
        items: Array.from({ length: 100 }, (_, index) => ({ productId: `product-${index}`, quantity: 1, unitCost: 1 })),
      }),
    );
    mocks.transaction.mockResolvedValue({ id: "purchase-1" });

    const result = await executeApprovedPurchaseReceipt({ requestId: "request-1", executorId: "user-1" });

    expect(result).toEqual({ id: "purchase-1" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
