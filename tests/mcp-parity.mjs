// - run: npm run build && node --test tests/mcp-parity.mjs
// - stdio JSON-RPC probe over dist/mcp-server.js; fixtures are scratch .cvs.json files under /tmp,
//   so no real .canvas file is ever touched.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { test, before, after } from 'node:test';

const REPO = new URL('..', import.meta.url).pathname;
const DIR  = mkdtempSync(join(tmpdir(), 'skena-parity-'));

const SERVERS = JSON.stringify([{ name: 'probe', hubUrl: 'http://127.0.0.1:59999', token: 't' }]);

let srv, buf = '', id = 0;
const pending = new Map();

const rpc = (method, params) => new Promise(res => {
  const n = ++id; pending.set(n, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
});
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result.content[0].text;
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const fresh = n => join(DIR, `${n}.cvs.json`);
const lanes = d => (d.metadata?.sections ?? []).map(l => l.y);
const pick = (d, label) => { const n = d.nodes.find(x => x.nodeLabel === label); return [n.x, n.y]; };
// - section id → the labels of its members, by the same top-edge rule the lane model uses
const deriveMembers = d => {
  const ls = [...(d.metadata?.sections ?? [])].sort((a, b) => a.y - b.y);
  const out = Object.fromEntries(ls.map(l => [l.id, []]));
  for (const n of d.nodes) {
    const pinned = ls.find(l => (l.folded ?? []).includes(n.id));
    let i = 0;
    ls.forEach((l, k) => { if (l.y <= n.y) i = k; });
    out[(pinned ?? ls[i]).id].push(n.nodeLabel ?? n.id);
  }
  return out;
};

before(async () => {
  srv = spawn('node', ['dist/mcp-server.js'], {
    cwd: REPO, stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SKENA_JUPYTER_KERNELS: SERVERS, SKENA_RUN_IPC: '' },
  });
  srv.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const r = pending.get(msg.id);
      if (r) { pending.delete(msg.id); r(msg); }
    }
  });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } });
});
after(() => srv?.kill());


test('canvas_add_node clamps to the origin and seeds the first section', async () => {
  const p = fresh('clamp');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: -403, y: -99 });
  const d = read(p);
  assert.deepEqual([d.nodes[0].x, d.nodes[0].y], [0, 0]);
  assert.equal(d.metadata.sections.length, 1);
  assert.equal(d.metadata.sections[0].y, 0);
});

test('canvas_update_node / canvas_layout clamp, and leave an unsupplied axis alone', async () => {
  const p = fresh('clamp2');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0 });
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'b', x: 500, y: 300 });
  await call('canvas_update_node', { canvasPath: p, ref: 'N2', x: -900, y: -900 });
  assert.deepEqual(pick(read(p), 'N2'), [0, 0]);
  await call('canvas_update_node', { canvasPath: p, ref: 'N2', x: 700 });
  await call('canvas_update_node', { canvasPath: p, ref: 'N2', y: -50 });
  assert.deepEqual(pick(read(p), 'N2'), [700, 0]);
  await call('canvas_layout', { canvasPath: p, nodes: [{ ref: 'N2', x: -1000, y: -1000 }] });
  assert.deepEqual(pick(read(p), 'N2'), [0, 0]);
  await call('canvas_layout', { canvasPath: p, nodes: [{ ref: 'N2', y: 400 }] });
  await call('canvas_layout', { canvasPath: p, nodes: [{ ref: 'N2', x: -33 }] });
  assert.deepEqual(pick(read(p), 'N2'), [0, 400]);
});

test('canvas_layout past a section bottom edge shifts the sections below', async () => {
  const p = fresh('fit');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0 });
  await call('canvas_add_section', { canvasPath: p });
  const before = lanes(read(p));
  assert.equal(before.length, 2);
  await call('canvas_layout', { canvasPath: p, nodes: [{ ref: 'N1', y: 600 }] });
  const after = lanes(read(p));
  assert.ok(after[1] > before[1], `S2 should move down: ${before} → ${after}`);
});

test('canvas_add_section appends under the last section, and inserts at a given y', async () => {
  const p = fresh('add');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0 });
  const t1 = await call('canvas_add_section', { canvasPath: p, title: 'second' });
  assert.match(t1, /^Created section S2 \(id sec-[a-z0-9-]+\) at y=\d+$/);
  const y2 = lanes(read(p))[1];
  const t2 = await call('canvas_add_section', { canvasPath: p, y: y2 + 1049 });
  assert.match(t2, /^Created section S3 /);
  const after = lanes(read(p));
  assert.equal(after.length, 3);
  // - the tool reports the post-fit y, which is what the file holds
  assert.equal(Number(/at y=(\d+)$/.exec(t2)[1]), after[2]);
  assert.equal(read(p).metadata.sections[1].title, 'second');
  // - y is snapped before the lookup: 49 lands on the lane at 0
  assert.equal(await call('canvas_add_section', { canvasPath: p, y: 49 }), 'error: a section already starts at y=0');
});

test('canvas_add_section refuses a negative y and a y a section already starts at', async () => {
  const p = fresh('addbad');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0 });
  assert.equal(await call('canvas_add_section', { canvasPath: p, y: -40 }), 'error: y must be ≥ 0');
  assert.equal(await call('canvas_add_section', { canvasPath: p, y: 0 }), 'error: a section already starts at y=0');
  assert.equal(lanes(read(p)).length, 1);
});

