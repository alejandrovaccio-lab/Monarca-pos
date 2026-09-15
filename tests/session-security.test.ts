import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  getSessionContext: vi.fn(),
  setAuthenticatedContext: vi.fn()
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    userSession: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany
    }
  }
}));

vi.mock("../src/core/context", () => ({
  getSessionContext: mocks.getSessionContext
}));

vi.mock("../src/core/auth-context", () => ({
  setAuthenticatedContext: mocks.setAuthenticatedContext
}));

import { requireBranchSession, requireSession } from "../src/middleware/auth";

const activeContext = {
  sessionId: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  user: { id: "user-1", status: "ACTIVE", organizationId: "org-1" },
  branch: { id: "branch-1", organizationId: "org-1" },
  roles: ["CAJERO"]
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({
    id: "session-1",
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  mocks.getSessionContext.mockResolvedValue(activeContext);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("session security", () => {
  it("validates the session and atomically touches lastSeenAt", async () => {
    const result = await requireSession("session-token");

    expect(result).toEqual(activeContext);
    expect(mocks.findUnique).toHaveBeenCalledOnce();
    expect(mocks.getSessionContext).toHaveBeenCalledWith("session-1");
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    expect(mocks.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        id: "session-1",
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) }
      },
      data: { lastSeenAt: expect.any(Date) }
    });
  });

  it("rejects a session if revocation wins before lastSeenAt is updated", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(requireSession("session-token")).resolves.toBeNull();
    expect(mocks.getSessionContext).toHaveBeenCalledWith("session-1");
    expect(mocks.updateMany).toHaveBeenCalledOnce();
  });

  it("rejects revoked sessions before loading application context", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: "session-1",
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: new Date()
    });

    await expect(requireSession("revoked-token")).resolves.toBeNull();
    expect(mocks.getSessionContext).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects expired sessions before loading application context", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: "session-1",
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null
    });

    await expect(requireSession("expired-token")).resolves.toBeNull();
    expect(mocks.getSessionContext).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an inactive user even when the session itself is active", async () => {
    mocks.getSessionContext.mockResolvedValueOnce({
      ...activeContext,
      user: { ...activeContext.user, status: "INACTIVE" }
    });

    await expect(requireSession("inactive-user-token")).resolves.toBeNull();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not set authenticated context for a different branch", async () => {
    await expect(requireBranchSession("session-token", "branch-2")).resolves.toBeNull();
    expect(mocks.setAuthenticatedContext).not.toHaveBeenCalled();
  });

  it("sets authenticated context only after session and branch checks pass", async () => {
    const result = await requireBranchSession("session-token", "branch-1");

    expect(result).toEqual(activeContext);
    expect(mocks.setAuthenticatedContext).toHaveBeenCalledWith({
      userId: "user-1",
      branchId: "branch-1",
      organizationId: "org-1"
    });
  });

  it("rejects malformed tokens and branch identifiers without database access", async () => {
    await expect(requireSession("t".repeat(257))).resolves.toBeNull();
    await expect(requireBranchSession("session-token", "b".repeat(129))).resolves.toBeNull();

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.getSessionContext).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
