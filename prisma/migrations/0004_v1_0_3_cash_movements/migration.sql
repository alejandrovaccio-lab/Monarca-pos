-- Cash movements are immutable ledger entries created only after an authorization is approved.
CREATE TABLE "CashMovement" (
  "id" UUID NOT NULL,
  "registerSessionId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "authorizationRequestId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashMovement_type_check" CHECK ("type" IN ('CASH_IN', 'CASH_OUT')),
  CONSTRAINT "CashMovement_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "CashMovement_registerSessionId_fkey" FOREIGN KEY ("registerSessionId") REFERENCES "RegisterSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_authorizationRequestId_fkey" FOREIGN KEY ("authorizationRequestId") REFERENCES "AuthorizationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CashMovement_authorizationRequestId_key" ON "CashMovement"("authorizationRequestId");
CREATE INDEX "CashMovement_registerSessionId_createdAt_idx" ON "CashMovement"("registerSessionId", "createdAt");
CREATE INDEX "CashMovement_branchId_createdAt_idx" ON "CashMovement"("branchId", "createdAt");
