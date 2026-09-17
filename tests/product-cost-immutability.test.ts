import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ProductCost immutability", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "prisma/migrations/0018_v1_0_17_product_cost_immutability/migration.sql"),
    "utf8",
  );

  it("rejects ProductCost UPDATE mutations", () => {
    expect(migration).toContain('BEFORE UPDATE ON "ProductCost"');
    expect(migration).toContain("PRODUCT_COST_IMMUTABLE");
  });

  it("rejects ProductCost DELETE mutations", () => {
    expect(migration).toContain('BEFORE DELETE ON "ProductCost"');
    expect(migration).toContain("product_cost_immutable_delete");
  });

  it("uses database triggers for both mutation barriers", () => {
    expect(migration).toContain("CREATE TRIGGER product_cost_immutable_update");
    expect(migration).toContain("CREATE TRIGGER product_cost_immutable_delete");
    expect(migration).toContain("EXECUTE FUNCTION prevent_product_cost_mutation()");
  });

  it("does not block INSERT, preserving append-only cost history", () => {
    expect(migration).not.toContain("BEFORE INSERT ON \"ProductCost\"");
    expect(migration).not.toContain("AFTER INSERT ON \"ProductCost\"");
  });
});
