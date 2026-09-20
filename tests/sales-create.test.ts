import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    branch: { findUnique: vi.fn() },
    registerSession: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    customer: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    productPrice: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../src/lib/prisma";
import { createSale } from "../src/core/sales-create";

const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

function setupContext(productOverrides: Record<string, unknown> = {}) {
  db.branch.findUnique.mockResolvedValue({ id: "branch-1", organizationId: "org-1" });
  db.registerSession.findUnique.mockResolvedValue({ id: "session-1", closedAt: null, register: { branchId: "branch-1", status: "OPEN" } });
  db.user.findUnique.mockResolvedValue({ id: "cashier-1", organizationId: "org-1", status: "ACTIVE", branchAccess: [{ branchId: "branch-1" }] });
  db.product.findUnique.mockResolvedValue({
    id: "product-1",
    organizationId: "org-1",
    name: "Manzana",
    status: "ACTIVE",
    publicPrice: 10,
    branchProducts: [{ isEnabled: true }],
    prices: [],
    costs: [{ cost: 5 }],
    ...productOverrides,
  });
  db.productPrice.findFirst.mockResolvedValue(null);
}
function branchProductMock() { return vi.fn().mockResolvedValue({ isEnabled: true, product: { organizationId: "org-1", status: "ACTIVE" } }); }

function transactionMocks() {
  const inventoryUpdate=vi.fn().mockResolvedValue({count:1});
  const movementCreate=vi.fn().mockResolvedValue({id:"movement-1"});
  const saleCreate=vi.fn().mockResolvedValue({id:"sale-1",folio:"V-TEST",status:"COMPLETED",items:[],payments:[]});
  const auditCreate=vi.fn().mockResolvedValue({id:"audit-1"});
  const branchProductFindUnique=branchProductMock();
  db.$transaction.mockImplementation(async(callback:any)=>callback({branchProduct:{findUnique:branchProductFindUnique},inventoryBalance:{updateMany:inventoryUpdate},inventoryMovement:{create:movementCreate},sale:{create:saleCreate},auditLog:{create:auditCreate}}));
  return { inventoryUpdate, movementCreate, saleCreate, auditCreate, branchProductFindUnique };
}

describe("sale creation", () => {
  it("creates a paid sale, decrements inventory and records an item-scoped sale movement", async () => {
    setupContext(); const {inventoryUpdate,movementCreate,saleCreate,auditCreate,branchProductFindUnique}=transactionMocks();
    const result=await createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",folio:"V-TEST",items:[{productId:"product-1",quantity:2}],payments:[{method:"CASH",amount:20}]});
    expect(result.total).toBe("20.00"); expect(branchProductFindUnique).toHaveBeenCalled(); expect(inventoryUpdate).toHaveBeenCalled(); expect(movementCreate).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({type:"SALE",referenceType:"SALE_ITEM",referenceId:expect.any(String)})})); expect(movementCreate.mock.calls[0][0].data.referenceId).not.toBe("sale-1"); expect(movementCreate.mock.calls[0][0].data.notes).toContain("saleId="); expect(movementCreate.mock.calls[0][0].data.notes).toContain("saleItemId="); expect(saleCreate).toHaveBeenCalledOnce(); expect(auditCreate).toHaveBeenCalled();
  });

  it("uses the latest effective global ProductPrice when no branch-specific price exists", async () => {
    setupContext();
    db.productPrice.findFirst.mockResolvedValue({ price: 12 });
    transactionMocks();
    const result=await createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",items:[{productId:"product-1",quantity:2}],payments:[{method:"CASH",amount:24}]});
    expect(result.total).toBe("24.00");
    expect(db.productPrice.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ productId: "product-1", branchId: null, effectiveAt: expect.objectContaining({ lte: expect.any(Date) }) }),
      orderBy: { effectiveAt: "desc" },
      select: { price: true },
    }));
  });

  it("prefers a branch-specific price over a global ProductPrice", async () => {
    setupContext({ prices: [{ price: 15 }] });
    db.productPrice.findFirst.mockResolvedValue({ price: 12 });
    transactionMocks();
    const result=await createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",items:[{productId:"product-1",quantity:2}],payments:[{method:"CASH",amount:30}]});
    expect(result.total).toBe("30.00");
    expect(db.productPrice.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the product public price only when no effective ProductPrice exists", async () => {
    setupContext({ publicPrice: 10 });
    db.productPrice.findFirst.mockResolvedValue(null);
    transactionMocks();
    const result=await createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",items:[{productId:"product-1",quantity:2}],payments:[{method:"CASH",amount:20}]});
    expect(result.total).toBe("20.00");
  });

  it("blocks a sale when the product is disabled at the branch at execution time", async()=>{ setupContext(); const inventoryUpdate=vi.fn();const movementCreate=vi.fn();const saleCreate=vi.fn();const auditCreate=vi.fn();const branchProductFindUnique=vi.fn().mockResolvedValue({isEnabled:false,product:{organizationId:"org-1",status:"ACTIVE"}}); db.$transaction.mockImplementation(async(callback:any)=>callback({branchProduct:{findUnique:branchProductFindUnique},inventoryBalance:{updateMany:inventoryUpdate},inventoryMovement:{create:movementCreate},sale:{create:saleCreate},auditLog:{create:auditCreate}})); await expect(createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",items:[{productId:"product-1",quantity:2}],payments:[{method:"CASH",amount:20}]})).rejects.toThrow("PRODUCT_NOT_AVAILABLE_AT_BRANCH"); expect(inventoryUpdate).not.toHaveBeenCalled();expect(movementCreate).not.toHaveBeenCalled();expect(saleCreate).not.toHaveBeenCalled();expect(auditCreate).not.toHaveBeenCalled(); });
  it("blocks a sale when inventory is insufficient", async()=>{ setupContext();const inventoryUpdate=vi.fn().mockResolvedValue({count:0});db.$transaction.mockImplementation(async(callback:any)=>callback({branchProduct:{findUnique:branchProductMock()},inventoryBalance:{updateMany:inventoryUpdate},inventoryMovement:{create:vi.fn()},sale:{create:vi.fn()},auditLog:{create:vi.fn()}})); await expect(createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",items:[{productId:"product-1",quantity:2}],payments:[{method:"CASH",amount:20}]})).rejects.toThrow("INSUFFICIENT_INVENTORY"); });
  it("rejects a price override because price changes require authorization",async()=>{setupContext();await expect(createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",items:[{productId:"product-1",quantity:1,unitPrice:9}],payments:[{method:"CASH",amount:9}]})).rejects.toThrow("PRICE_OVERRIDE_AUTHORIZATION_REQUIRED");});
  it("requires the payments to match the exact sale total",async()=>{setupContext();await expect(createSale({branchId:"branch-1",registerSessionId:"session-1",cashierId:"cashier-1",items:[{productId:"product-1",quantity:2}],payments:[{method:"CASH",amount:19}]})).rejects.toThrow("PAYMENT_TOTAL_MISMATCH");});
});
