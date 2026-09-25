// - run: npx esbuild src/webview/canvas/cardContent.ts --bundle --format=esm --outfile=tests/.build/cardContent.mjs && node --test tests/card-content.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cardContent, htmlLines, noteSnippet } from './.build/cardContent.mjs';

const base = { id: 'n', x: 0, y: 0, width: 400, height: 200 };

test('1. code: the first three non-empty lines, blank leading lines skipped', () => {
  const card = cardContent({ ...base, type: 'code', nodeLabel: 'E7', code: '\n\n   \nimport numpy as np\n\nx = 1\n    y = 2   \nz = 3' });
  assert.equal(card.label, 'E7');
  assert.equal(card.typeText, 'code · python');
  assert.deepEqual(card.body, { kind: 'code', lines: ['import numpy as np', 'x = 1', '    y = 2'], language: 'python' });
});

test('2. code: the default dark border is drawn lighter, a colour set on the node is kept', () => {
  assert.equal(cardContent({ ...base, type: 'code', code: 'x' }).border, '#3fb27f');
  assert.equal(cardContent({ ...base, type: 'code', code: 'x', accentColor: '#ff0000' }).border, '#ff0000');
  assert.equal(cardContent({ ...base, type: 'code', code: 'x', language: 'r' }).typeText, 'code · r');
});

test('3. note: the first heading in bold, then the next blocks as plain lines, a formula block kept whole', () => {
  const text = 'before the heading\n# Variation\n\nHow to find\n$$\n\\int_0^T x\\,dt\n$$\n- after the limit';
  const card = cardContent({ ...base, type: 'text', nodeLabel: 'N1', text });
  assert.equal(card.typeText, 'note');
  assert.equal(card.border, '#1f96bd');
  assert.deepEqual(card.body, { kind: 'markdown', text: '**Variation**\n\nHow to find\n\n$$\n\\int_0^T x\\,dt\n$$' });
});

test('4. note without a heading: its first three blocks, list and quote markers dropped', () => {
  assert.equal(noteSnippet('first\n\n- second\n> third\nfourth'), 'first\n\nsecond\n\nthird');
});

test('5. note: typst formulas stay as written, fenced code and rules are left out', () => {
  const text = '## T\n```python\n# not a heading\nx = 1\n```\n---\n%x^2%\n%%\nsum_(k=1) k\n%%';
  assert.equal(noteSnippet(text), '**T**\n\n%x^2%\n\n%%\nsum_(k=1) k\n%%');
});

test('6. file: the path, then the first heading once the preview has loaded the file', () => {
  const node = { ...base, type: 'file', nodeLabel: 'M1', file: 'Options/SC01_Continuous.md' };
  assert.deepEqual(cardContent(node).body, { kind: 'rows', rows: [{ text: 'Options/SC01_Continuous.md', style: 'path' }] });
  const card = cardContent(node, { fileText: '```\n# a comment\n```\n\n# Continuous processes\ntext' });
  assert.equal(card.typeText, 'file · md');
  assert.equal(card.border, '#de780b');
  assert.deepEqual(card.body.rows, [
    { text: 'Options/SC01_Continuous.md', style: 'path' },
    { text: 'Continuous processes', style: 'strong' },
  ]);
});

test('7. html output: the first lines of its text, tags removed, a table row on one line', () => {
  const html = '<style>.x { color: red }</style>\n<table>\n  <tr>\n    <th>a</th>\n    <th>b</th>\n  </tr>\n'
    + '  <tr><td>1</td><td>2 &amp; 3</td></tr>\n  <tr><td>4</td><td>5</td></tr>\n  <tr><td>6</td><td>7</td></tr>\n</table>';
  const card = cardContent({ ...base, type: 'cell', nodeLabel: 'C1', format: 'html', content: html }, { ownerLabel: 'E1' });
  assert.equal(card.typeText, 'output of E1');
  assert.deepEqual(card.body, { kind: 'rows', rows: [
    { text: 'a b', style: 'mono' }, { text: '1 2 & 3', style: 'mono' }, { text: '4 5', style: 'mono' },
  ] });
});

test('8. html output: a <pre> stream keeps its spacing and line breaks, its colour spans removed', () => {
  const html = '<pre class="skena-out-stream">   a  b\n<span style="color:red">0</span>  1  2\n\n1  3  4\n</pre>';
  assert.deepEqual(htmlLines(html), ['   a  b', '0  1  2', '1  3  4']);
});

test('9. markdown output: drawn as a note', () => {
  const card = cardContent({ ...base, type: 'cell', format: 'markdown', content: '# Result\nvalue 1' });
  assert.equal(card.typeText, 'cell · markdown');
  assert.deepEqual(card.body, { kind: 'markdown', text: '**Result**\n\nvalue 1' });
});

test('10. image output: the picture itself, to be fitted into the body', () => {
  const src = 'data:image/png;base64,iVBORw0KGgo=';
  const card = cardContent({ ...base, type: 'cell', format: 'image', content: src }, { ownerLabel: 'E3' });
  assert.equal(card.typeText, 'output of E3');
  assert.deepEqual(card.body, { kind: 'image', src });
});

test('11. plotly output: the word plot', () => {
  assert.deepEqual(
    cardContent({ ...base, type: 'cell', format: 'plotly', content: '{"data":[]}' }).body,
    { kind: 'rows', rows: [{ text: 'plot', style: 'plain' }] },
  );
});

test('12. knowledge: the title, then the source', () => {
  const card = cardContent({
    ...base, type: 'knowledge', nodeLabel: 'W1', server: 'crtx', uri: 'experiments/trinity-reversal.md',
    title: 'Trinity reversal', text: 'body', fetchedAt: '2026-09-25T00:00:00Z',
  });
  assert.equal(card.typeText, 'knowledge');
  assert.equal(card.border, '#3b9ad9');
  assert.deepEqual(card.body.rows, [
    { text: 'Trinity reversal', style: 'strong' },
    { text: 'experiments/trinity-reversal.md', style: 'path' },
  ]);
});

test('13. any other type: what its own header shows', () => {
  const link = cardContent({ ...base, type: 'link', url: 'https://example.com/a' });
  assert.equal(link.typeText, 'link');
  assert.deepEqual(link.body.rows, [{ text: 'https://example.com/a', style: 'path' }]);
  assert.deepEqual(
    cardContent({ ...base, type: 'portal', canvas: 'sub/Other.canvas', label: 'Other' }).body.rows,
    [{ text: 'Other', style: 'strong' }, { text: 'sub/Other.canvas', style: 'path' }],
  );
});
