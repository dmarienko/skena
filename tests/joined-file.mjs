// - run: npx esbuild src/extension/definition/joinedFile.ts --bundle --platform=node --format=esm --outfile=tests/.build/joinedFile.mjs && node --test tests/joined-file.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { KEEP, joinedFileName, writeJoinedFile } from './.build/joinedFile.mjs';

test('1. one file per canvas and text, written owner-only in an owner-only folder; the same text reuses it', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skena-joined-'));
  const a = writeJoinedFile('/p/a.canvas', 'x = 1\n', tmp);
  assert.equal(basename(a), joinedFileName('/p/a.canvas', 'x = 1\n'));
  assert.match(basename(a), /^def-[0-9a-z]+-[0-9a-f]{12}\.py$/);
  assert.equal(readFileSync(a, 'utf8'), 'x = 1\n');
  assert.equal(statSync(a).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(a)).mode & 0o777, 0o700);
  assert.equal(writeJoinedFile('/p/a.canvas', 'x = 1\n', tmp), a);
  assert.notEqual(writeJoinedFile('/p/a.canvas', 'x = 2\n', tmp), a);
  assert.notEqual(joinedFileName('/p/b.canvas', 'x = 1\n'), basename(a));
});

test('2. past KEEP files of a canvas the oldest go; another canvas keeps its own', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skena-joined-'));
  const other = writeJoinedFile('/p/b.canvas', 'b\n', tmp);
  const base = Date.now() / 1000 - 100;
  const files = [];
  for (let i = 1; i <= KEEP + 2; i++) {
    const f = writeJoinedFile('/p/a.canvas', `v${i}\n`, tmp);
    utimesSync(f, base + i, base + i);
    files.push(basename(f));
  }
  const left = readdirSync(dirname(other)).sort();
  assert.deepEqual(left, [...files.slice(2), basename(other)].sort());
});
