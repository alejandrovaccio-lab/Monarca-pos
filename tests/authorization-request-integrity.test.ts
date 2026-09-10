import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn() }
  }
}));

import { prisma } from "../src/lib/prisma";
import { authorizationIntegrityHash, requestAuthorization } from "../src/core/authorization";

const db = prisma as any;

const requester = {
  id: "cashier-1",
  status: "ACTIVE",
  organizationId: "org-1",
  branchAccess: [{ branchId: "branch-1" }]
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(requester);
  db.authorizationRequest.create.mockImplementation(async ({ data }: any) => ({ id: "auth-1", status: "PENDING", ...data }));
});

describe("authorization request integrity", () => {
  it("hashes the exact persisted reason after trimming whitespace", async () => {
    const result = await requestAuthorization({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_CANCEL",
      reason: "  Cancelación solicitada por cliente  ",
      entityType: "Sale",
      entityId: "sale-1",
      beforeData: { id: "sale-1", status: "COMPLETED" },
      requestedData: { id: "sale-1", status: "CANCELLED" }
    });

    const call = db.authorizationRequest.create.mock.calls[0][0];
    const expectedHash = authorizationIntegrityHash({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_CANCEL",
      reason: "Cancelación solicitada por cliente",
      entityType: "Sale",
      entityId: "sale-1",
      beforeData: { id: "sale-1", status: "COMPLETED" },
      requestedData: { id: "sale-1", status: "CANCELLED" }
    });

    expect(call.data.reason).toBe("Cancelación solicitada por cliente");
    expect(call.data.integrityHash).toBe(expectedHash);
    expect(result.integrityHash).toBe(expectedHash);
  });

  it("does not produce a hash that only matches the untrimmed input", async () => {
    await requestAuthorization({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_REFUND",
      reason: "  Reembolso autorizado  ",
      entityType: "Sale",
      entityId: "sale-1"
    });

    const call = db.authorizationRequest.create.mock.calls[0][0];
    const persistedHash = authorizationIntegrityHash({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_REFUND",
      reason: "Reembolso autorizado",
      entityType: "Sale",
      entityId: "sale-1",
      beforeData: undefined,
      requestedData: undefined
    });
    const rawInputHash = authorizationIntegrityHash({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_REFUND",
      reason: "  Reembolso autorizado  ",
      entityType: "Sale",
      entityId: "sale-1",
      beforeData: undefined,
      requestedData: undefined
    });

    expect(call.data.integrityHash).toBe(persistedHash);
    expect(call.data.integrityHash).not.toBe(rawInputHash);
  });
});
