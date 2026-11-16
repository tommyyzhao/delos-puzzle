import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from './vendor/three/three.module.js';

import { MM_PER_UNIT } from './maze.mjs';
export { MM_PER_UNIT };
export const DIMENSIONS = Object.freeze({ baseDepth: 6, wallHeight: 8, bevel: 0.4, glassBottom: 9, glassThickness: 2 });
export const toScene = (g, p) => ({ x: (p.x - g.center.x) * MM_PER_UNIT, y: -(p.y - g.center.y) * MM_PER_UNIT });
const SOLIDS = [[0, 1, 2], [3], [4, 5]];
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = p => p.reduce((sum, a, i) => {
  const b = p[(i + 1) % p.length];
  return sum + a.x * b.y - b.x * a.y;
}, 0) / 2;
function inside(p, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function inset(ring) {
  return ring.map((b, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
    const l0 = Math.hypot(b.x - a.x, b.y - a.y), l1 = Math.hypot(c.x - b.x, c.y - b.y);
    const n0 = { x: -(b.y - a.y) / l0, y: (b.x - a.x) / l0 };
    const n1 = { x: -(c.y - b.y) / l1, y: (c.x - b.x) / l1 };
    const denominator = 1 + n0.x * n1.x + n0.y * n1.y;
    if (denominator < 1e-6) throw new Error('Unbevelable maze corner');
    return new Vector2(b.x + DIMENSIONS.bevel * (n0.x + n1.x) / denominator,
      b.y + DIMENSIONS.bevel * (n0.y + n1.y) / denominator);
  });
}
function validateRings(rings) {
  const edges = rings.flatMap((ring, r) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length], r, i, n: ring.length })));
  for (const { a, b } of edges) {
    if (![a.x, a.y].every(Number.isFinite) || Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) throw new Error('Invalid maze ring edge');
  }
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j];
      if (a.r === b.r && (b.i === a.i + 1 || (a.i === 0 && b.i === a.n - 1))) continue;
      if (Math.max(a.a.x, a.b.x) < Math.min(b.a.x, b.b.x) || Math.max(b.a.x, b.b.x) < Math.min(a.a.x, a.b.x) ||
          Math.max(a.a.y, a.b.y) < Math.min(b.a.y, b.b.y) || Math.max(b.a.y, b.b.y) < Math.min(a.a.y, a.b.y)) continue;
      if (cross(a.a, a.b, b.a) * cross(a.a, a.b, b.b) <= 0 && cross(b.a, b.b, a.a) * cross(b.a, b.b, a.b) <= 0) {
        throw new Error('Maze bevel/ring intersection');
      }
    }
  }
  for (const ids of SOLIDS) for (const id of ids.slice(1)) {
    if (!inside(rings[id][0], rings[ids[0]])) throw new Error('Maze hole escaped its solid');
  }
}

export function createWallGeometry(g) {
  if (!g || g.contours?.length !== 6 || !Number.isFinite(g.center?.x) || !Number.isFinite(g.center?.y)) throw new Error('Invalid maze geometry');
  const rings = g.contours.map((contour, id) => {
    if (contour.length < 3) throw new Error('Invalid maze contour');
    const ring = contour.map(p => { const q = toScene(g, p); return new Vector2(q.x, q.y); });
    // All boundaries keep wood on their left: exterior CCW, holes CW.
    if ((area(ring) > 0) !== [0, 3, 4].includes(id)) ring.reverse();
    return ring;
  });
  validateRings(rings);
  const top = rings.map(inset);
  validateRings(top);
  const positions = [], uvs = [];
  const triangle = (a, za, b, zb, c, zc) => {
    positions.push(a.x, a.y, za, b.x, b.y, zb, c.x, c.y, zc);
    uvs.push(a.x / 40, a.y / 40, b.x / 40, b.y / 40, c.x / 40, c.y / 40);
  };
  const cap = (all, z, bottom) => {
    for (const ids of SOLIDS) {
      const outer = all[ids[0]], holes = ids.slice(1).map(id => all[id]);
      const points = [outer, ...holes].flat();
      const faces = ShapeUtils.triangulateShape(outer, holes);
      const expected = ids.reduce((sum, id) => sum + area(all[id]), 0);
      let actual = 0;
      for (const [i, j, k] of faces) {
        const a = points[i], b = points[j], c = points[k], signed = cross(a, b, c) / 2;
        const center = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
        if (signed <= 1e-10 || !inside(center, outer) || holes.some(hole => inside(center, hole))) throw new Error('Invalid maze cap triangulation');
        actual += signed;
        if (bottom) triangle(c, z, b, z, a, z); else triangle(a, z, b, z, c, z);
      }
      if (Math.abs(actual - expected) > Math.max(1e-6, expected * 1e-9)) throw new Error('Maze cap area mismatch');
    }
  };
  cap(rings, 0, true);
  cap(top, DIMENSIONS.wallHeight, false);
  const shoulder = DIMENSIONS.wallHeight - DIMENSIONS.bevel;
  for (let r = 0; r < rings.length; r++) for (let i = 0; i < rings[r].length; i++) {
    const j = (i + 1) % rings[r].length, a = rings[r][i], b = rings[r][j], c = top[r][j], d = top[r][i];
    triangle(a, 0, b, 0, b, shoulder);
    triangle(a, 0, b, shoulder, a, shoulder);
    triangle(a, shoulder, b, shoulder, c, DIMENSIONS.wallHeight);
    triangle(a, shoulder, c, DIMENSIONS.wallHeight, d, DIMENSIONS.wallHeight);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
