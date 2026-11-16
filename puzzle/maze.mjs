// Positions are SVG units; orientation is scene XY tilt (scene Y = -SVG Y).
export const DT = 1 / 240;
export const MM_PER_UNIT = 0.5;
export const MAX_TILT = 30 * Math.PI / 180;
export const MAX_TILT_RATE = 450 * Math.PI / 180;
export const FLATNESS = 0.06;
// ponytail: constrained solid-sphere rolling omits slip, jumps and rocking
// inertia; use a rigid-body model only if those motions become necessary.
const ROLLING_ACCELERATION = (5 / 7) * 9.80665 / (MM_PER_UNIT / 1000);
const SIN_TILT = Math.sin(MAX_TILT);
// Tunable rolling-resistance approximation, not measured steel/wood data.
export const ROLLING_RESISTANCE = 0.005;
const MAX_CONTACT_STEPS = 512;
const SKIN = 0.015;
const CELL = 20;
const finite = p => Number.isFinite(p.x) && Number.isFinite(p.y);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function closest(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function cubic(a, b, c, d, out, depth = 0) {
  // Distance to the chord's segment (not its infinite line) bounds the entire
  // Bezier convex hull, including collinear reversals and coincident endpoints.
  if (Math.max(distance(b, closest(b, a, d)), distance(c, closest(c, a, d))) <= FLATNESS) {
    out.push(d); return;
  }
  if (depth >= 20 || out.length > 20000) throw new Error('Curve exceeds flattening budget');
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d);
  const abc = mid(ab, bc), bcd = mid(bc, cd), m = mid(abc, bcd);
  cubic(a, ab, abc, m, out, depth + 1); cubic(m, bcd, cd, d, out, depth + 1);
}
function pathContours(data) {
  if (!/^[MCZ\d.\s-]+$/.test(data) || data.length > 50000) throw new Error('Unsupported path vocabulary');
  const tokens = data.replace(/[MCZ]/g, ' $& ').trim().split(/\s+/);
  if (tokens.some(t => !/^(?:[MCZ]|-?\d+(?:\.\d+)?)$/.test(t))) throw new Error('Invalid path numbers');
  let i = 0, contour, current;
  const result = [];
  const point = () => {
    const p = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
    if (!finite(p) || p.x < 0 || p.x > 878 || p.y < 0 || p.y > 806) throw new Error('Invalid path coordinate');
    return p;
  };
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M' && !contour) { current = point(); contour = [current]; }
    else if (op === 'C' && contour) {
      const b = point(), c = point(), d = point(); cubic(current, b, c, d, contour); current = d;
    } else if (op === 'Z' && contour && contour.length >= 4) {
      if (distance(contour[0], contour.at(-1)) < 1e-9) contour.pop();
      result.push(contour); contour = null;
    } else throw new Error('Invalid closed cubic path');
  }
  if (contour || result.length !== 4) throw new Error('Expected four closed subpaths');
  return result;
}