test('canvas_update_section: rename, clear, fold shrinks and unfold round-trips', async () => {
  const p = fresh('upd');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0 });
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'b', x: 0, y: 400 });
  await call('canvas_add_section', { canvasPath: p });
  const y2before = lanes(read(p))[1];

  assert.match(await call('canvas_update_section', { canvasPath: p, ref: 'S1', title: 'intro' }), /title "intro"/);
  assert.equal(read(p).metadata.sections[0].title, 'intro');
  await call('canvas_update_section', { canvasPath: p, ref: 'S1', title: '' });
  assert.equal('title' in read(p).metadata.sections[0], false);

  const folded = await call('canvas_update_section', { canvasPath: p, ref: 'S1', folded: true });
  assert.match(folded, /folded \(2 node\(s\) hidden\)/);
  const dF = read(p);
  assert.deepEqual(dF.metadata.sections[0].folded.length, 2);
  assert.ok(lanes(dF)[1] < y2before, 'a folded section shrinks the ones below');
  assert.equal(dF.nodes.length, 2, 'folded nodes stay in the file');

  await call('canvas_update_section', { canvasPath: p, ref: 'S1', folded: false });
  const dU = read(p);
  assert.equal('folded' in dU.metadata.sections[0], false);
  assert.deepEqual(lanes(dU), lanes(read(p)));
  assert.equal(lanes(dU)[1], y2before, 'unfold round-trips the geometry');
  assert.equal(dU.nodes.find(n => n.nodeLabel === 'N2').y, 400, 'members return to their own lane');

  const before = readFileSync(p, 'utf8');
  assert.equal(await call('canvas_update_section', { canvasPath: p, ref: 'S1', folded: false }), 'Section S1: already unfolded');
  assert.equal(readFileSync(p, 'utf8'), before, 'a no-op fold change does not rewrite the file');
});

test('canvas_remove_section deletes the section, its nodes and their edges', async () => {
  const p = fresh('rm');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0 });
  await call('canvas_add_section', { canvasPath: p });
  const y2 = lanes(read(p))[1];
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'b', x: 0, y: y2 });
  await call('canvas_add_edge', { canvasPath: p, from: 'N1', to: 'N2' });
  assert.equal(read(p).edges.length, 1);

  const out = await call('canvas_remove_section', { canvasPath: p, ref: 'S2' });
  assert.match(out, /^Removed section S2 and 1 node\(s\)$/);
  const d = read(p);
  assert.equal(d.nodes.length, 1);
  assert.equal(d.edges.length, 0);
  assert.equal(d.metadata.sections.length, 1);
  assert.equal(d.metadata.sections[0].y, 0, 'the first lane re-parks at the origin');
  assert.equal(await call('canvas_remove_section', { canvasPath: p, ref: 'S9' }), 'error: no section matches S9');

  await call('canvas_remove_section', { canvasPath: p, ref: 'S1' });
  const last = read(p);
  assert.equal(last.nodes.length, 0);
  assert.equal('sections' in last.metadata, false, 'the last section gone leaves no empty sections key');
});

test('canvas_add_kernel with start:false records the kernel and binds the section', async () => {
  const p = fresh('kadd');
  await call('canvas_add_node', { canvasPath: p, type: 'code', content: 'x = 1', x: 0, y: 0 });
  const out = await call('canvas_add_kernel', { canvasPath: p, server: 'probe', spec: 'python3', displayName: 'probe-k', bindSection: 'S1', start: false });
  assert.match(out, /^Added kernel k-[a-z0-9]+ \(probe-k\) on probe, live id \(not started\), bound to S1$/);
  const d = read(p);
  assert.equal(d.metadata.kernels.length, 1);
  assert.equal(d.metadata.kernels[0].server, 'probe');
  assert.equal(d.metadata.kernels[0].spec, 'python3');
  assert.equal(d.metadata.kernels[0].colorIndex, 0);
  assert.equal('kernelId' in d.metadata.kernels[0], false);
  assert.equal(d.metadata.sections[0].kernelId, d.metadata.kernels[0].id);
  assert.match(await call('canvas_add_kernel', { canvasPath: p, server: 'nope', start: false }), /^error: unknown server nope — known: probe$/);
});

test('canvas_remove_kernel unbinds the section and un-runs its cells', async () => {
  const p = fresh('krm');
  await call('canvas_add_node', { canvasPath: p, type: 'code', content: 'x = 1', x: 0, y: 0 });
  await call('canvas_add_kernel', { canvasPath: p, server: 'probe', displayName: 'probe-k', bindSection: 'S1', start: false });
  // - a cell that has run: canvas_remove_kernel must clear the flag
  const d0 = read(p);
  d0.nodes[0].lastStatus = 'ok';
  writeFileSync(p, JSON.stringify(d0, null, 2));

  const out = await call('canvas_remove_kernel', { canvasPath: p, ref: 'probe-k' });
  assert.match(out, /^Removed kernel k-[a-z0-9]+ \(probe-k\); 1 cell\(s\) un-run$/);
  const d = read(p);
  assert.equal(d.metadata.kernels.length, 0);
  assert.equal('kernelId' in d.metadata.sections[0], false);
  assert.equal(d.nodes[0].lastStatus, undefined);
  assert.equal(await call('canvas_remove_kernel', { canvasPath: p, ref: 'ghost' }), 'error: no kernel record matches ghost — a record id or display name');
});

