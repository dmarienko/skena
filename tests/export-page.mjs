// - run: npx esbuild src/extension/export/page.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportPage.mjs && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-page.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildPage, sectionFrames } from './.build/exportPage.mjs';
import { checkOffline } from './.build/offlineCheck.mjs';

const lane = (id, label, top, bottom, extra = {}) => ({ id, label, index: Number(label.slice(1)) - 1, y: top, top, bottom, createdAt: 0, memberIds: [], ...extra });

function input(extra = {}) {
  return {
    title: 'factors <essentials>',
    box: { left: -40, top: -40, width: 1000, height: 800 },
    sections: [{ id: 's1', label: 'S1', title: 'Taxonomy', color: '#4cc8a0', kernelName: 'factors', top: 0, bottom: 700 }],
    nodesHtml: ['<div class="skena-export-node" data-node-id="n1"></div>'],
    edges: [
      { id: 'e1', points: [[0, 0], [100, 0]], d: 'M 0,0 L 100,0', label: 'uses', labelAt: [50, 0], color: '#1f96bd', dashed: false, arrow: true },
      { id: 'e2', points: [[0, 50], [100, 50]], d: 'M 0,50 L 100,50', labelAt: [50, 50], color: '#02542e', dashed: true, arrow: false },
    ],
    css: ['.a{}', '.b{}'],
    theme: { vars: { '--vscode-editor-background': '#000000', '--vscode-editor-font-family': '"JetBrains Mono", monospace' }, dark: true },
    mdTheme: 'factors',
    mdMaxWidth: 88,
    figures: [],
    plotlyJs: null,
    ...extra,
  };
}

test('1. the page: theme variables on <html>, the dark body class, the stylesheets, the title escaped', () => {
  const html = buildPage(input());
  assert.ok(html.startsWith('<!doctype html>\n<html lang="en" data-md-theme="factors" style="--vscode-editor-background:#000000;--vscode-editor-font-family:&quot;JetBrains Mono&quot;, monospace;'));
  assert.ok(html.includes('--sk-border:#424245'));
  assert.ok(html.includes('--skena-md-maxw:88ch'));
  assert.ok(html.includes('<title>factors &lt;essentials&gt;</title><style>.a{}</style><style>.b{}</style>'));
  assert.ok(html.includes('<body class="vscode-dark">'));
  assert.ok(html.includes('<div class="skena-export-page" style="width:1000px;height:800px"><div class="skena-export-origin" style="left:40px;top:40px">'));
});

test('2. section frames span the page width with their label, title and kernel', () => {
  const html = buildPage(input());
  assert.ok(html.includes('<div class="skena-export-section" data-section-id="s1" style="left:-40px;top:0px;width:1000px;height:700px;border-color:#4cc8a0">'));
  assert.ok(html.includes('S1 · Taxonomy<span class="skena-export-section-kernel"> · factors</span>'));
});

test('3. edges: one marker per arrow colour, the dotted output link, labels above the nodes', () => {
  const html = buildPage(input());
  assert.equal(html.match(/<marker /g).length, 1);
  assert.ok(html.includes('viewBox="-40 -40 1000 800" style="left:-40px;top:-40px"'));
  assert.ok(html.includes('<path data-edge-id="e1" d="M 0,0 L 100,0" fill="none" stroke="#1f96bd" stroke-opacity="0.6" stroke-width="1.8" marker-end="url(#skena-arrow-0-1f96bd)"/>'));
  assert.ok(html.includes('stroke-dasharray="2.7 5.4"'));
  assert.ok(html.indexOf('data-node-id="n1"') < html.indexOf('skena-export-edge-label'));
  assert.ok(html.includes('<div class="skena-export-edge-label" style="left:50px;top:0px;border-color:#1f96bd">uses</div>'));
});

test('4. plotly comes once, with the plotting script, only when given; the figures after the nodes; the page loads nothing remote', () => {
  assert.ok(!buildPage(input()).includes('<script'));
  const figures = [{ id: 'skena-fig-c"1', json: '{"data":[{"name":"</script>"}]}' }];
  const html = buildPage(input({ plotlyJs: 'window.Plotly={newPlot(){}};', figures }));
  assert.equal(html.match(/window\.Plotly=/g).length, 1);
  assert.ok(html.includes('<script type="application/json" id="skena-fig-c&quot;1">{"data":[{"name":"\\u003c/script>"}]}</script><script>'));
  assert.ok(html.indexOf('data-node-id="n1"') < html.indexOf('id="skena-fig-c'));
  assert.ok(html.includes('IntersectionObserver'));
  assert.deepEqual(checkOffline(html, ['n1']), { remote: [], missingNodeIds: [] });
  assert.throws(() => buildPage(input({ plotlyJs: 'x="</script>"' })));
});

test('5. section frames take the kernel colour and name, else the palette by position and the creation time', () => {
  const lanes = [
    lane('a', 'S1', 0, 700, { title: 'A', kernelId: 'k-1' }),
    lane('b', 'S2', 700, 1400, { title: 'B', kernelId: 'kn' }),
    lane('c', 'S3', 1400, 2000, { createdAt: new Date(2026, 9, 6, 12, 0).getTime() }),
  ];
  const nodes = [{ id: 'kn', type: 'kernel', server: 's', displayName: 'node kernel', colorIndex: 3, x: 0, y: 0, width: 140, height: 160 }];
  const records = [{ id: 'k-1', server: 'quantkit', displayName: 'factors', colorIndex: 1 }];
  assert.deepEqual(sectionFrames(lanes, nodes, records).map(x => [x.label, x.title, x.color, x.kernelName]), [
    ['S1', 'A', '#d9a23f', 'factors'],
    ['S2', 'B', '#e5707a', 'node kernel'],
    ['S3', '2026-10-06 12:00', '#7aa2f7', null],
  ]);
});
