import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseMaze, createState, step, clearance, projectedGravity, boardAcceleration, DT, MM_PER_UNIT,
  ROLLING_RESISTANCE, MAX_TILT, MAX_TILT_ACCEL, GRAVITY, FLATNESS } from '../puzzle/maze.mjs';

const start = performance.now();
const source = readFileSync(new URL('../puzzle/maze.svg', import.meta.url), 'utf8');
const g = parseMaze(source);
assert.equal(g.contours.length, 6);
assert.equal(g.radius, 6);
assert(FLATNESS <= 0.06);
assert.equal(MAX_TILT, Math.PI / 6);
assert(g.contours.every(c => c.length > 3 && c.every(p => Number.isFinite(p.x + p.y))));
for (const bad of [null, '', source + '<script/>', source.replace('M397.46', 'MNaN'),
  source.replace('M397.46', 'M9999'), source.replace('397.46', '397.4.6'),
  source.replace('evenodd', 'nonzero'), source.replace('21"', '22"'),
  source.replace('C394.69', 'L394.69'), source.replace('</svg>', '<image href="x"/></svg>')]) {
  assert.throws(() => parseMaze(bad));
}
assert(clearance(g, g.spawn) > 7.65);
assert(clearance(g, g.goal) > 8.05);
assert(clearance(g, { x: 438, y: 330 }) > 4); // Eye exists, but is sealed.
assert(clearance(g, { x: 437, y: 685 }) > 6); // Lower enclosed hole.
assert(clearance(g, { x: 850, y: 412 }) < 0);
assert(clearance(g, { x: NaN, y: 0 }) < 0);

// A signed distance is 1-Lipschitz: endpoint margin >sqrt(2)+flattening
// conservatively certifies entire reachable two-unit cells, not just samples.
const spacing = 2, W = 440, H = 404, N = W * H;
const index = p => Math.round(p.y / spacing) * W + Math.round(p.x / spacing);
const prev = new Int32Array(N).fill(-1), queue = new Int32Array(N), free = new Uint8Array(N);
const seen = new Uint8Array(N), from = index(g.spawn), goal = index(g.goal);
queue[0] = from; seen[from] = 1;
let count = 1, read = 0;
while (read < count) {
  const i = queue[read++];
  for (const j of [i - 1, i + 1, i - W, i + W]) {
    if (j < 0 || j >= N || seen[j] || Math.abs(j % W - i % W) > 1) continue;
    if (!free[j]) free[j] = clearance(g, { x: j % W * spacing, y: Math.floor(j / W) * spacing }) >= g.radius + 1.5 ? 1 : 2;
    if (free[j] !== 1) continue;
    seen[j] = 1; prev[j] = i; queue[count++] = j;
  }
}
assert(seen[goal], 'Six-unit ball must fit the original torso route');
assert(!seen[index({ x: 438, y: 330 })], 'Eye must remain sealed');
assert(!seen[index({ x: 437, y: 685 })], 'Lower hole must remain sealed');
assert(!seen[index({ x: 820, y: 412 })], 'Perimeter must remain sealed');
let routeNodes = 0, routeClearance = Infinity;
for (let i = goal; i !== -1; i = prev[i]) {
  routeNodes++;
  routeClearance = Math.min(routeClearance, clearance(g, { x: i % W * spacing, y: Math.floor(i / W) * spacing }));
}
assert(routeClearance > g.radius + Math.SQRT2 + FLATNESS);

