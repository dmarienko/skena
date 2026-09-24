// - run: npx esbuild src/webview/canvas/knowledgeAssets.ts --bundle --format=esm --external:react --outfile=tests/.build/knowledgeAssets.mjs && npx esbuild src/webview/canvas/knowledgeAssets.ts --bundle --format=esm --alias:react=./tests/react-hooks-stub.mjs --outfile=tests/.build/knowledgeAssets-hooks.mjs && node --test tests/knowledge-assets.mjs
// - the webview side of §6.1: which src is a knowledge uri, what is asked of the host, and what
//   the answer does to the html and to the markdown a node renders.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const posted = [];
globalThis.window = { vscodeApi: { postMessage: (m) => posted.push(m) }, addEventListener: () => {} };
globalThis.document = { documentElement: { dataset: {} } };

const { isKnowledgeUri, receiveAsset, swapHtmlAssets, swapMarkdownAssets } = await import('./.build/knowledgeAssets.mjs');

const PNG = 'data:image/png;base64,AAA';
const settle = () => new Promise(r => setTimeout(r, 0));

test('a knowledge uri is an absolute uri the webview cannot load by itself', () => {
  assert.equal(isKnowledgeUri('crtx://crtx/assets/a.svg'), true);
  assert.equal(isKnowledgeUri('notion://page'), true);
  for (const src of ['https://x/y.png', 'http://x/y.png', 'data:image/png;base64,AA', 'blob:abc', 'vscode-resource://x/y.png', './a.png', 'a.png', '']) {
    assert.equal(isKnowledgeUri(src), false, src);
  }
});

test('html: the uri is asked for once, then swapped for the data url', async () => {
  posted.length = 0;
  const html = '<p><img src="crtx://crtx/assets/a.svg" alt="a"><img src="./b.png"></p>';
  assert.equal(swapHtmlAssets(html, 'crtx'), html);
  assert.equal(swapHtmlAssets(html, 'crtx'), html);
  await settle();
  assert.deepEqual(posted, [{ type: 'knowledgeAsset', server: 'crtx', uri: 'crtx://crtx/assets/a.svg' }]);

  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/a.svg', dataUrl: PNG });
  assert.equal(swapHtmlAssets(html, 'crtx'), `<p><img src="${PNG}" alt="a"><img src="./b.png"></p>`);
});

test('html: a failed image keeps its src and says why on hover', () => {
  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/bad.svg', error: 'HTTP 404 Not Found' });
  assert.equal(
    swapHtmlAssets('<img src="crtx://crtx/assets/bad.svg" alt="x">', 'crtx'),
    '<img src="crtx://crtx/assets/bad.svg" title="HTTP 404 Not Found" alt="x">',
  );
});

test('html: a tag that already carries a title keeps exactly one, not two', () => {
  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/dup.svg', error: 'timed out' });
  const out = swapHtmlAssets('<img src="crtx://crtx/assets/dup.svg" title="old" alt="x">', 'crtx');
  assert.equal(out, '<img src="crtx://crtx/assets/dup.svg" title="timed out" alt="x">');
  assert.equal((out.match(/\btitle=/g) ?? []).length, 1);
});

test('html: two servers do not share a cache slot for the same uri text', async () => {
  posted.length = 0;
  const html = '<img src="crtx://shared/assets/x.svg">';
  swapHtmlAssets(html, 'server-a');
  receiveAsset({ server: 'server-a', uri: 'crtx://shared/assets/x.svg', dataUrl: PNG });
  // - server-b has not been answered yet, so its swap of the same uri text is still untouched
  assert.equal(swapHtmlAssets(html, 'server-b'), html);
  assert.equal(swapHtmlAssets(html, 'server-a'), `<img src="${PNG}">`);
  await settle();
});

test('markdown: the path is swapped for the data url, its title kept, and an error becomes the title', () => {
  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/c.svg', dataUrl: PNG });
  assert.equal(swapMarkdownAssets('see ![a](crtx://crtx/assets/c.svg) and ![b](https://x/y.png)', 'crtx'),
    `see ![a](${PNG}) and ![b](https://x/y.png)`);
  assert.equal(swapMarkdownAssets('![a](crtx://crtx/assets/c.svg "cap")', 'crtx'), `![a](${PNG} "cap")`);
  assert.equal(swapMarkdownAssets("![a](crtx://crtx/assets/c.svg 'cap')", 'crtx'), `![a](${PNG} "cap")`);
  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/bad.svg', error: 'HTTP 404 Not Found' });
  assert.equal(swapMarkdownAssets('![a](crtx://crtx/assets/bad.svg)', 'crtx'), '![a](crtx://crtx/assets/bad.svg "HTTP 404 Not Found")');
});

