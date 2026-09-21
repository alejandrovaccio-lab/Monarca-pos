import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/prisma",()=>({prisma:{branch:{findUnique:vi.fn()},registerSession:{findUnique:vi.fn()},user:{findUnique:vi.fn()},customer:{findUnique:vi.fn()},product:{findUnique:vi.fn()},productPrice:{findFirst:vi.fn()},$transaction:vi.fn()}}));
import {prisma} from "../src/lib/prisma";
import {createSale} from "../src/core/sales-create";
const db=prisma as any;
beforeEach(()=>vi.clearAllMocks());
function context(){db.branch.findUnique.mockResolvedValue({id:"b",organizationId:"o"});db.registerSession.findUnique.mockResolvedValue({id:"s",closedAt:null,register:{branchId:"b",status:"OPEN"}});db.user.findUnique.mockResolvedValue({id:"u",organizationId:"o",status:"ACTIVE",branchAccess:[{branchId:"b"}]});db.product.findUnique.mockResolvedValue({id:"p",organizationId:"o",name:"Producto",status:"ACTIVE",publicPrice:10,branchProducts:[{isEnabled:true}],prices:[],costs:[]});db.productPrice.findFirst.mockResolvedValue(null);}
describe("sale timestamp integrity",()=>{
 it("rejects future-dated sales before price or inventory processing",async()=>{
   context();
   await expect(createSale({branchId:"b",registerSessionId:"s",cashierId:"u",soldAt:new Date(Date.now()+60000),items:[{productId:"p",quantity:1}],payments:[{method:"CASH",amount:10}]})).rejects.toThrow("SALE_FUTURE_TIMESTAMP_FORBIDDEN");
   expect(db.product.findUnique).not.toHaveBeenCalled();
   expect(db.productPrice.findFirst).not.toHaveBeenCalled();
   expect(db.$transaction).not.toHaveBeenCalled();
 });
 it("allows a current sale timestamp",async()=>{
   context();
   const tx={branchProduct:{findUnique:vi.fn().mockResolvedValue({isEnabled:true,product:{organizationId:"o",status:"ACTIVE"}})},inventoryBalance:{updateMany:vi.fn().mockResolvedValue({count:1})},inventoryMovement:{create:vi.fn()},sale:{create:vi.fn().mockResolvedValue({id:"sale",items:[],payments:[]})},auditLog:{create:vi.fn()}};
   db.$transaction.mockImplementation(async(cb:any)=>cb(tx));
   await expect(createSale({branchId:"b",registerSessionId:"s",cashierId:"u",items:[{productId:"p",quantity:1}],payments:[{method:"CASH",amount:10}]})).resolves.toMatchObject({total:"10.00"});
 });
});
