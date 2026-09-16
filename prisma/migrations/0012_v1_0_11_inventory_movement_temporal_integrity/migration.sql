-- InventoryMovement.occurredAt is the historical timestamp of the stock event.
-- A movement may be backdated for legitimate historical imports/corrections,
-- but it must never claim to have occurred in the future.
-- This database-level invariant also protects direct SQL writes that bypass
-- application validation.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_future_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."occurredAt" > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_FUTURE_TIMESTAMP_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_temporal_integrity ON "InventoryMovement";

CREATE TRIGGER inventory_movement_temporal_integrity
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_future_timestamp();
