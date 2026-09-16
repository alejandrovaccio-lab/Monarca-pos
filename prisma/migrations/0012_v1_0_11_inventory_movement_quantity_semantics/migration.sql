-- InventoryMovement.quantity is a signed stock delta.
-- Positive quantities add stock; negative quantities remove stock.
-- ADJUSTMENT is intentionally bidirectional because it represents explicit
-- corrections (entries, exits and physical-count corrections).
-- All other currently defined movement types have a fixed stock direction.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_quantity_semantics_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quantity = 0 THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_QUANTITY_ZERO_FORBIDDEN';
  END IF;

  IF NEW.type IN ('PURCHASE', 'TRANSFER_IN', 'TRANSFORMATION_OUTPUT')
     AND NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_QUANTITY_SIGN_FORBIDDEN';
  END IF;

  IF NEW.type IN ('SALE', 'WASTE', 'SHRINKAGE', 'TRANSFER_OUT', 'TRANSFORMATION_INPUT')
     AND NEW.quantity >= 0 THEN
    RAISE EXCEPTION 'INVENTORY_MOVEMENT_QUANTITY_SIGN_FORBIDDEN';
  END IF;

  -- ADJUSTMENT is deliberately allowed to be positive or negative.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_quantity_semantics ON "InventoryMovement";

CREATE TRIGGER inventory_movement_quantity_semantics
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_quantity_semantics_violation();
