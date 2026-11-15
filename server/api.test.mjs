import test from "node:test";
import assert from "node:assert/strict";
import { askAssistant } from "./ai.mjs";
import { handleApi } from "./index.mjs";

function responseHarness() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
}

test("status is limited to server and AI provider state", async () => {
  const res = responseHarness();
  await handleApi({ method: "GET", url: "/api/status" }, res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.server, "ok");
  assert.equal("openskyConfigured" in body, false);
});

test("removed flight data routes do not return a feed", async () => {
  for (const url of ["/api/live?area=us", "/api/replay"]) {
    const res = responseHarness();
    await handleApi({ method: "GET", url }, res);
    assert.equal(res.status, 404);
  }
});

test("Groq returns a validated proposal using the synthetic demo source", async () => {
  const oldGroqKey = process.env.GROQ_API_KEY;
  const oldGroqModel = process.env.GROQ_MODEL;
  const oldFetch = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY = "test_groq_key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test_groq_key");
      const request = JSON.parse(options.body);
      assert.equal(request.response_format.type, "json_schema");
      assert.equal(request.response_format.json_schema.strict, true);
      const output = {
        kind: "proposal", answer: "A synthetic JFK closure scenario is ready for review.",
        evidence: ["The current map shows synthetic demo tracks."],
        assumptions: ["Only synthetic aircraft are affected."],
        proposal: { locationId: "JFK", eventType: "runway_closure", durationMinutes: 30,
          syntheticAircraftCount: 12, description: "Hypothetical capacity reduction for 30 minutes." },
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
    };
    const response = await askAssistant({ message: "What if JFK closes for 30 minutes?", context: { mode: "demo", dataState: "synthetic demo", sourceTimestamp: null, aircraft: [] } });
    assert.equal(response.status, 200);
    assert.equal(response.body.kind, "proposal");
    assert.equal(response.body.proposal.locationId, "JFK");
    assert.equal(response.body.proposal.latitude, 40.6413);
    assert.equal(response.body.proposal.syntheticAircraftCount, 12);
    assert.equal(response.body.source, "AeroFlo synthetic traffic demo");
    assert.equal("liveAircraft" in response.body, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldGroqKey;
    if (oldGroqModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = oldGroqModel;
  }
});
