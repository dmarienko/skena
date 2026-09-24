// - run: npx esbuild src/webview/canvas/knowledgeSearchState.ts --bundle --format=esm --outfile=tests/.build/knowledgeSearchState.mjs && npx esbuild src/extension/knowledge/service.ts --bundle --format=esm --platform=node --outfile=tests/.build/service.mjs && node --test tests/knowledge-fake-provider.mjs
// - a second kind of knowledge server, with none of crtx's capabilities: what the dialog shows,
//   what it searches for, and what the refresh runner makes of its answers.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { queryFor, showsFilterRow, showsServerSelector } from './.build/knowledgeSearchState.mjs';
import { KnowledgeService } from './.build/service.mjs';

const NONE = { scopes: false, tags: false, recency: false, facets: false, write: false, assets: false };

// - a provider with no capabilities field at all: an adapter written to the interface minus the
//   parts v1 added later
const fakeProvider = (text) => ({
  name: 'fake',
  kind: 'fake',
  async fetch(uri) {
    return { uri, title: 'a note', text, fetchedAt: '2026-09-19T12:00:00.000Z' };
  },
});

test('a server with no capabilities shows no filter row, and one server needs no selector', () => {
  assert.equal(showsFilterRow(NONE), false);
  assert.equal(showsFilterRow(undefined), false);
  assert.equal(showsServerSelector([{ name: 'fake' }]), false);
  assert.equal(showsServerSelector([{ name: 'fake' }, { name: 'crtx' }]), true);
  // - one capability is enough for the row
  assert.equal(showsFilterRow({ ...NONE, recency: true }), true);
});

test('a #tag stays in the query text for a server with no tags filter', () => {
  assert.deepEqual(queryFor('notes #bug', NONE), { text: 'notes #bug', tags: [] });
  assert.deepEqual(queryFor('notes #bug', { ...NONE, tags: true }), { text: 'notes', tags: ['bug'] });
});

test('fetch on such a provider answers a well-formed KnowledgeText', async () => {
  const got = await fakeProvider('body').fetch('fake://a');
  assert.deepEqual(Object.keys(got).sort(), ['fetchedAt', 'text', 'title', 'uri']);
  assert.equal(got.uri, 'fake://a');
  assert.equal(got.text, 'body');
  assert.ok(!Number.isNaN(Date.parse(got.fetchedAt)));
});

test('startRefresh drives a provider with no capabilities field: changed text, same text, one done', async () => {
  const svc = new KnowledgeService();
  svc.configure([]);
  svc.providers.set('fake', { configJson: '', provider: fakeProvider('new') });
  svc.providers.set('same', { configJson: '', provider: { ...fakeProvider('old'), name: 'same' } });

  const batches = [];
  const all = await new Promise(resolve => {
    const out = [];
    svc.startRefresh('A', [
      { id: 'a', server: 'fake', uri: 'fake://a', text: 'old' },
      { id: 'b', server: 'same', uri: 'fake://b', text: 'old' },
    ], (batch, finished) => {
      batches.push(finished);
      out.push(...batch);
      if (finished) resolve(out);
    });
  });

  assert.deepEqual(all.find(o => o.id === 'a'),
    { id: 'a', text: 'new', title: 'a note', fetchedAt: '2026-09-19T12:00:00.000Z', changed: true });
  assert.deepEqual(all.find(o => o.id === 'b'), { id: 'b', fetchedAt: '2026-09-19T12:00:00.000Z' });
  assert.equal(batches.filter(Boolean).length, 1);
});

test('the service turns an image into a data url, keeps it, and drops the oldest past its bound', async () => {
  const asked = [];
  // - 30 MB each: the second fetch does not fit beside the first in the 50 MB the service keeps
  const big = (n) => ({ mime: 'image/png', bytes: new Uint8Array(30 * 1024 * 1024).fill(n) });
  const svc = new KnowledgeService();
  svc.configure([]);
  svc.providers.set('fake', { configJson: '', provider: { ...fakeProvider('x'), async asset(uri) { asked.push(uri); return uri === 'fake://small' ? { mime: 'image/svg+xml', bytes: new Uint8Array([60, 62]) } : big(1); } } });

  assert.equal(await svc.asset('fake', 'fake://small'), 'data:image/svg+xml;base64,PD4=');
  assert.equal(await svc.asset('fake', 'fake://small'), 'data:image/svg+xml;base64,PD4=');
  assert.deepEqual(asked, ['fake://small']);

  await svc.asset('fake', 'fake://a');
  await svc.asset('fake', 'fake://b');
  await svc.asset('fake', 'fake://small');
  assert.deepEqual(asked, ['fake://small', 'fake://a', 'fake://b', 'fake://small']);
});

test('the service keeps a cache slot per server, and shares one request for concurrent callers', async () => {
  const asked = [];
  let resolveFetch;
  const svc = new KnowledgeService();
  svc.configure([]);
  const provider = { ...fakeProvider('x'), async asset(uri) { asked.push(uri); return new Promise(r => { resolveFetch = r; }); } };
  svc.providers.set('fake', { configJson: '', provider });
  svc.providers.set('other', { configJson: '', provider: { ...provider, name: 'other' } });

  // - two callers ask for the same (server, uri) before the provider has answered
  const p1 = svc.asset('fake', 'fake://shared.svg');
  const p2 = svc.asset('fake', 'fake://shared.svg');
  assert.equal(asked.length, 1, 'one request in flight, not two');
  resolveFetch({ mime: 'image/svg+xml', bytes: new Uint8Array([60, 62]) });
  assert.deepEqual(await Promise.all([p1, p2]), ['data:image/svg+xml;base64,PD4=', 'data:image/svg+xml;base64,PD4=']);

  // - the same uri text under a different server is its own cache slot, so it is fetched again
  const p3 = svc.asset('other', 'fake://shared.svg');
  assert.equal(asked.length, 2);
  resolveFetch({ mime: 'image/svg+xml', bytes: new Uint8Array([60, 62]) });
  await p3;
});
