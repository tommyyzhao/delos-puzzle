#!/bin/sh
# Builds the static site (maze + quote puzzle) for Cloudflare Pages. Pass a fresh output directory; never overwrite a live preview.
set -eu
cd "$(dirname "$0")"
out=${1:-dist}
if [ -e "$out" ] || [ -L "$out" ]; then printf 'build: output already exists; choose a fresh directory\n' >&2; exit 1; fi
mkdir -p "$out/quotes"
cp ../style.css "$out/"
cp ../puzzle/app.js ../puzzle/bootstrap.js ../puzzle/maze-view.js ../puzzle/maze-renderer.mjs ../puzzle/maze-geometry.mjs ../puzzle/maze.mjs ../puzzle/maze.svg ../puzzle/game.mjs ../puzzle/quotes.json "$out/quotes/"
mkdir -p "$out/quotes/vendor/three"
cp ../puzzle/vendor/three/three.module.js ../puzzle/vendor/three/three.core.js ../puzzle/vendor/three/LICENSE ../puzzle/vendor/three/README.md "$out/quotes/vendor/three/"
cp ../puzzle/index.html "$out/quotes/"
printf '/ /quotes/ 302\n' > "$out/_redirects"
