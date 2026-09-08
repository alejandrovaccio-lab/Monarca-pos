export type PrintableOrderTicket = {
  orderId: string;
  requestedAt: string;
  channel: "WHATSAPP" | "PICKUP" | "OTHER";
  status: "RECEIVED" | "PREPARING" | "READY" | "PAID" | "DELIVERED" | "COMPLETED" | "CANCELLED";
  branch: { name: string; code: string };
  customer: { name: string; phone: string | null } | null;
  preparedBy: { name: string } | null;
  items: Array<{
    productName: string;
    requestedQuantity: string;
    actualQuantity: string | null;
    unitPrice: string;
  }>;
};

const WIDTH = 42;

function center(value: string) {
  const text = value.slice(0, WIDTH);
  const padding = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return `${" ".repeat(padding)}${text}`;
}

function line(char = "-") {
  return char.repeat(WIDTH);
}

function labelValue(label: string, value: string) {
  return `${label}: ${value}`.slice(0, WIDTH);
}

function itemRows(item: PrintableOrderTicket["items"][number]) {
  const rows = [item.productName.slice(0, WIDTH)];
  rows.push(`  Pedido: ${item.requestedQuantity}`.slice(0, WIDTH));
  if (item.actualQuantity !== null) rows.push(`  Preparado: ${item.actualQuantity}`.slice(0, WIDTH));
  rows.push(`  Precio: ${item.unitPrice}`.slice(0, WIDTH));
  return rows;
}

export function formatOrderTicketForThermal(ticket: PrintableOrderTicket) {
  const output: string[] = [
    center("MERCADITO ESQUINA"),
    center("De la esquina a tu mesa"),
    line("="),
    center("PEDIDO PARA PREPARAR"),
    labelValue("Pedido", ticket.orderId),
    labelValue("Fecha", ticket.requestedAt),
    labelValue("Canal", ticket.channel),
    labelValue("Estado", ticket.status),
    labelValue("Sucursal", `${ticket.branch.name} ${ticket.branch.code}`),
  ];

  if (ticket.customer) {
    output.push(labelValue("Cliente", ticket.customer.name));
    if (ticket.customer.phone) output.push(labelValue("Tel", ticket.customer.phone));
  }
  if (ticket.preparedBy) output.push(labelValue("Preparado por", ticket.preparedBy.name));

  output.push(line(), "PRODUCTOS");
  for (const item of ticket.items) output.push(...itemRows(item));
  output.push(line(), center("Verificar peso/cantidad antes de entregar"));
  return output.join("\n");
}