function valid(s) {
  assert.equal(s.error, null);
  for (const k of ['x', 'y', 'vx', 'vy']) assert(Number.isFinite(s[k]), k);
  assert(!('angle' in s), 'No in-plane spinning state');
  assert(Math.hypot(s.tilt.x, s.tilt.y) <= MAX_TILT + 1e-12 && Number.isFinite(s.tiltRate.x + s.tiltRate.y));
  assert(s.orientation.every(Number.isFinite));
  assert(Math.abs(Math.hypot(...s.orientation) - 1) < 1e-12, 'Orientation remains unit length');
  assert.equal(s.orientation[2], 0, 'Tilt has no yaw component');
  assert(2 * Math.acos(Math.min(1, s.orientation[3])) <= MAX_TILT + 1e-10, 'Total inclination bounded');
  assert(Number.isFinite(Math.hypot(s.vx, s.vy)));
  assert(clearance(g, s) >= g.radius - 1e-6, 'No tunneling or unresolved overlap');
  assert(Math.hypot(s.x - g.center.x, s.y - g.center.y) < 350, 'Outer containment');
}
const level = { x: 0, y: 0 };
function hold(s, input, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) { step(g, s, input); valid(s); }
  return s;
}
const settled = (state, degrees, bearing = 0) => { // board at rest at a static tilt (SVG downhill = bearing)
  const t = degrees * Math.PI / 180; state.tilt = { x: t * Math.cos(bearing), y: t * Math.sin(bearing) };
  state.tiltRate = { x: 0, y: 0 }; return state;
};
const rollingG = (5 / 7) * 9.80665 / 0.0005;
assert.equal(MM_PER_UNIT / 1000, 0.0005, 'Rendered millimetres and physics metres share one scale');
assert.equal(ROLLING_RESISTANCE, .005);
const accelerations = [];
for (const degrees of [1, 5, 15, 30]) {
  const radians = degrees * Math.PI / 180, input = { x: Math.sin(radians) / Math.sin(MAX_TILT), y: 0 };
  const state = settled(createState(g), degrees);
  step(g, state, input); valid(state);
  const gravity = projectedGravity(state.orientation);
  assert(Math.abs(gravity.x - Math.sin(radians)) < 1e-14, 'Raw tangential gravity has no max-angle normalization');
  assert.equal(gravity.y, 0);
  const pure = boardAcceleration({ p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, tilt: state.tilt, tiltRate: { x: 0, y: 0 }, tiltAccel: { x: 0, y: 0 } });
  assert(Math.abs(pure.ax - (5 / 7) * 9.80665 * Math.sin(radians) / .0005) < 1e-6 && pure.ay === 0);
  assert(Math.abs(pure.normal - 9.80665 * Math.cos(radians)) < 1e-12);
  const ideal = (5 / 7) * 9.80665 * Math.sin(radians) / .0005;
  const expected = ideal - rollingG * .005 * Math.cos(radians);
  assert(Math.abs(state.vx / DT - expected) < 1e-9, 'Solid sphere acceleration minus explicit normal-force resistance');
  assert(Math.abs(ideal / ((5 / 7) * 9.80665 * .5 / .0005) - Math.sin(radians) / .5) < 1e-14);
  accelerations.push({ degrees, ideal, net: state.vx / DT });
}
let s = createState(g), initial = structuredClone(s);
settled(s, .1);
hold(s, { x: Math.sin(Math.PI / 1800) / .5, y: 0 }, .25);
assert.equal(s.vx, 0); assert.equal(s.x, g.spawn.x, 'Sub-resistance slope cannot propel uphill or jitter');
s = createState(g);
hold(s, level, 2); assert.deepEqual(s, initial, 'Level rest does not jitter');
s.vx = 40; initial = { ...s }; hold(s, level, .25);
assert(s.vx > 22 && s.x > initial.x + 7, 'Level preserves momentum instead of hidden braking');
hold(s, level, .5); assert.equal(s.vx, 0); assert.equal(s.vy, 0);
const stopped = { ...s }; hold(s, level, 1); assert.deepEqual(s, stopped, 'Resistance stops without reversing');
s = createState(g); s.vx = -400; step(g, s, level); valid(s);
assert(s.vx < -399 && Math.abs(s.x - g.spawn.x) > 1.6, 'Ordinary velocity is not capped at 72 SVG/s');
s = settled(createState(g), 5); s.x = 755; s.vx = -100;
for (let i = 0; i < 12; i++) step(g, s, { x: Math.sin(Math.PI / 36) / .5, y: 0 });
valid(s); assert(s.vx < 0 && s.vx > -45, 'Counter-tilt brakes existing momentum');
for (let i = 0; i < 12; i++) step(g, s, { x: Math.sin(Math.PI / 36) / .5, y: 0 });
valid(s); assert(s.vx > 20, 'Continued counter-tilt reverses motion');
for (const bad of [NaN, Infinity, '1', undefined, null, 0, {}, { x: 0 },
  { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '1', y: 0 }, { x: 1, y: 1 }, { x: -2, y: 0 }]) {
  s = createState(g); step(g, s, bad); assert(s.error); assert(!s.won);
}
for (const [key, value] of [['vx', NaN], ['x', 850], ['tilt', undefined], ['tilt', { x: NaN, y: 0 }],
  ['tilt', { x: .6, y: 0 }], ['tiltRate', null], ['tiltRate', { x: 0, y: Infinity }]]) {
  s = createState(g); s[key] = value; step(g, s, level); assert(s.error); assert(!s.won);
}
s = createState(g); s.x = 438; s.y = 330; step(g, s, level); assert(!s.won); valid(s);
s = createState(g); s.x = g.center.x; s.y = g.center.y; step(g, s, level); assert(!s.won);
const budgetStart = performance.now();
for (const speed of [1e8, Number.MAX_VALUE]) {
  s = createState(g); s.vx = speed; const before = { x: s.x, y: s.y };
  step(g, s, level); assert.match(s.error, /contact budget exceeded/); assert(!s.won);
  assert.equal(s.x, before.x); assert.equal(s.y, before.y);
}
const budgetMilliseconds = performance.now() - budgetStart;
assert(budgetMilliseconds < 1000, 'Extreme states fail with bounded work');
for (const input of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: .6, y: .8 }, level]) {
  hold(createState(g), input, 3);
}
// High-speed tight bends, wall slides, small impacts and perimeter containment.
const highSpeedStart = performance.now();
for (const p of [{ x: 538, y: 680 }, { x: 310, y: 614 }, { x: 214, y: 404 }, { x: 786, y: 412 }]) {
  for (const input of [{ x: .6, y: .8 }, { x: -.6, y: -.8 }]) {
    s = Object.assign(createState(g), p, { vx: input.x * 1200, vy: input.y * 1200 });
    hold(s, input, 1);
  }
}
const highSpeedMilliseconds = performance.now() - highSpeedStart;
s = createState(g); s.x = 786.4; s.y = 412; s.vy = 400;
hold(s, { x: 1, y: 0 }, .03); assert(s.y > 423 && s.vy > 390, 'Wall preserves tangential velocity');
const wallX = s.x; hold(s, { x: -1, y: 0 }, .4);
assert(s.x < wallX - 1 && s.vx < 0, 'Counter-tilt leaves wall contact');
s = createState(g); s.x = 786; s.y = 412; s.vx = 400;
hold(s, level, .004); assert(s.vx < 0, 'Impact keeps existing low restitution');
s = createState(g); s.x = 435; s.y = 421; s.vy = 10000;
step(g, s, level); valid(s); assert(s.won && s.y < 424, 'Fast goal crossing is caught inside a fixed tick');
assert.deepEqual(createState(g), createState(g), 'Reset has no hidden global state');
assert.deepEqual(projectedGravity([0, 0, 0, 1]), level);
const rim = 371 * MM_PER_UNIT / 1000, liftBound = .9 * 9.80665 * Math.cos(MAX_TILT);
assert(Math.abs(MAX_TILT_ACCEL * rim - liftBound) < 1e-9, 'Servo limit is the rim lift bound');
const rimPoints = Array.from({ length: 16 }, (_, i) => ({ x: 371 * Math.cos(i * Math.PI / 8), y: 371 * Math.sin(i * Math.PI / 8) }));
function servoRun(inputs, holdTicks) { // returns the full tilt history; ball is irrelevant to the servo
  const state = createState(g), trace = []; let worstRim = 0, worstNormal = Infinity, worstTilt = 0;
  for (const input of inputs) for (let i = 0; i < holdTicks; i++) {
    const before = { ...state.tiltRate }; state.x = g.spawn.x; state.y = g.spawn.y; state.vx = state.vy = 0;
    step(g, state, input); assert.equal(state.error, null);
    const dw = { x: (state.tiltRate.x - before.x) / DT, y: (state.tiltRate.y - before.y) / DT };
    worstRim = Math.max(worstRim, Math.hypot(dw.x, dw.y) * rim / liftBound);
    worstTilt = Math.max(worstTilt, Math.hypot(state.tilt.x, state.tilt.y));
    for (const p of rimPoints) worstNormal = Math.min(worstNormal, boardAcceleration({ p, v: { x: 0, y: 0 }, tilt: state.tilt, tiltRate: state.tiltRate, tiltAccel: dw }).normal);
    trace.push([state.tilt.x, state.tilt.y, state.tiltRate.x, state.tiltRate.y]);
  }
  return { trace, worstRim, worstNormal, worstTilt };
}
let seed = 12345; const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
let servoWorstRim = 0, servoWorstNormal = Infinity, servoWorstTilt = 0;
for (let run = 0; run < 2000; run++) {
  const inputs = Array.from({ length: 8 }, () => {
    const a = random() * 2 * Math.PI, m = random() < .5 ? 1 : random() < .2 ? 0 : random();
    return { x: Math.cos(a) * m, y: Math.sin(a) * m };
  }), ticks = 1 + Math.floor(random() * 40);
  const first = servoRun(inputs, ticks);
  if (run < 20) assert.deepEqual(servoRun(inputs, ticks), first, 'Servo is deterministic');
  assert(first.worstRim <= 1 + 1e-9, `|dw| R <= 0.9 g cos(max): ${first.worstRim}`);
  assert(first.worstNormal >= 0, `Resting ball never lifts: ${first.worstNormal}`);
  assert(first.worstTilt <= MAX_TILT + 1e-12, 'Tilt bounded');
  servoWorstRim = Math.max(servoWorstRim, first.worstRim); servoWorstNormal = Math.min(servoWorstNormal, first.worstNormal);
  servoWorstTilt = Math.max(servoWorstTilt, first.worstTilt);
}
for (const input of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 }, { x: -.3, y: .4 }]) {
  s = createState(g);
  for (let i = 0; i < 1 / DT; i++) {
    step(g, s, input); valid(s);
    const [x, y, z, w] = s.orientation;
    const matrixDown = { x: -(2 * (x * z - y * w)), y: -(2 * (y * z + x * w)) };
    const force = projectedGravity(s.orientation);
    assert(Math.abs(force.x - matrixDown.x) < 1e-12);
    assert(Math.abs(force.y + matrixDown.y) < 1e-12);
    assert(Math.abs(Math.hypot(force.x, force.y) - Math.sin(Math.hypot(s.tilt.x, s.tilt.y))) < 1e-12, 'Orientation follows the tilt state');
  }
  const force = projectedGravity(s.orientation);
  assert(Math.hypot(force.x - input.x * .5, force.y - input.y * .5) < 1e-9, 'Servo settles on the same physical target');
  assert.deepEqual(s.tiltRate, { x: 0, y: 0 }, 'Servo comes to rest, no chatter');
  if (Math.abs(Math.hypot(input.x, input.y) - 1) < 1e-12) assert(Math.abs(Math.hypot(s.tilt.x, s.tilt.y) - MAX_TILT) < 1e-9);
  hold(s, level, 1); assert(Math.hypot(...Object.values(projectedGravity(s.orientation))) < 1e-12 && s.tilt.x === 0 && s.tilt.y === 0);
}
// Level board rotating at constant rate: a resting ball is thrown outward, (5/7) w^2 d, from the axis.
for (const [w, d] of [[1, 10], [3, 100], [6.4, 371]]) {
  const rest = { x: 0, y: 0 }, spin = { x: w * Math.SQRT1_2, y: w * Math.SQRT1_2 };
  const out = boardAcceleration({ p: { x: d * Math.SQRT1_2, y: d * Math.SQRT1_2 }, v: rest, tilt: rest, tiltRate: spin, tiltAccel: rest });
  assert(Math.abs(Math.hypot(out.ax, out.ay) - (5 / 7) * w * w * d) < 1e-9 && out.ax > 0 && out.ay > 0, 'Centrifugal (5/7) w^2 d, outward');
  const onAxis = boardAcceleration({ p: { x: d * Math.SQRT1_2, y: -d * Math.SQRT1_2 }, v: rest, tilt: rest, tiltRate: spin, tiltAccel: rest });
  assert(Math.hypot(onAxis.ax, onAxis.ay) < 1e-9, 'Nothing on the rotation axis');
  assert(Math.abs(boardAcceleration({ p: rest, v: rest, tilt: rest, tiltRate: spin, tiltAccel: rest }).ax) < 1e-12);
}
// Euler term: angular acceleration pushes a resting ball with factor 1 (not 5/7) against the board's motion.
{ const z = { x: 0, y: 0 }, a = boardAcceleration({ p: z, v: z, tilt: z, tiltRate: z, tiltAccel: { x: 20, y: 0 } });
  assert(Math.abs(a.ax + 20 * g.radius) < 1e-9 && a.ay === 0); }
