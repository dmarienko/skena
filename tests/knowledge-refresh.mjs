// - run: npx esbuild src/shared/knowledge/refresh.ts --bundle --format=esm --outfile=tests/.build/refresh.mjs && npx esbuild src/extension/knowledge/service.ts --bundle --format=esm --platform=node --outfile=tests/.build/service.mjs && node --test tests/knowledge-refresh.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_IN_FLIGHT, done, drain, newQueue, outcomeOf, settle, staleTargets, takeNext } from './.build/refresh.mjs';
import { KnowledgeService } from './.build/service.mjs';

const NOW = new Date('2026-09-19T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const target = (id, server = 'crtx', extra = {}) => ({
  id, server, uri: `crtx://${id}`, text: 'old', fetchedAt: hoursAgo(1), ...extra,
});

test('staleTargets keeps a copy older than the limit', () => {
  const t = target('a', 'crtx', { fetchedAt: hoursAgo(25) });
  assert.deepEqual(staleTargets([t], NOW, 24), [t]);
});

test('staleTargets drops a copy younger than the limit', () => {
  assert.deepEqual(staleTargets([target('a', 'crtx', { fetchedAt: hoursAgo(23) })], NOW, 24), []);
});

test('staleTargets treats an unparseable timestamp as stale', () => {
  const t = target('a', 'crtx', { fetchedAt: 'never' });
  assert.deepEqual(staleTargets([t], NOW, 24), [t]);
});

test('outcomeOf moves only the timestamp when the text is the same', () => {
  const t = target('a');
  assert.deepEqual(
    outcomeOf(t, { text: 'old', title: 'A', fetchedAt: '2026-09-19T12:00:00Z' }),
    { id: 'a', fetchedAt: '2026-09-19T12:00:00Z' },
  );
});

test('outcomeOf marks a node whose text came back different', () => {
  const t = target('a');
  assert.deepEqual(
    outcomeOf(t, { text: 'new', title: 'A', fetchedAt: '2026-09-19T12:00:00Z' }),
    { id: 'a', text: 'new', title: 'A', fetchedAt: '2026-09-19T12:00:00Z', changed: true },
  );
});

test('outcomeOf reports a gone source as an error and keeps no text', () => {
  assert.deepEqual(outcomeOf(target('a'), { gone: 'heading no longer in the file' }),
    { id: 'a', error: 'heading no longer in the file' });
});

test('outcomeOf reports a failed call as an error', () => {
  assert.deepEqual(outcomeOf(target('a'), { error: 'timed out' }), { id: 'a', error: 'timed out' });
});

test('takeNext gives at most MAX_IN_FLIGHT per server and takes another server meanwhile', () => {
  assert.equal(MAX_IN_FLIGHT, 3);
  const q = newQueue([target('a'), target('b'), target('c'), target('d'), target('e', 'notion')]);
  assert.deepEqual([takeNext(q).id, takeNext(q).id, takeNext(q).id], ['a', 'b', 'c']);
  // - crtx is full, so the next one comes from the other server, and then nothing
  assert.equal(takeNext(q).id, 'e');
  assert.equal(takeNext(q), undefined);
  // - one crtx call finishing frees one slot
  settle(q, target('a'), { id: 'a', fetchedAt: 'x' });
  assert.equal(takeNext(q).id, 'd');
});

test('takeNext skips a stopped server', () => {
  const q = newQueue([target('a'), target('b', 'notion')]);
  q.stopped.add('crtx');
  assert.equal(takeNext(q).id, 'b');
  assert.equal(takeNext(q), undefined);
});

test('settle with serverDown drops that server pending work and leaves the others', () => {
  const q = newQueue([target('a'), target('b'), target('c', 'notion')]);
  const t = takeNext(q);
  settle(q, t, { id: t.id, error: 'not reachable' }, true);
  assert.deepEqual(q.pending.map(p => p.id), ['c']);
  assert.equal(q.stopped.has('crtx'), true);
  assert.equal(takeNext(q).id, 'c');
});

test('drain returns what is ready and empties it', () => {
  const q = newQueue([target('a')]);
  const t = takeNext(q);
  settle(q, t, { id: 'a', fetchedAt: 'x' });
  assert.deepEqual(drain(q), [{ id: 'a', fetchedAt: 'x' }]);
  assert.deepEqual(drain(q), []);
});

test('done is false while work is queued or in flight, true once every call settled', () => {
  const q = newQueue([target('a')]);
  assert.equal(done(q), false);
  const t = takeNext(q);
  assert.equal(done(q), false);
  settle(q, t, { id: 'a', fetchedAt: 'x' });
  assert.equal(done(q), true);
});

// - the runner: KnowledgeService.startRefresh with stub providers in place of the configured ones,
//   so nothing here opens a socket

