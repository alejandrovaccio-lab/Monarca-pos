import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ProductCost value integrity migration", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "prisma/migrations/0019_v1_0_18_product_cost_value_integrity/migration.sql"),
    "utf8",
  );

  it("rejects negative ProductCost values", () => {
    expect(migration).toContain('IF NEW."cost" < 0 THEN');
    expect(migration).toContain("PRODUCT_COST_NEGATIVE_FORBIDDEN");
  });

  it("keeps zero cost valid", () => {
    expect(migration).toContain("IF NEW.\"cost\" < 0 THEN");
    expect(migration).not.toContain("IF NEW.\"cost\" <= 0 THEN");
  });

  it("enforces the invariant at database level before insert", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION prevent_product_cost_negative_violation()");
    expect(migration).toContain("CREATE TRIGGER product_cost_value_integrity");
    expect(migration).toContain("BEFORE INSERT ON \"ProductCost\"");
    expect(migration).toContain("EXECUTE FUNCTION prevent_product_cost_negative_violation()");
  });

  it("does not add update or delete triggers, preserving the separate immutability layer", () => {
    expect(migration).not.toContain("BEFORE UPDATE ON \"ProductCost\"");
    expect(migration).not.toContain("BEFORE DELETE ON \"ProductCost\"");
  });
});
