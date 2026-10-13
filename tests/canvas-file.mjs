// - run: npx esbuild src/extension/canvasFile.ts --bundle --format=esm --platform=node --outfile=tests/.build/canvasFile.mjs && node --test tests/canvas-file.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CanvasFile } from './.build/canvasFile.mjs';

const P = '/x/t.canvas';
const code = (id, extra = {}) => ({ id, type: 'code', code: 'x = 1', x: 0, y: 100, width: 700, height: 300, ...extra });
const text = (id, extra = {}) => ({ id, type: 'text', text: 'note', x: 1600, y: 100, width: 700, height: 300, ...extra });

// - a file in memory that another writer can change behind the host's back, and the host's open document
function setup(initial) {
  const disk = { text: JSON.stringify(initial, null, 2), writes: 0 };
  const io = {
    read: async () => disk.text,
    write: async (_p, json) => { disk.text = json; disk.writes++; },
    lock: (_p, fn) => fn(),
  };
  const doc = { canvas: null };
  const file = new CanvasFile(P, io, c => c, () => doc.canvas, c => { doc.canvas = c; });
  return { disk, doc, file, external: (c) => { disk.text = JSON.stringify(c); } };
}

test('a host write after another writer changed the file keeps that change', async () => {
  const s = setup({ nodes: [code('a'), text('n')], edges: [] });
  await s.file.load();
  s.external({ nodes: [code('a', { code: 'x = 2' }), text('n')], edges: [] });   // - the agent's edit, not yet seen
  s.doc.canvas.nodes[1].text = 'host change';                                     // - e.g. a run output
  const r = await s.file.commit();
  const onDisk = JSON.parse(s.disk.text);
  assert.equal(onDisk.nodes[0].code, 'x = 2');
  assert.equal(onDisk.nodes[1].text, 'host change');
  assert.equal(r.merged, true);
});

test('an editor save based on the current version is written and moves the version on', async () => {
  const s = setup({ nodes: [text('n')], edges: [] });
  const v0 = await s.file.load();
  const r = await s.file.save(v0.version, () => ({ nodes: [text('n', { text: 'typed' })], edges: [] }));
  assert.equal(r.written, true);
  assert.equal(r.prevVersion, v0.version);
  assert.ok(r.version > v0.version);
  assert.equal(JSON.parse(s.disk.text).nodes[0].text, 'typed');
});

test('an editor save based on a version older than the file is refused, and the file is left alone', async () => {
  const s = setup({ nodes: [code('a'), text('n')], edges: [] });
  const v0 = await s.file.load();
  s.external({ nodes: [code('a', { code: 'x = 2' }), text('n')], edges: [] });
  const writes = s.disk.writes;
  const r = await s.file.save(v0.version, () => ({ nodes: [code('a'), text('n', { text: 'typed' })], edges: [] }));
  assert.equal(r.written, false);
  assert.equal(s.disk.writes, writes);
  assert.equal(r.canvas.nodes[0].code, 'x = 2');          // - what the editor is sent instead
  assert.ok(r.version > v0.version);
});

test('a save based on a version the host wrote since is refused too', async () => {
  const s = setup({ nodes: [text('n')], edges: [] });
  const v0 = await s.file.load();
  s.doc.canvas.nodes[0].text = 'host change';
  await s.file.commit();
  const r = await s.file.save(v0.version, () => ({ nodes: [text('n', { text: 'typed' })], edges: [] }));
  assert.equal(r.written, false);
});

test('the file holding what the host wrote is not a change', async () => {
  const s = setup({ nodes: [text('n')], edges: [] });
  await s.file.load();
  s.doc.canvas.nodes[0].text = 'host change';
  await s.file.commit();
  assert.equal(await s.file.absorb(), null);
});

test('a change another writer made is taken in once, with a new version', async () => {
  const s = setup({ nodes: [text('n')], edges: [] });
  const v0 = await s.file.load();
  s.external({ nodes: [text('n'), text('agent')], edges: [] });
  const r = await s.file.absorb();
  assert.ok(r.version > v0.version);
  assert.deepEqual(s.doc.canvas.nodes.map(n => n.id), ['n', 'agent']);
  assert.equal(await s.file.absorb(), null);
});

test('a file that does not parse (a writer mid-write) is not taken in', async () => {
  const s = setup({ nodes: [text('n')], edges: [] });
  await s.file.load();
  s.disk.text = '{"nodes": [';
  assert.equal(await s.file.absorb(), null);
  assert.deepEqual(s.doc.canvas.nodes.map(n => n.id), ['n']);
});

