import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestAuthorization, resolveAuthorization } = vi.hoisted(() => ({
  requestAuthorization: vi.fn(),
  resolveAuthorization: vi.fn(),
}));

vi.mock("../src/core/authorization", () => ({
  requestAuthorization,
  resolveAuthorization,
}));

import { postAuthorizationDecision, postAuthorizationRequest } from "../src/api/authorization";

beforeEach(() => vi.clearAllMocks());

describe("authorization decision input", () => {
  it("maps an invalid decision to HTTP 400", async () => {
    resolveAuthorization.mockRejectedValue(new Error("AUTHORIZATION_DECISION_INVALID"));

    const result = await postAuthorizationDecision({
      requestId: "request-1",
      approverId: "manager-1",
      decision: "PENDING" as any
    });

    expect(result).toEqual({
      status: 400,
      body: { error: "AUTHORIZATION_DECISION_INVALID" }
    });
  });

  it.each(["AUTHORIZATION_INTEGRITY_VIOLATION", "AUTHORIZATION_TARGET_INVALID"]) (
    "maps %s to HTTP 409 instead of exposing it as an internal error",
    async (errorCode) => {
      resolveAuthorization.mockRejectedValue(new Error(errorCode));

      const result = await postAuthorizationDecision({
        requestId: "request-1",
        approverId: "manager-1",
        decision: "APPROVED"
      });

      expect(result).toEqual({
        status: 409,
        body: { error: errorCode }
      });
    }
  );

  it("maps requester validation errors without changing their authorization semantics", async () => {
    requestAuthorization.mockRejectedValue(new Error("AUTHORIZATION_SCOPE_FORBIDDEN"));

    const result = await postAuthorizationRequest({
      organizationId: "org-1",
      branchId: "branch-1",
      requestedById: "user-1",
      type: "SALE_CANCEL",
      reason: "test",
      entityType: "Sale",
      entityId: "sale-1"
    });

    expect(result).toEqual({
      status: 403,
      body: { error: "AUTHORIZATION_SCOPE_FORBIDDEN" }
    });
  });
});
