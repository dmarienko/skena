// - run: npx esbuild src/extension/export/exportCanvas.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportCanvas.mjs --external:@myriaddreamin/typst-ts-node-compiler "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && npx esbuild src/extension/export/page.ts --bundle --format=esm --outfile=tests/.build/exportPage.mjs && node --test tests/export-canvas.mjs
// - a scratch canvas under the OS temp dir with one node of every type; no real .canvas file is read
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { buildExportAssets } from '../scripts/build-export-assets.mjs';
import { defaultHtmlPath, exportCanvasHtml, exportCanvasToFile } from './.build/exportCanvas.mjs';
import { checkOffline } from './.build/offlineCheck.mjs';
import { FALLBACK_THEME } from './.build/exportPage.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = mkdtempSync(join(tmpdir(), 'skena-export-canvas-'));
const ASSETS = join(DIR, 'dist');
buildExportAssets(ROOT, join(ASSETS, 'export-assets'));
writeFileSync(join(ASSETS, 'plotly.min.js'), 'window.Plotly={newPlot:function(){}};');
// - a 1x1 png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
writeFileSync(join(DIR, 'dot.png'), PNG);
writeFileSync(join(DIR, 'notes.md'), '---\ntitle: Notes\nstatus: research\n---\n# Notes\n\n![dot](dot.png)\n');

const box = (id, type, x, y, extra = {}) => ({ id, type, x, y, width: 600, height: 300, ...extra });
const CANVAS = {
  nodes: [
    box('t1', 'text', 0, 0, { text: 'Rate $r_t$ is 5%, and %x^2%.\n\n![dot](dot.png)' }),
    box('t2', 'text', 700, 0, { text: 'Plain $a+b$ math.' }),
    box('c1', 'code', 0, 400, { code: 'import numpy as np\nx = np.arange(3)  # c', outputNodeId: 'o1', lastStatus: 'ok' }),
    box('o1', 'cell', 700, 400, { format: 'html', content: '<table><tr><td>1</td></tr></table><script>alert(1)</script>' }),
    box('o2', 'cell', 1400, 400, { format: 'plotly', content: JSON.stringify({ data: [{ y: [1, 2] }], layout: {} }) }),
    box('o3', 'cell', 2100, 400, { format: 'image', content: `data:image/png;base64,${PNG.toString('base64')}` }),
    box('w1', 'knowledge', 0, 800, { server: 'crtx', uri: 'crtx://lib/p.md', title: 'Paper', text: '# Paper\n\n![fig](crtx://lib/assets/fig.png)', fetchedAt: '2026-10-06T09:00:00Z' }),
    box('m1', 'file', 700, 800, { file: 'notes.md' }),
    box('l1', 'link', 1400, 800, { url: 'https://example.com/a' }),
    box('p1', 'portal', 2100, 800, { canvas: 'other.canvas' }),
    box('r1', 'noderef', 0, 1200, { canvas: 'other.canvas', label: 'N1' }),
    box('k1', 'kernel', 700, 1200, { server: 's', displayName: 'py' }),
    box('h1', 'chat', 1400, 1200, { title: 'Ask', agent: 'claude' }),
    box('g1', 'group', -100, -100, { label: 'not shown' }),
  ],
  edges: [
    { id: 'e1', fromNode: 'c1', fromSide: 'right', toNode: 'o1', toSide: 'left' },
    { id: 'e2', fromNode: 't1', fromSide: 'right', toNode: 't2', toSide: 'left', label: 'next' },
  ],
  metadata: { sections: [{ id: 's1', y: 0, createdAt: 1, title: 'One', folded: ['o3'] }] },
};
const CANVAS_PATH = join(DIR, 'all.canvas');
writeFileSync(CANVAS_PATH, JSON.stringify(CANVAS));

