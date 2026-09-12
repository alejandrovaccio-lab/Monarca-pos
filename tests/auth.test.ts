import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    authCredential: { findUnique: vi.fn() },
    userSession: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() }
  }
}));

vi.mock("../src/core/password", () => ({
  verifyPassword: vi.fn(async () => true)
}));

import { prisma } from "../src/lib/prisma";
import { login, logout } from "../src/core/auth";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.userSession.create.mockResolvedValue({
    id: "session-1",
    expiresAt: new Date(Date.now() + 86400000)
  });
  db.userSession.findUnique.mockResolvedValue({
    id: "session-1",
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });
  db.userSession.update.mockResolvedValue({ id: "session-1", revokedAt: new Date() });
});

const activeUser = (
  branches: Array<{
    id: string;
    name: string;
    code: string;
    timezone: string;
    organizationId?: string;
  }>
) => ({
  id: "user-1",
  name: "Colaborador Prueba",
  email: "test@monarca.mx",
  status: "ACTIVE",
  organizationId: "org-1",
  roles: [{ role: { name: "CAJERO" } }],
  branchAccess: branches.map((branch) => ({
    branch: { organizationId: "org-1", ...branch }
  }))
});

describe("authentication", () => {
  it("creates a session for valid credentials and one branch", async () => {
    const branch = { id: "branch-1", name: "Sucursal Centro", code: "AGS-01", timezone: "America/Mexico_City" };
    db.user.findFirst.mockResolvedValue(activeUser([branch]));
    db.authCredential.findUnique.mockResolvedValue({ passwordHash: "hash" });

    const result = await login("TEST@MONARCA.MX", "correct-password");

    expect(result.ok).toBe(true);
    expect(db.userSession.create).toHaveBeenCalledOnce();
    expect(db.userSession.create.mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("requires branch selection when the collaborator has multiple branches", async () => {
    const branches = [
      { id: "branch-1", name: "Centro", code: "AGS-01", timezone: "America/Mexico_City" },
      { id: "branch-2", name: "Norte", code: "AGS-02", timezone: "America/Mexico_City" }
    ];
    db.user.findFirst.mockResolvedValue(activeUser(branches));
    db.authCredential.findUnique.mockResolvedValue({ passwordHash: "hash" });

    const result = await login("test@monarca.mx", "correct-password");

    expect(result).toMatchObject({ ok: false, reason: "BRANCH_SELECTION_REQUIRED" });
    expect(db.userSession.create).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized branch", async () => {
    const branch = { id: "branch-1", name: "Centro", code: "AGS-01", timezone: "America/Mexico_City" };
    db.user.findFirst.mockResolvedValue(activeUser([branch]));
    db.authCredential.findUnique.mockResolvedValue({ passwordHash: "hash" });

    const result = await login("test@monarca.mx", "correct-password", "branch-999");

    expect(result).toMatchObject({ ok: false, reason: "BRANCH_ACCESS_DENIED" });
    expect(db.userSession.create).not.toHaveBeenCalled();
  });

  it("filters branch access that belongs to another organization", async () => {
    const sameOrgBranch = {
      id: "branch-1",
      name: "Centro",
      code: "AGS-01",
      timezone: "America/Mexico_City"
    };
    const foreignOrgBranch = {
      id: "branch-foreign",
      name: "Sucursal Externa",
      code: "EXT-01",
      timezone: "America/Mexico_City",
      organizationId: "org-2"
    };
    db.user.findFirst.mockResolvedValue(activeUser([sameOrgBranch, foreignOrgBranch]));
    db.authCredential.findUnique.mockResolvedValue({ passwordHash: "hash" });

    const result = await login("test@monarca.mx", "correct-password", "branch-foreign");

    expect(result).toMatchObject({ ok: false, reason: "BRANCH_ACCESS_DENIED" });
    expect(db.userSession.create).not.toHaveBeenCalled();
  });

  it("rejects oversized email, password, and branch identifiers before database access", async () => {
    await expect(login("a".repeat(255), "password")).resolves.toMatchObject({ ok: false, reason: "INVALID_CREDENTIALS" });
    await expect(login("test@monarca.mx", "p".repeat(257))).resolves.toMatchObject({ ok: false, reason: "INVALID_CREDENTIALS" });
    await expect(login("test@monarca.mx", "password", "b".repeat(129))).resolves.toMatchObject({ ok: false, reason: "BRANCH_ACCESS_DENIED" });

    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.authCredential.findUnique).not.toHaveBeenCalled();
    expect(db.userSession.create).not.toHaveBeenCalled();
  });

  it("rejects inactive or unknown users", async () => {
    db.user.findFirst.mockResolvedValue(null);

    const result = await login("inactive@monarca.mx", "password");

    expect(result).toMatchObject({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("revokes a session on logout", async () => {
    await logout("session-token");
    expect(db.userSession.findUnique).toHaveBeenCalledOnce();
    expect(db.userSession.update).toHaveBeenCalledOnce();
    expect(db.userSession.update.mock.calls[0][0]).toMatchObject({
      where: { id: "session-1" },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it("returns null when logout receives an unknown session", async () => {
    db.userSession.findUnique.mockResolvedValueOnce(null);

    await expect(logout("unknown-token")).resolves.toBeNull();
    expect(db.userSession.update).not.toHaveBeenCalled();
  });

  it("returns null when logout receives an already revoked session", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      id: "session-1",
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: new Date()
    });

    await expect(logout("revoked-token")).resolves.toBeNull();
    expect(db.userSession.update).not.toHaveBeenCalled();
  });

  it("returns null when logout receives an expired session", async () => {
    db.userSession.findUnique.mockResolvedValueOnce({
      id: "session-1",
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null
    });

    await expect(logout("expired-token")).resolves.toBeNull();
    expect(db.userSession.update).not.toHaveBeenCalled();
  });
});