test('markdown: a ")" or a \'"\' in a title carried into the image reads back as the literal character', () => {
  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/paren.svg', error: 'bad (see docs) for "detail"' });
  const out = swapMarkdownAssets('![a](crtx://crtx/assets/paren.svg)', 'crtx');
  assert.equal(out, String.raw`![a](crtx://crtx/assets/paren.svg "bad (see docs\) for 'detail'")`);
});

test('markdown: a uri still on its way is left as it is', async () => {
  posted.length = 0;
  assert.equal(swapMarkdownAssets('![a](crtx://crtx/assets/late.svg)', 'crtx'), '![a](crtx://crtx/assets/late.svg)');
  await settle();
  assert.deepEqual(posted, [{ type: 'knowledgeAsset', server: 'crtx', uri: 'crtx://crtx/assets/late.svg' }]);
});

test('a subscriber is bumped only for a uri it looked up, and only once registered', () => {
  const bumpsA = [];
  const bumpsB = [];
  const subA = { bump: () => bumpsA.push(1), uris: new Set() };
  const subB = { bump: () => bumpsB.push(1), uris: new Set() };
  swapMarkdownAssets('![a](crtx://crtx/assets/scoped-a.svg)', 'crtx', subA);
  swapMarkdownAssets('![b](crtx://crtx/assets/scoped-b.svg)', 'crtx', subB);

  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/scoped-a.svg', dataUrl: PNG });
  assert.deepEqual(bumpsA, [1]);
  assert.deepEqual(bumpsB, [], 'subB never looked up scoped-a, so it is not bumped for it');

  receiveAsset({ server: 'crtx', uri: 'crtx://crtx/assets/scoped-b.svg', dataUrl: PNG });
  assert.deepEqual(bumpsA, [1], 'subA never looked up scoped-b');
  assert.deepEqual(bumpsB, [1]);
});

// - useKnowledgeAssets under React 18's development build with StrictMode, on a first mount: the
//   component renders twice with fresh hooks and the second set is kept, then its effect runs
//   set-up, clean-up, set-up (react-dom.development.js: mountIndeterminateComponent,
//   commitDoubleInvokeEffectsInDEV). The small runtime below plays that order against a copy of the
//   module built with 'react' swapped for tests/react-hooks-stub.mjs.
const hooks = (() => {
  let fiber = null;
  let i = 0;
  const slot = (make) => { const s = (fiber.slots[i] ??= make()); i++; return s; };
  return {
    render(f, component) { fiber = f; i = 0; try { return component(); } finally { fiber = null; } },
    useState(init) {
      const f = fiber;
      const s = slot(() => ({ v: init }));
      return [s.v, (u) => { s.v = typeof u === 'function' ? u(s.v) : u; f.updates++; }];
    },
    useRef(init) { return slot(() => ({ current: init })); },
    useCallback(fn, deps) {
      const s = slot(() => ({ fn, deps }));
      if (deps.some((d, k) => !Object.is(d, s.deps[k]))) { s.fn = fn; s.deps = deps; }
      return s.fn;
    },
    // - every effect here has [] deps, so it is kept on the first render of a fiber only
    useEffect(fn) { const f = fiber; slot(() => { f.effects.push(fn); return {}; }); },
  };
})();
globalThis.__hooks = hooks;
const newFiber = () => ({ slots: [], effects: [], cleanups: [], updates: 0 });
const setUp = (f) => { f.cleanups = f.effects.map(fn => fn()); };
const cleanUp = (f) => { for (const c of f.cleanups) c?.(); f.cleanups = []; };

const withHooks = await import('./.build/knowledgeAssets-hooks.mjs');

test('a node mounted under StrictMode redraws when its picture arrives after the double set-up', () => {
  const uri = 'crtx://crtx/assets/strict.svg';
  const node = () => withHooks.useKnowledgeAssets('crtx').swapMarkdown(`![a](${uri})`);
  hooks.render(newFiber(), node);
  const kept = newFiber();
  assert.equal(hooks.render(kept, node), `![a](${uri})`);
  setUp(kept);
  cleanUp(kept);
  setUp(kept);

  withHooks.receiveAsset({ server: 'crtx', uri, dataUrl: PNG });
  assert.equal(kept.updates, 1, 'the mounted node is told its picture came');
  assert.equal(hooks.render(kept, node), `![a](${PNG})`);

  cleanUp(kept);
  withHooks.receiveAsset({ server: 'crtx', uri, dataUrl: PNG });
  assert.equal(kept.updates, 1, 'an unmounted node is told nothing');
});