test('commits run one at a time: two concurrent host writes both reach the file', async () => {
  const s = setup({ nodes: [text('n'), text('m')], edges: [] });
  await s.file.load();
  s.doc.canvas.nodes[0].text = 'first';
  const a = s.file.commit();
  s.doc.canvas.nodes[1].text = 'second';
  const b = s.file.commit();
  await Promise.all([a, b]);
  const onDisk = JSON.parse(s.disk.text);
  assert.deepEqual(onDisk.nodes.map(n => n.text), ['first', 'second']);
});

test('a host write while another writer is mid-write waits for the file to parse, and keeps that write', async () => {
  const before = JSON.stringify({ nodes: [code('a'), text('n')], edges: [] });
  const after = JSON.stringify({ nodes: [code('a', { code: 'x = 2' }), text('n')], edges: [] });
  // - what each read of the file returns: the load, then the file truncated, half written, written
  const reads = [before, '', after.slice(0, 40), after];
  let written = null;
  const doc = { canvas: null };
  const io = { read: async () => (reads.length > 1 ? reads.shift() : reads[0]), write: async (_p, json) => { written = json; }, lock: (_p, fn) => fn() };
  const file = new CanvasFile(P, io, c => c, () => doc.canvas, c => { doc.canvas = c; });
  await file.load();
  doc.canvas.nodes[1].text = 'host change';
  await file.commit();
  const onDisk = JSON.parse(written);
  assert.equal(onDisk.nodes[0].code, 'x = 2');
  assert.equal(onDisk.nodes[1].text, 'host change');
});

test('a host change made while a save is reading the file is written along with the save', async () => {
  const s = setup({ nodes: [code('a'), text('n')], edges: [] });
  // - the save's read of the file is slow; the run's output reaches the host meanwhile
  let release, slowNext = false;
  const slow = new Promise(r => { release = r; });
  const io = {
    read: async () => { if (slowNext) { slowNext = false; await slow; } return s.disk.text; },
    write: async (_p, json) => { s.disk.text = json; },
    lock: (_p, fn) => fn(),
  };
  const doc = s.doc;
  const file = new CanvasFile(P, io, c => c, () => doc.canvas, c => { doc.canvas = c; });
  const v = await file.load();
  slowNext = true;
  const saving = file.save(v.version, () => ({ nodes: [code('a'), text('n', { text: 'typed' })], edges: [] }));
  const run = file.commit(c => { c.nodes.find(n => n.id === 'a').lastStatus = 'ok'; });
  release();
  await Promise.all([saving, run]);
  const onDisk = JSON.parse(s.disk.text);
  assert.equal(onDisk.nodes.find(n => n.id === 'n').text, 'typed');
  assert.equal(onDisk.nodes.find(n => n.id === 'a').lastStatus, 'ok');
});

test('a host change is made on the canvas as the file holds it, another writer\'s change included', async () => {
  const s = setup({ nodes: [code('a'), text('n')], edges: [] });
  await s.file.load();
  s.external({ nodes: [code('a'), text('n'), text('agent')], edges: [] });
  let seen = null;
  const r = await s.file.commit(c => { seen = c.nodes.map(n => n.id); c.nodes[0].lastStatus = 'ok'; return 'done'; });
  assert.deepEqual(seen, ['a', 'n', 'agent']);
  assert.equal(r.result, 'done');
  assert.equal(r.merged, true);
});

test('the read the write is based on and the write itself happen holding the lock', async () => {
  const s = setup({ nodes: [text('n')], edges: [] });
  await s.file.load();
  const trace = [];
  let held = false;
  const io = {
    read: async () => { trace.push(`read ${held}`); return s.disk.text; },
    write: async (_p, json) => { trace.push(`write ${held}`); s.disk.text = json; },
    lock: async (_p, fn) => { held = true; try { return await fn(); } finally { held = false; } },
  };
  const doc = s.doc;
  const file = new CanvasFile(P, io, c => c, () => doc.canvas, c => { doc.canvas = c; });
  const v = await file.load();
  trace.length = 0;
  await file.commit(c => { c.nodes[0].text = 'x'; });
  await file.save(v.version + 1, () => ({ nodes: [text('n', { text: 'y' })], edges: [] }));
  assert.deepEqual(trace, ['read true', 'write true', 'read true', 'write true']);
});

test('no lock to be had: nothing is written and the caller gets the error', async () => {
  const s = setup({ nodes: [text('n')], edges: [] });
  const io = { read: async () => s.disk.text, write: async () => { throw new Error('written without the lock'); }, lock: async () => { throw new Error('locked by mcp'); } };
  const doc = s.doc;
  const file = new CanvasFile(P, io, c => c, () => doc.canvas, c => { doc.canvas = c; });
  const v = await file.load();
  await assert.rejects(file.commit(c => { c.nodes[0].text = 'x'; }), /locked by mcp/);
  await assert.rejects(file.save(v.version, () => doc.canvas), /locked by mcp/);
  // - the queue is not stuck behind a failure
  assert.equal(await file.absorb(), null);
});
