// - run: npm run build && npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/mcp-vaults.mjs
// - vault:// file nodes read through dist/mcp-server.js; the canvas is a scratch .cvs.json under the
//   OS temp dir (no .canvas file is written), HOME is a scratch folder too
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { removeEndpoint, writeEndpoint } from './.build/ipcEndpoint.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), 'skena-mcp-vaults-'));
const HOME = join(TMP, 'home');
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

// - the factors layout: the vault is set only in the .code-workspace one folder above the workspace
//   folder, whose own .vscode/settings.json has no skena.vaults
const PROJECTS = join(TMP, 'projects');
const WS = join(PROJECTS, 'factors');
put(join(WS, '.vscode', 'settings.json'), '{ "python-envs.pythonProjects": [], }');
put(join(PROJECTS, 'factors.code-workspace'), `{
  "folders": [ { "path": "factors" } ],
  "settings": {
    // "skena.ai.model": "fable",
    "skena.vaults": [ { "name": "crtx", "path": "~/projects/crtx/", }, ],
  },
}`);
put(join(HOME, 'projects', 'crtx', 'knowledge', 'note.md'), '# Residual books\n\nfrom the workspace file\n');
put(join(TMP, 'ext-crtx', 'knowledge', 'note.md'), '# Residual books\n\nfrom the extension\n');
const CANVAS = join(WS, 'research', 'review', 'f.cvs.json');
put(CANVAS, JSON.stringify({
  nodes: [
    { id: 'm4', type: 'file', file: 'vault://crtx/knowledge/note.md', x: 0, y: 0, width: 400, height: 300, nodeLabel: 'M4' },
    { id: 'm5', type: 'file', file: 'vault://nope/x.md', x: 500, y: 0, width: 400, height: 300, nodeLabel: 'M5' },
  ],
  edges: [],
}));

// - a relay answering POST /vaults the way run-ipc.ts does
const seen = [];
const relay = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    seen.push({ url: req.url, token: req.headers['x-skena-token'] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ vaults: [{ name: 'crtx', path: join(TMP, 'ext-crtx') }] }));
  });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
const PORT = relay.address().port;
after(() => relay.close());

// - one MCP call in a fresh server process, started in the workspace folder
function call(env, name, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(REPO, 'dist/mcp-server.js')], { cwd: WS, env: { PATH: process.env.PATH, HOME, TMPDIR: TMP, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d;
      for (const line of buf.split('\n').slice(0, -1)) {
        const msg = JSON.parse(line);
        if (msg.id === 2) { proc.kill(); resolve(msg.result.content[0].text); }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    proc.on('error', reject);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
}

test('1. no extension running: canvas_read of a vault file node reads the file through the .code-workspace settings', async () => {
  const text = await call({}, 'canvas_read', { canvasPath: CANVAS, ref: 'M4' });
  assert.match(text, new RegExp(`File: ${join(HOME, 'projects', 'crtx', 'knowledge', 'note.md')}`));
  assert.match(text, /from the workspace file/);
});

test('2. an extension on SKENA_RUN_IPC: its vault list is used', async () => {
  const text = await call({ SKENA_RUN_IPC: `${PORT}:tok-env` }, 'canvas_read', { canvasPath: CANVAS, ref: 'M4' });
  assert.match(text, /from the extension/);
  assert.deepEqual(seen.at(-1), { url: '/vaults', token: 'tok-env' });
});

test('3. started from .mcp.json: the endpoint file of the canvas\'s workspace folder leads to the extension', async () => {
  writeEndpoint(WS, `${PORT}:tok-file`, TMP);
  try {
    assert.match(await call({}, 'canvas_read', { canvasPath: CANVAS, ref: 'M4' }), /from the extension/);
    assert.deepEqual(seen.at(-1), { url: '/vaults', token: 'tok-file' });
  } finally {
    removeEndpoint(WS, `${PORT}:tok-file`, TMP);
  }
});

test('4. a vault no list names: canvas_read says which vault and where it looked', async () => {
  const text = await call({}, 'canvas_read', { canvasPath: CANVAS, ref: 'M5' });
  assert.match(text, /\n\(vault not configured — no "nope" in skena\.vaults/);
  assert.match(text, new RegExp(join(WS, '.vscode', 'settings.json').replace(/[.]/g, '\\.')));
  assert.match(text, new RegExp(join(PROJECTS, 'factors.code-workspace').replace(/[.]/g, '\\.')));
});

test('5. canvas_follow resolves through the same lookup', async () => {
  assert.match(await call({}, 'canvas_follow', { canvasPath: CANVAS, ref: 'M4' }), new RegExp(`File path: ${join(HOME, 'projects', 'crtx', 'knowledge', 'note.md')}`));
});
