import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    userSession: { findUnique: vi.fn(), update: vi.fn() }
  }
}));

vi.mock("../src/core/context", () => ({
  getSessionContext: vi.fn()
}));

import { prisma } from "../src/lib/prisma";
import { getSessionContext } from "../src/core/context";
import { requireBranchSession, requireSession } from "../src/middleware/auth";

const db = prisma as any;
const getContext = getSessionContext as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.userSession.update.mockResolvedValue({ id: "session-1" });
});

describe("session authentication middleware", () => {
  it("rejects an empty token", async () => {
    await expect(requireSession("")).resolves.toBeNull();
    expect(db.userSession.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an oversized token before hashing or querying", async () => {
    await expect(requireSession("a".repeat(257))).resolves.toBeNull();
    expect(db.userSession.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an unknown, revoked, or expired session before loading context", async () => {
    db.userSession.findUnique.mockResolvedValueOnce(null);
    await expect(requireSession("token-1")).resolves.toBeNull();

    db.userSession.findUnique.mockResolvedValueOnce({
      id: "session-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000)
    });
    await expect(requireSession("token-2")).resolves.toBeNull();

    db.userSession.findUnique.mockResolvedValueOnce({
      id: "session-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1_000)
    });
    await expect(requireSession("token-3")).resolves.toBeNull();

    expect(getContext).not.toHaveBeenCalled();
  });

  it("rejects when the session context is no longer valid", async () => {
    db.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    getContext.mockResolvedValue(null);

    await expect(requireSession("token-1")).resolves.toBeNull();
    expect(db.userSession.update).not.toHaveBeenCalled();
  });

  it("refreshes lastSeenAt for a valid session", async () => {
    db.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    getContext.mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1",
      branchId: "branch-1",
      user: { status: "ACTIVE" }
    });

    const result = await requireSession("token-1");

    expect(result).toMatchObject({ sessionId: "session-1", branchId: "branch-1" });
    expect(db.userSession.update).toHaveBeenCalledOnce();
    expect(db.userSession.update.mock.calls[0][0]).toMatchObject({
      where: { id: "session-1" }
    });
    expect(db.userSession.update.mock.calls[0][0].data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("rejects an empty branch id without touching the session", async () => {
    await expect(requireBranchSession("token-1", "")).resolves.toBeNull();
    expect(db.userSession.findUnique).not.toHaveBeenCalled();
  });

  it("enforces the selected branch", async () => {
    db.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    getContext.mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1",
      branchId: "branch-1",
      user: { status: "ACTIVE" }
    });

    await expect(requireBranchSession("token-1", "branch-2")).resolves.toBeNull();
    await expect(requireBranchSession("token-1", "branch-1")).resolves.toMatchObject({ branchId: "branch-1" });
  });
});
