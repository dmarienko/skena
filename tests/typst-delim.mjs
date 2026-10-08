// tests/typst-delim.mjs
// - run: npx esbuild src/extension/typst-delim.ts --bundle --format=esm --outfile=tests/.build/typst-delim.mjs && node --test tests/typst-delim.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findTypstSpans } from './.build/typst-delim.mjs';

test('inline %..% is matched', () => {
  const s = findTypstSpans('area is %pi r^2% today');
  assert.equal(s.length, 1);
  assert.equal(s[0].body, 'pi r^2');
  assert.equal(s[0].block, false);
});

test('block %%..%% is matched and preferred over inline', () => {
  const s = findTypstSpans('%%sum_(i=1)^n i%%');
  assert.equal(s.length, 1);
  assert.equal(s[0].body, 'sum_(i=1)^n i');
  assert.equal(s[0].block, true);
});

test('"50% off" does NOT match (space after opening %)', () => {
  assert.deepEqual(findTypstSpans('50% off the price'), []);
});

test('"a % b" does NOT match (spaces both sides)', () => {
  assert.deepEqual(findTypstSpans('a % b % c'), []);
});

test('empty %% is not math', () => {
  assert.deepEqual(findTypstSpans('%% %'), []);
});

test('inline does not cross a newline', () => {
  assert.deepEqual(findTypstSpans('%x\ny%'), []);
});

test('two inline spans on one line', () => {
  const s = findTypstSpans('%a% and %b%');
  assert.deepEqual(s.map(x => x.body), ['a', 'b']);
});

const bodies = (text) => findTypstSpans(text).map(s => s.body);

test('a % right after a letter or a digit opens no span: 4.5%, x%', () => {
  assert.deepEqual(findTypstSpans('Mean simulated bias: about **4.5%** relative and **6.4%** risk.'), []);
  assert.deepEqual(findTypstSpans('cut by 0.4%, active −0.2%, residual +1.55%'), []);
  assert.deepEqual(findTypstSpans('x%y and z%'), []);
  // - nor does %%
  assert.deepEqual(findTypstSpans('5%%a%%'), []);
});

test('Typst written in the canvases still matches', () => {
  assert.deepEqual(bodies('text %op("cov")_i (z_(i,t)^k, r_(i,t))% end'), ['op("cov")_i (z_(i,t)^k, r_(i,t))']);
  assert.deepEqual(bodies('Where %z_(i,t)^k% - actually factor %f_(i,t)^k% made'), ['z_(i,t)^k', 'f_(i,t)^k']);
  assert.deepEqual(bodies('(%kappa%), %F_(t+1)^k%.'), ['kappa', 'F_(t+1)^k']);
  assert.deepEqual(findTypstSpans('%%sum_i z_(i,t)^k = 0%%'), [{ start: 0, end: 23, body: 'sum_i z_(i,t)^k = 0', block: true }]);
});
