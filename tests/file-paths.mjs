// - run: npx esbuild src/extension/filePaths.ts --bundle --platform=node --format=esm --outfile=tests/.build/filePaths.mjs && node --test tests/file-paths.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WATCH_IGNORED, vaultRoot, vaultUriFor } from './.build/filePaths.mjs';

test('the vault watcher skips dot entries and whole node_modules, __pycache__ and dist folders', () => {
  for (const p of [
    '/home/u/vault/.git/HEAD',
    '/home/u/vault/.obsidian',
    '/home/u/vault/node_modules/x/index.js',
    '/home/u/vault/pkg/__pycache__/m.cpython-311.pyc',
    '/home/u/vault/web/dist',
    '/home/u/vault/web/dist/app.js',
    'C:\\vault\\web\\dist\\app.js',
  ]) assert.ok(WATCH_IGNORED.test(p), p);
});

test('the vault watcher keeps a file whose name only contains dist, node_modules or __pycache__', () => {
  for (const p of [
    '/home/quant0/projects/crtx/diary/2026-08-29-vwap-distance-filter-for-saty-setup.md',
    '/home/u/vault/distributions/normal.md',
    '/home/u/vault/notes/redistribute.md',
    '/home/u/vault/notes/about-node_modules.md',
    '/home/u/vault/my__pycache__notes.md',
    '/home/u/vault/knowledge/residual-books-algorithm-2026-10-09.md',
  ]) assert.ok(!WATCH_IGNORED.test(p), p);
});

const HOME = '/home/quant0';
const M4 = '/home/quant0/projects/crtx/knowledge/residual-books-algorithm-2026-10-09.md';

test('a configured vault path is expanded from ~ and loses a trailing slash', () => {
  assert.equal(vaultRoot('~/projects/crtx/', HOME), '/home/quant0/projects/crtx');
  assert.equal(vaultRoot('~/projects/crtx', HOME), '/home/quant0/projects/crtx');
  assert.equal(vaultRoot('/data/vault//', HOME), '/data/vault');
  assert.equal(vaultRoot('~', HOME), HOME);
});

test('a file in a vault configured with a trailing slash maps to its vault uri', () => {
  const roots = [['crtx', vaultRoot('~/projects/crtx/', HOME)]];
  assert.equal(vaultUriFor(roots, M4), 'vault://crtx/knowledge/residual-books-algorithm-2026-10-09.md');
  // - a root passed as configured, slash and all, gives the same answer
  assert.equal(vaultUriFor([['crtx', '/home/quant0/projects/crtx/']], M4), 'vault://crtx/knowledge/residual-books-algorithm-2026-10-09.md');
});

test('the vault with the longest matching root wins, whatever the order', () => {
  const parent = ['projects', '/home/quant0/projects'];
  const child  = ['crtx', '/home/quant0/projects/crtx'];
  assert.equal(vaultUriFor([parent, child], M4), 'vault://crtx/knowledge/residual-books-algorithm-2026-10-09.md');
  assert.equal(vaultUriFor([child, parent], M4), 'vault://crtx/knowledge/residual-books-algorithm-2026-10-09.md');
  assert.equal(vaultUriFor([parent, child], '/home/quant0/projects/factors/a.md'), 'vault://projects/factors/a.md');
});

test('a file outside every vault, or in a folder that only starts like one, has no vault uri', () => {
  const roots = [['crtx', '/home/quant0/projects/crtx']];
  assert.equal(vaultUriFor(roots, '/home/quant0/projects/crtx2/a.md'), null);
  assert.equal(vaultUriFor(roots, '/home/quant0/projects/factors/a.md'), null);
  assert.equal(vaultUriFor(roots, '/home/quant0/projects/crtx'), null);
});