test('canvas_run_section reports the section without code cells, and needs a live kernel', async () => {
  const p = fresh('run');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'not code', x: 0, y: 0 });
  assert.equal(await call('canvas_run_section', { canvasPath: p, ref: 'S1' }), 'error: no code cells in S1');
  assert.equal(await call('canvas_run_section', { canvasPath: p, ref: 'S7' }), 'error: no section matches S7');

  await call('canvas_add_node', { canvasPath: p, type: 'code', content: 'x = 1', x: 500, y: 0 });
  assert.equal(
    await call('canvas_run_section', { canvasPath: p, ref: 'S1' }),
    'error: no kernel bound to this cell — connect it to a kernel node, or bind a kernel to its section from the rail',
  );
  await call('canvas_add_kernel', { canvasPath: p, server: 'probe', bindSection: 'S1', start: false });
  assert.equal(
    await call('canvas_run_section', { canvasPath: p, ref: 'S1' }),
    'error: kernel has no live kernelId (open the canvas so Skena starts it)',
  );
});

test('canvas_add_kernel fits the lanes like every other write', async () => {
  const p = fresh('kfit');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 500 });
  // - an unfitted fixture: the first lane sits below the origin, the second past its content
  const d0 = read(p);
  d0.metadata.sections = [{ id: 'sec-a', y: 500, createdAt: 1 }, { id: 'sec-b', y: 2900, createdAt: 2 }];
  writeFileSync(p, JSON.stringify(d0, null, 2));
  assert.deepEqual(lanes(read(p)), [500, 2900]);

  await call('canvas_add_kernel', { canvasPath: p, server: 'probe', start: false });
  assert.equal(lanes(read(p))[0], 0, 'the first lane parks at the origin');
});

// - a section of code cells built by successive adds: each add already goes through the engine, so
//   the fixture is what the engine itself considers packed
const codeAt = async (p, x, y) => call('canvas_add_node', { canvasPath: p, type: 'code', content: '', x, y, width: 700, height: 300 });

test('canvas_add_node after inserts below the cell and pushes its column only', async () => {
  const p = fresh('after');
  await codeAt(p, 1600, 400);    // - E1
  await codeAt(p, 1600, 800);    // - E2
  await codeAt(p, 1600, 1200);   // - E3
  await codeAt(p, 3100, 800);    // - E4, a fork column of its own
  assert.deepEqual([pick(read(p), 'E1'), pick(read(p), 'E2'), pick(read(p), 'E3'), pick(read(p), 'E4')],
    [[1600, 400], [1600, 800], [1600, 1200], [3100, 800]]);

  const out = await call('canvas_add_node', { canvasPath: p, after: 'E2', width: 700, height: 300, x: 9000, y: 9000 });
  console.log(`--- canvas_add_node after ---\n${out}\n---`);
  assert.match(out, /^Created node E5 \(id: ai-\d+-[0-9a-f]{6}\)\nType: code\nPosition: \(1600, 1200\)  Size: 700×300\nx\/y ignored: placed after E2\nMoved: E3\nCanvas: .*after\.cvs\.json$/);
  const d = read(p);
  assert.deepEqual(pick(d, 'E5'), [1600, 1200], 'the new cell takes the slot under E2');
  assert.deepEqual(pick(d, 'E3'), [1600, 1600], 'the cell below is pushed one gap down');
  assert.deepEqual(pick(d, 'E1'), [1600, 400]);
  assert.deepEqual(pick(d, 'E4'), [3100, 800], 'the fork column is untouched');
  assert.equal(d.nodes.find(n => n.nodeLabel === 'E5').type, 'code', 'after defaults the type to code');
});

test('canvas_add_node after a text node makes a text node and pushes the column', async () => {
  const p = fresh('afternote');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 1600, y: 400, width: 700, height: 300 });   // - N1
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'b', x: 1600, y: 800, width: 700, height: 300 });   // - N2

  const out = await call('canvas_add_node', { canvasPath: p, after: 'N1', content: 'c' });
  console.log(`--- canvas_add_node after a note ---\n${out}\n---`);
  assert.match(out, /Type: text\nPosition: \(1600, 800\)/);
  const d = read(p);
  assert.equal(d.nodes.find(n => n.nodeLabel === 'N3').type, 'text', 'after a note defaults the type to text');
  assert.deepEqual(pick(d, 'N3'), [1600, 800], 'the new note takes the slot under N1');
  assert.deepEqual(pick(d, 'N2'), [1600, 1200], 'the note below is pushed one gap down');
  assert.deepEqual(pick(d, 'N1'), [1600, 400]);
});

test('canvas_add_node after keeps the new cell in the anchor section, which grows instead', async () => {
  // - the H5 shape: S1 at its minimum height (800) holds a note and a code cell, S2 starts at 800,
  //   and the slot under E1 is exactly the boundary
  const p = fresh('grow');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0, width: 700, height: 300 });   // - N1
  await codeAt(p, 0, 400);                              // - E1
  await call('canvas_add_section', { canvasPath: p });  // - S2, right under S1's minimum height
  assert.deepEqual(lanes(read(p)), [0, 800]);

  const out = await call('canvas_add_node', { canvasPath: p, after: 'E1' });
  console.log(`--- canvas_add_node after, at the section's bottom edge ---\n${out}\n---`);
  const listed = await call('canvas_list', { canvasPath: p });
  console.log(listed.split('\n').filter(l => /^ {2}S\d/.test(l)).join('\n'));

  const d = read(p);
  assert.deepEqual(pick(d, 'E2'), [0, 800], 'the new cell takes the slot under E1');
  assert.deepEqual(lanes(d), [0, 1200], 'S1 grows to hold it and S2 moves down');
  assert.deepEqual(deriveMembers(d)[d.metadata.sections[0].id], ['N1', 'E1', 'E2']);
  assert.match(listed, /S1 {2}y=0 .*nodes=3/);
  assert.match(listed, /S2 {2}y=1200.*nodes=0/);
});

