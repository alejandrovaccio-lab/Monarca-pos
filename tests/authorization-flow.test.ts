import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    authorizationApproval: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (callback: any) => callback({
      authorizationApproval: { create: vi.fn().mockResolvedValue({ id: "approval-1" }) },
      authorizationRequest: { update: vi.fn().mockResolvedValue({ id: "request-1", status: "APPROVED" }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) }
    }))
  }
}));

import { prisma } from "../src/lib/prisma";
import { resolveAuthorization } from "../src/core/authorization";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

const approver = (name: string) => ({ roles: [{ role: { name } }] });
const pendingRequest = { id: "request-1", organizationId: "org-1", branchId: "branch-1", requestedById: "cashier-1", status: "PENDING", entityType: "Sale", entityId: "sale-1", beforeData: { status: "COMPLETED" }, requestedData: { status: "CANCELLED" } };

describe("complete authorization flow", () => {
  it("allows a manager to approve and records an audit entry", async () => {
    db.user.findUnique.mockResolvedValue(approver("GERENTE"));
    db.authorizationRequest.findUnique.mockResolvedValue(pendingRequest);

    const result = await resolveAuthorization({ requestId: "request-1", approverId: "manager-1", decision: "APPROVED", notes: "Autorizado" });

    expect(result.request.status).toBe("APPROVED");
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("rejects approval by an ordinary collaborator", async () => {
    db.user.findUnique.mockResolvedValue(approver("CAJERO"));
    await expect(resolveAuthorization({ requestId: "request-1", approverId: "cashier-1", decision: "APPROVED" })).rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
  });

  it("prevents self approval", async () => {
    db.user.findUnique.mockResolvedValue(approver("GERENTE"));
    db.authorizationRequest.findUnique.mockResolvedValue({ ...pendingRequest, requestedById: "manager-1" });
    await expect(resolveAuthorization({ requestId: "request-1", approverId: "manager-1", decision: "APPROVED" })).rejects.toThrow("SELF_APPROVAL_NOT_ALLOWED");
  });

  it("prevents resolving a request twice", async () => {
    db.user.findUnique.mockResolvedValue(approver("ENCARGADO_TIENDA"));
    db.authorizationRequest.findUnique.mockResolvedValue({ ...pendingRequest, status: "APPROVED" });
    await expect(resolveAuthorization({ requestId: "request-1", approverId: "manager-1", decision: "REJECTED" })).rejects.toThrow("AUTHORIZATION_ALREADY_RESOLVED");
  });
});
