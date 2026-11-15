import test from "node:test";
import assert from "node:assert/strict";
import { areaFromQuery, getLive, normalizeState } from "./opensky.mjs";
import { askAssistant } from "./ai.mjs";

test("OpenSky state vectors retain observed fields and leave missing values unavailable", () => {
  const row = ["A1B2C3", " TEST42 ", "United States", 1_700_000_000, 1_700_000_001,
    -73.7781, 40.6413, null, false, 220, 125, null, null, 4100, null, false, 0];
  const aircraft = normalizeState(row);
  assert.equal(aircraft.id, "a1b2c3");
  assert.equal(aircraft.callsign, "TEST42");
  assert.equal(aircraft.baroAltitudeM, null);
  assert.equal(aircraft.geoAltitudeM, 4100);
  assert.equal(aircraft.verticalRateMs, null);
  assert.equal(aircraft.positionSource, "ADS-B");
  assert.equal(aircraft.kind, "live");
  assert.equal(aircraft.source, "OpenSky Network");
  assert.equal("airline" in aircraft, false);
  assert.equal("destination" in aircraft, false);
  assert.equal(normalizeState([123456]), null);
  assert.equal(normalizeState(["invalid"]), null);
});

test("area requests are bounded to the contiguous United States", () => {
  const local = areaFromQuery(new URLSearchParams("area=local&lat=40.6&lon=-73.8"));
  assert.equal(local.intervalMs, 90_000);
  assert.ok(local.bounds[0] < 40.6 && local.bounds[2] > 40.6);
  assert.equal(areaFromQuery(new URLSearchParams("area=us")).intervalMs, 180_000);
  assert.throws(() => areaFromQuery(new URLSearchParams("lat=0&lon=0")), /contiguous United States/);
});

test("placeholder credentials produce explicit setup states without calling providers", async () => {
  const oldOpenSkyId = process.env.OPENSKY_CLIENT_ID;
  const oldOpenSkySecret = process.env.OPENSKY_CLIENT_SECRET;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENSKY_CLIENT_ID = "your_opensky_client_id";
    process.env.OPENSKY_CLIENT_SECRET = "your_opensky_client_secret";
    process.env.OPENAI_API_KEY = "your_openai_api_key";
    const live = await getLive(areaFromQuery(new URLSearchParams("area=local")));
    assert.equal(live.state, "not_configured");
    assert.deepEqual(live.aircraft, []);
    assert.match(live.error, /server environment/);
    const assistant = await askAssistant({ message: "What is visible?" });
    assert.equal(assistant.status, 503);
    assert.match(assistant.body.error, /not configured/);
  } finally {
    if (oldOpenSkyId === undefined) delete process.env.OPENSKY_CLIENT_ID;
    else process.env.OPENSKY_CLIENT_ID = oldOpenSkyId;
    if (oldOpenSkySecret === undefined) delete process.env.OPENSKY_CLIENT_SECRET;
    else process.env.OPENSKY_CLIENT_SECRET = oldOpenSkySecret;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
  }
});

