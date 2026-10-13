// - run: npx esbuild src/shared/canvasMerge.ts --bundle --format=esm --outfile=tests/.build/canvasMerge.mjs && node --test tests/canvas-merge.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { merge3, rebaseHistory, uniqueLabels } from './.build/canvasMerge.mjs';

const code = (id, extra = {}) => ({ id, type: 'code', code: 'x = 1', x: 0, y: 100, width: 700, height: 300, nodeLabel: 'E1', ...extra });
const text = (id, extra = {}) => ({ id, type: 'text', text: 'note', x: 1600, y: 100, width: 700, height: 300, nodeLabel: 'N1', ...extra });
const edge = (id, from, to) => ({ id, fromNode: from, fromSide: 'right', toNode: to, toSide: 'left', toEnd: 'arrow' });
const canvas = (nodes, extra = {}) => ({ nodes, edges: [], metadata: { sections: [{ id: 's1', y: 0, createdAt: 1 }] }, viewport: { x: 0, y: 0, zoom: 1 }, ...extra });
const clone = (c) => JSON.parse(JSON.stringify(c));
const byId = (c, id) => c.nodes.find(n => n.id === id);

test('no change of ours since the base: the result is theirs and nothing of ours is kept', () => {
  const base = canvas([code('a'), text('n')]);
  const theirs = canvas([code('a', { code: 'x = 2' }), text('n')]);
  const r = merge3(base, clone(base), theirs);
  assert.deepEqual(r.canvas, theirs);
  assert.equal(r.kept, false);
});

test('an external code edit survives a save that only moved the camera', () => {
  const base = canvas([code('a'), text('n')]);
  const ours = { ...clone(base), viewport: { x: -500, y: 0, zoom: 0.5 } };
  const theirs = canvas([code('a', { code: 'x = 2' }), text('n')]);
  const r = merge3(base, ours, theirs);
  assert.equal(byId(r.canvas, 'a').code, 'x = 2');
  assert.deepEqual(r.canvas.viewport, { x: -500, y: 0, zoom: 0.5 });
  assert.equal(r.kept, true);
});

test('a node added on each side: both are in the result', () => {
  const base = canvas([code('a')]);
  const ours = canvas([code('a'), text('mine')]);
  const theirs = canvas([code('a'), text('agent')]);
  const r = merge3(base, ours, theirs);
  assert.deepEqual(r.canvas.nodes.map(n => n.id).sort(), ['a', 'agent', 'mine']);
});

test('a node deleted on one side and untouched on the other is deleted', () => {
  const base = canvas([code('a'), text('n'), text('m')]);
  const ours = canvas([code('a'), text('m')]);              // - we deleted n
  const theirs = canvas([code('a'), text('n')]);            // - they deleted m
  const r = merge3(base, ours, theirs);
  assert.deepEqual(r.canvas.nodes.map(n => n.id), ['a']);
});

test('a node they deleted that we changed is deleted; a node we deleted that they changed stays', () => {
  const base = canvas([code('a'), text('n')]);
  const ours = canvas([text('n', { text: 'mine' })]);       // - we deleted a, changed n
  const theirs = canvas([code('a', { code: 'x = 2' })]);    // - they changed a, deleted n
  const r = merge3(base, ours, theirs);
  assert.deepEqual(r.canvas.nodes.map(n => n.id), ['a']);
  assert.equal(byId(r.canvas, 'a').code, 'x = 2');
});

test('one node changed on both sides in different fields keeps both changes', () => {
  const out = { id: 'out', type: 'cell', content: 'x', x: 800, y: 100, width: 700, height: 300, nodeLabel: 'C1' };
  const base = canvas([code('a', { lastStatus: 'error' }), out]);
  const ours = canvas([code('a', { lastStatus: 'ok', outputNodeId: 'out' }), out]);   // - a run's result mirrored in the editor
  const theirs = canvas([code('a', { lastStatus: 'error', code: 'x = 2' }), out]);    // - the agent's code edit
  const r = merge3(base, ours, theirs);
  assert.deepEqual(byId(r.canvas, 'a'), code('a', { lastStatus: 'ok', outputNodeId: 'out', code: 'x = 2' }));
});

test('the same field changed on both sides takes theirs', () => {
  const base = canvas([text('n')]);
  const r = merge3(base, canvas([text('n', { text: 'mine' })]), canvas([text('n', { text: 'theirs' })]));
  assert.equal(byId(r.canvas, 'n').text, 'theirs');
});

test('the same change on both sides is not a change of ours', () => {
  const base = canvas([text('n')]);
  const r = merge3(base, canvas([text('n', { text: 'same' })]), canvas([text('n', { text: 'same' })]));
  assert.equal(byId(r.canvas, 'n').text, 'same');
  assert.equal(r.kept, false);
});

