CREATE OR REPLACE FUNCTION enforce_sale_reversal_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sale_status "SaleStatus";
  sale_sold_at TIMESTAMP;
  sale_item_quantity NUMERIC;
BEGIN
  IF NEW."referenceType" IN ('SALE_CANCEL_ITEM', 'SALE_REFUND_ITEM') THEN
    SELECT s."status", s."soldAt", si."quantity"
      INTO sale_status, sale_sold_at, sale_item_quantity
    FROM "SaleItem" si
    JOIN "Sale" s ON s.id = si."saleId"
    WHERE si.id = NEW."referenceId"
      AND si."productId" = NEW."productId"
      AND s."branchId" = NEW."branchId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALE_REVERSAL_TARGET_INVALID';
    END IF;

    IF NEW."quantity" IS NULL OR NEW."quantity" <= 0 THEN
      RAISE EXCEPTION 'SALE_REVERSAL_QUANTITY_INVALID';
    END IF;

    IF NEW."quantity" <> sale_item_quantity THEN
      RAISE EXCEPTION 'SALE_REVERSAL_QUANTITY_MISMATCH';
    END IF;

    IF NEW."occurredAt" < sale_sold_at THEN
      RAISE EXCEPTION 'SALE_REVERSAL_BEFORE_SALE_FORBIDDEN';
    END IF;

    IF NEW."referenceType" = 'SALE_CANCEL_ITEM' AND sale_status <> 'CANCELLED' THEN
      RAISE EXCEPTION 'SALE_CANCEL_REVERSAL_STATUS_INVALID';
    END IF;

    IF NEW."referenceType" = 'SALE_REFUND_ITEM' AND sale_status <> 'REFUNDED' THEN
      RAISE EXCEPTION 'SALE_REFUND_REVERSAL_STATUS_INVALID';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sale_reversal_integrity ON "InventoryMovement";

CREATE TRIGGER sale_reversal_integrity
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION enforce_sale_reversal_integrity();
