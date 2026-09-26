import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const salesPath = path.join(process.cwd(), "src", "core", "sales.ts");
const sales = fs.readFileSync(salesPath, "utf8");

describe("Sale reversal audit provenance", () => {
  it("binds the audit entry to the authenticated executor", () => {
    expect(sales).toContain("userId: input.executorId,");
    expect(sales).toContain("executorId: input.executorId,");
  });

  it("binds the audit entry to the exact sale and organization scope", () => {
    expect(sales).toContain("organizationId: currentAuthorization.organizationId,");
    expect(sales).toContain("branchId: currentAuthorization.branchId,");
    expect(sales).toContain('entityType: "Sale",');
    expect(sales).toContain("entityId: sale.id,");
  });

  it("preserves the sale state before and after the authorized change", () => {
    expect(sales).toContain("beforeData: {");
    expect(sales).toContain("status: sale.status,");
    expect(sales).toContain("afterData: {");
    expect(sales).toContain("status,");
    expect(sales).toContain("authorizationRequestId: currentAuthorization.id,");
    expect(sales).toContain("authorizationApprovalId: approval.id,");
  });

  it("keeps the approval timestamp distinct from the execution timestamp", () => {
    expect(sales).toContain("authorizationApprovedAt: approval.approvedAt,");
    expect(sales).toContain("executedAt,");
    expect(sales).toContain("occurredAt: executedAt,");
  });
});
