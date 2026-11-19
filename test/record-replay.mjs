// Regenerates test/maze-replay.json. A feedback controller sees only the ball state and drives
// the production physics solely through step(g, s, input): no position writes, no forced wins.
// usage: node test/record-replay.mjs [out.json]   (prints stats; writes only when a path is given,
// so the plain test loop never rewrites test/maze-replay.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseMaze, createState, step, clearance, DT, GRAVITY, MM_PER_UNIT, MAX_TILT } from '../puzzle/maze.mjs';
const g = parseMaze(readFileSync(new URL('../puzzle/maze.svg', import.meta.url), 'utf8'));
const HOLD = Number(process.env.HOLD || 30), LOOK = Number(process.env.LOOK || 22), VMAX = Number(process.env.VMAX || 160);
const TAU = Number(process.env.TAU || 0.16), MARGIN = Number(process.env.MARGIN || 4), BRAKE = Number(process.env.BRAKE || 1);
const spacing = 2, W = 440, H = 404, N = W * H;
const at = i => ({ x: i % W * spacing, y: Math.floor(i / W) * spacing });
const clr = new Float32Array(N).fill(NaN), cl = i => (Number.isNaN(clr[i]) ? (clr[i] = clearance(g, at(i))) : clr[i]);
// Dijkstra over the grid: stay clear of walls (cost grows as clearance shrinks toward radius+margin).
const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
const from = Math.round(g.spawn.y / spacing) * W + Math.round(g.spawn.x / spacing), to = Math.round(g.goal.y / spacing) * W + Math.round(g.goal.x / spacing);
const heap = [[0, from]]; dist[from] = 0;
const push = e => { heap.push(e); let i = heap.length - 1; while (i && heap[(i - 1) >> 1][0] > heap[i][0]) { [heap[i], heap[(i - 1) >> 1]] = [heap[(i - 1) >> 1], heap[i]]; i = (i - 1) >> 1; } };
const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; for (const c of [2 * i + 1, 2 * i + 2]) if (c < heap.length && heap[c][0] < heap[m][0]) m = c; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
while (heap.length) {
  const [d, i] = pop(); if (d > dist[i]) continue; if (i === to) break;
  for (const j of [i - 1, i + 1, i - W, i + W]) {
    if (j < 0 || j >= N || Math.abs(j % W - i % W) > 1) continue;
    const c = cl(j); if (c < g.radius + 1.5) continue;
    const nd = d + 1 + 12 * Math.max(0, g.radius + MARGIN - c); if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push([nd, j]); }
  }
}
const path = []; for (let i = to; i !== -1; i = prev[i]) path.push(at(i)); path.reverse();
if (path[0].x !== at(from).x) throw new Error('no route');
const A_MAX = (5 / 7) * GRAVITY / (MM_PER_UNIT / 1000) * Math.sin(MAX_TILT);
const arc = [0]; for (let i = 1; i < path.length; i++) arc.push(arc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
const along = p => { let best = 0, bd = Infinity; for (let i = 0; i < path.length; i++) { const d = Math.hypot(p.x - path[i].x, p.y - path[i].y); if (d < bd) { bd = d; best = i; } } return best; };
const pointAt = s => { let i = 0; while (i < path.length - 1 && arc[i] < s) i++; return path[i]; };
const round = v => Math.round(v * 1e6) / 1e6;
export function record(maxSeconds = 120) {
  const s = createState(g), holds = []; let ticks = 0, minimumClearance = Infinity, progress = 0;
  while (!s.won && ticks * DT < maxSeconds) {
    progress = Math.max(progress, along(s));
    const target = pointAt(arc[progress] + LOOK), dx = target.x - s.x, dy = target.y - s.y, dist2 = Math.hypot(dx, dy) || 1;
    // slow down for upcoming turns: speed limit from the turn angle between now and the look-ahead
    const far = pointAt(arc[progress] + 3 * LOOK), turn = Math.abs(Math.atan2(far.y - s.y, far.x - s.x) - Math.atan2(dy, dx));
    const speed = Math.min(VMAX, Math.hypot(dist2, 0) * 6) * (1 - 0.6 * Math.min(1, Math.min(turn, 2 * Math.PI - turn) / 1.2));
    let ax = (dx / dist2 * speed - s.vx) / TAU, ay = (dy / dist2 * speed - s.vy) / TAU;
    ax *= BRAKE; ay *= BRAKE;
    let ix = ax / A_MAX, iy = ay / A_MAX; const m = Math.hypot(ix, iy); if (m > 1) { ix /= m; iy /= m; }
    const x = round(ix), y = round(iy); holds.push([HOLD, x, y]);
    for (let i = 0; i < HOLD && !s.won; i++) {
      step(g, s, { x, y }); ticks++;
      if (s.error) throw new Error(s.error);
      minimumClearance = Math.min(minimumClearance, clearance(g, s));
    }
  }
  return { holds, won: s.won, ticks, seconds: ticks * DT, minimumClearance, state: { x: s.x, y: s.y } };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = record();
  console.log(JSON.stringify({ won: result.won, seconds: result.seconds, minimumClearance: result.minimumClearance, holds: result.holds.length, at: result.state }));
  if (!result.won) process.exit(1);
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result.holds));
}
