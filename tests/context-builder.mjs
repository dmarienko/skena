// - run: npx esbuild src/extension/context-builder.ts --bundle --platform=node --format=esm --outfile=tests/.build/contextBuilder.mjs && node --test tests/context-builder.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildCanvasContext } from './.build/contextBuilder.mjs';

const code = (id, label, src, language) => ({ id, type: 'code', code: src, ...(language ? { language } : {}), nodeLabel: label, x: 0, y: 0, width: 700, height: 100 });

test('a focused code cell shows its language and source', async () => {
  const canvas = { nodes: [code('c1', 'E1', 'df = load()\ndf.head()')], edges: [] };
  const ctx = await buildCanvasContext('/w/a.canvas', canvas, 'c1');
  assert.ok(ctx.includes('CURRENTLY FOCUSED NODE:\n[E1] (code) [code:python]\n\ndf = load()\ndf.head()'));
});

test('a code cell connected to the focused node shows its source, cut at 600 chars', async () => {
  const canvas = {
    nodes: [
      { id: 'n1', type: 'text', text: 'note', nodeLabel: 'N1', x: 0, y: 0, width: 400, height: 300 },
      code('c2', 'E2', 'y'.repeat(601), 'julia'),
    ],
    edges: [{ id: 'e1', fromNode: 'n1', toNode: 'c2' }],
  };
  const ctx = await buildCanvasContext('/w/a.canvas', canvas, 'n1');
  assert.ok(ctx.includes(`### [E2] (code) [code:julia]\n${'y'.repeat(600)}\n…[truncated]`));
});

test('the node list names a code cell by its language', async () => {
  const canvas = { nodes: [code('c3', 'E3', 'pass')], edges: [] };
  const ctx = await buildCanvasContext('/w/a.canvas', canvas, null);
  assert.ok(ctx.includes('ALL CANVAS NODES:\n  [E3] (code) [code:python]'));
});
