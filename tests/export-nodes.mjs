// - run: npx esbuild src/extension/export/nodeHtml.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportNodes.mjs && node --test tests/export-nodes.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  cellFigure, cellNodeHtml, chatNodeHtml, codeNodeHtml, fileNodeHtml, kernelNodeHtml, knowledgeNodeHtml, linkNodeHtml,
  noderefNodeHtml, notebookHtml, placeNode, portalNodeHtml, textNodeHtml,
} from './.build/exportNodes.mjs';

const at = { x: 100, y: 200, width: 700, height: 300 };

test('1. a node sits at its canvas box and carries its id and label', () => {
  const html = placeNode({ id: 'n"1', type: 'text', text: '', nodeLabel: 'N1', createdBy: 'ai', ...at }, '<p>x</p>');
  assert.ok(html.startsWith('<div class="skena-export-node" data-node-id="n&quot;1" data-label="N1" style="left:100px;top:200px;width:700px;height:300px;'));
  assert.ok(html.includes('<span class="skena-export-label">N1</span>'));
  assert.ok(html.includes('<span class="skena-export-ai">AI</span>'));
});

test('2. a text note: the markdown html in a scroll box, in the text border colour', () => {
  const html = textNodeHtml({ id: 't', type: 'text', text: '', nodeLabel: 'N2', ...at }, '<p>hello</p>');
  assert.ok(html.includes('class="skena-node skena-node--text" style="border:2.7px solid #1f96bd;'));
  assert.ok(html.includes('<div class="skena-markdown"><p>hello</p></div>'));
});

test('3. a knowledge node: server, title and fetch date, then the stored text', () => {
  const node = { id: 'w', type: 'knowledge', server: 'crtx', uri: 'crtx://x', title: 'A <paper>', text: '', fetchedAt: '2026-10-06T09:18:30.018Z', nodeLabel: 'W1', ...at };
  const html = knowledgeNodeHtml(node, '<p>body</p>');
  assert.ok(html.includes('>crtx</span>'));
  assert.ok(html.includes('A &lt;paper&gt;'));
  assert.ok(/fetched 2026-10-0\d \d\d:\d\d/.test(html));
  assert.ok(html.includes('<p>body</p>'));
});

test('4. a code cell: language and status glyph in its header, the lines below', () => {
  const html = codeNodeHtml({ id: 'c', type: 'code', code: 'x = 1', language: 'python', lastStatus: 'ok', nodeLabel: 'E1', ...at }, '<pre>LINES</pre>');
  assert.ok(html.includes('>python</span>'));
  assert.ok(html.includes('✓'));
  assert.ok(html.includes('<pre>LINES</pre>'));
});

test('5. output cells: an image inline, html as it is (the export makes it static), a plotly box with its plot size and its figure for the page', () => {
  const img = cellNodeHtml({ id: 'i', type: 'cell', format: 'image', content: 'data:image/png;base64,AA', ...at }, null);
  assert.ok(img.includes('<img src="data:image/png;base64,AA"'));
  assert.ok(img.includes('dashed #1f96bd'));
  const html = cellNodeHtml({ id: 'h', type: 'cell', format: 'html', content: '<table><tr><td>1</td></tr></table>', ...at }, null);
  assert.ok(html.includes('<div class="skena-cell-html"><table><tr><td>1</td></tr></table></div>'));
  const fig = JSON.stringify({ data: [{ name: '</script>' }], layout: {} });
  const cell = { id: 'p', type: 'cell', format: 'plotly', content: fig, ...at };
  const plot = cellNodeHtml(cell, null);
  assert.ok(plot.includes('data-plotly="skena-fig-p" data-w="678.6" data-h="282.6"'));
  assert.ok(!plot.includes('<script'));
  assert.deepEqual(cellFigure(cell), { id: 'skena-fig-p', json: fig });
  assert.equal(cellFigure({ ...cell, format: 'html' }), null);
});

test('6. a file node: the header title and the rendered body', () => {
  const html = fileNodeHtml({ id: 'f', type: 'file', file: 'docs/a.md', nodeLabel: 'M1', ...at }, { fileType: 'markdown', title: 'Plan', status: 'research', body: '<div class="skena-markdown"><h1>Plan</h1></div>' });
  assert.ok(html.includes('codicon-markdown'));
  assert.ok(html.includes('>Plan</span>'));
  assert.ok(html.includes('>research</span>'));
  assert.ok(html.includes('<h1>Plan</h1>'));
});

