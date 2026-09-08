import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    authorizationApproval: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn()
  }
}));

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, requestAuthorization, resolveAuthorization } from "../src/core/authorization";
import { requireAuthorizationApprover, requirePermission } from "../src/middleware/authorization";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

function transactionMock() {
  db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));
}

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

  it("allows an active user with a designated senior role to approve", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "GERENTE" } }] });
    await expect(requireAuthorizationApprover("manager-1")).resolves.toBe(true);

    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "CAJERO" } }] });
    await expect(canApproveAuthorization("cashier-1")).resolves.toBe(false);
  });

  it("denies approval to inactive or missing users even when a senior role is present", async () => {
    db.user.findUnique.mockResolvedValue({ status: "INACTIVE", roles: [{ role: { name: "GERENTE" } }] });
    await expect(canApproveAuthorization("inactive-manager-1")).resolves.toBe(false);

    db.user.findUnique.mockResolvedValue(null);
    await expect(canApproveAuthorization("missing-user")).resolves.toBe(false);
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

  it("rejects resolution by a non-approver before loading the request", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "CAJERO" } }] });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "cashier-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
  });

  it("rejects resolution by an inactive approver", async () => {
    db.user.findUnique.mockResolvedValue({ status: "INACTIVE", roles: [{ role: { name: "GERENTE" } }] });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "inactive-manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing authorization request", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue(null);

    await expect(resolveAuthorization({ requestId: "missing", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_NOT_FOUND");
  });

  it("prevents self-approval and preserves the pending request", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "auth-1", requestedById: "manager-1", status: "PENDING" });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("SELF_APPROVAL_NOT_ALLOWED");
    expect(db.authorizationApproval.create).not.toHaveBeenCalled();
  });

  it("does not resolve an authorization twice", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "ADMIN" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "auth-1", requestedById: "cashier-1", status: "APPROVED" });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "admin-1", decision: "REJECTED" }))
      .rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");
  });

  it("rejects a concurrent resolution when the atomic pending claim updates zero rows", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "auth-1", requestedById: "cashier-1", status: "PENDING" });
    db.authorizationRequest.updateMany.mockResolvedValue({ count: 0 });
    transactionMock();

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");
    expect(db.authorizationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "auth-1", status: "PENDING" }
    }));
    expect(db.authorizationApproval.create).not.toHaveBeenCalled();
  });

  it("approves a request, records the approval, resolves the request, and audits it", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "GERENTE" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-1", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-1", status: "PENDING",
      entityType: "Sale", entityId: "sale-1", beforeData: { status: "COMPLETED" }, requestedData: { status: "CANCELLED" }
    });
    db.authorizationRequest.updateMany.mockResolvedValue({ count: 1 });
    db.authorizationApproval.create.mockResolvedValue({ id: "approval-1", decision: "APPROVED" });
    db.auditLog.create.mockResolvedValue({ id: "audit-1" });
    transactionMock();

    const result = await resolveAuthorization({
      requestId: "auth-1", approverId: "manager-1", decision: "APPROVED", notes: "Cliente presente en sucursal"
    });

    expect(result.approval).toMatchObject({ id: "approval-1", decision: "APPROVED" });
    expect(result.request.status).toBe("APPROVED");
    expect(db.authorizationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "auth-1", status: "PENDING" }, data: expect.objectContaining({ status: "APPROVED" })
    }));
    expect(db.authorizationApproval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorizationRequestId: "auth-1", approverId: "manager-1", decision: "APPROVED", notes: "Cliente presente en sucursal" })
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "AUTHORIZATION_APPROVED", entityType: "Sale", entityId: "sale-1", beforeData: { status: "COMPLETED" }, afterData: { status: "CANCELLED" } })
    }));
  });

  it("supports rejection with notes and records the rejection audit", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE", roles: [{ role: { name: "ENCARGADO_TIENDA" } }] });
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-2", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-2", status: "PENDING",
      entityType: "Sale", entityId: "sale-2", beforeData: { status: "COMPLETED" }, requestedData: { status: "REFUNDED" }
    });
    db.authorizationRequest.updateMany.mockResolvedValue({ count: 1 });
    db.authorizationApproval.create.mockResolvedValue({ id: "approval-2", decision: "REJECTED" });
    db.auditLog.create.mockResolvedValue({ id: "audit-2" });
    transactionMock();

    const result = await resolveAuthorization({ requestId: "auth-2", approverId: "store-manager-1", decision: "REJECTED", notes: "No procede sin comprobante" });

    expect(result.approval.decision).toBe("REJECTED");
    expect(result.request.status).toBe("REJECTED");
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "AUTHORIZATION_REJECTED" }) }));
  });
});
