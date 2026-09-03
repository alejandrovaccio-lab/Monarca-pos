import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getMe, postLogin, postLogout, type LoginRequest } from "./auth";

const COOKIE_NAME = "monarca_session";

function readCookies(request: IncomingMessage) {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(header.split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
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
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("INVALID_JSON"); }
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (status === 204) { response.writeHead(204, headers); response.end(); return; }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function sessionCookie(token: string, maxAgeSeconds: number) {
  return COOKIE_NAME + "=" + encodeURIComponent(token) + "; Max-Age=" + maxAgeSeconds + "; Path=/; HttpOnly; SameSite=Strict";
}

function clearSessionCookie() {
  return COOKIE_NAME + "=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict";
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  try {
    if (method === "POST" && url.pathname === "/auth/login") {
      const body = await readJson(request);
      const result = await postLogin(body as LoginRequest);
      if (result.status !== 200) { sendJson(response, result.status, result.body); return; }
      const data = result.body as { token: string; expiresAt: string | Date };
      const maxAge = Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
      const safeBody = { ...data };
      delete (safeBody as { token?: string }).token;
      sendJson(response, 200, safeBody, { "set-cookie": sessionCookie(data.token, maxAge) });
      return;
    }
    if (method === "GET" && url.pathname === "/auth/me") {
      const result = await getMe(sessionToken(request));
      sendJson(response, result.status, result.body); return;
    }
    if (method === "POST" && url.pathname === "/auth/logout") {
      const result = await postLogout(sessionToken(request));
      sendJson(response, result.status, result.body, { "set-cookie": clearSessionCookie() }); return;
    }
    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { system: "Monarca POS", status: "ok" }); return;
    }
    sendJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_JSON") {
      sendJson(response, 400, { error: "INVALID_JSON", message: "Request body must be valid JSON." }); return;
    }
    sendJson(response, 500, { error: "INTERNAL_SERVER_ERROR" });
  }
}

export function createHttpServer() {
  return createServer((request, response) => { void handleRequest(request, response); });
}