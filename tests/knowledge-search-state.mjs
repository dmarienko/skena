// - run: npx esbuild src/webview/canvas/knowledgeSearchState.ts --bundle --format=esm --outfile=tests/.build/knowledgeSearchState.mjs && npx esbuild src/shared/knowledge/crtxUri.ts --bundle --format=esm --outfile=tests/.build/crtxUri.mjs && node --test tests/knowledge-search-state.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileUriOf, groupHits, initialState, reduce, sectionLabel, splitTags, wholeDocumentHit } from './.build/knowledgeSearchState.mjs';
import { parseCrtxUri } from './.build/crtxUri.mjs';

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

// - a crtx search row: title is the heading, or the file's name for a whole-file hit
const crtx = (file, heading = '', server = 'crtx') => ({
  server, uri: `crtx://crtx/${file}${heading ? `#${heading}` : ''}`,
  title: heading || file.slice(file.lastIndexOf('/') + 1), subtitle: `crtx · ${file}`, tags: [], snippet: '',
});
// - one string per row: a file line, a plain row, or an indented row under a file line
const shape = (rows) => rows.map(r => r.kind === 'file' ? `file ${r.name} ${r.count}` : `${r.underFile ? '  ' : ''}${r.hit.uri}`);

test('a document with one hit is one plain row', () => {
  const rows = groupHits([crtx('a.md', 'Intro'), crtx('b.md')]);
  assert.deepEqual(shape(rows), ['crtx://crtx/a.md#Intro', 'crtx://crtx/b.md']);
});

test('hits of one document follow a file line, in rank order, where the best-ranked one was', () => {
  const nt = 'projects/night-trader.md';
  const rows = groupHits([
    crtx('x.md', 'X'), crtx(nt, 'Intro'), crtx('log.md', 'L'), crtx(nt, 'Rules'),
    crtx('z.md'), crtx(nt, 'Sizing'), crtx(nt),
  ]);
  assert.deepEqual(shape(rows), [
    'crtx://crtx/x.md#X',
    'file night-trader.md 4',
    `  crtx://crtx/${nt}#Intro`,
    `  crtx://crtx/${nt}#Rules`,
    `  crtx://crtx/${nt}#Sizing`,
    `  crtx://crtx/${nt}`,
    'crtx://crtx/log.md#L',
    'crtx://crtx/z.md',
  ]);
  assert.equal(rows[1].subtitle, `crtx · ${nt}`);
});

test('the same path on two servers is two documents', () => {
  const rows = groupHits([crtx('a.md', 'One', 'crtx'), crtx('a.md', 'Two', 'mirror')]);
  assert.deepEqual(shape(rows), ['crtx://crtx/a.md#One', 'crtx://crtx/a.md#Two']);
  assert.deepEqual(rows.map(r => r.hit.server), ['crtx', 'mirror']);
});

test('a row under a file line reads its heading, or "whole file" when it has none', () => {
  assert.equal(sectionLabel(crtx('a.md', 'Rules')), '› Rules');
  assert.equal(sectionLabel(crtx('a.md')), '› whole file');
});

test('move passes over file lines and stops at both ends', () => {
  // - rows: a#1 · file b.md · b#1 · b#2 · c
  let s = reduce(initialState(servers), { kind: 'hits', hits: [crtx('a.md', '1'), crtx('b.md', '1'), crtx('b.md', '2'), crtx('c.md')] });
  assert.equal(s.highlight, 0);
  const seen = [];
  for (let k = 0; k < 5; k++) { s = reduce(s, { kind: 'move', by: 1 }); seen.push(s.highlight); }
  assert.deepEqual(seen, [2, 3, 4, 4, 4]);
  s = reduce({ ...s, highlight: 2 }, { kind: 'move', by: -1 });
  assert.equal(s.highlight, 0);
  assert.equal(reduce(s, { kind: 'move', by: -1 }).highlight, 0);
});

test('when the best-ranked document has several hits, the highlight starts on its first one and ↑ keeps it there', () => {
  const s = reduce(initialState(servers), { kind: 'hits', hits: [crtx('a.md', '1'), crtx('a.md', '2'), crtx('b.md')] });
  assert.equal(s.highlight, 1);
  assert.equal(reduce(s, { kind: 'move', by: -1 }).highlight, 1);
  assert.equal(s.status, '3 results');
});

test('fileUriOf drops the fragment and keeps a uri that has none', () => {
  assert.equal(fileUriOf('crtx://crtx/projects/night-trader.md#Rules'), 'crtx://crtx/projects/night-trader.md');
  assert.equal(fileUriOf('crtx://crtx/projects/night-trader.md'), 'crtx://crtx/projects/night-trader.md');
});

test('fileUriOf splits at the first "#", so a heading holding "#" does not leave part of itself behind', () => {
  const uri = 'crtx://crtx/log.md#[2026-09-27] night-trader | gap #2 rules';
  assert.equal(fileUriOf(uri), 'crtx://crtx/log.md');
  // - the adapter reads the same split: file log.md, no heading, so its fetch calls read
  assert.deepEqual(parseCrtxUri(fileUriOf(uri)), { vault: 'crtx', file: 'log.md', heading: '' });
  assert.equal(parseCrtxUri(uri).file, 'log.md');
});

test('Shift+Enter picks the hit\'s whole document, titled by the file', () => {
  const whole = wholeDocumentHit(crtx('projects/night-trader.md', 'Intro'));
  assert.equal(whole.uri, 'crtx://crtx/projects/night-trader.md');
  assert.equal(whole.title, 'night-trader.md');
  assert.equal(whole.server, 'crtx');
});
