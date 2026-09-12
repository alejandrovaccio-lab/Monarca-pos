import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/auth", () => ({
  login: vi.fn(),
  logout: vi.fn()
}));

vi.mock("../src/middleware/auth", () => ({
  requireSession: vi.fn()
}));

import { login, logout } from "../src/core/auth";
import { requireSession } from "../src/middleware/auth";
import { getMe, postLogin, postLogout } from "../src/api/auth";

const mockedLogin = vi.mocked(login);
const mockedLogout = vi.mocked(logout);
const mockedRequireSession = vi.mocked(requireSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication API", () => {
  it("rejects malformed login bodies before calling the core", async () => {
    const invalidInputs = [null, undefined, [], "text", 123, true, { email: "test@monarca.mx", password: 123 }, { email: "test@monarca.mx", password: "secret", branchId: 123 }, { email: "   ", password: "secret" }];

    for (const input of invalidInputs) {
      const result = await postLogin(input as never);
      expect(result).toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
    }

    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it("rejects oversized login credentials before calling the core", async () => {
    await expect(postLogin({ email: "a".repeat(255), password: "secret" })).resolves.toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
    await expect(postLogin({ email: "test@monarca.mx", password: "p".repeat(257) })).resolves.toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
    await expect(postLogin({ email: "test@monarca.mx", password: "secret", branchId: "b".repeat(129) })).resolves.toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it("rejects class instances as login bodies", async () => {
    class LoginPayload {
      email = "test@monarca.mx";
      password = "secret";
    }

    const result = await postLogin(new LoginPayload() as never);

    expect(result).toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it("maps branch selection to HTTP 409 and preserves branch choices", async () => {
    mockedLogin.mockResolvedValue({
      ok: false,
      reason: "BRANCH_SELECTION_REQUIRED",
      branches: [{ id: "branch-1", name: "Centro", code: "AGS-01", timezone: "America/Mexico_City" }]
    } as any);

    const result = await postLogin({ email: "test@monarca.mx", password: "secret" });

    expect(result).toEqual({
      status: 409,
      body: {
        error: "BRANCH_SELECTION_REQUIRED",
        message: "Select a branch to continue.",
        branches: [{ id: "branch-1", name: "Centro", code: "AGS-01", timezone: "America/Mexico_City" }]
      }
    });
  });

  it("maps denied branch access to HTTP 403", async () => {
    mockedLogin.mockResolvedValue({ ok: false, reason: "NO_BRANCH_ACCESS" } as any);

    await expect(postLogin({ email: "test@monarca.mx", password: "secret", branchId: "branch-1" })).resolves.toEqual({
      status: 403,
      body: { error: "NO_BRANCH_ACCESS", message: "No branch access is assigned." }
    });
  });

  it("maps a selected branch outside the user's access to HTTP 403", async () => {
    mockedLogin.mockResolvedValue({ ok: false, reason: "BRANCH_ACCESS_DENIED" } as any);

    await expect(postLogin({ email: "test@monarca.mx", password: "secret", branchId: "branch-9" })).resolves.toEqual({
      status: 403,
      body: { error: "BRANCH_ACCESS_DENIED", message: "You do not have access to this branch." }
    });
  });

  it("maps invalid credentials to HTTP 401", async () => {
    mockedLogin.mockResolvedValue({ ok: false, reason: "INVALID_CREDENTIALS" } as any);

    await expect(postLogin({ email: "test@monarca.mx", password: "wrong" })).resolves.toEqual({
      status: 401,
      body: { error: "INVALID_CREDENTIALS", message: "Invalid credentials." }
    });
  });

  it("returns the successful login session payload", async () => {
    const expiresAt = new Date("2026-09-30T00:00:00.000Z");
    const branch = { id: "branch-1", name: "Centro", code: "AGS-01", timezone: "America/Mexico_City" };
    mockedLogin.mockResolvedValue({
      ok: true,
      sessionId: "session-1",
      token: "token-1",
      expiresAt,
      branch,
      roles: ["CAJERO"]
    } as any);

    const result = await postLogin({ email: "test@monarca.mx", password: "secret", branchId: "branch-1" });

    expect(result).toEqual({
      status: 200,
      body: { sessionId: "session-1", token: "token-1", expiresAt, branch, roles: ["CAJERO"] }
    });
    expect(mockedLogin).toHaveBeenCalledWith("test@monarca.mx", "secret", "branch-1");
  });

  it("rejects logout without a token", async () => {
    await expect(postLogout("")).resolves.toEqual({ status: 401, body: { error: "UNAUTHENTICATED" } });
    expect(mockedLogout).not.toHaveBeenCalled();
  });

  it("rejects non-string logout tokens before calling the core", async () => {
    for (const token of [null, undefined, 123, {}, []]) {
      await expect(postLogout(token as never)).resolves.toEqual({ status: 401, body: { error: "UNAUTHENTICATED" } });
    }
    expect(mockedLogout).not.toHaveBeenCalled();
  });

  it("rejects oversized logout tokens before calling the core", async () => {
    await expect(postLogout("a".repeat(257))).resolves.toEqual({
      status: 401,
      body: { error: "UNAUTHENTICATED" }
    });
    expect(mockedLogout).not.toHaveBeenCalled();
  });

  it("logs out a valid token and returns 204", async () => {
    mockedLogout.mockResolvedValue({ id: "session-1", revokedAt: new Date() } as any);

    await expect(postLogout("token-1")).resolves.toEqual({ status: 204, body: null });
    expect(mockedLogout).toHaveBeenCalledWith("token-1");
  });

  it("maps an invalid or stale session from the core to HTTP 401", async () => {
    mockedLogout.mockResolvedValue(null);

    await expect(postLogout("stale-token")).resolves.toEqual({
      status: 401,
      body: { error: "UNAUTHENTICATED" }
    });
  });

  it("rejects getMe without a valid session", async () => {
    mockedRequireSession.mockResolvedValue(null);

    await expect(getMe("bad-token")).resolves.toEqual({ status: 401, body: { error: "UNAUTHENTICATED" } });
    expect(mockedRequireSession).toHaveBeenCalledWith("bad-token");
  });

  it("rejects non-string getMe tokens before calling middleware", async () => {
    for (const token of [null, undefined, 123, {}, []]) {
      await expect(getMe(token as never)).resolves.toEqual({ status: 401, body: { error: "UNAUTHENTICATED" } });
    }
    expect(mockedRequireSession).not.toHaveBeenCalled();
  });

  it("rejects oversized getMe tokens before calling middleware", async () => {
    await expect(getMe("a".repeat(257))).resolves.toEqual({
      status: 401,
      body: { error: "UNAUTHENTICATED" }
    });
    expect(mockedRequireSession).not.toHaveBeenCalled();
  });

  it("returns only the intended authenticated user and branch fields", async () => {
    mockedRequireSession.mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1",
      branchId: "branch-1",
      user: {
        id: "user-1",
        name: "Colaborador Prueba",
        email: "test@monarca.mx",
        status: "ACTIVE",
        organizationId: "org-1",
        passwordHash: "must-not-leak"
      },
      branch: {
        id: "branch-1",
        name: "Centro",
        code: "AGS-01",
        timezone: "America/Mexico_City",
        organizationId: "org-1"
      },
      roles: [{ role: { name: "CAJERO" } }]
    } as any);

    const result = await getMe("token-1");

    expect(result).toEqual({
      status: 200,
      body: {
        sessionId: "session-1",
        user: { id: "user-1", name: "Colaborador Prueba", email: "test@monarca.mx", status: "ACTIVE" },
        branch: { id: "branch-1", name: "Centro", code: "AGS-01", timezone: "America/Mexico_City" },
        roles: [{ role: { name: "CAJERO" } }]
      }
    });
    expect(JSON.stringify(result)).not.toContain("passwordHash");
  });

  it("contains no core error details when login throws unexpectedly", async () => {
    mockedLogin.mockRejectedValue(new Error("DATABASE_SECRET_SHOULD_NOT_LEAK"));

    await expect(postLogin({ email: "test@monarca.mx", password: "secret" })).resolves.toEqual({
      status: 500,
      body: { error: "INTERNAL_SERVER_ERROR", message: "Internal server error." }
    });
  });

  it("contains no core error details when logout throws unexpectedly", async () => {
    mockedLogout.mockRejectedValue(new Error("TOKEN_INTERNAL_DETAIL"));

    await expect(postLogout("token-1")).resolves.toEqual({
      status: 500,
      body: { error: "INTERNAL_SERVER_ERROR", message: "Internal server error." }
    });
  });

  it("contains no middleware error details when getMe throws unexpectedly", async () => {
    mockedRequireSession.mockRejectedValue(new Error("SESSION_INTERNAL_DETAIL"));

    await expect(getMe("token-1")).resolves.toEqual({
      status: 500,
      body: { error: "INTERNAL_SERVER_ERROR", message: "Internal server error." }
    });
  });
});
