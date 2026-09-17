import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("InventoryBalance non-negative database invariant", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "prisma/migrations/0016_v1_0_15_inventory_balance_non_negative/migration.sql"),
    "utf8",
  );

  it("rejects negative inventory balances", () => {
    expect(migration).toContain('IF NEW."quantity" < 0');
    expect(migration).toContain("INVENTORY_BALANCE_NEGATIVE_FORBIDDEN");
  });

  it("protects both inserts and updates at database level", () => {
    expect(migration).toContain("CREATE TRIGGER inventory_balance_non_negative");
    expect(migration).toContain("BEFORE INSERT OR UPDATE ON \"InventoryBalance\"");
  });

  it("does not introduce delete protection that would alter the existing balance lifecycle", () => {
    expect(migration).not.toContain("BEFORE DELETE");
    expect(migration).not.toContain("BEFORE INSERT OR UPDATE OR DELETE");
  });
});
