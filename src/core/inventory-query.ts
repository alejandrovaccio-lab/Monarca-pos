import { prisma } from "../lib/prisma";

async function branchContext(branchId: string) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, organizationId: true, name: true, code: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  return branch;
}

async function ensureProductInBranch(branchId: string, productId: string, organizationId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, organizationId: true, sku: true, name: true, barcode: true, status: true },
  });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (product.organizationId !== organizationId) throw new Error("PRODUCT_BRANCH_INVALID");

  const assignment = await prisma.branchProduct.findUnique({
    where: { branchId_productId: { branchId, productId } },
    select: { isEnabled: true },
  });
  if (!assignment?.isEnabled) throw new Error("PRODUCT_BRANCH_INVALID");
  return product;
}

export async function getInventoryByProduct(input: { branchId: string; productId: string }) {
  const branch = await branchContext(input.branchId);
  const product = await ensureProductInBranch(input.branchId, input.productId, branch.organizationId);
  const balance = await prisma.inventoryBalance.findUnique({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    select: { quantity: true, updatedAt: true },
  });
  return { branch, product, quantity: Number(balance?.quantity ?? 0), updatedAt: balance?.updatedAt ?? null };
}

export async function listInventory(input: { branchId: string; search?: string; limit?: number }) {
  const branch = await branchContext(input.branchId);
  const search = input.search?.trim();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const products = await prisma.product.findMany({
    where: {
      organizationId: branch.organizationId,
      status: "ACTIVE",
      branchProducts: { some: { branchId: input.branchId, isEnabled: true } },
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ] } : {}),
    },
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true, sku: true, name: true, barcode: true,
      unitOfMeasure: { select: { code: true, name: true, symbol: true } },
      inventory: { where: { branchId: input.branchId }, select: { quantity: true, updatedAt: true } },
    },
  });
  return products.map((product) => ({ ...product, quantity: Number(product.inventory[0]?.quantity ?? 0), updatedAt: product.inventory[0]?.updatedAt ?? null, inventory: undefined }));
}

export async function listInventoryMovements(input: { branchId: string; productId?: string; limit?: number }) {
  const branch = await branchContext(input.branchId);
  if (input.productId) await ensureProductInBranch(input.branchId, input.productId, branch.organizationId);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  return prisma.inventoryMovement.findMany({
    where: { branchId: input.branchId, ...(input.productId ? { productId: input.productId } : {}) },
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: {
      product: { select: { id: true, sku: true, name: true } },
      employee: { select: { id: true, employeeNumber: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