test('canvas_add_node forkOf right starts a column pair after the source pair', async () => {
  const p = fresh('fork');
  await codeAt(p, 1600, 400);    // - E1
  const out = await call('canvas_add_node', { canvasPath: p, forkOf: 'E1', width: 700, height: 300 });
  console.log(`--- canvas_add_node forkOf right ---\n${out}\n---`);
  // - E1's pair ends at 1600 + 700 + 100 + 600 = 3000; the fork starts one gap after it
  assert.deepEqual(pick(read(p), 'E2'), [3100, 400]);
  assert.match(out, /Position: \(3100, 400\)  Size: 700×300\n/);
});

test('canvas_add_node forkOf left is refused at the origin and taken further right', async () => {
  const p = fresh('forkleft');
  await codeAt(p, 0, 0);         // - E1, hard against the origin
  const refused = await call('canvas_add_node', { canvasPath: p, forkOf: 'E1', side: 'left', width: 700, height: 300 });
  console.log(`--- canvas_add_node forkOf left at the origin ---\n${refused}\n---`);
  assert.equal(refused, 'a left fork does not fit before the origin');
  assert.equal(read(p).nodes.length, 1, 'a refused fork writes nothing');

  await codeAt(p, 1600, 400);    // - E2, far enough from the origin for a pair to fit before it
  const out = await call('canvas_add_node', { canvasPath: p, forkOf: 'E2', side: 'left', width: 700, height: 300 });
  assert.match(out, /Position: \(100, 400\)/, out);   // - 1600 − 100 − (700 + 100 + 600) = 100
  assert.equal(await call('canvas_add_node', { canvasPath: p, forkOf: 'N9' }), 'Node not found: N9');
});

test('canvas_add_node with x/y onto a code cell pushes that column down, and nothing else', async () => {
  const p = fresh('drop');
  await codeAt(p, 1600, 400);    // - E1
  await codeAt(p, 1600, 800);    // - E2
  await codeAt(p, 3100, 400);    // - E3, its own pair
  const out = await call('canvas_add_node', { canvasPath: p, type: 'code', x: 1600, y: 400, width: 700, height: 300 });
  assert.match(out, /Position: \(1600, 400\)\s+Size: 700×300\nMoved: E1, E2\n/, out);
  const d = read(p);
  assert.deepEqual(pick(d, 'E4'), [1600, 400], 'the dropped cell keeps the slot it was given');
  assert.deepEqual(pick(d, 'E1'), [1600, 800]);
  assert.deepEqual(pick(d, 'E2'), [1600, 1200]);
  assert.deepEqual(pick(d, 'E3'), [3100, 400], 'the pair to the right is not pulled or pushed');
});

test('canvas_reflow_section snaps an off-column cell, closes the hole and pulls the pairs in', async () => {
  const p = fresh('reflow');
  await codeAt(p, 1600, 400);
  // - a hand-placed mess the engine never made: an off-column cell, a hole, a pair parked far right
  const d0 = read(p);
  const code = (label, x, y) => ({ id: `n-${label}`, type: 'code', nodeLabel: label, x, y, width: 700, height: 300, code: '', language: 'python' });
  d0.nodes = [code('E1', 1600, 400), code('E2', 1650, 900), code('E3', 1600, 1700), code('E4', 5000, 400)];
  d0.metadata = { sections: [{ id: 'sec-a', y: 0, createdAt: 1 }] };
  writeFileSync(p, JSON.stringify(d0, null, 2));

  assert.equal(await call('canvas_reflow_section', { canvasPath: p, ref: 'S9' }), 'error: no section matches S9');
  const first = await call('canvas_reflow_section', { canvasPath: p, ref: 'S1' });
  console.log(`--- canvas_reflow_section (1st) ---\n${first}\n---`);
  assert.equal(first, 'Reflowed S1: 3 node(s) moved');
  const d = read(p);
  assert.deepEqual(pick(d, 'E1'), [1600, 400], 'the first cell of the first column keeps its place');
  assert.deepEqual(pick(d, 'E2'), [1600, 800], 'the off-column cell snaps onto the column');
  assert.deepEqual(pick(d, 'E3'), [1600, 1200], 'the hole closes to one gap');
  // - none of E1..E3 has an output, so column 1600 keeps no output slot on Reflow and ends at 2300
  assert.deepEqual(pick(d, 'E4'), [2400, 400], 'the far column is pulled in to one gap after column 1600');

  const before = readFileSync(p, 'utf8');
  const second = await call('canvas_reflow_section', { canvasPath: p, ref: 'S1' });
  console.log(`--- canvas_reflow_section (2nd) ---\n${second}\n---`);
  assert.equal(second, 'Reflowed S1: nothing moved');
  assert.equal(readFileSync(p, 'utf8'), before, 'a reflow that moves nothing does not rewrite the file');
});

