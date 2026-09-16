import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    branchProduct: { findUnique: vi.fn() },
    inventoryBalance: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn() },
  },
}));

import { prisma } from "../src/lib/prisma";
import { requestInventoryAdjustment } from "../src/core/inventory-adjustments";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({
    id: "cashier-1",
    organizationId: "org-1",
    status: "ACTIVE",
    branchAccess: [{ branchId: "branch-1" }],
  });
  db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
  db.product.findUnique.mockResolvedValue({ organizationId: "org-1" });
  db.employee.findUnique.mockResolvedValue({ organizationId: "org-1" });
  db.branchProduct.findUnique.mockResolvedValue({
    isEnabled: true,
    product: { organizationId: "org-1" },
  });
  db.inventoryBalance.findUnique.mockResolvedValue({ quantity: 10 });
  db.authorizationRequest.create.mockResolvedValue({ id: "request-1", status: "PENDING" });
});

const baseInput = {
  branchId: "branch-1",
  productId: "product-1",
  requestedById: "cashier-1",
  employeeId: "employee-1",
  reason: "Prueba de semántica de cantidades",
};

describe("inventory movement quantity semantics", () => {
  it.each([
    ["ENTRY", 5, 5, 15],
    ["EXIT", 5, -5, 5],
    ["WASTE", 5, -5, 5],
    ["SHRINKAGE", 5, -5, 5],
    ["COUNT_CORRECTION", 5, -5, 5],
  ] as const)("maps %s to the expected signed stock delta", async (type, quantity, expectedDelta, expectedResult) => {
    await requestInventoryAdjustment({ ...baseInput, type, quantity });

    expect(db.authorizationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestedData: expect.objectContaining({
          adjustmentType: type,
          quantity,
          delta: expectedDelta,
          resultingQuantity: expectedResult,
        }),
      }),
    }));
  });

  it("rejects zero quantity before creating an authorization", async () => {
    await expect(requestInventoryAdjustment({
      ...baseInput,
      type: "ENTRY",
      quantity: 0,
    })).rejects.toThrow("INVENTORY_QUANTITY_INVALID");

    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("rejects negative input quantity before creating an authorization", async () => {
    await expect(requestInventoryAdjustment({
      ...baseInput,
      type: "WASTE",
      quantity: -1,
    })).rejects.toThrow("INVENTORY_QUANTITY_INVALID");

    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });
});
