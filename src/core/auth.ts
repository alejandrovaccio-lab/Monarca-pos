import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";
import { verifyPassword } from "./password";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;
const MAX_BRANCH_ID_LENGTH = 128;
const MAX_AUTH_TOKEN_LENGTH = 256;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function isValidText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

async function authenticate(email: string, password: string) {
  if (!isValidText(email, MAX_EMAIL_LENGTH) || !isValidText(password, MAX_PASSWORD_LENGTH)) {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const user = await prisma.user.findFirst({
    where: { email: normalizedEmail, status: "ACTIVE" },
    include: {
      roles: { include: { role: true } },
      branchAccess: { include: { branch: true } }
    }
  });

  if (!user) return null;

  const credential = await prisma.authCredential.findUnique({
    where: { userId: user.id }
  });

  if (!credential || !(await verifyPassword(credential.passwordHash, password))) {
    return null;
  }

  return user;
}

export async function login(email: string, password: string, branchId?: string) {
  if (!isValidText(email, MAX_EMAIL_LENGTH) || !isValidText(password, MAX_PASSWORD_LENGTH)) {
    return { ok: false as const, reason: "INVALID_CREDENTIALS" as const };
  }

  if (branchId !== undefined && !isValidText(branchId, MAX_BRANCH_ID_LENGTH)) {
    return { ok: false as const, reason: "BRANCH_ACCESS_DENIED" as const };
  }

  const user = await authenticate(email, password);
  if (!user) return { ok: false as const, reason: "INVALID_CREDENTIALS" as const };

  const branches = user.branchAccess
    .filter(({ branch }) => branch.organizationId === user.organizationId)
    .map(({ branch }) => ({
      id: branch.id,
      name: branch.name,
      code: branch.code,
      timezone: branch.timezone
    }));

  if (!branches.length) {
    return { ok: false as const, reason: "NO_BRANCH_ACCESS" as const };
  }

  const selectedBranchId = branchId ?? (branches.length === 1 ? branches[0].id : undefined);

  if (!selectedBranchId) {
    return { ok: false as const, reason: "BRANCH_SELECTION_REQUIRED" as const, branches };
  }

  const hasAccess = branches.some((branch) => branch.id === selectedBranchId);
  if (!hasAccess) {
    return { ok: false as const, reason: "BRANCH_ACCESS_DENIED" as const };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      branchId: selectedBranchId,
      tokenHash: hashToken(token),
      expiresAt,
      lastSeenAt: new Date()
    }
  });

  return {
    ok: true as const,
    sessionId: session.id,
    token,
    expiresAt,
    branch: branches.find((branch) => branch.id === selectedBranchId)!,
    roles: user.roles.map(({ role }) => role.name)
  };
}

export async function logout(token: string) {
  if (!isValidText(token, MAX_AUTH_TOKEN_LENGTH)) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, revokedAt: true }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  return prisma.userSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() }
  });
}
