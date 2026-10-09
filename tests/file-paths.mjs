// - run: npx esbuild src/extension/filePaths.ts --bundle --platform=node --format=esm --outfile=tests/.build/filePaths.mjs && node --test tests/file-paths.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WATCH_IGNORED } from './.build/filePaths.mjs';

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
