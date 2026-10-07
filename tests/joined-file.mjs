// - run: npx esbuild src/extension/definition/joinedFile.ts --bundle --platform=node --format=esm --outfile=tests/.build/joinedFile.mjs && node --test tests/joined-file.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
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

// - one writer as another window would be: writes texts some of which the other writer writes too, and
//   reads each file back at once; reports the throws and any file read back with another text
const WRITER = `
const { workerData, parentPort } = require('node:worker_threads');
const { readFileSync } = require('node:fs');
import(workerData.mod).then(({ writeJoinedFile }) => {
  const out = { throws: [], wrong: 0, gone: 0 };
  for (let i = 0; i < workerData.n; i++) {
    const text = 'x = ' + (i % 9) + (i % 2 ? '' : ' # ' + workerData.id) + '\\n'.repeat(2000);
    try {
      const f = writeJoinedFile('/p/a.canvas', text, workerData.tmp);
      try { if (readFileSync(f, 'utf8') !== text) out.wrong++; } catch { out.gone++; }
    } catch (e) { out.throws.push(String(e.code ?? e.message)); }
  }
  parentPort.postMessage(out);
});
`;

test('3. two windows writing one canvas at once: no write throws, no file is read back with a part of its text', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skena-joined-'));
  const mod = new URL('./.build/joinedFile.mjs', import.meta.url).href;
  const run = id => new Promise((resolve, reject) => {
    const w = new Worker(WRITER, { eval: true, workerData: { mod, tmp, id, n: 400 } });
    w.once('message', resolve);
    w.once('error', reject);
  });
  const [a, b] = await Promise.all([run('a'), run('b')]);
  assert.deepEqual([...a.throws, ...b.throws], []);
  assert.equal(a.wrong + b.wrong, 0);
  assert.ok(readdirSync(dirname(writeJoinedFile('/p/a.canvas', 'last\n', tmp))).every(f => f.endsWith('.py')));
});
