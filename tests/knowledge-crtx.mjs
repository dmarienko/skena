// - run: npx esbuild src/extension/knowledge/adapters/crtx.ts --bundle --format=esm --platform=node --outfile=tests/.build/crtxAdapter.mjs && npx esbuild src/shared/knowledge/crtxUri.ts --bundle --format=esm --outfile=tests/.build/crtxUri.mjs && node --test tests/knowledge-crtx.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseCrtxUri, buildCrtxUri, crtxReaderUrl } from './.build/crtxUri.mjs';
import { createCrtxProvider, rewriteImageRefs } from './.build/crtxAdapter.mjs';

test('uri round-trips, with and without a heading', () => {
  assert.deepEqual(parseCrtxUri('crtx://crtx/projects/skena.md#2026-09-19 — state'), { vault: 'crtx', file: 'projects/skena.md', heading: '2026-09-19 — state' });
  assert.deepEqual(parseCrtxUri('crtx://lib/a b.md'), { vault: 'lib', file: 'a b.md', heading: '' });
  assert.equal(buildCrtxUri({ vault: 'lib', file: 'papers/a.md', heading: 'First' }), 'crtx://lib/papers/a.md#First');
  assert.throws(() => parseCrtxUri('notion://x'), /crtx/);
});

test('reader url encodes the file and points at port 8787 of the server host', () => {
  assert.equal(crtxReaderUrl('crtx://lib/papers/a b.md#x', 'http://kb-server:8788/mcp'), 'http://kb-server:8787/#lib/papers%2Fa%20b.md');
});

function fake(answers) {
  const calls = [];
  const signals = [];
  return { calls, signals, callTool: async (name, args, signal) => { calls.push({ name, args }); signals.push(signal); const a = answers[name]; if (a instanceof Error) throw a; return typeof a === 'function' ? a(args) : a; } };
}

test('search maps hits and passes filters; full_text is off', async () => {
  const t = fake({ search: { result: [{ vault: 'crtx', file: 'log.md', heading: 'h', date: '2026-09-19', tags: ['a'], id: 'x', project: 'p', snippet: 'snip', uri: 'crtx://crtx/log.md#h' }] } });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const hits = await p.search({ text: 'q', scope: 'crtx', tags: ['a'], recency: true, top: 20 });
  assert.deepEqual(t.calls[0], { name: 'search', args: { query: 'q', vault: 'crtx', tags: ['a'], recency: true, top: 20, full_text: false } });
  assert.deepEqual(hits, [{ server: 'crtx', uri: 'crtx://crtx/log.md#h', title: 'h', subtitle: 'crtx · log.md', date: '2026-09-19', tags: ['a'], snippet: 'snip' }]);
});

test('a hit with no heading is titled with the file name; the subtitle keeps the whole path', async () => {
  const t = fake({ search: [{ vault: 'crtx', file: 'projects/skena.md', heading: '' }] });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const [hit] = await p.search({ text: 'q', top: 5 });
  assert.equal(hit.title, 'skena.md');
  assert.equal(hit.subtitle, 'crtx · projects/skena.md');
});

test('search with scope "all" or undefined sends no vault; a bare array result is accepted', async () => {
  const t = fake({ search: [] });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  await p.search({ text: 'q', top: 5 });
  assert.equal('vault' in t.calls[0].args, false);
});

test('fetch reads one section, or the file when the heading is empty; a missing heading is KnowledgeGoneError', async () => {
  const t = fake({ read_section: 'sec text', read: 'file text' });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const a = await p.fetch('crtx://crtx/log.md#h');
  assert.equal(a.text, 'sec text'); assert.equal(a.title, 'h (log.md)'); assert.match(a.fetchedAt, /^\d{4}-/);
  assert.deepEqual(t.calls[0], { name: 'read_section', args: { vault: 'crtx', file: 'log.md', heading: 'h' } });
  const b = await p.fetch('crtx://crtx/log.md'); assert.equal(b.text, 'file text'); assert.equal(b.title, 'log.md');
  const gone = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, fake({ read_section: new Error(`Error executing tool read_section: no section 'x' in log.md; available: ['a', 'b']`) }));
  await assert.rejects(gone.fetch('crtx://crtx/log.md#x'), e => e.name === 'KnowledgeGoneError');
});

test('a section whose whole text is JSON is shown as JSON, not as [object Object]', async () => {
  // - the transport parses a reply that is JSON, so the adapter gets an object here
  const t = fake({ read_section: { a: 1 }, read: [1, 2] });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  assert.equal((await p.fetch('crtx://crtx/log.md#h')).text, '{\n  "a": 1\n}');
  assert.equal((await p.fetch('crtx://crtx/log.md')).text, '[\n  1,\n  2\n]');
  const empty = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, fake({ read: null }));
  assert.equal((await empty.fetch('crtx://crtx/log.md')).text, '');
});

