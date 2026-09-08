import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireBranchSession } = vi.hoisted(() => ({
  requireBranchSession: vi.fn(),
}));

const { hasPermission, canApproveAuthorization } = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  canApproveAuthorization: vi.fn(),
}));

vi.mock("../src/middleware/auth", () => ({ requireBranchSession }));
vi.mock("../src/core/authorization", () => ({ hasPermission, canApproveAuthorization }));

import {
  requireBranchAuthorizationApprover,
  requireBranchPermission,
} from "../src/middleware/authorization";

describe("authorization middleware boundary", () => {
  const context = {
    sessionId: "session-1",
    userId: "user-1",
    organizationId: "org-1",
    branchId: "branch-1",
    user: { id: "user-1", status: "ACTIVE" },
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
});
