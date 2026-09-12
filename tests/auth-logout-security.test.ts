import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  login: vi.fn(),
  requireSession: vi.fn()
}));

vi.mock("../src/core/auth", () => ({
  login: mocks.login,
  logout: mocks.logout
}));

vi.mock("../src/middleware/auth", () => ({
  requireSession: mocks.requireSession
}));

import { postLogout } from "../src/api/auth";

describe("secure logout API boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes a valid active session", async () => {
    mocks.logout.mockResolvedValueOnce({ id: "session-1", revokedAt: new Date() });

    const result = await postLogout("valid-token");

    expect(result.status).toBe(204);
    expect(result.body).toBeNull();
    expect(mocks.logout).toHaveBeenCalledWith("valid-token");
  });

  it("returns unauthenticated when the token does not map to an active session", async () => {
    mocks.logout.mockResolvedValueOnce(null);

    const result = await postLogout("unknown-token");

    expect(result).toEqual({ status: 401, body: { error: "UNAUTHENTICATED" } });
  });

  it("returns unauthenticated when the session is already revoked or expired", async () => {
    mocks.logout.mockResolvedValueOnce(null);

    const result = await postLogout("stale-token");

    expect(result).toEqual({ status: 401, body: { error: "UNAUTHENTICATED" } });
  });

  it("does not leak unexpected logout failures", async () => {
    mocks.logout.mockRejectedValueOnce(new Error("database failure"));

    const result = await postLogout("valid-token");

    expect(result).toEqual({
      status: 500,
      body: { error: "INTERNAL_SERVER_ERROR", message: "Internal server error." }
    });
  });
});
