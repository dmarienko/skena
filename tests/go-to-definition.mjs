// - run: npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dottedNameAt, isDottedName } from './.build/goToDefinition.mjs';

// - the 1-based column of the n-th (0-based) occurrence of `part` in `line`
const colOf = (line, part, n = 0) => {
  let i = -1;
  for (let k = 0; k <= n; k++) i = line.indexOf(part, i + 1);
  return i + 1;
};

test('1. dotted names: names and dots only', () => {
  for (const ok of ['x', 'np.linalg.solve', '_a1.b_2', 'été.ça']) assert.ok(isDottedName(ok), ok);
  for (const bad of ['', '1x', 'a.', '.a', 'a..b', 'f()', 'a[0]', 'a b', 'a.1']) assert.ok(!isDottedName(bad), bad);
});

test('2. the cursor on solve asks for np.linalg.solve, on linalg for np.linalg, on np for np', () => {
  const line = 'x = np.linalg.solve(a, b)';
  assert.deepEqual(dottedNameAt(line, colOf(line, 'solve') + 2), { word: 'solve', dotted: 'np.linalg.solve', start: colOf(line, 'solve'), end: colOf(line, 'solve') + 5 });
  assert.equal(dottedNameAt(line, colOf(line, 'linalg')).dotted, 'np.linalg');
  assert.equal(dottedNameAt(line, colOf(line, 'np')).dotted, 'np');
  assert.equal(dottedNameAt(line, colOf(line, '(a') + 1).dotted, 'a');
});

test('3. a chain through a call or subscript has no dotted name; the word is still there', () => {
  const line = 'df.groupby(k).mean().x[0].y';
  assert.deepEqual(dottedNameAt(line, colOf(line, 'mean')), { word: 'mean', dotted: null, start: colOf(line, 'mean'), end: colOf(line, 'mean') + 4 });
  assert.equal(dottedNameAt(line, line.length).dotted, null);   // - the final y
  assert.equal(dottedNameAt(line, colOf(line, 'groupby')).dotted, 'df.groupby');
});

test('4. no name under the cursor: a blank, an operator, a dot, a number, past the end', () => {
  const line = 'y = f(1.5) + self.fit';
  for (const col of [2, 3, colOf(line, '('), colOf(line, '1'), colOf(line, '5'), colOf(line, '.', 1), line.length + 1, 0]) {
    assert.equal(dottedNameAt(line, col), null, `col ${col}`);
  }
  assert.equal(dottedNameAt(line, colOf(line, 'fit')).dotted, 'self.fit');
});

test('5. letters outside ASCII are name characters', () => {
  const line = 'v = été.ça';
  assert.equal(dottedNameAt(line, colOf(line, 'ça')).dotted, 'été.ça');
});
