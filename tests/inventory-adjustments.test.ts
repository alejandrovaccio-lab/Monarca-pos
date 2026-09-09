import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    inventoryBalance: { findUnique: vi.fn(), upsert: vi.fn() },
    inventoryMovement: { create: vi.fn(), findFirst: vi.fn() },
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

  function approvedRequest() {
    return {
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
    };
  }

  function configureExecutionMocks(existingMovement: unknown = null) {
    db.user.findUnique.mockImplementation(({ where }: any) => {
      if (where?.id === "manager-1") {
        return Promise.resolve({
          id: "manager-1",
          organizationId: "org-1",
          status: "ACTIVE",
          roles: [{ role: { name: "GERENTE" } }],
          branchAccess: [{ branchId: "branch-1" }],
        });
      }
      return Promise.resolve(null);
    });
    db.authorizationRequest.findUnique.mockResolvedValue(approvedRequest());
    const employeeFindUnique = vi.fn().mockResolvedValue({ organizationId: "org-1" });
    const balanceFindUnique = vi.fn().mockResolvedValue({ quantity: 10 });
    const upsert = vi.fn().mockResolvedValue({});
    const movement = vi.fn().mockResolvedValue({});
    const findFirst = vi.fn().mockResolvedValue(existingMovement);
    const audit = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback: any) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      employee: { findUnique: employeeFindUnique },
      inventoryBalance: { findUnique: balanceFindUnique, upsert },
      inventoryMovement: { findFirst, create: movement },
      auditLog: { create: audit },
    }));
    return { upsert, movement, findFirst, audit };
  }

  it("executes an approved count correction and writes movement and audit", async () => {
    const { upsert, movement, audit } = configureExecutionMocks();

    const result = await executeApprovedInventoryAdjustment({ requestId: "request-1", executorId: "manager-1" });

    expect(result).toMatchObject({ previousQuantity: 10, newQuantity: 8, delta: -2, adjustmentType: "COUNT_CORRECTION" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ quantity: 8 }),
      update: { quantity: 8 },
    }));
    expect(movement).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "ADJUSTMENT", quantity: -2, employeeId: "employee-1", referenceId: "request-1" }),
    }));
    expect(audit).toHaveBeenCalledOnce();
  });

  it("rejects a pending authorization before changing inventory", async () => {
    configureExecutionMocks();
    db.authorizationRequest.findUnique.mockResolvedValue({ ...approvedRequest(), status: "PENDING" });

    await expect(executeApprovedInventoryAdjustment({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_NOT_APPROVED");
  });

  it("rejects execution when the approver has no access to the authorization branch", async () => {
    configureExecutionMocks();
    db.user.findUnique.mockImplementation(({ where }: any) => {
      if (where?.id === "manager-1") {
        return Promise.resolve({
          id: "manager-1",
          organizationId: "org-1",
          status: "ACTIVE",
          roles: [{ role: { name: "GERENTE" } }],
          branchAccess: [],
        });
      }
      return Promise.resolve(null);
    });

    await expect(executeApprovedInventoryAdjustment({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
  });

  it("rejects a second execution of the same authorization", async () => {
    const { upsert, movement, audit, findFirst } = configureExecutionMocks({ id: "movement-1" });

    await expect(executeApprovedInventoryAdjustment({ requestId: "request-1", executorId: "manager-1" }))
      .rejects.toThrow("AUTHORIZATION_ALREADY_EXECUTED");

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { referenceType: "MANUAL_COUNT_CORRECTION", referenceId: "request-1" },
    }));
    expect(upsert).not.toHaveBeenCalled();
    expect(movement).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("requires an approver to execute the approved request", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "cashier-1",
      organizationId: "org-1",
      status: "ACTIVE",
      roles: [{ role: { name: "CAJERO" } }],
      branchAccess: [{ branchId: "branch-1" }],
    });
    await expect(executeApprovedInventoryAdjustment({ requestId: "request-1", executorId: "cashier-1" }))
      .rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
  });
});
