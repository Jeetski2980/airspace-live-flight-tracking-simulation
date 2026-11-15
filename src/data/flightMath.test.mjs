import test from "node:test";
import assert from "node:assert/strict";
import { displayLivePosition } from "./flightMath.ts";

const sample = (overrides = {}) => ({
  id: "a1b2c3", callsign: null, originCountry: null, latitude: 40.64, longitude: -73.78,
  baroAltitudeM: null, geoAltitudeM: 9000, groundSpeedMs: 210, trackDeg: 90,
  verticalRateMs: null, onGround: false, positionTime: 1_700_000_000, lastContact: null,
  positionSource: "ADS-B", source: "OpenSky Network", kind: "live", positionKind: "measured",
  ...overrides,
});

test("recent reported positions are smoothly estimated from speed and track", () => {
  const now = 1_700_000_030_000;
  const aircraft = displayLivePosition(sample(), now, false);
  assert.equal(aircraft.positionKind, "estimated");
  assert.ok(aircraft.longitude > -73.78);
  assert.ok(Math.abs(aircraft.latitude - 40.64) < 0.001);
});

test("old reported positions are labelled stale instead of measured or projected", () => {
  const now = 1_700_000_181_000;
  const aircraft = displayLivePosition(sample(), now, false);
  assert.equal(aircraft.positionKind, "stale");
  assert.equal(aircraft.latitude, 40.64);
  assert.equal(aircraft.longitude, -73.78);
});

test("positions without a usable speed or track are never estimated", () => {
  const now = 1_700_000_030_000;
  const aircraft = displayLivePosition(sample({ groundSpeedMs: null }), now, false);
  assert.equal(aircraft.positionKind, "measured");
  assert.equal(aircraft.latitude, 40.64);
  assert.equal(aircraft.longitude, -73.78);
});