test('fetch passes the caller\'s signal to the transport', async () => {
  const t = fake({ read_section: 'sec text' });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const ctl = new AbortController();
  await p.fetch('crtx://crtx/log.md#h', ctl.signal);
  assert.equal(t.signals[0], ctl.signal);
});

test('a missing file or an unknown vault is gone; an unknown tool is not', async () => {
  const mk = err => createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, fake({ read: new Error(err), read_section: new Error(err) }));
  await assert.rejects(mk(`Error executing tool read: file not found: 'log.md'`).fetch('crtx://crtx/log.md'), e => e.name === 'KnowledgeGoneError');
  await assert.rejects(mk(`Error executing tool read: unknown vault: 'nope'`).fetch('crtx://nope/log.md'), e => e.name === 'KnowledgeGoneError');
  // - an older server, or a wrong kind: the uri may still be fine, so the node keeps its text
  await assert.rejects(mk('Unknown tool: read_section').fetch('crtx://crtx/log.md#x'), e => e.name === 'Error' && /Unknown tool/.test(e.message));
});

test('scopes and facets', async () => {
  const t = fake({ list_vaults: { result: [{ name: 'crtx', path: '/x' }, { name: 'diary', path: '/y' }] }, facets: { tags: [['research', 12], ['bug', 3]], projects: [['skena', 5]] } });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  assert.deepEqual(await p.scopes(), ['crtx', 'diary']);
  assert.deepEqual(await p.facets('crtx'), { tags: [['research', 12], ['bug', 3]] });
  assert.deepEqual(t.calls[1].args, { vault: 'crtx' });
});

test('capabilities and openUrl', () => {
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://kb-server:8788/mcp' }, fake({}));
  assert.deepEqual(p.capabilities, { scopes: true, tags: true, recency: true, facets: true, write: true, assets: true });
  assert.equal(p.openUrl('crtx://lib/a.md#h'), 'http://kb-server:8787/#lib/a.md');
});

test('write creates a note; the reply\'s file becomes the uri', async () => {
  const t = fake({ create_note: { file: 'log.md' } });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const res = await p.write({ title: 't', text: 'body', tags: ['research'], scope: 'crtx', source: { canvas: 'c', nodeIds: ['n1'], kind: 'node' } });
  assert.deepEqual(t.calls[0], { name: 'create_note', args: { vault: 'crtx', title: 't', content: 'body', agent: 'skena', tags: ['research'] } });
  assert.equal(res.uri, 'crtx://crtx/log.md');
});

test('write passes dest when the caller gives one', async () => {
  const t = fake({ create_note: { ok: true, file: 'projects/skena.md', vault: 'crtx' } });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  const res = await p.write({ title: 't', text: 'body', scope: 'crtx', dest: 'projects', source: { canvas: 'c', nodeIds: ['n1'], kind: 'node' } });
  assert.deepEqual(t.calls[0], { name: 'create_note', args: { vault: 'crtx', title: 't', content: 'body', agent: 'skena', dest: 'projects' } });
  assert.equal(res.uri, 'crtx://crtx/projects/skena.md');
});

test('append adds to an existing file, with no tags in the call', async () => {
  const t = fake({ append_note: {} });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  await p.append('crtx://crtx/log.md', { title: 't', text: 'more', source: { canvas: 'c', nodeIds: ['n1'], kind: 'node' } });
  assert.deepEqual(t.calls[0], { name: 'append_note', args: { vault: 'crtx', file: 'log.md', content: 'more', agent: 'skena' } });
});

const REF = { vault: 'crtx', file: 'projects/x.md' };

test('an image under the vault assets/ becomes a crtx uri, from any depth', () => {
  assert.equal(rewriteImageRefs('![a](../assets/a.svg)', REF), '![a](crtx://crtx/assets/a.svg)');
  assert.equal(rewriteImageRefs('![b](assets/b.png)', { vault: 'crtx', file: 'log.md' }), '![b](crtx://crtx/assets/b.png)');
  assert.equal(rewriteImageRefs('![c](../assets/nr7/1h-mid.svg)', { vault: 'lib', file: 'experiments/e.md' }), '![c](crtx://lib/assets/nr7/1h-mid.svg)');
  // - a title after the path is kept
  assert.equal(rewriteImageRefs('![a](../assets/a.svg "cap")', REF), '![a](crtx://crtx/assets/a.svg "cap")');
});

