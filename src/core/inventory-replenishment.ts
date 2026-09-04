import { prisma } from "../lib/prisma";

export type InventoryReplenishmentStatus = "OUT_OF_STOCK" | "LOW" | "REORDER" | "OK" | "NO_POLICY";

export async function getInventoryReplenishment(input: {
  branchId: string;
  productId?: string;
  days?: number;
  limit?: number;
}) {
  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true, organizationId: true, name: true, code: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");

  if (input.productId) {
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { organizationId: true },
    });
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    if (product.organizationId !== branch.organizationId) throw new Error("PRODUCT_BRANCH_INVALID");
  }

  const historyDays = Math.min(Math.max(Math.floor(input.days ?? 30), 1), 90);
  const since = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);

  const [products, policies, sales] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId: branch.organizationId,
        status: "ACTIVE",
        ...(input.productId ? { id: input.productId } : {}),
      },
      orderBy: { name: "asc" },
      take: limit,
      select: {
        id: true,
        sku: true,
        name: true,
        barcode: true,
        unitOfMeasure: { select: { code: true, name: true, symbol: true } },
        inventory: { where: { branchId: input.branchId }, select: { quantity: true, updatedAt: true } },
      },
    }),
    prisma.inventoryPolicy.findMany({
      where: {
        branchId: input.branchId,
        organizationId: branch.organizationId,
        isActive: true,
        ...(input.productId ? { productId: input.productId } : {}),
      },
      select: {
        productId: true,
        minimumStock: true,
        maximumStock: true,
        reorderPoint: true,
        targetDaysCoverage: true,
        expectedWasteRate: true,
        expectedShrinkageRate: true,
      },
    }),
    prisma.sale.findMany({
      where: {
        branchId: input.branchId,
        status: "COMPLETED",
        soldAt: { gte: since },
        ...(input.productId ? { items: { some: { productId: input.productId } } } : {}),
      },
      select: { items: { select: { productId: true, quantity: true } } },
    }),
  ]);

  const policyByProduct = new Map(policies.map((policy) => [policy.productId, policy]));
  const soldByProduct = new Map<string, number>();
  for (const sale of sales) {
    for (const item of sale.items) {
      soldByProduct.set(item.productId, (soldByProduct.get(item.productId) ?? 0) + Number(item.quantity));
    }
  }

  return products.map((product) => {
    const policy = policyByProduct.get(product.id);
    const currentQuantity = Number(product.inventory[0]?.quantity ?? 0);
    const soldQuantity = soldByProduct.get(product.id) ?? 0;
    const averageDailyConsumption = soldQuantity / historyDays;
    const daysOfInventory = averageDailyConsumption > 0 ? currentQuantity / averageDailyConsumption : null;

    let status: InventoryReplenishmentStatus = "NO_POLICY";
    let suggestedReplenishment = 0;
    if (policy) {
      const minimumStock = Number(policy.minimumStock);
      const reorderPoint = Number(policy.reorderPoint);
      const maximumStock = policy.maximumStock === null ? null : Number(policy.maximumStock);
      const targetCoverage = policy.targetDaysCoverage === null ? null : Number(policy.targetDaysCoverage);

      if (currentQuantity <= 0) status = "OUT_OF_STOCK";
      else if (currentQuantity <= minimumStock) status = "LOW";
      else if (currentQuantity <= reorderPoint) status = "REORDER";
      else status = "OK";

      const targetQuantity = maximumStock !== null
        ? maximumStock
        : targetCoverage !== null
          ? averageDailyConsumption * targetCoverage
          : reorderPoint;
      suggestedReplenishment = Math.max(0, targetQuantity - currentQuantity);
    }

    return {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        barcode: product.barcode,
        unitOfMeasure: product.unitOfMeasure,
      },
      currentQuantity,
      updatedAt: product.inventory[0]?.updatedAt ?? null,
      policy: policy ? {
        minimumStock: Number(policy.minimumStock),
        maximumStock: policy.maximumStock === null ? null : Number(policy.maximumStock),
        reorderPoint: Number(policy.reorderPoint),
        targetDaysCoverage: policy.targetDaysCoverage === null ? null : Number(policy.targetDaysCoverage),
        expectedWasteRate: Number(policy.expectedWasteRate),
        expectedShrinkageRate: Number(policy.expectedShrinkageRate),
      } : null,
      salesWindowDays: historyDays,
      soldQuantity: Number(soldQuantity.toFixed(4)),
      averageDailyConsumption: Number(averageDailyConsumption.toFixed(4)),
      daysOfInventory: daysOfInventory === null ? null : Number(daysOfInventory.toFixed(2)),
      status,
      suggestedReplenishment: Number(suggestedReplenishment.toFixed(4)),
    };
  });
}
