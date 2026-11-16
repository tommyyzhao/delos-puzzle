import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { validateQuotes, createState, reduce, choicesFor, perfectScore, rankFor, RESTART_MS, VICTORY_BEATS } from '../puzzle/game.mjs';

const ids = ['fortuna', 'cogito', 'stage', 'fear', 'liberty', 'apollo', 'socrates', 'gettysburg', 'dickens', 'jfk', 'caesar', 'violent'];
const counts = [1, 2, 1, 3, 4, 5, 4, 3, 6, 8, 8, 3];
const texts = [
  'Hija de la Fortuna', 'I think, therefore I am.', "All the world's a stage.",
  'The only thing we have to fear is fear itself.', 'Give me liberty, or give me death!',
  "That's one small step for man, one giant leap for mankind.", 'The unexamined life is not worth living.',
  '…government of the people, by the people, for the people.',
  'It was the best of times, it was the worst of times.',
  'Ask not what your country can do for you; ask what you can do for your country.',
  "Render to Caesar the things that are Caesar's, and to God the things that are God's.",
  'These violent delights have violent ends.',
];
const acts = ['I · BOOT', 'II · CALIBRATION', 'III · DEEP RECALL', 'FINALE'];
const option = (word, prob = .2, id = 20) => ({ word, prob, ids: [id], pieces: [`▁${word}`] });
const fixture = {
  version: 1, bake: { model: 'synthetic-only', revision: 'fixture', mlxLm: 'fixture', bosId: 2, vocabSize: 262144, algorithm: 'fixture', reviewed: false },
  levels: texts.map((text, index) => {
    const words = text.split(' '), completion = words.splice(-counts[index]);
    return { id: ids[index], act: acts[index < 3 ? 0 : index < 8 ? 1 : index < 11 ? 2 : 3], prefix: words.join(' '), attribution: { speaker: 'Synthetic speaker', work: 'Development fixture', year: null },
      steps: completion.map((token, n) => {
        const [, word, after] = token.match(/^([\p{L}'’]+)(.*)$/u);
        const distractors = ['maybe', 'dream', 'human', 'never', 'beyond'].filter(value => value !== word.toLowerCase());
        if (distractors.length < 5) distractors.push('always');
        return { gold: option(word, .3, 100 + n), after, exclude: [], candidates: distractors.map((word, i) => option(word, [.4, .1, .02, .019999, .00001][i], 200 + i)) };
      }) };
  }),
};
validateQuotes(fixture);
const clone = value => structuredClone(value);
const act = (state, action) => reduce(state, { revision: state.revision, ...action });
const lockWord = (state, word) => {
  state = act(state, { type: 'select', index: state.choices.findIndex(choice => choice.word === word) });
  return act(state, { type: 'lock' });
};
const gold = state => state.data.levels[state.levelIndex].steps[state.stepIndex].gold.word;
for (const [ratio, cost] of [[1, 8], [.25, 8], [.249999, 16], [.05, 16], [.049999, 28], [.000001, 28]]) {
  const data = clone(fixture); data.levels[0].steps[0].candidates[1].prob = .4 * ratio;
  const state = lockWord(createState(data), data.levels[0].steps[0].candidates[1].word);
  assert.equal(state.stability, 100 - cost); assert.equal(state.points, -10 * cost); assert.equal(state.streak, 0);
  assert.equal(state.events[0].cost, cost);
  assert(state.rejected.includes(data.levels[0].steps[0].candidates[1].word));
  assert.equal(act(state, { type: 'lock' }).revision, state.revision, 'rejected word disabled');
}
let state = createState(fixture, 9);
state = { ...state, stability: 90 };
for (let n = 0; n < 8; n++) {
  const before = state.points;
  state = lockWord(state, gold(state));
  assert.equal(state.points - before, 100 * (1 + .25 * Math.min(n, 4)));
  assert.equal(state.stability, Math.min(100, 90 + n * 2));
}
assert.equal(state.stability, 100, 'restore clamps');
state = { ...createState(fixture, 9), streak: 4 };
state = lockWord(state, fixture.levels[9].steps[0].candidates[0].word);
assert.equal(state.streak, 0);
state = lockWord(state, gold(state)); assert.equal(state.events[0].points, 100);
state = createState(fixture, 1);
const original = clone(state);
const consult = act(state, { type: 'consult' });
assert.deepEqual(state, original, 'reducer never mutates input');
assert.equal(consult.stability, 88); assert.equal(consult.points, -120); assert.equal(consult.consulted, true);
assert.equal(act(consult, { type: 'consult' }).revision, consult.revision);
state = lockWord(consult, gold(consult)); assert.equal(state.consulted, false);
state = act(state, { type: 'consult' }); assert.equal(state.consulted, true);
for (const stability of [12, 11, 1]) {
  state = act({ ...createState(fixture), stability }, { type: 'consult' });
  assert.equal(state.phase, 'shutdown'); assert.equal(state.stability, 0); assert(state.events.some(e => e.type === 'shutdown'));
  assert.equal(act(state, { type: 'lock' }).revision, state.revision);
  const restarted = act(state, { type: 'restart' });
  assert.equal(restarted.phase, 'choosing'); assert.equal(restarted.stability, 100); assert.equal(restarted.points, 0);
  assert.equal(restarted.stepIndex, 0); assert.equal(restarted.streak, 0); assert.equal(restarted.attempt, 1); assert.deepEqual(restarted.rejected, []);
}
state = lockWord({ ...createState(fixture), stability: 5 }, fixture.levels[0].steps[0].candidates[4].word);
assert.equal(state.stability, 0); assert.equal(state.phase, 'shutdown');
state = createState(fixture, 1);
const stamp = state.revision;
state = lockWord(state, gold(state));
assert.equal(reduce(state, { type: 'lock', revision: stamp }).revision, state.revision);
assert.equal(reduce(state, { type: 'consult' }).revision, state.revision);
assert.equal(act(state, { type: 'restart' }).revision, state.revision);
for (const [score, rank] of [[100, 'S'], [95, 'S'], [94.999, 'A'], [85, 'A'], [84.999, 'B'], [70, 'B'], [69.999, 'C'], [50, 'C'], [49.999, 'D'], [0, 'D']]) assert.equal(rankFor(score, 100), rank);
const low = lockWord({ ...createState(fixture), points: -10000 }, fixture.levels[0].steps[0].gold.word);
assert.equal(low.score, 0); assert.equal(low.rank, 'D');
function perfectCampaign(data) {
  data.levels.forEach((level, index) => {
    let run = createState(data, index);
    for (let n = 0; n < level.steps.length; n++) {
      const a = choicesFor(data, index, n, 0), b = choicesFor(data, index, n, 0);
      assert.deepEqual(a, b); assert.equal(a.choices.length, level.steps[n].candidates.length + 1); assert.equal(new Set(a.choices.map(c => c.word)).size, a.choices.length);
      assert.equal(a.choices.filter(c => c.word === level.steps[n].gold.word).length, 1);
      assert(a.startIndex >= 0 && a.startIndex < a.choices.length);
      run = lockWord(run, gold(run));
    }
    assert.equal(run.phase, index === data.levels.length - 1 ? 'complete' : 'won');
    assert.equal(run.score, perfectScore(level)); assert.equal(run.rank, 'S');
    assert(run.events.some(e => e.type === 'won'));
    assert.equal(run.events.some(e => e.type === 'complete'), index === data.levels.length - 1);
    assert.equal(act(run, { type: 'lock' }).revision, run.revision);
  });
}
perfectCampaign(fixture);
const largeFixture = clone(fixture); largeFixture.bake.distractors = 11;
for (const level of largeFixture.levels) for (const step of level.steps) step.candidates.push(...['silver', 'orange', 'quiet', 'river', 'bright', 'stone'].map((word, i) => option(word, 1e-7 / (i + 1), 300 + i)));
validateQuotes(largeFixture); perfectCampaign(largeFixture);
const inconsistent = clone(largeFixture); inconsistent.levels[0].steps[0].candidates.pop(); assert.throws(() => validateQuotes(inconsistent), /inconsistent/);

assert.equal(perfectScore(fixture.levels[0]), 600);
assert.equal(perfectScore(fixture.levels[9]), 1850);
assert.notDeepEqual(choicesFor(fixture, 9, 0, 0), choicesFor(fixture, 9, 0, 1));
for (const mutate of [d => d.version = 2, d => d.levels[0].steps[0].gold.prob = NaN, d => d.levels[0].steps[0].gold.prob = 0, d => d.levels[0].steps[0].gold.pieces = [], d => d.levels[0].steps[0].candidates[0].word = d.levels[0].steps[0].gold.word, d => d.levels[0].steps[0].gold.ids = [-1], d => d.levels[0].steps[0].after = ' word']) {
  const bad = clone(fixture); mutate(bad); assert.throws(() => validateQuotes(bad), /Invalid quotes/);
}

// Real bake: count-independent schema and editorial review are strict.
const realPath = new URL('../puzzle/quotes.json', import.meta.url);
if (existsSync(realPath)) {
  const real = validateQuotes(JSON.parse(readFileSync(realPath, 'utf8')));
  assert.deepEqual(real.levels.map(level => level.id), ids);
  assert.deepEqual(real.levels.map(level => level.steps.length), counts);
  assert.deepEqual(real.levels[0].attribution, { speaker: 'Isabel Allende', work: 'Hija de la Fortuna', year: '1999' });
  assert.equal(real.levels[0].steps[0].candidates.length, 11);
  assert.deepEqual(real.levels.map(level => level.prefix + level.steps.map(step => ` ${step.gold.word}${step.after}`).join('')), texts);
  for (const level of real.levels) for (const step of level.steps) {
    const choices = [step.gold, ...step.candidates];
    assert.equal(new Set(choices.map(c => c.word.toLowerCase())).size, choices.length);
    assert.equal(choices.filter(c => c.word === step.gold.word).length, 1);
    for (const c of choices) { assert(Number.isFinite(c.prob) && c.prob > 0 && c.prob <= 1); assert.equal(c.ids.length, c.pieces.length); }
  }
  assert.equal(real.bake.reviewed, true, 'real bake requires editorial review');
  perfectCampaign(real);
  console.log('PASS real quotes.json: 12 levels, exact reconstruction, perfect campaign');
} else console.log('SKIP real quotes.json: file absent; synthetic campaign checked');

// Actual controller, minimal DOM, deterministic clock; no browser dependency.
const html = readFileSync(new URL('../puzzle/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../puzzle/app.js', import.meta.url), 'utf8');
assert(!app.includes('engine.js')); assert(!app.includes('innerHTML'));
const headScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const theme of ['light', 'dark']) { const document = { documentElement: { dataset: {} } }; runInNewContext(headScript, { document, localStorage: { getItem: () => theme } }); assert.equal(document.documentElement.dataset.theme, theme); }
assert.doesNotThrow(() => runInNewContext(headScript, { localStorage: { getItem() { throw Error('denied'); } } }));
assert(html.includes('aria-live="polite"')); assert(!html.includes('puzzle-dial')); assert(!app.includes("'wheel'"));
assert.deepEqual(VICTORY_BEATS, [450, 1200, 1800, 2700, 3000, 3400, 3500]); assert.equal(RESTART_MS, 1200);
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.clientWidth = 1000; this.clientHeight = 540; this.scrollWidth = 2000; this.scrollLeft = 0;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = { values: new Set(), add(...values) { values.forEach(v => this.values.add(v)); }, remove(...values) { values.forEach(v => this.values.delete(v)); }, contains(value) { return this.values.has(value); }, toggle(value, enabled) { if (enabled) this.values.add(value); else this.values.delete(value); } };
  }
  append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  fire(type, values = {}) {
    const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const fn of this.listeners[type] || []) { fn(event); if (event.stopped) break; }
    return event;
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...((selector === '[data-context-word]' ? child.dataset.contextWord !== undefined : selector === 'a' ? child.tagName === 'A' : child.className?.split(' ').includes(selector.slice(1))) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { document.activeElement = this; }
  animate() { const animation = { cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } }; effects.push(animation); return animation; }
}
const elements = new Map([...html.matchAll(/id="(puzzle-[^"]+)"/g)].map(match => [match[1], new Element()]));
const $ = id => elements.get(`puzzle-${id}`);
const effects = [], documentDouble = new Element('document'), windowDouble = new Element('window');
Object.assign(documentDouble, { getElementById: id => elements.get(id), createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), documentElement: new Element('html'), body: new Element('body'), querySelector: () => new Element('main') });
const saved = {};
for (const key of ['document', 'ResizeObserver', 'matchMedia', 'fetch', 'localStorage', 'setTimeout', 'clearTimeout', 'addEventListener', 'removeEventListener', 'performance', 'AudioContext']) saved[key] = globalThis[key];
let now = 0, nextTimer = 1, reduced = false, failFetch = false, audioCreated = 0, resumed = 0;
let controllerFixture = largeFixture;
const scoreCalls = []; let scoreReply = init => ({ ok: true, json: async () => init ? { ok: true, rank: 3, top: [{ name: 'Dolores', total: 5, mazeMs: 61000 }, { name: '<b>x</b>', total: 4, mazeMs: null }] } : { top: [{ name: 'Teddy', total: 9, mazeMs: 90000 }] } });
const flush = () => new Promise(resolve => setImmediate(resolve));
const clock = new Map();
function advance(ms) {
  const end = now + ms;
  for (;;) {
    const due = [...clock].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    const [id, task] = due; clock.delete(id); now = task.at; task.fn();
  }
  now = end;
}
Object.assign(globalThis, {
  document: documentDouble, ResizeObserver: class { observe() {} disconnect() {} },
  matchMedia: query => ({ matches: reduced && query.includes('reduced-motion') }),
  fetch: async (url, init) => { if (String(url).includes('/api/scores')) { scoreCalls.push([String(url), init]); return scoreReply(init); } if (failFetch) throw new Error('offline'); return { ok: true, json: async () => clone(controllerFixture) }; },
  localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } },
  setTimeout: (fn, delay) => { const id = nextTimer++; clock.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => clock.delete(id),
  addEventListener: (...args) => windowDouble.addEventListener(...args), removeEventListener: (...args) => windowDouble.removeEventListener(...args), performance: { now: () => now },
  AudioContext: class { constructor() { audioCreated++; this.state = 'suspended'; } resume() { resumed++; return Promise.resolve(); } close() { return Promise.resolve(); } },
});
const source = app.replace("'./game.mjs'", JSON.stringify(new URL('../puzzle/game.mjs', import.meta.url).href));
const { createController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const controller = createController(); await controller.ready;
const columns = () => $('nodes').children.filter(node => node.dataset.step !== undefined);
const pending = () => columns().find(node => Number(node.dataset.step) === controller.state.stepIndex);
const clickGold = () => pending().chips.find(chip => chip.dataset.word === gold(controller.state)).fire('click', { detail: 1 });
assert.equal(controller.state.choices.length, largeFixture.levels[0].steps[0].candidates.length + 1);
assert.deepEqual(pending().chips.map(chip => chip.dataset.word), choicesFor(largeFixture, 0, 0, 0).choices.map(choice => choice.word));
assert.equal(pending().chips.filter(chip => chip.dataset.word === gold(controller.state)).length, 1);
let column = pending(); column.chips[0].fire('keydown', { key: 'ArrowUp' }); assert.equal(document.activeElement, column.chips[0]);
column.chips.at(-1).fire('keydown', { key: 'ArrowDown' }); assert.equal(document.activeElement, column.chips.at(-1));
column.chips[0].fire('keydown', { key: 'j' }); assert.equal(document.activeElement, column.chips[1]);
controller.start(9); column = pending();
const columnBefore = [...column.chips], chosen = column.chips.find(chip => chip.dataset.word === gold(controller.state));
chosen.fire('click', { detail: 1 }); assert.equal(controller.state.stepIndex, 1);
const at = columnBefore.indexOf(chosen); assert.deepEqual(column.children, [...columnBefore.slice(0, at), chosen, column.node, ...columnBefore.slice(at + 1)]);
assert(column.classList.contains('puzzle-history')); assert(column.chips.every(chip => chip.disabled));
assert(columns().includes(column), 'past column persists');
assert.equal(column.hidden, false, 'newest accepted column remains expanded');
assert.equal($('victory').parent, $('stage'), 'victory replaces the stage instead of appearing below it');
for (let levelIndex = 0; levelIndex < controller.state.data.levels.length; levelIndex++) {
 controller.start(levelIndex);
 while (controller.state.phase === 'choosing') {
  const level = controller.state.data.levels[levelIndex], n = controller.state.stepIndex;
  assert.deepEqual($('nodes').querySelectorAll('[data-context-word]').map(node => node.dataset.contextWord), [...level.prefix.split(/\s+/), ...level.steps.slice(0, n).map(step => step.gold.word + step.after)]);
  const compact = $('nodes').querySelectorAll('.puzzle-compact-node').find(node => node.dataset.kind === 'locked');
  if (compact) { compact.fire('click'); assert.notEqual($('inspect-word').textContent, ''); }
  clickGold();
 }
}
assert.equal(controller.state.phase, 'complete'); advance(3500);
await flush();
assert.equal(document.activeElement, $('victory-title')); assert.equal($('finale-action').hidden, false); assert.equal($('score-form').hidden, false);
assert.equal($('finale-action').querySelector('a'), null, 'no outbound link'); assert(!/https?:\/\/(?!www\.w3\.org)/.test(app), 'no hard-coded URLs');
assert.equal($('maze-time').textContent, 'MAZE TIME / —'); assert.equal($('summary').children.length, ids.length + 1);
assert.deepEqual($('board').children.map(row => row.children.map(cell => cell.textContent)), [['Teddy', '9', '1:30']]);
assert.equal(scoreCalls.at(-1)[0], '/api/scores');
// Submit: bad name stays local; valid name posts per-level scores, shows returned board via textContent.
$('name').value = 'bad!name'; $('score-form').fire('submit'); await flush(); assert.equal(scoreCalls.length, 1); assert.equal(document.activeElement, $('name'));
$('name').value = ' Dolores '; $('score-form').fire('submit'); await flush();
const post = JSON.parse(scoreCalls.at(-1)[1].body); assert.equal(scoreCalls.at(-1)[1].method, 'POST');
assert.equal(post.name, 'Dolores'); assert.deepEqual(Object.keys(post.levels), ids); assert(Object.values(post.levels).every(Number.isInteger)); assert.equal(post.mazeMs, null);
assert.equal($('score-form').hidden, true); assert.equal($('board-status').textContent, 'SUBMITTED / RANK #3'); assert.equal($('board').children[1].children[0].textContent, '<b>x</b>'); assert.equal($('board').children[1].children[2].textContent, '—');
assert.equal(document.activeElement, $('next'));
controller.start(10); assert.equal($('finale-action').hidden, true, 'end screen only after the finale');
controller.start(9); clickGold();
const wrong = pending().chips.find(chip => chip.dataset.word !== gold(controller.state)); wrong.fire('click', { detail: 1 }); assert(wrong.disabled); assert(wrong.classList.contains('puzzle-rejected'));
const stability = controller.state.stability; wrong.fire('click', { detail: 1 }); assert.equal(controller.state.stability, stability);
const stale = pending().chips[0]; controller.start(8); const revision = controller.state.revision; stale.fire('click', { detail: 1 }); assert.equal(controller.state.revision, revision);
controller.start(9); pending().consult.fire('click'); assert.equal(controller.state.consulted, true); assert(pending().chips.every(chip => chip.confidence));
while (controller.state.phase === 'choosing') {
 for (const chip of [...pending().chips]) { if (controller.state.phase !== 'choosing') break; if (chip.dataset.word !== gold(controller.state)) chip.fire('click', { detail: 1 }); }
 if (controller.state.phase === 'choosing') clickGold();
}
assert.equal(controller.state.phase, 'shutdown'); windowDouble.fire('pagehide', { persisted: true }); advance(1199); assert.equal(controller.state.phase, 'shutdown'); advance(1); assert.equal(controller.state.phase, 'choosing'); assert.equal(controller.state.stability, 100); assert.equal($('host').hidden, true);
controller.start(0); clickGold(); assert.equal(controller.state.phase, 'won'); advance(3500); assert.equal(controller.victoryRunning, false); assert.equal($('replay').hidden, false);
$('next').fire('click'); assert.equal(controller.state.levelIndex, 0); controller.dispose(); assert.equal(clock.size, 0);
for (const fixtureData of [fixture, largeFixture]) {
 controllerFixture = fixtureData; reduced = true;
 const game = createController(); await game.ready;
 const chips = $('nodes').children.find(node => node.dataset.step === '0').chips;
 assert.equal(chips.length, fixtureData.levels[0].steps[0].candidates.length + 1);
 chips.find(chip => chip.dataset.word === gold(game.state)).fire('click', { detail: 1 }); assert.equal(game.state.phase, 'won'); game.dispose();
}
globalThis.localStorage = { getItem(key) { return key === 'delos-quote-best' ? JSON.stringify({ hamlet: { score: 600, rank: 'S' } }) : null; }, setItem() {} };
const oldWin = createController(); await oldWin.ready;
assert.equal(oldWin.state.levelIndex, 0, 'saved Hamlet win does not complete Fortuna'); oldWin.dispose();
const partial = Object.fromEntries(ids.slice(1).map(id => [id, { score: 100, rank: 'S' }]));
globalThis.localStorage = { getItem(key) { return key === 'delos-quote-best' ? JSON.stringify(partial) : null; }, setItem() {} };
reduced = false; const missing = createController(); await missing.ready;
missing.start(11);
while (missing.state.phase === 'choosing') { const col = $('nodes').children.find(node => Number(node.dataset.step) === missing.state.stepIndex); col.chips.find(chip => chip.dataset.word === gold(missing.state)).fire('click', { detail: 1 }); }
advance(3500); assert.equal($('finale-action').hidden, true, 'last level cannot replace missing Fortuna');
missing.start(0); $('nodes').children.find(node => node.dataset.step === '0').chips.find(chip => chip.dataset.word === gold(missing.state)).fire('click', { detail: 1 });
const skipped = documentDouble.fire('keydown', { key: 'Enter' }); assert(skipped.defaultPrevented && skipped.stopped);
await flush(); assert.equal($('finale-action').hidden, false); assert.equal(document.activeElement, $('victory-title'));
const released = documentDouble.fire('keyup', { key: 'Enter' }); assert(released.defaultPrevented && released.stopped);
missing.dispose();
for (const kind of [' ', 'click']) {
 const game = createController(); await game.ready; game.start(0);
 $('nodes').children.find(node => node.dataset.step === '0').chips.find(chip => chip.dataset.word === gold(game.state)).fire('click', { detail: 1 });
 const event = kind === 'click' ? documentDouble.fire('click') : documentDouble.fire('keydown', { key: kind });
 assert(event.defaultPrevented && event.stopped); assert.equal(document.activeElement, $('victory-title'));
 if (kind !== 'click') { const up = documentDouble.fire('keyup', { key: kind }); assert(up.defaultPrevented && up.stopped); }
 game.dispose();
}
reduced = true; const immediate = createController(); await immediate.ready; immediate.start(0);
$('nodes').children.find(node => node.dataset.step === '0').chips.find(chip => chip.dataset.word === gold(immediate.state)).fire('click', { detail: 0 });
assert.equal($('finale-action').hidden, false); immediate.dispose();
// Offline leaderboard: local bests, no form.
scoreReply = () => { throw new Error('offline'); }; const offline = createController(); await offline.ready; offline.start(0);
$('nodes').children.find(node => node.dataset.step === '0').chips.find(chip => chip.dataset.word === gold(offline.state)).fire('click', { detail: 0 }); await flush();
assert.equal($('score-form').hidden, true); assert(/offline/i.test($('board-status').textContent)); assert.equal($('board').children.length, 12); offline.dispose();
failFetch = true; const failed = createController(); await failed.ready; assert.equal($('retry').hidden, false); assert.equal($('play').dataset.phase, 'loading'); assert($('victory').hidden && $('shutdown').hidden); failed.dispose();
for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
console.log('PASS rules: scoring, stale actions, ranks, deterministic 6/12-choice perfect campaigns');
console.log('PASS columns: seeded native chips, immediate lock, rejected disabling, stale click, linear focus, lock ordering, persistent history, consult, shutdown/restart, victory');
