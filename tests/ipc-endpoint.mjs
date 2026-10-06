// - run: npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/ipc-endpoint.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { endpointFile, readEndpoint, removeEndpoint, writeEndpoint } from './.build/ipcEndpoint.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'skena-ipc-'));

test('1. what one side writes for a folder the other reads back; the file is owner-only', () => {
  writeEndpoint('/work/a', '4321:tok', TMP);
  assert.equal(readEndpoint('/work/a', TMP), '4321:tok');
  assert.equal(readEndpoint('/work/a/', TMP), '4321:tok');
  assert.equal(statSync(endpointFile('/work/a', TMP)).mode & 0o777, 0o600);
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
