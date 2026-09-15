import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    branch: { findUnique: vi.fn() },
    userBranchAccess: { findUnique: vi.fn() }
  }
}));

import { prisma } from "../src/lib/prisma";
import { canAccessBranch } from "../src/core/branch-access";

const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("branch access security", () => {
  it("allows access only for an active user in the same organization", async () => {
    db.user.findUnique.mockResolvedValue({ organizationId: "org-1", status: "ACTIVE" });
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.userBranchAccess.findUnique.mockResolvedValue({ userId: "user-1", branchId: "branch-1" });

    await expect(canAccessBranch("user-1", "branch-1")).resolves.toBe(true);
  });

  it("denies cross-organization branch access even when an access row exists", async () => {
    db.user.findUnique.mockResolvedValue({ organizationId: "org-1", status: "ACTIVE" });
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-2" });
    db.userBranchAccess.findUnique.mockResolvedValue({ userId: "user-1", branchId: "branch-2" });

    await expect(canAccessBranch("user-1", "branch-2")).resolves.toBe(false);
    expect(db.userBranchAccess.findUnique).not.toHaveBeenCalled();
  });

  it("denies inactive users before checking branch access", async () => {
    db.user.findUnique.mockResolvedValue({ organizationId: "org-1", status: "INACTIVE" });
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" });

    await expect(canAccessBranch("user-1", "branch-1")).resolves.toBe(false);
    expect(db.userBranchAccess.findUnique).not.toHaveBeenCalled();
  });

  it("denies unknown users or branches", async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    db.branch.findUnique.mockResolvedValueOnce({ organizationId: "org-1" });
    await expect(canAccessBranch("user-1", "branch-1")).resolves.toBe(false);

    db.user.findUnique.mockResolvedValueOnce({ organizationId: "org-1", status: "ACTIVE" });
    db.branch.findUnique.mockResolvedValueOnce(null);
    await expect(canAccessBranch("user-1", "branch-1")).resolves.toBe(false);
  });

  it("denies malformed identifiers without database access", async () => {
    await expect(canAccessBranch("", "branch-1")).resolves.toBe(false);
    await expect(canAccessBranch("user-1", "")).resolves.toBe(false);
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.branch.findUnique).not.toHaveBeenCalled();
    expect(db.userBranchAccess.findUnique).not.toHaveBeenCalled();
  });
});
