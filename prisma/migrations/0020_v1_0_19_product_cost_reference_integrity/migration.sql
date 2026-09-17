-- ProductCost.source is provenance for the historical cost record.
-- Purchase-originated costs use the canonical format PURCHASE:<purchase.id>.
-- When that format is used, the referenced purchase must exist and contain
-- the same product in the same tenant/branch context as the ProductCost row.
-- This protects cost history from being attached to an unrelated purchase.

CREATE OR REPLACE FUNCTION prevent_product_cost_reference_target_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_uuid uuid;
BEGIN
  IF NEW."source" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."source" LIKE 'PURCHASE:%' THEN
    BEGIN
      purchase_uuid := substring(NEW."source" from 10)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'PRODUCT_COST_REFERENCE_TARGET_INVALID';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM "Purchase" p
      JOIN "Branch" b ON b.id = p."branchId"
      JOIN "Product" pr ON pr.id = NEW."productId"
      JOIN "PurchaseItem" pi ON pi."purchaseId" = p.id
      WHERE p.id = purchase_uuid
        AND pi."productId" = NEW."productId"
        AND b."organizationId" = pr."organizationId"
    ) THEN
      RAISE EXCEPTION 'PRODUCT_COST_REFERENCE_TARGET_INVALID';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_cost_reference_target_integrity ON "ProductCost";

CREATE TRIGGER product_cost_reference_target_integrity
BEFORE INSERT ON "ProductCost"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_cost_reference_target_violation();
