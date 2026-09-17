-- ProductPrice may be global (branchId NULL) or branch-specific.
-- When branch-specific, the branch and product must belong to the same tenant.
-- This protects pricing data even when application-level scope checks are bypassed.

CREATE OR REPLACE FUNCTION prevent_product_price_tenant_violation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."branchId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Branch" b
      JOIN "Product" p ON p."id" = NEW."productId"
      WHERE b."id" = NEW."branchId"
        AND b."organizationId" = p."organizationId"
    ) THEN
      RAISE EXCEPTION 'PRODUCT_PRICE_TENANT_SCOPE_FORBIDDEN';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM "Product" p
      WHERE p."id" = NEW."productId"
    ) THEN
      RAISE EXCEPTION 'PRODUCT_PRICE_PRODUCT_INVALID';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_price_tenant_integrity ON "ProductPrice";

CREATE TRIGGER product_price_tenant_integrity
BEFORE INSERT OR UPDATE ON "ProductPrice"
FOR EACH ROW
EXECUTE FUNCTION prevent_product_price_tenant_violation();
