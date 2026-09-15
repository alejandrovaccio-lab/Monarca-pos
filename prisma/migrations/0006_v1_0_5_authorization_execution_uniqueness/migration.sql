ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_referenceType_referenceId_key" UNIQUE ("referenceType", "referenceId");
