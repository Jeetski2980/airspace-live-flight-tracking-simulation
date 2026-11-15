import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { areaFromQuery, getLive, getReplay } from "./opensky.mjs";
import { aiStatus, askAssistant } from "./ai.mjs";

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
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
      return json(res, 200, { server: "ok", ai: aiStatus(), openskyConfigured: Boolean(process.env.OPENSKY_CLIENT_ID?.trim() && process.env.OPENSKY_CLIENT_SECRET?.trim() && !process.env.OPENSKY_CLIENT_ID.startsWith("your_") && !process.env.OPENSKY_CLIENT_SECRET.startsWith("your_")) });
    }
    if (req.method === "GET" && url.pathname === "/api/live") return json(res, 200, await getLive(areaFromQuery(url.searchParams)));
    if (req.method === "GET" && url.pathname === "/api/replay") return json(res, 200, getReplay(areaFromQuery(url.searchParams)));
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
