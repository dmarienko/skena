// - run: npx esbuild src/shared/plotlyParts.ts --bundle --format=esm --platform=node --outfile=tests/.build/plotlyParts.mjs && npx esbuild src/webview/canvas/searchMatch.ts --bundle --format=esm --outfile=tests/.build/searchMatch.mjs && npx esbuild src/shared/outputCap.ts --bundle --format=esm --platform=node --outfile=tests/.build/outputCap.mjs && node --test tests/plotly-parts.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { plotlyPartHtml, plotlyPartFigures, plotlyPartFigure, replacePlotlyParts } from './.build/plotlyParts.mjs';
import { matches } from './.build/searchMatch.mjs';
import { capOutputHtml, MAX_OUTPUT_HTML_BYTES } from './.build/outputCap.mjs';

const fig = (title, n = 3) => JSON.stringify({ data: [{ type: 'scatter', y: Array.from({ length: n }, (_, i) => i) }], layout: { title: { text: title } } });

test('figures come back from the output html in order, with non-ASCII text intact', () => {
  const html = ['<table><tr><td>1</td></tr></table>', plotlyPartHtml(fig('PnL · 10min')), '<pre>x</pre>', plotlyPartHtml(fig('Δ exposure'))].join('\n');
  assert.deepEqual(plotlyPartFigures(html), [fig('PnL · 10min'), fig('Δ exposure')]);
});

test('a placeholder reads back through its data-figure attribute; anything else is not a figure', () => {
  const part = plotlyPartHtml(fig('one'));
  const attr = /data-figure="([^"]*)"/.exec(part)[1];
  assert.equal(plotlyPartFigure(attr), fig('one'));
  assert.equal(plotlyPartFigure('data:image/png;base64,AAAA'), null);
  assert.equal(plotlyPartFigure(null), null);
});

test('replacing placeholders keeps the html around them', () => {
  const html = `<b>a</b>${plotlyPartHtml(fig('one'))}<i>b</i>`;
  assert.equal(replacePlotlyParts(html, (json, k) => `[fig ${k}: ${JSON.parse(json).layout.title.text}]`), '<b>a</b>[fig 0: one]<i>b</i>');
});

test('the figure JSON is not searchable in an output cell', () => {
  const node = { id: 'c', type: 'cell', format: 'html', nodeLabel: 'C1', content: `<p>executions</p>${plotlyPartHtml(fig('secretword'))}` };
  assert.equal(matches(node, null, 'executions'), true);
  assert.equal(matches(node, null, 'secretword'), false);
});

test('figures do not count toward the 400 KB display limit, and survive it whole', () => {
  const big = fig('big', 40000);   // - several hundred KB of figure JSON
  const html = `<p>table</p>${plotlyPartHtml(big)}${plotlyPartHtml(big)}`;
  assert.ok(html.length > MAX_OUTPUT_HTML_BYTES);
  assert.equal(capOutputHtml(html), html);
});
