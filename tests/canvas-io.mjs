// - run: npx esbuild src/extension/canvas-io.ts --bundle --format=esm --platform=node --outfile=tests/.build/canvasIo.mjs && node --test tests/canvas-io.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCanvasJson, writeCanvasJson, CanvasExists } from './.build/canvasIo.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skena-io-'));

test('a new canvas is created where none is', async () => {
  const p = path.join(dir(), 'sub.canvas');
  await createCanvasJson(p, '{"nodes":[],"edges":[]}');
  assert.equal(fs.readFileSync(p, 'utf-8'), '{"nodes":[],"edges":[]}');
});

test('creating a canvas over an existing one is refused, and the existing one is untouched', async () => {
  const d = dir();
  const p = path.join(d, 'sub.canvas');
  fs.writeFileSync(p, 'existing');
  await assert.rejects(createCanvasJson(p, 'new'), CanvasExists);
  assert.equal(fs.readFileSync(p, 'utf-8'), 'existing');
  assert.deepEqual(fs.readdirSync(d), ['sub.canvas']);
});

test('a write the lock check stops leaves the canvas and no temp file', async () => {
  const d = dir();
  const p = path.join(d, 't.canvas');
  fs.writeFileSync(p, 'old');
  await assert.rejects(writeCanvasJson(p, 'new', async () => { throw new Error('lock lost'); }), /lock lost/);
  assert.equal(fs.readFileSync(p, 'utf-8'), 'old');
  assert.deepEqual(fs.readdirSync(d), ['t.canvas']);
});
