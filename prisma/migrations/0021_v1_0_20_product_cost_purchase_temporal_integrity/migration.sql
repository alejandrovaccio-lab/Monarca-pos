-- ProductCost effectiveAt is the historical effective timestamp for the valuation.
-- When a cost is sourced from a purchase, its effective timestamp must match
-- the purchase's purchasedAt timestamp. This prevents a valid purchase from
-- being used to fabricate a different historical cost date.

CREATE OR REPLACE FUNCTION prevent_product_cost_purchase_temporal_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_uuid uuid;
  purchase_timestamp timestamptz;
BEGIN
  IF NEW."source" IS NULL OR NEW."source" NOT LIKE 'PURCHASE:%' THEN
    RETURN NEW;
  END IF;

  BEGIN
    purchase_uuid := substring(NEW."source" from 10)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'PRODUCT_COST_REFERENCE_TARGET_INVALID';
  END;

  SELECT p."purchasedAt"
    INTO purchase_timestamp
  FROM "Purchase" p
  JOIN "PurchaseItem" pi ON pi."purchaseId" = p.id
  WHERE p.id = purchase_uuid
    AND pi."productId" = NEW."productId"
  LIMIT 1;

  IF purchase_timestamp IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_COST_REFERENCE_TARGET_INVALID';
  END IF;

  IF NEW."effectiveAt" <> purchase_timestamp THEN
    RAISE EXCEPTION 'PRODUCT_COST_EFFECTIVE_AT_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_cost_purchase_temporal_integrity ON "ProductCost";

CREATE TRIGGER product_cost_purchase_temporal_integrity
BEFORE INSERT ON "ProductCost"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_cost_purchase_temporal_violation();
