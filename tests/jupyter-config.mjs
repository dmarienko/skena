// - run: npx esbuild src/extension/jupyter/config.ts --bundle --format=esm --outfile=tests/.build/jupyter-config.mjs && node --test tests/jupyter-config.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseEnvFile, pickKernelServers, pickCanvasKernelServers, unknownServerText } from './.build/jupyter-config.mjs';

test('parseEnvFile reads KEY=VALUE, skips comments and blanks', () => {
  const env = parseEnvFile('# comment\nJUPYTER_SERVER_URL=https://h/user/q\n\nJUPYTER_API_TOKEN=tok123\n');
  assert.equal(env.JUPYTER_SERVER_URL, 'https://h/user/q');
  assert.equal(env.JUPYTER_API_TOKEN, 'tok123');
});

test('parseEnvFile strips surrounding quotes and inline whitespace', () => {
  const env = parseEnvFile('JUPYTER_API_TOKEN = "abc" \n');
  assert.equal(env.JUPYTER_API_TOKEN, 'abc');
});

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

const XLMCP = 'JUPYTER_SERVER_URL=http://x/user/q\nJUPYTER_API_TOKEN=xtok\n';
const ENV = { JUPYTER_SERVER_URL: 'http://e/user/q', JUPYTER_API_TOKEN: 'etok' };

test('pickCanvasKernelServers: VS Code settings first, then settings.local.json, then the environment, then ~/.aix/xlmcp/.env', () => {
  const local = { file: LOCAL, json: { 'skena.jupyter.kernels': [hub('l')] } };
  const noLocal = { file: LOCAL, problem: 'missing' };

  const vscodeWins = pickCanvasKernelServers([hub('v')], local, ENV, XLMCP);
  assert.deepEqual(vscodeWins.servers.map(s => s.name), ['v']);
  assert.equal(vscodeWins.from, 'VS Code settings');

  // - [] is the setting's default, so an empty list must not hide a token kept only in the local file
  const localNext = pickCanvasKernelServers([], local, ENV, XLMCP);
  assert.deepEqual(localNext.servers.map(s => s.name), ['l']);
  assert.equal(localNext.from, LOCAL);

  const envNext = pickCanvasKernelServers([], noLocal, ENV, XLMCP);
  assert.deepEqual(envNext.servers, [{ name: 'default', hubUrl: 'http://e/user/q', token: 'etok' }]);
  assert.equal(envNext.from, 'JUPYTER_SERVER_URL + JUPYTER_API_TOKEN');

  const fileLast = pickCanvasKernelServers(undefined, noLocal, {}, XLMCP);
  assert.deepEqual(fileLast.servers, [{ name: 'default', hubUrl: 'http://x/user/q', token: 'xtok' }]);
  assert.equal(fileLast.from, '~/.aix/xlmcp/.env');
});

test('pickCanvasKernelServers with nothing found lists its own sources in order, without SKENA_JUPYTER_KERNELS', () => {
  const out = pickCanvasKernelServers([], { file: LOCAL, problem: 'missing' }, { JUPYTER_SERVER_URL: 'http://h' }, null);
  assert.deepEqual(out.servers, []);
  assert.deepEqual(out.looked, [
    'VS Code settings (no skena.jupyter.kernels)',
    `${LOCAL} (missing)`,
    'JUPYTER_API_TOKEN (not set)',
    '~/.aix/xlmcp/.env (missing)',
  ]);
  const halfFile = pickCanvasKernelServers([], { file: LOCAL, json: {} }, {}, 'JUPYTER_SERVER_URL=http://x\n');
  assert.equal(halfFile.looked.at(-1), '~/.aix/xlmcp/.env (no JUPYTER_SERVER_URL + JUPYTER_API_TOKEN)');
});
