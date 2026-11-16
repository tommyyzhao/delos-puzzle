import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost } from '../functions/api/scores.js';
import { perfectScore } from '../puzzle/game.mjs';

const quotes = JSON.parse(readFileSync(new URL('../puzzle/quotes.json', import.meta.url), 'utf8'));
// In-memory fake D1: recognises just the four statements scores.js issues.
function fakeDb() {
  const rows = []; let id = 0;
  const order = (a, b) => b.total - a.total || (a.maze_ms ?? Infinity) - (b.maze_ms ?? Infinity) || a.id - b.id;
  return { rows, prepare(sql) {
    let args = [];
    const q = {
      bind(...a) { args = a; return q; },
      async all() { return { results: [...rows].sort(order).slice(0, 20).map(r => ({ name: r.name, total: r.total, mazeMs: r.maze_ms, createdAt: r.created_at })) }; },
      async first() {
        if (sql.includes('FROM scores WHERE ip_hash')) { const mine = rows.filter(r => r.ip_hash === args[0]).sort((a, b) => b.created_at - a.created_at)[0]; return mine && { created_at: mine.created_at }; }
        if (sql.includes('COUNT(*)')) { const [t, m] = args; return { c: rows.filter(r => r.total > t || (r.total === t && (m === null || (r.maze_ms !== null && r.maze_ms <= m)))).length }; }
        throw new Error(`unexpected ${sql}`);
      },
      async run() { const [name, total, maze_ms, levels, ip_hash, created_at] = args; rows.push({ id: ++id, name, total, maze_ms, levels, ip_hash, created_at }); },
    };
    return q;
  } };
}
const perfect = Object.fromEntries(quotes.levels.map(level => [level.id, perfectScore(level)]));
const post = (env, body, ip = '1.1.1.1', raw) => onRequestPost({ env, request: new Request('https://x.test/api/scores', { method: 'POST', body: raw ?? JSON.stringify(body), headers: { 'CF-Connecting-IP': ip } }) });
const fresh = () => ({ DB: fakeDb(), SCORE_SALT: 'salt' });
const total = Object.values(perfect).reduce((a, b) => a + b, 0);

let env = fresh();
let res = await post(env, { name: ' Dolores ', levels: perfect, mazeMs: 60000 }); let body = await res.json();
assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.rank, 1);
assert.deepEqual(body.top, [{ name: 'Dolores', total, mazeMs: 60000, createdAt: body.top[0].createdAt }]);
assert.equal(env.DB.rows[0].total, total, 'total computed server-side'); assert.notEqual(env.DB.rows[0].ip_hash, '1.1.1.1'); assert.equal(env.DB.rows[0].ip_hash.length, 64);
assert.deepEqual((await (await onRequestGet({ env })).json()).top.map(r => r.name), ['Dolores']);

// Rejections never write.
const bad = (label, body, status, raw) => async () => { const e = fresh(); const r = await post(e, body, '9.9.9.9', raw); assert.equal(r.status, status, label); assert.equal((await r.json()).ok, false, label); assert.equal(e.DB.rows.length, 0, label); };
const drop = id => { const l = { ...perfect }; delete l[id]; return l; };
const first = quotes.levels[0].id;
for (const run of [
  bad('not json', null, 400, '{nope'), bad('array body', null, 400, '[]'), bad('too large', null, 413, JSON.stringify({ name: 'a', levels: perfect, pad: 'x'.repeat(2100) })),
  bad('no name', { levels: perfect }, 400), bad('blank name', { name: '  ', levels: perfect }, 400), bad('long name', { name: 'a'.repeat(17), levels: perfect }, 400),
  bad('bad chars', { name: '<b>', levels: perfect }, 400), bad('name type', { name: 5, levels: perfect }, 400),
  bad('missing level', { name: 'a', levels: drop(first) }, 400), bad('extra level', { name: 'a', levels: { ...perfect, bogus: 1 } }, 400),
  bad('swapped level', { name: 'a', levels: { ...drop(first), bogus: 1 } }, 400),
  bad('over perfect', { name: 'a', levels: { ...perfect, [first]: perfect[first] + 1 } }, 400), bad('negative', { name: 'a', levels: { ...perfect, [first]: -1 } }, 400),
  bad('fractional', { name: 'a', levels: { ...perfect, [first]: 1.5 } }, 400), bad('string score', { name: 'a', levels: { ...perfect, [first]: '1' } }, 400),
  bad('levels array', { name: 'a', levels: [] }, 400),
  bad('maze too fast', { name: 'a', levels: perfect, mazeMs: 9999 }, 400), bad('maze too slow', { name: 'a', levels: perfect, mazeMs: 7200001 }, 400), bad('maze fractional', { name: 'a', levels: perfect, mazeMs: 20000.5 }, 400),
]) await run();
const lone = await post({ DB: fakeDb() }, { name: 'a', levels: perfect }); assert.equal(lone.status, 500, 'missing salt fails closed');

// Accepts: zero scores, null maze time, boundaries, hyphen/underscore/space name.
env = fresh();
for (const [i, mazeMs] of [[0, null], [1, 10000], [2, 7200000]]) assert.equal((await post(env, { name: 'a_b-c d', levels: i ? perfect : Object.fromEntries(Object.keys(perfect).map(k => [k, 0])), mazeMs }, `2.2.2.${i}`)).status, 200);

// Rate limit: same IP blocked for 60 s, other IP fine, allowed after the window.
env = fresh(); const real = Date.now; let now = 1e12; Date.now = () => now;
try {
  assert.equal((await post(env, { name: 'a', levels: perfect }, '3.3.3.3')).status, 200);
  now += 59_999; res = await post(env, { name: 'a', levels: perfect }, '3.3.3.3'); assert.equal(res.status, 429); assert.equal(env.DB.rows.length, 1);
  assert.equal((await post(env, { name: 'b', levels: perfect }, '4.4.4.4')).status, 200);
  now += 1; assert.equal((await post(env, { name: 'a', levels: perfect }, '3.3.3.3')).status, 200);
  const salted = { DB: env.DB, SCORE_SALT: 'other' }; assert.equal((await post(salted, { name: 'a', levels: perfect }, '3.3.3.3')).status, 200, 'hash depends on salt');
} finally { Date.now = real; }

// Ordering: total DESC, maze time ASC with null last, insertion order last; rank counts rows ahead.
env = fresh(); const half = Object.fromEntries(Object.keys(perfect).map(k => [k, 0]));
const submit = async (name, levels, mazeMs, n) => (await (await post(env, { name, levels, mazeMs }, `5.5.5.${n}`)).json());
await submit('low', half, 30000, 1); await submit('nulltime', perfect, null, 2); await submit('slow', perfect, 90000, 3);
const fast = await submit('fast', perfect, 40000, 4); const tie = await submit('tie', perfect, 40000, 5);
assert.deepEqual(tie.top.map(r => r.name), ['fast', 'tie', 'slow', 'nulltime', 'low']);
assert.equal(fast.rank, 1); assert.equal(tie.rank, 2);
for (let n = 0; n < 25; n++) await submit(`p${n}`, half, null, 10 + n);
assert.equal((await (await onRequestGet({ env })).json()).top.length, 20, 'top 20 only');
console.log('PASS scores: accept, validation rejects, size limit, rate limit, ordering, rank, top 20');
