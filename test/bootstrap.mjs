import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../puzzle/bootstrap.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace('export function bootstrap', 'function bootstrap').replace(/bootstrap\(\);\s*$/, '');
function scenario(saved, denied = false) {
  const nodes = new Map();
  for (const id of ['maze', 'maze-dialogue', 'puzzle-play', 'puzzle-stability-box', 'puzzle-mute', 'puzzle-skip', 'maze-canvas', 'maze-left', 'maze-right', 'maze-continue', 'maze-replay', 'puzzle-theme']) nodes.set(id, { hidden: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, removeEventListener(type) { delete this.listeners[type]; }, focus() { this.focused = true; }, fire() { this.listeners.click(); } });
  let win, disposed = 0, starts = 0, quoteDisposals = 0, writes = 0;
  const document = { listeners: {}, getElementById: id => nodes.get(id), documentElement: { dataset: {} }, addEventListener(type, fn) { this.listeners[type] = fn; }, removeEventListener(type) { delete this.listeners[type]; }, fire(type, key, target) { const event = { key, target, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; this.listeners[type](event); return event; } };
  const localStorage = { getItem() { if (denied) throw Error('denied'); return saved; }, setItem() { if (denied) throw Error('denied'); writes++; } };
  const makeMaze = options => { win = options.onWin; return { dispose() { disposed++; } }; };
  const makeQuotes = () => { starts++; return { dispose() { quoteDisposals++; } }; };
  const events = {}; const bootstrap = runInNewContext(`${source}\nbootstrap`, { document, localStorage, createMazeView: makeMaze, createController: makeQuotes, addEventListener(type, fn) { events[type] = fn; }, removeEventListener(type) { delete events[type]; } }); const owner = bootstrap();
  return { nodes, document, owner, events, currentWin: () => win, win: () => win(), get starts() { return starts; }, get disposed() { return disposed; }, get quoteDisposals() { return quoteDisposals; }, get writes() { return writes; } };
}
for (const denied of [false, true]) {
  const t = scenario(null, denied); assert.equal(t.starts, 0); assert(t.nodes.get('puzzle-play').hidden);
  t.win(); assert.equal(t.starts, 0); assert(t.nodes.get('maze-continue').focused); assert.equal(t.writes, denied ? 0 : 1);
  const stale = t.currentWin(); t.nodes.get('maze-continue').fire(); t.nodes.get('maze-continue').fire(); assert.equal(t.starts, 1); assert.equal(t.disposed, 1);
  t.nodes.get('maze-replay').fire(); stale(); assert.equal(t.quoteDisposals, 1); assert(t.nodes.get('puzzle-play').hidden); assert(t.nodes.get('maze-dialogue').hidden);
  t.events.pagehide({ persisted: true }); assert.equal(t.disposed, 1); const last = t.currentWin(); t.events.pagehide({ persisted: false }); last(); assert.equal(t.disposed, 2); assert(t.nodes.get('maze-dialogue').hidden);
}
for (const key of [' ', 'Enter']) {
  const t = scenario(null); t.document.fire('keydown', key, t.nodes.get('maze-left')); t.win();
  const repeat = t.document.fire('keydown', key, t.nodes.get('maze-continue')); assert(repeat.prevented && repeat.stopped); assert.equal(t.starts, 0);
  const release = t.document.fire('keyup', key, t.nodes.get('maze-continue')); assert(release.prevented && release.stopped); assert.equal(t.starts, 0);
  const fresh = t.document.fire('keydown', key === ' ' ? 'Enter' : key, t.nodes.get('maze-continue')); assert(!fresh.prevented); t.nodes.get('maze-continue').listeners.click({ detail: 0, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} }); assert.equal(t.starts, 1);
}
{ const t = scenario(null); t.currentWin()({ ms: 61000 }); assert.equal(t.writes, 2, 'completion flag + maze time'); const slow = scenario(null); slow.currentWin()({}); assert.equal(slow.writes, 1, 'no time, no time write'); }
const saved = scenario('won'); assert.equal(saved.starts, 1);
const corrupt = scenario('true'); assert.equal(corrupt.starts, 0);
console.log('PASS maze gate: persistence, denial, dialogue, replay, corrupted flag');

