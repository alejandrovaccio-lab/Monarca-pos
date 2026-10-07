import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    authorizationRequest: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    authorizationApproval: { findFirst: vi.fn() },
    purchase: { findUnique: vi.fn(), create: vi.fn() },
    branch: { findUnique: vi.fn() }, supplier: { findUnique: vi.fn() }, employee: { findUnique: vi.fn() },
    product: { findMany: vi.fn() }, inventoryBalance: { findUnique: vi.fn(), upsert: vi.fn() },
    inventoryMovement: { create: vi.fn() }, productCost: { create: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn(),
  },
}));
vi.mock("../src/core/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/authorization")>();
  return { ...actual, canApproveAuthorization: vi.fn().mockResolvedValue(true), authorizationIntegrityHash: vi.fn(() => "test-integrity-hash") };
});
import { prisma } from "../src/lib/prisma";
import { executeApprovedPurchaseReceipt } from "../src/core/purchases";
const db = prisma as any;
const requestedAt = new Date("2026-09-29T10:00:00.000Z");
const approvedAt = new Date("2026-09-29T10:04:00.000Z");
function authorization() { return { id:"auth-1", organizationId:"org-1", branchId:"branch-1", requestedById:"requester-1", status:"APPROVED", type:"OTHER", reason:"Resurtido autorizado", entityType:"Purchase", entityId:"purchase-1", beforeData:null, requestedAt, resolvedAt:new Date("2026-09-29T10:05:00.000Z"), integrityHash:"test-integrity-hash", requestedData:{purchaseId:"purchase-1",branchId:"branch-1",supplierId:"supplier-1",folio:"FAC-523",employeeId:"emp-1",purchasedAt:requestedAt.toISOString(),items:[{productId:"product-1",quantity:10,unitCost:25,taxRate:16}]}}; }
function tx() { return { authorizationRequest:{findUnique:vi.fn().mockResolvedValue(authorization())}, user:{findUnique:vi.fn().mockResolvedValue({status:"ACTIVE",organizationId:"org-1",branchAccess:[{branchId:"branch-1"}],roles:[{role:{name:"GERENTE"}}]})}, authorizationApproval:{findFirst:vi.fn().mockResolvedValue({id:"approval-1",approverId:"manager-1",decision:"APPROVED",approvedAt})}, purchase:{findUnique:vi.fn().mockResolvedValue(null),create:vi.fn()}, branch:{findUnique:vi.fn().mockResolvedValue({organizationId:"org-1"})}, supplier:{findUnique:vi.fn().mockResolvedValue({organizationId:"org-1"})}, employee:{findUnique:vi.fn().mockResolvedValue({organizationId:"org-1"})}, product:{findMany:vi.fn().mockResolvedValue([{id:"product-1"}])}, inventoryBalance:{findUnique:vi.fn().mockResolvedValue({quantity:5}),upsert:vi.fn()}, inventoryMovement:{create:vi.fn()}, productCost:{create:vi.fn()}, auditLog:{create:vi.fn()} }; }
const serializationConflict=Object.assign(new Error("Transaction failed due to a write conflict or a deadlock. Please retry your transaction"),{code:"P2034"});
beforeEach(()=>vi.clearAllMocks());

describe("purchase authorization approver revalidation across serializable retries",()=>{
  it("rejects a retry when authorization target data changes",async()=>{
    const transaction=tx(); db.authorizationRequest.findUnique.mockResolvedValue(authorization());
    const changed=authorization(); changed.requestedData.items[0].unitCost=99;
    transaction.purchase.create.mockRejectedValueOnce(serializationConflict);
    transaction.authorizationRequest.findUnique.mockResolvedValueOnce(authorization()).mockResolvedValueOnce(changed);
    db.$transaction.mockImplementationOnce(async(cb:any)=>cb(transaction)).mockImplementationOnce(async(cb:any)=>cb(transaction));
    await expect(executeApprovedPurchaseReceipt({requestId:"auth-1",executorId:"manager-1"})).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.authorizationRequest.findUnique).toHaveBeenCalledTimes(2);
    expect(transaction.purchase.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(transaction.inventoryMovement.create).not.toHaveBeenCalled();
    expect(transaction.productCost.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });
});