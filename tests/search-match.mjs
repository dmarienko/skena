// tests/search-match.mjs
// - guards: canvas search must NOT match inside base64 images / plotly JSON, but must
// -   still find those nodes by label and match real text content.
// - run: npx esbuild src/webview/canvas/searchMatch.ts --bundle --format=esm --outfile=tests/.build/searchMatch.mjs && node --test tests/search-match.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matches, nodeContent, parseQuery } from './.build/searchMatch.mjs';

const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEmatchmeAAAA';   // - contains "matchme"

test('image cell: base64 content is NOT searchable', () => {
  const n = { type: 'cell', format: 'image', content: `data:image/png;base64,${B64}`, nodeLabel: 'C1' };
  assert.equal(matches(n, null, 'matchme'), false);
  assert.equal(nodeContent(n), '');
});

test('image cell: still findable by its label', () => {
  const n = { type: 'cell', format: 'image', content: `data:image/png;base64,${B64}`, nodeLabel: 'C1' };
  assert.equal(matches(n, null, 'c1'), true);
});

test('plotly cell: figure JSON is NOT searchable', () => {
  const n = { type: 'cell', format: 'plotly', content: '{"data":[{"name":"matchme"}],"layout":{}}', nodeLabel: 'C2' };
  assert.equal(matches(n, null, 'matchme'), false);
});

test('markdown cell: real text IS searchable', () => {
  const n = { type: 'cell', format: 'markdown', content: 'hello matchme world', nodeLabel: 'C3' };
  assert.equal(matches(n, null, 'matchme'), true);
});

test('text node with a pasted base64 image: image blob NOT searchable, prose still is', () => {
  const n = { type: 'text', text: `notes about alpha\n\n![](data:image/png;base64,${B64})`, nodeLabel: 'N1' };
  assert.equal(matches(n, null, 'matchme'), false);   // - inside the base64
  assert.equal(matches(n, null, 'alpha'), true);      // - real prose
});

test('parseQuery still splits vault prefix', () => {
  assert.deepEqual(parseQuery('kb:momentum'), { vault: 'kb', text: 'momentum' });
  assert.deepEqual(parseQuery('momentum'), { vault: null, text: 'momentum' });
});

test('knowledge node: the cached text and the title are searchable', () => {
  const n = { type: 'knowledge', server: 'crtx', uri: 'crtx://crtx/log.md#h', title: 'log.md › h', text: 'notes about alpha', nodeLabel: 'K1' };
  assert.equal(matches(n, null, 'alpha'), true);
  assert.equal(matches(n, null, 'log.md'), true);
  assert.equal(matches(n, null, 'nothinghere'), false);
});
