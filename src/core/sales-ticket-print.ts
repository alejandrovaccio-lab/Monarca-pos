export type PrintableTicket = {
  folio: string;
  date: string;
  time: string;
  branch: { name: string; code: string };
  register: { name: string; code: string };
  cashier: { name: string } | null;
  seller: { name: string } | null;
  customer: { name: string } | null;
  items: Array<{
    productName: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }>;
  totals: { subtotal: string; tax: string; total: string };
  payments: Array<{ method: string; amount: string }>;
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

function row(left: string, right: string) {
  const cleanLeft = left.slice(0, Math.max(1, WIDTH - right.length - 1));
  return `${cleanLeft}${" ".repeat(Math.max(1, WIDTH - cleanLeft.length - right.length))}${right}`;
}

function itemRows(item: PrintableTicket["items"][number]) {
  const name = item.productName.slice(0, WIDTH);
  const detail = `${item.quantity} x ${item.unitPrice}`;
  return [row(name, item.lineTotal), `  ${detail}`];
}

export function formatSaleTicketForThermal(ticket: PrintableTicket) {
  const output: string[] = [
    center("MERCADITO ESQUINA"),
    center("De la esquina a tu mesa"),
    line("="),
    center(`FOLIO ${ticket.folio}`),
    row(`${ticket.date} ${ticket.time}`, `Caja ${ticket.register.code}`),
    row(ticket.branch.name, ticket.branch.code),
    `Registro: ${ticket.register.name}`,
  ];

  if (ticket.cashier) output.push(`Cajero: ${ticket.cashier.name}`);
  if (ticket.seller) output.push(`Vendedor: ${ticket.seller.name}`);
  if (ticket.customer) output.push(`Cliente: ${ticket.customer.name}`);

  output.push(line(), row("PRODUCTO", "IMPORTE"));
  for (const item of ticket.items) output.push(...itemRows(item));

  output.push(
    line(),
    row("Subtotal", ticket.totals.subtotal),
    row("Impuestos", ticket.totals.tax),
    row("TOTAL", ticket.totals.total),
    line(),
    "FORMA DE PAGO",
  );

  for (const payment of ticket.payments) output.push(row(payment.method, payment.amount));

  output.push(line(), center("Gracias por tu compra"), "");
  return output.join("\n");
}
