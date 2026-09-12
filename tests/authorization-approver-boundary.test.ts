import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/authorization", () => ({
  requestAuthorization: vi.fn(),
  resolveAuthorization: vi.fn()
}));

import { resolveAuthorization } from "../src/core/authorization";
import { postAuthorizationDecision } from "../src/api/authorization";

const mockedResolve = vi.mocked(resolveAuthorization);

const decision = {
  requestId: "auth-1",
  approverId: "user-1",
  decision: "APPROVED" as const
};

beforeEach(() => vi.clearAllMocks());

describe("authenticated approver boundary", () => {
  it("rejects an approver identity mismatch before entering the core authorization flow", async () => {
    await expect(postAuthorizationDecision(decision, "user-2")).resolves.toEqual({
      status: 403,
      body: { error: "AUTHORIZATION_APPROVER_MISMATCH" }
    });

    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("passes a decision to the core flow when the authenticated user matches approverId", async () => {
    mockedResolve.mockResolvedValue({ id: "auth-1", status: "APPROVED" } as any);

    await expect(postAuthorizationDecision(decision, "user-1")).resolves.toEqual({
      status: 200,
      body: { id: "auth-1", status: "APPROVED" }
    });

    expect(mockedResolve).toHaveBeenCalledOnce();
    expect(mockedResolve).toHaveBeenCalledWith(decision);
  });

  it("rejects a missing authenticated identity before entering the core flow", async () => {
    await expect(postAuthorizationDecision(decision, "")).resolves.toEqual({
      status: 400,
      body: { error: "INVALID_REQUEST" }
    });

    expect(mockedResolve).not.toHaveBeenCalled();
  });
});
