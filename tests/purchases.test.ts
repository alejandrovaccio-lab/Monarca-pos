import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    supplier: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    purchase: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: vi.fn(),
  requestAuthorization: vi.fn(),
}));

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, requestAuthorization } from "../src/core/authorization";
import { executeApprovedPurchaseReceipt, requestPurchaseReceipt } from "../src/core/purchases";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("purchase receipts", () => {
  it("creates a senior authorization request without changing inventory", async () => {
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.user.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.employee.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.supplier.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.product.findMany.mockResolvedValue([{ id: "product-1" }]);
    requestAuthorization.mockResolvedValue({ id: "auth-1", status: "PENDING" });

    const result = await requestPurchaseReceipt({
      branchId: "branch-1",
      requestedById: "user-1",
      employeeId: "emp-1",
      supplierId: "supplier-1",
      folio: "FAC-100",
      reason: "Resurtido sugerido por inventario",
      items: [{ productId: "product-1", quantity: 10, unitCost: 25 }],
    });

    expect(requestAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      type: "OTHER",
      entityType: "Purchase",
      requestedData: expect.objectContaining({
        branchId: "branch-1",
        supplierId: "supplier-1",
        folio: "FAC-100",
        items: [{ productId: "product-1", quantity: 10, unitCost: 25 }],
      }),
    }));
    expect(result.id).toBe("auth-1");
  });

  it("blocks execution without an authorized approver", async () => {
    canApproveAuthorization.mockResolvedValue(false);
    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" }))
      .rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
  });
});
