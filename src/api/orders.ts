import { createOrder, listOrders, transitionOrder, attachSaleToOrder, type OrderChannelInput, type OrderStatusInput } from "../core/orders";

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "ORDER_ERROR";
  const status = [
    "BRANCH_NOT_FOUND",
    "CUSTOMER_INVALID",
    "PRODUCT_NOT_AVAILABLE",
    "PRODUCT_NOT_AVAILABLE_AT_BRANCH",
    "PRICE_NOT_CONFIGURED",
    "PREPARER_NOT_AUTHORIZED",
    "SALE_INVALID",
    "ORDER_NOT_FOUND",
  ].includes(message) ? 404 : 400;
  return { status, body: { error: message } };
}

export async function postCreateOrder(input: {
  branchId: string;
  customerId?: string;
  channel: OrderChannelInput;
  requestedAt?: string;
  items: Array<{ productId: string; quantity: number | string }>;
}) {
  try {
    return { status: 201, body: await createOrder(input) };
  } catch (error) {
    return mapError(error);
  }
}

export async function getOrders(input: { branchId: string; status?: OrderStatusInput; limit?: number }) {
  try {
    return { status: 200, body: { orders: await listOrders(input) } };
  } catch (error) {
    return mapError(error);
  }
}

export async function postOrderStatus(input: {
  branchId: string;
  orderId: string;
  status: OrderStatusInput;
  preparedById?: string;
}) {
  try {
    return { status: 200, body: await transitionOrder(input) };
  } catch (error) {
    return mapError(error);
  }
}

export async function postOrderSaleLink(input: { branchId: string; orderId: string; saleId: string }) {
  try {
    return { status: 200, body: await attachSaleToOrder(input) };
  } catch (error) {
    return mapError(error);
  }
}
