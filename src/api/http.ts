import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getMe, postLogin, postLogout, type LoginRequest } from "./auth";
import { getInventory, getInventoryList, getInventoryMovements, getInventoryReplenishmentQuery } from "./inventory-query";
import { postPhysicalCountExecution, postPhysicalCountRequest } from "./physical-counts";
import { postPurchaseExecution, postPurchaseRequest } from "./purchases";

const COOKIE_NAME = "monarca_session";
function readCookies(request: IncomingMessage) { const header = request.headers.cookie ?? ""; return Object.fromEntries(header.split(";").filter(Boolean).map((part) => { const index = part.indexOf("="); return [part.slice(0,index).trim(), decodeURIComponent(part.slice(index+1).trim())]; })); }
function sessionToken(request: IncomingMessage) { const cookies=readCookies(request); if(cookies[COOKIE_NAME]) return cookies[COOKIE_NAME]; const authorization=request.headers.authorization; return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : ""; }
async function readJson(request: IncomingMessage): Promise<unknown> { const chunks: Buffer[]=[]; for await(const chunk of request) chunks.push(Buffer.from(chunk)); if(!chunks.length)return {}; try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new Error("INVALID_JSON");} }
function sendJson(response: ServerResponse,status:number,body:unknown,headers:Record<string,string>={}) { if(status===204){response.writeHead(204,headers);response.end();return;} response.writeHead(status,{"content-type":"application/json; charset=utf-8",...headers});response.end(JSON.stringify(body)); }
function sessionCookie(token:string,maxAgeSeconds:number){return COOKIE_NAME+"="+encodeURIComponent(token)+"; Max-Age="+maxAgeSeconds+"; Path=/; HttpOnly; SameSite=Strict";}
function clearSessionCookie(){return COOKIE_NAME+"=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict";}
function queryNumber(value:string|null){if(value===null)return undefined;const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined;}

export async function handleRequest(request:IncomingMessage,response:ServerResponse){
 const url=new URL(request.url??"/","http://localhost"); const method=request.method??"GET";
 try{
  if(method==="POST"&&url.pathname==="/auth/login"){const result=await postLogin(await readJson(request) as LoginRequest);if(result.status!==200){sendJson(response,result.status,result.body);return;}const data=result.body as {token:string;expiresAt:string|Date};const maxAge=Math.max(0,Math.floor((new Date(data.expiresAt).getTime()-Date.now())/1000));const safeBody={...data};delete(safeBody as {token?:string}).token;sendJson(response,200,safeBody,{"set-cookie":sessionCookie(data.token,maxAge)});return;}
  if(method==="GET"&&url.pathname==="/auth/me"){const result=await getMe(sessionToken(request));sendJson(response,result.status,result.body);return;}
  if(method==="POST"&&url.pathname==="/auth/logout"){const result=await postLogout(sessionToken(request));sendJson(response,result.status,result.body,{"set-cookie":clearSessionCookie()});return;}
  if(method==="GET"&&url.pathname==="/inventory"){const branchId=url.searchParams.get("branchId");const productId=url.searchParams.get("productId");if(!branchId){sendJson(response,400,{error:"BRANCH_ID_REQUIRED"});return;}const result=productId?await getInventory({branchId,productId}):await getInventoryList({branchId,search:url.searchParams.get("search")??undefined,limit:queryNumber(url.searchParams.get("limit"))});sendJson(response,result.status,result.body);return;}
  if(method==="GET"&&url.pathname==="/inventory/movements"){const branchId=url.searchParams.get("branchId");if(!branchId){sendJson(response,400,{error:"BRANCH_ID_REQUIRED"});return;}const result=await getInventoryMovements({branchId,productId:url.searchParams.get("productId")??undefined,limit:queryNumber(url.searchParams.get("limit"))});sendJson(response,result.status,result.body);return;}
  if(method==="GET"&&url.pathname==="/inventory/replenishment"){const branchId=url.searchParams.get("branchId");if(!branchId){sendJson(response,400,{error:"BRANCH_ID_REQUIRED"});return;}const result=await getInventoryReplenishmentQuery({branchId,productId:url.searchParams.get("productId")??undefined,days:queryNumber(url.searchParams.get("days")),limit:queryNumber(url.searchParams.get("limit"))});sendJson(response,result.status,result.body);return;}
  if(method==="POST"&&url.pathname==="/inventory/physical-counts"){const result=await postPhysicalCountRequest(await readJson(request) as any);sendJson(response,result.status,result.body);return;}
  if(method==="POST"&&url.pathname==="/inventory/physical-counts/execute"){const result=await postPhysicalCountExecution(await readJson(request) as any);sendJson(response,result.status,result.body);return;}
  if(method==="POST"&&url.pathname==="/purchases"){const result=await postPurchaseRequest(await readJson(request) as any);sendJson(response,result.status,result.body);return;}
  if(method==="POST"&&url.pathname==="/purchases/execute"){const result=await postPurchaseExecution(await readJson(request) as any);sendJson(response,result.status,result.body);return;}
  if(method==="GET"&&url.pathname==="/health"){sendJson(response,200,{system:"Monarca POS",status:"ok"});return;}
  sendJson(response,404,{error:"NOT_FOUND"});
 }catch(error){if(error instanceof Error&&error.message==="INVALID_JSON"){sendJson(response,400,{error:"INVALID_JSON",message:"Request body must be valid JSON."});return;}sendJson(response,500,{error:"INTERNAL_SERVER_ERROR"});}
}
export function createHttpServer(){return createServer((request,response)=>{void handleRequest(request,response);});}
