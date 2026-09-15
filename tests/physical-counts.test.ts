import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/prisma",()=>({prisma:{user:{findUnique:vi.fn()},branch:{findUnique:vi.fn()},product:{findUnique:vi.fn()},branchProduct:{findUnique:vi.fn()},employee:{findUnique:vi.fn()},inventoryBalance:{findUnique:vi.fn(),upsert:vi.fn()},inventoryMovement:{findFirst:vi.fn(),create:vi.fn()},authorizationRequest:{findUnique:vi.fn()},authorizationApproval:{findFirst:vi.fn()},auditLog:{create:vi.fn()},$transaction:vi.fn()}}));
vi.mock("../src/core/authorization",()=>({canApproveAuthorization:vi.fn(),requestAuthorization:vi.fn(),authorizationIntegrityHash:vi.fn(()=>"valid-hash")}));
import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, requestAuthorization, authorizationIntegrityHash } from "../src/core/authorization";
import { requestPhysicalCount, executeApprovedPhysicalCount } from "../src/core/physical-counts";
const db=prisma as any;

const approvedRequest=()=>({
 id:"auth-1",organizationId:"org-1",branchId:"branch-1",status:"APPROVED",entityType:"InventoryBalance",entityId:"product-1",
 requestedById:"user-1",reason:"Conteo físico",integrityHash:"valid-hash",
 beforeData:{branchId:"branch-1",productId:"product-1",quantity:12},
 requestedData:{branchId:"branch-1",productId:"product-1",employeeId:"emp-1",adjustmentType:"COUNT_CORRECTION",quantity:3,delta:-3,resultingQuantity:9,countedQuantity:9}
});

function configureExecutionMocks(){
 const request=approvedRequest();
 const currentAuthorizationFindUnique=vi.fn().mockResolvedValue(request);
 const branchProductFindUnique=vi.fn().mockResolvedValue({isEnabled:true,product:{organizationId:"org-1"}});
 const executorFindUnique=vi.fn().mockResolvedValue({id:"manager-1",organizationId:"org-1",status:"ACTIVE",branchAccess:[{branchId:"branch-1"}]});
 const approvalFindFirst=vi.fn().mockResolvedValue({id:"approval-1",approverId:"manager-1",decision:"APPROVED",approvedAt:new Date("2026-09-15T18:00:00.000Z")});
 const employeeFindUnique=vi.fn().mockResolvedValue({organizationId:"org-1"});
 const balanceFindUnique=vi.fn().mockResolvedValue({quantity:12});
 const upsert=vi.fn().mockResolvedValue({});
 const movementFindFirst=vi.fn().mockResolvedValue(null);
 const movementCreate=vi.fn().mockResolvedValue({id:"movement-1"});
 const auditCreate=vi.fn().mockResolvedValue({id:"audit-1"});
 db.authorizationRequest.findUnique.mockResolvedValue(request);
 db.$transaction.mockImplementation(async (callback:any)=>callback({
  $queryRaw:vi.fn().mockResolvedValue([]),
  authorizationRequest:{findUnique:currentAuthorizationFindUnique},
  user:{findUnique:executorFindUnique},
  authorizationApproval:{findFirst:approvalFindFirst},
  branchProduct:{findUnique:branchProductFindUnique},
  employee:{findUnique:employeeFindUnique},
  inventoryBalance:{findUnique:balanceFindUnique,upsert},
  inventoryMovement:{findFirst:movementFindFirst,create:movementCreate},
  auditLog:{create:auditCreate},
 }));
 return {currentAuthorizationFindUnique,branchProductFindUnique,executorFindUnique,approvalFindFirst,balanceFindUnique,upsert,movementFindFirst,movementCreate,auditCreate};
}