const TYPES = { '.md': 'markdown', '.png': 'image', '.ipynb': 'notebook', '.html': 'html' };
const deps = {
  assetDir: ASSETS, codeTheme: 'ayu-dark', mdTheme: 'factors', mdMaxWidth: 0, notebookShowSource: false, theme: FALLBACK_THEME,
  resolveFile: (uri, dir) => { const p = resolve(dir, uri); return { fsPath: p, fileType: TYPES[extname(p)] ?? 'unknown' }; },
  knowledgeAsset: async (server, uri) => (server === 'crtx' && uri === 'crtx://lib/assets/fig.png' ? 'data:image/png;base64,S05PV04=' : Promise.reject(new Error('unknown'))),
};
const result = await exportCanvasHtml(CANVAS_PATH, deps);
const html = result.html;

test('1. every node but the group is on the page, and the page loads nothing from the network', () => {
  const ids = CANVAS.nodes.filter(n => n.type !== 'group').map(n => n.id);
  assert.deepEqual(checkOffline(html, ids), { remote: [], missingNodeIds: [] });
  assert.ok(!html.includes('data-node-id="g1"'));
  assert.equal(result.nodes, 13);
  assert.equal(result.edges, 2);
});

test('2. the canvas file is only read', () => {
  assert.equal(readFileSync(CANVAS_PATH, 'utf8'), JSON.stringify(CANVAS));
});

test('3. images: a file next to the canvas, a file next to the markdown file, a knowledge server image', () => {
  assert.deepEqual(result.missing, []);
  assert.ok(html.includes('data:image/png;base64,S05PV04='));
  assert.ok(!html.includes('src="dot.png"') && !html.includes('crtx://lib/assets'));
});

test('4. math: KaTeX HTML where the webview renders, MathML and Typst where the host does', () => {
  const t1 = html.slice(html.indexOf('data-node-id="t1"'), html.indexOf('data-node-id="t2"'));
  const t2 = html.slice(html.indexOf('data-node-id="t2"'), html.indexOf('data-node-id="c1"'));
  assert.ok(t1.includes('<math') && t1.includes('typst-math'));
  assert.ok(t2.includes('katex-html'));
});

test('5. plotly once, the cell script gone, the code coloured, the section frame drawn', () => {
  assert.equal(html.match(/window\.Plotly=/g).length, 1);
  assert.ok(!html.includes('alert(1)'));
  assert.ok(html.includes('<span style="color:#ff8f40">import</span>'));
  assert.ok(html.includes('S1 · One'));
  assert.ok(html.includes('data-md-theme="factors"'));
  assert.ok(html.includes('font-family: "IBM Plex Sans"'));
});

test('6. the file node shows its frontmatter title and status', () => {
  const m1 = html.slice(html.indexOf('data-node-id="m1"'), html.indexOf('data-node-id="l1"'));
  assert.ok(m1.includes('>Notes</span>') && m1.includes('>research</span>'));
});

test('7. the default page path is the canvas path with .html', () => {
  assert.equal(defaultHtmlPath('/a/b/factors-essentials.canvas'), '/a/b/factors-essentials.html');
});

test('8. the page is never written over a canvas: the one exported, another .canvas file, or a link to one', async () => {
  const other = join(DIR, 'other.canvas');
  const link = join(DIR, 'link.html');
  symlinkSync(CANVAS_PATH, link);
  for (const target of [CANVAS_PATH, other, join(DIR, 'UPPER.CANVAS'), link]) {
    await assert.rejects(exportCanvasToFile(CANVAS_PATH, target, deps), /^Error: not writing the page to .*: (that is a \.canvas file|it is the canvas being exported)$/, target);
  }
  assert.equal(readFileSync(CANVAS_PATH, 'utf8'), JSON.stringify(CANVAS));
  assert.ok(!existsSync(other));
  const page = join(DIR, 'all.html');
  const r = await exportCanvasToFile(CANVAS_PATH, page, deps);
  assert.equal(readFileSync(page, 'utf8'), r.html);
});

