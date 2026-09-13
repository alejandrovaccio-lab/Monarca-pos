import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: { authorizationRequest: { findUnique: vi.fn() } }
}));

vi.mock("../src/core/authorization", () => ({
  canApproveAuthorization: vi.fn(),
  hasPermission: vi.fn()
}));

vi.mock("../src/middleware/auth", () => ({
  requireBranchSession: vi.fn(),
  requireSession: vi.fn()
}));

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization } from "../src/core/authorization";
import { requireSession } from "../src/middleware/auth";
import { requireAuthorizationDecisionApprover } from "../src/middleware/authorization";

const db = prisma as any;
const mockedCanApprove = vi.mocked(canApproveAuthorization);
const mockedRequireSession = vi.mocked(requireSession);

const context = {
  sessionId: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  user: { status: "ACTIVE", organizationId: "org-1" }
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireSession.mockResolvedValue(context as any);
  db.authorizationRequest.findUnique.mockResolvedValue({
    organizationId: "org-1",
    branchId: "branch-1"
  });
  mockedCanApprove.mockResolvedValue(true);
});

describe("authorization middleware boundary", () => {
  it("rejects an empty request id before session or database access", async () => {
    await expect(requireAuthorizationDecisionApprover("token", "")).resolves.toBeNull();
    expect(mockedRequireSession).not.toHaveBeenCalled();
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an oversized request id before session or database access", async () => {
    await expect(requireAuthorizationDecisionApprover("token", "a".repeat(129))).resolves.toBeNull();
    expect(mockedRequireSession).not.toHaveBeenCalled();
    expect(db.authorizationRequest.findUnique).not.toHaveBeenCalled();
  });

  it("does not expose a request across organizations", async () => {
    db.authorizationRequest.findUnique.mockResolvedValue({
      organizationId: "org-2",
      branchId: "branch-1"
    });

    await expect(requireAuthorizationDecisionApprover("token", "auth-1")).resolves.toBeNull();
    expect(mockedCanApprove).not.toHaveBeenCalled();
  });

  it("does not expose a branch-scoped request to another branch", async () => {
    db.authorizationRequest.findUnique.mockResolvedValue({
      organizationId: "org-1",
      branchId: "branch-2"
    });

    await expect(requireAuthorizationDecisionApprover("token", "auth-1")).resolves.toBeNull();
    expect(mockedCanApprove).not.toHaveBeenCalled();
  });

  it("requires approver capability only after request scope is validated", async () => {
    mockedCanApprove.mockResolvedValue(false);

    await expect(requireAuthorizationDecisionApprover("token", "auth-1")).resolves.toBeNull();
    expect(mockedCanApprove).toHaveBeenCalledOnce();
  });
});
