import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { findUnique: vi.fn(), update: vi.fn() },
    authorizationApproval: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn()
  }
}));

import { prisma } from "../src/lib/prisma";
import { postAuthorizationDecision } from "../src/api/authorization";
import { resolveAuthorization } from "../src/core/authorization";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

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
});
