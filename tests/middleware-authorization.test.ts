import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireBranchSession, requireSession } = vi.hoisted(() => ({
  requireBranchSession: vi.fn(),
  requireSession: vi.fn(),
}));

const { hasPermission, canApproveAuthorization } = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  canApproveAuthorization: vi.fn(),
}));

const { findAuthorizationRequest } = vi.hoisted(() => ({
  findAuthorizationRequest: vi.fn(),
}));

vi.mock("../src/middleware/auth", () => ({ requireBranchSession, requireSession }));
vi.mock("../src/core/authorization", () => ({ hasPermission, canApproveAuthorization }));
vi.mock("../src/lib/prisma", () => ({
  prisma: {
    authorizationRequest: { findUnique: findAuthorizationRequest },
  },
}));

import {
  requireAuthorizationDecisionApprover,
  requireBranchAuthorizationApprover,
  requireBranchPermission,
} from "../src/middleware/authorization";

describe("authorization middleware boundary", () => {
  const context = {
    sessionId: "session-1",
    userId: "user-1",
    branchId: "branch-1",
    user: { id: "user-1", status: "ACTIVE", organizationId: "org-1" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns authenticated context when session, branch and permission are valid", async () => {
    requireBranchSession.mockResolvedValue(context);
    hasPermission.mockResolvedValue(true);

    await expect(
      requireBranchPermission("token", "branch-1", "SALE_CREATE")
    ).resolves.toEqual(context);

    expect(requireBranchSession).toHaveBeenCalledWith("token", "branch-1");
    expect(hasPermission).toHaveBeenCalledWith("user-1", "SALE_CREATE");
  });

  it("rejects an invalid session before checking permission", async () => {
    requireBranchSession.mockResolvedValue(null);

    await expect(
      requireBranchPermission("bad-token", "branch-1", "SALE_CREATE")
    ).resolves.toBeNull();

    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("rejects a session that does not satisfy the requested branch", async () => {
    requireBranchSession.mockResolvedValue(null);

    await expect(
      requireBranchPermission("token", "branch-2", "SALE_CREATE")
    ).resolves.toBeNull();

    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user without the required permission", async () => {
    requireBranchSession.mockResolvedValue(context);
    hasPermission.mockResolvedValue(false);

    await expect(
      requireBranchPermission("token", "branch-1", "SALE_VOID")
    ).resolves.toBeNull();

    expect(hasPermission).toHaveBeenCalledWith("user-1", "SALE_VOID");
  });

  it("returns context for an authenticated branch-scoped authorization approver", async () => {
    requireBranchSession.mockResolvedValue(context);
    canApproveAuthorization.mockResolvedValue(true);

    await expect(
      requireBranchAuthorizationApprover("token", "branch-1")
    ).resolves.toEqual(context);

    expect(canApproveAuthorization).toHaveBeenCalledWith("user-1");
  });

  it("rejects an authenticated user who cannot approve authorizations", async () => {
    requireBranchSession.mockResolvedValue(context);
    canApproveAuthorization.mockResolvedValue(false);

    await expect(
      requireBranchAuthorizationApprover("token", "branch-1")
    ).resolves.toBeNull();
  });

  it("rejects an invalid session before checking approver authority", async () => {
    requireBranchSession.mockResolvedValue(null);

    await expect(
      requireBranchAuthorizationApprover("bad-token", "branch-1")
    ).resolves.toBeNull();

    expect(canApproveAuthorization).not.toHaveBeenCalled();
  });

  it("derives a branch-scoped decision from the authorization request instead of client input", async () => {
    requireSession.mockResolvedValue(context);
    findAuthorizationRequest.mockResolvedValue({ organizationId: "org-1", branchId: "branch-1" });
    canApproveAuthorization.mockResolvedValue(true);

    await expect(
      requireAuthorizationDecisionApprover("token", "request-1")
    ).resolves.toEqual(context);

    expect(findAuthorizationRequest).toHaveBeenCalledWith({
      where: { id: "request-1" },
      select: { organizationId: true, branchId: true },
    });
    expect(canApproveAuthorization).toHaveBeenCalledWith("user-1");
  });

  it("rejects a decision when the session branch differs from the authorization request", async () => {
    requireSession.mockResolvedValue(context);
    findAuthorizationRequest.mockResolvedValue({ organizationId: "org-1", branchId: "branch-2" });

    await expect(
      requireAuthorizationDecisionApprover("token", "request-2")
    ).resolves.toBeNull();

    expect(canApproveAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a decision when the session organization differs from the authorization request", async () => {
    requireSession.mockResolvedValue(context);
    findAuthorizationRequest.mockResolvedValue({ organizationId: "org-2", branchId: "branch-1" });

    await expect(
      requireAuthorizationDecisionApprover("token", "request-3")
    ).resolves.toBeNull();

    expect(canApproveAuthorization).not.toHaveBeenCalled();
  });

  it("allows a global authorization from any branch in the same organization", async () => {
    requireSession.mockResolvedValue(context);
    findAuthorizationRequest.mockResolvedValue({ organizationId: "org-1", branchId: null });
    canApproveAuthorization.mockResolvedValue(true);

    await expect(
      requireAuthorizationDecisionApprover("token", "request-global")
    ).resolves.toEqual(context);
  });

  it("rejects a missing authorization request before checking approver authority", async () => {
    requireSession.mockResolvedValue(context);
    findAuthorizationRequest.mockResolvedValue(null);

    await expect(
      requireAuthorizationDecisionApprover("token", "missing")
    ).resolves.toBeNull();

    expect(canApproveAuthorization).not.toHaveBeenCalled();
  });
});
