// - run: npx esbuild src/shared/kernelBinding.ts --bundle --format=esm --outfile=tests/.build/kernel-upstream.mjs && node --test tests/kernel-upstream.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveUpstreamChain, upstreamCellsForRun } from './.build/kernel-upstream.mjs';

const isKernel = id => id === 'K1';
const isCode = id => id.startsWith('E');

test('linear chain K1-E1-E2-E3 → upstream of E3 is [E1,E2]', () => {
  const edges = [{fromNode:'K1',toNode:'E1'},{fromNode:'E1',toNode:'E2'},{fromNode:'E2',toNode:'E3'}];
  assert.deepEqual(resolveUpstreamChain('E3', edges, isKernel, isCode), ['E1','E2']);
});

test('edge direction ignored (drawn backwards)', () => {
  const edges = [{fromNode:'E1',toNode:'K1'},{fromNode:'E2',toNode:'E1'},{fromNode:'E3',toNode:'E2'}];
  assert.deepEqual(resolveUpstreamChain('E3', edges, isKernel, isCode), ['E1','E2']);
});

test('sibling branch is not included', () => {
  // - K1-E1-E2-E3 and K1-E1-E4 ; upstream of E3 must NOT include E4
  const edges = [{fromNode:'K1',toNode:'E1'},{fromNode:'E1',toNode:'E2'},{fromNode:'E2',toNode:'E3'},{fromNode:'E1',toNode:'E4'}];
  assert.deepEqual(resolveUpstreamChain('E3', edges, isKernel, isCode), ['E1','E2']);
});

test('running the first cell has no upstream', () => {
  const edges = [{fromNode:'K1',toNode:'E1'},{fromNode:'E1',toNode:'E2'}];
  assert.deepEqual(resolveUpstreamChain('E1', edges, isKernel, isCode), []);
});

test('diamond: E4 depends on E2 and E3, both on E1', () => {
  const edges = [{fromNode:'K1',toNode:'E1'},{fromNode:'E1',toNode:'E2'},{fromNode:'E1',toNode:'E3'},{fromNode:'E2',toNode:'E4'},{fromNode:'E3',toNode:'E4'}];
  const r = resolveUpstreamChain('E4', edges, isKernel, isCode);
  assert.equal(r[0], 'E1');                       // - E1 first (closest to kernel)
  assert.deepEqual([...r].sort(), ['E1','E2','E3']);
});

test('no kernel → empty', () => {
  const edges = [{fromNode:'E1',toNode:'E2'}];
  assert.deepEqual(resolveUpstreamChain('E2', edges, isKernel, isCode), []);
});

import { resolveKernelCellsInCanvas } from './.build/kernel-upstream.mjs';

const kn   = id => ({ id, type: 'kernel', y: 0 });
const cell = id => ({ id, type: 'code', y: 0 });

test('resolveKernelCellsInCanvas finds all cells in the chain', () => {
  const edges = [{fromNode:'K1',toNode:'E1'},{fromNode:'E1',toNode:'E2'},{fromNode:'E2',toNode:'E3'}];
  const nodes = [kn('K1'), cell('E1'), cell('E2'), cell('E3')];
  assert.deepEqual(resolveKernelCellsInCanvas('K1', { nodes, edges, sections: undefined }).sort(), ['E1','E2','E3']);
});

test('resolveKernelCellsInCanvas does not cross into another kernel', () => {
  // - K1-E1-E2 ; K2-E3 ; E2 and E3 NOT connected → K1 owns only E1,E2
  const edges = [{fromNode:'K1',toNode:'E1'},{fromNode:'E1',toNode:'E2'},{fromNode:'K2',toNode:'E3'}];
  const nodes = [kn('K1'), kn('K2'), cell('E1'), cell('E2'), cell('E3')];
  assert.deepEqual(resolveKernelCellsInCanvas('K1', { nodes, edges, sections: undefined }).sort(), ['E1','E2']);
});

const pcell = (id, y, x = 0) => ({ id, type: 'code', y, x });
test('upstreamCellsForRun: with an edge path to a kernel node the edge chain is used, as before', () => {
  const c = { nodes: [{ id: 'K1', type: 'kernel', y: 0, x: 0 }, pcell('E1', 900), pcell('E2', 0)], edges: [{ fromNode: 'K1', toNode: 'E1' }, { fromNode: 'E1', toNode: 'E2' }], sections: [], kernels: [] };
  assert.deepEqual(upstreamCellsForRun('E2', c), ['E1']);   // - edge order, even though E1 sits lower
});
test('upstreamCellsForRun: section-bound chain → the connected code cells above the target, by (y, x)', () => {
  const c = {
    nodes: [pcell('E1', 0), pcell('E2', 300, 800), pcell('E3', 300, 0), pcell('E4', 900), pcell('X', 100), { id: 'T', type: 'text', y: 50, x: 0 }],
    edges: [{ fromNode: 'E1', toNode: 'E3' }, { fromNode: 'E3', toNode: 'E2' }, { fromNode: 'E2', toNode: 'E4' }, { fromNode: 'E1', toNode: 'T' }],
    sections: [{ id: 'a', y: 0, createdAt: 1, kernelId: 'k-1' }], kernels: [{ id: 'k-1' }],
  };
  assert.deepEqual(upstreamCellsForRun('E4', c), ['E1', 'E3', 'E2']);   // - X is not connected; T is not code; E3 (x 0) before E2 (x 800)
  assert.deepEqual(upstreamCellsForRun('E1', c), []);
});
test('upstreamCellsForRun: no kernel at all → []', () => {
  assert.deepEqual(upstreamCellsForRun('E2', { nodes: [pcell('E1', 0), pcell('E2', 100)], edges: [{ fromNode: 'E1', toNode: 'E2' }], sections: [], kernels: [] }), []);
});
test('upstreamCellsForRun: members resolving to another kernel, or to none, are left out', () => {
  const c = {
    nodes: [pcell('A', 0), pcell('B', 300), pcell('C', 600), pcell('D', 900)],
    edges: [{ fromNode: 'A', toNode: 'B' }, { fromNode: 'B', toNode: 'C' }, { fromNode: 'C', toNode: 'D' }],
    sections: [{ id: 's1', y: 0, createdAt: 1, kernelId: 'k-1' }, { id: 's2', y: 300, createdAt: 1 }, { id: 's3', y: 600, createdAt: 1, kernelId: 'k-2' }],
    kernels: [{ id: 'k-1' }, { id: 'k-2' }],
  };
  assert.deepEqual(upstreamCellsForRun('D', c), ['C']);   // - A is on k-1, B has no kernel: neither runs before D
});
