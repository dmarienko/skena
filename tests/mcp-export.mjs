// - run: npm run build && npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/mcp-export.mjs
// - the MCP tool canvas_export_html against a fake relay; scratch files under the OS temp dir only
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { writeEndpoint } from './.build/ipcEndpoint.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), 'skena-mcp-export-'));
const WS = join(TMP, 'ws');
mkdirSync(join(WS, '.vscode'), { recursive: true });
const CANVAS = join(WS, 'a.canvas');
writeFileSync(CANVAS, JSON.stringify({ nodes: [], edges: [] }));

// - a relay that answers /export the way run-ipc.ts does, and records what it was asked
const seen = [];
const relay = createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, token: req.headers['x-skena-token'], body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, outPath: join(WS, 'a.html'), bytes: 2_500_000, nodes: 3, edges: 2, missing: ['W1 crtx://x/img.png: HTTP 404'] }));
  });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
const PORT = relay.address().port;
after(() => relay.close());

// - one MCP call in a fresh server process
function call(env, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(REPO, 'dist/mcp-server.js')], { cwd: WS, env: { PATH: process.env.PATH, TMPDIR: TMP, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
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
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'canvas_export_html', arguments: args } }) + '\n');
  });
}

test('1. without a running extension the tool says how to get one', async () => {
  const text = await call({}, { canvasPath: CANVAS });
  assert.match(text, /^Error: no running skena extension found for this workspace/);
});

test('2. with SKENA_RUN_IPC it asks that relay and reports what it wrote', async () => {
  const text = await call({ SKENA_RUN_IPC: `${PORT}:tok-env` }, { canvasPath: CANVAS, outPath: join(TMP, 'out.html') });
  assert.equal(text, `Exported 3 nodes and 2 edges to ${join(WS, 'a.html')} (2.5 MB).\n1 images could not be read and show their address instead:\nW1 crtx://x/img.png: HTTP 404`);
  assert.deepEqual(seen.at(-1), { url: '/export', token: 'tok-env', body: { canvasPath: CANVAS, outPath: join(TMP, 'out.html') } });
});

test('3. started from .mcp.json it finds the relay through the endpoint file of the canvas\'s workspace', async () => {
  writeEndpoint(WS, `${PORT}:tok-file`, TMP);
  await call({}, { canvasPath: CANVAS });
  assert.deepEqual(seen.at(-1), { url: '/export', token: 'tok-file', body: { canvasPath: CANVAS } });
});

test('4. a path that is not a .canvas file is refused before anything is asked', async () => {
  const before = seen.length;
  assert.match(await call({ SKENA_RUN_IPC: `${PORT}:t` }, { canvasPath: join(WS, 'a.md') }), /^Error: not a \.canvas file/);
  assert.equal(seen.length, before);
});
