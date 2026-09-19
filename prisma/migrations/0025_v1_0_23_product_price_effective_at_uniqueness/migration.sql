-- A product may have at most one price event at a given effective timestamp
-- within each pricing scope.
-- Global prices (branchId NULL) and branch-specific prices remain independent
-- scopes, so a branch override may intentionally share the same effectiveAt
-- as a global price.

CREATE UNIQUE INDEX IF NOT EXISTS product_price_branch_effective_unique
ON "ProductPrice" ("productId", "branchId", "effectiveAt")
WHERE "branchId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS product_price_global_effective_unique
ON "ProductPrice" ("productId", "effectiveAt")
WHERE "branchId" IS NULL;