test('key order and keys holding undefined are not changes', () => {
  const base = canvas([code('a', { lastStatus: 'ok' })]);
  const { id, type, ...rest } = code('a', { lastStatus: 'ok' });
  const ours = canvas([{ ...rest, id, type, outputNodeId: undefined }]);
  const theirs = canvas([code('a', { lastStatus: 'ok', code: 'x = 2' })]);
  const r = merge3(base, ours, theirs);
  assert.equal(byId(r.canvas, 'a').code, 'x = 2');
  assert.equal(r.kept, false);
});

test('edges merge by id: an edge they added and an edge we removed', () => {
  const base = { ...canvas([code('a'), text('n'), text('m')]), edges: [edge('e1', 'a', 'n')] };
  const ours = { ...clone(base), edges: [] };
  const theirs = { ...clone(base), edges: [edge('e1', 'a', 'n'), edge('e2', 'a', 'm')] };
  const r = merge3(base, ours, theirs);
  assert.deepEqual(r.canvas.edges.map(e => e.id), ['e2']);
});

test('sections merge by id: a fold of ours and a section they added', () => {
  const base = canvas([code('a')]);
  const ours = clone(base); ours.metadata.sections[0].folded = ['a'];
  const theirs = clone(base); theirs.metadata.sections.push({ id: 's2', y: 800, createdAt: 2, title: 'S7' });
  const r = merge3(base, ours, theirs);
  assert.deepEqual(r.canvas.metadata.sections, [{ id: 's1', y: 0, createdAt: 1, folded: ['a'] }, { id: 's2', y: 800, createdAt: 2, title: 'S7' }]);
});

test('a metadata key they changed and a metadata key we changed are both kept', () => {
  const base = canvas([code('a')]);
  const ours = clone(base); ours.metadata.sections[0].title = 'mine';
  const theirs = clone(base); theirs.metadata.aiModel = 'opus';
  const r = merge3(base, ours, theirs);
  assert.equal(r.canvas.metadata.aiModel, 'opus');
  assert.equal(r.canvas.metadata.sections[0].title, 'mine');
});

test('the creation counter takes the larger of the two', () => {
  const base = canvas([], { creationCounter: 5 });
  const r = merge3(base, canvas([], { creationCounter: 7 }), canvas([], { creationCounter: 6 }));
  assert.equal(r.canvas.creationCounter, 7);
});

test('a key only one side knows survives', () => {
  const base = canvas([code('a')]);
  const theirs = { ...clone(base), obsidian: { pinned: true } };
  const r = merge3(base, clone(base), theirs);
  assert.deepEqual(r.canvas.obsidian, { pinned: true });
});

test('a history entry rebased over an external change: undo keeps the external change', () => {
  const before = canvas([code('a'), text('n')]);                                   // - the entry undo would restore
  const base = canvas([code('a'), text('n', { text: 'user text' })]);              // - after the user edited n
  const theirs = canvas([code('a', { code: 'x = 2' }), text('n', { text: 'user text' }), text('agent')]);
  const entry = { nodes: before.nodes, edges: before.edges, sections: before.metadata.sections };
  const [rebased] = rebaseHistory([entry], base, theirs);
  assert.equal(rebased.nodes.find(n => n.id === 'n').text, 'note');               // - the user's edit is still undone
  assert.equal(rebased.nodes.find(n => n.id === 'a').code, 'x = 2');              // - the agent's edit is not
  assert.ok(rebased.nodes.some(n => n.id === 'agent'));                            // - nor the agent's node
});

test('inputs are not mutated', () => {
  const base = canvas([code('a'), text('n')]);
  const ours = canvas([code('a', { lastStatus: 'ok' }), text('n')]);
  const theirs = canvas([code('a', { code: 'x = 2' })]);
  const snap = JSON.stringify([base, ours, theirs]);
  merge3(base, ours, theirs);
  assert.equal(JSON.stringify([base, ours, theirs]), snap);
});

test('an edge one side drew to a node the other side deleted is dropped', () => {
  const base = canvas([code('a'), text('n')]);
  const ours = { ...clone(base), edges: [edge('mine', 'a', 'n')] };
  const theirs = canvas([code('a')]);
  const r = merge3(base, ours, theirs);
  assert.deepEqual(r.canvas.edges, []);
});

