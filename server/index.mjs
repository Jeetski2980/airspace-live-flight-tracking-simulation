import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { aiStatus, askAssistant } from "./ai.mjs";

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(JSON.stringify(payload));
}
async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 24_000) throw new Error("Request too large.");
  }
  try { return JSON.parse(body); } catch { throw new Error("Invalid JSON request."); }
}
export async function handleApi(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, { server: "ok", ai: aiStatus() });
    }
    if (req.method === "POST" && url.pathname === "/api/assistant") {
      const result = await askAssistant(await readJson(req));
      return json(res, result.status, result.body);
    }
    return json(res, 404, { error: "Unknown API route." });
  } catch (error) {
    return json(res, error?.message === "Request too large." ? 413 : 400, { error: String(error?.message ?? "Request failed.").slice(0, 200) });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(handleApi);
  server.listen(8787, "127.0.0.1", () => console.log("AIRSPACE API listening on http://127.0.0.1:8787"));
}
