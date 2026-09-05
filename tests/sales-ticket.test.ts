import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: { sale: { findUnique: vi.fn() } },
}));

import { prisma } from "../src/lib/prisma";
import { getSaleTicket } from "../src/core/sales-ticket";

const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

describe("sale ticket", () => {
  it("builds a printable ticket with folio, people, items, totals and payments", async () => {
    db.sale.findUnique.mockResolvedValue({
      id: "sale-1",
      branchId: "branch-1",
      folio: "V-TEST",
      status: "COMPLETED",
      soldAt: new Date("2026-09-05T18:30:00.000Z"),
      branch: { id: "branch-1", name: "Mercadito Esquina", code: "MEX-01", timezone: "America/Mexico_City" },
      registerSession: { id: "session-1", register: { id: "register-1", name: "Caja 1", code: "C1" } },
      cashier: { id: "cashier-1", name: "Cajero" },
      seller: { id: "seller-1", name: "Vendedor" },
      customer: { id: "customer-1", name: "Cliente", phone: "4490000000", email: "cliente@example.com", taxId: "XAXX010101000" },
      items: [{ id: "item-1", productId: "product-1", productName: "Manzana", quantity: 2, unitPrice: 10, discount: 0, taxRate: null }],
      payments: [{ id: "payment-1", method: "CASH", amount: 20 }],
    });

    const ticket = await getSaleTicket({ saleId: "sale-1", branchId: "branch-1" });

    expect(ticket.folio).toBe("V-TEST");
    expect(ticket.branch.code).toBe("MEX-01");
    expect(ticket.register.code).toBe("C1");
    expect(ticket.cashier?.name).toBe("Cajero");
    expect(ticket.seller?.name).toBe("Vendedor");
    expect(ticket.items[0]).toEqual(expect.objectContaining({ productName: "Manzana", quantity: "2", unitPrice: "10.00", lineTotal: "20.00" }));
    expect(ticket.totals).toEqual({ subtotal: "20.00", tax: "0.00", total: "20.00" });
    expect(ticket.payments).toEqual([{ id: "payment-1", method: "CASH", amount: "20.00" }]);
  });

  it("prevents reading a sale from another branch", async () => {
    db.sale.findUnique.mockResolvedValue({ id: "sale-1", branchId: "branch-2" });
    await expect(getSaleTicket({ saleId: "sale-1", branchId: "branch-1" })).rejects.toThrow("SALE_BRANCH_INVALID");
  });
});
