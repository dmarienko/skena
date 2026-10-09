// - run: npx esbuild src/webview/canvas/newFileNodes.ts --bundle --format=esm --outfile=tests/.build/newFileNodes.mjs && node --test tests/new-file-nodes.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { newFileNodeUris } from './.build/newFileNodes.mjs';

// - the React Flow node shape CanvasView keeps: the canvas node rides in `data`
const flow = (id, extra) => ({ id, type: extra.type, position: { x: 0, y: 0 }, data: { id, ...extra } });
const file = (id, uri) => flow(id, { type: 'file', file: uri });
const text = id => flow(id, { type: 'text', text: 'x' });

test('a file node whose id was not in the previous list gives its uri', () => {
  const before = [file('a', 'vault://crtx/a.md'), text('t')];
  const after  = [...before, file('m4', 'vault://crtx/knowledge/residual-books-algorithm-2026-10-09.md')];
  assert.deepEqual(newFileNodeUris(before, after), ['vault://crtx/knowledge/residual-books-algorithm-2026-10-09.md']);
});

test('a file node removed and added again under a new id gives its uri, though the uri was shown before', () => {
  const before = [file('m4', 'vault://crtx/r.md')];
  const gone   = [];
  const back   = [file('m4-new', 'vault://crtx/r.md')];
  assert.deepEqual(newFileNodeUris(before, gone), []);
  assert.deepEqual(newFileNodeUris(gone, back), ['vault://crtx/r.md']);
});

test('nodes kept from the previous list give nothing, even when they moved or changed', () => {
  const before = [file('a', 'vault://crtx/a.md'), file('b', '../b.md')];
  const after  = [{ ...before[0], position: { x: 40, y: 40 } }, { ...before[1], hidden: true }];
  assert.deepEqual(newFileNodeUris(before, after), []);
});

test('new nodes that are not file nodes give nothing', () => {
  assert.deepEqual(newFileNodeUris([], [text('t'), flow('c', { type: 'code', code: '' }), flow('l', { type: 'link', url: 'https://x' })]), []);
});

test('several new file nodes give their uris in list order', () => {
  const after = [file('p1', './x.md'), text('t'), file('p2', 'vault://crtx/y.md')];
  assert.deepEqual(newFileNodeUris([text('t')], after), ['./x.md', 'vault://crtx/y.md']);
});
