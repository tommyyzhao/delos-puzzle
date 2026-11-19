#!/bin/sh
# Builds the static site (quote puzzle) for Cloudflare Pages. Pass a fresh output directory; never overwrite a live preview.
set -eu
cd "$(dirname "$0")"
out=${1:-dist}
if [ -e "$out" ] || [ -L "$out" ]; then printf 'build: output already exists; choose a fresh directory\n' >&2; exit 1; fi
mkdir -p "$out/quotes"
cp ../style.css "$out/"
cp ../puzzle/app.js ../puzzle/game.mjs ../puzzle/quotes.json "$out/quotes/"
cp ../puzzle/index.html "$out/quotes/"
printf '/ /quotes/ 302\n' > "$out/_redirects"