beforeEach(()=>vi.clearAllMocks());
describe("physical inventory counts",()=>{
 it("creates an authorization using the difference between system and physical count",async()=>{
  db.branch.findUnique.mockResolvedValue({organizationId:"org-1"});db.product.findUnique.mockResolvedValue({organizationId:"org-1"});db.branchProduct.findUnique.mockResolvedValue({isEnabled:true,product:{organizationId:"org-1"}});db.employee.findUnique.mockResolvedValue({organizationId:"org-1"});db.inventoryBalance.findUnique.mockResolvedValue({quantity:12});requestAuthorization.mockResolvedValue({id:"auth-1",status:"PENDING"});
  const result=await requestPhysicalCount({branchId:"branch-1",productId:"product-1",requestedById:"user-1",employeeId:"emp-1",countedQuantity:9});
  expect(requestAuthorization).toHaveBeenCalledWith(expect.objectContaining({type:"INVENTORY_ADJUSTMENT",entityId:"product-1",requestedData:expect.objectContaining({adjustmentType:"COUNT_CORRECTION",delta:-3,resultingQuantity:9})}));expect(result.id).toBe("auth-1");
 });
 it("blocks a count for an unassigned branch product",async()=>{
  db.branch.findUnique.mockResolvedValue({organizationId:"org-1"});db.product.findUnique.mockResolvedValue({organizationId:"org-1"});db.branchProduct.findUnique.mockResolvedValue(null);db.employee.findUnique.mockResolvedValue({organizationId:"org-1"});db.inventoryBalance.findUnique.mockResolvedValue({quantity:12});
  await expect(requestPhysicalCount({branchId:"branch-1",productId:"product-1",requestedById:"user-1",employeeId:"emp-1",countedQuantity:9})).rejects.toThrow("BRANCH_PRODUCT_SCOPE_FORBIDDEN");
  expect(requestAuthorization).not.toHaveBeenCalled();
 });
 it("blocks a count for a disabled branch product",async()=>{
  db.branch.findUnique.mockResolvedValue({organizationId:"org-1"});db.product.findUnique.mockResolvedValue({organizationId:"org-1"});db.branchProduct.findUnique.mockResolvedValue({isEnabled:false,product:{organizationId:"org-1"}});db.employee.findUnique.mockResolvedValue({organizationId:"org-1"});db.inventoryBalance.findUnique.mockResolvedValue({quantity:12});
  await expect(requestPhysicalCount({branchId:"branch-1",productId:"product-1",requestedById:"user-1",employeeId:"emp-1",countedQuantity:9})).rejects.toThrow("BRANCH_PRODUCT_SCOPE_FORBIDDEN");
 });
 it("executes an approved count only through the authorized branch product",async()=>{canApproveAuthorization.mockResolvedValue(true);const {upsert,movementCreate,auditCreate}=configureExecutionMocks();const result=await executeApprovedPhysicalCount({requestId:"auth-1",executorId:"manager-1"});expect(result).toMatchObject({previousQuantity:12,countedQuantity:9,delta:-3,authorizationRequestId:"auth-1",authorizationApprovalId:"approval-1",inventoryMovementId:"movement-1",auditLogId:"audit-1"});expect(upsert).toHaveBeenCalled();expect(movementCreate).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({referenceType:"PHYSICAL_COUNT",referenceId:"auth-1",quantity:-3})}));expect(auditCreate).toHaveBeenCalled();});
 it("blocks execution when the branch product assignment is missing",async()=>{canApproveAuthorization.mockResolvedValue(true);const {upsert,movementCreate,auditCreate,branchProductFindUnique}=configureExecutionMocks();branchProductFindUnique.mockResolvedValue(null);await expect(executeApprovedPhysicalCount({requestId:"auth-1",executorId:"manager-1"})).rejects.toThrow("BRANCH_PRODUCT_SCOPE_FORBIDDEN");expect(upsert).not.toHaveBeenCalled();expect(movementCreate).not.toHaveBeenCalled();expect(auditCreate).not.toHaveBeenCalled();});
 it("blocks execution when the branch product is disabled",async()=>{canApproveAuthorization.mockResolvedValue(true);const {upsert,movementCreate,auditCreate,branchProductFindUnique}=configureExecutionMocks();branchProductFindUnique.mockResolvedValue({isEnabled:false,product:{organizationId:"org-1"}});await expect(executeApprovedPhysicalCount({requestId:"auth-1",executorId:"manager-1"})).rejects.toThrow("BRANCH_PRODUCT_SCOPE_FORBIDDEN");expect(upsert).not.toHaveBeenCalled();expect(movementCreate).not.toHaveBeenCalled();expect(auditCreate).not.toHaveBeenCalled();});
 it("blocks execution without an authorized approver",async()=>{canApproveAuthorization.mockResolvedValue(false);await expect(executeApprovedPhysicalCount({requestId:"auth-1",executorId:"user-1"})).rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");});
 it("blocks a second execution of the same physical count",async()=>{canApproveAuthorization.mockResolvedValue(true);const {upsert,movementCreate,auditCreate,movementFindFirst}=configureExecutionMocks();movementFindFirst.mockResolvedValue({id:"movement-1"});await expect(executeApprovedPhysicalCount({requestId:"auth-1",executorId:"manager-1"})).rejects.toThrow("AUTHORIZATION_ALREADY_EXECUTED");expect(upsert).not.toHaveBeenCalled();expect(movementCreate).not.toHaveBeenCalled();expect(auditCreate).not.toHaveBeenCalled();});
 it("blocks a tampered authorization integrity hash",async()=>{canApproveAuthorization.mockResolvedValue(true);const {upsert,movementCreate,auditCreate}=configureExecutionMocks();db.authorizationRequest.findUnique.mockResolvedValue({...approvedRequest(),integrityHash:"tampered"});await expect(executeApprovedPhysicalCount({requestId:"auth-1",executorId:"manager-1"})).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");expect(upsert).not.toHaveBeenCalled();expect(movementCreate).not.toHaveBeenCalled();expect(auditCreate).not.toHaveBeenCalled();});
});