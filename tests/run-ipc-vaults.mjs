// - run: npx esbuild src/extension/run-ipc.ts --bundle --platform=node --format=esm --outfile=tests/.build/runIpc.mjs && node --test tests/run-ipc-vaults.mjs
import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIpc } from './.build/runIpc.mjs';

// - the endpoint files go to a temp dir of this test, not the real one (nor XDG_RUNTIME_DIR)
process.env.TMPDIR = mkdtempSync(join(tmpdir(), 'skena-relay-vaults-'));
delete process.env.XDG_RUNTIME_DIR;
process.env.HOME = '/home/u';

// - what the extension's getVaults() returns right now; the tests change it between requests
let configured = [];
let port, token;
before(async () => {
  runIpc.start(() => undefined);
  runIpc.setVaultsHandler(async () => configured);
  for (let i = 0; i < 100 && !runIpc.endpointEnv(); i++) await new Promise(r => setTimeout(r, 10));
  [port, token] = runIpc.endpointEnv().split(':');
});
after(() => runIpc.dispose());

const ask = (tok, method = 'POST') => fetch(`http://127.0.0.1:${port}/vaults`, { method, headers: { 'x-skena-token': tok }, ...(method === 'POST' ? { body: '{}' } : {}) });

test('1. POST /vaults with the token answers the extension\'s vault list, ~ expanded and the trailing slash dropped', async () => {
  configured = [{ name: 'crtx', path: '~/projects/crtx/' }, { name: 'data', path: '/data/vault//', directories: ['notes'] }];
  const res = await ask(token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { vaults: [{ name: 'crtx', path: '/home/u/projects/crtx' }, { name: 'data', path: '/data/vault', directories: ['notes'] }] });
});

test('2. each request reads the setting as it is then', async () => {
  configured = [{ name: 'a', path: '/a' }];
  assert.deepEqual(await (await ask(token)).json(), { vaults: [{ name: 'a', path: '/a' }] });
  configured = [];
  assert.deepEqual(await (await ask(token)).json(), { vaults: [] });
});

test('3. an entry without a string name or path is left out', async () => {
  configured = [{ name: 'ok', path: '/ok' }, { name: 'nopath' }, { path: '/noname' }, null];
  assert.deepEqual(await (await ask(token)).json(), { vaults: [{ name: 'ok', path: '/ok' }] });
});

test('4. a request without the token, or not a POST, is refused', async () => {
  assert.equal((await ask('wrong')).status, 403);
  assert.equal((await ask(token, 'GET')).status, 403);
});
