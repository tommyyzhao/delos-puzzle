import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMaze, clearance } from '../puzzle/maze.mjs';
import { createWallGeometry, DIMENSIONS, MM_PER_UNIT, toScene } from '../puzzle/maze-geometry.mjs';
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Raycaster, Vector3 } from '../puzzle/vendor/three/three.module.js';
import { goalCallout } from '../puzzle/maze-renderer.mjs';

const g = parseMaze(readFileSync(new URL('../puzzle/maze.svg', import.meta.url), 'utf8'));
for (let i = 0; i < 48; i++) {
  const a = i * Math.PI / 24;
  assert(clearance(g, { x: g.goal.x + 4.5 * Math.cos(a), y: g.goal.y - 1.5 + 8 * Math.sin(a) }) > 0);
}
for (const x of [-.99, 0, .99]) for (const y of [-.99, 0, .99]) {
  const callout = goalCallout({ x, y, z: 0 }, 390, 390);
  assert(callout.left >= 0 && callout.left <= 346 && callout.top >= 0 && callout.top <= 368);
  assert(callout.path.includes(`L ${callout.x} ${callout.y}`));
}
assert.equal(goalCallout({ x: 1.01, y: 0, z: 0 }, 390, 390), null);
for (const tilt of [-30, 0, 30]) for (const zoom of [1, 2.1]) for (const axis of [new Vector3(1, 0, 0), new Vector3(1, 1, 0).normalize()]) {
  const camera = new PerspectiveCamera(36, 1, 1, 2500), distance = g.extent * MM_PER_UNIT * 1.16 / Math.tan(Math.PI / 10) / zoom;
  camera.position.set(0, -Math.sin(22 * Math.PI / 180) * distance, Math.cos(22 * Math.PI / 180) * distance);
  camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const q = new Quaternion().setFromAxisAngle(axis, tilt * Math.PI / 180);
  const p = toScene(g, { x: g.goal.x, y: g.goal.y - 1.5 });
  const projected = new Vector3(p.x, p.y, .04).applyQuaternion(q).project(camera);
  const callout = goalCallout(projected, 390, 390);
  assert(Math.abs(callout.x - (projected.x + 1) * 195) < 1e-9);
  assert(Math.abs(callout.y - (1 - projected.y) * 195) < 1e-9);
}
const geometry = createWallGeometry(g), mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
const p = geometry.attributes.position.array, normals = geometry.attributes.normal.array;
const tolerance = 3e-5; // Float32 position storage, up to 185.5 mm from origin.
const near = (a, b, e = tolerance) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b} (±${e})`);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = ring => ring.reduce((s, a, i) => { const b = ring[(i + 1) % ring.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2;
const rings = g.contours.map((contour, id) => {
  const ring = contour.map(v => toScene(g, v));
  if ((area(ring) > 0) !== [0, 3, 4].includes(id)) ring.reverse();
  assert.equal(area(ring) > 0, [0, 3, 4].includes(id));
  return ring;
});
const top = rings.map(ring => ring.map((b, i) => {
  const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
  const l0 = Math.hypot(b.x - a.x, b.y - a.y), l1 = Math.hypot(c.x - b.x, c.y - b.y);
  const n0 = { x: -(b.y - a.y) / l0, y: (b.x - a.x) / l0 }, n1 = { x: -(c.y - b.y) / l1, y: (c.x - b.x) / l1 };
  const k = DIMENSIONS.bevel / (1 + n0.x * n1.x + n0.y * n1.y);
  return { x: b.x + k * (n0.x + n1.x), y: b.y + k * (n0.y + n1.y) };
}));
const inside = (v, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > v.y) !== (b.y > v.y) && v.x < (b.x - a.x) * (v.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
const solid = (v, all) => all.reduce((hit, ring) => hit !== inside(v, ring), false);
for (let r = 0; r < rings.length; r++) for (let i = 0; i < rings[r].length; i++) {
  const a = rings[r][i], b = rings[r][(i + 1) % rings[r].length], length = Math.hypot(b.x - a.x, b.y - a.y);
  // Both inset endpoints lie exactly .4 mm on the wood side of each original edge.
  near(cross(a, b, top[r][i]) / length, DIMENSIONS.bevel, 1e-10);
  near(cross(a, b, top[r][(i + 1) % rings[r].length]) / length, DIMENSIONS.bevel, 1e-10);
}
const position = i => new Vector3(p[i], p[i + 1], p[i + 2]);
const edgeKey = v => `${v.x},${v.y},${v.z}`;
const edges = new Map(), slices = [], topVertices = new Set();
let capBottom = 0, capTop = 0, minTriangleArea = Infinity;
for (let i = 0; i < p.length; i += 9) {
  const vertices = [position(i), position(i + 3), position(i + 6)], [a, b, c] = vertices;
  assert.ok(vertices.every(v => [v.x, v.y, v.z].every(Number.isFinite)));
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  const triangleArea = normal.length() / 2;
  minTriangleArea = Math.min(minTriangleArea, triangleArea);
  assert.ok(triangleArea > 1e-7, `Degenerate triangle ${i / 9}`);
  normal.normalize();
  for (let j = 0; j < 3; j++) {
    const index = i + j * 3, n = new Vector3(normals[index], normals[index + 1], normals[index + 2]);
    near(n.length(), 1, 1e-6); assert.ok(n.dot(normal) > 0.999999);
    const from = edgeKey(vertices[j]), to = edgeKey(vertices[(j + 1) % 3]);
    const key = from < to ? `${from}|${to}` : `${to}|${from}`, entry = edges.get(key) || { count: 0, direction: 0 };
    entry.count++; entry.direction += from < to ? 1 : -1; edges.set(key, entry);
  }
  if (vertices.every(v => v.z === 0)) { assert.ok(normal.z < -0.999); capBottom += triangleArea; }
  if (vertices.some(v => v.z > DIMENSIONS.wallHeight - DIMENSIONS.bevel + tolerance) && vertices.some(v => v.z < DIMENSIONS.wallHeight - tolerance)) {
    assert.ok(normal.z > .6 && normal.z < .8, 'Bevel must face upward/outward without folded triangles');
    assert.ok(solid({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }, rings), 'Bevel cannot intrude into passages');
  }
  if (vertices.every(v => v.z === DIMENSIONS.wallHeight)) {
    assert.ok(normal.z > 0.999); capTop += triangleArea;
    assert.ok(solid({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }, rings));
    vertices.forEach(v => topVertices.add(`${v.x},${v.y}`));
  }
  // Intersect the actual mesh at bearing-center height, not merely its bounds.
  const hits = [];
  for (let j = 0; j < 3; j++) {
    const u = vertices[j], v = vertices[(j + 1) % 3];
    if ((u.z < 3) !== (v.z < 3)) hits.push(u.clone().lerp(v, (3 - u.z) / (v.z - u.z)));
  }
  if (hits.length) { assert.equal(hits.length, 2); slices.push(hits); }
}
for (const entry of edges.values()) { assert.equal(entry.count, 2, 'Mesh must be closed/manifold'); assert.equal(entry.direction, 0, 'Mesh winding must be consistent'); }
near(capBottom, rings.reduce((s, ring) => s + area(ring), 0), .003);
near(capTop, top.reduce((s, ring) => s + area(ring), 0), .003);
assert.equal(topVertices.size, rings.flat().length);
const storedTop = top.flat().map(v => `${Math.fround(v.x)},${Math.fround(v.y)}`);
assert.ok(storedTop.every(v => topVertices.has(v)), 'Every cap vertex is the intended inward offset');

const sourceEdges = rings.flatMap(ring => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length], length: 0, count: 0 })));
let maxSectionError = 0;
for (const [u, v] of slices) {
  const match = sourceEdges.find(({ a, b }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.abs(cross(a, b, u)) / length < tolerance && Math.abs(cross(a, b, v)) / length < tolerance &&
      [u, v].every(q => q.x >= Math.min(a.x, b.x) - tolerance && q.x <= Math.max(a.x, b.x) + tolerance &&
        q.y >= Math.min(a.y, b.y) - tolerance && q.y <= Math.max(a.y, b.y) + tolerance);
  });
  assert.ok(match, 'No rendered wall may enter or undercut a passage at bearing-center height');
  match.count++; match.length += u.distanceTo(v);
  const length = Math.hypot(match.b.x - match.a.x, match.b.y - match.a.y);
  maxSectionError = Math.max(maxSectionError, Math.abs(cross(match.a, match.b, u)) / length, Math.abs(cross(match.a, match.b, v)) / length);
}
for (const edge of sourceEdges) { assert.equal(edge.count, 2); near(edge.length, Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y)); }

const raycaster = new Raycaster();
const verticalHit = (v, z = 20) => { raycaster.set(new Vector3(v.x, v.y, z), new Vector3(0, 0, -1)); return raycaster.intersectObject(mesh)[0]; };
let samples = 0;
for (let y = -180; y <= 180; y += 6.7) for (let x = -180; x <= 180; x += 6.7) {
  const point = { x, y }, hit = verticalHit(point);
  // At z=8 the top cap must exactly preserve all three components and holes.
  assert.equal(Boolean(hit && Math.abs(hit.point.z - 8) < 1e-6), solid(point, top), `Wrong cap at ${x},${y}`);
  assert.equal(Boolean(hit), solid(point, rings), `Wrong solid at ${x},${y}`);
  samples++;
}
for (const id of [1, 2, 5]) {
  const hole = rings[id], center = hole.reduce((s, v) => ({ x: s.x + v.x / hole.length, y: s.y + v.y / hole.length }), { x: 0, y: 0 });
  if (!solid(center, rings)) assert.equal(verticalHit(center), undefined, `Hole ${id} sealed`);
}
for (const point of [g.spawn, g.goal]) assert.equal(verticalHit(toScene(g, point)), undefined);

let contacts = 0, cornerContacts = 0;
for (let r = 0; r < rings.length; r++) {
  const ring = rings[r]; let sideChecks = 0, cornerChecks = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], before = ring[(i + ring.length - 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y), right = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
    const candidates = [];
    if (sideChecks < 4) candidates.push({ q: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, n: right, corner: false });
    if (cornerChecks < 3 && cross(before, a, b) > .001) {
      const l0 = Math.hypot(a.x - before.x, a.y - before.y);
      const n = { x: right.x + (a.y - before.y) / l0, y: right.y - (a.x - before.x) / l0 }, size = Math.hypot(n.x, n.y);
      candidates.push({ q: a, n: { x: n.x / size, y: n.y / size }, corner: true });
    }
    for (const { q, n, corner } of candidates) {
      const center = { x: q.x + 3 * n.x, y: q.y + 3 * n.y }, svg = { x: center.x / MM_PER_UNIT + g.center.x, y: -center.y / MM_PER_UNIT + g.center.y };
      if (Math.abs(clearance(g, svg) * MM_PER_UNIT - 3) > 1e-6) continue;
      raycaster.set(new Vector3(center.x, center.y, 3), new Vector3(-n.x, -n.y, 0));
      const hit = raycaster.intersectObject(mesh)[0]; assert.ok(hit); near(hit.distance, 3, .001);
      if (corner) { cornerChecks++; cornerContacts++; } else { sideChecks++; contacts++; }
    }
  }
  if (r !== 4) assert.ok(sideChecks >= 2, `Missing side contacts, ring ${r}`);
  // The exterior perimeter face is deliberately unreachable: outside is forbidden.
}
assert.ok(cornerContacts >= 6, 'Representative convex wall/concave passage corners tested');
let concaveChecks = 0;
for (const ring of rings) for (let i = 0; i < ring.length && concaveChecks < 24; i++) {
  const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
  if (cross(a, b, c) >= -.001) continue;
  const l0 = Math.hypot(b.x - a.x, b.y - a.y), l1 = Math.hypot(c.x - b.x, c.y - b.y);
  const nx = (b.y - a.y) / l0 + (c.y - b.y) / l1, ny = -(b.x - a.x) / l0 - (c.x - b.x) / l1;
  const length = Math.hypot(nx, ny), point = { x: b.x + .1 * nx / length, y: b.y + .1 * ny / length };
  if (solid(point, rings)) continue;
  let nearest, best = Infinity;
  for (const { a, b } of sourceEdges) {
    const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    const q = { x: a.x + t * dx, y: a.y + t * dy }, distance = Math.hypot(point.x - q.x, point.y - q.y);
    if (distance < best) { best = distance; nearest = q; }
  }
  raycaster.set(new Vector3(point.x, point.y, 3), new Vector3(nearest.x - point.x, nearest.y - point.y, 0).normalize());
  const hit = raycaster.intersectObject(mesh)[0]; assert.ok(hit); near(hit.distance, best, .0001); concaveChecks++;
}
assert.equal(concaveChecks, 24);
assert.equal(MM_PER_UNIT, .5); assert.equal(g.radius * MM_PER_UNIT, 3);
assert.equal(DIMENSIONS.baseDepth, 6); assert.equal(DIMENSIONS.wallHeight, 8);
assert.equal(DIMENSIONS.bevel, .4); assert.ok(DIMENSIONS.wallHeight - DIMENSIONS.bevel > 2 * g.radius * MM_PER_UNIT);
assert.equal(DIMENSIONS.glassBottom - 2 * g.radius * MM_PER_UNIT, 3);
assert.equal(DIMENSIONS.glassBottom - DIMENSIONS.wallHeight, 1); assert.equal(DIMENSIONS.glassThickness, 2);
near(geometry.boundingBox.min.x, -185.5); near(geometry.boundingBox.max.x, 185.5);
near(geometry.boundingBox.min.y, -185.25); near(geometry.boundingBox.max.y, 185.25);
assert.equal(geometry.boundingBox.min.z, 0); assert.equal(geometry.boundingBox.max.z, 8);
assert.throws(() => createWallGeometry({}), /Invalid maze geometry/);
const broken = { ...g, contours: g.contours.map(c => c.map(v => ({ ...v }))) };
broken.contours[3][1] = { ...broken.contours[3][0] };
assert.throws(() => createWallGeometry(broken), /Invalid maze ring edge/);
geometry.dispose(); mesh.material.dispose();
console.log(JSON.stringify({ triangles: p.length / 9, minTriangleArea, capBottom, capTop, crossSections: slices.length, maxSectionError, raySamples: samples, sideContacts: contacts, cornerContacts, concaveChecks, toleranceMm: tolerance }));
