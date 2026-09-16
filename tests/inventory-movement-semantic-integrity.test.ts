import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/0014_v1_0_13_inventory_movement_semantic_integrity/migration.sql"), "utf8");

describe("InventoryMovement semantic integrity", () => {
  it("requires a referenceId whenever referenceType is supplied", () => {
    expect(migration).toContain('IF NEW."referenceType" IS NULL');
    expect(migration).toContain("INVENTORY_MOVEMENT_REFERENCE_ID_REQUIRED");
  });

  it("binds PURCHASE movements to purchase references", () => {
    expect(migration).toContain("NEW.\"type\" = 'PURCHASE'");
    expect(migration).toContain("NEW.\"referenceType\" <> 'PURCHASE'");
  });

  it("keeps SALE movements separate from purchase and adjustment references", () => {
    expect(migration).toContain("NEW.\"type\" = 'SALE'");
    expect(migration).toContain("('SALE', 'SALE_ITEM')");
  });

  it("binds waste and shrinkage movements to their own semantic references", () => {
    expect(migration).toContain("NEW.\"type\" = 'WASTE'");
    expect(migration).toContain("('MANUAL_WASTE', 'WASTE')");
    expect(migration).toContain("NEW.\"type\" = 'SHRINKAGE'");
    expect(migration).toContain("('MANUAL_SHRINKAGE', 'SHRINKAGE')");
  });

  it("binds transfer and transformation directions to their corresponding references", () => {
    expect(migration).toContain("NEW.\"type\" = 'TRANSFER_IN'");
    expect(migration).toContain("NEW.\"type\" = 'TRANSFER_OUT'");
    expect(migration).toContain("('TRANSFER', 'TRANSFER_IN')");
    expect(migration).toContain("('TRANSFER', 'TRANSFER_OUT')");
    expect(migration).toContain("NEW.\"type\" = 'TRANSFORMATION_INPUT'");
    expect(migration).toContain("NEW.\"type\" = 'TRANSFORMATION_OUTPUT'");
    expect(migration).toContain("('TRANSFORMATION', 'TRANSFORMATION_INPUT')");
    expect(migration).toContain("('TRANSFORMATION', 'TRANSFORMATION_OUTPUT')");
  });

  it("allows only adjustment references that represent an adjustment or sale reversal", () => {
    expect(migration).toContain("NEW.\"type\" = 'ADJUSTMENT'");
    expect(migration).toContain("'MANUAL_ENTRY'");
    expect(migration).toContain("'MANUAL_EXIT'");
    expect(migration).toContain("'MANUAL_COUNT_CORRECTION'");
    expect(migration).toContain("'SALE_CANCEL_ITEM'");
    expect(migration).toContain("'SALE_REFUND_ITEM'");
  });

  it("enforces the rule at database insert time", () => {
    expect(migration).toContain("DROP TRIGGER IF EXISTS inventory_movement_semantic_integrity");
    expect(migration).toContain("CREATE TRIGGER inventory_movement_semantic_integrity");
    expect(migration).toContain("BEFORE INSERT ON \"InventoryMovement\"");
    expect(migration).toContain("prevent_inventory_movement_semantic_violation()");
  });
});
