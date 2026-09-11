import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    userSession: { findUnique: vi.fn() }
  }
}));

import { prisma } from "../src/lib/prisma";
import { getSessionContext } from "../src/core/context";

const db = prisma as any;

const sessionFixture = (overrides: Record<string, unknown> = {}) => ({
  id: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  user: {
    id: "user-1",
    organizationId: "org-1",
    status: "ACTIVE",
    roles: [{ role: { name: "CAJERO" } }],
    branchAccess: [{ branchId: "branch-1" }]
  },
  branch: { id: "branch-1", organizationId: "org-1", name: "Centro" },
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("session context", () => {
  it("returns context for a valid active session in an authorized branch", async () => {
    db.userSession.findUnique.mockResolvedValue(sessionFixture());

    const result = await getSessionContext("session-1");

    expect(result).toMatchObject({ sessionId: "session-1", userId: "user-1", branchId: "branch-1" });
    expect(result?.roles).toEqual(["CAJERO"]);
  });

  it("rejects revoked or expired sessions", async () => {
    db.userSession.findUnique.mockResolvedValueOnce(sessionFixture({ revokedAt: new Date(Date.now() - 1_000) }));
    await expect(getSessionContext("session-1")).resolves.toBeNull();

    db.userSession.findUnique.mockResolvedValueOnce(sessionFixture({ expiresAt: new Date(Date.now() - 1_000) }));
    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a session whose user is inactive", async () => {
    db.userSession.findUnique.mockResolvedValue(sessionFixture({
      user: { ...sessionFixture().user, status: "INACTIVE" }
    }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a session without a selected branch", async () => {
    db.userSession.findUnique.mockResolvedValue(sessionFixture({ branchId: null, branch: null }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects when the session branch is outside the user's current branch access", async () => {
    db.userSession.findUnique.mockResolvedValue(sessionFixture({
      user: { ...sessionFixture().user, branchAccess: [] }
    }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects when the session branch belongs to another organization", async () => {
    db.userSession.findUnique.mockResolvedValue(sessionFixture({
      branch: { id: "branch-1", organizationId: "org-2", name: "Otra" }
    }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });
});
