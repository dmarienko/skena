// - run: npx esbuild src/extension/export/html.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportHtml.mjs && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-html.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { escapeHtml, jsonForScript, staticHtml } from './.build/exportHtml.mjs';
import { checkOffline } from './.build/offlineCheck.mjs';

test('1. escaping text and attribute values', () => {
  assert.equal(escapeHtml(`a<b & "c">`), 'a&lt;b &amp; &quot;c&quot;&gt;');
});

test('2. JSON in a script element cannot close it, and still parses to the same value', () => {
  const json = JSON.stringify({ t: '</script><b>x</b>' });
  const safe = jsonForScript(json);
  assert.ok(!safe.includes('</script'));
  assert.deepEqual(JSON.parse(safe), JSON.parse(json));
});

test('3. nothing that runs or loads is left in cell html; the rest is kept', async () => {
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
  const out = await staticHtml(html);
  assert.ok(out.includes('<p>keep</p>'));
  assert.ok(!/<script|<iframe|<link|@import|srcset|onclick|javascript:/i.test(out));
  assert.ok(out.includes('<style> .a { background: none }</style>'));
  assert.ok(out.includes('<pre>&#x3C;script>shown as text&#x3C;/script></pre>'));
  assert.ok(out.includes('<img src="data:image/png;base64,AAAA">'));
  assert.ok(out.includes('<a>j</a>'));
});

test('4. text is never cut: words that look like html, css or urls come back as they were', async () => {
  const kept = [
    '<pre><code>s = "url(https://data.example/a.csv)"; @import foo; x srcset=1</code></pre>',
    '<p>set onclick="x()" or href="javascript:void(0)" on the &lt;a&gt; tag, then @import url(https://x.org/a.css);</p>',
    '<p>a <code>&lt;script src="https://cdn.example.com/a.js"&gt;</code> tag</p>',
  ];
  for (const k of kept) assert.equal(await staticHtml(k), k.replace(/&lt;/g, '&#x3C;').replace(/&gt;/g, '>'));
});

test('5. every element and attribute that runs is taken out, after entities are decoded', async () => {
  const cases = [
    ['<img src="data:image/png;base64,AA" onerror="alert(1)">', '<img src="data:image/png;base64,AA">'],
    ['<a href=" java&#x09;script:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="&#106;avascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="vbscript:msgbox(1)">x</a>', '<a>x</a>'],
    ['<iframe srcdoc="<script>alert(1)</script>"></iframe>x', 'x'],
    ['<object data="https://x.org/a.swf"></object><embed src="https://x.org/b.swf">x', 'x'],
    ['<base href="https://x.org/">x', 'x'],
    ['<meta http-equiv="refresh" content="0;url=https://x.org/">x', 'x'],
    ['<noscript><p>n</p></noscript>x', 'x'],
    ['<svg><script>alert(1)</script><a><set attributeName="href" to="javascript:alert(1)"></set>t</a></svg>', '<svg><a>t</a></svg>'],
    ['<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">b</button></form>', '<form><button>b</button></form>'],
    ['<p ONMOUSEOVER="x()" on-foo="y">p</p>', '<p>p</p>'],
  ];
  for (const [html, out] of cases) assert.equal(await staticHtml(html), out, html);
});

test('6. every remote load is taken out: elements, svg references, css urls, @import and image-set', async () => {
  const html = [
    '<video poster="https://x.org/p.png" src="https://x.org/v.mp4"><source src="//x.org/s.mp4"><track src="https://x.org/t.vtt"></video>',
    '<audio src="https://x.org/a.mp3"></audio><input type="image" src="https://x.org/i.png">',
    '<table background="https://x.org/bg.png"><tbody><tr><td>t</td></tr></tbody></table>',
    '<img src="https://x.org/i.png" alt="i"><img src="https:\\\\x.org/j.png" alt="j">',
    '<svg><image href="https://x.org/i.png"></image><use href="https://x.org/s.svg#a"></use><use xlink:href="https://x.org/s.svg#b"></use><use href="#local"></use>',
    '<rect fill="url(https://x.org/p.svg#g)" stroke="url(#local)"></rect><feImage href="https://x.org/f.png"></feImage></svg>',
    '<div style="background:url(&quot;https://x.org/a.png&quot;)">a</div>',
    '<div style="background-image:image-set(&quot;https://x.org/b.png&quot; 1x, url(data:image/png;base64,AA) 2x)">b</div>',
    '<div style="background:u\\72l(https://x.org/esc.png)">c</div>',
    '<style>.a{background:image-set("https://x.org/c.png" 1x)} @import "https://x.org/d.css"; .b{color:red}</style>',
    '<a href="https://example.org/paper">paper</a>',
  ].join('');
  const out = await staticHtml(html);
  assert.ok(!out.includes('x.org'), out);
  assert.ok(out.includes('<use href="#local"></use>'));
  assert.ok(out.includes('stroke="url(#local)"'));
  assert.ok(out.includes('<a href="https://example.org/paper">paper</a>'));
  assert.ok(out.includes('url(data:image/png;base64,AA) 2x'));
  assert.ok(out.includes('.b{color:red}'));
  assert.ok(out.includes('<div>c</div>'));
});

test('7. images: each source once, decoded once, as the browser reads the tag; a swap puts the data url or the alt text and address', async () => {
  let asked;
  const html = '<p><img alt="a>b" src="a.png"> <img src="x&amp;amp;y.png" alt="gone"> <img src="c.png"> <img data-src="d.png">'
    + '<img src="data:image/png;base64,AA"><img src="a.png"></p><template><img src="t.png"></template>';
  const out = await staticHtml(html, async sources => {
    asked = sources;
    return new Map([['a.png', 'data:image/png;base64,QQ=='], ['x&amp;y.png', null], ['t.png', 'data:image/png;base64,VA==']]);
  });
  assert.deepEqual(asked, ['a.png', 'x&amp;y.png', 'c.png', 't.png']);
  assert.ok(out.includes('<img alt="a>b" src="data:image/png;base64,QQ==">'));
  assert.ok(out.includes('<span class="skena-export-missing" title="x&#x26;amp;y.png">[image: gone — x&#x26;amp;y.png]</span>'));
  assert.ok(out.includes('<img src="c.png">'));
  assert.ok(out.includes('<img data-src="d.png">'));
  assert.ok(out.includes('<template><img src="data:image/png;base64,VA=="></template>'));
});

test('8. the offline check finds remote loads and ignores links, script bodies and local data', () => {
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

test('9. a clean page passes', () => {
  const r = checkOffline('<div data-node-id="a&amp;b"><img src="data:image/png;base64,AA"></div>', ['a&b']);
  assert.deepEqual(r, { remote: [], missingNodeIds: [] });
});

test('10. a fragment is closed inside itself; a template, SVG and MathML come back as they were', async () => {
  assert.equal(await staticHtml('<div><p>a</div><b>x'), '<div><p>a</p></div><b>x</b>');
  const kept = [
    '<template shadowrootmode="open"><p>x</p></template>',
    '<svg viewBox="0 0 1 1"><use xlink:href="#g1"></use></svg>',
    '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></span>',
  ];
  for (const k of kept) assert.equal(await staticHtml(k), k);
});