test('7. a link: host and address as text and as a link, and no image', () => {
  const html = linkNodeHtml({ id: 'l', type: 'link', url: 'https://claude.ai/artifact/x?a=1&b=2', nodeLabel: 'L1', ...at });
  assert.ok(html.includes('>claude.ai</div>'));
  assert.ok(html.includes('<a href="https://claude.ai/artifact/x?a=1&amp;b=2"'));
  assert.ok(!html.includes('<img'));
});

test('8. portal, reference, kernel and chat nodes draw their own shapes; the kernel shows its label inside', () => {
  assert.ok(portalNodeHtml({ id: 'p', type: 'portal', canvas: '../a/other.canvas', nodeLabel: 'P1', ...at }).includes('>other</span>'));
  assert.ok(noderefNodeHtml({ id: 'r', type: 'noderef', canvas: 'x/other.canvas', label: 'N3', nodeLabel: 'R1', ...at }).includes('other › N3'));
  const k = kernelNodeHtml({ id: 'k', type: 'kernel', server: 's', displayName: 'factors', colorIndex: 1, nodeLabel: 'K1', ...at });
  assert.ok(k.includes('factors :: —'));
  assert.ok(k.includes('>K1</div>'));
  assert.ok(!k.includes('skena-export-label'));
  assert.ok(chatNodeHtml({ id: 'h', type: 'chat', title: 'Ask', agent: 'claude', ...at }).includes('>Ask</span>'));
});

test('9. a notebook: markdown cells as rendered, the outputs, the source only when asked', () => {
  const nb = { kernelName: 'python3', languageName: 'python', cellCount: 3, cells: [
    { type: 'markdown', source: '# T', outputs: [] },
    { type: 'code', source: 'print(1)', outputs: [{ mimeType: 'text/plain', text: '1 < 2' }], executionCount: 4 },
    { type: 'code', source: 'x = 1', outputs: [] },
  ] };
  const code = s => `<pre>${s}</pre>`;
  const { html, figures } = notebookHtml(nb, ['<h1>T</h1>', '', ''], false, code, 'f', 600);
  assert.deepEqual(figures, []);
  assert.ok(html.includes('<div class="skena-markdown"><h1>T</h1></div>'));
  assert.ok(html.includes('<pre class="skena-notebook__text-output">1 &lt; 2</pre>'));
  assert.ok(!html.includes('print(1)') && !html.includes('x = 1'));
  const withSource = notebookHtml(nb, ['<h1>T</h1>', '', ''], true, code, 'f', 600).html;
  assert.ok(withSource.includes('[4]</span><pre>print(1)</pre>'));
  assert.ok(withSource.includes('[ ]</span><pre>x = 1</pre>'));
});

test('10. values from the file stay inside their style attribute: the markdown font, a node colour', () => {
  const t = textNodeHtml({ id: 't', type: 'text', text: '', ...at }, '<p>x</p>', 'font-family:"IBM Plex Sans", serif;font-size:14px');
  assert.ok(t.includes('<div class="skena-markdown" style="font-family:&quot;IBM Plex Sans&quot;, serif;font-size:14px">'));
  for (const color of ['red" onmouseover="x()', 'red;background:url(https://x.org/a.png)', 'url(a.png)']) {
    const html = textNodeHtml({ id: 't', type: 'text', text: '', color, ...at }, '<p>x</p>');
    assert.ok(!html.includes('onmouseover') && !html.includes('url('), html);
    assert.ok(html.includes('solid #1f96bd;'));
  }
  for (const color of ['#ff0000', 'red', 'rgb(1 2 3 / 50%)']) assert.ok(textNodeHtml({ id: 't', type: 'text', text: '', color, ...at }, '').includes(`solid ${color};`), color);
});

test('11. an output cell of a format the canvas does not know draws nothing, as CellNode does', () => {
  const cell = { id: 'u', type: 'cell', format: 'text', content: 'hello', ...at };
  const html = cellNodeHtml(cell, null);
  assert.ok(!html.includes('hello') && !html.includes('data-plotly') && !html.includes('<script'));
  assert.ok(html.includes('<div class="skena-export-scroll" style="padding:6px 8px"></div>'));
  assert.equal(cellFigure(cell), null);
});
