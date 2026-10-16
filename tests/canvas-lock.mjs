// - run: npx esbuild src/extension/canvasLock.ts --bundle --format=esm --platform=node --outfile=tests/.build/canvasLock.mjs && node --test tests/canvas-lock.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { withCanvasLock, lockPathFor, CanvasLockTimeout, CanvasLockLost, inspectLock, breakStale } from './.build/canvasLock.mjs';

const BUILD = new URL('./.build/canvasLock.mjs', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skena-lock-'));
const canvasIn = (d) => { const p = path.join(d, 't.canvas'); fs.writeFileSync(p, '{"nodes":[],"edges":[]}'); return p; };
const holderFile = (lock, h) => fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now(), by: 'test', token: 'other', ...h }));
const age = (file, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(file, t, t); };
const deadPid = async () => { const gone = spawn(process.execPath, ['-e', '']); await new Promise(r => gone.on('exit', r)); return gone.pid; };

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

test('a lock not refreshed for longer than the stale age is broken even when its process lives', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  holderFile(lock);
  age(lock, 5000);
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

test('a canvas that does not exist yet has the lock it will have once created', async () => {
  const d = dir();
  const p = path.join(d, 'new.canvas');
  const before = await lockPathFor(p);
  fs.writeFileSync(p, '{"nodes":[],"edges":[]}');
  assert.equal(await lockPathFor(p), before);
});

test('the lock is not in the canvas folder but in a folder only this user can use', async () => {
  const p = canvasIn(dir());
  const lockFolder = path.dirname(await lockPathFor(p));
  assert.notEqual(lockFolder, path.dirname(fs.realpathSync(p)));
  const st = fs.lstatSync(lockFolder);
  assert.ok(st.isDirectory());
  assert.equal(st.uid, process.getuid());
  assert.equal(st.mode & 0o077, 0);
});

test('canvases of the same name in different folders have different locks', async () => {
  assert.notEqual(await lockPathFor(canvasIn(dir())), await lockPathFor(canvasIn(dir())));
});

test('a process whose TMPDIR and XDG_RUNTIME_DIR name other folders finds the same lock', async () => {
  const p = canvasIn(dir());
  const other = dir();
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { lockPathFor } from ${JSON.stringify(BUILD)}; console.log(await lockPathFor(${JSON.stringify(p)}));`],
    { env: { ...process.env, TMPDIR: other, XDG_RUNTIME_DIR: other } });
  let out = '';
  child.stdout.on('data', c => { out += c; });
  await new Promise(r => child.on('exit', r));
  assert.equal(out.trim(), await lockPathFor(p));
});

test('a lock refreshed lately is not stale, however long ago it was taken', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  holderFile(lock, { at: Date.now() - 60000 });
  await assert.rejects(withCanvasLock(p, 'test', async () => {}, { waitMs: 300, staleMs: 1000 }), CanvasLockTimeout);
});

test('a holder slower than the stale age keeps its lock: its heartbeat keeps the file fresh', async () => {
  const p = canvasIn(dir());
  const opts = { waitMs: 3000, staleMs: 200, heartbeatMs: 40 };
  let inside = 0, most = 0;
  const enter = async (ms) => { inside++; most = Math.max(most, inside); await sleep(ms); inside--; };
  const slow = withCanvasLock(p, 'slow', () => enter(700), opts);
  await sleep(50);
  await withCanvasLock(p, 'next', () => enter(1), opts);
  await slow;
  assert.equal(most, 1);
});

test('a breaker that looked at a stale lock leaves alone the fresh lock that replaced it', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  holderFile(lock, { pid: await deadPid(), token: 'dead' });
  const seen = await inspectLock(lock);
  let release;
  const held = new Promise(r => { release = r; });
  let entered;
  const inA = new Promise(r => { entered = r; });
  const A = withCanvasLock(p, 'A', async () => { entered(); await held; });
  await inA;
  const aLock = fs.readFileSync(lock, 'utf-8');
  const aCtime = fs.statSync(lock).ctimeMs;
  await sleep(20);
  await breakStale(lock, seen, 'late-breaker');
  assert.equal(fs.readFileSync(lock, 'utf-8'), aLock);
  // - not even moved aside and back: for that moment another writer could have taken the free path
  assert.equal(fs.statSync(lock).ctimeMs, aCtime);
  release();
  await A;
});

test('many writers on a lock that keeps being left stale: one inside at a time', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  const dead = await deadPid();
  let inside = 0, most = 0, stop = false;
  const chaos = (async () => { while (!stop) { try { fs.writeFileSync(lock, JSON.stringify({ pid: dead, host: os.hostname(), at: Date.now(), by: 'dead', token: 'd' }), { flag: 'wx' }); } catch { /* - held */ } await sleep(1); } })();
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let i = 0; i < 15; i++) {
      await withCanvasLock(p, 'w', async () => { inside++; most = Math.max(most, inside); await sleep(Math.random() * 3); inside--; }, { waitMs: 5000 });
    }
  }));
  stop = true; await chaos;
  assert.equal(most, 1);
});

test('a holder whose lock was taken away is told so before it writes', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  await withCanvasLock(p, 'test', async held => {
    await held();   // - still ours
    holderFile(lock, { token: 'someone-else' });
    await assert.rejects(held(), CanvasLockLost);
  });
});

test('a break file a crashed breaker left behind is cleared', async () => {
  const p = canvasIn(dir());
  const lock = await lockPathFor(p);
  holderFile(lock, { pid: await deadPid(), token: 'dead' });
  fs.writeFileSync(`${lock}.break`, '');
  age(`${lock}.break`, 10000);
  let ran = false;
  await withCanvasLock(p, 'test', async () => { ran = true; }, { waitMs: 3000 });
  assert.ok(ran);
  assert.equal(fs.existsSync(`${lock}.break`), false);
});
