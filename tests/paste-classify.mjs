// tests/paste-classify.mjs
// - behavioral tests for the paste clipboard classifier.
// - run: npx esbuild src/webview/canvas/paste-classify.ts --bundle --format=esm --outfile=tests/.build/paste-classify.mjs && node --test tests/paste-classify.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyClipboard } from './.build/paste-classify.mjs';

const base = { hasImage: false, html: '', uriList: '', text: '', yySnapshot: null };

test('image beats everything', () => {
  const a = classifyClipboard({ ...base, hasImage: true, html: '<b>x</b>', uriList: 'file:///a', text: 'hi' });
  assert.equal(a.kind, 'cell-image');
});

test('html beats uri-list and text', () => {
  const a = classifyClipboard({ ...base, html: '<table><tr><td>1</td></tr></table>', uriList: 'file:///a', text: '1' });
  assert.equal(a.kind, 'cell-html');
  assert.match(a.html, /<table>/);
});

test('browser-URL guard: html flavor + single-line URL plain text -> link', () => {
  const a = classifyClipboard({ ...base, html: '<a href="https://x.io">x</a>', text: 'https://x.io/page' });
  assert.deepEqual(a, { kind: 'link', url: 'https://x.io/page' });
});

test('uri-list -> files, comment lines stripped', () => {
  const a = classifyClipboard({ ...base, uriList: '# comment\r\nfile:///a.md\r\nfile:///b.py\r\n' });
  assert.deepEqual(a, { kind: 'files', uris: ['file:///a.md', 'file:///b.py'] });
});

test('text equal to yy snapshot -> internal paste', () => {
  const a = classifyClipboard({ ...base, text: 'copied nodes', yySnapshot: 'copied nodes' });
  assert.equal(a.kind, 'internal');
});

test('text differing from yy snapshot -> content paste', () => {
  const a = classifyClipboard({ ...base, text: 'newer external copy', yySnapshot: 'copied nodes' });
  assert.deepEqual(a, { kind: 'text', text: 'newer external copy' });
});

test('single-line http(s) URL -> link, whitespace trimmed', () => {
  assert.deepEqual(classifyClipboard({ ...base, text: '  https://ex.com/a?b=1 \n' }), { kind: 'link', url: 'https://ex.com/a?b=1' });
  assert.equal(classifyClipboard({ ...base, text: 'http://ex.com' }).kind, 'link');
});

test('multi-line text containing a URL -> text node', () => {
  const a = classifyClipboard({ ...base, text: 'see this:\nhttps://ex.com' });
  assert.equal(a.kind, 'text');
});

test('single-line file:// or absolute or ~/ path -> verify-path', () => {
  assert.deepEqual(classifyClipboard({ ...base, text: 'file:///home/u/x.md' }), { kind: 'verify-path', raw: 'file:///home/u/x.md' });
  assert.deepEqual(classifyClipboard({ ...base, text: '/home/u/x.md' }),        { kind: 'verify-path', raw: '/home/u/x.md' });
  assert.deepEqual(classifyClipboard({ ...base, text: '~/docs/x.md' }),         { kind: 'verify-path', raw: '~/docs/x.md' });
});

test('single-line path with spaces -> verify-path (host existence check is the guard)', () => {
  assert.deepEqual(classifyClipboard({ ...base, text: '/home/u/My Docs/x.md' }), { kind: 'verify-path', raw: '/home/u/My Docs/x.md' });
});

test('figure JSON (data + layout) -> cell-plotly', () => {
  const j = JSON.stringify({ data: [{ type: 'scatter', y: [1, 2] }], layout: { title: 'x' } });
  assert.deepEqual(classifyClipboard({ ...base, text: j }), { kind: 'cell-plotly', json: j });
});

test('JSON without a data array -> text node', () => {
  const j = JSON.stringify({ foo: 1, layout: {} });
  assert.equal(classifyClipboard({ ...base, text: j }).kind, 'text');
});

