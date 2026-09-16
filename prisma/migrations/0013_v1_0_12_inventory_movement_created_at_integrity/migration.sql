-- InventoryMovement timestamps must describe a coherent event.
-- occurredAt is when the stock event happened; createdAt is when the record
-- was persisted. A persisted record cannot claim to have been created before
-- its event, nor can it be created in the future.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_timestamp_coherence_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."createdAt" > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_CREATED_AT_FUTURE_FORBIDDEN';
  END IF;

  IF NEW."occurredAt" > NEW."createdAt" THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_TIMESTAMP_ORDER_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_timestamp_coherence ON "InventoryMovement";

CREATE TRIGGER inventory_movement_timestamp_coherence
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_timestamp_coherence_violation();
