// - run: npx esbuild src/extension/jupyter/config.ts --bundle --format=esm --outfile=tests/.build/jupyter-config.mjs && node --test tests/jupyter-config.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pickKernelServers, pickCanvasKernelServers, unknownServerText } from './.build/jupyter-config.mjs';

const hub = name => ({ name, hubUrl: `http://127.0.0.1:1/${name}`, token: 'secret' });
const LOCAL  = '/ws/.vscode/settings.local.json';
const SHARED = '/ws/.vscode/settings.json';

test('pickKernelServers: the AI companion list wins over the settings files and the environment', () => {
  const out = pickKernelServers(JSON.stringify([hub('h')]), [{ file: LOCAL, json: { 'skena.jupyter.kernels': [hub('l')] } }], { JUPYTER_SERVER_URL: 'u', JUPYTER_API_TOKEN: 't' });
  assert.deepEqual(out.servers.map(s => s.name), ['h']);
  assert.equal(out.from, 'SKENA_JUPYTER_KERNELS');
});

test('pickKernelServers: an empty or unreadable companion list falls through to the files, local before shared', () => {
  const files = [
    { file: LOCAL,  json: { 'skena.jupyter.kernels': [hub('l')] } },
    { file: SHARED, json: { 'skena.jupyter.kernels': [hub('s')] } },
  ];
  for (const harness of ['[]', 'not json']) {
    const out = pickKernelServers(harness, files, {});
    assert.deepEqual(out.servers.map(s => s.name), ['l']);
    assert.equal(out.from, LOCAL);
  }
});

test('pickKernelServers: a file with no list, an empty list or a read problem is passed over', () => {
  const out = pickKernelServers(undefined, [
    { file: LOCAL, json: { 'skena.jupyter.kernels': [] } },
    { file: SHARED, problem: 'missing' },
    { file: '/cwd/.vscode/settings.json', json: { 'skena.jupyter.kernels': [hub('c')] } },
  ], {});
  assert.deepEqual(out.servers.map(s => s.name), ['c']);
  assert.deepEqual(out.looked, ['SKENA_JUPYTER_KERNELS (not set)', `${LOCAL} (no skena.jupyter.kernels)`, `${SHARED} (missing)`]);
});

test('pickKernelServers: JUPYTER_SERVER_URL + JUPYTER_API_TOKEN make one server named default, after the files', () => {
  const out = pickKernelServers(undefined, [{ file: SHARED, json: {} }], { JUPYTER_SERVER_URL: 'http://h/user/q', JUPYTER_API_TOKEN: 'tok' });
  assert.deepEqual(out.servers, [{ name: 'default', hubUrl: 'http://h/user/q', token: 'tok' }]);
  assert.equal(out.from, 'JUPYTER_SERVER_URL + JUPYTER_API_TOKEN');
});

test('pickKernelServers with nothing found lists every place it looked, and unknownServerText says so without a token', () => {
  const out = pickKernelServers(undefined, [{ file: LOCAL, problem: 'missing' }, { file: SHARED, json: { 'skena.vaults': [] } }], { JUPYTER_SERVER_URL: 'http://h' });
  assert.deepEqual(out.servers, []);
  assert.equal(out.from, null);
  assert.equal(unknownServerText('hub', out),
    `error: unknown server hub — no Jupyter servers configured; looked in: SKENA_JUPYTER_KERNELS (not set); ${LOCAL} (missing); ${SHARED} (no skena.jupyter.kernels); JUPYTER_API_TOKEN (not set)`);

  const found = pickKernelServers(undefined, [{ file: SHARED, json: { 'skena.jupyter.kernels': [hub('a'), hub('b')] } }], {});
  const text = unknownServerText('hub', found);
  assert.equal(text, `error: unknown server hub — known: a, b (from ${SHARED})`);
  assert.equal(text.includes('secret'), false);
});

const ENV = { JUPYTER_SERVER_URL: 'http://e/user/q', JUPYTER_API_TOKEN: 'etok' };
const NEAR = '/ws/notes/.vscode/settings.local.json';

test('pickCanvasKernelServers: settings.local.json first, the one near the canvas before the workspace one, then VS Code settings, then the environment', () => {
  const near = { file: NEAR, json: { 'skena.jupyter.kernels': [hub('n')] } };
  const local = { file: LOCAL, json: { 'skena.jupyter.kernels': [hub('l')] } };
  const noNear = { file: NEAR, problem: 'missing' };
  const noLocal = { file: LOCAL, problem: 'missing' };

  // - the MCP server's order: a list in settings.local.json wins over the one VS Code reads
  const nearWins = pickCanvasKernelServers([hub('v')], [near, local], ENV);
  assert.deepEqual(nearWins.servers.map(s => s.name), ['n']);
  assert.equal(nearWins.from, NEAR);

  const localNext = pickCanvasKernelServers([hub('v')], [noNear, local], ENV);
  assert.deepEqual(localNext.servers.map(s => s.name), ['l']);
  assert.equal(localNext.from, LOCAL);

  const vscodeNext = pickCanvasKernelServers([hub('v')], [noNear, noLocal], ENV);
  assert.deepEqual(vscodeNext.servers.map(s => s.name), ['v']);
  assert.equal(vscodeNext.from, 'VS Code settings');

  // - [] is the setting's default: an empty list does not hide the environment
  const envLast = pickCanvasKernelServers([], [noLocal], ENV);
  assert.deepEqual(envLast.servers, [{ name: 'default', hubUrl: 'http://e/user/q', token: 'etok' }]);
  assert.equal(envLast.from, 'JUPYTER_SERVER_URL + JUPYTER_API_TOKEN');
});

test('pickCanvasKernelServers with nothing found lists only the places it looked, in order, without SKENA_JUPYTER_KERNELS', () => {
  const out = pickCanvasKernelServers([], [{ file: NEAR, problem: 'missing' }, { file: LOCAL, json: {} }], { JUPYTER_SERVER_URL: 'http://h' });
  assert.deepEqual(out.servers, []);
  assert.deepEqual(out.looked, [
    `${NEAR} (missing)`,
    `${LOCAL} (no skena.jupyter.kernels)`,
    'VS Code settings (no skena.jupyter.kernels)',
    'JUPYTER_API_TOKEN (not set)',
  ]);
});