test('fold lists, output links and section kernels that name something gone are cleared', () => {
  const base = canvas([code('a', { outputNodeId: 'out' }), { id: 'out', type: 'cell', content: 'x', x: 800, y: 100, width: 700, height: 300, nodeLabel: 'C1' }]);
  base.metadata.kernels = [{ id: 'k1', server: 'local', colorIndex: 0 }];
  const ours = clone(base);
  ours.metadata.sections[0].folded = ['a', 'out'];
  ours.metadata.sections[0].kernelId = 'k1';
  const theirs = clone(base);
  theirs.nodes = theirs.nodes.filter(n => n.id !== 'out');
  delete theirs.nodes[0].outputNodeId;
  theirs.metadata.kernels = [];
  const r = merge3(base, ours, theirs);
  assert.deepEqual(r.canvas.metadata.sections[0].folded, ['a']);
  assert.equal(r.canvas.metadata.sections[0].kernelId, undefined);
  assert.equal(byId(r.canvas, 'a').outputNodeId, undefined);
});

test('a section kernel naming a kernel node stays', () => {
  const base = canvas([code('a'), { id: 'kn', type: 'kernel', server: 'local', x: 0, y: 0, width: 100, height: 100, nodeLabel: 'K1' }]);
  const ours = clone(base); ours.metadata.sections[0].kernelId = 'kn';
  const r = merge3(base, ours, clone(base));
  assert.equal(r.canvas.metadata.sections[0].kernelId, 'kn');
});

test('two new nodes with one label: the file keeps it, the other gets the next free one', () => {
  const base = canvas([text('n', { nodeLabel: 'N1' })]);
  const ours = canvas([text('n', { nodeLabel: 'N1' }), text('mine', { nodeLabel: 'N2' })]);
  const theirs = canvas([text('n', { nodeLabel: 'N1' }), text('agent', { nodeLabel: 'N2' })]);
  const r = merge3(base, ours, theirs);
  assert.equal(byId(r.canvas, 'agent').nodeLabel, 'N2');
  assert.equal(byId(r.canvas, 'mine').nodeLabel, 'N3');
  assert.equal(r.kept, true);
});

test('undo entries rebased over a deletion hold no edge to the deleted node', () => {
  const base = { ...canvas([code('a'), text('n')]), edges: [edge('e1', 'a', 'n')] };
  const theirs = canvas([code('a')]);
  const entry = { nodes: base.nodes, edges: [edge('e1', 'a', 'n'), edge('mine', 'n', 'a')], sections: base.metadata.sections };
  const [r] = rebaseHistory([entry], base, theirs);
  assert.deepEqual(r.edges, []);
});

