import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// MAZE_VIEW=/abs/path/maze-view.js runs the same assertions against another copy (e.g. the pre-fix file).
const viewUrl = process.env.MAZE_VIEW ? pathToFileURL(process.env.MAZE_VIEW).href : new URL('../puzzle/maze-view.js', import.meta.url).href;
const { createMazeView } = await import(viewUrl);
const svg = readFileSync(new URL('../puzzle/maze.svg', import.meta.url), 'utf8');
const node = () => ({ hidden: false, textContent: '', listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, removeEventListener() {}, setAttribute(k, v) { this[k] = v; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }), fire(type) { for (const fn of this.listeners[type] || []) fn({ preventDefault() {} }); } });
const nodes = new Map(['canvas', 'goal-label', 'status', 'retry', 'pause', 'reset', 'left', 'right', 'up', 'down', 'level', 'direction', 'zoom'].map(id => [`maze-${id}`, node()]));
globalThis.document = Object.assign(node(), { hidden: false, getElementById: id => nodes.get(id) });
globalThis.window = node();
globalThis.matchMedia = () => ({ matches: false, ...node() });
let frame = null, renders = 0;
globalThis.requestAnimationFrame = fn => (frame = fn, 1);
globalThis.cancelAnimationFrame = () => { frame = null; };
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => svg });
const makeRenderer = async () => ({ render() { renders++; }, reset() {}, dispose() {}, direction: (x, y) => ({ x, y }), project: () => ({ x: 0, y: 0 }) });
const status = () => nodes.get('maze-status').textContent;
const view = createMazeView({ makeRenderer, onWin() { throw Error('unexpected win'); } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(status(), 'Goal: the marked torso pocket.');
nodes.get('maze-right').fire('click'); // hold a tilt so physics steps run
let time = 1000;
for (let i = 0; i < 120; i++) {
  assert(frame, 'frame loop still running');
  frame(time); time += 1000 / 60;
  assert(!/unavailable/.test(status()), status());
}
assert(renders > 1);
view.dispose();
console.log('PASS maze view: loads, runs ticks under tilt, status never unavailable');
