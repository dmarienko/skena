// - run: npx esbuild src/shared/outputLink.ts --bundle --format=esm --outfile=tests/.build/outputLink.mjs && node --test tests/output-link.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ownedOutputId, copyNode } from './.build/outputLink.mjs';

const code = (id, outputNodeId) => ({ id, type: 'code', ...(outputNodeId ? { outputNodeId } : {}) });
const cell = id => ({ id, type: 'cell' });

test('a cell with an edge to the output owns it, even when another cell names it too', () => {
  const nodes = [code('E11', 'C9'), code('E14', 'C9'), cell('C9')];
  const edges = [{ fromNode: 'E11', toNode: 'C9' }];
  assert.equal(ownedOutputId(nodes, edges, nodes[0]), 'C9');
});

test('a cell that names an output no other code cell names owns it without an edge', () => {
  const nodes = [code('E1', 'C1'), cell('C1')];
  assert.equal(ownedOutputId(nodes, [], nodes[0]), 'C1');
});

test('a cell without an edge does not own an output another code cell names', () => {
  const nodes = [code('E11', 'C9'), code('E14', 'C9'), cell('C9')];
  const edges = [{ fromNode: 'E11', toNode: 'C9' }];
  assert.equal(ownedOutputId(nodes, edges, nodes[1]), undefined);
  // - an edge the other way round is not this cell's link to its output
  assert.equal(ownedOutputId(nodes, [...edges, { fromNode: 'C9', toNode: 'E14' }], nodes[1]), undefined);
});

test('an id naming no node, or a node that is not a cell, is no output', () => {
  assert.equal(ownedOutputId([code('E1', 'gone')], [{ fromNode: 'E1', toNode: 'gone' }], code('E1', 'gone')), undefined);
  const nodes = [code('E1', 'N1'), { id: 'N1', type: 'text' }];
  assert.equal(ownedOutputId(nodes, [{ fromNode: 'E1', toNode: 'N1' }], nodes[0]), undefined);
  assert.equal(ownedOutputId([code('E1')], [], code('E1')), undefined);
});

test('a code cell copied with its output links to the output\'s copy and loses its run status', () => {
  const src = { ...code('E11', 'C9'), code: 'x = 1', lastStatus: 'ok', lastRun: 5 };
  const ids = new Map([['E11', 'p-0'], ['C9', 'p-1']]);
  assert.deepEqual(copyNode(src, ids), { id: 'p-0', type: 'code', code: 'x = 1', outputNodeId: 'p-1' });
  assert.deepEqual(copyNode({ ...cell('C9'), content: 'r' }, ids), { id: 'p-1', type: 'cell', content: 'r' });
  // - the source node is left as it was
  assert.equal(src.outputNodeId, 'C9');
  assert.equal(src.lastStatus, 'ok');
});

test('a code cell copied without its output has no output link and no run status', () => {
  const src = { ...code('E11', 'C9'), code: 'x = 1', lastStatus: 'error', lastRun: 5 };
  const copy = copyNode(src, new Map([['E11', 'p-0']]));
  assert.deepEqual(copy, { id: 'p-0', type: 'code', code: 'x = 1' });
  assert.equal('outputNodeId' in copy, false);
  assert.equal('lastStatus' in copy, false);
});
