import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCustomerByPhone: vi.fn(),
  createCustomer: vi.fn(),
  createOrder: vi.fn(),
}));

vi.mock("../src/core/customers", () => ({
  findCustomerByPhone: mocks.findCustomerByPhone,
  createCustomer: mocks.createCustomer,
  normalizeCustomerPhone: (phone?: string) => (phone ?? "").replace(/\D/g, ""),
}));
vi.mock("../src/core/orders", () => ({ createOrder: mocks.createOrder }));

import { receiveOrder } from "../src/core/order-intake";

beforeEach(() => vi.clearAllMocks());

describe("order intake", () => {
  it("reuses the customer found by normalized phone", async () => {
    const customer = { id: "customer-1", name: "Alex", phone: "4491234567", membership: { code: "MON-CUSTOMER-1", status: "ACTIVE", qrPayload: "MONARCA-MEMBERSHIP:customer-1" } };
    mocks.findCustomerByPhone.mockResolvedValue(customer);
    mocks.createOrder.mockResolvedValue({ id: "order-1", status: "RECEIVED", total: "20.00" });

    const result = await receiveOrder({
      branchId: "branch-1",
      actorId: "user-1",
      channel: "WHATSAPP",
      customer: { phone: "+52 (449) 123-4567" },
      items: [{ productId: "product-1", quantity: 2 }],
    });

    expect(result.customerCreated).toBe(false);
    expect(mocks.createCustomer).not.toHaveBeenCalled();
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-1", actorId: "user-1", channel: "WHATSAPP" }));
  });

  it("creates a customer when the phone is new", async () => {
    mocks.findCustomerByPhone.mockResolvedValue(null);
    const customer = { id: "customer-2", name: "María", phone: "4497654321", membership: { code: "MON-CUSTOMER-2", status: "ACTIVE", qrPayload: "MONARCA-MEMBERSHIP:customer-2" } };
    mocks.createCustomer.mockResolvedValue(customer);
    mocks.createOrder.mockResolvedValue({ id: "order-2", status: "RECEIVED", total: "35.00" });

    const result = await receiveOrder({
      branchId: "branch-1",
      actorId: "user-1",
      channel: "PICKUP",
      customer: { phone: "449-765-4321", name: "María" },
      items: [{ productId: "product-2", quantity: "1.5" }],
    });

    expect(result.customerCreated).toBe(true);
    expect(mocks.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: "María", phone: "4497654321" }));
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-2", channel: "PICKUP" }));
  });

  it("requires a customer name only when the phone is not registered", async () => {
    mocks.findCustomerByPhone.mockResolvedValue(null);
    await expect(receiveOrder({ branchId: "branch-1", actorId: "user-1", channel: "WHATSAPP", customer: { phone: "4490000000" }, items: [{ productId: "product-1", quantity: 1 }] })).rejects.toThrow("CUSTOMER_NAME_REQUIRED");
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
});
