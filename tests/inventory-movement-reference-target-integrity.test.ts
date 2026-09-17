import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("InventoryMovement reference target integrity migration", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "prisma/migrations/0016_v1_0_15_inventory_movement_reference_target_integrity/migration.sql"),
    "utf8",
  );

  it("validates PURCHASE references against branch and product", () => {
    expect(migration).toContain('FROM "Purchase" p');
    expect(migration).toContain('JOIN "PurchaseItem" pi ON pi."purchaseId" = p.id');
    expect(migration).toContain('p."branchId" = NEW."branchId"');
    expect(migration).toContain('pi."productId" = NEW."productId"');
  });

  it("validates sale references against branch and product", () => {
    expect(migration).toContain('FROM "Sale" s');
    expect(migration).toContain('JOIN "SaleItem" si ON si."saleId" = s.id');
    expect(migration).toContain('s."branchId" = NEW."branchId"');
    expect(migration).toContain('si."productId" = NEW."productId"');
  });

  it("validates item-level sale references against the owning sale", () => {
    expect(migration).toContain('FROM "SaleItem" si');
    expect(migration).toContain('si.id = NEW."referenceId"');
    expect(migration).toContain('s."branchId" = NEW."branchId"');
  });

  it("validates transformation references against branch and product", () => {
    expect(migration).toContain('FROM "Transformation" t');
    expect(migration).toContain('t."branchId" = NEW."branchId"');
    expect(migration).toContain('FROM "TransformationInput" ti');
    expect(migration).toContain('FROM "TransformationOutput" to1');
    expect(migration).toContain('ti."productId" = NEW."productId"');
    expect(migration).toContain('to1."productId" = NEW."productId"');
  });

  it("rejects a supported reference whose target does not match", () => {
    expect(migration).toContain("INVENTORY_MOVEMENT_REFERENCE_TARGET_INVALID");
  });

  it("enforces the barrier at database insert time", () => {
    expect(migration).toContain("BEFORE INSERT ON \"InventoryMovement\"");
    expect(migration).toContain("inventory_movement_reference_target_integrity");
  });
});
