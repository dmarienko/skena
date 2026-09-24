// - run: npx esbuild src/shared/kernelBinding.ts --bundle --format=esm --outfile=tests/.build/kernel-binding.mjs && node --test tests/kernel-binding.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveBoundKernel, resolveCellKernel, resolveKernelCellsInCanvas, makeCellKernelResolver, cellKernelView, kernelById } from './.build/kernel-binding.mjs';

const isKernel = (id) => id.startsWith('k');

test('finds kernel on an edge from the code node', () => {
  const edges = [{ fromNode: 'c1', toNode: 'k1' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), 'k1');
});

test('finds kernel on an edge into the code node (either direction)', () => {
  const edges = [{ fromNode: 'k2', toNode: 'c1' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), 'k2');
});

test('returns null when no adjacent kernel', () => {
  const edges = [{ fromNode: 'c1', toNode: 'c2' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), null);
});

test('ignores edges not touching the code node', () => {
  const edges = [{ fromNode: 'c9', toNode: 'k1' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), null);
});

test('resolves a kernel transitively through a chain of cells', () => {
  // - c2 → c1 → k1: c2 shares c1's kernel
  const edges = [{ fromNode: 'c2', toNode: 'c1' }, { fromNode: 'c1', toNode: 'k1' }];
  assert.equal(resolveBoundKernel('c2', edges, isKernel), 'k1');
});

test('returns null for a chain that reaches no kernel', () => {
  const edges = [{ fromNode: 'c3', toNode: 'c2' }, { fromNode: 'c2', toNode: 'c1' }];
  assert.equal(resolveBoundKernel('c3', edges, isKernel), null);
});

test('terminates on a cycle without a kernel', () => {
  const edges = [{ fromNode: 'c1', toNode: 'c2' }, { fromNode: 'c2', toNode: 'c1' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), null);
});

const kn   = (id) => ({ id, type: 'kernel', y: 0 });
const cell = (id, y) => ({ id, type: 'code', y });
const edge = (a, b) => ({ fromNode: a, toNode: b });
const lane = (id, y, kernelId) => ({ id, y, createdAt: 1, ...(kernelId ? { kernelId } : {}) });

test('resolveCellKernel: an edge-bound kernel wins over the section kernel', () => {
  const c = { nodes: [kn('K1'), kn('K2'), cell('E1', 0)], edges: [edge('E1', 'K2')], sections: [lane('a', 0, 'K1')] };
  assert.equal(resolveCellKernel('E1', c), 'K2');
});

test('resolveCellKernel: no edge → the kernel of the section owning the cell top edge', () => {
  const c = { nodes: [kn('K1'), cell('E1', 500), cell('E2', 1000)], edges: [], sections: [lane('a', 0, 'K1'), lane('b', 1000)] };
  assert.equal(resolveCellKernel('E1', c), 'K1');
  assert.equal(resolveCellKernel('E2', c), null);   // - lane b is unbound
});

test('resolveCellKernel: a dangling section kernelId is unbound', () => {
  const c = { nodes: [cell('E1', 0)], edges: [], sections: [lane('a', 0, 'gone')] };
  assert.equal(resolveCellKernel('E1', c), null);
});

test('resolveCellKernel: without sections only the edge rule applies', () => {
  assert.equal(resolveCellKernel('E1', { nodes: [kn('K1'), cell('E1', 0)], edges: [], sections: undefined }), null);
  assert.equal(resolveCellKernel('E1', { nodes: [kn('K1'), cell('E1', 0)], edges: [edge('K1', 'E1')], sections: [] }), 'K1');
});

test('resolveKernelCellsInCanvas: edge-bound and section-bound cells, edge wins per cell', () => {
  const c = {
    nodes: [kn('K1'), kn('K2'), cell('E1', 0), cell('E2', 100), cell('E3', 1000)],
    edges: [edge('E1', 'K1'), edge('E3', 'K2')],
    sections: [lane('a', 0, 'K1'), lane('b', 1000, 'K1')],
  };
  assert.deepEqual(resolveKernelCellsInCanvas('K1', c).sort(), ['E1', 'E2']);
  assert.deepEqual(resolveKernelCellsInCanvas('K2', c), ['E3']);
});

test('resolveCellKernel: a cell above the first lane clamps into it', () => {
  const c = { nodes: [kn('K1'), cell('E1', -500)], edges: [], sections: [lane('a', 0, 'K1')] };
  assert.equal(resolveCellKernel('E1', c), 'K1');
});

test('resolveCellKernel: unsorted sections give the same answer as sorted ones', () => {
  const c = { nodes: [kn('K1'), kn('K2'), cell('E1', 1200)], edges: [], sections: [lane('b', 1000, 'K2'), lane('a', 0, 'K1')] };
  assert.equal(resolveCellKernel('E1', c), 'K2');
});

test('resolveCellKernel: a section kernelId naming a non-kernel node is unbound', () => {
  const c = { nodes: [cell('E1', 0), cell('E2', 100)], edges: [], sections: [lane('a', 0, 'E2')] };
  assert.equal(resolveCellKernel('E1', c), null);
});

test('cellKernelView takes sections from metadata; makeCellKernelResolver answers per cell', () => {
  const canvas = { nodes: [kn('K1'), cell('E1', 0), cell('E2', 1000)], edges: [], metadata: { sections: [lane('a', 0, 'K1'), lane('b', 1000)] } };
  const resolve = makeCellKernelResolver(cellKernelView(canvas));
  assert.equal(resolve('E1'), 'K1');
  assert.equal(resolve('E2'), null);
  assert.equal(cellKernelView({ nodes: [], edges: [] }).sections, undefined);
});

test('resolveCellKernel: a pinned (folded) cell resolves through its own section, not by y', () => {
  const c = { nodes: [kn('K1'), kn('K2'), cell('E1', 5000)], edges: [], sections: [{ id: 'a', y: 0, createdAt: 1, kernelId: 'K1', folded: ['E1'] }, lane('b', 100, 'K2')] };
  assert.equal(resolveCellKernel('E1', c), 'K1');
});

test('resolveCellKernel: a section bound to a kernel RECORD resolves to it', () => {
  const c = { nodes: [cell('E1', 0)], edges: [], sections: [lane('a', 0, 'k-1')], kernels: [{ id: 'k-1' }] };
  assert.equal(resolveCellKernel('E1', c), 'k-1');
});

test('kernelById: record first, then kernel node, else null; returns the live object', () => {
  const rec = { id: 'k-1', server: 's', colorIndex: 0 };
  const node = { id: 'K1', type: 'kernel', server: 's', x: 0, y: 0, width: 1, height: 1 };
  const canvas = { nodes: [node], edges: [], metadata: { kernels: [rec] } };
  assert.equal(kernelById(canvas, 'k-1'), rec);
  assert.equal(kernelById(canvas, 'K1'), node);
  assert.equal(kernelById(canvas, 'nope'), null);
  assert.equal(kernelById({ nodes: [node], edges: [] }, 'k-1'), null);
});