const adapterSource = readFileSync(new URL('../puzzle/maze-view.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace('export function createMazeView', 'function createMazeView').replace("new URL('./maze.svg', import.meta.url)", "'maze.svg'");
const mazePhysics = await import('../puzzle/maze.mjs');
const mazeAsset = readFileSync(new URL('../puzzle/maze.svg', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function adapter(frameMs) {
  class Node { constructor() { this.handlers = {}; this.clientWidth = 300; } addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); } removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(x => x !== fn); } fire(type, extra = {}) { const event = { type, preventDefault() { this.prevented = true; }, ...extra }; for (const fn of this.handlers[type] || []) fn(event); return event; } getBoundingClientRect() { return { width: 300, height: 300, left: 0, top: 0 }; } setPointerCapture(id) { this.captured = id; } hasPointerCapture(id) { return this.captured === id; } releasePointerCapture(id) { if (this.captured === id) this.captured = null; } setAttribute(name, value) { this[name] = value; } }
  const nodes = Object.fromEntries(['canvas', 'goal-label', 'status', 'retry', 'pause', 'reset', 'left', 'right', 'up', 'down', 'level', 'direction', 'zoom'].map(id => [id, new Node()]));
  const document = new Node(); document.getElementById = id => nodes[id.replace('maze-', '')];
  const window = new Node(), media = new Node();
  let raf, time = 1, distance = 0, steps = 0, lastInput, lastState, options, disposed = 0, projections = 0, cardinalCalls = 0, broken = false, fetchFailure = false, pending;
  const geometry = mazePhysics.parseMaze(mazeAsset);
  const context = { document, window, matchMedia: () => media, fetch: async () => ({ ok: !fetchFailure, status: 503, text: async () => mazeAsset }), parseMaze: mazePhysics.parseMaze, createState: mazePhysics.createState, step: (g, state, input) => { distance += input.x / 240; lastInput = input; steps++; mazePhysics.step(g, state, input); }, DT: mazePhysics.DT, requestAnimationFrame: fn => (raf = fn, 1), cancelAnimationFrame: () => { raf = null; }, URL };
  const create = runInNewContext(`${adapterSource}\ncreateMazeView`, context);
  const makeRenderer = async config => {
    options = config; if (pending) await pending;
    if (broken) throw Error('WebGL unavailable');
    return { render(state) { lastState = state; }, direction(x, y) { cardinalCalls++; return { x, y }; }, project(x, y) { projections++; return { x: (x - 150) / 150, y: (y - 150) / 150 }; }, reset() {}, dispose() { disposed++; } };
  };
  const view = create({ makeRenderer, onWin() { throw Error('unexpected win'); } });
  await flush(); nodes.right.fire('click');
  for (let i = 0; i < Math.ceil(1200 / frameMs); i++) { const next = raf; assert(next); next(time); time += frameMs; }
  assert(steps > 0); const result = distance;
  nodes.up.fire('click'); raf(time); time += frameMs; raf(time); assert.equal(lastInput.y, -1);
  const beforeZoom = distance, beforeSteps = steps, preserved = lastState, beforeCalls = cardinalCalls;
  nodes.zoom.fire('click'); assert.equal(distance, beforeZoom); assert.equal(steps, beforeSteps); assert.equal(lastState, preserved); assert.equal(cardinalCalls, beforeCalls); assert.equal(nodes.zoom['aria-pressed'], 'true'); time += frameMs; raf(time); assert.equal(lastInput.y, -1);
  const mouse = { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 225, clientY: 150 };
  nodes.canvas.fire('pointermove', mouse); time += frameMs; raf(time); assert.equal(lastInput.x, .5); assert.equal(projections, 1);
  time += frameMs; raf(time); assert.equal(projections, 2);
  nodes.level.fire('click'); time += frameMs; raf(time); assert.equal(lastInput.x, 0); assert.equal(projections, 2);
  nodes.canvas.fire('pointermove', mouse); time += frameMs; raf(time); nodes.canvas.fire('pointerleave', mouse); time += frameMs; raf(time); assert.equal(lastInput.x, 0);
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    const touch = { pointerId: 2, pointerType: 'touch', isPrimary: true, clientX: 225, clientY: 150 };
    nodes.canvas.fire('pointerdown', touch); assert.equal(nodes.canvas.captured, 2);
    nodes.canvas.fire('pointermove', { ...touch, clientX: 240 });
    nodes.canvas.fire('pointermove', { ...touch, pointerId: 3, isPrimary: false, clientX: 0 });
    time += frameMs; raf(time); assert.equal(lastInput.x, .6);
    nodes.canvas.fire(end, touch); time += frameMs; raf(time); assert.equal(lastInput.x, 0);
  }
  nodes.canvas.fire('pointermove', mouse);
  nodes.canvas.fire('keydown', { key: 'ArrowDown' }); time += frameMs; raf(time); assert.equal(lastInput.y, 1); const calls = cardinalCalls; nodes.canvas.fire('keydown', { key: 'ArrowDown', repeat: true }); assert.equal(cardinalCalls, calls);
  nodes.canvas.fire('pointermove', mouse); time += frameMs; raf(time); assert.equal(lastInput.x, .5);
  window.fire('blur'); time += frameMs; raf(time); assert.equal(lastInput.x, 0); time += frameMs; raf(time); assert.equal(lastInput.x, 0);
  const touch = { pointerId: 2, pointerType: 'touch', isPrimary: true, clientX: 225, clientY: 150 };
  for (const action of ['level', 'keyboard', 'reset', 'blur']) {
    nodes.canvas.fire('pointerdown', touch); assert.equal(nodes.canvas.captured, 2);
    if (action === 'keyboard') nodes.canvas.fire('keydown', { key: 'ArrowDown' });
    else if (action === 'blur') window.fire('blur');
    else nodes[action].fire('click');
    assert.equal(nodes.canvas.captured, null);
    nodes.canvas.fire('lostpointercapture', touch); nodes.canvas.fire('pointermove', touch);
    time += frameMs; raf(time); time += frameMs; raf(time);
    assert.equal(lastInput.x, 0); assert.equal(lastInput.y, action === 'keyboard' ? 1 : 0);
  }
  nodes.pause.fire('click'); assert.equal(raf, null); nodes.pause.fire('click'); assert(raf);
  document.hidden = true; document.fire('visibilitychange'); assert.equal(raf, null); document.hidden = false; document.fire('visibilitychange'); assert(raf);
  window.fire('pagehide'); assert.equal(raf, null); window.fire('pageshow'); assert(raf);
  options.onContextLost(); assert.equal(raf, null); assert.match(nodes.status.textContent, /Graphics context lost/); assert.equal(nodes.retry.hidden, false);
  options.onContextRestored(); assert.equal(raf, null); nodes.retry.fire('click'); await flush(); assert(raf); assert.equal(disposed, 1);
  nodes.reset.fire('click'); assert.notEqual(lastState, preserved); assert.equal(lastState.x, geometry.spawn.x);
  broken = true; nodes.retry.fire('click'); await flush(); assert.equal(raf, null); assert.match(nodes.status.textContent, /WebGL unavailable/);
  broken = false; fetchFailure = true; nodes.retry.fire('click'); await flush(); assert.equal(raf, null); assert.match(nodes.status.textContent, /HTTP 503/);
  fetchFailure = false; let resolve; pending = new Promise(done => { resolve = done; }); nodes.retry.fire('click'); await flush();
  const count = disposed; view.dispose(); resolve(); await flush(); assert.equal(disposed, count + 1); assert.equal(raf, null);
  view.dispose(); assert.equal(disposed, count + 1);
  for (const node of [window, document, media, ...Object.values(nodes)]) for (const handlers of Object.values(node.handlers)) assert.equal(handlers.length, 0);
  return result;
}
const fast = await adapter(1000 / 60), slow = await adapter(1000 / 30);
assert(Math.abs(fast - slow) < .04); assert(fast > .8);
console.log('PASS maze adapter: frame rates, live pointer controls, zoom state, lifecycle, context/asset failure, stale creation, cleanup (renderer mock only)');

