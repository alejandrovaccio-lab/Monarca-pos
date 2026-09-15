import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    supplier: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    authorizationApproval: { findFirst: vi.fn() },
    purchase: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/core/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/authorization")>();
  return {
    ...actual,
    APPROVER_ROLES: new Set(["GERENTE"]),
    canApproveAuthorization: vi.fn(),
    requestAuthorization: vi.fn(),
    authorizationIntegrityHash: vi.fn(() => "test-integrity-hash"),
  };
});

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, requestAuthorization } from "../src/core/authorization";
import { executeApprovedPurchaseReceipt, requestPurchaseReceipt } from "../src/core/purchases";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("purchase branch product scope", () => {
  it("requires every requested product to be assigned and enabled in the purchase branch", async () => {
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.user.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.employee.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.supplier.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.product.findMany.mockImplementation(async ({ where }: any) => {
      if (where.branchProducts?.some?.branchId === "branch-1" && where.branchProducts?.some?.isEnabled === true) return [{ id: "product-1" }];
      return [];
    });
    requestAuthorization.mockResolvedValue({ id: "auth-1", status: "PENDING" });

    await requestPurchaseReceipt({
      branchId: "branch-1",
      requestedById: "user-1",
      employeeId: "emp-1",
      supplierId: "supplier-1",
      folio: "FAC-200",
      reason: "Resurtido",
      items: [{ productId: "product-1", quantity: 5, unitCost: 20 }],
    });

    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        branchProducts: { some: { branchId: "branch-1", isEnabled: true } },
      }),
    }));
    expect(requestAuthorization).toHaveBeenCalledOnce();
  });

  it("blocks a purchase request when the product is not assigned or is disabled in the branch", async () => {
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.user.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.employee.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.supplier.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.product.findMany.mockResolvedValue([]);

    await expect(requestPurchaseReceipt({
      branchId: "branch-1",
      requestedById: "user-1",
      employeeId: "emp-1",
      supplierId: "supplier-1",
      folio: "FAC-201",
      reason: "Resurtido",
      items: [{ productId: "product-disabled", quantity: 5, unitCost: 20 }],
    })).rejects.toThrow("PURCHASE_PRODUCT_INVALID");
    expect(requestAuthorization).not.toHaveBeenCalled();
  });

  it("revalidates branch product assignment during approved purchase execution", async () => {
    canApproveAuthorization.mockResolvedValue(true);
    const requestedAt = new Date("2026-09-15T10:00:00.000Z");
    const authorization = {
      id: "auth-branch-product",
      status: "APPROVED",
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "requester-1",
      type: "OTHER",
      entityType: "Purchase",
      entityId: "purchase-1",
      reason: "Resurtido",
      beforeData: null,
      integrityHash: "test-integrity-hash",
      requestedAt,
      resolvedAt: new Date("2026-09-15T11:00:00.000Z"),
      requestedData: {
        purchaseId: "purchase-1",
        branchId: "branch-1",
        supplierId: "supplier-1",
        folio: "FAC-202",
        employeeId: "emp-1",
        purchasedAt: requestedAt.toISOString(),
        items: [{ productId: "product-1", quantity: 2, unitCost: 20 }],
      },
    };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);

    const txProductFindMany = vi.fn().mockResolvedValue([]);
    const tx = {
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) },
      authorizationApproval: { findFirst: vi.fn().mockResolvedValue({ id: "approval-1", approverId: "user-1", decision: "APPROVED", approvedAt: new Date("2026-09-15T10:30:00.000Z") }) },
      purchase: { findUnique: vi.fn().mockResolvedValue(null) },
      branch: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      supplier: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      employee: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      product: { findMany: txProductFindMany },
    };
    db.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(executeApprovedPurchaseReceipt({ requestId: authorization.id, executorId: "user-1" })).rejects.toThrow("PURCHASE_PRODUCT_INVALID");
    expect(txProductFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        branchProducts: { some: { branchId: "branch-1", isEnabled: true } },
      }),
    }));
  });
});
