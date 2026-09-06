import { receiveOrder, type OrderIntakeInput } from "../core/order-intake";

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "ORDER_ERROR";
  const status = ["BRANCH_NOT_FOUND", "ACTOR_NOT_AUTHORIZED", "CUSTOMER_INVALID", "PRODUCT_NOT_AVAILABLE", "PRODUCT_NOT_AVAILABLE_AT_BRANCH", "CUSTOMER_PHONE_DUPLICATE"].includes(message) ? 404 : 400;
  return { status, body: { error: message } };
}

export async function postOrderIntake(input: OrderIntakeInput) {
  try {
    return { status: 201, body: await receiveOrder(input) };
  } catch (error) {
    return mapError(error);
  }
}
