import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    authorizationApproval: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn()
  }
}));

import { prisma } from "../src/lib/prisma";
import { postAuthorizationDecision, postAuthorizationRequest } from "../src/api/authorization";
import { resolveAuthorization, requestAuthorization } from "../src/core/authorization";

const db = prisma as any;

const activeRequester = {
  id: "cashier-1",
  status: "ACTIVE",
  organizationId: "org-1",
  branchAccess: [{ branchId: "branch-1" }]
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(activeRequester);
});

describe("authorization decision input", () => {
  it("rejects an invalid decision in the core before database access", async () => {
    await expect(resolveAuthorization({
      requestId: "request-1",
      approverId: "manager-1",
      decision: "PENDING" as any
    })).rejects.toThrow("AUTHORIZATION_DECISION_INVALID");

    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("maps an invalid decision to HTTP 400", async () => {
    const result = await postAuthorizationDecision({
      requestId: "request-1",
      approverId: "manager-1",
      decision: "PENDING" as any
    });

    expect(result).toEqual({
      status: 400,
      body: { error: "AUTHORIZATION_DECISION_INVALID" }
    });
  });

  it("rejects decision notes longer than the configured limit", async () => {
    const notes = "n".repeat(2001);

    await expect(resolveAuthorization({
      requestId: "request-1",
      approverId: "manager-1",
      decision: "APPROVED",
      notes
    })).rejects.toThrow("AUTHORIZATION_NOTES_TOO_LONG");

    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("maps oversized decision notes to HTTP 400", async () => {
    const result = await postAuthorizationDecision({
      requestId: "request-1",
      approverId: "manager-1",
      decision: "APPROVED",
      notes: "n".repeat(2001)
    });

    expect(result).toEqual({
      status: 400,
      body: { error: "AUTHORIZATION_NOTES_TOO_LONG" }
    });
  });

  it("rejects an authorization reason longer than the configured limit", async () => {
    await expect(requestAuthorization({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_CANCEL",
      reason: "r".repeat(1001),
      entityType: "Sale",
      entityId: "sale-1"
    })).rejects.toThrow("AUTHORIZATION_REASON_TOO_LONG");

    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("maps an oversized authorization reason to HTTP 400", async () => {
    const result = await postAuthorizationRequest({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "cashier-1",
      type: "SALE_CANCEL",
      reason: "r".repeat(1001),
      entityType: "Sale",
      entityId: "sale-1"
    });

    expect(result).toEqual({
      status: 400,
      body: { error: "AUTHORIZATION_REASON_TOO_LONG" }
    });
  });
});
