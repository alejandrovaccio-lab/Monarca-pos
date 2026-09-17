-- InventoryMovement references are polymorphic, so foreign keys cannot enforce
-- the target. For supported business references, verify that the referenced
-- document exists and belongs to the same branch/product as the movement.

CREATE OR REPLACE FUNCTION prevent_inventory_movement_reference_target_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."referenceType" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."referenceType" = 'PURCHASE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Purchase" p
      JOIN "PurchaseItem" pi ON pi."purchaseId" = p.id
      WHERE p.id = NEW."referenceId"
        AND p."branchId" = NEW."branchId"
        AND pi."productId" = NEW."productId"
    ) THEN
      RAISE EXCEPTION 'INVENTORY_MOVEMENT_REFERENCE_TARGET_INVALID';
    END IF;
  ELSIF NEW."referenceType" IN ('SALE', 'SALE_ITEM', 'SALE_CANCEL_ITEM', 'SALE_REFUND_ITEM') THEN
    IF NEW."referenceType" = 'SALE' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM "Sale" s
        JOIN "SaleItem" si ON si."saleId" = s.id
        WHERE s.id = NEW."referenceId"
          AND s."branchId" = NEW."branchId"
          AND si."productId" = NEW."productId"
      ) THEN
        RAISE EXCEPTION 'INVENTORY_MOVEMENT_REFERENCE_TARGET_INVALID';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE si.id = NEW."referenceId"
          AND s."branchId" = NEW."branchId"
          AND si."productId" = NEW."productId"
      ) THEN
        RAISE EXCEPTION 'INVENTORY_MOVEMENT_REFERENCE_TARGET_INVALID';
      END IF;
    END IF;
  ELSIF NEW."referenceType" IN ('TRANSFORMATION', 'TRANSFORMATION_INPUT', 'TRANSFORMATION_OUTPUT') THEN
    IF NEW."referenceType" = 'TRANSFORMATION' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM "Transformation" t
        WHERE t.id = NEW."referenceId"
          AND t."branchId" = NEW."branchId"
          AND (
            EXISTS (SELECT 1 FROM "TransformationInput" ti WHERE ti."transformationId" = t.id AND ti."productId" = NEW."productId")
            OR EXISTS (SELECT 1 FROM "TransformationOutput" to1 WHERE to1."transformationId" = t.id AND to1."productId" = NEW."productId")
          )
      ) THEN
        RAISE EXCEPTION 'INVENTORY_MOVEMENT_REFERENCE_TARGET_INVALID';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM "TransformationInput" ti
        JOIN "Transformation" t ON t.id = ti."transformationId"
        WHERE ti.id = NEW."referenceId"
          AND t."branchId" = NEW."branchId"
          AND ti."productId" = NEW."productId"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "TransformationOutput" to1
        JOIN "Transformation" t ON t.id = to1."transformationId"
        WHERE to1.id = NEW."referenceId"
          AND t."branchId" = NEW."branchId"
          AND to1."productId" = NEW."productId"
      ) THEN
        RAISE EXCEPTION 'INVENTORY_MOVEMENT_REFERENCE_TARGET_INVALID';
      END IF;
    END IF;
  ELSIF NEW."referenceType" IN ('MANUAL_ENTRY', 'MANUAL_EXIT', 'MANUAL_COUNT_CORRECTION', 'MANUAL_WASTE', 'WASTE', 'MANUAL_SHRINKAGE', 'SHRINKAGE', 'TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT') THEN
    -- These references do not have a dedicated target model in the current
    -- schema; semantic/type validation remains the applicable barrier.
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_reference_target_integrity ON "InventoryMovement";

CREATE TRIGGER inventory_movement_reference_target_integrity
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_reference_target_violation();
