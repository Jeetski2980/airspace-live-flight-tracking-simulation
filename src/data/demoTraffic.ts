import { movePosition } from "./flightMath";
import type { Aircraft, Location, MapKind, Trails } from "../types";

export const DEMO_LOOP_SECONDS = 8 * 60;
export const DEMO_AIRCRAFT_COUNT = 24;

interface DemoTrack {
  id: string;
  callsign: string;
  center: Location;
  phase: number;
  speedMs: number;
  altitudeM: number;
}

const hubs: Location[] = [
  { id: "JFK", name: "John F. Kennedy International Airport", city: "New York", lat: 40.6413, lon: -73.7781 },
  { id: "BOS", name: "Logan International Airport", city: "Boston", lat: 42.3656, lon: -71.0096 },
  { id: "PHL", name: "Philadelphia International Airport", city: "Philadelphia", lat: 39.8744, lon: -75.2424 },
  { id: "IAD", name: "Dulles International Airport", city: "Washington", lat: 38.9531, lon: -77.4565 },
  { id: "ATL", name: "Hartsfield–Jackson Atlanta International Airport", city: "Atlanta", lat: 33.6407, lon: -84.4277 },
  { id: "ORD", name: "O’Hare International Airport", city: "Chicago", lat: 41.9742, lon: -87.9073 },
  { id: "DFW", name: "Dallas Fort Worth International Airport", city: "Dallas", lat: 32.8998, lon: -97.0403 },
  { id: "DEN", name: "Denver International Airport", city: "Denver", lat: 39.8561, lon: -104.6737 },
  { id: "LAX", name: "Los Angeles International Airport", city: "Los Angeles", lat: 33.9416, lon: -118.4085 },
  { id: "SFO", name: "San Francisco International Airport", city: "San Francisco", lat: 37.6213, lon: -122.3790 },
  { id: "SEA", name: "Seattle–Tacoma International Airport", city: "Seattle", lat: 47.4502, lon: -122.3088 },
  { id: "MIA", name: "Miami International Airport", city: "Miami", lat: 25.7959, lon: -80.2870 },
];

const localOffsets: Array<[number, number]> = [
  [-0.28, -0.46], [-0.10, 0.42], [0.32, -0.18], [0.48, 0.15],
  [-0.42, 0.12], [0.16, 0.52], [0.56, -0.36], [-0.55, -0.10],
  [0.22, -0.58], [-0.18, 0.68], [0.65, 0.32], [-0.66, 0.38],
  [0.08, 0.08], [-0.32, 0.36], [0.39, 0.46], [-0.58, -0.48],
  [0.72, -0.08], [-0.05, -0.72],
];

function makeTracks(kind: MapKind, place: Location): DemoTrack[] {
  const centers = kind === "local"
    ? localOffsets.map(([lat, lon], index) => ({ ...place, lat: place.lat + lat, lon: place.lon + lon, id: place.id + String(index + 1).padStart(2, "0") }))
    : hubs.flatMap(hub => [hub, { ...hub, lat: hub.lat + 0.22, lon: hub.lon - 0.28 }]);
  return centers.slice(0, DEMO_AIRCRAFT_COUNT).map((center, index) => ({
    id: `demo-${String(index + 1).padStart(3, "0")}`,
    callsign: `DEMO${String(index + 1).padStart(3, "0")}`,
    center,
    phase: ((index * 137.5) % 360) * Math.PI / 180,
    speedMs: 190 + (index % 6) * 9,
    altitudeM: 8_200 + (index % 8) * 430,
  }));
}

function position(track: DemoTrack, seconds: number) {
  const period = ((seconds % DEMO_LOOP_SECONDS) + DEMO_LOOP_SECONDS) % DEMO_LOOP_SECONDS;
  const angle = track.phase + period / DEMO_LOOP_SECONDS * Math.PI * 2;
  const radiusM = track.speedMs * DEMO_LOOP_SECONDS / (Math.PI * 2);
  const offset = movePosition(track.center.lat, track.center.lon, angle * 180 / Math.PI, radiusM);
  return {
    latitude: offset.latitude,
    longitude: offset.longitude,
    trackDeg: (angle * 180 / Math.PI + 90) % 360,
  };
}

export function demoTrafficAt(seconds: number, kind: MapKind, place: Location): { aircraft: Aircraft[]; trails: Trails } {
  const tracks = makeTracks(kind, place);
  const aircraft = tracks.map((track): Aircraft => ({
    id: track.id,
    callsign: track.callsign,
    originCountry: null,
    ...position(track, seconds),
    baroAltitudeM: track.altitudeM,
    geoAltitudeM: track.altitudeM + 120,
    groundSpeedMs: track.speedMs,
    verticalRateMs: 0,
    onGround: false,
    positionTime: null,
    lastContact: null,
    positionSource: "Synthetic demonstration model",
    source: "AeroFlo synthetic traffic demo",
    kind: "demo",
    positionKind: "synthetic_demo",
  }));
  const trails: Trails = {};
  for (const track of tracks) {
    const points: Trails[string] = [];
    trails[track.id] = points;
    for (let offset = -DEMO_LOOP_SECONDS; offset <= 0; offset += 20) {
      const point = position(track, seconds + offset);
      points.push({ ...point, altitudeM: track.altitudeM + 120, time: Math.max(0, seconds + offset) });
    }
  }
  return { aircraft, trails };
}
