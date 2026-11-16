import { perfectScore, validateQuotes } from '../../puzzle/game.mjs';
import quotes from '../../puzzle/quotes.json' with { type: 'json' };

// ponytail: casual-game anti-cheat only (shape/range checks + 1 post/min/IP hash); anyone can still forge a legal score. Add signed run tokens if it matters.
const levels = validateQuotes(quotes).levels;
const NAME = /^[A-Za-z0-9 _-]{1,16}$/, MAX_BODY = 2048, WINDOW_MS = 60_000;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const fail = (error, status = 400) => json({ ok: false, error }, status);
const top = async db => (await db.prepare('SELECT name, total, maze_ms AS mazeMs, created_at AS createdAt FROM scores ORDER BY total DESC, maze_ms IS NULL, maze_ms ASC, id ASC LIMIT 20').all()).results;

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
  const mazeMs = body.mazeMs ?? null;
  if (mazeMs !== null && !(Number.isInteger(mazeMs) && mazeMs >= 10_000 && mazeMs <= 7_200_000)) return fail('invalid mazeMs');

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + env.SCORE_SALT)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const last = await env.DB.prepare('SELECT created_at FROM scores WHERE ip_hash = ? ORDER BY created_at DESC LIMIT 1').bind(hash).first();
  if (last && now - last.created_at < WINDOW_MS) return fail('slow down: one submission per minute', 429);
  await env.DB.prepare('INSERT INTO scores (name, total, maze_ms, levels, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(name, total, mazeMs, JSON.stringify(sent), hash, now).run();
  // Rows ahead of the new one (itself included): higher total, or same total with an earlier-or-equal maze time (older id wins ties; null sorts last).
  const { c } = await env.DB.prepare('SELECT COUNT(*) AS c FROM scores WHERE total > ?1 OR (total = ?1 AND (?2 IS NULL OR (maze_ms IS NOT NULL AND maze_ms <= ?2)))').bind(total, mazeMs).first();
  return json({ ok: true, rank: c, top: await top(env.DB) });
}
