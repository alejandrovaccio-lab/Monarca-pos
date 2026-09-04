import { prisma } from "../lib/prisma";

export async function getInventoryByProduct(input: {
  branchId: string;
  productId: string;
}) {
  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true, organizationId: true, name: true, code: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, organizationId: true, sku: true, name: true, barcode: true, status: true },
  });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (product.organizationId !== branch.organizationId) throw new Error("PRODUCT_BRANCH_INVALID");

  const balance = await prisma.inventoryBalance.findUnique({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    select: { quantity: true, updatedAt: true },
  });

  return {
    branch,
    product,
    quantity: Number(balance?.quantity ?? 0),
    updatedAt: balance?.updatedAt ?? null,
  };
}

export async function listInventory(input: {
  branchId: string;
  search?: string;
  limit?: number;
}) {
  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true, organizationId: true, name: true, code: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");

  const search = input.search?.trim();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const products = await prisma.product.findMany({
    where: {
      organizationId: branch.organizationId,
      status: "ACTIVE",
      ...(search
        ? { OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
            { barcode: { contains: search, mode: "insensitive" } },
          ] }
        : {}),
    },
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true,
      sku: true,
      name: true,
      barcode: true,
      unitOfMeasure: { select: { code: true, name: true, symbol: true } },
      inventory: {
        where: { branchId: input.branchId },
        select: { quantity: true, updatedAt: true },
      },
    },
  });

  return products.map((product) => ({
    ...product,
    quantity: Number(product.inventory[0]?.quantity ?? 0),
    updatedAt: product.inventory[0]?.updatedAt ?? null,
    inventory: undefined,
  }));
}

export async function listInventoryMovements(input: {
  branchId: string;
  productId?: string;
  limit?: number;
}) {
  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true, organizationId: true },
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

  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  return prisma.inventoryMovement.findMany({
    where: {
      branchId: input.branchId,
      ...(input.productId ? { productId: input.productId } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: {
      product: { select: { id: true, sku: true, name: true } },
      employee: { select: { id: true, employeeNumber: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
