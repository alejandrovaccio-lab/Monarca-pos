import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getMe, postLogin, postLogout, type LoginRequest } from "./auth";
import { getInventory, getInventoryList, getInventoryMovements, getInventoryReplenishmentQuery } from "./inventory-query";
import { postPhysicalCountExecution, postPhysicalCountRequest } from "./physical-counts";
import { postPurchaseExecution, postPurchaseRequest } from "./purchases";
import { postOpenRegister, postCloseRegister } from "./registers";
import { postCreateSale } from "./sales-create";
import { getSaleTicketQuery } from "./sales-ticket";
import { getSaleTicketPrintQuery } from "./sales-ticket-print";
import { getOrders, postCreateOrder, postOrderSaleLink, postOrderStatus } from "./orders";
import { requireBranchSession } from "../middleware/auth";

const COOKIE_NAME = "monarca_session";

function readCookies(request: IncomingMessage) {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(
    header.split(";").filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    })
  );
}

function sessionToken(request: IncomingMessage) {
  const cookies = readCookies(request);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (status === 204) {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function sessionCookie(token: string, maxAgeSeconds: number) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`;
}

function queryNumber(value: string | null, fallback: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bodyBranchId(body: unknown) {
  if (!body || typeof body !== "object") return undefined;
  const branchId = (body as { branchId?: unknown }).branchId;
  return typeof branchId === "string" && branchId.length > 0 ? branchId : undefined;
}

async function requireOperationalBranch(request: IncomingMessage, branchId: string | undefined) {
  if (!branchId) return { ok: false as const, status: 400, body: { error: "BRANCH_ID_REQUIRED" } };
  const context = await requireBranchSession(sessionToken(request), branchId);
  if (!context) return { ok: false as const, status: 401, body: { error: "AUTHENTICATION_REQUIRED" } };
  return { ok: true as const, ...context, branchId };
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  try {
    if (method === "POST" && url.pathname === "/auth/login") {
      const result = await postLogin(await readJson(request) as LoginRequest);
      if (result.status !== 200) {
        sendJson(response, result.status, result.body);
        return;
      }
      const data = result.body as { token: string; expiresAt: string | Date };
      const maxAge = Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
      const safeBody = { ...data };
      delete (safeBody as { token?: string }).token;
      sendJson(response, 200, safeBody, { "set-cookie": sessionCookie(data.token, maxAge) });
      return;
    }

    if (method === "GET" && url.pathname === "/auth/me") {
      const result = await getMe(sessionToken(request));
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "POST" && url.pathname === "/auth/logout") {
      const result = await postLogout(sessionToken(request));
      sendJson(response, result.status, result.body, { "set-cookie": clearSessionCookie() });
      return;
    }

    if (method === "GET" && url.pathname === "/inventory") {
      const branchId = url.searchParams.get("branchId") ?? undefined;
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const productId = url.searchParams.get("productId");
      const result = productId
        ? await getInventory({ branchId: auth.branchId, productId })
        : await getInventoryList({ branchId: auth.branchId, search: url.searchParams.get("search") ?? undefined, limit: queryNumber(url.searchParams.get("limit"), 50) });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "GET" && url.pathname === "/inventory/movements") {
      const branchId = url.searchParams.get("branchId") ?? undefined;
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const result = await getInventoryMovements({ branchId: auth.branchId, productId: url.searchParams.get("productId") ?? undefined, limit: queryNumber(url.searchParams.get("limit"), 100) });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "GET" && url.pathname === "/inventory/replenishment") {
      const branchId = url.searchParams.get("branchId") ?? undefined;
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const result = await getInventoryReplenishmentQuery({ branchId: auth.branchId, productId: url.searchParams.get("productId") ?? undefined, days: queryNumber(url.searchParams.get("days"), 30), limit: queryNumber(url.searchParams.get("limit"), 200) });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "POST" && (url.pathname === "/inventory/physical-counts" || url.pathname === "/inventory/physical-counts/execute" || url.pathname === "/purchases" || url.pathname === "/purchases/execute")) {
      const body = await readJson(request);
      const auth = await requireOperationalBranch(request, bodyBranchId(body));
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }

      if (url.pathname === "/inventory/physical-counts") {
        const result = await postPhysicalCountRequest(body as any);
        sendJson(response, result.status, result.body);
        return;
      }
      if (url.pathname === "/inventory/physical-counts/execute") {
        const result = await postPhysicalCountExecution(body as any);
        sendJson(response, result.status, result.body);
        return;
      }
      if (url.pathname === "/purchases") {
        const result = await postPurchaseRequest(body as any);
        sendJson(response, result.status, result.body);
        return;
      }
      const result = await postPurchaseExecution(body as any);
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "POST" && url.pathname === "/registers/open") {
      const body = await readJson(request);
      const branchId = bodyBranchId(body);
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const input = body as { registerId?: unknown; openingFloat?: unknown };
      const result = await postOpenRegister({
        branchId: auth.branchId,
        registerId: typeof input.registerId === "string" ? input.registerId : "",
        openedById: auth.userId,
        openingFloat: typeof input.openingFloat === "number" ? input.openingFloat : Number(input.openingFloat),
      });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "POST" && url.pathname === "/registers/close") {
      const body = await readJson(request);
      const input = body as { sessionId?: unknown; closingTotal?: unknown; branchId?: unknown };
      const branchId = typeof input.branchId === "string" ? input.branchId : undefined;
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const result = await postCloseRegister({
        sessionId: typeof input.sessionId === "string" ? input.sessionId : "",
        closedById: auth.userId,
        closingTotal: typeof input.closingTotal === "number" ? input.closingTotal : Number(input.closingTotal),
      });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "POST" && url.pathname === "/sales") {
      const body = await readJson(request);
      const branchId = bodyBranchId(body);
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const input = body as Record<string, unknown>;
      const result = await postCreateSale({
        branchId: auth.branchId,
        registerSessionId: typeof input.registerSessionId === "string" ? input.registerSessionId : "",
        cashierId: auth.userId,
        sellerId: typeof input.sellerId === "string" ? input.sellerId : undefined,
        customerId: typeof input.customerId === "string" ? input.customerId : undefined,
        folio: typeof input.folio === "string" ? input.folio : undefined,
        soldAt: typeof input.soldAt === "string" ? input.soldAt : undefined,
        items: Array.isArray(input.items) ? input.items as any : [],
        payments: Array.isArray(input.payments) ? input.payments as any : [],
      });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "POST" && url.pathname === "/orders") {
      const body = await readJson(request);
      const auth = await requireOperationalBranch(request, bodyBranchId(body));
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const input = body as Record<string, unknown>;
      const result = await postCreateOrder({
        branchId: auth.branchId,
        customerId: typeof input.customerId === "string" ? input.customerId : undefined,
        channel: input.channel as "WHATSAPP" | "PICKUP" | "OTHER",
        requestedAt: typeof input.requestedAt === "string" ? input.requestedAt : undefined,
        items: Array.isArray(input.items) ? input.items as Array<{ productId: string; quantity: number | string }> : [],
      });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "GET" && url.pathname === "/orders") {
      const branchId = url.searchParams.get("branchId") ?? undefined;
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const status = url.searchParams.get("status");
      const result = await getOrders({
        branchId: auth.branchId,
        status: status ? status as "RECEIVED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED" : undefined,
        limit: queryNumber(url.searchParams.get("limit"), 50),
      });
      sendJson(response, result.status, result.body);
      return;
    }

    const orderStatusMatch = method === "POST" ? url.pathname.match(/^\/orders\/([^/]+)\/status$/) : null;
    if (orderStatusMatch) {
      const body = await readJson(request);
      const auth = await requireOperationalBranch(request, bodyBranchId(body));
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const input = body as Record<string, unknown>;
      const result = await postOrderStatus({
        branchId: auth.branchId,
        orderId: decodeURIComponent(orderStatusMatch[1]),
        status: input.status as "RECEIVED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED",
        preparedById: auth.userId,
      });
      sendJson(response, result.status, result.body);
      return;
    }

    const orderSaleMatch = method === "POST" ? url.pathname.match(/^\/orders\/([^/]+)\/sale$/) : null;
    if (orderSaleMatch) {
      const body = await readJson(request);
      const auth = await requireOperationalBranch(request, bodyBranchId(body));
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const input = body as Record<string, unknown>;
      const result = await postOrderSaleLink({
        branchId: auth.branchId,
        orderId: decodeURIComponent(orderSaleMatch[1]),
        saleId: typeof input.saleId === "string" ? input.saleId : "",
      });
      sendJson(response, result.status, result.body);
      return;
    }

    const saleTicketPrintMatch = method === "GET" ? url.pathname.match(/^\/sales\/([^/]+)\/ticket\/print$/) : null;
    if (saleTicketPrintMatch) {
      const branchId = url.searchParams.get("branchId") ?? undefined;
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const result = await getSaleTicketPrintQuery({ saleId: decodeURIComponent(saleTicketPrintMatch[1]), branchId: auth.branchId });
      sendJson(response, result.status, result.body);
      return;
    }

    const saleTicketMatch = method === "GET" ? url.pathname.match(/^\/sales\/([^/]+)\/ticket$/) : null;
    if (saleTicketMatch) {
      const branchId = url.searchParams.get("branchId") ?? undefined;
      const auth = await requireOperationalBranch(request, branchId);
      if (!auth.ok) {
        sendJson(response, auth.status, auth.body);
        return;
      }
      const result = await getSaleTicketQuery({ saleId: decodeURIComponent(saleTicketMatch[1]), branchId: auth.branchId });
      sendJson(response, result.status, result.body);
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { system: "Monarca POS", status: "ok" });
      return;
    }

    sendJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_JSON") {
      sendJson(response, 400, { error: "INVALID_JSON", message: "Request body must be valid JSON." });
      return;
    }
    sendJson(response, 500, { error: "INTERNAL_SERVER_ERROR" });
  }
}

export function createHttpServer() {
  return createServer((request, response) => {
    void handleRequest(request, response);
  });
}
