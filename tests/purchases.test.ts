import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    supplier: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    authorizationRequest: { findUnique: vi.fn() },
    authorizationApproval: { findFirst: vi.fn() },
    purchase: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/core/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/authorization")>();
  return { ...actual, canApproveAuthorization: vi.fn(), requestAuthorization: vi.fn(), authorizationIntegrityHash: vi.fn(() => "test-integrity-hash") };
});

import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, requestAuthorization } from "../src/core/authorization";
import { executeApprovedPurchaseReceipt, requestPurchaseReceipt } from "../src/core/purchases";

const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

describe("purchase receipts", () => {
  it("creates a senior authorization request without changing inventory", async () => {
    db.branch.findUnique.mockResolvedValue({ organizationId: "org-1" }); db.user.findUnique.mockResolvedValue({ organizationId: "org-1" }); db.employee.findUnique.mockResolvedValue({ organizationId: "org-1" }); db.supplier.findUnique.mockResolvedValue({ organizationId: "org-1" }); db.product.findMany.mockResolvedValue([{ id: "product-1" }]); requestAuthorization.mockResolvedValue({ id: "auth-1", status: "PENDING" });
    const result = await requestPurchaseReceipt({ branchId: "branch-1", requestedById: "user-1", employeeId: "emp-1", supplierId: "supplier-1", folio: "FAC-100", reason: "Resurtido sugerido por inventario", items: [{ productId: "product-1", quantity: 10, unitCost: 25 }] });
    expect(requestAuthorization).toHaveBeenCalledWith(expect.objectContaining({ type: "OTHER", entityType: "Purchase", requestedData: expect.objectContaining({ branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-100", items: [{ productId: "product-1", quantity: 10, unitCost: 25 }] }) })); expect(result.id).toBe("auth-1");
  });

  it("blocks execution without an authorized approver", async () => { canApproveAuthorization.mockResolvedValue(false); await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED"); });
  it("rejects an inactive executor before loading the authorization", async () => { canApproveAuthorization.mockResolvedValue(true); db.authorizationRequest.findUnique.mockResolvedValue(null); await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_NOT_FOUND"); });

  it("rejects an executor from another organization inside the transaction", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-1", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-1", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-1", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-100", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-2", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN"); expect(tx.user.findUnique).toHaveBeenCalledOnce();
  });

  it("rejects an executor without access to the authorization branch", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-1", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-1", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-1", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-100", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-2" }], roles: [{ role: { name: "GERENTE" } }] }) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_SCOPE_FORBIDDEN");
  });

  it("rejects an inactive executor inside the transaction", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-1", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-1", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-1", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-100", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "INACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
  });

  it("rejects execution when the executor loses the approver role inside the transaction", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-role-revoked", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-role-revoked", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-role-revoked", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-101", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [] }) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: authorization.id, executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");
  });

  it("rejects execution when an approved authorization has no persisted approval record", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-no-approval", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-no-approval", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-no-approval", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-103", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) }, authorizationApproval: { findFirst: vi.fn().mockResolvedValue(null) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: authorization.id, executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION"); expect(tx.authorizationApproval.findFirst).toHaveBeenCalledOnce();
  });

  it("rejects execution when approval provenance belongs to a different user", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-approver-mismatch", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-approver-mismatch", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-approver-mismatch", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-105", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) }, authorizationApproval: { findFirst: vi.fn().mockResolvedValue({ id: "approval-foreign", approverId: "other-user", decision: "APPROVED" }) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: authorization.id, executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_APPROVER_MISMATCH");
  });

  it("rejects execution when the persisted approval is not APPROVED", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-rejected-approval", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-rejected-approval", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-rejected-approval", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-104", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) }, authorizationApproval: { findFirst: vi.fn().mockResolvedValue({ id: "approval-1", approverId: "user-1", decision: "REJECTED" }) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: authorization.id, executorId: "user-1" })).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
  });

  it("allows execution when the executor retains an approver role and approval provenance is valid", async () => {
    canApproveAuthorization.mockResolvedValue(true); const authorization = { id: "auth-role-valid", status: "APPROVED", organizationId: "org-1", branchId: "branch-1", requestedById: "requester-1", type: "OTHER", entityType: "Purchase", entityId: "purchase-role-valid", reason: "Resurtido", beforeData: null, integrityHash: "test-integrity-hash", requestedData: { purchaseId: "purchase-role-valid", branchId: "branch-1", supplierId: "supplier-1", folio: "FAC-102", employeeId: "emp-1", purchasedAt: new Date().toISOString(), items: [{ productId: "product-1", quantity: 1, unitCost: 10 }] } };
    db.authorizationRequest.findUnique.mockResolvedValue(authorization); const tx = { authorizationRequest: { findUnique: vi.fn().mockResolvedValue(authorization) }, user: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }], roles: [{ role: { name: "GERENTE" } }] }) }, authorizationApproval: { findFirst: vi.fn().mockResolvedValue({ id: "approval-1", approverId: "user-1", decision: "APPROVED" }) }, purchase: { findUnique: vi.fn().mockResolvedValue({ id: "existing-purchase" }) } }; db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(executeApprovedPurchaseReceipt({ requestId: authorization.id, executorId: "user-1" })).rejects.toThrow("PURCHASE_ALREADY_EXECUTED");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" }); expect(tx.authorizationApproval.findFirst).toHaveBeenCalledOnce(); expect(tx.user.findUnique).toHaveBeenCalledOnce(); expect(tx.purchase.findUnique).toHaveBeenCalledOnce();
  });
});
