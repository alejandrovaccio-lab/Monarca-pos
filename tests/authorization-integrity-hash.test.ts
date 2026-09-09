import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authorizationRequest: { create: vi.fn() },
  },
}));

import { prisma } from "../src/lib/prisma";
import {
  authorizationIntegrityHash,
  requestAuthorization,
} from "../src/core/authorization";

const db = prisma as any;

const validInput = {
  organizationId: "org-1",
  branchId: "branch-1",
  requestedById: "cashier-1",
  type: "SALE_CANCEL",
  reason: "Solicitud válida",
  entityType: "Sale",
  entityId: "sale-1",
  beforeData: { total: 120, status: "COMPLETED" },
  requestedData: { total: 120, status: "CANCELLED" },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({
    status: "ACTIVE",
    organizationId: "org-1",
    branchAccess: [{ branchId: "branch-1" }],
  });
  db.authorizationRequest.create.mockResolvedValue({ id: "auth-1", status: "PENDING" });
});

describe("authorization integrity hash", () => {
  it("produces a stable SHA-256 hash for the same authorization payload", () => {
    const first = authorizationIntegrityHash(validInput);
    const second = authorizationIntegrityHash({
      ...validInput,
      requestedData: { status: "CANCELLED", total: 120 },
      beforeData: { status: "COMPLETED", total: 120 },
    });

    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("changes when an authorization-bound field changes", () => {
    const original = authorizationIntegrityHash(validInput);
    const changed = authorizationIntegrityHash({ ...validInput, entityId: "sale-2" });

    expect(changed).not.toBe(original);
  });

  it("persists the integrity hash when creating an authorization request", async () => {
    await requestAuthorization(validInput);

    const call = db.authorizationRequest.create.mock.calls[0][0];
    expect(call.data.integrityHash).toBe(authorizationIntegrityHash(validInput));
    expect(call.data.integrityHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
