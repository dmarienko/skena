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

const TYPES = { '.md': 'markdown', '.png': 'image' };
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