test("OpenSky OAuth2 stays server-side and a normalized snapshot is cached", async () => {
  const oldOpenSkyId = process.env.OPENSKY_CLIENT_ID;
  const oldOpenSkySecret = process.env.OPENSKY_CLIENT_SECRET;
  const oldFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.OPENSKY_CLIENT_ID = "test_client";
    process.env.OPENSKY_CLIENT_SECRET = "test_secret";
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/openid-connect/token")) {
        assert.equal(options.method, "POST");
        assert.equal(new URLSearchParams(options.body).get("grant_type"), "client_credentials");
        return new Response(JSON.stringify({ access_token: "test-token", expires_in: 1800 }), { status: 200 });
      }
      assert.match(String(url), /\/api\/states\/all\?/);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      const positioned = ["a1b2c3", " TEST42 ", "United States", 1_700_000_000, 1_700_000_001,
        -73.8, 40.6, null, false, 200, 90, null, null, 4000, null, false, 0];
      const noPosition = ["d4e5f6", null, "United States", null, 1_700_000_001,
        null, null, null, true, null, null, null, null, null, null, false, null];
      return new Response(JSON.stringify({ time: Math.floor(Date.now() / 1000), states: [positioned, noPosition] }),
        { status: 200, headers: { "X-Rate-Limit-Remaining": "3000" } });
    };
    const area = areaFromQuery(new URLSearchParams("lat=41.2&lon=-74.2"));
    const first = await getLive(area);
    const second = await getLive(area);
    assert.equal(first.state, "connected");
    assert.equal(first.returnedCount, 2);
    assert.equal(first.positionedCount, 1);
    assert.equal(first.aircraft[1].latitude, null);
    assert.equal(first.remainingCredits, 3000);
    assert.equal(second.snapshotTime, first.snapshotTime);
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(first).includes("test_secret"), false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldOpenSkyId === undefined) delete process.env.OPENSKY_CLIENT_ID;
    else process.env.OPENSKY_CLIENT_ID = oldOpenSkyId;
    if (oldOpenSkySecret === undefined) delete process.env.OPENSKY_CLIENT_SECRET;
    else process.env.OPENSKY_CLIENT_SECRET = oldOpenSkySecret;
  }
});

test("OpenSky network failures return a safe actionable message", async () => {
  const oldOpenSkyId = process.env.OPENSKY_CLIENT_ID;
  const oldOpenSkySecret = process.env.OPENSKY_CLIENT_SECRET;
  const oldFetch = globalThis.fetch;
  try {
    process.env.OPENSKY_CLIENT_ID = "test_client";
    process.env.OPENSKY_CLIENT_SECRET = "test_secret";
    globalThis.fetch = async () => { throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }); };
    const area = areaFromQuery(new URLSearchParams("lat=44&lon=-112"));
    const result = await getLive(area);
    assert.equal(result.state, "error");
    assert.match(result.error, /could not connect to OpenSky/);
    assert.match(result.error, /ENOTFOUND/);
    assert.doesNotMatch(result.error, /^fetch failed$/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldOpenSkyId === undefined) delete process.env.OPENSKY_CLIENT_ID;
    else process.env.OPENSKY_CLIENT_ID = oldOpenSkyId;
    if (oldOpenSkySecret === undefined) delete process.env.OPENSKY_CLIENT_SECRET;
    else process.env.OPENSKY_CLIENT_SECRET = oldOpenSkySecret;
  }
});

test("AI returns a validated proposal without altering the live feed", async () => {
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  try {
    process.env.OPENAI_API_KEY = "test_ai_key";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer test_ai_key");
      const request = JSON.parse(options.body);
      assert.equal(request.text.format.type, "json_schema");
      assert.equal(request.store, false);
      const output = {
        kind: "proposal", answer: "A synthetic JFK closure scenario is ready for review.",
        evidence: ["No observed live response was supplied."],
        assumptions: ["Only synthetic aircraft are affected."],
        proposal: { locationId: "JFK", eventType: "runway_closure", durationMinutes: 30,
          syntheticAircraftCount: 12, description: "Hypothetical capacity reduction for 30 minutes." },
      };
      return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { status: 200 });
    };
    const response = await askAssistant({ message: "What if JFK closes for 30 minutes?", context: { mode: "live", dataState: "not_configured", sourceTimestamp: null, aircraft: [] } });
    assert.equal(response.status, 200);
    assert.equal(response.body.kind, "proposal");
    assert.equal(response.body.proposal.locationId, "JFK");
    assert.equal(response.body.proposal.latitude, 40.6413);
    assert.equal(response.body.proposal.syntheticAircraftCount, 12);
    assert.equal(response.body.source, "OpenSky Network");
    assert.equal("liveAircraft" in response.body, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
  }
});