test('a reference that lands outside assets/ is escaped, so it reads as the text it is', () => {
  assert.equal(rewriteImageRefs('![a](./images/NAME.jpg)', REF), '\\![a](./images/NAME.jpg)');
  assert.equal(rewriteImageRefs('![](rel)', REF), '\\![](rel)');
  assert.equal(rewriteImageRefs('![a]()', REF), '\\![a]()');
  // - out of the vault altogether
  assert.equal(rewriteImageRefs('![a](../../assets/a.svg)', { vault: 'crtx', file: 'log.md' }), '\\![a](../../assets/a.svg)');
  assert.equal(rewriteImageRefs('![a](/etc/passwd.png)', REF), '\\![a](/etc/passwd.png)');
});

test('an absolute reference of any scheme is left alone, and so is one already escaped', () => {
  assert.equal(rewriteImageRefs('![a](https://x/y.png)', REF), '![a](https://x/y.png)');
  assert.equal(rewriteImageRefs('![a](data:image/png;base64,AA)', REF), '![a](data:image/png;base64,AA)');
  assert.equal(rewriteImageRefs('\\![a](rel)', REF), '\\![a](rel)');
});

test('a sample of the syntax in a code span or a fenced block keeps its text', () => {
  assert.equal(rewriteImageRefs('refs like `![](rel)` are resolved', REF), 'refs like `![](rel)` are resolved');
  assert.equal(rewriteImageRefs('```\n![a](rel)\n```\n![b](rel)', REF), '```\n![a](rel)\n```\n\\![b](rel)');
  assert.equal(rewriteImageRefs('~~~md\n![a](../assets/a.svg)\n~~~', REF), '~~~md\n![a](../assets/a.svg)\n~~~');
});

test('fetch rewrites the images of the section it read', async () => {
  const t = fake({ read_section: 'see ![a](../assets/a.svg)', read: 'see ![b](rel)' });
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, t);
  assert.equal((await p.fetch('crtx://crtx/projects/x.md#h')).text, 'see ![a](crtx://crtx/assets/a.svg)');
  assert.equal((await p.fetch('crtx://crtx/projects/x.md')).text, 'see \\![b](rel)');
});

test('asset asks the web app on port 8787 for the file, assets/ path and all', async () => {
  const calls = [];
  const got = { mime: 'image/svg+xml', bytes: new Uint8Array([1, 2]) };
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://kb-server:8788/mcp' }, fake({}), async (url, signal) => { calls.push({ url, signal }); return got; });
  assert.deepEqual(await p.asset('crtx://crtx/assets/nr7/1h mid.svg'), got);
  assert.equal(calls[0].url, 'http://kb-server:8787/api/asset?vault=crtx&file=assets%2Fnr7%2F1h%20mid.svg');
  const ctl = new AbortController();
  await p.asset('crtx://crtx/assets/a.svg', ctl.signal);
  assert.equal(calls[1].signal, ctl.signal);
});

test('a percent-encoded path decodes before it resolves', () => {
  assert.equal(rewriteImageRefs('![a](../assets/my%20chart.svg)', REF), '![a](crtx://crtx/assets/my chart.svg)');
  assert.equal(rewriteImageRefs('![a](../assets/50%25.svg)', REF), '![a](crtx://crtx/assets/50%.svg)');
  // - a stray "%" that is not a valid escape is kept as written, not thrown away
  assert.equal(rewriteImageRefs('![a](../assets/100%.svg)', REF), '![a](crtx://crtx/assets/100%.svg)');
});

test('a <…> destination may hold spaces; a bare one may not', () => {
  assert.equal(rewriteImageRefs('![a](<../assets/my chart.svg>)', REF), '![a](crtx://crtx/assets/my chart.svg)');
  assert.equal(rewriteImageRefs('![a](<../assets/my chart.svg> "cap")', REF), '![a](crtx://crtx/assets/my chart.svg "cap")');
  // - a bare destination with a raw space is not valid image syntax to begin with (CommonMark
  //   would not read it as one either), so it is left exactly as written
  assert.equal(rewriteImageRefs('![a](../assets/my chart.svg)', REF), '![a](../assets/my chart.svg)');
});

test('asset refuses a uri outside the vault assets/, and a server built without the hook', async () => {
  const calls = [];
  const p = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, fake({}), async url => { calls.push(url); return { mime: 'x', bytes: new Uint8Array() }; });
  await assert.rejects(p.asset('crtx://crtx/projects/x.md'), /not an asset/);
  await assert.rejects(p.asset('crtx://crtx/assets/../secrets/a.png'), /not an asset/);
  assert.equal(calls.length, 0);
  const noHook = createCrtxProvider({ name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' }, fake({}));
  await assert.rejects(noHook.asset('crtx://crtx/assets/a.svg'), /cannot read assets/);
});
