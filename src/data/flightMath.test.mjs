import test from "node:test";
import assert from "node:assert/strict";
import { cesiumHeadingFromTrackDeg, movePosition } from "./flightMath.ts";

test("synthetic motion advances along its bearing at the requested distance", () => {
  const east = movePosition(40.64, -73.78, 90, 1000);
  assert.ok(east.longitude > -73.78);
  assert.ok(Math.abs(east.latitude - 40.64) < 0.001);
});

test("Cesium aircraft heading matches clockwise track bearings", () => {
  const expected = [[0, -Math.PI / 2], [90, 0], [180, Math.PI / 2], [270, Math.PI]];
  for (const [track, heading] of expected) assert.ok(Math.abs(cesiumHeadingFromTrackDeg(track) - heading) < 1e-12);
  assert.equal(cesiumHeadingFromTrackDeg(360), cesiumHeadingFromTrackDeg(0));
});
