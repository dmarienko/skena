// - run: npx esbuild src/webview/canvas/knowledgeSearchState.ts --bundle --format=esm --outfile=tests/.build/knowledgeSearchState.mjs && node --test tests/knowledge-search-state.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { initialState, reduce, splitTags } from './.build/knowledgeSearchState.mjs';

const caps = { scopes: true, tags: true, recency: true, facets: true, write: true };
const servers = [{ name: 'crtx', capabilities: caps }, { name: 'notion', capabilities: caps }];
const hit = (uri) => ({ server: 'crtx', uri, title: uri, tags: [], snippet: '' });

test('splitTags takes the #tokens out of the query text', () => {
  assert.deepEqual(splitTags('mean #reversion rsi #bug'), { text: 'mean rsi', tags: ['reversion', 'bug'] });
});

test('splitTags leaves a query without tokens alone', () => {
  assert.deepEqual(splitTags('  mean   reversion '), { text: 'mean reversion', tags: [] });
});

test('splitTags keeps a # inside a word', () => {
  assert.deepEqual(splitTags('C#'), { text: 'C#', tags: [] });
});

test('move clamps at the last hit and does not wrap to the first', () => {
  const s = { ...initialState(servers), hits: [hit('a'), hit('b'), hit('c')], highlight: 2 };
  assert.equal(reduce(s, { kind: 'move', by: 1 }).highlight, 2);
  assert.equal(reduce({ ...s, highlight: 0 }, { kind: 'move', by: -1 }).highlight, 0);
  assert.equal(reduce({ ...s, highlight: 0 }, { kind: 'move', by: 1 }).highlight, 1);
});

test('move on empty hits returns the same state', () => {
  const s = initialState(servers);
  assert.equal(reduce(s, { kind: 'move', by: 1 }), s);
});

test('cycleScope walks all → a → b → all', () => {
  let s = { ...initialState(servers), scopes: ['a', 'b'] };
  s = reduce(s, { kind: 'cycleScope' });
  assert.equal(s.scope, 'a');
  s = reduce(s, { kind: 'cycleScope' });
  assert.equal(s.scope, 'b');
  s = reduce(s, { kind: 'cycleScope' });
  assert.equal(s.scope, 'all');
});

test('cycleScope with no scopes stays on all', () => {
  assert.equal(reduce(initialState(servers), { kind: 'cycleScope' }).scope, 'all');
});

test('hits resets the highlight and writes the count', () => {
  const s = { ...initialState(servers), hits: [hit('a')], highlight: 0, status: 'x' };
  const one = reduce(s, { kind: 'hits', hits: [hit('a')] });
  assert.equal(one.status, '1 result');
  const two = reduce({ ...s, highlight: 3 }, { kind: 'hits', hits: [hit('a'), hit('b')] });
  assert.equal(two.highlight, 0);
  assert.equal(two.status, '2 results');
  assert.equal(reduce(s, { kind: 'hits', hits: [] }).status, '0 results');
});

test('error clears the hits and shows the message', () => {
  const s = { ...initialState(servers), hits: [hit('a'), hit('b')], highlight: 1 };
  const next = reduce(s, { kind: 'error', message: 'server unreachable' });
  assert.deepEqual(next.hits, []);
  assert.equal(next.highlight, 0);
  assert.equal(next.status, 'server unreachable');
});

test('server switch resets scope, scopes and hits', () => {
  const s = { ...initialState(servers), scope: 'a', scopes: ['a', 'b'], hits: [hit('a')], highlight: 0 };
  const next = reduce(s, { kind: 'server', name: 'notion' });
  assert.equal(next.server, 'notion');
  assert.equal(next.scope, 'all');
  assert.deepEqual(next.scopes, []);
  assert.deepEqual(next.hits, []);
});

test('scopes and toggleRecency set their own field', () => {
  const s = initialState(servers);
  assert.deepEqual(reduce(s, { kind: 'scopes', scopes: ['a'] }).scopes, ['a']);
  assert.equal(reduce(s, { kind: 'toggleRecency' }).recency, true);
});

test('type keeps everything but the query', () => {
  const s = { ...initialState(servers), hits: [hit('a')], highlight: 0 };
  const next = reduce(s, { kind: 'type', query: 'rsi' });
  assert.equal(next.query, 'rsi');
  assert.deepEqual(next.hits, s.hits);
});

test('initialState with no server carries the settings message', () => {
  const s = initialState([]);
  assert.equal(s.server, '');
  assert.equal(s.status, 'no knowledge server configured (skena.knowledge.servers)');
  assert.equal(initialState(servers).status, '');
  assert.equal(initialState(servers).server, 'crtx');
});