test('a column pack grows its section instead of pushing a cell into the next one', async () => {
  const p = fresh('cross');
  await codeAt(p, 1600, 0);
  // - S1 [0, 1200) holds E1..E3, S2 starts at 1200 with E4 on its top edge
  const d0 = read(p);
  const code = (label, y) => ({ id: `n-${label}`, type: 'code', nodeLabel: label, x: 1600, y, width: 700, height: 300, code: '', language: 'python' });
  d0.nodes = [code('E1', 0), code('E2', 400), code('E3', 800), code('E4', 1200)];
  d0.metadata = { sections: [{ id: 'sec-a', y: 0, createdAt: 1 }, { id: 'sec-b', y: 1200, createdAt: 2 }] };
  writeFileSync(p, JSON.stringify(d0, null, 2));

  const out = await call('canvas_layout', { canvasPath: p, nodes: [{ ref: 'E1', y: 400 }] });
  console.log(`--- canvas_layout across a section edge ---\n${out}\n---`);
  const d = read(p);
  assert.deepEqual(pick(d, 'E3'), [1600, 1200], 'the pack puts E3 on what was S2s top edge');
  assert.deepEqual(lanes(d), [0, 1600], 'S1 grows to hold it; S2 moves down by the same step');
  assert.deepEqual(pick(d, 'E4'), [1600, 1600], 'S2s member travels with it — no overlap left on disk');
  const members = deriveMembers(d);
  assert.deepEqual(members['sec-a'], ['E1', 'E2', 'E3'], 'E3 stays in S1');
  assert.deepEqual(members['sec-b'], ['E4']);
});

test('after inserts into a FOLDED section as a hidden member of it', async () => {
  const p = fresh('folded');
  await codeAt(p, 1600, 0);      // - E1
  await codeAt(p, 1600, 400);    // - E2
  await call('canvas_add_section', { canvasPath: p });
  assert.match(await call('canvas_update_section', { canvasPath: p, ref: 'S1', folded: true }), /folded \(2 node\(s\) hidden\)/);
  assert.equal(read(p).metadata.sections[0].folded.length, 2);

  const out = await call('canvas_add_node', { canvasPath: p, after: 'E2' });
  console.log(`--- canvas_add_node after, into a folded section ---\n${out}\n---`);
  const d = read(p);
  const added = d.nodes.find(n => n.nodeLabel === 'E3');
  assert.equal(added.type, 'code');
  assert.deepEqual([added.width, added.height], [700, 300], 'an MCP code cell is the webview size');
  assert.equal(d.metadata.sections[0].folded.length, 3, 'the new cell is pinned to the folded section');
  assert.ok(d.metadata.sections[0].folded.includes(added.id));
  assert.match(await call('canvas_list', { canvasPath: p }), /S1 {2}y=0.*nodes=3/);

  // - unfolding releases all three into S1, none adopted by S2
  await call('canvas_update_section', { canvasPath: p, ref: 'S1', folded: false });
  const dU = read(p);
  assert.equal('folded' in dU.metadata.sections[0], false);
  assert.deepEqual(deriveMembers(dU)[dU.metadata.sections[0].id], ['E1', 'E2', 'E3']);
});

test('a second canvas_pin_output on the same cell does not land on the first', async () => {
  const p = fresh('pin');
  await codeAt(p, 0, 0);   // - E1
  await call('canvas_pin_output', { canvasPath: p, sourceRef: 'E1', content: 'first' });
  const first = read(p).nodes.find(n => n.nodeLabel === 'C1');
  // - the first pin becomes E1's output: the engine's slot, one gap right of the code cell
  assert.equal(read(p).nodes.find(n => n.nodeLabel === 'E1').outputNodeId, first.id);

  await call('canvas_pin_output', { canvasPath: p, sourceRef: 'E1', content: 'second' });
  const d = read(p);
  const second = d.nodes.find(n => n.nodeLabel === 'C2');
  assert.equal(d.nodes.find(n => n.nodeLabel === 'E1').outputNodeId, first.id, 'the cell keeps the output it had');
  assert.notDeepEqual([second.x, second.y], [first.x, first.y]);
  const apart = second.x >= first.x + first.width || first.x >= second.x + second.width
             || second.y >= first.y + first.height || first.y >= second.y + second.height;
  assert.ok(apart, `the two pinned cells overlap: C1 ${first.x},${first.y} ${first.width}×${first.height} C2 ${second.x},${second.y} ${second.width}×${second.height}`);
});

// - mirrors src/shared/constants.ts (CODE_LINE_H_ESTIMATE 18, CODE_CHROME_ESTIMATE 39,
//   CODE_H_STEP 50, NODE_SIZE.code.h 300, CODE_MAX_H 900); this probe talks to the built server,
//   not to a bundle it could import the real ones from
const codeHeightFor = text => Math.min(900, Math.max(300, Math.ceil((text.split('\n').length * 18 + 39) / 50) * 50));
const lines = n => Array.from({ length: n }, (_, i) => `x${i} = ${i}`).join('\n');