test('malformed leading-brace text -> text node', () => {
  assert.equal(classifyClipboard({ ...base, text: '{ not json' }).kind, 'text');
});

test('figure JSON equal to yy snapshot -> internal (yy still wins)', () => {
  const j = JSON.stringify({ data: [{ y: [1] }], layout: {} });
  assert.equal(classifyClipboard({ ...base, text: j, yySnapshot: j }).kind, 'internal');
});

test('FigureWidget repr -> figure-repr', () => {
  const r = "FigureWidget({\n  'data': [{'type': 'candlestick'}],\n  'layout': {}\n})";
  assert.equal(classifyClipboard({ ...base, text: r }).kind, 'figure-repr');
});

test('go.Figure repr -> figure-repr', () => {
  assert.equal(classifyClipboard({ ...base, text: "go.Figure({'data': []})" }).kind, 'figure-repr');
});

test('bare Figure({...}) repr -> figure-repr', () => {
  assert.equal(classifyClipboard({ ...base, text: "Figure({'data': [], 'layout': {}})" }).kind, 'figure-repr');
});

test('valid figure JSON still -> cell-plotly (not figure-repr)', () => {
  const j = JSON.stringify({ data: [{ y: [1] }], layout: {} });
  assert.equal(classifyClipboard({ ...base, text: j }).kind, 'cell-plotly');
});

test('figure-repr carries the original text verbatim (untrimmed)', () => {
  const r = "\n  FigureWidget({'data': [1,2,3]})\n";
  const a = classifyClipboard({ ...base, text: r });
  assert.equal(a.text, r);   // - original, not trimmed
});

// - a realistic plotly to_html snippet; note the trace name contains `]` and `}` to test string-safe bracket matching
const plotlyHtml =
  '<div><div id="abc" class="plotly-graph-div" style="height:400px;"></div>' +
  '<script type="text/javascript">require(["plotly"], function(Plotly){ ' +
  'Plotly.newPlot("abc", [{"type":"scatter","y":[1,2,3],"name":"a]b}c"}], {"title":{"text":"t"}}, {"responsive":true}) ' +
  '}); </script></div>';

test('pasted plotly HTML (text flavor) -> cell-plotly with extracted data+layout', () => {
  const a = classifyClipboard({ ...base, text: plotlyHtml });
  assert.equal(a.kind, 'cell-plotly');
  const fig = JSON.parse(a.json);
  assert.equal(fig.data[0].type, 'scatter');
  assert.deepEqual(fig.data[0].y, [1, 2, 3]);
  assert.equal(fig.data[0].name, 'a]b}c');   // - string with brackets survived
  assert.equal(fig.layout.title.text, 't');
});

test('pasted plotly HTML on the html flavor -> cell-plotly (not cell-html)', () => {
  const a = classifyClipboard({ ...base, html: plotlyHtml, text: 'ignored' });
  assert.equal(a.kind, 'cell-plotly');
  assert.deepEqual(JSON.parse(a.json).data[0].y, [1, 2, 3]);
});

test('HTML without Plotly.newPlot on html flavor -> cell-html (unchanged)', () => {
  const a = classifyClipboard({ ...base, html: '<table><tr><td>1</td></tr></table>' });
  assert.equal(a.kind, 'cell-html');
});

test('text containing Plotly.newPlot but malformed (unbalanced) -> text node', () => {
  const a = classifyClipboard({ ...base, text: 'Plotly.newPlot("x", [{"y":[1,2,3]' });
  assert.equal(a.kind, 'text');
});

test('plotly HTML equal to yy snapshot -> internal (yy still wins)', () => {
  const a = classifyClipboard({ ...base, text: plotlyHtml, yySnapshot: plotlyHtml });
  assert.equal(a.kind, 'internal');
});

test('plain multi-line text -> text node, empty -> none', () => {
  assert.equal(classifyClipboard({ ...base, text: 'line1\nline2' }).kind, 'text');
  assert.equal(classifyClipboard(base).kind, 'none');
  assert.equal(classifyClipboard({ ...base, text: '   ' }).kind, 'none');
});
