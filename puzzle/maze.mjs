// Positions are SVG units; orientation is scene XY tilt (scene Y = -SVG Y).
// Board model: pivot at the board centre, tilt vector e = theta * downhill (SVG axes),
// board angular velocity w = de/dt. A solid sphere rolls without slipping on it.
export const DT = 1 / 240;
export const MM_PER_UNIT = 0.5;
export const MAX_TILT = 30 * Math.PI / 180;
export const FLATNESS = 0.06;
export const GRAVITY = 9.80665;
export const BALL_RADIUS = 6; // SVG units
const METRES = MM_PER_UNIT / 1000; // metres per SVG unit
const RIM = 371 * METRES; // farthest point of the board from the pivot
// Largest tilt angular acceleration at which the board's own motion cannot lift a
// resting ball anywhere on the board: N/m >= g*cos(MAX_TILT) - alpha*RIM = 0.1*g*cos(MAX_TILT).
export const MAX_TILT_ACCEL = 0.9 * GRAVITY * Math.cos(MAX_TILT) / RIM;
// Servo braking uses 90% of the limit so tracking error cannot overshoot the target.
const BRAKE_ACCEL = 0.9 * MAX_TILT_ACCEL;
const LINEAR_ZONE = 0.5; // fraction of the error closed per tick near the target: no chatter
// ponytail: w = de/dt is taken as the board's in-plane angular velocity. A non-radial tilt path
// also yaws the board (~(1-cos t)/t^2 (e x w), up to 1.2 rad/s under random full-range servo
// play); test/maze-rigid.mjs measures the omitted term against a full 3-D rigid-body solve:
// 0 for radial paths (exact at any tilt), <= 1.4 m/s^2 in acceleration (vs 4.9 m/s^2 drive at
// 30 deg) and <= 0.7 m/s^2 in N/m worst case, mostly during fast direction reversals at high
// tilt. Replace by a quaternion-rate state if that ever matters. Rolling slip, floor bounce and
// spin about the board normal are also omitted.
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
  const geometry = { contours, center, radius: BALL_RADIUS, spawn: { x: 746, y: 300 },
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
  return { x: g.spawn.x, y: g.spawn.y, vx: 0, vy: 0, tilt: { x: 0, y: 0 }, tiltRate: { x: 0, y: 0 },
    orientation: [0, 0, 0, 1], won: false, error: null };
}
export function projectedGravity([x, y, z, w]) {
  // inverse(Q) * world down, with scene Y converted once to SVG Y.
  return { x: 2 * (w * y - x * z), y: 2 * (w * x + y * z) };
}
// Exact acceleration (SVG units/s^2) of a solid sphere rolling without slip on the board.
// p: ball position from the pivot (SVG units); v: velocity relative to the board (units/s);
// tilt e (rad, downhill in SVG axes), tiltRate w = de/dt, tiltAccel = dw/dt.
// a = 5/7 [g sin(t) e^ + (w.p) w] - r dw/dt   (Euler term has factor 1: rolling coupling cancels it)
// normal = N/m in m/s^2 = g cos(t) - dw.p - r|w|^2 - 2 w.v; the ball leaves the floor when < 0.
export function boardAcceleration({ p, v, tilt, tiltRate: w, tiltAccel: dw }) {
  const theta = Math.hypot(tilt.x, tilt.y), slope = theta ? Math.sin(theta) / theta : 1;
  const drive = GRAVITY / METRES * slope, centrifugal = w.x * p.x + w.y * p.y;
  const ax = (5 / 7) * (drive * tilt.x + centrifugal * w.x) - BALL_RADIUS * dw.x;
  const ay = (5 / 7) * (drive * tilt.y + centrifugal * w.y) - BALL_RADIUS * dw.y;
  const normal = GRAVITY * Math.cos(theta) - METRES * ((dw.x * p.x + dw.y * p.y) +
    2 * (w.x * v.x + w.y * v.y)) - BALL_RADIUS * METRES * (w.x * w.x + w.y * w.y);
  return { ax, ay, normal };
}
// Time-optimal angular-acceleration-limited servo toward the input's tilt vector.
// Sets s.tilt, s.tiltRate, s.orientation; returns the tick's angular acceleration dw/dt.
function advanceTilt(s, input) {
  const magnitude = Math.hypot(input.x, input.y);
  const aim = magnitude ? Math.asin(SIN_TILT * Math.min(1, magnitude)) / magnitude : 0;
  const ex = input.x * aim - s.tilt.x, ey = input.y * aim - s.tilt.y, error = Math.hypot(ex, ey);
  const w0 = s.tiltRate;
  if (error < 1e-12 && Math.hypot(w0.x, w0.y) < 1e-9) { // settled: snap, never creep
    s.tilt = { x: input.x * aim, y: input.y * aim }; s.tiltRate = { x: 0, y: 0 };
    s.orientation = orientationOf(s.tilt); return { x: -w0.x / DT, y: -w0.y / DT };
  }
  // Brake along sqrt(2 a e); the linear zone (half the error per tick) stops chatter at the target.
  const speed = error ? Math.min(Math.sqrt(2 * BRAKE_ACCEL * error), LINEAR_ZONE * error / DT) : 0;
  const want = { x: error ? ex / error * speed : 0, y: error ? ey / error * speed : 0 };
  const theta0 = Math.hypot(s.tilt.x, s.tilt.y);
  if (theta0 > 1e-9) { // never carry more outward rate than can be braked before the mechanical stop
    const rx = s.tilt.x / theta0, ry = s.tilt.y / theta0, outward = want.x * rx + want.y * ry;
    const safe = Math.sqrt(2 * BRAKE_ACCEL * Math.max(0, MAX_TILT - theta0));
    if (outward > safe) { want.x -= (outward - safe) * rx; want.y -= (outward - safe) * ry; }
  }
  const limit = (dx, dy) => { // |dw|/DT <= MAX_TILT_ACCEL
    const over = Math.hypot(dx, dy) / (MAX_TILT_ACCEL * DT);
    return over > 1 ? [dx / over, dy / over] : [dx, dy];
  };
  const [dx, dy] = limit(want.x - w0.x, want.y - w0.y);
  let w = { x: w0.x + dx, y: w0.y + dy }, x = s.tilt.x + w.x * DT, y = s.tilt.y + w.y * DT;
  const theta = Math.hypot(x, y);
  if (theta > MAX_TILT) { // mechanical stop: kill the outward rate, but never faster than the servo limit
    x *= MAX_TILT / theta; y *= MAX_TILT / theta;
    const radial = Math.max(0, (w.x * x + w.y * y) / MAX_TILT);
    const [sx, sy] = limit(w.x - radial * x / MAX_TILT - w0.x, w.y - radial * y / MAX_TILT - w0.y);
    w = { x: w0.x + sx, y: w0.y + sy };
  }
  s.tilt = { x, y }; s.tiltRate = w; s.orientation = orientationOf(s.tilt);
  return { x: (w.x - w0.x) / DT, y: (w.y - w0.y) / DT };
}
function orientationOf({ x, y }) {
  const theta = Math.hypot(x, y), k = theta ? Math.sin(theta / 2) / theta : 0;
  return [y * k, x * k, 0, Math.cos(theta / 2)];
}
const vector = v => v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y);
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
      !['x', 'y', 'vx', 'vy'].every(k => Number.isFinite(s[k])) ||
      !vector(s.tilt) || !vector(s.tiltRate) || Math.hypot(s.tilt.x, s.tilt.y) > MAX_TILT + 1e-9 ||
      clearance(g, s) < g.radius - 0.02) {
    s.error = 'Invalid physics state or tilt input'; return s;
  }
  const tiltAccel = advanceTilt(s, input), { tilt, tiltRate } = s;
  const accel = () => boardAcceleration({ p: { x: s.x - g.center.x, y: s.y - g.center.y },
    v: { x: s.vx, y: s.vy }, tilt, tiltRate, tiltAccel });
  const first = accel();
  // Bound actual travel, including acceleration, to 0.45 SVG/contact. Contacts
  // remove normal energy; no gameplay speed cap or geometry-dependent drag.
  const count = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) + Math.hypot(first.ax, first.ay) * DT) * DT / 0.45));
  if (!Number.isFinite(count) || count > MAX_CONTACT_STEPS) {
    s.error = 'Physics contact budget exceeded; reset required'; return s;
  }
  const h = DT / count;
  for (let i = 0; i < count; i++) {
    const before = { x: s.x, y: s.y };
    const { ax, ay, normal } = i ? accel() : first;
    s.vx += ax * h; s.vy += ay * h;
    // ponytail: when normal < 0 (fast flick + Coriolis) the ball is airborne by at most the 3 mm
    // under the glass lid; keep the 2D model but apply no resistance. Add a hop state if needed.
    const resistance = (5 / 7) * ROLLING_RESISTANCE * Math.max(0, normal) / METRES;
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