// Real camera/raycast math, no WebGL mock. Both orientations and camera zooms.
const THREE = await import('../puzzle/vendor/three/three.module.js');
const { projectBoardInput } = await import('../puzzle/maze-renderer.mjs');
const rect = { left: 20, top: 30, width: 360, height: 360 };
const center = { x: 200, y: 210 };
for (const inclination of [-1, -.5, 0, .5, 1]) for (const bearing of [0, Math.PI / 4, Math.PI / 2]) for (const zoom of [1, 2.1]) {
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(bearing), Math.sin(bearing), 0), inclination * mazePhysics.MAX_TILT);
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 2500); camera.up.set(0, 1, 0);
  const target = new THREE.Vector3(zoom > 1 ? 130 : 0, zoom > 1 ? 50 : 0, 0).applyQuaternion(quaternion), distance = 660 / zoom;
  camera.position.copy(target).add(new THREE.Vector3(0, -Math.sin(22 * Math.PI / 180) * distance, Math.cos(22 * Math.PI / 180) * distance)); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const neutral = projectBoardInput(camera, quaternion, rect, center.x, center.y); assert.equal(neutral.x, 0); assert.equal(neutral.y, 0);
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [.6, .8]]) {
    const output = projectBoardInput(camera, quaternion, rect, center.x + x * 180, center.y + y * 180, true);
    assert(Math.abs(Math.hypot(output.x, output.y) - 1) < 1e-12);
    const localCenter = new THREE.Vector3();
    // Invert with actual center-plane ray; directions must reproject into screen activation.
    const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion), 0);
    raycaster.ray.intersectPlane(plane, localCenter);
    const origin = localCenter.clone().project(camera), end = localCenter.add(new THREE.Vector3(output.x, -output.y, 0).applyQuaternion(quaternion)).project(camera);
    const sx = end.x - origin.x, sy = -(end.y - origin.y), norm = Math.hypot(sx, sy);
    assert(Math.abs(sx / norm - x) < 1e-10); assert(Math.abs(sy / norm - y) < 1e-10);
  }
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [.6, .8]]) {
    let previous = 0;
    for (const magnitude of [.040001, .08, .2, .5, .98, 1, 1.2]) {
      const hover = projectBoardInput(camera, quaternion, rect, center.x + x * 180 * magnitude, center.y + y * 180 * magnitude);
      const strength = Math.hypot(hover.x, hover.y);
      const expected = Math.min(1, (magnitude - .04) / .96) ** 2;
      assert(Math.abs(strength - expected) < 1e-12, 'Quadratic fine control uses screen radius, independent of zoom');
      assert(strength >= previous - 1e-12 && (magnitude > 1 || strength > previous), 'Continuous ramp increases, then saturates');
      if (magnitude === .08) assert(Math.asin(strength * .5) * 180 / Math.PI < .05, 'Near-center control retains subdegree tilt');
      previous = strength;
    }
  }
  for (const radius of [0, .02, .039999]) {
    const dead = projectBoardInput(camera, quaternion, rect, center.x + radius * 180, center.y);
    assert.equal(dead.x, 0); assert.equal(dead.y, 0);
  }
  const invalid = projectBoardInput(camera, quaternion, rect, NaN, 0); assert.equal(invalid.x, 0);
}
console.log('PASS real perspective math: tilted-plane raycast, screen-direction inversion, zoom/follow, gentle magnitude, neutral, finite boundary');
