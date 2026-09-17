-- InventoryMovement.unitCost is an optional valuation field.
-- When supplied, it must always be a finite non-negative monetary value.
-- This prevents negative inventory valuations from entering the ledger while
-- preserving movement types that legitimately do not carry a unit cost.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_unit_cost_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."unitCost" IS NOT NULL AND NEW."unitCost" < 0 THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_UNIT_COST_NEGATIVE_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_unit_cost_integrity ON "InventoryMovement";

CREATE TRIGGER inventory_movement_unit_cost_integrity
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_unit_cost_violation();
