// - run: npx esbuild src/shared/exportLayout.ts --bundle --format=esm --outfile=tests/.build/exportLayout.mjs && npx esbuild src/extension/export/edges.ts --bundle --format=esm --outfile=tests/.build/exportEdges.mjs && node --test tests/export-edges.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { exportLayout } from './.build/exportLayout.mjs';
import { EDGE_WIDTH, exportEdges } from './.build/exportEdges.mjs';

const box = (id, type, x, y, extra = {}) => ({ id, type, x, y, width: 700, height: 300, ...extra });
const one = (canvas, id) => exportEdges(exportLayout(canvas, 0)).find(e => e.id === id);
const lanes = ys => ({ sections: ys.map((y, i) => ({ id: `s${i}`, y, createdAt: i })) });

test('1. an edge inside a section leaves and enters the middle of the sides it names', () => {
  const e = one({
    nodes: [box('a', 'text', 0, 0), box('b', 'text', 900, 0)],
    edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'uses' }],
    metadata: lanes([0]),
  }, 'e');
  assert.deepEqual(e.points[0], [700, 150]);
  assert.deepEqual(e.points[e.points.length - 1], [900, 150]);
  assert.ok(e.d.startsWith('M 700,150'));
  assert.equal(e.label, 'uses');
  assert.equal(e.labelAt[1], 150);
  assert.ok(e.labelAt[0] > 700 && e.labelAt[0] < 900);
});

test('2. colour: the edge colour wins, else the border colour of the node it leaves', () => {
  const canvas = {
    nodes: [box('a', 'text', 0, 0), box('b', 'text', 900, 0, { color: '4' }), box('c', 'text', 1800, 0)],
    edges: [
      { id: 'plain', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' },
      { id: 'set', fromNode: 'a', fromSide: 'bottom', toNode: 'c', toSide: 'bottom', color: '1', toEnd: 'none' },
      { id: 'accent', fromNode: 'b', fromSide: 'right', toNode: 'c', toSide: 'left' },
    ],
    metadata: lanes([0]),
  };
  const all = Object.fromEntries(exportEdges(exportLayout(canvas, 0)).map(e => [e.id, e]));
  assert.equal(all.plain.color, '#1f96bd');
  assert.equal(all.set.color, '#fb464c');
  assert.equal(all.accent.color, '#44cf6e');
  assert.equal(all.plain.arrow, true);
  assert.equal(all.set.arrow, false);
});

test('3. the link from a code cell to its output is dotted, other links are not', () => {
  const canvas = {
    nodes: [box('code', 'code', 0, 0, { code: 'x', outputNodeId: 'out' }), box('out', 'cell', 900, 0, { format: 'html', content: '' }), box('n', 'text', 0, 500)],
    edges: [
      { id: 'o', fromNode: 'code', fromSide: 'right', toNode: 'out', toSide: 'left' },
      { id: 'c', fromNode: 'code', fromSide: 'bottom', toNode: 'n', toSide: 'top' },
    ],
    metadata: lanes([0]),
  };
  const all = Object.fromEntries(exportEdges(exportLayout(canvas, 0)).map(e => [e.id, e]));
  assert.equal(all.o.dashed, true);
  assert.equal(all.c.dashed, false);
  assert.equal(all.o.color, '#02542e');
  assert.equal(EDGE_WIDTH, 1.8);
});

test('4. an edge between two sections is routed on its own, from side middle to side middle', () => {
  const e = one({
    nodes: [box('a', 'text', 0, 0), box('b', 'text', 0, 900)],
    edges: [{ id: 'x', fromNode: 'a', fromSide: 'bottom', toNode: 'b', toSide: 'top' }],
    metadata: lanes([0, 800]),
  }, 'x');
  assert.deepEqual(e.points[0], [350, 300]);
  assert.deepEqual(e.points[e.points.length - 1], [350, 900]);
  assert.equal(e.dashed, false);
});

test('5. a canvas with no stored section is routed in the section the canvas adds on open; an edge with no sides faces the other node', () => {
  const nodes = [box('a', 'text', 100, 0, { width: 300, height: 200 }), box('b', 'text', 1000, 300, { width: 300, height: 200 }), box('c', 'text', 500, 150, { width: 300, height: 200 })];
  const edges = [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' }, { id: 'f', fromNode: 'c', toNode: 'b' }];
  const routes = canvas => exportEdges(exportLayout(canvas, 0)).map(e => e.points);
  assert.deepEqual(routes({ nodes, edges: edges.slice(0, 1) }), [[[400, 100], [850, 100], [850, 400], [1000, 400]]]);
  assert.deepEqual(routes({ nodes, edges }), routes({ nodes, edges, metadata: lanes([0]) }));
  const e = one({ nodes: [box('a', 'text', 0, 0), box('b', 'text', 900, 0)], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] }, 'e');
  assert.deepEqual(e.points[0], [700, 150]);
  assert.deepEqual(e.points[e.points.length - 1], [900, 150]);
});

test('6. a colour from the file that is not a colour is not used: the node colour, else the default, take its place', () => {
  const canvas = {
    nodes: [box('a', 'text', 0, 0, { color: 'red;background:url(https://x.org/a.png)' }), box('b', 'text', 900, 0)],
    edges: [
      { id: 'bad', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', color: '#fff" onclick="x()' },
      { id: 'good', fromNode: 'b', fromSide: 'left', toNode: 'a', toSide: 'right', color: '3' },
    ],
    metadata: lanes([0]),
  };
  const all = Object.fromEntries(exportEdges(exportLayout(canvas, 0)).map(e => [e.id, e]));
  assert.equal(all.bad.color, '#1f96bd');
  assert.equal(all.good.color, '#e0de71');
});
