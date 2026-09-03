import { createHttpServer } from "./api/http";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const server = createHttpServer();
server.listen(port, host, () => { console.log("Monarca POS API listening on " + host + ":" + port); });
function shutdown(signal: string) {
  console.log(signal + " received; shutting down Monarca POS API.");
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));