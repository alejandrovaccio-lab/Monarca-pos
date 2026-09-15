import { describe, expect, it } from "vitest";
import { formatOrderTicketForThermal } from "../src/core/order-ticket-print";

describe("thermal pickup order ticket", () => {
  it("formats a 42-column preparation ticket with requested and actual quantities", () => {
    const output = formatOrderTicketForThermal({
      orderId: "ORD-001",
      requestedAt: "2026-09-05 18:30:00",
      channel: "WHATSAPP",
      status: "READY",
      branch: { name: "Mercadito Esquina", code: "MEX-01" },
      customer: { name: "Cliente", phone: "4491234567" },
      preparedBy: { name: "Colaborador" },
      items: [
        { productName: "Trocito de Puerco", requestedQuantity: "2.0000", actualQuantity: "1.7200", unitPrice: "180.00" },
        { productName: "Manzana", requestedQuantity: "1.0000", actualQuantity: null, unitPrice: "35.00" },
      ],
    });

    expect(output).toContain("MERCADITO ESQUINA");
    expect(output).toContain("De la esquina a tu mesa");
    expect(output).toContain("PEDIDO PARA PREPARAR");
    expect(output).toContain("ORD-001");
    expect(output).toContain("Cliente");
    expect(output).toContain("1.7200");
    expect(output).toContain("Pedido: 2.0000");
    expect(output).not.toContain("Preparado: 1.0000");
    expect(output.endsWith("\n")).toBe(false);
    expect(output.split("\n").every((line) => line.length <= 42)).toBe(true);
  });
});
