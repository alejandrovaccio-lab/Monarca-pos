import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import { executeApprovedSaleChange } from "../src/core/sales";

const db = prisma as any;

const approvedCancellation = {
  id: "request-1",
  status: "APPROVED",
  type: "SALE_CANCEL",
  entityType: "Sale",
  entityId: "sale-1",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  reason: "Cliente solicita cancelación",
  beforeData: { id: "sale-1", status: "COMPLETED" },
  requestedData: { id: "sale-1", status: "CANCELLED" },
  integrityHash: undefined,
  approvals: [{ id: "approval-1", approvedAt: new Date("2026-09-25T18:00:00.000Z"), decision: "APPROVED" }],
};

describe("sale reversal replay protection", () => {
  it("rejects re-execution after the sale has already changed", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue(approvedCancellation);

    const saleUpdateMany = vi.fn();
    const inventoryUpsert = vi.fn();
    const movementCreate = vi.fn();
    const auditCreate = vi.fn();

    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn(),
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "manager-1",
          organizationId: "org-1",
          status: "ACTIVE",
          roles: [{ role: { name: "GERENTE" } }],
          branchAccess: [{ branchId: "branch-1" }],
        }),
      },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(approvedCancellation) },
      branchProduct: { findMany: vi.fn().mockResolvedValue([{ productId: "product-1" }]) },
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sale-1",
          branchId: "branch-1",
          status: "CANCELLED",
          items: [{ id: "item-1", productId: "product-1", quantity: 2, costSnapshot: 10 }],
        }),
        updateMany: saleUpdateMany,
      },
      inventoryBalance: { upsert: inventoryUpsert },
      inventoryMovement: { create: movementCreate },
      auditLog: { create: auditCreate },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");

    expect(saleUpdateMany).not.toHaveBeenCalled();
    expect(inventoryUpsert).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("does not create a second audit or inventory trace for an already reversed sale", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue(approvedCancellation);

    const movementCreate = vi.fn();
    const auditCreate = vi.fn();
    const saleFindUnique = vi.fn().mockResolvedValue({
      id: "sale-1",
      branchId: "branch-1",
      status: "REFUNDED",
      items: [{ id: "item-1", productId: "product-1", quantity: 2, costSnapshot: 10 }],
    });

    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn(),
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "manager-1",
          organizationId: "org-1",
          status: "ACTIVE",
          roles: [{ role: { name: "GERENTE" } }],
          branchAccess: [{ branchId: "branch-1" }],
        }),
      },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(approvedCancellation) },
      branchProduct: { findMany: vi.fn().mockResolvedValue([{ productId: "product-1" }]) },
      sale: { findUnique: saleFindUnique, updateMany: vi.fn() },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: movementCreate },
      auditLog: { create: auditCreate },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_TARGET_INVALID");

    expect(saleFindUnique).toHaveBeenCalledOnce();
    expect(movementCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
