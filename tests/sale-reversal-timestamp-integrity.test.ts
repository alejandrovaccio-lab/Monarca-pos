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

describe("sale reversal timestamp integrity", () => {
  it("uses one execution timestamp for inventory movements and the audit entry", async () => {
    const request = {
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

    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue(request);

    const movementCreate = vi.fn().mockResolvedValue({ id: "movement-1" });
    const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });

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
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(request) },
      branchProduct: { findMany: vi.fn().mockResolvedValue([{ productId: "product-1" }]) },
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sale-1",
          branchId: "branch-1",
          status: "COMPLETED",
          items: [{ id: "item-1", productId: "product-1", quantity: 2, costSnapshot: 10 }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: movementCreate },
      auditLog: { create: auditCreate },
    }));

    await executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" });

    expect(movementCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();

    const movementExecutedAt = movementCreate.mock.calls[0][0].data.occurredAt;
    const auditExecutedAt = auditCreate.mock.calls[0][0].data.occurredAt;
    const auditAfterExecutedAt = auditCreate.mock.calls[0][0].data.afterData.executedAt;

    expect(movementExecutedAt).toBeInstanceOf(Date);
    expect(auditExecutedAt).toBe(movementExecutedAt);
    expect(auditAfterExecutedAt).toBe(movementExecutedAt);
  });
});
