// - run: npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { codeCellsInRunOrder, dottedNameAt, fromJoined, isDottedName, joinCells, toJoined } from './.build/goToDefinition.mjs';

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

// - S1 (y 0) holds B (500,0) and A (0,100); S2 (y 1000, listed first) holds D (600,1200) and C (0,1200).
//   T is a text note. Without sections every code cell goes by y, then x.
const NODES = [
  { id: 'A', type: 'code', x: 0, y: 100, width: 400, height: 200 },
  { id: 'B', type: 'code', x: 500, y: 0, width: 400, height: 200 },
  { id: 'T', type: 'text', x: 0, y: 0, width: 400, height: 50 },
  { id: 'D', type: 'code', x: 600, y: 1200, width: 400, height: 200 },
  { id: 'C', type: 'code', x: 0, y: 1200, width: 400, height: 200 },
];
const LANES = [{ id: 's2', y: 1000, createdAt: 2 }, { id: 's1', y: 0, createdAt: 1 }];

test('6. run order: section by section from the top, in each top to bottom then left to right; code cells only', () => {
  assert.deepEqual(codeCellsInRunOrder(NODES, LANES), ['B', 'A', 'C', 'D']);
  assert.deepEqual(codeCellsInRunOrder(NODES, []), ['B', 'A', 'C', 'D']);
});

const CELLS = [
  { id: 'A', code: 'import numpy as np\r\nx = 1' },
  { id: 'E', code: '' },
  { id: 'B', code: '%matplotlib inline\n  !ls -la\ndef f():\n    return x\n' },
  { id: 'C', code: '%%bash\necho (\n' },
  { id: 'D', code: '%%time\ny = f()' },
];

test('7. joined: header, each cell then an empty line; CRLF split; magic lines and non-Python cell magics commented', () => {
  const j = joinCells(CELLS, ['# type: ignore']);
  assert.equal(j.text, [
    '# type: ignore',
    'import numpy as np', 'x = 1', '',
    '', '',
    '#matplotlib inline', '  #ls -la', 'def f():', '    return x', '', '',
    '#%bash', '#cho (', '', '',
    '#%time', 'y = f()', '',
  ].join('\n'));
  assert.deepEqual(j.spans, [
    { id: 'A', first: 1, lines: 2 }, { id: 'E', first: 4, lines: 1 }, { id: 'B', first: 6, lines: 5 },
    { id: 'C', first: 12, lines: 3 }, { id: 'D', first: 16, lines: 2 },
  ]);
});

test('8. positions both ways: cell line/col (1-based) <-> joined line/character (0-based)', () => {
  const j = joinCells(CELLS, ['# type: ignore']);
  assert.deepEqual(toJoined(j, 'A', 2, 1), { line: 2, character: 0 });
  assert.deepEqual(toJoined(j, 'B', 4, 12), { line: 9, character: 11 });
  assert.deepEqual(toJoined(j, 'E', 1, 1), { line: 4, character: 0 });
  assert.deepEqual(fromJoined(j, { line: 9, character: 11 }), { cellId: 'B', line: 4, col: 12 });
  assert.deepEqual(fromJoined(j, { line: 4, character: 0 }), { cellId: 'E', line: 1, col: 1 });
  for (let line = 0; line < 19; line++) {
    const c = fromJoined(j, { line, character: 3 });
    if (c) assert.deepEqual(toJoined(j, c.cellId, c.line, c.col), { line, character: 3 }, `line ${line}`);
  }
  assert.equal(fromJoined(j, { line: 0, character: 0 }), null);   // - the header
  assert.equal(fromJoined(j, { line: 3, character: 0 }), null);   // - between A and E
  assert.equal(toJoined(j, 'A', 3, 1), null);
  assert.equal(toJoined(j, 'Z', 1, 1), null);
});
