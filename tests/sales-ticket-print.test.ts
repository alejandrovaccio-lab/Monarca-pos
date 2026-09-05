import { describe, expect, it } from "vitest";
import { formatSaleTicketForThermal } from "../src/core/sales-ticket-print";

describe("thermal sale ticket", () => {
  it("formats a 42-column ticket with identity, sale data, totals and payments", () => {
    const output = formatSaleTicketForThermal({
      folio: "V-20260905-TEST",
      date: "2026-09-05",
      time: "18:30:00",
      branch: { name: "Mercadito Esquina", code: "MEX-01" },
      register: { name: "Caja 1", code: "C1" },
      cashier: { name: "Cajero" },
      seller: { name: "Vendedor" },
      customer: { name: "Cliente" },
      items: [{ productName: "Manzana", quantity: "2", unitPrice: "10.00", lineTotal: "20.00" }],
      totals: { subtotal: "20.00", tax: "0.00", total: "20.00" },
      payments: [{ method: "CASH", amount: "20.00" }],
    });

    expect(output).toContain("MERCADITO ESQUINA");
    expect(output).toContain("De la esquina a tu mesa");
    expect(output).toContain("V-20260905-TEST");
    expect(output).toContain("Manzana");
    expect(output).toContain("2 x 10.00");
    expect(output).toContain("TOTAL");
    expect(output).toContain("20.00");
    expect(output).toContain("CASH");
    expect(output.endsWith("\n")).toBe(false);
    expect(output.split("\n").every((line) => line.length <= 42)).toBe(true);
  });

  it("omits optional people when they are not present", () => {
    const output = formatSaleTicketForThermal({
      folio: "V-TEST",
      date: "2026-09-05",
      time: "18:30:00",
      branch: { name: "Mercadito Esquina", code: "MEX-01" },
      register: { name: "Caja 1", code: "C1" },
      cashier: null,
      seller: null,
      customer: null,
      items: [],
      totals: { subtotal: "0.00", tax: "0.00", total: "0.00" },
      payments: [],
    });

    expect(output).not.toContain("Cajero:");
    expect(output).not.toContain("Vendedor:");
    expect(output).not.toContain("Cliente:");
  });
});