// Only the sanitized asset grammar is accepted; never inject source SVG markup.
export function parseMaze(text) {
  if (typeof text !== 'string' || text.length > 55000) throw new Error('Invalid maze asset');
  const match = text.match(/^\s*<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 878 806">\s*<ellipse cx="442\.5" cy="412" rx="360\.5" ry="360" fill="none" stroke="#000000" stroke-width="21"\s*\/>\s*<path fill="#000000" fill-rule="evenodd" d="([MCZ\d.\s-]+)"\s*\/>\s*<\/svg>\s*$/);
  if (!match) throw new Error('Unsupported maze asset schema');
  const contours = pathContours(match[1]);
  const center = { x: 442.5, y: 412 };
  const n = Math.ceil(Math.PI / Math.acos(1 - 0.05 / 371));
  for (const offset of [10.5, -10.5]) {
    contours.push(Array.from({ length: n }, (_, i) => {
      const c = Math.cos(2 * Math.PI * i / n), s = Math.sin(2 * Math.PI * i / n);
      const normal = Math.hypot(c / 360.5, s / 360);
      return { x: center.x + 360.5 * c + offset * c / 360.5 / normal,
        y: center.y + 360 * s + offset * s / 360 / normal };
    }));
  }
  const geometry = { contours, center, radius: 6, spawn: { x: 746, y: 300 },
    goal: { x: 435, y: 433, radius: 5 }, bounds: { width: 878, height: 806 }, extent: 371,
    segments: [], bins: new Map(), rows: new Map() };
  for (const contour of contours) for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    if (distance(a, b) < 1e-9) continue;
    const id = geometry.segments.push({ a, b }) - 1;
    const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL);
    const y0 = Math.floor(Math.min(a.y, b.y) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL);
    for (let y = y0; y <= y1; y++) {
      if (!geometry.rows.has(y)) geometry.rows.set(y, []);
      geometry.rows.get(y).push(id);
      for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}`;
        if (!geometry.bins.has(key)) geometry.bins.set(key, []);
        geometry.bins.get(key).push(id);
      }
    }
  }
  if (clearance(geometry, geometry.spawn) < geometry.radius + FLATNESS ||
      clearance(geometry, geometry.goal) < geometry.radius + FLATNESS) throw new Error('Blocked spawn or goal');
  return geometry;
}
function solid(g, p) {
  // The outside is forbidden too: the annulus is a container, not an exit.
  if (Math.hypot((p.x - g.center.x) / 371, (p.y - g.center.y) / 370.5) >= 1) return true;
  let inside = false;
  for (const id of g.rows.get(Math.floor(p.y / CELL)) || []) {
    const { a, b } = g.segments[id];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function nearest(g, p) {
  const x = Math.floor(p.x / CELL), y = Math.floor(p.y / CELL);
  let best = Infinity, q;
  for (let r = 0; r < 50; r++) {
    for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) {
      if (r && j !== y - r && j !== y + r && i !== x - r && i !== x + r) continue;
      for (const id of g.bins.get(`${i},${j}`) || []) {
        const { a, b } = g.segments[id], hit = closest(p, a, b), d = distance(p, hit);
        if (d < best) { best = d; q = hit; }
      }
    }
    const edge = Math.min(p.x - (x - r) * CELL, (x + r + 1) * CELL - p.x,
      p.y - (y - r) * CELL, (y + r + 1) * CELL - p.y);
    if (best <= edge) break;
  }
  return { d: best, q };
}
export function clearance(g, p) {
  if (!finite(p)) return -Infinity;
  const { d } = nearest(g, p);
  return solid(g, p) ? -d : d;
}
export function createState(g) {
  return { x: g.spawn.x, y: g.spawn.y, vx: 0, vy: 0, angle: 0,
    orientation: [0, 0, 0, 1], won: false, error: null };
}
export function projectedGravity([x, y, z, w]) {
  // inverse(Q) * world down, with scene Y converted once to SVG Y.
  return { x: 2 * (w * y - x * z), y: 2 * (w * x + y * z) };
}
function advanceTilt(q, input) {
  const magnitude = Math.hypot(input.x, input.y);
  const half = Math.asin(SIN_TILT * Math.min(1, magnitude)) / 2;
  const scale = magnitude ? Math.sin(half) / magnitude : 0;
  const target = [input.y * scale, input.x * scale, 0, Math.cos(half)];
  const angle = Math.acos(Math.max(-1, Math.min(1, q.reduce((sum, v, i) => sum + v * target[i], 0))));
  if (angle < 1e-10) return target;
  const t = Math.min(1 - Math.exp(-DT / 0.035), MAX_TILT_RATE * DT / (2 * angle));
  const a = Math.sin((1 - t) * angle) / Math.sin(angle), b = Math.sin(t * angle) / Math.sin(angle);
  const next = q.map((v, i) => a * v + b * target[i]);
  const norm = Math.hypot(...next);
  return next.map(v => v / norm);
}
function validOrientation(q) {
  return Array.isArray(q) && q.length === 4 && q.every(Number.isFinite) &&
    Math.abs(Math.hypot(...q) - 1) < 1e-8 && Math.abs(q[2]) < 1e-10 &&
    q[3] >= Math.cos(MAX_TILT / 2) - 1e-10;
}
function contact(g, s) {
  // Re-query after each correction so corners resolve against both walls.
  for (let k = 0; k < 12; k++) {
    const { d, q } = nearest(g, s), inside = solid(g, s);
    if (!inside && d >= g.radius + SKIN - 1e-7) return true;
    if (!q || d < 1e-10) return false;
    const sign = inside ? -1 : 1;
    const nx = sign * (s.x - q.x) / d, ny = sign * (s.y - q.y) / d;
    const push = g.radius + SKIN - sign * d;
    s.x += nx * push; s.y += ny * push;
    const vn = s.vx * nx + s.vy * ny;
    // Low-speed contact rests; a real impact has a small steel-on-wood bounce.
    // Tangential velocity is untouched: pressing a wall must not glue the ball.
    if (vn < 0) {
      const bounce = vn < -12 ? 1.08 : 1;
      s.vx -= bounce * vn * nx; s.vy -= bounce * vn * ny;
    }
  }
  return clearance(g, s) >= g.radius - 1e-6;
}
export function step(g, s, input) {
  if (s.error || s.won) return s;
  if (!input || !finite(input) || Math.hypot(input.x, input.y) > 1 + 1e-9 ||
      !['x', 'y', 'vx', 'vy', 'angle'].every(k => Number.isFinite(s[k])) || s.angle !== 0 ||
      !validOrientation(s.orientation) || clearance(g, s) < g.radius - 0.02) {
    s.error = 'Invalid physics state or tilt input'; return s;
  }
  s.orientation = advanceTilt(s.orientation, input);
  const gravity = projectedGravity(s.orientation);
  const ax = ROLLING_ACCELERATION * gravity.x, ay = ROLLING_ACCELERATION * gravity.y;
  const resistance = ROLLING_ACCELERATION * ROLLING_RESISTANCE *
    Math.sqrt(Math.max(0, 1 - gravity.x ** 2 - gravity.y ** 2));
  // Bound actual travel, including acceleration, to 0.45 SVG/contact. Contacts
  // remove normal energy; no gameplay speed cap or geometry-dependent drag.
  const count = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) + Math.hypot(ax, ay) * DT) * DT / 0.45));
  if (!Number.isFinite(count) || count > MAX_CONTACT_STEPS) {
    s.error = 'Physics contact budget exceeded; reset required'; return s;
  }
  const h = DT / count;
  for (let i = 0; i < count; i++) {
    const before = { x: s.x, y: s.y };
    s.vx += ax * h; s.vy += ay * h;
    // Dry resistance can stop, never reverse, the combined rolling velocity.
    const speed = Math.hypot(s.vx, s.vy), remaining = Math.max(0, speed - resistance * h);
    const factor = speed ? remaining / speed : 0;
    s.vx *= factor; s.vy *= factor;
    s.x += s.vx * h; s.y += s.vy * h;
    if (clearance(g, s) < g.radius - 0.6 || !contact(g, s)) {
      Object.assign(s, before); s.error = 'Unresolved maze contact; reset required'; return s;
    }
    // Torso pocket only; check every safe contact interval, not just each tick.
    if (s.x >= 431 && s.x <= 440 && s.y >= 423 && s.y <= 440 && clearance(g, s) >= g.radius) {
      s.won = true; break;
    }
  }
  if (!['x', 'y', 'vx', 'vy'].every(k => Number.isFinite(s[k]))) s.error = 'Non-finite physics state';
  return s;
}
