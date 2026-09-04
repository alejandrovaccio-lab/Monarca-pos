import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/prisma",()=>({prisma:{branch:{findUnique:vi.fn()},product:{findUnique:vi.fn()},employee:{findUnique:vi.fn()},inventoryBalance:{findUnique:vi.fn()},authorizationRequest:{findUnique:vi.fn()},$transaction:vi.fn()}}));
vi.mock("../src/core/authorization",()=>({canApproveAuthorization:vi.fn(),requestAuthorization:vi.fn()}));
import { prisma } from "../src/lib/prisma";
import { canApproveAuthorization, requestAuthorization } from "../src/core/authorization";
import { requestPhysicalCount, executeApprovedPhysicalCount } from "../src/core/physical-counts";
const db=prisma as any;
beforeEach(()=>vi.clearAllMocks());
describe("physical inventory counts",()=>{
 it("creates an authorization using the difference between system and physical count",async()=>{
  db.branch.findUnique.mockResolvedValue({organizationId:"org-1"});db.product.findUnique.mockResolvedValue({organizationId:"org-1"});db.employee.findUnique.mockResolvedValue({organizationId:"org-1"});db.inventoryBalance.findUnique.mockResolvedValue({quantity:12});requestAuthorization.mockResolvedValue({id:"auth-1",status:"PENDING"});
  const result=await requestPhysicalCount({branchId:"branch-1",productId:"product-1",requestedById:"user-1",employeeId:"emp-1",countedQuantity:9});
  expect(requestAuthorization).toHaveBeenCalledWith(expect.objectContaining({type:"INVENTORY_ADJUSTMENT",entityId:"product-1",requestedData:expect.objectContaining({adjustmentType:"COUNT_CORRECTION",delta:-3,resultingQuantity:9})}));expect(result.id).toBe("auth-1");
 });
 it("blocks execution without an authorized approver",async()=>{canApproveAuthorization.mockResolvedValue(false);await expect(executeApprovedPhysicalCount({requestId:"auth-1",executorId:"user-1"})).rejects.toThrow("AUTHORIZATION_APPROVER_REQUIRED");});
});
