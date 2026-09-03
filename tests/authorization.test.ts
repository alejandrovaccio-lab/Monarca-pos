import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    authorizationApproval: { create: vi.fn() }
  }
}));

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, hasPermission, requestAuthorization } from "../src/core/authorization";
import { requireAuthorizationApprover, requirePermission } from "../src/middleware/authorization";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("role authorization", () => {
  it("allows a user with the required permission", async () => {
    db.user.findUnique.mockResolvedValue({
      roles: [{ role: { permissions: [{ permission: { code: "SALE_CANCEL" } }] } }]
    });
    await expect(requirePermission("user-1", "SALE_CANCEL")).resolves.toBe(true);
  });

  it("denies a user without the required permission", async () => {
    db.user.findUnique.mockResolvedValue({
      roles: [{ role: { permissions: [] } }]
    });
    await expect(requirePermission("user-1", "SALE_CANCEL")).resolves.toBe(false);
  });

  it("allows only designated senior roles to approve", async () => {
    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "GERENTE" } }] });
    await expect(requireAuthorizationApprover("manager-1")).resolves.toBe(true);

    db.user.findUnique.mockResolvedValue({ roles: [{ role: { name: "CAJERO" } }] });
    await expect(canApproveAuthorization("cashier-1")).resolves.toBe(false);
  });

  it("creates a pending authorization request", async () => {
    db.authorizationRequest.create.mockResolvedValue({ id: "auth-1", status: "PENDING" });
    const result = await requestAuthorization({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_CANCEL",
      reason: "Cancelación solicitada por cliente",
      entityType: "Sale",
      entityId: "sale-1"
    });
    expect(result).toMatchObject({ id: "auth-1", status: "PENDING" });
    expect(db.authorizationRequest.create).toHaveBeenCalledOnce();
  });
});
