import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    userSession: { findUnique: vi.fn() }
  }
}));

import { prisma } from "../src/lib/prisma";
import { getSessionContext } from "../src/core/context";

const db = prisma as any;

const baseSession = () => ({
  id: "session-1",
  userId: "user-1",
  branchId: "branch-1",
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  user: {
    id: "user-1",
    name: "Colaborador Prueba",
    email: "test@monarca.mx",
    status: "ACTIVE",
    organizationId: "org-1",
    branchAccess: [{ branchId: "branch-1" }],
    roles: [{ role: { name: "CAJERO" } }]
  },
  branch: {
    id: "branch-1",
    name: "Centro",
    code: "AGS-01",
    timezone: "America/Mexico_City",
    organizationId: "org-1"
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("session context security", () => {
  it("rejects an unknown session", async () => {
    db.userSession.findUnique.mockResolvedValueOnce(null);

    await expect(getSessionContext("missing-session")).resolves.toBeNull();
  });

  it("rejects a revoked session", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      ...baseSession(),
      revokedAt: new Date()
    });

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects an expired session", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      ...baseSession(),
      expiresAt: new Date(Date.now() - 1_000)
    });

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects an inactive user", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      ...baseSession(),
      user: { ...baseSession().user, status: "INACTIVE" }
    });

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a session without a branch", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      ...baseSession(),
      branchId: null,
      branch: null
    });

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a branch belonging to another organization", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      ...baseSession(),
      branch: { ...baseSession().branch, organizationId: "org-2" }
    });

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("rejects a branch that is not assigned to the user", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      ...baseSession(),
      user: { ...baseSession().user, branchAccess: [{ branchId: "branch-2" }] }
    });

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });

  it("returns the scoped context for a valid session", async () => {
    db.userSession.findUnique.mockResolvedValueOnce(baseSession());

    await expect(getSessionContext("session-1")).resolves.toEqual({
      sessionId: "session-1",
      userId: "user-1",
      branchId: "branch-1",
      user: expect.objectContaining({ id: "user-1", status: "ACTIVE" }),
      branch: expect.objectContaining({ id: "branch-1", organizationId: "org-1" }),
      roles: ["CAJERO"]
    });
  });

  it("does not expose an authorization path to a foreign branch", async () => {
    const session = baseSession();
    session.branchId = "branch-foreign";
    session.branch = {
      ...session.branch,
      id: "branch-foreign",
      organizationId: "org-2"
    };
    session.user.branchAccess = [{ branchId: "branch-foreign" }];
    db.userSession.findUnique.mockResolvedValueOnce(session);

    await expect(getSessionContext("session-1")).resolves.toBeNull();
  });
});
