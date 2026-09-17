import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/0021_v1_0_20_product_cost_purchase_temporal_integrity/migration.sql",
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("ProductCost purchase temporal integrity", () => {
  it("only applies the temporal rule to purchase-originated costs", () => {
    expect(migration).toContain("NEW.\"source\" IS NULL OR NEW.\"source\" NOT LIKE 'PURCHASE:%'");
  });

  it("resolves the purchase reference and requires the referenced product", () => {
    expect(migration).toContain("substring(NEW.\"source\" from 10)::uuid");
    expect(migration).toContain("FROM \"Purchase\" p");
    expect(migration).toContain("JOIN \"PurchaseItem\" pi ON pi.\"purchaseId\" = p.id");
    expect(migration).toContain("pi.\"productId\" = NEW.\"productId\"");
  });

  it("rejects an invalid purchase reference target", () => {
    expect(migration).toContain("PRODUCT_COST_REFERENCE_TARGET_INVALID");
    expect(migration).toContain("IF purchase_timestamp IS NULL THEN");
  });

  it("requires ProductCost.effectiveAt to equal Purchase.purchasedAt", () => {
    expect(migration).toContain("IF NEW.\"effectiveAt\" <> purchase_timestamp THEN");
    expect(migration).toContain("PRODUCT_COST_EFFECTIVE_AT_MISMATCH");
  });

  it("enforces the invariant at database insert time", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION prevent_product_cost_purchase_temporal_violation()");
    expect(migration).toContain("CREATE TRIGGER product_cost_purchase_temporal_integrity");
    expect(migration).toContain("BEFORE INSERT ON \"ProductCost\"");
    expect(migration).toContain("EXECUTE FUNCTION prevent_product_cost_purchase_temporal_violation()");
  });

  it("does not add update or delete triggers", () => {
    expect(migration).not.toContain("BEFORE UPDATE ON \"ProductCost\"");
    expect(migration).not.toContain("BEFORE DELETE ON \"ProductCost\"");
  });
});
