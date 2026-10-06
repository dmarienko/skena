// - run: npx esbuild src/shared/exportLayout.ts --bundle --format=esm --outfile=tests/.build/exportLayout.mjs && node --test tests/export-layout.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EXPORT_MARGIN, exportLayout, pageBox } from './.build/exportLayout.mjs';

const text = (id, x, y, extra = {}) => ({ id, type: 'text', text: id, x, y, width: 700, height: 300, ...extra });

// - section a is folded over n1, which keeps the y it had before the fold; section b moved up to 100
//   with n2 when a folded. A group and an edge to it are in the file too.
function foldedCanvas() {
  return {
    nodes: [
      text('n1', 0, 300, { nodeLabel: 'N1' }),
      text('n2', 0, 150),
      { id: 'g1', type: 'group', x: -50, y: -50, width: 900, height: 900, label: 'old group' },
    ],
    edges: [
      { id: 'e1', fromNode: 'n1', fromSide: 'bottom', toNode: 'n2', toSide: 'top' },
      { id: 'e2', fromNode: 'n2', toNode: 'g1' },
    ],
    metadata: { sections: [{ id: 'a', y: 0, createdAt: 1, title: 'A', folded: ['n1'] }, { id: 'b', y: 100, createdAt: 2 }] },
  };
}

test('1. a folded section is drawn unfolded: its members keep their place, the sections below move down', () => {
  const l = exportLayout(foldedCanvas(), 0);
  const byId = Object.fromEntries(l.nodes.map(n => [n.id, n]));
  assert.equal(byId.n1.y, 300);
  // - a grows to 800 (its minimum height), so b moves from 100 to 800 and n2 by the same 700
  assert.equal(byId.n2.y, 850);
  assert.deepEqual(l.lanes.map(s => [s.id, s.label, s.top, s.bottom, s.folded]), [['a', 'S1', 0, 800, undefined], ['b', 'S2', 800, 1250, undefined]]);
  assert.deepEqual(l.lanes.map(s => s.memberIds), [['n1'], ['n2']]);
  assert.deepEqual(l.foldedLaneIds, ['a']);
});

test('2. groups and the edges that touch them are left out; every node has a label', () => {
  const l = exportLayout(foldedCanvas(), 0);
  assert.deepEqual(l.nodes.map(n => n.id), ['n1', 'n2']);
  assert.deepEqual(l.edges.map(e => e.id), ['e1']);
  assert.deepEqual(l.nodes.map(n => n.nodeLabel), ['N1', 'N2']);
});

test('3. the canvas passed in is not changed', () => {
  const c = foldedCanvas();
  const before = JSON.stringify(c);
  exportLayout(c, 0);
  assert.equal(JSON.stringify(c), before);
});

test('4. a canvas without sections gets no section', () => {
  const l = exportLayout({ nodes: [text('n1', 0, 0)], edges: [] }, 0);
  assert.deepEqual(l.lanes, []);
  assert.deepEqual(l.foldedLaneIds, []);
});

test('5. the page box holds the nodes, the section ranges and the extra points, plus the margin', () => {
  const l = exportLayout(foldedCanvas(), 0);
  assert.deepEqual(pageBox(l, [[-100, 400]]), { left: -140, top: -40, width: 880, height: 1330 });
  assert.equal(EXPORT_MARGIN, 40);
});

test('6. an empty canvas is a page of margin only', () => {
  assert.deepEqual(pageBox({ nodes: [], lanes: [] }, [], 40), { left: -40, top: -40, width: 80, height: 80 });
});
