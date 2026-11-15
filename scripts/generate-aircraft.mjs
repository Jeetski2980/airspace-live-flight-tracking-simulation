// AIRSPACE's original neutral aircraft model. Units are metres, glTF Y-up, nose faces -Z.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const materials = [
  [0.72, 0.81, 0.86, 1], // fuselage
  [0.31, 0.47, 0.58, 1], // wings and tail
  [0.09, 0.20, 0.28, 1], // cockpit / engine intakes
  [0.75, 0.89, 0.18, 1], // subtle wing tips
];
const groups = materials.map(() => ({ position: [], normal: [] }));
function triangle(a, b, c, material) {
  const u = b.map((v, i) => v - a[i]);
  const v = c.map((x, i) => x - a[i]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n) || 1;
  for (const p of [a, b, c]) {
    groups[material].position.push(...p);
    groups[material].normal.push(...n.map(x => x / length));
  }
}
function quad(a, b, c, d, m) { triangle(a, b, c, m); triangle(a, c, d, m); }
function prism(outline, y0, y1, m) {
  for (let i = 1; i < outline.length - 1; i++) {
    triangle([outline[0][0], y1, outline[0][1]], [outline[i][0], y1, outline[i][1]], [outline[i + 1][0], y1, outline[i + 1][1]], m);
    triangle([outline[i + 1][0], y0, outline[i + 1][1]], [outline[i][0], y0, outline[i][1]], [outline[0][0], y0, outline[0][1]], m);
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], m);
  }
}
function tube(cx, cy, z0, z1, r0, r1, m, sides = 12) {
  for (let i = 0; i < sides; i++) {
    const a = 2 * Math.PI * i / sides, b = 2 * Math.PI * (i + 1) / sides;
    quad([cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), z0], [cx + r0 * Math.cos(b), cy + r0 * Math.sin(b), z0], [cx + r1 * Math.cos(b), cy + r1 * Math.sin(b), z1], [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), z1], m);
  }
}

// A 39 m long, 36 m span generic twin-jet silhouette; no type or operator implied.
const rings = [[-19.5, 0.08], [-18, 0.65], [-15, 1.25], [-10, 1.65], [0, 1.8], [10, 1.65], [15, 1.35], [18, 0.55], [19.5, 0.08]];
for (let i = 0; i < rings.length - 1; i++) tube(0, 1.85, rings[i][0], rings[i + 1][0], rings[i][1], rings[i + 1][1], 0, 16);
prism([[0, -8], [3.2, -6.9], [18, 4.2], [18, 6.2], [2.5, 2.5], [0, 3]], 1.48, 1.85, 1);
prism([[0, -8], [-3.2, -6.9], [-18, 4.2], [-18, 6.2], [-2.5, 2.5], [0, 3]], 1.48, 1.85, 1);
prism([[0, 13], [2, 12.8], [7.2, 17], [7.2, 18.2], [0, 16.7]], 1.75, 2.03, 1);
prism([[0, 13], [-2, 12.8], [-7.2, 17], [-7.2, 18.2], [0, 16.7]], 1.75, 2.03, 1);
quad([-0.17, 2.2, 12], [0.17, 2.2, 12], [0.12, 7.8, 18], [-0.12, 7.8, 18], 1);
quad([0.17, 2.2, 12], [-0.17, 2.2, 12], [-0.12, 7.8, 18], [0.12, 7.8, 18], 1);
for (const x of [-6.6, 6.6]) {
  tube(x, 0.67, -3.3, 2.7, 0.78, 0.85, 0);
  tube(x, 0.67, -3.33, -3.18, 0.68, 0.68, 2);
}
// Cockpit glazing and wing tips make orientation clear at close zoom.
prism([[-0.9, -16.7], [0.9, -16.7], [1.35, -13.5], [-1.35, -13.5]], 3.10, 3.20, 2);
prism([[17.45, 4.2], [18.05, 4.2], [18.05, 6.2], [17.45, 6.2]], 1.48, 1.9, 3);
prism([[-18.05, 4.2], [-17.45, 4.2], [-17.45, 6.2], [-18.05, 6.2]], 1.48, 1.9, 3);

const chunks = [], bufferViews = [], accessors = [], primitives = [];
let offset = 0;
function accessor(values, target, minmax = false) {
  const data = Buffer.from(new Float32Array(values).buffer);
  chunks.push(data);
  const view = bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target }) - 1;
  offset += data.length;
  const entry = { bufferView: view, componentType: 5126, count: values.length / 3, type: "VEC3" };
  if (minmax) {
    entry.min = [0, 1, 2].map(i => Math.min(...values.filter((_, n) => n % 3 === i)));
    entry.max = [0, 1, 2].map(i => Math.max(...values.filter((_, n) => n % 3 === i)));
  }
  return accessors.push(entry) - 1;
}
groups.forEach((group, material) => {
  const position = accessor(group.position, 34962, true);
  const normal = accessor(group.normal, 34962);
  primitives.push({ attributes: { POSITION: position, NORMAL: normal }, material, mode: 4 });
});
const gltf = {
  asset: { version: "2.0", generator: "AIRSPACE original generic twin-jet mesh, 2026" },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives }],
  materials: materials.map(c => ({ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0.13, roughnessFactor: 0.7 } })),
  buffers: [{ byteLength: offset }], bufferViews, accessors,
};
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binary.length, 8);
jsonHeader.writeUInt32LE(jsonPadded.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const dest = join(root, "public/models/airspace-generic.glb");
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binary]));
console.log("Generated original generic aircraft model.");
