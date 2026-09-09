import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn() },
  },
}));

import { prisma } from "../src/lib/prisma";
import { requestAuthorization } from "../src/core/authorization";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({
    status: "ACTIVE",
    organizationId: "org-1",
    branchAccess: [{ branchId: "branch-1" }],
  });
  db.authorizationRequest.create.mockResolvedValue({ id: "auth-1", status: "PENDING" });
});

const validInput = {
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  type: "SALE_CANCEL",
  reason: "Solicitud válida",
  entityType: "Sale",
  entityId: "sale-1",
};

describe("authorization request core validation", () => {
  it("rejects an unknown authorization type before persistence", async () => {
    await expect(requestAuthorization({ ...validInput, type: "FAKE_PRIVILEGE" }))
      .rejects.toThrow("AUTHORIZATION_TYPE_INVALID");
    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a blank reason before persistence", async () => {
    await expect(requestAuthorization({ ...validInput, reason: "   " }))
      .rejects.toThrow("AUTHORIZATION_REASON_REQUIRED");
    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a blank entity type before persistence", async () => {
    await expect(requestAuthorization({ ...validInput, entityType: "  " }))
      .rejects.toThrow("AUTHORIZATION_ENTITY_REQUIRED");
    expect(db.authorizationRequest.create).not.toHaveBeenCalled();
  });

  it("persists a valid authorization request", async () => {
    await expect(requestAuthorization(validInput)).resolves.toMatchObject({ id: "auth-1", status: "PENDING" });
    expect(db.authorizationRequest.create).toHaveBeenCalledOnce();
  });
});