// Step response of the servo (also recorded in the evidence folder).
const response = (from, to) => {
  const state = createState(g), aim = a => ({ x: Math.sin(a) / Math.sin(MAX_TILT), y: 0 });
  for (let i = 0; i < 2000; i++) { step(g, state, aim(from)); state.x = g.spawn.x; state.y = g.spawn.y; state.vx = state.vy = 0; }
  let t90 = null, settle = null, peak = 0, overshoot = 0;
  for (let i = 1; i <= 2000; i++) {
    step(g, state, aim(to)); state.x = g.spawn.x; state.y = g.spawn.y; state.vx = state.vy = 0;
    const frac = (state.tilt.x - from) / (to - from);
    if (t90 === null && frac >= .9) t90 = i * DT;
    settle = Math.abs(frac - 1) < .01 ? settle ?? i * DT : null;
    peak = Math.max(peak, Math.abs(state.tiltRate.x)); overshoot = Math.max(overshoot, (frac - 1) * (to - from));
  }
  return { fromDegrees: from * 180 / Math.PI, toDegrees: to * 180 / Math.PI, secondsTo90Percent: t90, secondsToSettle1Percent: settle,
    peakRateDegreesPerSecond: peak * 180 / Math.PI, overshootDegrees: overshoot * 180 / Math.PI };
};
const rad = d => d * Math.PI / 180, responses = [response(0, MAX_TILT), response(0, rad(5)), response(-MAX_TILT, MAX_TILT)];
for (const r of responses) assert(r.secondsToSettle1Percent < .5 && r.overshootDegrees < .1, JSON.stringify(r));
function framed(hz) {
  const state = createState(g); state.vx = -1200; let accumulator = 0, ticks = 0;
  for (let frame = 0; frame < hz * 2; frame++) {
    accumulator += 1 / hz;
    while (accumulator >= DT - 1e-12) {
      step(g, state, ticks < 240 ? { x: .6, y: .8 } : { x: -1, y: 0 });
      accumulator -= DT; ticks++;
    }
  }
  assert.equal(ticks, 480); valid(state); return state;
}
assert.deepEqual(framed(30), framed(60), 'High-speed fixed steps independent of 30/60Hz grouping');
assert.deepEqual(framed(60), framed(144), 'High-speed fixed steps independent of 144Hz grouping');

