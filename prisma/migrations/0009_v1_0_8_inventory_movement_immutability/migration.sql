-- InventoryMovement is the immutable stock ledger.
-- Once recorded, a movement must never be updated or deleted because it is
-- the accounting/audit evidence for inventory changes.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'INVENTORY_MOVEMENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER inventory_movement_immutable
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_mutation();
