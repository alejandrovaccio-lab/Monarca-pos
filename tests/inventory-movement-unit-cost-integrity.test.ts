import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/0015_v1_0_14_inventory_movement_unit_cost_integrity/migration.sql"
  ),
  "utf8"
);

describe("InventoryMovement unit cost integrity", () => {
  it("allows a missing unit cost because the field is optional", () => {
    expect(migration).toContain('NEW."unitCost" IS NOT NULL');
  });

  it("rejects negative unit costs", () => {
    expect(migration).toContain('NEW."unitCost" < 0');
    expect(migration).toContain("INVENTORY_MOVEMENT_UNIT_COST_NEGATIVE_FORBIDDEN");
  });

  it("enforces the rule at database insert time", () => {
    expect(migration).toContain(
      "DROP TRIGGER IF EXISTS inventory_movement_unit_cost_integrity"
    );
    expect(migration).toContain(
      "CREATE TRIGGER inventory_movement_unit_cost_integrity"
    );
    expect(migration).toContain('BEFORE INSERT ON "InventoryMovement"');
    expect(migration).toContain(
      "prevent_inventory_movement_unit_cost_violation()"
    );
  });

  it("does not mutate or delete existing movements", () => {
    expect(migration).not.toContain("BEFORE UPDATE ON \"InventoryMovement\"");
    expect(migration).not.toContain("BEFORE DELETE ON \"InventoryMovement\"");
  });
});