// Recorded from route feedback through production physics, never positions or
// forced wins. Quarter-second low-angle holds exercise fine pointer control;
// this deterministic regression does not establish human timing tolerance.
// The replay is regenerated by test/record-replay.mjs.
const replay = JSON.parse(readFileSync(new URL('./maze-replay.json', import.meta.url), 'utf8'));
function play() {
  const state = createState(g); let ticks = 0, minimumClearance = Infinity;
  for (const [steps, x, y] of replay) {
    assert(Number.isInteger(steps) && steps >= 30 && steps <= 240);
    assert(Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) <= 1);
    for (let i = 0; i < steps; i++) {
      step(g, state, { x, y }); valid(state); ticks++;
      minimumClearance = Math.min(minimumClearance, clearance(g, state));
      if (state.won) return { state, ticks, minimumClearance };
    }
  }
  assert.fail('Recorded fine-control physics replay failed');
}
const first = play(), second = play(); assert.deepEqual(first, second, 'Fixed-input replay deterministic');
assert(first.state.x >= 431 && first.state.x <= 440 && first.state.y >= 423 && first.state.y <= 440);
const frozen = structuredClone(first.state); step(g, first.state, { x: 1, y: 0 }); assert.deepEqual(first.state, frozen);
console.log(JSON.stringify({ accelerations, rollingResistance: ROLLING_RESISTANCE, maxTiltAccelRadPerS2: MAX_TILT_ACCEL,
  servo: { sequences: 2000, worstRimLiftFraction: servoWorstRim, worstRestingNormalMps2: servoWorstNormal,
    worstTiltRadians: servoWorstTilt, responses },
  budgetMilliseconds, highSpeedMilliseconds, contours: g.contours.map(c => c.length), radius: g.radius,
  flatteningError: FLATNESS, spawnClearance: clearance(g, g.spawn), goalClearance: clearance(g, g.goal),
  reachableCells: count, routeNodes, routeClearance, replayClearance: first.minimumClearance,
  solveSeconds: first.ticks * DT, tiltHolds: replay.length,
  minimumHoldSeconds: Math.min(...replay.map(r => r[0])) * DT,
  maximumHoldSeconds: Math.max(...replay.map(r => r[0])) * DT,
  wonAt: { x: first.state.x, y: first.state.y }, testSeconds: (performance.now() - start) / 1000 }, null, 2));