test('an MCP code cell is as tall as its text needs, and its column re-packs when the text changes', async () => {
  const p = fresh('codeheight');
  const long = lines(30);
  await call('canvas_add_node', { canvasPath: p, type: 'code', content: long, x: 0, y: 0 });
  const tall = read(p).nodes.find(n => n.nodeLabel === 'E1');
  assert.ok(tall.height > 300, `30 lines should not stay at the default 300: ${tall.height}`);
  assert.equal(tall.height, codeHeightFor(long), '30 lines → 600');

  // - a cell under it, one gap below the tall row
  await call('canvas_add_node', { canvasPath: p, after: 'E1' });
  assert.deepEqual(pick(read(p), 'E2'), [0, tall.height + 100]);

  const out = await call('canvas_update_node', { canvasPath: p, ref: 'E1', content: 'a = 1\nb = 2' });
  console.log(`--- canvas_update_node, new code content ---\n${out}\n---`);
  assert.equal(read(p).nodes.find(n => n.nodeLabel === 'E1').height, 300, 'two lines shrink the cell back');
  assert.deepEqual(pick(read(p), 'E2'), [0, 400], 'the column pulls up behind the shrunk cell');
  assert.match(out, /moved E2/);
});

test('a code cell given an explicit height keeps it, on the add and on the update', async () => {
  const p = fresh('codeheight-explicit');
  await call('canvas_add_node', { canvasPath: p, type: 'code', content: lines(30), x: 0, y: 0, height: 300 });
  assert.equal(read(p).nodes.find(n => n.nodeLabel === 'E1').height, 300);
  await call('canvas_update_node', { canvasPath: p, ref: 'E1', content: 'a = 1', height: 500 });
  assert.equal(read(p).nodes.find(n => n.nodeLabel === 'E1').height, 500);
});

test('re-sending a code cell the same text re-sizes nothing, so a height set by hand is kept', async () => {
  const p = fresh('codeheight-same');
  await call('canvas_add_node', { canvasPath: p, type: 'code', content: 'x = 1', x: 0, y: 0 });
  await call('canvas_add_node', { canvasPath: p, after: 'E1' });
  assert.equal(read(p).nodes.find(n => n.nodeLabel === 'E1').height, 300);

  await call('canvas_update_node', { canvasPath: p, ref: 'E1', height: 600 });
  assert.equal(read(p).nodes.find(n => n.nodeLabel === 'E1').height, 600);
  const parked = pick(read(p), 'E2');   // - the column packed under the taller cell

  const out = await call('canvas_update_node', { canvasPath: p, ref: 'E1', content: 'x = 1' });
  console.log(`--- canvas_update_node, the same code content ---\n${out}\n---`);
  assert.equal(read(p).nodes.find(n => n.nodeLabel === 'E1').height, 600, 'the hand-set height is kept');
  assert.deepEqual(pick(read(p), 'E2'), parked, 'no engine run, so nothing below moved');
  assert.doesNotMatch(out, /moved/);
});

// - the fields an agent passes to canvas_add_knowledge; the MCP process never calls a knowledge server
const HIT = {
  server: 'crtx',
  uri:    'crtx://crtx/projects/skena.md#2026-09-19 — state',
  title:  'skena.md › 2026-09-19 — state',
  text:   '## state\n\nthe knowledge node caches this text',
};

test('canvas_add_knowledge after a text node takes the slot canvas_add_node takes, and caches every field', async () => {
  const twoNotes = async name => {
    const p = fresh(name);
    await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 1600, y: 400, width: 700, height: 300 });
    await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'b', x: 1600, y: 800, width: 700, height: 300 });
    return p;
  };
  // - the slot a text node gets under N1, to compare the knowledge node's against
  const pn = await twoNotes('wslot');
  await call('canvas_add_node', { canvasPath: pn, after: 'N1', content: 'c' });
  const slot = pick(read(pn), 'N3');
  assert.deepEqual(slot, [1600, 800]);

  const p   = await twoNotes('wafter');
  const out = await call('canvas_add_knowledge', { canvasPath: p, after: 'N1', ...HIT, x: 9000, y: 9000 });
  console.log(`--- canvas_add_knowledge after a note ---\n${out}\n---`);
  assert.match(out, /^Created node W1 \(id: ai-\d+-[0-9a-f]{6}\)\nType: knowledge\nSource: crtx crtx:\/\/crtx\/projects\/skena\.md#2026-09-19 — state\nPosition: \(1600, 800\)  Size: 700×300\nx\/y ignored: placed after N1\nMoved: N2\nCanvas: .*wafter\.cvs\.json$/);

  const d = read(p);
  const w = d.nodes.find(n => n.nodeLabel === 'W1');
  assert.deepEqual([w.x, w.y], slot, 'the knowledge node takes the same slot a text node would');
  assert.deepEqual([w.width, w.height], [700, 300]);
  assert.equal(w.type, 'knowledge');
  assert.equal(w.server, HIT.server);
  assert.equal(w.uri, HIT.uri);
  assert.equal(w.title, HIT.title);
  assert.equal(w.text, HIT.text);
  assert.equal(w.createdBy, 'ai');
  assert.ok(Date.now() - Date.parse(w.fetchedAt) < 60_000, `fetchedAt should be now: ${w.fetchedAt}`);
  assert.equal('changed' in w, false, 'a node just fetched has nothing to compare against');
  assert.deepEqual(pick(d, 'N2'), [1600, 1200], 'the note below is pushed one gap down');
});

