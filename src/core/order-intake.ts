import { createCustomer, findCustomerByPhone, normalizeCustomerPhone } from "./customers";
import { createOrder, type OrderChannelInput, type OrderItemInput } from "./orders";

export type OrderIntakeInput = {
  branchId: string;
  actorId: string;
  channel: OrderChannelInput;
  customer: {
    phone: string;
    name?: string;
    email?: string;
  };
  requestedAt?: string | Date;
  items: OrderItemInput[];
};

export async function receiveOrder(input: OrderIntakeInput) {
  const phone = normalizeCustomerPhone(input.customer.phone);
  if (!phone) throw new Error("CUSTOMER_PHONE_REQUIRED");
  if (!input.items.length) throw new Error("ORDER_CONTEXT_REQUIRED");

  let customer = await findCustomerByPhone({ branchId: input.branchId, actorId: input.actorId, phone });
  let customerCreated = false;

  if (!customer) {
    if (!input.customer.name?.trim()) throw new Error("CUSTOMER_NAME_REQUIRED");
    customer = await createCustomer({
      branchId: input.branchId,
      actorId: input.actorId,
      name: input.customer.name,
      phone,
      email: input.customer.email,
    });
    customerCreated = true;
  }

  const order = await createOrder({
    branchId: input.branchId,
    customerId: customer.id,
    channel: input.channel,
    requestedAt: input.requestedAt,
    items: input.items,
    actorId: input.actorId,
  });

  return {
    customer,
    customerCreated,
    membership: customer.membership,
    order,
    nextStatus: "RECEIVED" as const,
  };
}
