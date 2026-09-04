import {
  getInventoryByProduct,
  listInventory,
  listInventoryMovements,
} from "../core/inventory-query";
import { getInventoryReplenishment } from "../core/inventory-replenishment";

export async function getInventory(input: { branchId: string; productId: string }) {
  try {
    return { status: 200, body: await getInventoryByProduct(input) };
  } catch (error) {
    return mapInventoryQueryError(error);
  }
}

export async function getInventoryList(input: { branchId: string; search?: string; limit?: number }) {
  try {
    return { status: 200, body: await listInventory(input) };
  } catch (error) {
    return mapInventoryQueryError(error);
  }
}

export async function getInventoryMovements(input: { branchId: string; productId?: string; limit?: number }) {
  try {
    return { status: 200, body: await listInventoryMovements(input) };
  } catch (error) {
    return mapInventoryQueryError(error);
  }
}

export async function getInventoryReplenishmentQuery(input: {
  branchId: string;
  productId?: string;
  days?: number;
  limit?: number;
}) {
  try {
    return { status: 200, body: await getInventoryReplenishment(input) };
  } catch (error) {
    return mapInventoryQueryError(error);
  }
}

function mapInventoryQueryError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const statusByCode: Record<string, number> = {
    BRANCH_NOT_FOUND: 404,
    PRODUCT_NOT_FOUND: 404,
    PRODUCT_BRANCH_INVALID: 409,
  };
  return { status: statusByCode[code] ?? 500, body: { error: code } };
}
