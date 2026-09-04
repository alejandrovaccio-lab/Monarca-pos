import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    inventoryBalance: { findUnique: vi.fn(), upsert: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import {
  executeApprovedInventoryAdjustment,
  requestInventoryAdjustment,
} from "../src/core/inventory-adjustments";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("inventory adjustment authorization", () => {
  it("creates a pending request for a positive entry", async () => {
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.product.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.employee.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.inventoryBalance.findUnique.mockResolvedValue({ quantity: 10 });
    db.authorizationRequest.create.mockResolvedValue({ id: "request-1", status: "PENDING" });

    const result = await requestInventoryAdjustment({
      branchId: "branch-1",
      productId: "product-1",
      requestedById: "cashier-1",
      employeeId: "employee-1",
      type: "ENTRY",
      quantity: 5,
      reason: "Recepción omitida en sistema",
      unitCost: 20,
    });

    expect(result).toEqual({ id: "request-1", status: "PENDING" });
    expect(db.authorizationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "INVENTORY_ADJUSTMENT",
        beforeData: expect.objectContaining({ quantity: 10 }),
        requestedData: expect.objectContaining({ delta: 5, resultingQuantity: 15, employeeId: "employee-1" }),
      }),
    }));
  });

  it("rejects an adjustment that would make inventory negative", async () => {
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.product.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.employee.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.inventoryBalance.findUnique.mockResolvedValue({ quantity: 2 });

    await expect(requestInventoryAdjustment({
      branchId: "branch-1",
      productId: "product-1",
      requestedById: "cashier-1",
      employeeId: "employee-1",
      type: "WASTE",
      quantity: 3,
      reason: "Merma",
    })).rejects.toThrow("INVENTORY_NEGATIVE_NOT_ALLOWED");
  });

  it("executes an approved count correction and writes movement and audit", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "request-1",
      organizationId: "org-1",
      branchId: "branch-1",
      status: "APPROVED",
      entityType: "InventoryBalance",
      entityId: "product-1",
      reason: "Conteo físico",
      requestedData: {
        branchId: "branch-1",
        productId: "product-1",
        employeeId: "employee-1",
        adjustmentType: "COUNT_CORRECTION",
        quantity: 2,
        delta: -2,
        resultingQuantity: 8,
        unitCost: 15,
      },
    });

    const employeeFindUnique = vi.fn().mockResolvedValue({ organizationId: "org-1" });
    const balanceFindUnique = vi.fn().mockResolvedValue({ quantity: 10 });
    const upsert = vi.fn().mockResolvedValue({});
    const movement = vi.fn().mockResolvedValue({});
    const audit = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback: any) => callback({
      employee: { findUnique: employeeFindUnique },
      inventoryBalance: { findUnique: balanceFindUnique, upsert },
      inventoryMovement: { create: movement },
      auditLog: { create: audit },
    }));

    const result = await executeApprovedInventoryAdjustment({ requestId: "request-1", executorId: "manager-1" });

    expect(result).toMatchObject({ previousQuantity: 10, newQuantity: 8, delta: -2, adjustmentType: "COUNT_CORRECTION" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ quantity: 8 }),
      update: { quantity: 8 },
    }));
    expect(movement).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "ADJUSTMENT", quantity: -2, employeeId: "employee-1" }),
    }));
    expect(audit).toHaveBeenCalledOnce();
  });

  it("requires an approver to execute the approved request", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "CAJERO" } }] });
    await expect(executeApprovedInventoryAdjustment({ requestId: "request-1", executorId: "cashier-1" }))
      .rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
  });
});
