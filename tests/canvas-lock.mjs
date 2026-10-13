// - run: npx esbuild src/extension/canvasLock.ts --bundle --format=esm --platform=node --outfile=tests/.build/canvasLock.mjs && node --test tests/canvas-lock.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { withCanvasLock, lockPathFor, CanvasLockTimeout } from './.build/canvasLock.mjs';

const BUILD = new URL('./.build/canvasLock.mjs', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skena-lock-'));
const canvasIn = (d) => { const p = path.join(d, 't.canvas'); fs.writeFileSync(p, '{"nodes":[],"edges":[]}'); return p; };
const holderFile = (lock, h) => fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now(), by: 'test', token: 'other', ...h }));

test('holders of one canvas never overlap, within a process', async () => {
  const p = canvasIn(dir());
  let inside = 0, most = 0;
  await Promise.all(Array.from({ length: 12 }, () => withCanvasLock(p, 'test', async () => {
    inside++; most = Math.max(most, inside);
    await sleep(5);
    inside--;
  })));
  assert.equal(most, 1);
});

test('a holder in another process makes this one wait, and the lock is free after', async () => {
  const p = canvasIn(dir());
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { withCanvasLock } from ${JSON.stringify(BUILD)};
     await withCanvasLock(${JSON.stringify(p)}, 'child', async () => { console.log('held'); await new Promise(r => setTimeout(r, 400)); });`]);
  await new Promise(r => child.stdout.once('data', r));
  const t = Date.now();
  await withCanvasLock(p, 'test', async () => {});
  assert.ok(Date.now() - t >= 250, `waited ${Date.now() - t} ms`);
  assert.equal(fs.existsSync(await lockPathFor(p)), false);
});

test('the lock file is removed when the holder throws', async () => {
  const p = canvasIn(dir());
  await assert.rejects(withCanvasLock(p, 'test', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(await lockPathFor(p)), false);
});

test('a lock left by a process that is gone, on this host, is broken at once', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  const gone = spawn(process.execPath, ['-e', '']);
  await new Promise(r => gone.on('exit', r));
  holderFile(lock, { pid: gone.pid });
  const t = Date.now();
  let ran = false;
  await withCanvasLock(p, 'test', async () => { ran = true; }, { waitMs: 2000, staleMs: 60000 });
  assert.ok(ran);
  assert.ok(Date.now() - t < 500);
});

test('a lock older than the stale age is broken even when its process lives', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  holderFile(lock, { at: Date.now() - 5000 });
  let ran = false;
  await withCanvasLock(p, 'test', async () => { ran = true; }, { waitMs: 2000, staleMs: 1000 });
  assert.ok(ran);
});

test('a live lock held past the wait: the work is not done and the error names the holder', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  holderFile(lock, { by: 'mcp' });
  let ran = false;
  await assert.rejects(
    withCanvasLock(p, 'test', async () => { ran = true; }, { waitMs: 200, staleMs: 60000 }),
    e => e instanceof CanvasLockTimeout && /mcp/.test(e.message) && new RegExp(String(process.pid)).test(e.message),
  );
  assert.equal(ran, false);
  assert.ok(fs.existsSync(lock));   // - not ours to remove
});

test('a holder whose lock was broken and taken over does not remove the new holder\'s lock', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  await withCanvasLock(p, 'test', async () => { holderFile(lock, { token: 'someone-else' }); });
  assert.ok(fs.existsSync(lock));
  assert.match(fs.readFileSync(lock, 'utf-8'), /someone-else/);
});

test('a canvas reached through a symlinked folder has the same lock as by its real path', async () => {
  const d = dir();
  const p = canvasIn(d);
  const link = path.join(os.tmpdir(), `skena-lock-link-${process.pid}`);
  fs.rmSync(link, { force: true });
  fs.symlinkSync(d, link);
  try {
    assert.equal(await lockPathFor(path.join(link, 't.canvas')), await lockPathFor(p));
  } finally { fs.rmSync(link, { force: true }); }
});

test('a canvas that does not exist yet still has a lock path next to it', async () => {
  const d = dir();
  assert.equal(await lockPathFor(path.join(d, 'new.canvas')), path.join(fs.realpathSync(d), 'new.canvas.lock'));
});
