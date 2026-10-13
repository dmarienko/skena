// - run: npm run build && npx esbuild src/extension/canvasLock.ts --bundle --format=esm --platform=node --outfile=tests/.build/canvasLock.mjs && node --test tests/mcp-sync.mjs
// - the MCP server (dist/mcp-server.js) as one of several writers of a canvas; scratch files under /tmp only
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';
import { withCanvasLock, lockPathFor } from './.build/canvasLock.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const DIR  = mkdtempSync(join(tmpdir(), 'skena-mcp-sync-'));

let proc, call;
before(async () => {
  proc = spawn('node', [join(REPO, 'dist/mcp-server.js')], { cwd: DIR, env: { ...process.env, SKENA_RUN_IPC: '' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let buf = '', id = 0;
  proc.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg); pending.delete(msg.id);
    }
  });
  const rpc = (method, params) => new Promise(res => { const n = ++id; pending.set(n, res); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sync', version: '0' } });
  call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result.content[0].text;
});
after(() => proc?.kill());

const text = (id, label, t = id) => ({ id, type: 'text', text: t, x: 0, y: 100, width: 700, height: 300, nodeLabel: label });
const canvasFile = (name, nodes) => { const p = join(DIR, `${name}.canvas`); writeFileSync(p, JSON.stringify({ nodes, edges: [] }, null, 2)); return p; };
const read = p => JSON.parse(readFileSync(p, 'utf8'));

test('a label two nodes hold is refused, naming both, and nothing is written', async () => {
  const p = canvasFile('ambiguous', [text('user-node', 'N2', 'mine'), text('agent-node', 'N2', 'theirs')]);
  const before = readFileSync(p, 'utf8');
  const reply = await call('canvas_update_node', { canvasPath: p, ref: 'N2', content: 'overwritten' });
  assert.match(reply, /user-node/);
  assert.match(reply, /agent-node/);
  assert.equal(readFileSync(p, 'utf8'), before);
});

test('a node by id still works when its label is held twice', async () => {
  const p = canvasFile('by-id', [text('user-node', 'N2', 'mine'), text('agent-node', 'N2', 'theirs')]);
  await call('canvas_update_node', { canvasPath: p, ref: 'agent-node', content: 'edited' });
  assert.deepEqual(read(p).nodes.map(n => n.text), ['mine', 'edited']);
});

test('the write waits for the canvas lock another writer holds, then lands', async () => {
  const p = canvasFile('locked', [text('a', 'N1', 'old')]);
  let releasedAt = 0;
  const holding = withCanvasLock(p, 'test', async () => { await new Promise(r => setTimeout(r, 400)); releasedAt = Date.now(); });
  await new Promise(r => setTimeout(r, 50));
  await call('canvas_update_node', { canvasPath: p, ref: 'N1', content: 'new' });
  const doneAt = Date.now();
  await holding;
  assert.ok(doneAt >= releasedAt, 'the MCP wrote while the lock was held');
  assert.equal(read(p).nodes[0].text, 'new');
  assert.equal(existsSync(await lockPathFor(p)), false);
});

test('a node added while the file gave its label to another node is reported under the label it got', async () => {
  // - another writer takes N2 between the tool's read and its write: simulated by holding the lock and
  //   writing the file while the tool waits for it
  const p = canvasFile('relabel', [text('a', 'N1')]);
  const holding = withCanvasLock(p, 'test', async () => {
    await new Promise(r => setTimeout(r, 300));
    const d = read(p); d.nodes.push(text('user-node', 'N2', 'mine')); writeFileSync(p, JSON.stringify(d, null, 2));
  });
  await new Promise(r => setTimeout(r, 50));
  const reply = await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'agent note', x: 1600, y: 600 });
  await holding;
  const d = read(p);
  const agent = d.nodes.find(n => n.text === 'agent note');
  assert.equal(d.nodes.find(n => n.id === 'user-node').nodeLabel, 'N2');
  assert.equal(agent.nodeLabel, 'N3');
  assert.match(reply, /\bN3\b/);
  assert.equal(readdirSync(DIR).filter(f => f.endsWith('.tmp')).length, 0);
});
