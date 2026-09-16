import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/0013_v1_0_12_inventory_movement_created_at_integrity/migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("inventory movement timestamp coherence", () => {
  it("rejects a record created in the future", () => {
    expect(migration).toContain('NEW."createdAt" > CURRENT_TIMESTAMP');
    expect(migration).toContain("INVENTORY_MOVEMENT_CREATED_AT_FUTURE_FORBIDDEN");
  });

  it("requires occurredAt to be no later than createdAt", () => {
    expect(migration).toContain('NEW."occurredAt" > NEW."createdAt"');
    expect(migration).toContain("INVENTORY_MOVEMENT_TIMESTAMP_ORDER_FORBIDDEN");
  });

  it("allows an event timestamp at exactly the persistence timestamp", () => {
    expect(migration).toContain('NEW."occurredAt" > NEW."createdAt"');
  });

  it("keeps the rule at database level for direct inserts", () => {
    expect(migration).toContain("BEFORE INSERT ON \"InventoryMovement\"");
    expect(migration).toContain("EXECUTE FUNCTION prevent_inventory_movement_timestamp_coherence_violation()");
  });
});
