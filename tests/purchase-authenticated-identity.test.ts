import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    userSession: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  getSessionContext: vi.fn(),
  setAuthenticatedContext: vi.fn(),
  getAuthenticatedContext: vi.fn(),
  executeApprovedPurchaseReceipt: vi.fn(),
  requestPurchaseReceipt: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../src/core/context", () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock("../src/core/auth-context", () => ({
  setAuthenticatedContext: mocks.setAuthenticatedContext,
  getAuthenticatedContext: mocks.getAuthenticatedContext,
}));
vi.mock("../src/core/purchases", () => ({
  executeApprovedPurchaseReceipt: mocks.executeApprovedPurchaseReceipt,
  requestPurchaseReceipt: mocks.requestPurchaseReceipt,
}));

import { requireBranchSession } from "../src/middleware/auth";
import { postPurchaseExecution, postPurchaseRequest } from "../src/api/purchases";

describe("purchase authenticated identity boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    mocks.prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      userId: "authenticated-user",
      branchId: "branch-1",
      user: { id: "authenticated-user", organizationId: "org-1", status: "ACTIVE" },
      branch: { id: "branch-1", organizationId: "org-1" },
      roles: ["ENCARGADO_TIENDA"],
    });
  });

  it("binds the branch session to the authenticated user context", async () => {
    const context = await requireBranchSession("valid-token", "branch-1");

    expect(context?.userId).toBe("authenticated-user");
    expect(mocks.setAuthenticatedContext).toHaveBeenCalledWith({
      userId: "authenticated-user",
      branchId: "branch-1",
      organizationId: "org-1",
    });
  });

  it("overrides a spoofed requestedById when an authenticated context exists", async () => {
    mocks.getAuthenticatedContext.mockReturnValue({
      userId: "authenticated-user",
      branchId: "branch-1",
      organizationId: "org-1",
    });
    mocks.requestPurchaseReceipt.mockResolvedValue({ id: "purchase-auth-1" });

    await postPurchaseRequest({
      branchId: "attacker-branch",
      requestedById: "attacker-user",
      employeeId: "employee-1",
      supplierId: "supplier-1",
      folio: "FAC-1",
      reason: "Resurtido",
      items: [{ productId: "product-1", quantity: 1, unitCost: 10 }],
    });

    expect(mocks.requestPurchaseReceipt).toHaveBeenCalledWith(expect.objectContaining({
      branchId: "branch-1",
      requestedById: "authenticated-user",
    }));
  });

  it("overrides a spoofed executorId when an authenticated context exists", async () => {
    mocks.getAuthenticatedContext.mockReturnValue({
      userId: "authenticated-user",
      branchId: "branch-1",
      organizationId: "org-1",
    });
    mocks.executeApprovedPurchaseReceipt.mockResolvedValue({ id: "purchase-auth-1" });

    await postPurchaseExecution({
      requestId: "authorization-1",
      executorId: "attacker-user",
    });

    expect(mocks.executeApprovedPurchaseReceipt).toHaveBeenCalledWith({
      requestId: "authorization-1",
      executorId: "authenticated-user",
    });
  });
});