test('canvas_add_knowledge with no anchor is placed right of everything and fits the lanes', async () => {
  const p = fresh('wplace');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 500, width: 400, height: 300 });
  // - an unfitted fixture: the one lane starts below the origin
  const d0 = read(p);
  d0.metadata.sections = [{ id: 'sec-a', y: 500, createdAt: 1 }];
  writeFileSync(p, JSON.stringify(d0, null, 2));
  assert.deepEqual(lanes(read(p)), [500]);

  const out = await call('canvas_add_knowledge', { canvasPath: p, ...HIT });
  console.log(`--- canvas_add_knowledge with no anchor ---\n${out}\n---`);
  const d = read(p);
  assert.deepEqual(lanes(d), [0], 'the lane parks at the origin, as on every other write');
  assert.deepEqual(pick(d, 'W1'), [500, 500], 'placed one gap right of the note, on its row');
  assert.deepEqual(pick(d, 'N1'), [0, 500], 'the lane moved, its members did not');
  assert.deepEqual(deriveMembers(d)[d.metadata.sections[0].id], ['N1', 'W1']);
});

test('canvas_refresh_knowledge dates the node back, and refuses a node that is not knowledge', async () => {
  const p = fresh('wrefresh');
  await call('canvas_add_node', { canvasPath: p, type: 'text', content: 'a', x: 0, y: 0 });
  await call('canvas_add_knowledge', { canvasPath: p, after: 'N1', ...HIT });
  assert.notEqual(read(p).nodes.find(n => n.nodeLabel === 'W1').fetchedAt, '1970-01-01T00:00:00.000Z');

  const out = await call('canvas_refresh_knowledge', { canvasPath: p, ref: 'W1' });
  console.log(`--- canvas_refresh_knowledge ---\n${out}\n---`);
  assert.equal(out, 'Marked W1 for refresh on the next open');
  const w = read(p).nodes.find(n => n.nodeLabel === 'W1');
  assert.equal(w.fetchedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(w.text, HIT.text, 'the cached text is kept');

  assert.equal(await call('canvas_refresh_knowledge', { canvasPath: p, ref: 'N1' }), 'Node N1 is not a knowledge node');
  assert.equal(await call('canvas_refresh_knowledge', { canvasPath: p, ref: 'W9' }), 'Node not found: W9');
});

test('canvas_update_node refuses to set the content of a knowledge node', async () => {
  const p = fresh('wupdate');
  await call('canvas_add_knowledge', { canvasPath: p, ...HIT });
  assert.equal(
    await call('canvas_update_node', { canvasPath: p, ref: 'W1', content: 'edited by hand' }),
    'content is not settable on a knowledge node — use canvas_add_knowledge',
  );
});

test('canvas_read shows a knowledge node as knowledge, with its source and cached text', async () => {
  const p = fresh('wread');
  await call('canvas_add_knowledge', { canvasPath: p, ...HIT });
  const out = await call('canvas_read', { canvasPath: p, ref: 'W1' });
  console.log(`--- canvas_read of a knowledge node ---\n${out}\n---`);
  assert.match(out, /^Node W1 \(id: ai-/);
  assert.match(out, /\nType: knowledge\n/);
  assert.match(out, /\nFormat: knowledge\n/);
  assert.ok(out.includes(`Server: ${HIT.server}`));
  assert.ok(out.includes(`Source: ${HIT.uri}`));
  assert.ok(out.includes(HIT.text), 'the cached text is what canvas_read returns');
});

// - the §3.5 shape: a wide cell in column 0 reaching over column 800, and the cell in that column
//   sitting under it. E6 → E8 right/left is the edge that puts E8 on E6's row.
const anchorFixture = async p => {
  await call('canvas_add_node', { canvasPath: p, type: 'code', content: 'x = 1', x: 0, y: 0 });
  const d = read(p);
  const cell = (n, x, y, w = 700, h = 300) => ({ id: `code-${n}`, type: 'code', x, y, width: w, height: h, code: `x = ${n}`, language: 'python', nodeLabel: `E${n}` });
  d.nodes = [
    cell(1, 0, 200, 700, 100),
    cell(2, 0, 400, 700, 200),
    cell(3, 0, 700, 1500, 300),
    cell(4, 0, 1100), cell(5, 0, 1500), cell(6, 0, 1900),
    cell(7, 800, 200), cell(8, 800, 1100),
  ];
  writeFileSync(p, JSON.stringify(d, null, 2));
};

test('canvas_add_edge puts the target on its source row, canvas_remove_edge lets it pack up', async () => {
  const p = fresh('anchor');
  await anchorFixture(p);

  const added = await call('canvas_add_edge', { canvasPath: p, from: 'E6', to: 'E8', fromSide: 'right', toSide: 'left' });
  console.log(`--- canvas_add_edge ---\n${added}\n---`);
  assert.match(added, /^Connected E6 → E8/);
  assert.match(added, / — moved E8$/);
  assert.deepEqual(pick(read(p), 'E8'), [800, 1900], 'E8 rides on E6 row');
  assert.deepEqual(pick(read(p), 'E7'), [800, 200], 'the cell above it stays');

  const edgeId = read(p).edges[0].id;
  const removed = await call('canvas_remove_edge', { canvasPath: p, ref: edgeId });
  console.log(`--- canvas_remove_edge ---\n${removed}\n---`);
  assert.match(removed, / — moved E8$/);
  assert.deepEqual(pick(read(p), 'E8'), [800, 1100], 'released, it packs up under the wide cell');
});

test('canvas_add_edge from a code cell to a note puts the note on its row, canvas_remove_edge lets it pack up', async () => {
  const p = fresh('anchor-note');
  await anchorFixture(p);
  const d = read(p);
  d.nodes = d.nodes.map(n => (n.nodeLabel === 'E8' ? { id: 'text-1', type: 'text', x: 800, y: 1100, width: 700, height: 300, text: 'a note', nodeLabel: 'N1' } : n));
  writeFileSync(p, JSON.stringify(d, null, 2));

  const added = await call('canvas_add_edge', { canvasPath: p, from: 'E6', to: 'N1', fromSide: 'right', toSide: 'left' });
  console.log(`--- canvas_add_edge code → note ---\n${added}\n---`);
  assert.match(added, /^Connected E6 → N1/);
  assert.match(added, / — moved N1$/);
  assert.deepEqual(pick(read(p), 'N1'), [800, 1900], 'N1 takes E6 row');
  assert.deepEqual(pick(read(p), 'E7'), [800, 200], 'the cell above it stays');

  const edgeId = read(p).edges[0].id;
  const removed = await call('canvas_remove_edge', { canvasPath: p, ref: edgeId });
  console.log(`--- canvas_remove_edge code → note ---\n${removed}\n---`);
  assert.match(removed, / — moved N1$/);
  assert.deepEqual(pick(read(p), 'N1'), [800, 1100], 'released, it packs up under the wide cell');
});

test('a bottom-to-top edge anchors nothing', async () => {
  const p = fresh('anchor-down');
  await anchorFixture(p);
  const out = await call('canvas_add_edge', { canvasPath: p, from: 'E6', to: 'E8', fromSide: 'bottom', toSide: 'top' });
  assert.equal(out.includes('moved'), false, out);
  assert.deepEqual(pick(read(p), 'E8'), [800, 1100]);
});

test('canvas_update_edge that turns an edge right → left puts the target on its source row', async () => {
  const p = fresh('anchor-update');
  await anchorFixture(p);
  await call('canvas_add_edge', { canvasPath: p, from: 'E6', to: 'E8', fromSide: 'bottom', toSide: 'top' });
  assert.deepEqual(pick(read(p), 'E8'), [800, 1100], 'a bottom → top edge anchors nothing');

  const edgeId = read(p).edges[0].id;
  const out = await call('canvas_update_edge', { canvasPath: p, ref: edgeId, fromSide: 'right', toSide: 'left' });
  console.log(`--- canvas_update_edge to right/left ---\n${out}\n---`);
  assert.match(out, / — moved E8$/);
  assert.deepEqual(pick(read(p), 'E8'), [800, 1900], 'E8 rides on E6 row');
  assert.deepEqual(pick(read(p), 'E7'), [800, 200], 'the cell above it stays');
});

test('canvas_update_edge that turns a sequence edge downward releases the target', async () => {
  const p = fresh('anchor-release');
  await anchorFixture(p);
  await call('canvas_add_edge', { canvasPath: p, from: 'E6', to: 'E8', fromSide: 'right', toSide: 'left' });
  assert.deepEqual(pick(read(p), 'E8'), [800, 1900]);

  const edgeId = read(p).edges[0].id;
  const out = await call('canvas_update_edge', { canvasPath: p, ref: edgeId, fromSide: 'bottom', toSide: 'top' });
  console.log(`--- canvas_update_edge to bottom/top ---\n${out}\n---`);
  assert.match(out, / — moved E8$/);
  assert.deepEqual(pick(read(p), 'E8'), [800, 1100], 'released, it packs up under the wide cell');

  // - a label-only update changes no geometry
  const plain = await call('canvas_update_edge', { canvasPath: p, ref: edgeId, label: 'then' });
  assert.equal(plain.includes('moved'), false, plain);
});

test('canvas_read and canvas_list name a code cell\'s output, and the output\'s code cell', async () => {
  // - C1 is E1's output; C2 is only connected to E1 by an edge, the way a pinned cell is
  const p = fresh('outputs');
  writeFileSync(p, JSON.stringify({
    nodes: [
      { id: 'n-e1', type: 'code', nodeLabel: 'E1', x: 0, y: 0, width: 700, height: 300, code: '1+1', language: 'python', outputNodeId: 'n-c1' },
      { id: 'n-c1', type: 'cell', nodeLabel: 'C1', x: 800, y: 0, width: 600, height: 300, format: 'html', content: '2' },
      { id: 'n-c2', type: 'cell', nodeLabel: 'C2', x: 800, y: 400, width: 600, height: 300, format: 'html', content: 'pinned' },
    ],
    edges: [
      { id: 'q1', fromNode: 'n-e1', fromSide: 'right', toNode: 'n-c1', toSide: 'left' },
      { id: 'q2', fromNode: 'n-e1', fromSide: 'right', toNode: 'n-c2', toSide: 'left' },
    ],
  }, null, 2));
  assert.match(await call('canvas_read', { canvasPath: p, ref: 'E1' }), /^Output: C1 \(id: n-c1\)$/m);
  assert.match(await call('canvas_read', { canvasPath: p, ref: 'C1' }), /^Output of: E1 \(id: n-e1\)$/m);
  assert.doesNotMatch(await call('canvas_read', { canvasPath: p, ref: 'C2' }), /^Output/m);
  const list = await call('canvas_list', { canvasPath: p });
  assert.match(list, /^ {2}E1 .*\(output: C1\)$/m);
  assert.match(list, /^ {2}C1 .*\(output of: E1\)$/m);
  assert.doesNotMatch(list, /^ {2}C2 .*output/m);
});
