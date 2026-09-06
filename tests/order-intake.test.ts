import { beforeEach, describe, expect, it, vi } from "vitest";

const findCustomerByPhone = vi.fn();
const createCustomer = vi.fn();
const createOrder = vi.fn();

vi.mock("../src/core/customers", () => ({
  findCustomerByPhone,
  createCustomer,
  normalizeCustomerPhone: (phone?: string) => (phone ?? "").replace(/\D/g, ""),
}));
vi.mock("../src/core/orders", () => ({ createOrder }));

import { receiveOrder } from "../src/core/order-intake";

beforeEach(() => vi.clearAllMocks());

describe("order intake", () => {
  it("reuses the customer found by normalized phone", async () => {
    const customer = { id: "customer-1", name: "Alex", phone: "4491234567", membership: { code: "MON-CUSTOMER-1", status: "ACTIVE", qrPayload: "MONARCA-MEMBERSHIP:customer-1" } };
    findCustomerByPhone.mockResolvedValue(customer);
    createOrder.mockResolvedValue({ id: "order-1", status: "RECEIVED", total: "20.00" });

    const result = await receiveOrder({
      branchId: "branch-1",
      actorId: "user-1",
      channel: "WHATSAPP",
      customer: { phone: "+52 (449) 123-4567" },
      items: [{ productId: "product-1", quantity: 2 }],
    });

    expect(result.customerCreated).toBe(false);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-1", actorId: "user-1", channel: "WHATSAPP" }));
  });

  it("creates a customer when the phone is new", async () => {
    findCustomerByPhone.mockResolvedValue(null);
    const customer = { id: "customer-2", name: "María", phone: "4497654321", membership: { code: "MON-CUSTOMER-2", status: "ACTIVE", qrPayload: "MONARCA-MEMBERSHIP:customer-2" } };
    createCustomer.mockResolvedValue(customer);
    createOrder.mockResolvedValue({ id: "order-2", status: "RECEIVED", total: "35.00" });

    const result = await receiveOrder({
      branchId: "branch-1",
      actorId: "user-1",
      channel: "PICKUP",
      customer: { phone: "449-765-4321", name: "María" },
      items: [{ productId: "product-2", quantity: "1.5" }],
    });

    expect(result.customerCreated).toBe(true);
    expect(createCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: "María", phone: "4497654321" }));
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-2", channel: "PICKUP" }));
  });

  it("requires a customer name only when the phone is not registered", async () => {
    findCustomerByPhone.mockResolvedValue(null);
    await expect(receiveOrder({ branchId: "branch-1", actorId: "user-1", channel: "WHATSAPP", customer: { phone: "4490000000" }, items: [{ productId: "product-1", quantity: 1 }] })).rejects.toThrow("CUSTOMER_NAME_REQUIRED");
    expect(createOrder).not.toHaveBeenCalled();
  });
});
