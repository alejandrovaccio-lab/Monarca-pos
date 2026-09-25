import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const salesPath = path.join(process.cwd(), "src", "core", "sales.ts");
const sales = fs.readFileSync(salesPath, "utf8");

describe("Sale reversal traceability", () => {
  it("requires an approved authorization to have a persisted approval record", () => {
    expect(sales).toContain('approvals: {');
    expect(sales).toContain('where: { decision: "APPROVED" }');
    expect(sales).toContain('if (!approval) throw new Error("AUTHORIZATION_TRACE_BROKEN")');
  });

  it("captures every reversal inventory movement id", () => {
    expect(sales).toContain("const inventoryMovementIds: string[] = [];");
    expect(sales).toContain("inventoryMovementIds.push(movement.id);");
    expect(sales).toContain("inventoryMovementIds.length !== sale.items.length");
  });

  it("links the audit record to the authorization approval and movements", () => {
    expect(sales).toContain("authorizationRequestId: currentAuthorization.id");
    expect(sales).toContain("authorizationApprovalId: approval.id");
    expect(sales).toContain("authorizationApprovedAt: approval.approvedAt");
    expect(sales).toContain("inventoryMovementIds");
    expect(sales).toContain("const audit = await tx.auditLog.create");
  });

  it("uses one execution timestamp across reversal movements and audit", () => {
    expect(sales).toContain("const executedAt = new Date();");
    expect(sales).toContain("occurredAt: executedAt");
    expect(sales).toContain("executedAt,");
  });

  it("returns the complete trace to the caller", () => {
    expect(sales).toContain("authorizationRequestId: currentAuthorization.id");
    expect(sales).toContain("authorizationApprovalId: approval.id");
    expect(sales).toContain("inventoryMovementIds");
    expect(sales).toContain("auditLogId: audit.id");
  });
});
