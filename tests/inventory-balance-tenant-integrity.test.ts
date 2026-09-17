import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("InventoryBalance tenant integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/0017_v1_0_16_inventory_balance_tenant_integrity/migration.sql",
    ),
    "utf8",
  );

  it("requires branch and product to belong to the same organization", () => {
    expect(migration).toContain('b."organizationId" = p."organizationId"');
  });

  it("validates the branch and product records during the database trigger", () => {
    expect(migration).toContain('FROM "Branch" b');
    expect(migration).toContain('JOIN "Product" p ON p."id" = NEW."productId"');
    expect(migration).toContain('WHERE b."id" = NEW."branchId"');
  });

  it("rejects cross-tenant inventory balances", () => {
    expect(migration).toContain("INVENTORY_BALANCE_TENANT_SCOPE_FORBIDDEN");
  });

  it("enforces the invariant on both insert and update", () => {
    expect(migration).toContain(
      "CREATE TRIGGER inventory_balance_tenant_integrity\nBEFORE INSERT OR UPDATE ON \"InventoryBalance\"",
    );
  });

  it("does not add a delete trigger", () => {
    expect(migration).not.toMatch(/CREATE TRIGGER[^;]+BEFORE DELETE/i);
  });
});
