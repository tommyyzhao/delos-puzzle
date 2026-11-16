import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'delos-build-check-')), out = join(scratch, 'site');
const modules = ['index.html', 'app.js', 'bootstrap.js', 'maze-view.js', 'maze-renderer.mjs', 'maze-geometry.mjs', 'maze.mjs', 'maze.svg', 'game.mjs', 'quotes.json'];
const vendor = ['three.module.js', 'three.core.js', 'LICENSE', 'README.md'];
const run = () => spawnSync('sh', [join(root, 'deploy/build.sh'), out], { cwd: root, encoding: 'utf8' });
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)).map(path => `${entry.name}/${path}`) : [entry.name]);
try {
  const built = run(); assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(files(out).sort(), ['_redirects', 'style.css', ...modules.map(name => `quotes/${name}`), ...vendor.map(name => `quotes/vendor/three/${name}`)].sort());
  for (const name of [...modules, ...vendor.map(name => `vendor/three/${name}`)]) {
    assert.deepEqual(readFileSync(join(out, 'quotes', name)), readFileSync(join(root, 'puzzle', name)));
  }
  assert.deepEqual(readFileSync(join(out, 'style.css')), readFileSync(join(root, 'style.css')));
  assert.deepEqual(readFileSync(join(out, 'quotes/index.html')), readFileSync(join(root, 'puzzle/index.html')));
  assert(readFileSync(join(out, 'quotes/index.html'), 'utf8').includes('./bootstrap.js'));
  assert.equal(readFileSync(join(out, '_redirects'), 'utf8'), '/ /quotes/ 302\n');
  writeFileSync(join(out, 'preserve.txt'), 'live preview');
  const refused = run(); assert.notEqual(refused.status, 0); assert(refused.stderr.includes('output already exists'));
  assert.equal(readFileSync(join(out, 'preserve.txt'), 'utf8'), 'live preview');
  console.log('PASS deploy: exact local asset allowlist, source bytes, routes, existing-output protection');
} finally { rmSync(scratch, { recursive: true }); }
