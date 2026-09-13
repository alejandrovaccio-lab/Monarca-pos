import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: { authorizationRequest: { findUnique: vi.fn() } }
}));

vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: vi.fn(),
  hasPermission: vi.fn()
}));

vi.mock("../src/middleware/auth", () => ({
  requireSession: vi.fn(),
  requireBranchSession: vi.fn()
}));

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization } from "../src/core/authorization";
import { requireSession, requireBranchSession } from "../src/middleware/auth";
import { requireAuthorizationDecisionApprover } from "../src/middleware/authorization";

const db = prisma as any;
const canApprove = canApproveAuthorization as any;
const session = requireSession as any;
const branchSession = requireBranchSession as any;

const validContext = {
  sessionId: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  user: { status: "ACTIVE", organizationId: "org-1" }
};

const validRequest = { organizationId: "org-1", branchId: "branch-1" };

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(validContext);
  branchSession.mockResolvedValue(validContext);
  db.authorizationRequest.findUnique.mockResolvedValue(validRequest);
  canApprove.mockResolvedValue(true);
});

describe("authorization middleware security boundary", () => {
  it("rejects an empty or oversized request id before session lookup", async () => {
    await expect(requireAuthorizationDecisionApprover("valid-token", "")).resolves.toBeNull();
    await expect(requireAuthorizationDecisionApprover("valid-token", "a".repeat(129))).resolves.toBeNull();

    expect(session).not.toHaveBeenCalled();
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
  });

  it("does not reveal whether an unknown authorization request exists", async () => {
    db.authorizationRequest.findUnique.mockResolvedValue(null);

    await expect(requireAuthorizationDecisionApprover("valid-token", "request-1")).resolves.toBeNull();
    expect(canApprove).not.toHaveBeenCalled();
  });

  it("rejects a request from another organization before checking approval role", async () => {
    db.authorizationRequest.findUnique.mockResolvedValue({ organizationId: "org-2", branchId: "branch-1" });

    await expect(requireAuthorizationDecisionApprover("valid-token", "request-1")).resolves.toBeNull();
    expect(canApprove).not.toHaveBeenCalled();
  });

  it("rejects a request from another branch before checking approval role", async () => {
    db.authorizationRequest.findUnique.mockResolvedValue({ organizationId: "org-1", branchId: "branch-2" });

    await expect(requireAuthorizationDecisionApprover("valid-token", "request-1")).resolves.toBeNull();
    expect(canApprove).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user who cannot approve", async () => {
    canApprove.mockResolvedValue(false);

    await expect(requireAuthorizationDecisionApprover("valid-token", "request-1")).resolves.toBeNull();
    expect(canApprove).toHaveBeenCalledWith("user-1");
  });

  it("returns the authenticated context only after session, scope and role checks pass", async () => {
    await expect(requireAuthorizationDecisionApprover("valid-token", "request-1")).resolves.toEqual(validContext);
    expect(session).toHaveBeenCalledWith("valid-token");
    expect(db.authorizationRequest.findUnique).toHaveBeenCalledWith({
      where: { id: "request-1" },
      select: { organizationId: true, branchId: true }
    });
    expect(canApprove).toHaveBeenCalledWith("user-1");
  });
});