const service = (fetchers) => {
  const svc = new KnowledgeService();
  svc.configure([]);
  for (const [name, fetch] of Object.entries(fetchers)) svc.providers.set(name, { configJson: '', provider: { name, kind: 'stub', fetch } });
  return svc;
};

// - collect every outcome of one run and resolve once the run reports itself finished
const run = (svc, key, targets) => new Promise(resolve => {
  const all = [];
  svc.startRefresh(key, targets, (batch, finished) => {
    all.push(...batch);
    if (finished) resolve(all);
  });
});

const after = (ms, f) => new Promise(res => setTimeout(() => res(f()), ms));
const fresh = async () => ({ text: 'new', title: 'T', fetchedAt: '2026-09-19T12:00:00Z' });

test('startRefresh: a uri the adapter rejects is that node error, and the others still refresh', async () => {
  // - the bad uri fails first and the queue still holds d, so a run that took this for a dead
  //   server would drop d
  const svc = service({
    crtx: (uri) => {
      if (uri === 'crtx://b') throw new Error(`not a crtx uri: ${uri}`);
      return after(20, () => ({ text: 'new', title: 'T', fetchedAt: 'now' }));
    },
  });
  const out = await run(svc, 'A', [target('a'), target('b'), target('c'), target('d')]);
  assert.deepEqual(out.map(o => o.id).sort(), ['a', 'b', 'c', 'd']);
  assert.equal(out.find(o => o.id === 'b').error, 'not a crtx uri: crtx://b');
  assert.equal(out.filter(o => o.changed === true).length, 3);
});

test('startRefresh: an HTTP status drops the rest of that server and leaves the other one running', async () => {
  const svc = service({
    down: async () => { throw new Error('HTTP 503 from http://down/mcp'); },
    up:   fresh,
  });
  const out = await run(svc, 'A', [
    target('d1', 'down'), target('d2', 'down'), target('d3', 'down'), target('d4', 'down'), target('u1', 'up'),
  ]);
  // - three calls were already out when the first failure landed; the fourth never went
  assert.equal(out.filter(o => o.id.startsWith('d')).length, MAX_IN_FLIGHT);
  assert.equal(out.find(o => o.id === 'u1').changed, true);
});

test('startRefresh: a run for another canvas does not cancel this one', async () => {
  const svc = service({ crtx: () => after(20, () => ({ text: 'new', title: 'T', fetchedAt: 'now' })) });
  const [a, b] = await Promise.all([run(svc, 'A', [target('a')]), run(svc, 'B', [target('b')])]);
  assert.deepEqual(a.map(o => o.id), ['a']);
  assert.deepEqual(b.map(o => o.id), ['b']);
});

test('startRefresh: a second run for the same canvas cancels the first', async () => {
  const svc = service({ crtx: () => after(20, () => ({ text: 'new', title: 'T', fetchedAt: 'now' })) });
  const first  = run(svc, 'A', [target('a')]);
  const second = run(svc, 'A', [target('b')]);
  assert.deepEqual(await first, []);   // - cancelled before its fetch came back, and reported finished
  assert.deepEqual((await second).map(o => o.id), ['b']);
});

test('startRefresh: the run reports itself finished exactly once', async () => {
  const svc = service({ crtx: fresh });
  const flags = [];
  await new Promise(resolve => svc.startRefresh('A', [target('a')], (_batch, finished) => {
    flags.push(finished);
    if (finished) resolve();
  }));
  assert.equal(flags.filter(Boolean).length, 1);
  assert.equal(flags[flags.length - 1], true);
});

test('startRefresh: cancel aborts the fetches already out', async () => {
  let signal;
  const svc = service({ crtx: (_uri, s) => { signal = s; return after(50, () => ({ text: 'new', title: 'T', fetchedAt: 'now' })); } });
  const h = svc.startRefresh('A', [target('a')], () => {});
  assert.equal(signal.aborted, false);
  h.cancel();
  assert.equal(signal.aborted, true);
});

test('configure keeps the provider of a server whose config did not change', () => {
  const cfg = { name: 'crtx', kind: 'crtx', url: 'http://h:8788/mcp' };
  const svc = new KnowledgeService();
  svc.configure([cfg]);
  const first = svc.provider('crtx');
  svc.configure([{ ...cfg }]);
  assert.equal(svc.provider('crtx'), first, 'same config: the transport and its initialize are kept');
  svc.configure([{ ...cfg, url: 'http://other:8788/mcp' }]);
  assert.notEqual(svc.provider('crtx'), first, 'a url edit builds a new one');
  svc.configure([]);
  assert.throws(() => svc.provider('crtx'), /no knowledge server/);
});
