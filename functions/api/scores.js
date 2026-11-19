import { perfectScore, validateQuotes } from '../../puzzle/game.mjs';
import quotes from '../../puzzle/quotes.json' with { type: 'json' };

// ponytail: casual-game anti-cheat only (shape/range checks + 1 post/min/IP hash); anyone can still forge a legal score. Add signed run tokens if it matters.
const levels = validateQuotes(quotes).levels;
const NAME = /^[A-Za-z0-9 _-]{1,16}$/, MAX_BODY = 2048, WINDOW_MS = 60_000;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const fail = (error, status = 400) => json({ ok: false, error }, status);
// Order: total desc, then earliest submission. Legacy maze_ms is neither read nor written.
const top = async db => (await db.prepare('SELECT name, total, created_at AS createdAt FROM scores ORDER BY total DESC, created_at ASC, id ASC LIMIT 20').all()).results;

export async function onRequestGet({ env }) { return json({ top: await top(env.DB) }); }

export async function onRequestPost({ request, env }) {
  if (!env.SCORE_SALT) return fail('server not configured', 500);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) return fail('body too large', 413);
  let body; try { body = JSON.parse(text); } catch { return fail('invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid body');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!NAME.test(name)) return fail('name must be 1-16 letters, digits, space, _ or -');
  const sent = body.levels;
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return fail('invalid levels');
  const ids = Object.keys(sent);
  if (ids.length !== levels.length) return fail('levels must match the current campaign');
  let total = 0;
  for (const level of levels) {
    const score = Object.hasOwn(sent, level.id) ? sent[level.id] : undefined;
    if (!Number.isInteger(score) || score < 0 || score > perfectScore(level)) return fail(`invalid score for ${level.id}`);
    total += score;
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + env.SCORE_SALT)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const last = await env.DB.prepare('SELECT created_at FROM scores WHERE ip_hash = ? ORDER BY created_at DESC LIMIT 1').bind(hash).first();
  if (last && now - last.created_at < WINDOW_MS) return fail('slow down: one submission per minute', 429);
  await env.DB.prepare('INSERT INTO scores (name, total, levels, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(name, total, JSON.stringify(sent), hash, now).run();
  // Rank counts rows with the same or higher total (itself included). The new row is newest, so ties rank behind it.
  const { c } = await env.DB.prepare('SELECT COUNT(*) AS c FROM scores WHERE total >= ?').bind(total).first();
  return json({ ok: true, rank: c, top: await top(env.DB) });
}
