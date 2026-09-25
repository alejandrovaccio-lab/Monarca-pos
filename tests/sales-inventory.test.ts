import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    sale: { findUnique: vi.fn(), updateMany: vi.fn() },
    inventoryBalance: { upsert: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import { executeApprovedSaleChange } from "../src/core/sales";

const db = prisma as any;

const sale = {
  id: "sale-1",
  branchId: "branch-1",
  status: "COMPLETED",
  items: [
    { id: "item-1", productId: "product-1", quantity: 2, costSnapshot: 10 },
    { id: "item-2", productId: "product-2", quantity: 0.5, costSnapshot: 20 },
  ],
};

const authorization = {
  id: "request-1",
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  status: "APPROVED",
  type: "SALE_CANCEL",
  reason: "Cliente solicita cancelación",
  entityType: "Sale",
  entityId: "sale-1",
  beforeData: { id: "sale-1", status: "COMPLETED" },
  requestedData: { id: "sale-1", status: "CANCELLED" },
  approvals: [{ id: "approval-1", approvedAt: new Date("2026-09-25T18:00:00.000Z"), decision: "APPROVED" }],
};

const executor = {
  id: "manager-1",
  organizationId: "org-1",
  status: "ACTIVE",
  roles: [{ role: { name: "GERENTE" } }],
  branchAccess: [{ branchId: "branch-1" }],
};

beforeEach(() => vi.clearAllMocks());

describe("authorized sale inventory restoration", () => {
  it("restores every sold item and records inventory movements", async () => {
    db.user.findUnique.mockResolvedValue(executor);
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const movement = vi.fn().mockResolvedValue({});
    const audit = vi.fn().mockResolvedValue({});
    const queryRaw = vi.fn().mockResolvedValue([]);
    const branchProductFindMany = vi.fn().mockResolvedValue([
      { productId: "product-1" },
      { productId: "product-2" },
    ]);
    db.$transaction.mockImplementation(async (callback: any) => callback({
      $queryRaw: queryRaw,
      user: { findUnique: vi.fn().mockResolvedValue(executor) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      branchProduct: { findMany: branchProductFindMany },
      sale: { findUnique: vi.fn().mockResolvedValue(sale), updateMany },
      inventoryBalance: { upsert },
      inventoryMovement: { create: movement },
      auditLog: { create: audit },
    }));

    const result = await executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" });

    expect(result.status).toBe("CANCELLED");
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(branchProductFindMany).toHaveBeenCalledWith({
      where: { branchId: "branch-1", productId: { in: ["product-1", "product-2"] }, isEnabled: true },
      select: { productId: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "sale-1", status: "COMPLETED" },
      data: { status: "CANCELLED" },
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(movement).toHaveBeenCalledTimes(2);
    expect(movement).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ referenceType: "SALE_CANCEL_ITEM", referenceId: "item-1" }),
    });
    expect(movement).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ referenceType: "SALE_CANCEL_ITEM", referenceId: "item-2" }),
    });
    expect(audit).toHaveBeenCalledOnce();
  });

  it("restores inventory through the approved refund path", async () => {
    const refundAuthorization = {
      ...authorization,
      type: "SALE_REFUND",
      reason: "Cliente solicita devolución",
      requestedData: { id: "sale-1", status: "REFUNDED" },
    };
    db.user.findUnique.mockResolvedValue(executor);
    db.authorizationRequest.findUnique.mockResolvedValue(refundAuthorization);

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const movement = vi.fn().mockResolvedValue({});
    const audit = vi.fn().mockResolvedValue({});
    const queryRaw = vi.fn().mockResolvedValue([]);
    const branchProductFindMany = vi.fn().mockResolvedValue([
      { productId: "product-1" },
      { productId: "product-2" },
    ]);
    db.$transaction.mockImplementation(async (callback: any) => callback({
      $queryRaw: queryRaw,
      user: { findUnique: vi.fn().mockResolvedValue(executor) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(refundAuthorization) },
      branchProduct: { findMany: branchProductFindMany },
      sale: { findUnique: vi.fn().mockResolvedValue(sale), updateMany },
      inventoryBalance: { upsert },
      inventoryMovement: { create: movement },
      auditLog: { create: audit },
    }));

    const result = await executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" });

    expect(result.status).toBe("REFUNDED");
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(branchProductFindMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "sale-1", status: "COMPLETED" },
      data: { status: "REFUNDED" },
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(movement).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        referenceType: "SALE_REFUND_ITEM",
        referenceId: "item-1",
        quantity: 2,
        unitCost: 10,
      }),
    });
    expect(movement).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        referenceType: "SALE_REFUND_ITEM",
        referenceId: "item-2",
        quantity: 0.5,
        unitCost: 20,
      }),
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "SALE_REFUNDED",
        entityType: "Sale",
        entityId: "sale-1",
      }),
    }));
  });

  it("rejects restoration when a sold product is not assigned to the branch", async () => {
    db.user.findUnique.mockResolvedValue(executor);
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn();
    const movement = vi.fn();
    const audit = vi.fn();
    const branchProductFindMany = vi.fn().mockResolvedValue([{ productId: "product-1" }]);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue(executor) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      branchProduct: { findMany: branchProductFindMany },
      sale: { findUnique: vi.fn().mockResolvedValue(sale), updateMany },
      inventoryBalance: { upsert },
      inventoryMovement: { create: movement },
      auditLog: { create: audit },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("BRANCH_PRODUCT_SCOPE_FORBIDDEN");
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(movement).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejects restoration when a sold product is disabled at the branch", async () => {
    db.user.findUnique.mockResolvedValue(executor);
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn();
    const movement = vi.fn();
    const audit = vi.fn();
    const branchProductFindMany = vi.fn().mockResolvedValue([{ productId: "product-1" }]);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue(executor) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      branchProduct: { findMany: branchProductFindMany },
      sale: { findUnique: vi.fn().mockResolvedValue(sale), updateMany },
      inventoryBalance: { upsert },
      inventoryMovement: { create: movement },
      auditLog: { create: audit },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("BRANCH_PRODUCT_SCOPE_FORBIDDEN");
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(movement).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not execute an unapproved request", async () => {
    db.user.findUnique.mockResolvedValue(executor);
    db.authorizationRequest.findUnique.mockResolvedValue({ ...authorization, status: "PENDING" });

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an authorization that changes before execution", async () => {
    db.user.findUnique.mockResolvedValue(executor);
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue(executor) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue({ ...authorization, status: "CANCELLED" }) },
      sale: { findUnique: vi.fn(), updateMany: vi.fn() },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
  });

  it("blocks execution when the sale has already changed", async () => {
    db.user.findUnique.mockResolvedValue(executor);
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue(executor) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      sale: {
        findUnique: vi.fn().mockResolvedValue(sale),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      branchProduct: { findMany: vi.fn().mockResolvedValue([{ productId: "product-1" }, { productId: "product-2" }]) },
      inventoryBalance: { upsert: vi.fn() },
      inventoryMovement: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("SALE_ALREADY_CHANGED");
  });

  it("rejects an executor from another organization", async () => {
    db.user.findUnique.mockResolvedValue({ ...executor, organizationId: "org-2" });
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue({ ...executor, organizationId: "org-2" }) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
  });

  it("rejects an executor without access to the authorization branch", async () => {
    db.user.findUnique.mockResolvedValue({ ...executor, branchAccess: [{ branchId: "branch-2" }] });
    db.authorizationRequest.findUnique.mockResolvedValue(authorization);
    db.$transaction.mockImplementationOnce(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue({ ...executor, branchAccess: [{ branchId: "branch-2" }] }) },
      authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) },
      sale: { findUnique: vi.fn(), updateMany: vi.fn() },
    }));

    await expect(executeApprovedSaleChange({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
  });
});
