import { prisma } from "../lib/prisma";

export type CustomerInput = {
  branchId: string;
  actorId: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
};

function clean(value?: string) {
  const result = value?.trim();
  return result ? result : undefined;
}

function normalizePhone(phone?: string) {
  return (phone ?? "").replace(/\D/g, "");
}

function membershipCode(customerId: string) {
  return `MON-${customerId.toUpperCase()}`;
}

function present(customer: { id: string; organizationId: string; name: string; phone: string | null; email: string | null; taxId: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    ...customer,
    membership: {
      code: membershipCode(customer.id),
      status: "ACTIVE" as const,
      qrPayload: `MONARCA-MEMBERSHIP:${customer.id}`,
    },
  };
}

async function branchContext(branchId: string, actorId: string) {
  const [branch, actor] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, organizationId: true } }),
    prisma.user.findUnique({ where: { id: actorId }, select: { id: true, organizationId: true, status: true, branchAccess: { where: { branchId }, select: { branchId: true } } } }),
  ]);
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  if (!actor || actor.status !== "ACTIVE" || actor.organizationId !== branch.organizationId || !actor.branchAccess.length) throw new Error("ACTOR_NOT_AUTHORIZED");
  return { branch, actor };
}

async function ensureUniquePhone(organizationId: string, phone: string | undefined, excludeId?: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  const customers = await prisma.customer.findMany({ where: { organizationId, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, phone: true } });
  if (customers.some((customer) => normalizePhone(customer.phone ?? undefined) === normalized)) throw new Error("CUSTOMER_PHONE_DUPLICATE");
}

export async function createCustomer(input: CustomerInput) {
  const { branch } = await branchContext(input.branchId, input.actorId);
  const name = clean(input.name);
  if (!name) throw new Error("CUSTOMER_NAME_REQUIRED");
  const phone = clean(input.phone);
  const email = clean(input.email)?.toLowerCase();
  const taxId = clean(input.taxId)?.toUpperCase();
  await ensureUniquePhone(branch.organizationId, phone);

  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({ data: { organizationId: branch.organizationId, name, phone: phone ?? null, email: email ?? null, taxId: taxId ?? null } });
    await tx.auditLog.create({ data: { organizationId: branch.organizationId, branchId: input.branchId, userId: input.actorId, action: "CUSTOMER_CREATED", entityType: "Customer", entityId: created.id, beforeData: null, afterData: { name: created.name, phone: created.phone, email: created.email, taxId: created.taxId, membershipCode: membershipCode(created.id) } } });
    return created;
  });
  return present(customer);
}

export async function listCustomers(input: { branchId: string; actorId: string; search?: string; phone?: string; membershipCode?: string; limit?: number }) {
  const { branch } = await branchContext(input.branchId, input.actorId);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const search = clean(input.search)?.toLowerCase();
  const normalizedPhone = normalizePhone(input.phone);
  const requestedMembership = clean(input.membershipCode)?.toUpperCase();
  const customers = await prisma.customer.findMany({ where: { organizationId: branch.organizationId }, orderBy: [{ name: "asc" }, { createdAt: "desc" }], take: 500 });
  return customers
    .filter((customer) => {
      if (search && !customer.name.toLowerCase().includes(search) && !(customer.phone ?? "").includes(search) && !(customer.email ?? "").toLowerCase().includes(search)) return false;
      if (normalizedPhone && normalizePhone(customer.phone ?? undefined) !== normalizedPhone) return false;
      if (requestedMembership && membershipCode(customer.id) !== requestedMembership) return false;
      return true;
    })
    .slice(0, limit)
    .map(present);
}

export async function getCustomer(input: { branchId: string; actorId: string; customerId: string }) {
  const { branch } = await branchContext(input.branchId, input.actorId);
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, include: { sales: { orderBy: { soldAt: "desc" }, take: 50, select: { id: true, folio: true, status: true, soldAt: true } }, orders: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, channel: true, status: true, requestedAt: true, createdAt: true, saleId: true } } } });
  if (!customer || customer.organizationId !== branch.organizationId) throw new Error("CUSTOMER_NOT_FOUND");
  return { ...present(customer), history: { sales: customer.sales, orders: customer.orders } };
}

export async function updateCustomer(input: CustomerInput & { customerId: string }) {
  const { branch } = await branchContext(input.branchId, input.actorId);
  const current = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!current || current.organizationId !== branch.organizationId) throw new Error("CUSTOMER_NOT_FOUND");
  const name = clean(input.name);
  if (!name) throw new Error("CUSTOMER_NAME_REQUIRED");
  const phone = clean(input.phone);
  const email = clean(input.email)?.toLowerCase();
  const taxId = clean(input.taxId)?.toUpperCase();
  await ensureUniquePhone(branch.organizationId, phone, input.customerId);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.customer.update({ where: { id: input.customerId }, data: { name, phone: phone ?? null, email: email ?? null, taxId: taxId ?? null } });
    await tx.auditLog.create({ data: { organizationId: branch.organizationId, branchId: input.branchId, userId: input.actorId, action: "CUSTOMER_UPDATED", entityType: "Customer", entityId: result.id, beforeData: { name: current.name, phone: current.phone, email: current.email, taxId: current.taxId }, afterData: { name: result.name, phone: result.phone, email: result.email, taxId: result.taxId, membershipCode: membershipCode(result.id) } } });
    return result;
  });
  return present(updated);
}
