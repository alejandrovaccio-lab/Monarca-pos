import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    sale: { findUnique: vi.fn(), update: vi.fn() },
    branch: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (callback: any) => callback({
      $queryRaw: vi.fn(),
      user: { findUnique: vi.fn() },
      authorizationRequest: { findUnique: vi.fn() },
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
import { authorizationIntegrityHash } from "../src/core/authorization";
import { executeApprovedSaleChange, requestSaleChange } from "../src/core/sales";

const db = prisma as any;

const approvedCancellation = () => ({
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
});

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockImplementation(({ where }: any) => {
    if (where?.id === "cashier-1") {
      return Promise.resolve({
        id: "cashier-1",
        organizationId: "org-1",
        status: "ACTIVE",
        branchAccess: [{ branchId: "branch-1" }],
      });
    }
    return Promise.resolve(null);
  });
});

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
    db.authorizationRequest.findUnique.mockResolvedValue({ ...approvedCancellation(), status: "PENDING" });

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("executes an approved cancellation and writes an audit entry", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    const request = approvedCancellation();
    db.authorizationRequest.findUnique.mockResolvedValue(request);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue({ id: "manager-1", organizationId: "org-1", status: "ACTIVE", roles: [{ role: { name: "GERENTE" } }], branchAccess: [{ branchId: "branch-1" }] }) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(request) },
      sale: {
        findUnique: vi.fn().mockResolvedValue({ id: "sale-1", branchId: "branch-1", status: "COMPLETED", items: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    }));

    const result = await executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" });

    expect(result.status).toBe("CANCELLED");
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("executes an approved refund", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "ENCARGADO_TIENDA" } }] });
    const request = {
      ...approvedCancellation(),
      id: "request-2",
      type: "SALE_REFUND",
      reason: "Cliente solicita devolución",
      requestedData: { id: "sale-1", status: "REFUNDED" },
    };
    db.authorizationRequest.findUnique.mockResolvedValue(request);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue({ id: "manager-2", organizationId: "org-1", status: "ACTIVE", roles: [{ role: { name: "ENCARGADO_TIENDA" } }], branchAccess: [{ branchId: "branch-1" }] }) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(request) },
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

  it("rejects a tampered stored integrity hash before executing the sale", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    const request = { ...approvedCancellation(), integrityHash: "0".repeat(64) };
    db.authorizationRequest.findUnique.mockResolvedValue(request);

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a changed authorization payload even when its stored hash is from the original payload", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    const original = approvedCancellation();
    const originalHash = authorizationIntegrityHash({
      organizationId: original.organizationId,
      branchId: original.branchId,
      requestedById: original.requestedById,
      type: original.type,
      reason: original.reason,
      entityType: original.entityType,
      entityId: original.entityId,
      beforeData: original.beforeData,
      requestedData: original.requestedData,
    });
    const tampered = {
      ...original,
      requestedData: { id: "sale-2", status: "CANCELLED" },
      integrityHash: originalHash,
    };
    db.authorizationRequest.findUnique.mockResolvedValue(tampered);

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization whose before-state does not match the completed sale", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    const request = { ...approvedCancellation(), beforeData: { id: "sale-1", status: "CANCELLED" } };
    db.authorizationRequest.findUnique.mockResolvedValue(request);

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_TARGET_INVALID");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when the authorization changes organization or branch inside the transaction", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    const request = approvedCancellation();
    db.authorizationRequest.findUnique.mockResolvedValue(request);
    const currentAuthorization = { ...request, organizationId: "org-2" };
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue({ id: "manager-1", organizationId: "org-1", status: "ACTIVE", roles: [{ role: { name: "GERENTE" } }], branchAccess: [{ branchId: "branch-1" }] }) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(currentAuthorization) },
      sale: { findUnique: vi.fn(), updateMany: vi.fn() },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_ENTITY_INVALID");
  });
});
