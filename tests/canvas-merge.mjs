// - run: npx esbuild src/shared/canvasMerge.ts --bundle --format=esm --outfile=tests/.build/canvasMerge.mjs && node --test tests/canvas-merge.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { merge3, rebaseHistory } from './.build/canvasMerge.mjs';

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
  const base = canvas([code('a', { lastStatus: 'error' })]);
  const ours = canvas([code('a', { lastStatus: 'ok', outputNodeId: 'out' })]);   // - a run's result mirrored in the editor
  const theirs = canvas([code('a', { lastStatus: 'error', code: 'x = 2' })]);    // - the agent's code edit
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
