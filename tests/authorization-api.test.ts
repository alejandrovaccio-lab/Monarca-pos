import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/authorization", () => ({
  requestAuthorization: vi.fn(),
  resolveAuthorization: vi.fn()
}));

import { requestAuthorization, resolveAuthorization } from "../src/core/authorization";
import { postAuthorizationDecision, postAuthorizationRequest } from "../src/api/authorization";

const mockedRequest = vi.mocked(requestAuthorization);
const mockedResolve = vi.mocked(resolveAuthorization);

beforeEach(() => vi.clearAllMocks());

describe("authorization API boundary", () => {
  it("returns 201 for a successful authorization request", async () => {
    mockedRequest.mockResolvedValue({ id: "auth-1", status: "PENDING" } as any);
    await expect(postAuthorizationRequest({} as any)).resolves.toEqual({
      status: 201,
      body: { id: "auth-1", status: "PENDING" }
    });
  });

  it("returns 200 for a successful authorization decision", async () => {
    mockedResolve.mockResolvedValue({ id: "auth-1", status: "APPROVED" } as any);
    await expect(postAuthorizationDecision({ approverId: "user-1" } as any, "user-1")).resolves.toEqual({
      status: 200,
      body: { id: "auth-1", status: "APPROVED" }
    });
  });

  it.each([
    ["AUTHORIZATION_APPROVER_REQUIRED", 403],
    ["AUTHORIZATION_CRITICAL_APPROVER_REQUIRED", 403],
    ["AUTHORIZATION_REQUESTER_REQUIRED", 403],
    ["AUTHORIZATION_SCOPE_FORBIDDEN", 403],
    ["AUTHORIZATION_APPROVER_MISMATCH", 403],
    ["SELF_APPROVAL_NOT_ALLOWED", 403],
    ["AUTHORIZATION_NOT_FOUND", 404],
    ["AUTHORIZATION_ALREADY_RESOLVED", 409],
    ["AUTHORIZATION_INTEGRITY_VIOLATION", 409],
    ["AUTHORIZATION_TARGET_INVALID", 409],
    ["AUTHORIZATION_TYPE_INVALID", 400],
    ["AUTHORIZATION_REASON_REQUIRED", 400],
    ["AUTHORIZATION_REASON_TOO_LONG", 400],
    ["AUTHORIZATION_ENTITY_REQUIRED", 400],
    ["AUTHORIZATION_ENTITY_TYPE_TOO_LONG", 400],
    ["AUTHORIZATION_DECISION_INVALID", 400],
    ["AUTHORIZATION_NOTES_TOO_LONG", 400],
    ["AUTHORIZATION_ORGANIZATION_INVALID", 400],
    ["AUTHORIZATION_BRANCH_INVALID", 400],
    ["AUTHORIZATION_REQUESTER_INVALID", 400],
    ["AUTHORIZATION_ENTITY_ID_INVALID", 400],
    ["AUTHORIZATION_REQUEST_ID_INVALID", 400],
    ["AUTHORIZATION_APPROVER_ID_INVALID", 400]
  ])("maps %s to HTTP %i", async (code, status) => {
    mockedRequest.mockRejectedValue(new Error(code));
    await expect(postAuthorizationRequest({} as any)).resolves.toEqual({
      status,
      body: { error: code }
    });
  });

  it("does not leak unexpected internal error details from request", async () => {
    mockedRequest.mockRejectedValue(new Error("DATABASE_PASSWORD_OR_STACK_DETAIL"));
    await expect(postAuthorizationRequest({} as any)).resolves.toEqual({
      status: 500,
      body: { error: "INTERNAL_SERVER_ERROR" }
    });
  });

  it("does not leak unexpected internal error details from decision", async () => {
    mockedResolve.mockRejectedValue(new Error("PRISMA_INTERNAL_DETAIL"));
    await expect(postAuthorizationDecision({ approverId: "user-1" } as any, "user-1")).resolves.toEqual({
      status: 500,
      body: { error: "INTERNAL_SERVER_ERROR" }
    });
  });

  it("does not expose arbitrary thrown values", async () => {
    mockedRequest.mockRejectedValue("secret-internal-value");
    await expect(postAuthorizationRequest({} as any)).resolves.toEqual({
      status: 500,
      body: { error: "INTERNAL_SERVER_ERROR" }
    });
  });
});
