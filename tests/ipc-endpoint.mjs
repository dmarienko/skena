// - run: npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/ipc-endpoint.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { endpointFile, readEndpoint, removeEndpoint, userTempDir, writeEndpoint } from './.build/ipcEndpoint.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'skena-ipc-'));
const USER_DIR = join(TMP, `skena-${userInfo().username}`);

test('1. what one side writes for a folder the other reads back; the file is owner-only, in a folder of this user only', () => {
  writeEndpoint('/work/a', '4321:tok', TMP);
  assert.equal(readEndpoint('/work/a', TMP), '4321:tok');
  assert.equal(readEndpoint('/work/a/', TMP), '4321:tok');
  assert.equal(dirname(endpointFile('/work/a', TMP)), USER_DIR);
  assert.equal(statSync(endpointFile('/work/a', TMP)).mode & 0o777, 0o600);
  assert.equal(statSync(USER_DIR).mode & 0o777, 0o700);
});

test('2. another folder, or no file, reads as none', () => {
  assert.equal(readEndpoint('/work/b', TMP), null);
});

test('3. removing leaves a file another window wrote since', () => {
  writeEndpoint('/work/c', '1:old', TMP);
  writeEndpoint('/work/c', '2:new', TMP);
  removeEndpoint('/work/c', '1:old', TMP);
  assert.equal(readEndpoint('/work/c', TMP), '2:new');
  removeEndpoint('/work/c', '2:new', TMP);
  assert.equal(readEndpoint('/work/c', TMP), null);
});

test('4. a file or a folder of another user is not used', () => {
  writeEndpoint('/work/d', '3:mine', TMP);
  const uid = process.getuid;
  process.getuid = () => uid() + 1;
  try {
    assert.equal(readEndpoint('/work/d', TMP), null);
    assert.throws(() => writeEndpoint('/work/d', '4:theirs', TMP), /only this user/);
  } finally {
    process.getuid = uid;
  }
  assert.equal(readEndpoint('/work/d', TMP), '3:mine');
});

test('5. a folder of this user that others can open is closed to them before a file goes in', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skena-ipc-open-'));
  const dir = join(tmp, `skena-${userInfo().username}`);
  mkdirSync(dir, { mode: 0o755 });
  chmodSync(dir, 0o755);
  writeEndpoint('/work/e', '5:tok', tmp);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('6. with XDG_RUNTIME_DIR set the file goes there; a file in the temp folder is still found', () => {
  const xdg = mkdtempSync(join(tmpdir(), 'skena-xdg-'));
  const tmp = mkdtempSync(join(tmpdir(), 'skena-tmp-'));
  const saved = { xdg: process.env.XDG_RUNTIME_DIR, tmp: process.env.TMPDIR };
  try {
    process.env.TMPDIR = tmp;
    delete process.env.XDG_RUNTIME_DIR;
    writeEndpoint('/work/f', '6:tmp');
    process.env.XDG_RUNTIME_DIR = xdg;
    assert.equal(dirname(endpointFile('/work/f')), join(xdg, 'skena'));
    assert.equal(readEndpoint('/work/f'), '6:tmp');
    writeEndpoint('/work/f', '7:xdg');
    assert.equal(readEndpoint('/work/f'), '7:xdg');
    assert.equal(statSync(join(xdg, 'skena')).mode & 0o777, 0o700);
  } finally {
    if (saved.xdg === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = saved.xdg;
    if (saved.tmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved.tmp;
  }
});

test('7. XDG_RUNTIME_DIR set to a folder that does not exist: the per-user folder in the temp folder is used', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skena-tmp-'));
  const saved = { xdg: process.env.XDG_RUNTIME_DIR, tmp: process.env.TMPDIR };
  try {
    process.env.TMPDIR = tmp;
    process.env.XDG_RUNTIME_DIR = join(tmp, 'no-such-dir');
    assert.equal(userTempDir(), join(tmp, `skena-${userInfo().username}`));
    writeEndpoint('/work/g', '8:tmp');
    assert.equal(readEndpoint('/work/g'), '8:tmp');
  } finally {
    if (saved.xdg === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = saved.xdg;
    if (saved.tmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved.tmp;
  }
});
