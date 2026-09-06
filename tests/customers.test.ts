import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({ prisma: { branch: { findUnique: vi.fn() }, user: { findUnique: vi.fn() }, customer: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }, $transaction: vi.fn() } }));
import { prisma } from "../src/lib/prisma";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "../src/core/customers";
const db = prisma as any;
beforeEach(() => vi.clearAllMocks());
const actor = { id: "user-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] };

describe("customers and Monarca membership", () => {
  it("creates a customer with deterministic membership code and QR payload", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" }); db.user.findUnique.mockResolvedValue(actor); db.customer.findMany.mockResolvedValue([]);
    const created = { id: "11111111-1111-1111-1111-111111111111", organizationId: "org-1", name: "Ana", phone: "449 123 4567", email: "ana@example.com", taxId: "XAXX010101000", createdAt: new Date(), updatedAt: new Date() };
    db.customer.create.mockResolvedValue(created); db.customer.findUnique.mockResolvedValue(created); db.$transaction.mockImplementation(async (fn: any) => fn(db));
    const result = await createCustomer({ branchId: "branch-1", actorId: "user-1", name: "Ana", phone: "449 123 4567", email: "ANA@EXAMPLE.COM", taxId: "xaxx010101000" });
    expect(result.membership.code).toBe("MON-11111111-1111-1111-1111-111111111111"); expect(result.membership.qrPayload).toBe("MONARCA-MEMBERSHIP:11111111-1111-1111-1111-111111111111"); expect(db.auditLog.create).toHaveBeenCalled();
  });
  it("prevents duplicate customers by normalized phone", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" }); db.user.findUnique.mockResolvedValue(actor); db.customer.findMany.mockResolvedValue([{ id: "c1", phone: "449-123-4567" }]);
    await expect(createCustomer({ branchId: "branch-1", actorId: "user-1", name: "Otra", phone: "449 123 4567" })).rejects.toThrow("CUSTOMER_PHONE_DUPLICATE");
  });
  it("searches customers and exposes membership identity", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" }); db.user.findUnique.mockResolvedValue(actor); db.customer.findMany.mockResolvedValue([{ id: "c1", organizationId: "org-1", name: "Carlos", phone: "4491234567", email: null, taxId: null, createdAt: new Date(), updatedAt: new Date() }]);
    const result = await listCustomers({ branchId: "branch-1", actorId: "user-1", search: "carlos" }); expect(result).toHaveLength(1); expect(result[0].membership.status).toBe("ACTIVE");
  });
  it("returns purchase/order history for the customer", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" }); db.user.findUnique.mockResolvedValue(actor); db.customer.findUnique.mockResolvedValue({ id: "c1", organizationId: "org-1", name: "Carlos", phone: null, email: null, taxId: null, createdAt: new Date(), updatedAt: new Date(), sales: [{ id: "s1", folio: "V-1", status: "COMPLETED", soldAt: new Date() }], orders: [{ id: "o1", channel: "WHATSAPP", status: "READY", requestedAt: new Date(), createdAt: new Date(), saleId: null }] });
    const result = await getCustomer({ branchId: "branch-1", actorId: "user-1", customerId: "c1" }); expect(result.history.sales).toHaveLength(1); expect(result.history.orders).toHaveLength(1);
  });
  it("updates fiscal/contact data and audits the change", async () => {
    db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" }); db.user.findUnique.mockResolvedValue(actor); db.customer.findUnique.mockResolvedValueOnce({ id: "c1", organizationId: "org-1", name: "Carlos", phone: null, email: null, taxId: null, createdAt: new Date(), updatedAt: new Date() }); db.customer.findMany.mockResolvedValue([]); const updated = { id: "c1", organizationId: "org-1", name: "Carlos M", phone: null, email: "carlos@example.com", taxId: "RFC123", createdAt: new Date(), updatedAt: new Date() }; db.customer.update.mockResolvedValue(updated); db.$transaction.mockImplementation(async (fn: any) => fn(db));
    const result = await updateCustomer({ customerId: "c1", branchId: "branch-1", actorId: "user-1", name: "Carlos M", email: "CARLOS@EXAMPLE.COM", taxId: "rfc123" }); expect(result.email).toBe("carlos@example.com"); expect(db.auditLog.create).toHaveBeenCalled();
  });
});
