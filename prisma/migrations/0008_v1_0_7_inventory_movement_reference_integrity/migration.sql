-- InventoryMovement is a document-line ledger: one purchase/sale/adjustment
-- may legitimately create multiple movement rows. Keep references unique per
-- product so duplicate movement of the same product cannot be inserted while
-- allowing multi-product documents to share the document reference.
ALTER TABLE "InventoryMovement"
DROP CONSTRAINT IF EXISTS "InventoryMovement_referenceType_referenceId_key";

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_referenceType_referenceId_productId_key"
UNIQUE ("referenceType", "referenceId", "productId");
