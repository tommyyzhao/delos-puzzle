# Delos puzzle

Play: https://delos.sloprefinery.ai

A Westworld-inspired word puzzle. Twelve famous quotations, each one next word at a time, where you pick the word a language model would predict. Hamlet's "To be, or not to be" comes first. A wrong guess costs "software stability". Finish all 12 and post your score to a global leaderboard.

The tilt maze is a separate project: https://maze.tz.mt (repo `tommyyzhao/delos-maze`).

The candidate words and their probabilities are baked offline from an open model (see `bake` in `puzzle/quotes.json`; `train/bake_quotes.py` reproduces it on Apple silicon with `mlx-lm`). The page itself runs no model. Plain HTML, CSS and ES modules; no build step and no runtime dependencies.

## Play locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000/puzzle/
```

The leaderboard needs the API below; without it the end screen shows your local bests and "leaderboard offline".

## Test

```sh
for f in test/*.mjs; do node "$f" || exit 1; done
```

Needs Node 22+. No browser or network.

## Leaderboard (Cloudflare Pages Functions + D1)

`functions/api/scores.js` serves `GET /api/scores` (top 20) and `POST /api/scores`. Anti-cheat is deliberately basic: shape and range checks against `puzzle/quotes.json`, server-computed total, and one post per minute per salted IP hash. Anyone determined can still forge a legal score.

Local dev:

```sh
echo 'SCORE_SALT=dev-salt' > .dev.vars
npx wrangler d1 execute delos-puzzle --local --file schema.sql
sh deploy/build.sh   # writes deploy/dist
npx wrangler pages dev
```

Deploy:

1. `npx wrangler d1 create delos-puzzle`, then put the printed `database_id` in `wrangler.toml`.
2. `npx wrangler d1 execute delos-puzzle --remote --file schema.sql`
3. `rm -rf deploy/dist && sh deploy/build.sh` (it refuses an existing output directory).
4. `npx wrangler pages project create delos-puzzle --production-branch main`, then `npx wrangler pages deploy`.
5. In the Pages project settings add a secret `SCORE_SALT` (any long random string) and make sure the `DB` D1 binding is set for production.

The site is served at `/quotes/`; `/` redirects there.

## Credits

Quotations belong to their authors and are used as short excerpts.
