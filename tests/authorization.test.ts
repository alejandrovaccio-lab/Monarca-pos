import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
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

function activeApprover(overrides: Record<string, unknown> = {}) {
  return {
    status: "ACTIVE",
    organizationId: "org-1",
    roles: [{ role: { name: "GERENTE" } }],
    branchAccess: [{ branchId: "branch-1" }],
    ...overrides
  };
}

describe("role authorization", () => {
  it("allows a user with the required permission", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { permissions: [{ permission: { code: "SALE_CANCEL" } }] } }]
    });
    await expect(requirePermission("user-1", "SALE_CANCEL")).resolves.toBe(true);
  });

  it("denies a user without the required permission", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { permissions: [] } }]
    });
    await expect(requirePermission("user-1", "SALE_CANCEL")).resolves.toBe(false);
  });

  it("denies all permissions to an inactive user even when the role grants them", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "INACTIVE",
      roles: [{ role: { permissions: [{ permission: { code: "SALE_CANCEL" } }] } }]
    });
    await expect(requirePermission("inactive-user-1", "SALE_CANCEL")).resolves.toBe(false);
  });

  it("denies permissions to a missing user", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(requirePermission("missing-user", "SALE_CANCEL")).resolves.toBe(false);
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

  it("creates a pending authorization request for an active requester in the same organization and branch", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE",
      organizationId: "org-1",
      branchAccess: [{ branchId: "branch-1" }]
    });
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

  it("rejects authorization requests from an inactive or missing requester", async () => {
    db.user.findUnique.mockResolvedValue({ status: "INACTIVE", organizationId: "org-1", branchAccess: [] });
    await expect(requestAuthorization({
      organizationId: "org-1", branchId: "branch-1", requestedById: "inactive-user", type: "SALE_CANCEL",
      reason: "Prueba", entityType: "Sale"
    })).rejects.toThrow("AUTHORIZATION_REQUESTER_REQUIRED");

    db.user.findUnique.mockResolvedValue(null);
    await expect(requestAuthorization({
      organizationId: "org-1", branchId: "branch-1", requestedById: "missing-user", type: "SALE_CANCEL",
      reason: "Prueba", entityType: "Sale"
    })).rejects.toThrow("AUTHORIZATION_REQUESTER_REQUIRED");
    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("rejects authorization requests outside the requester's organization", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE", organizationId: "org-2", branchAccess: [{ branchId: "branch-1" }]
    });

    await expect(requestAuthorization({
      organizationId: "org-1", branchId: "branch-1", requestedById: "user-2", type: "SALE_CANCEL",
      reason: "Prueba", entityType: "Sale"
    })).rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("rejects authorization requests for a branch the requester cannot access", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE", organizationId: "org-1", branchAccess: [{ branchId: "branch-2" }]
    });

    await expect(requestAuthorization({
      organizationId: "org-1", branchId: "branch-1", requestedById: "user-1", type: "SALE_CANCEL",
      reason: "Prueba", entityType: "Sale"
    })).rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("allows a global authorization request within the requester's organization", async () => {
    db.user.findUnique.mockResolvedValue({
      status: "ACTIVE", organizationId: "org-1", branchAccess: []
    });
    db.authorizationRequest.create.mockResolvedValue({ id: "auth-global", status: "PENDING" });

    await expect(requestAuthorization({
      organizationId: "org-1", requestedById: "user-1", type: "ACCESS_CHANGE",
      reason: "Prueba global", entityType: "User"
    })).resolves.toMatchObject({ id: "auth-global", status: "PENDING" });
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
    db.user.findUnique.mockResolvedValue(activeApprover());
    db.authorizationRequest.findUnique.mockResolvedValue(null);

    await expect(resolveAuthorization({ requestId: "missing", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_NOT_FOUND");
  });

  it("prevents self-approval and preserves the pending request", async () => {
    db.user.findUnique.mockResolvedValue(activeApprover());
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "auth-1", requestedById: "manager-1", status: "PENDING" });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("SELF_APPROVAL_NOT_ALLOWED");
    expect(db.authorizationApproval.create).not.toHaveBeenCalled();
  });

  it("does not resolve an authorization twice", async () => {
    db.user.findUnique.mockResolvedValue(activeApprover());
    db.authorizationRequest.findUnique.mockResolvedValue({ id: "auth-1", requestedById: "cashier-1", status: "APPROVED" });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "REJECTED" }))
      .rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");
  });

  it("rejects an approver from another organization", async () => {
    db.user.findUnique.mockResolvedValue(activeApprover({ organizationId: "org-2" }));
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-1", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-1", status: "PENDING"
    });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-2", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
    expect(db.authorizationRequest.update).not.toHaveBeenCalled();
  });

  it("rejects an approver without access to the request branch", async () => {
    db.user.findUnique.mockResolvedValue(activeApprover({ branchAccess: [{ branchId: "branch-2" }] }));
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-1", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-1", status: "PENDING"
    });

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
    expect(db.authorizationRequest.update).not.toHaveBeenCalled();
  });

  it("allows an approver with matching organization and branch access", async () => {
    db.user.findUnique.mockResolvedValue(activeApprover());
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-1", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-1", status: "PENDING",
      entityType: "Sale", entityId: "sale-1", beforeData: { status: "COMPLETED" }, requestedData: { status: "CANCELLED" }
    });
    db.authorizationRequest.update.mockResolvedValue({ id: "auth-1", status: "APPROVED", resolvedAt: new Date() });
    db.authorizationApproval.create.mockResolvedValue({ id: "approval-1", decision: "APPROVED" });
    db.auditLog.create.mockResolvedValue({ id: "audit-1" });
    transactionMock();

    await expect(resolveAuthorization({ requestId: "auth-1", approverId: "manager-1", decision: "APPROVED" }))
      .resolves.toMatchObject({ approval: { id: "approval-1" }, request: { status: "APPROVED" } });
  });

  it("rejects a global authorization only when the organization does not match", async () => {
    db.user.findUnique.mockResolvedValue(activeApprover({ organizationId: "org-2" }));
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-global", organizationId: "org-1", branchId: undefined, requestedById: "cashier-1", status: "PENDING"
    });

    await expect(resolveAuthorization({ requestId: "auth-global", approverId: "manager-2", decision: "APPROVED" }))
      .rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
  });

  it("approves a request, records the approval, resolves the request, and audits it", async () => {
    db.user.findUnique.mockResolvedValue(activeApprover());
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-1", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-1", status: "PENDING",
      entityType: "Sale", entityId: "sale-1", beforeData: { status: "COMPLETED" }, requestedData: { status: "CANCELLED" }
    });
    db.authorizationRequest.update.mockResolvedValue({ id: "auth-1", status: "APPROVED", resolvedAt: new Date() });
    db.authorizationApproval.create.mockResolvedValue({ id: "approval-1", decision: "APPROVED" });
    db.auditLog.create.mockResolvedValue({ id: "audit-1" });
    transactionMock();

    const result = await resolveAuthorization({
      requestId: "auth-1", approverId: "manager-1", decision: "APPROVED", notes: "Cliente presente en sucursal"
    });

    expect(result.approval).toMatchObject({ id: "approval-1", decision: "APPROVED" });
    expect(result.request.status).toBe("APPROVED");
    expect(db.authorizationRequest.update).toHaveBeenCalledWith(expect.objectContaining({
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
    db.user.findUnique.mockResolvedValue(activeApprover({ roles: [{ role: { name: "ENCARGADO_TIENDA" } }] }));
    db.authorizationRequest.findUnique.mockResolvedValue({
      id: "auth-2", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-2", status: "PENDING",
      entityType: "Sale", entityId: "sale-2", beforeData: { status: "COMPLETED" }, requestedData: { status: "REFUNDED" }
    });
    db.authorizationRequest.update.mockResolvedValue({ id: "auth-2", status: "REJECTED", resolvedAt: new Date() });
    db.authorizationApproval.create.mockResolvedValue({ id: "approval-2", decision: "REJECTED" });
    db.auditLog.create.mockResolvedValue({ id: "audit-2" });
    transactionMock();

    const result = await resolveAuthorization({ requestId: "auth-2", approverId: "store-manager-1", decision: "REJECTED", notes: "No procede sin comprobante" });

    expect(result.approval.decision).toBe("REJECTED");
    expect(result.request.status).toBe("REJECTED");
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "AUTHORIZATION_REJECTED" }) }));
  });
});
