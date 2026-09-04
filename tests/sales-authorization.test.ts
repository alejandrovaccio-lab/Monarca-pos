import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    sale: { findUnique: vi.fn(), update: vi.fn() },
    branch: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (callback: any) => callback({
      sale: {
        findUnique: vi.fn().mockResolvedValue({ id: "sale-1", branchId: "branch-1", status: "COMPLETED", items: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    })),
  },
}));

import { prisma } from "../src/lib/prisma";
import { executeApprovedSaleChange, requestSaleChange } from "../src/core/sales";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("sale authorization enforcement", () => {
  it("creates a cancellation request instead of changing the sale", async () => {
    db.sale.findUnique.mockResolvedValue({ id: "sale-1", branchId: "branch-1", status: "COMPLETED" });
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.authorizationRequest.create.mockResolvedValue({ id: "request-1", status: "PENDING" });

    const result = await requestSaleChange({ saleId: "sale-1", requestedById: "cashier-1", type: "SALE_CANCEL", reason: "Cliente solicita cancelación" });

    expect(result.status).toBe("PENDING");
    expect(db.sale.update).not.toHaveBeenCalled();
    expect(db.authorizationRequest.create).toHaveBeenCalledOnce();
  });

  it("rejects a request without a reason", async () => {
    await expect(requestSaleChange({ saleId: "sale-1", requestedById: "cashier-1", type: "SALE_CANCEL", reason: "  " })).rejects.toThrow("AUTHORIZATION_REASON_REQUIRED");
  });

  it("blocks execution until a manager has approved", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "request-1", status: "PENDING", entityType: "Sale", entityId: "sale-1", organizationId: "org-1", branchId: "branch-1", requestedData: { status: "CANCELLED" } });

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("executes an approved cancellation and writes an audit entry", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "request-1", status: "APPROVED", entityType: "Sale", entityId: "sale-1", organizationId: "org-1", branchId: "branch-1", requestedData: { status: "CANCELLED" } });

    const result = await executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" });

    expect(result.status).toBe("CANCELLED");
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("executes an approved refund", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "ENCARGADO_TIENDA" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "request-2", status: "APPROVED", entityType: "Sale", entityId: "sale-1", organizationId: "org-1", branchId: "branch-1", requestedData: { status: "REFUNDED" } });
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      sale: {
        findUnique: vi.fn().mockResolvedValue({ id: "sale-1", branchId: "branch-1", status: "COMPLETED", items: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-2" }) },
    }));

    const result = await executeApprovedSaleChange({ requestId: "request-2", executorId: "manager-2" });

    expect(result.status).toBe("REFUNDED");
  });
});