// - a canvas of its own under the scratch dir, exported with the same deps
async function exportNodes(name, nodes, edges = [], metadata, more = {}) {
  const p = join(DIR, `${name}.canvas`);
  writeFileSync(p, JSON.stringify({ nodes, edges, ...(metadata ? { metadata } : {}) }));
  return exportCanvasHtml(p, { ...deps, ...more });
}

test('9. an <img> that names a local file that is not an image is not put in; it is listed as missing', async () => {
  writeFileSync(join(DIR, 'key.txt'), 'SECRET-KEY-123');
  const r = await exportNodes('img-types', [box('t', 'text', 0, 0, { text: '<img src="key.txt" alt="k">\n\n![dot](dot.png)', nodeLabel: 'N1' })]);
  assert.ok(!r.html.includes(Buffer.from('SECRET-KEY-123').toString('base64')));
  assert.ok(!r.html.includes('application/octet-stream'));
  assert.ok(r.html.includes('[image: k — key.txt]'));
  assert.deepEqual(r.missing, ['N1 key.txt: not an image file']);
  assert.ok(r.html.includes(`data:image/png;base64,${PNG.toString('base64')}`));
});

// - a notebook with one markdown cell and one code cell whose output is `html`
const notebook = (md, html) => JSON.stringify({
  nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3' }, language_info: { name: 'python' } },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: md },
    { cell_type: 'code', metadata: {}, execution_count: 1, source: 'x', outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': html } }] },
  ],
});

test('10. nothing that runs or loads is left from any node: notes, cells, knowledge, notebooks, html files, links', async () => {
  const bad = '<script>alert(1)</script><img src="dot.png" onerror="alert(2)"><a href="javascript:alert(3)">j</a><iframe src="https://example.com/f"></iframe>';
  writeFileSync(join(DIR, 'bad.ipynb'), notebook(`md ${bad}`, bad));
  writeFileSync(join(DIR, 'bad.html'), `<p>file</p>${bad}`);
  const r = await exportNodes('active', [
    box('t', 'text', 0, 0, { text: `note ${bad}` }),
    box('m', 'cell', 700, 0, { format: 'markdown', content: `cell ${bad}` }),
    box('h', 'cell', 1400, 0, { format: 'html', content: bad }),
    box('k', 'knowledge', 0, 400, { server: 'crtx', uri: 'crtx://x', title: 'K', text: `k ${bad}`, fetchedAt: '' }),
    box('n', 'file', 700, 400, { file: 'bad.ipynb' }),
    box('f', 'file', 1400, 400, { file: 'bad.html' }),
    box('l', 'link', 0, 800, { url: 'javascript:alert(4)' }),
  ]);
  const body = r.html.slice(r.html.indexOf('<body'));
  for (const gone of ['<script', 'alert(1)', 'onerror', 'alert(2)', 'href="javascript:', '<iframe']) assert.ok(!body.includes(gone), gone);
  assert.equal(body.match(/>j<\/a>/g).length, 7);
  assert.ok(body.includes('javascript:alert(4)</a>'));
  assert.deepEqual(checkOffline(r.html, []).remote, []);
  assert.deepEqual(r.missing, []);
});

test('11. markdown cells and notebook markdown cells: MarkdownRenderer\'s KaTeX HTML and font, never the host path', async () => {
  const md = 'growth of 5% vs 7% a year, $x^2$';
  writeFileSync(join(DIR, 'md.ipynb'), notebook(md, '<p>out</p>'));
  const r = await exportNodes('md-cells', [
    box('m', 'cell', 0, 0, { format: 'markdown', content: md }),
    box('n', 'file', 700, 0, { file: 'md.ipynb' }),
  ], [], undefined, { mdFont: { family: 'Georgia', size: 15 } });
  const body = r.html.slice(r.html.indexOf('<body'));
  assert.ok(!body.includes('<math'));
  assert.equal(body.match(/class="katex-html"/g).length, 2);
  assert.equal(body.match(/<div class="skena-markdown" style="font-family:Georgia;font-size:15px">/g).length, 2);
});
