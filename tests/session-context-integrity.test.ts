import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: { userSession: { findUnique: vi.fn() } }
}));

import { prisma } from "../src/lib/prisma";
import { getSessionContext } from "../src/core/context";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

const baseSession = (overrides: Record<string, unknown> = {}) => ({
  id: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  user: {
    id: "user-1",
    name: "Colaborador",
    email: "test@monarca.mx",
    status: "ACTIVE",
    organizationId: "org-1",
    roles: [{ role: { name: "CAJERO" } }],
    branchAccess: [{ branchId: "branch-1" }]
  },
  branch: {
    id: "branch-1",
    name: "Centro",
    code: "AGS-01",
    timezone: "America/Mexico_City",
    organizationId: "org-1"
  },
  ...overrides
});

describe("session context integrity", () => {
  it("returns the expected context for a valid session", async () => {
    db.userSession.findUnique.mockResolvedValue(baseSession());

    await expect(getSessionContext("session-1")).resolves.toMatchObject({
      sessionId: "session-1",
      userId: "user-1",
      branchId: "branch-1",
      roles: ["CAJERO"]
    });
  });

  it("rejects a session whose branch belongs to another organization", async () => {
    db.userSession.findUnique.mockResolvedValue(baseSession({
      branch: { ...baseSession().branch, organizationId: "org-2" }
    }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a session whose branch is not assigned to the user", async () => {
    db.userSession.findUnique.mockResolvedValue(baseSession({
      user: { ...baseSession().user, branchAccess: [{ branchId: "branch-9" }] }
    }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects an inactive user even when the session itself is otherwise valid", async () => {
    db.userSession.findUnique.mockResolvedValue(baseSession({
      user: { ...baseSession().user, status: "INACTIVE" }
    }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a session without a selected branch", async () => {
    db.userSession.findUnique.mockResolvedValue(baseSession({ branchId: null }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a session whose branch relation is missing", async () => {
    db.userSession.findUnique.mockResolvedValue(baseSession({ branch: null }));

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects revoked and expired sessions", async () => {
    db.userSession.findUnique.mockResolvedValueOnce(baseSession({ revokedAt: new Date() }));
    await expect(getSessionContext("session-1")).resolves.toBeNull();

    db.userSession.findUnique.mockResolvedValueOnce(baseSession({ expiresAt: new Date(Date.now() - 1_000) }));
    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });
});
