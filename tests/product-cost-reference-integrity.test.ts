import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/0020_v1_0_19_product_cost_reference_integrity/migration.sql",
);

const migration = fs.readFileSync(migrationPath, "utf8");

describe("ProductCost reference target integrity", () => {
  it("uses the canonical PURCHASE:<purchase.id> provenance format", () => {
    expect(migration).toContain("NEW.\"source\" LIKE 'PURCHASE:%'");
    expect(migration).toContain("substring(NEW.\"source\" from 10)::uuid");
  });

  it("rejects malformed or missing purchase references", () => {
    expect(migration).toContain("WHEN invalid_text_representation");
    expect(migration).toContain("PRODUCT_COST_REFERENCE_TARGET_INVALID");
    expect(migration).toContain("WHERE p.id = purchase_uuid");
  });

  it("requires the purchase to contain the same product", () => {
    expect(migration).toContain("pi.\"productId\" = NEW.\"productId\"");
    expect(migration).toContain("JOIN \"PurchaseItem\" pi ON pi.\"purchaseId\" = p.id");
  });

  it("requires purchase branch and product to share the organization", () => {
    expect(migration).toContain("JOIN \"Branch\" b ON b.id = p.\"branchId\"");
    expect(migration).toContain("JOIN \"Product\" pr ON pr.id = NEW.\"productId\"");
    expect(migration).toContain('b."organizationId" = pr."organizationId"');
  });

  it("enforces the invariant at database insert time", () => {
    expect(migration).toContain("BEFORE INSERT ON \"ProductCost\"");
    expect(migration).toContain("CREATE TRIGGER product_cost_reference_target_integrity");
    expect(migration).toContain("EXECUTE FUNCTION prevent_product_cost_reference_target_violation()");
  });

  it("does not add update or delete mutation triggers", () => {
    expect(migration).not.toContain("BEFORE UPDATE ON \"ProductCost\"");
    expect(migration).not.toContain("BEFORE DELETE ON \"ProductCost\"");
  });
});
