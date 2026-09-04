import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    product: { findUnique: vi.fn(), findMany: vi.fn() },
    inventoryBalance: { findUnique: vi.fn() },
    inventoryMovement: { findMany: vi.fn() },
    inventoryPolicy: { findMany: vi.fn() },
    sale: { findMany: vi.fn() },
  },
}));

import { prisma } from "../src/lib/prisma";
import { getInventoryByProduct, listInventory, listInventoryMovements } from "../src/core/inventory-query";
import { getInventoryReplenishment } from "../src/core/inventory-replenishment";

const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

describe("inventory query", () => {
  it("returns current quantity for a product in a branch", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1", name: "Sucursal Centro", code: "CENTRO" });
    db.product.findUnique.mockResolvedValue({ id: "product-1", organizationId: "org-1", sku: "FRU-001", name: "Manzana", barcode: "123", status: "ACTIVE" });
    db.inventoryBalance.findUnique.mockResolvedValue({ quantity: 12.5, updatedAt: new Date("2026-09-01T10:00:00Z") });

    const result = await getInventoryByProduct({ branchId: "branch-1", productId: "product-1" });
    expect(result.quantity).toBe(12.5);
    expect(result.product.sku).toBe("FRU-001");
  });

  it("lists active products with branch stock and supports search", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1", name: "Centro", code: "CEN" });
    db.product.findMany.mockResolvedValue([
      {
        id: "product-1", sku: "AB-001", name: "Arroz", barcode: "789",
        unitOfMeasure: { code: "KG", name: "Kilogramo", symbol: "kg" },
        inventory: [{ quantity: 8, updatedAt: new Date("2026-09-01T10:00:00Z") }],
      },
    ]);

    const result = await listInventory({ branchId: "branch-1", search: "arroz" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Arroz", quantity: 8 });
    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it("lists movements with product, collaborator and employee context", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
    db.product.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.inventoryMovement.findMany.mockResolvedValue([
      {
        id: "movement-1", type: "WASTE", quantity: -2,
        product: { id: "product-1", sku: "VER-001", name: "Tomate" },
        employee: { id: "employee-1", employeeNumber: "E001", name: "Colaborador" },
        user: { id: "manager-1", name: "Gerente", email: "gerente@example.com" },
      },
    ]);

    const result = await listInventoryMovements({ branchId: "branch-1", productId: "product-1" });
    expect(result[0]).toMatchObject({ type: "WASTE", quantity: -2 });
    expect(result[0].employee.employeeNumber).toBe("E001");
    expect(result[0].user.name).toBe("Gerente");
  });

  it("calculates average daily consumption, days of inventory and replenishment suggestion", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1", name: "Centro", code: "CEN" });
    db.product.findMany.mockResolvedValue([
      {
        id: "product-1", sku: "AB-001", name: "Arroz", barcode: "789",
        unitOfMeasure: { code: "KG", name: "Kilogramo", symbol: "kg" },
        inventory: [{ quantity: 8, updatedAt: new Date("2026-09-01T10:00:00Z") }],
      },
    ]);
    db.inventoryPolicy.findMany.mockResolvedValue([
      {
        productId: "product-1", minimumStock: 5, maximumStock: 20, reorderPoint: 10,
        targetDaysCoverage: 7, expectedWasteRate: 0, expectedShrinkageRate: 0,
      },
    ]);
    db.sale.findMany.mockResolvedValue([
      { items: [{ productId: "product-1", quantity: 30 }] },
    ]);

    const result = await getInventoryReplenishment({ branchId: "branch-1", days: 30 });
    expect(result[0]).toMatchObject({
      currentQuantity: 8,
      soldQuantity: 30,
      averageDailyConsumption: 1,
      daysOfInventory: 8,
      status: "REORDER",
      suggestedReplenishment: 12,
    });
  });

  it("reports products without an inventory policy without inventing a replenishment amount", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1", name: "Centro", code: "CEN" });
    db.product.findMany.mockResolvedValue([
      {
        id: "product-2", sku: "AB-002", name: "Frijol", barcode: "790",
        unitOfMeasure: { code: "KG", name: "Kilogramo", symbol: "kg" },
        inventory: [{ quantity: 4, updatedAt: null }],
      },
    ]);
    db.inventoryPolicy.findMany.mockResolvedValue([]);
    db.sale.findMany.mockResolvedValue([]);

    const result = await getInventoryReplenishment({ branchId: "branch-1" });
    expect(result[0]).toMatchObject({ status: "NO_POLICY", suggestedReplenishment: 0, policy: null });
  });
});
