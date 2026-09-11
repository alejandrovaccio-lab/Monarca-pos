import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestAuthorization, resolveAuthorization } = vi.hoisted(() => ({
  requestAuthorization: vi.fn(),
  resolveAuthorization: vi.fn()
}));

vi.mock("../src/core/authorization", () => ({
  requestAuthorization,
  resolveAuthorization
}));

import { postAuthorizationRequest, postAuthorizationDecision } from "../src/api/authorization";

describe("authorization API input boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([null, undefined, [], "text", 123, true])("rejects non-object request body: %p", async (input) => {
    const result = await postAuthorizationRequest(input as never);

    expect(result).toEqual({ status: 400, body: { error: "INVALID_REQUEST" } });
    expect(requestAuthorization).not.toHaveBeenCalled();
  });

  it("accepts an object request and delegates to the core", async () => {
    const input = { organizationId: "org-1", requestedById: "user-1", type: "PRICE_CHANGE", reason: "Seasonal update" };
    requestAuthorization.mockResolvedValueOnce({ id: "auth-1" });

    const result = await postAuthorizationRequest(input);

    expect(result).toEqual({ status: 201, body: { id: "auth-1" } });
    expect(requestAuthorization).toHaveBeenCalledWith(input);
  });

  it.each([null, undefined, [], "text", 123, true])("rejects non-object decision body: %p", async (input) => {
    const result = await postAuthorizationDecision(input as never);

    expect(result).toEqual({ status: 400, body: { error: "INVALID_REQUEST" } });
    expect(resolveAuthorization).not.toHaveBeenCalled();
  });

  it("accepts an object decision and delegates to the core", async () => {
    const input = { requestId: "auth-1", approverId: "manager-1", decision: "APPROVE" };
    resolveAuthorization.mockResolvedValueOnce({ id: "auth-1", status: "APPROVED" });

    const result = await postAuthorizationDecision(input);

    expect(result).toEqual({ status: 200, body: { id: "auth-1", status: "APPROVED" } });
    expect(resolveAuthorization).toHaveBeenCalledWith(input);
  });
});
