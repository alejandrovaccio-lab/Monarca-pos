import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    inventoryMovement: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: vi.fn(),
  authorizationIntegrityHash: vi.fn(() => "valid-hash"),
}));

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, authorizationIntegrityHash } from "../src/core/authorization";
import { executeApprovedInventoryAdjustment } from "../src/core/inventory-adjustments";

const db = prisma as any;

const request = () => ({
  id: "auth-1",
  organizationId: "org-1",
  branchId: "branch-1",
  status: "APPROVED",
  type: "INVENTORY_ADJUSTMENT",
  reason: "Conteo temporal",
  entityType: "InventoryBalance",
  entityId: "product-1",
  requestedById: "user-1",
  integrityHash: "valid-hash",
  beforeData: { branchId: "branch-1", productId: "product-1", quantity: 10 },
  requestedData: {
    branchId: "branch-1",
    productId: "product-1",
    employeeId: "employee-1",
    adjustmentType: "WASTE",
    quantity: 2,
    delta: -2,
    resultingQuantity: 8,
    unitCost: null,
  },
  resolvedAt: new Date("2026-09-16T14:00:00.000Z"),
});

function configure(approvedAt: Date, resolvedAt = new Date("2026-09-16T14:00:00.000Z")) {
  const auth = { ...request(), resolvedAt };
  const executor = { id: "manager-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] };
  db.authorizationRequest.findUnique.mockResolvedValue(auth);
  db.user.findUnique.mockResolvedValue(executor);
  db.$transaction.mockImplementation(async (callback: any) => callback({
    $queryRaw: vi.fn().mockResolvedValue([]),
    authorizationRequest: { findUnique: vi.fn().mockResolvedValue(auth) },
    user: { findUnique: vi.fn().mockResolvedValue(executor) },
    authorizationApproval: { findFirst: vi.fn().mockResolvedValue({ id: "approval-1", approverId: "manager-1", decision: "APPROVED", approvedAt }) },
    branchProduct: { findUnique: vi.fn().mockResolvedValue({ isEnabled: true, product: { organizationId: "org-1" } }) },
    inventoryMovement: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "movement-1" }) },
    employee: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    inventoryBalance: { findUnique: vi.fn().mockResolvedValue({ quantity: 10 }), upsert: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  canApproveAuthorization.mockResolvedValue(true);
  authorizationIntegrityHash.mockReturnValue("valid-hash");
});

describe("inventory movement authorization temporal integrity", () => {
  it("rejects an approval timestamp in the future relative to execution", async () => {
    configure(new Date("2099-01-01T00:00:00.000Z"));
    await expect(executeApprovedInventoryAdjustment({ requestId: "auth-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_APPROVAL_INVALID");
  });

  it("rejects an authorization resolved in the future relative to execution", async () => {
    configure(new Date("2026-09-16T14:30:00.000Z"), new Date("2099-01-01T00:00:00.000Z"));
    await expect(executeApprovedInventoryAdjustment({ requestId: "auth-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_APPROVAL_INVALID");
  });
});
