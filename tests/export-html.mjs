// - run: npx esbuild src/extension/export/html.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportHtml.mjs && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-html.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { balanceHtml, decodeAttr, escapeHtml, imageSources, jsonForScript, stripActiveHtml, swapImageSources } from './.build/exportHtml.mjs';
import { checkOffline } from './.build/offlineCheck.mjs';

test('1. escaping text and attribute values', () => {
  assert.equal(escapeHtml(`a<b & "c">`), 'a&lt;b &amp; &quot;c&quot;&gt;');
  assert.equal(decodeAttr('a&#x26;b&amp;c&#60;'), 'a&b&c<');
});

test('2. JSON in a script element cannot close it, and still parses to the same value', () => {
  const json = JSON.stringify({ t: '</script><b>x</b>' });
  const safe = jsonForScript(json);
  assert.ok(!safe.includes('</script'));
  assert.deepEqual(JSON.parse(safe), JSON.parse(json));
});

test('3. nothing that runs or loads is left in cell html; the rest is kept', () => {
  const html = [
    '<p onclick="x()">keep</p>',
    '<script src="https://cdn.example.com/a.js"></script>',
    '<script>alert(1)</script>',
    '<iframe src="https://example.com"></iframe>',
    '<link rel="stylesheet" href="https://example.com/s.css">',
    '<style>@import url(https://example.com/x.css); .a { background: url(https://example.com/i.png) }</style>',
    '<img src="data:image/png;base64,AAAA" srcset="https://example.com/2x.png 2x">',
    '<a href="javascript:alert(1)">j</a>',
    '<pre>&lt;script&gt;shown as text&lt;/script&gt;</pre>',
  ].join('\n');
  const out = stripActiveHtml(html);
  assert.ok(out.includes('<p>keep</p>'));
  assert.ok(!/<script|<iframe|<link|@import|srcset|onclick|javascript:/i.test(out));
  assert.ok(!out.includes('url(https://'));
  assert.ok(out.includes('&lt;script&gt;shown as text'));
  assert.ok(out.includes('<img src="data:image/png;base64,AAAA"'));
});

test('4. image sources: every non-data src once, as written', () => {
  const html = '<img src="a.png" alt="A"><img src=\'crtx://lib/x.jpeg\'><img src="data:image/png;base64,AA"><img src="a.png">';
  assert.deepEqual(imageSources(html), ['a.png', 'crtx://lib/x.jpeg']);
});

test('5. a resolved image gets its data url; one that could not be read shows its alt text and address', () => {
  const html = '<p><img src="a.png" alt="plot"> <img src="b.png" alt="gone"> <img src="c.png"></p>';
  const out = swapImageSources(html, new Map([['a.png', 'data:image/png;base64,QQ=='], ['b.png', null]]));
  assert.ok(out.includes('<img src="data:image/png;base64,QQ==" alt="plot">'));
  assert.ok(out.includes('<span class="skena-export-missing" title="b.png">[image: gone — b.png]</span>'));
  assert.ok(out.includes('<img src="c.png">'));
});

test('6. the offline check finds remote loads and ignores links, script bodies and local data', () => {
  const page = [
    '<link rel="stylesheet" href="https://fonts.example.com/f.css">',
    '<img src="//cdn.example.com/x.png">',
    '<img src="data:image/png;base64,AA">',
    '<a href="https://example.com/paper">paper</a>',
    '<script>var u = "<img src=\\"https://plotly.com/x.png\\">";</script>',
    '<script src="https://cdn.example.com/p.js"></script>',
    '<style>.a { background: url("https://example.com/i.png") }</style>',
    '<div style="background:url(https://example.com/j.png)"></div>',
    '<svg><use xlink:href="#g1"></use></svg>',
    '<div data-node-id="n1"></div>',
  ].join('\n');
  const r = checkOffline(page, ['n1', 'n2']);
  assert.deepEqual(r.remote, [
    'link href=https://fonts.example.com/f.css',
    'img src=//cdn.example.com/x.png',
    'script src=https://cdn.example.com/p.js',
    'css https://example.com/i.png',
    'css https://example.com/j.png',
  ]);
  assert.deepEqual(r.missingNodeIds, ['n2']);
});

test('7. a clean page passes', () => {
  const r = checkOffline('<div data-node-id="a&amp;b"><img src="data:image/png;base64,AA"></div>', ['a&b']);
  assert.deepEqual(r, { remote: [], missingNodeIds: [] });
});

test('8. a fragment is closed inside itself; JSON in a script, a template, SVG and MathML come back as they were', () => {
  assert.equal(balanceHtml('<div><p>a</div><b>x'), '<div><p>a</p></div><b>x</b>');
  const kept = [
    '<script type="application/json" id="f">{"a":"\\u003cb>"}</script>',
    '<template shadowrootmode="open"><p>x</p></template>',
    '<svg viewBox="0 0 1 1"><use xlink:href="#g1"></use></svg>',
    '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></span>',
  ];
  for (const k of kept) assert.equal(balanceHtml(k), k);
});
