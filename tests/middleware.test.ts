import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    userSession: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
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

const session = (overrides = {}) => ({
  id: "session-1",
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  ...overrides
});

const context = (overrides = {}) => ({
  sessionId: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  user: { id: "user-1", name: "Colaborador", status: "ACTIVE" },
  branch: { id: "branch-1", name: "Centro", code: "AGS-01", timezone: "America/Mexico_City" },
  roles: ["CAJERO"],
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  db.userSession.update.mockResolvedValue({});
  db.userSession.findUnique.mockResolvedValue(session());
  getContext.mockResolvedValue(context());
});

describe("session middleware", () => {
  it("rejects a missing token", async () => {
    expect(await requireSession("")).toBeNull();
    expect(db.userSession.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an expired session", async () => {
    db.userSession.findUnique.mockResolvedValue(session({ expiresAt: new Date(Date.now() - 1) }));
    expect(await requireSession("token")).toBeNull();
  });

  it("rejects a revoked session", async () => {
    db.userSession.findUnique.mockResolvedValue(session({ revokedAt: new Date() }));
    expect(await requireSession("token")).toBeNull();
  });

  it("refreshes lastSeenAt for a valid session", async () => {
    const result = await requireSession("token");
    expect(result).toBeTruthy();
    expect(db.userSession.update).toHaveBeenCalledOnce();
  });

  it("requires the requested branch to match the active session branch", async () => {
    expect(await requireBranchSession("token", "branch-1")).toBeTruthy();
    expect(await requireBranchSession("token", "branch-2")).toBeNull();
  });

  it("rejects an empty branch id", async () => {
    expect(await requireBranchSession("token", "")).toBeNull();
  });
});
