import { createCustomer, getCustomer, listCustomers, updateCustomer } from "../core/customers";

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : "CUSTOMER_ERROR";
  const notFound = ["BRANCH_NOT_FOUND", "CUSTOMER_NOT_FOUND"].includes(message);
  const status = notFound ? 404 : message === "ACTOR_NOT_AUTHORIZED" ? 401 : 400;
  return { status, body: { error: message } };
}

export async function postCreateCustomer(input: Parameters<typeof createCustomer>[0]) {
  try { return { status: 201, body: await createCustomer(input) }; } catch (error) { return mapError(error); }
}

export async function getCustomers(input: Parameters<typeof listCustomers>[0]) {
  try { return { status: 200, body: { customers: await listCustomers(input) } }; } catch (error) { return mapError(error); }
}

export async function getCustomerQuery(input: Parameters<typeof getCustomer>[0]) {
  try { return { status: 200, body: await getCustomer(input) }; } catch (error) { return mapError(error); }
}

export async function patchCustomer(input: Parameters<typeof updateCustomer>[0]) {
  try { return { status: 200, body: await updateCustomer(input) }; } catch (error) { return mapError(error); }
}