// - random canvases, two random edit sets each kept valid by its side, merged: the result is valid
test('merged canvases hold no reference to anything gone and no label twice', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ri = (n) => Math.floor(rnd() * n);
  const pick = (xs) => xs[ri(xs.length)];
  const make = () => {
    const nodes = [];
    for (let i = 0; i < 4 + ri(8); i++) {
      const type = pick(['text', 'code', 'cell']);
      nodes.push({ id: `b${i}`, type, x: ri(2000), y: ri(2000), width: 700, height: 300, nodeLabel: `${type === 'text' ? 'N' : type === 'code' ? 'E' : 'C'}${i + 1}` });
    }
    const cells = nodes.filter(x => x.type === 'cell');
    for (const c of nodes.filter(x => x.type === 'code')) if (cells.length && rnd() < 0.5) c.outputNodeId = pick(cells).id;
    const edges = [];
    for (let i = 0; i < nodes.length; i++) if (rnd() < 0.6) { const a = pick(nodes).id, b = pick(nodes).id; if (a !== b) edges.push({ id: `be${i}`, fromNode: a, toNode: b }); }
    return { nodes, edges, metadata: { sections: [{ id: 's0', y: 0, createdAt: 1, kernelId: 'k0' }, { id: 's1', y: 1000, createdAt: 2, folded: [nodes[0].id] }], kernels: [{ id: 'k0', server: 'l', colorIndex: 0 }, { id: 'k1', server: 'l', colorIndex: 1 }] }, viewport: { x: 0, y: 0, zoom: 1 } };
  };
  const edit = (c, side) => {
    let n = 0;
    const del = (id) => {
      c.nodes = c.nodes.filter(x => x.id !== id);
      c.edges = c.edges.filter(e => e.fromNode !== id && e.toNode !== id);
      for (const s of c.metadata.sections) if (s.folded) s.folded = s.folded.filter(m => m !== id);
      for (const x of c.nodes) if (x.outputNodeId === id) delete x.outputNodeId;
    };
    const used = () => new Set(c.nodes.map(x => x.nodeLabel));
    for (let k = 0; k < 1 + ri(6); k++) {
      const op = pick(['del', 'add', 'edge', 'fold', 'kDel', 'kBind', 'out']);
      const node = c.nodes.length ? pick(c.nodes) : null;
      if (op === 'del' && node) del(node.id);
      else if (op === 'add') { let i = 1; while (used().has(`N${i}`)) i++; c.nodes.push({ id: `${side}n${++n}`, type: 'text', x: 0, y: 0, width: 700, height: 300, nodeLabel: `N${i}` }); }
      else if (op === 'edge' && c.nodes.length > 1) { const a = pick(c.nodes).id, b = pick(c.nodes).id; if (a !== b) c.edges.push({ id: `${side}e${++n}`, fromNode: a, toNode: b }); }
      else if (op === 'fold' && node) { const s = pick(c.metadata.sections); s.folded = [...(s.folded ?? []), node.id]; }
      else if (op === 'kDel' && c.metadata.kernels.length) { const kr = pick(c.metadata.kernels); c.metadata.kernels = c.metadata.kernels.filter(x => x !== kr); for (const s of c.metadata.sections) if (s.kernelId === kr.id) delete s.kernelId; }
      else if (op === 'kBind' && c.metadata.kernels.length) pick(c.metadata.sections).kernelId = pick(c.metadata.kernels).id;
      else if (op === 'out' && node?.type === 'code') { const cells = c.nodes.filter(x => x.type === 'cell'); if (cells.length) node.outputNodeId = pick(cells).id; }
    }
  };
  const problems = [];
  for (let t = 0; t < 3000; t++) {
    const base = make(), ours = clone(base), theirs = clone(base);
    edit(ours, 'o'); edit(theirs, 't');
    const m = merge3(base, ours, theirs).canvas;
    const ids = new Set(m.nodes.map(x => x.id));
    const kernelIds = new Set([...(m.metadata?.kernels ?? []).map(k => k.id), ...m.nodes.filter(x => x.type === 'kernel').map(x => x.id)]);
    if (ids.size !== m.nodes.length) problems.push(`${t}: node id twice`);
    if (m.edges.some(e => !ids.has(e.fromNode) || !ids.has(e.toNode))) problems.push(`${t}: edge to a missing node`);
    if ((m.metadata?.sections ?? []).some(s => s.folded?.some(id => !ids.has(id)))) problems.push(`${t}: fold names a missing node`);
    if ((m.metadata?.sections ?? []).some(s => s.kernelId && !kernelIds.has(s.kernelId))) problems.push(`${t}: section kernel missing`);
    if (m.nodes.some(x => x.outputNodeId && !ids.has(x.outputNodeId))) problems.push(`${t}: output link to a missing node`);
    const labels = m.nodes.map(x => x.nodeLabel);
    if (new Set(labels).size !== labels.length) problems.push(`${t}: label twice`);
  }
  assert.deepEqual(problems.slice(0, 5), []);
});

test('an undo entry rebased over a node the file gave a label to: the entry\'s other node gets a new label', () => {
  // - the entry holds the user's unsaved node N2; the file now gives N2 to the agent's node
  const base = canvas([text('n', { nodeLabel: 'N1' })]);
  const theirs = canvas([text('n', { nodeLabel: 'N1' }), text('agent', { nodeLabel: 'N2' })]);
  const entry = { nodes: [text('n', { nodeLabel: 'N1' }), text('mine', { nodeLabel: 'N2' })], edges: [], sections: base.metadata.sections };
  const [r] = rebaseHistory([entry], base, theirs);
  assert.equal(r.nodes.find(n => n.id === 'agent').nodeLabel, 'N2');
  assert.equal(r.nodes.find(n => n.id === 'mine').nodeLabel, 'N3');
});

test('labels the file holds never move: a node not holding its own file label gives way, wherever it stands', () => {
  const file = new Map([['agent', 'N2'], ['n', 'N1']]);
  // - the user's node comes first in the list and claims N2; the agent's node is the file's N2
  const nodes = [text('mine', { nodeLabel: 'N2' }), text('n', { nodeLabel: 'N1' }), text('agent', { nodeLabel: 'N2' })];
  const out = uniqueLabels(nodes, file);
  assert.deepEqual(out.map(n => n.nodeLabel), ['N3', 'N1', 'N2']);
});

test('a label the file gives a node that is not in the list is still not handed to another node', () => {
  const file = new Map([['gone', 'N2']]);
  const out = uniqueLabels([text('mine', { nodeLabel: 'N2' })], file);
  assert.equal(out[0].nodeLabel, 'N1');   // - the lowest free one, as every new label is
});

test('nothing to change: the same array comes back', () => {
  const nodes = [text('a', { nodeLabel: 'N1' }), text('b', { nodeLabel: 'N2' })];
  assert.equal(uniqueLabels(nodes, new Map([['a', 'N1']])), nodes);
});
