// - run: npx esbuild src/shared/sectionRuns.ts --bundle --format=esm --outfile=tests/.build/sectionRuns.mjs && node --test tests/section-runs.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SectionRuns } from './.build/sectionRuns.mjs';

// - a cell runner whose cells finish only when the test says so
function gated() {
  const ran = [];
  const open = new Map();
  const runCell = id => new Promise(res => { ran.push(id); open.set(id, res); });
  const finish = (id, st = 'ok') => { open.get(id)(st); open.delete(id); };
  return { ran, runCell, finish };
}
const tick = () => new Promise(r => setImmediate(r));

test('run: every cell in order, then done', async () => {
  const runs = new SectionRuns();
  const ran = [];
  const r = await runs.run('/a.canvas', 's1', ['c1', 'c2', 'c3'], async id => { ran.push(id); return 'ok'; });
  assert.equal(r, 'done');
  assert.deepEqual(ran, ['c1', 'c2', 'c3']);
  assert.deepEqual(runs.runningIn('/a.canvas'), []);
});

test('stop: the cells still queued are not run; stop names the running cell for the interrupt', async () => {
  const runs = new SectionRuns();
  const g = gated();
  const p = runs.run('/a.canvas', 's1', ['c1', 'c2', 'c3', 'c4'], g.runCell);
  await tick(); g.finish('c1'); await tick();
  assert.deepEqual(runs.stop('/a.canvas', 's1'), { cellId: 'c2' });
  // - the interrupted cell may still end 'ok' (code that catches KeyboardInterrupt): the queue stays dropped
  g.finish('c2', 'ok');
  assert.equal(await p, 'stopped');
  assert.deepEqual(g.ran, ['c1', 'c2']);
  assert.deepEqual(runs.runningIn('/a.canvas'), []);
});

test('stop: no run for that section → null', () => {
  assert.equal(new SectionRuns().stop('/a.canvas', 's1'), null);
});

test('run: the first error ends the run', async () => {
  const runs = new SectionRuns();
  const ran = [];
  const r = await runs.run('/a.canvas', 's1', ['c1', 'c2', 'c3'], async id => { ran.push(id); return id === 'c2' ? 'error' : 'ok'; });
  assert.equal(r, 'error');
  assert.deepEqual(ran, ['c1', 'c2']);
});

test('run: a second run of a running section is refused; the first one goes on', async () => {
  const runs = new SectionRuns();
  const g = gated();
  const first = runs.run('/a.canvas', 's1', ['c1', 'c2'], g.runCell);
  await tick();
  assert.equal(await runs.run('/a.canvas', 's1', ['c1'], g.runCell), 'busy');
  assert.deepEqual(runs.runningIn('/a.canvas'), ['s1']);
  g.finish('c1'); await tick(); g.finish('c2');
  assert.equal(await first, 'done');
  assert.deepEqual(g.ran, ['c1', 'c2']);
});

test('runningIn: by canvas; the same section id on another canvas is another run', async () => {
  const runs = new SectionRuns();
  const g = gated();
  const a = runs.run('/a.canvas', 's1', ['a1'], g.runCell);
  const b = runs.run('/b.canvas', 's1', ['b1'], g.runCell);
  await tick();
  assert.deepEqual(runs.runningIn('/a.canvas'), ['s1']);
  assert.deepEqual(runs.runningIn('/b.canvas'), ['s1']);
  runs.stop('/a.canvas', 's1');
  g.finish('a1'); g.finish('b1');
  assert.equal(await a, 'stopped');
  assert.equal(await b, 'done');
});

test('onState: running true when the run starts, false when it ends (stopped, error or thrown)', async () => {
  const runs = new SectionRuns();
  const seen = [];
  await runs.run('/a.canvas', 's1', ['c1'], async () => 'ok', on => seen.push(on));
  await assert.rejects(runs.run('/a.canvas', 's2', ['c1'], async () => { throw new Error('boom'); }, on => seen.push(on)));
  assert.deepEqual(seen, [true, false, true, false]);
  assert.deepEqual(runs.runningIn('/a.canvas'), []);
});

test('a stopped section runs again from the start on the next ▶', async () => {
  const runs = new SectionRuns();
  const g = gated();
  const p = runs.run('/a.canvas', 's1', ['c1', 'c2'], g.runCell);
  await tick(); runs.stop('/a.canvas', 's1'); g.finish('c1');
  assert.equal(await p, 'stopped');
  const ran = [];
  assert.equal(await runs.run('/a.canvas', 's1', ['c1', 'c2'], async id => { ran.push(id); return 'ok'; }), 'done');
  assert.deepEqual(ran, ['c1', 'c2']);
});
