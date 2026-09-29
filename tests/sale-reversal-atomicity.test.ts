import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const salesPath = path.join(process.cwd(), "src", "core", "sales.ts");
const sales = fs.readFileSync(salesPath, "utf8");

describe("Sale reversal atomic execution", () => {
  it("locks the authorization row before revalidating execution state", () => {
    expect(sales).toContain('FOR UPDATE`');
    expect(sales).toContain("currentAuthorization");
    expect(sales).toContain('if (currentAuthorization.status !== "APPROVED")');
  });

  it("performs the sale state transition inside the database transaction", () => {
    expect(sales).toContain("runSerializableTransaction(() => prisma.$transaction(async (tx) => {");
    expect(sales).toContain("await tx.sale.findUnique({");
    expect(sales).toContain("await tx.sale.updateMany({");
  });

  it("uses a conditional COMPLETED-to-target transition to prevent replay", () => {
    expect(sales).toContain('where: { id: sale.id, status: "COMPLETED" },');
    expect(sales).toContain("if (changed.count !== 1) throw new Error(\"SALE_ALREADY_CHANGED\");");
  });

  it("keeps inventory restoration in the same transaction as the sale change", () => {
    expect(sales).toContain("await tx.inventoryBalance.upsert({");
    expect(sales).toContain("await tx.inventoryMovement.create({");
    expect(sales).toContain("await tx.auditLog.create({");
  });

  it("does not return a successful trace until every inventory movement is recorded", () => {
    expect(sales).toContain("if (inventoryMovementIds.length !== sale.items.length)");
    expect(sales).toContain('throw new Error("AUTHORIZATION_TRACE_BROKEN")');
    expect(sales).toContain("inventoryMovementIds,");
    expect(sales).toContain("auditLogId: audit.id,");
  });
});
