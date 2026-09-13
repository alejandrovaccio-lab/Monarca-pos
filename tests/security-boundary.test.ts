import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: { userSession: { findUnique: vi.fn(), update: vi.fn() } }
}));

vi.mock("../src/core/context", () => ({
  getSessionContext: vi.fn()
}));

import { prisma } from "../src/lib/prisma";
import { getSessionContext } from "../src/core/context";
import { requireBranchSession, requireSession } from "../src/middleware/auth";

const db = prisma as any;
const getContext = getSessionContext as any;

const validSession = {
  id: "session-1",
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000)
};

const validContext = {
  sessionId: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  user: { status: "ACTIVE", organizationId: "org-1" },
  branch: { id: "branch-1", organizationId: "org-1" },
  roles: ["CAJERO"]
};

beforeEach(() => {
  vi.clearAllMocks();
  db.userSession.findUnique.mockResolvedValue(validSession);
  db.userSession.update.mockResolvedValue(validSession);
  getContext.mockResolvedValue(validContext);
});

describe("security boundary", () => {
  it("does not enter the context boundary for an empty or oversized token", async () => {
    await expect(requireSession("")).resolves.toBeNull();
    await expect(requireSession("a".repeat(257))).resolves.toBeNull();

    expect(db.userSession.findUnique).not.toHaveBeenCalled();
    expect(getContext).not.toHaveBeenCalled();
  });

  it("does not enter the context boundary for an unknown session", async () => {
    db.userSession.findUnique.mockResolvedValue(null);

    await expect(requireSession("unknown-token")).resolves.toBeNull();

    expect(getContext).not.toHaveBeenCalled();
  });

  it("does not enter the context boundary for revoked or expired sessions", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      ...validSession,
      revokedAt: new Date()
    });
    await expect(requireSession("revoked-token")).resolves.toBeNull();

    db.userSession.findUnique.mockResolvedValueOnce({
      ...validSession,
      expiresAt: new Date(Date.now() - 1_000)
    });
    await expect(requireSession("expired-token")).resolves.toBeNull();

    expect(getContext).not.toHaveBeenCalled();
  });

  it("treats a context rejected by integrity checks as unauthenticated", async () => {
    getContext.mockResolvedValue(null);

    await expect(requireSession("valid-token")).resolves.toBeNull();
  });

  it("enforces the selected branch at the middleware boundary", async () => {
    await expect(requireBranchSession("valid-token", "branch-2")).resolves.toBeNull();
    await expect(requireBranchSession("valid-token", "branch-1")).resolves.toMatchObject({
      branchId: "branch-1"
    });
  });

  it("rejects an empty or oversized branch id before entering the session boundary", async () => {
    await expect(requireBranchSession("valid-token", "")).resolves.toBeNull();
    await expect(requireBranchSession("valid-token", "a".repeat(129))).resolves.toBeNull();

    expect(db.userSession.findUnique).not.toHaveBeenCalled();
  });

  it("does not treat a mismatched branch as a valid authenticated context", async () => {
    getContext.mockResolvedValue({ ...validContext, branchId: "branch-9" });

    await expect(requireBranchSession("valid-token", "branch-1")).resolves.toBeNull();
  });
});
