// - run: npx esbuild src/extension/run-ipc.ts --bundle --platform=node --format=esm --outfile=tests/.build/runIpc.mjs && npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/run-ipc-export.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIpc } from './.build/runIpc.mjs';
import { readEndpoint } from './.build/ipcEndpoint.mjs';

// - the endpoint files go to a temp dir of this test, not the real one (nor XDG_RUNTIME_DIR)
const TMP = mkdtempSync(join(tmpdir(), 'skena-relay-'));
process.env.TMPDIR = TMP;
delete process.env.XDG_RUNTIME_DIR;

const calls = [];
runIpc.start(() => undefined);
runIpc.setExportHandler(async (canvasPath, outPath) => {
  calls.push([canvasPath, outPath]);
  return { ok: true, outPath: outPath ?? '/w/a.html', bytes: 10, nodes: 2, edges: 1, missing: [] };
});
runIpc.advertise(['/work/ws']);
for (let i = 0; i < 100 && !runIpc.endpointEnv(); i++) await new Promise(r => setTimeout(r, 10));
const endpoint = runIpc.endpointEnv();
const [port, token] = endpoint.split(':');
const post = (tok, body) => fetch(`http://127.0.0.1:${port}/export`, { method: 'POST', headers: { 'x-skena-token': tok }, body: JSON.stringify(body) });

test('1. POST /export with the token runs the export handler and answers with its reply', async () => {
  const res = await post(token, { canvasPath: '/w/a.canvas' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, outPath: '/w/a.html', bytes: 10, nodes: 2, edges: 1, missing: [] });
  assert.deepEqual(calls, [['/w/a.canvas', undefined]]);
});

test('2. a request without the token is refused', async () => {
  assert.equal((await post('wrong', { canvasPath: '/w/a.canvas' })).status, 403);
});

test('3. the workspace folder\'s endpoint file names this relay; dispose removes it', () => {
  assert.equal(readEndpoint('/work/ws', TMP), endpoint);
  runIpc.dispose();
  assert.equal(readEndpoint('/work/ws', TMP), null);
});
