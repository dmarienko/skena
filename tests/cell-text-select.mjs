// - run: npx esbuild src/webview/canvas/nodes/cellTextSelect.ts --bundle --format=esm --outfile=tests/.build/cellTextSelect.mjs && node --test tests/cell-text-select.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pointInside, wordAt } from './.build/cellTextSelect.mjs';

const box = (left, top, right, bottom) => ({ left, top, right, bottom });
// - an output scrolled to its middle: the text runs far above and below the scroller's visible box
const scroller = box(100, 100, 500, 400);
const longText = box(108, -900, 492, 1400);

test('a pointer below a scrolled output lands on its bottom visible line', () => {
  assert.deepEqual(pointInside(300, 460, longText, scroller), { x: 300, y: 399 });
});

test('a pointer above or beside it lands on the nearest visible text', () => {
  assert.deepEqual(pointInside(300, 20, longText, scroller), { x: 300, y: 101 });
  assert.deepEqual(pointInside(40, 250, longText, scroller), { x: 109, y: 250 });
  assert.deepEqual(pointInside(900, 250, longText, scroller), { x: 491, y: 250 });
});

test('under text shorter than the scroller, the pointer lands on the text, not the space under it', () => {
  const shortText = box(108, 106, 492, 180);
  assert.deepEqual(pointInside(300, 460, shortText, scroller), { x: 300, y: 179 });
});

test('a pointer over the visible text stays where it is', () => {
  assert.deepEqual(pointInside(250, 250, longText, scroller), { x: 250, y: 250 });
});

test('text scrolled out of the visible box gives no point', () => {
  assert.equal(pointInside(300, 460, box(108, 420, 492, 900), scroller), null);
});

// - the range a double-click selects, as [start, end) offsets: the word under the character clicked
const word = (text, i) => { const [a, b] = wordAt(text, i); return text.slice(a, b); };

test('a double-click on a letter selects its word', () => {
  assert.equal(word('row one printed', 5), 'one');
  assert.equal(word('row one printed', 4), 'one');
  assert.equal(word('row one printed', 6), 'one');
  assert.deepEqual(wordAt('row one printed', 5), [4, 7]);
});

test('numbers, file names and identifiers stay whole; punctuation next to them is not part of the word', () => {
  assert.equal(word('0    1.25    x', 7), '1.25');
  assert.equal(word('/tmp/x.py:3: UserWarning: stderr', 7), 'x.py');
  assert.equal(word('/tmp/x.py:3: UserWarning: stderr', 15), 'UserWarning');
  assert.equal(word('ZeroDivisionError: division by zero', 3), 'ZeroDivisionError');
  assert.equal(word('ZeroDivisionError: division by zero', 17), ':');
});

test('a double-click on a space selects the run of spaces, as a native double-click does', () => {
  assert.equal(word('a    b', 2), '    ');
});

test('words on other lines are not joined', () => {
  assert.equal(word('row one\nrow two', 8), 'row');
  assert.equal(word('row one\nrow two', 6), 'one');
});
