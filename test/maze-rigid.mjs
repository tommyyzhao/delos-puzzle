// Independent check of boardAcceleration: full 3-D Newton-Euler solid sphere with the exact
// rolling constraint on a rigid board rotating about the pivot (Rodrigues exp map of the tilt
// path). At zero tilt the closed form must match to rounding; at finite tilt the residual is the
// neglected yaw coupling, bounded here and reported.
import assert from 'node:assert/strict';
import { boardAcceleration, GRAVITY, BALL_RADIUS, MM_PER_UNIT } from '../puzzle/maze.mjs';
const M = MM_PER_UNIT / 1000, r = BALL_RADIUS * M;
const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]), mul = (a, k) => a.map(v => v * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rot(v) { // Rodrigues, 3x3 rows
  const t = Math.hypot(...v), k = t ? v.map(x => x / t) : [0, 0, 1], c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [[c + k[0] * k[0] * C, k[0] * k[1] * C - k[2] * s, k[0] * k[2] * C + k[1] * s],
    [k[1] * k[0] * C + k[2] * s, c + k[1] * k[1] * C, k[1] * k[2] * C - k[0] * s],
    [k[2] * k[0] * C - k[1] * s, k[2] * k[1] * C + k[0] * s, c + k[2] * k[2] * C]];
}
const apply = (R, v) => R.map(row => dot(row, v)), applyT = (R, v) => [0, 1, 2].map(j => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]);
// board angular velocity (world): [w]x = Rdot R^T by central difference
function omega(path, t, h = 1e-5) {
  const A = rot(path(t + h)), B = rot(path(t - h)), R = rot(path(t));
  const Rd = A.map((row, i) => row.map((v, j) => (v - B[i][j]) / (2 * h)));
  const W = [0, 1, 2].map(i => [0, 1, 2].map(j => dot(Rd[i], [R[j][0], R[j][1], R[j][2]])));
  return [W[2][1], W[0][2], W[1][0]];
}
export function rigid({ e, w, dw, p, v }) { // SVG units in, SVG-frame {ax, ay, normal} out
  // scene tilt axis = (e_y, e_x, 0), scene Y = -SVG Y
  const sc = a => [a.y, a.x, 0], path = t => add(add(sc(e), mul(sc(w), t)), mul(sc(dw), t * t / 2));
  const R = rot(path(0)), om = omega(path, 0), al = mul(sub(omega(path, 1e-3, 1e-5), omega(path, -1e-3, 1e-5)), 1 / 2e-3);
  const n = apply(R, [0, 0, 1]), loc = [p.x * M, -p.y * M, 0], vl = [v.x * M, -v.y * M, 0];
  const pos = add(apply(R, loc), mul(n, r)), vrel = apply(R, vl), vel = add(vrel, cross(om, pos));
  const c = sub(pos, mul(n, r)), nd = cross(om, n), cd = sub(vel, mul(nd, r));
  const Om = add(om, mul(cross(n, vrel), 1 / r)); // no-slip, zero spin about the normal
  // Newton/Euler/constraint: (7/2) Ft/m + Fn/m = -(g - r Om x n' - al x c - om x c')
  const rhs = mul(sub(sub(sub([0, 0, -GRAVITY], mul(cross(Om, nd), r)), cross(al, c)), cross(om, cd)), -1);
  const Fn = dot(rhs, n), Ft = sub(rhs, mul(n, Fn)), F = add(mul(Ft, 2 / 7), mul(n, Fn)); // F/m
  const xdd = add(F, [0, 0, -GRAVITY]);
  const rel = sub(sub(sub(xdd, cross(al, pos)), mul(cross(om, vrel), 2)), cross(om, cross(om, pos)));
  const a = applyT(R, rel); return { ax: a[0] / M, ay: -a[1] / M, normal: Fn };
}
const stats = { radial: { a: 0, n: 0 }, tangential: { a: 0, n: 0 } };
let worst0 = 0, seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 * 2 - 1;
const ALPHA = 41.2, WMAX = 6.4; // servo limits (rad/s^2, rad/s), see maze.mjs
for (let k = 0; k < 600; k++) {
  const p = { x: rnd() * 350, y: rnd() * 350 }, v = { x: rnd() * 300, y: rnd() * 300 };
  const ang = rnd() * Math.PI, mag = k % 3 ? Math.abs(rnd()) * 0.5236 : 0;
  const dir = { x: Math.cos(ang), y: Math.sin(ang) }, e = { x: mag * dir.x, y: mag * dir.y };
  for (const kind of ['radial', 'tangential']) {
    // radial: tilt rate parallel to e (fixed-axis rotation, servo's case); tangential: worst-case sweep
    const along = kind === 'radial' ? dir : { x: -dir.y, y: dir.x };
    const sw = rnd() * WMAX, sa = rnd() * ALPHA, w = { x: along.x * sw, y: along.y * sw }, dw = { x: along.x * sa, y: along.y * sa };
    const exact = rigid({ e, w, dw, p, v }), f = boardAcceleration({ p, v, tilt: e, tiltRate: w, tiltAccel: dw });
    const err = Math.hypot(exact.ax - f.ax, exact.ay - f.ay) * M, nerr = Math.abs(exact.normal - f.normal); // m/s^2
    if (!mag) { worst0 = Math.max(worst0, err, nerr); assert(err < 1e-3 && nerr < 1e-3, `zero-tilt mismatch ${err} ${nerr}`); }
    else if (kind === 'radial') { stats.radial.a = Math.max(stats.radial.a, err); stats.radial.n = Math.max(stats.radial.n, nerr); }
    else { stats.tangential.a = Math.max(stats.tangential.a, err); stats.tangential.n = Math.max(stats.tangential.n, nerr); }
  }
}
assert(stats.radial.a < 5e-3 && stats.radial.n < 5e-3, 'radial tilt paths are exact at any tilt: ' + JSON.stringify(stats.radial));
console.log(JSON.stringify({ zeroTiltResidual_mps2: worst0, finiteTiltRadialResidual_mps2: stats.radial,
  finiteTiltTangentialSweepResidual_mps2: stats.tangential, gravityScale_mps2: GRAVITY }));
