// - run: npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_JUMP_LABELS, assignLabels, labelKey, leaderStep, lineStarts, matchKeys, nodesInDirection, normalizeLeader,
  vimKeyOf, wordStarts,
} from './.build/jumpLabels.mjs';

const key = (k, mods = {}) => ({ key: k, ctrl: false, meta: false, alt: false, ...mods });

test('1. T <= N: one character per target, nearest first, in setting order', () => {
  assert.deepEqual(assignLabels(3, 'abc', ';'), ['a', 'b', 'c']);
  assert.deepEqual(assignLabels(2, 'abc', ';'), ['a', 'b']);
  assert.deepEqual(assignLabels(0, 'abc', ';'), []);
});

test('2. T > N: the nearest keep one character, the rest share first characters taken from the end', () => {
  assert.deepEqual(assignLabels(4, 'abc', ';'), ['a', 'b', 'ca', 'cb']);
  assert.deepEqual(assignLabels(5, 'abc', ';'), ['a', 'b', 'ca', 'cb', 'cc']);
  assert.deepEqual(assignLabels(6, 'abc', ';'), ['a', 'ba', 'bb', 'bc', 'ca', 'cb']);
  assert.deepEqual(assignLabels(9, 'abc', ';'), ['aa', 'ab', 'ac', 'ba', 'bb', 'bc', 'ca', 'cb', 'cc']);
});

test('3. past N * N targets the rest get no label', () => {
  assert.equal(assignLabels(10, 'abc', ';').length, 9);
});

test('4. with the default characters: unique, no label a prefix of another, singles before pairs', () => {
  for (const count of [1, 25, 26, 27, 40, 100, 400, 676, 700]) {
    const labels = assignLabels(count, DEFAULT_JUMP_LABELS, ';');
    assert.equal(labels.length, Math.min(count, 26 * 26), `count ${count}`);
    assert.equal(new Set(labels).size, labels.length, `count ${count}: repeats`);
    for (const a of labels) for (const b of labels) {
      if (a !== b) assert.ok(!b.startsWith(a), `count ${count}: ${a} starts ${b}`);
    }
    for (let i = 1; i < labels.length; i++) assert.ok(labels[i - 1].length <= labels[i].length, `count ${count}: order`);
  }
  assert.deepEqual(assignLabels(27, DEFAULT_JUMP_LABELS, ';').slice(0, 3), ['a', 's', 'd']);
});

test('5. the leader, blanks and repeats are never labels', () => {
  assert.deepEqual(assignLabels(3, 'a;b c', ';'), ['a', 'b', 'c']);
  assert.deepEqual(assignLabels(3, 'aabbc', ';'), ['a', 'b', 'c']);
  assert.ok(!assignLabels(700, DEFAULT_JUMP_LABELS, 'a').some(l => l.includes('a')));
});

test('6. fewer than two usable characters: the default characters, still without the leader', () => {
  assert.deepEqual(assignLabels(2, ';', ';'), ['a', 's']);
  assert.deepEqual(assignLabels(2, 'x', 'a'), ['s', 'd']);
});

test('7. typed keys: a whole label jumps, a first character narrows, anything else cancels', () => {
  const labels = ['a', 'b', 'ca', 'cb'];
  assert.deepEqual(matchKeys(labels, 'b'), { kind: 'jump', index: 1 });
  assert.deepEqual(matchKeys(labels, 'c'), { kind: 'narrow', prefix: 'c' });
  assert.deepEqual(matchKeys(labels, 'cb'), { kind: 'jump', index: 3 });
  assert.deepEqual(matchKeys(labels, 'cx'), { kind: 'cancel' });
  assert.deepEqual(matchKeys(labels, 'z'), { kind: 'cancel' });
  assert.deepEqual(matchKeys(labels, ''), { kind: 'cancel' });
});

test('8. a key while labels are shown: modifiers alone change nothing; Esc, chords and named keys cancel', () => {
  const labels = ['a', 'b', 'ca', 'cb'];
  assert.deepEqual(labelKey(labels, '', key('Shift')), { kind: 'ignore' });
  assert.deepEqual(labelKey(labels, 'c', key('Control')), { kind: 'ignore' });
  assert.deepEqual(labelKey(labels, '', key('Escape')), { kind: 'cancel' });
  assert.deepEqual(labelKey(labels, '', key('a', { ctrl: true })), { kind: 'cancel' });
  assert.deepEqual(labelKey(labels, '', key('ArrowDown')), { kind: 'cancel' });
  assert.deepEqual(labelKey(labels, '', key('c')), { kind: 'narrow', prefix: 'c' });
  assert.deepEqual(labelKey(labels, 'c', key('a')), { kind: 'jump', index: 2 });
});

test('9. leader leader h/j/k/l shows; the leader then anything else releases what was held', () => {
  assert.deepEqual(leaderStep(0, key(';'), ';'), { do: 'hold', next: 1 });
  assert.deepEqual(leaderStep(1, key(';'), ';'), { do: 'hold', next: 2 });
  for (const d of ['h', 'j', 'k', 'l']) assert.deepEqual(leaderStep(2, key(d), ';'), { do: 'show', dir: d });
  assert.deepEqual(leaderStep(1, key('x'), ';'), { do: 'release', held: 1 });
  assert.deepEqual(leaderStep(1, key('l'), ';'), { do: 'release', held: 1 });
  assert.deepEqual(leaderStep(2, key('x'), ';'), { do: 'release', held: 2 });
  assert.deepEqual(leaderStep(2, key(';'), ';'), { do: 'release', held: 2 });
  assert.deepEqual(leaderStep(2, key('L'), ';'), { do: 'release', held: 2 });
});

test('10. no leader held: other keys and a chorded leader are not part of a sequence', () => {
  assert.deepEqual(leaderStep(0, key('l'), ';'), { do: 'none' });
  assert.deepEqual(leaderStep(0, key(';', { ctrl: true }), ';'), { do: 'none' });
  assert.deepEqual(leaderStep(1, key(';', { alt: true }), ';'), { do: 'release', held: 1 });
});

test('11. a modifier pressed alone keeps the held leaders, so a shifted leader works', () => {
  assert.deepEqual(leaderStep(1, key('Shift'), ':'), { do: 'none' });
  assert.deepEqual(leaderStep(1, key(':'), ':'), { do: 'hold', next: 2 });
  assert.deepEqual(leaderStep(2, key('Shift'), ':'), { do: 'none' });
});

test('12. leader setting: exactly one character, else ;', () => {
  assert.equal(normalizeLeader(','), ',');
  assert.equal(normalizeLeader(' '), ' ');
  assert.equal(normalizeLeader(''), ';');
  assert.equal(normalizeLeader(',,'), ';');
  assert.equal(normalizeLeader(undefined), ';');
  assert.equal(normalizeLeader('\t'), ';');
  assert.equal(normalizeLeader('\n'), ';');
  assert.equal(vimKeyOf(';'), ';');
  assert.equal(vimKeyOf(' '), '<Space>');
});

// - lines 4-8 are on screen; the cursor is on line 5 at column 7 (the `b` of `bar`)
//   col: 1234567890123456
const LINES = [
  { line: 4, text: 'x = 1' },
  { line: 5, text: '  foo.bar(baz_2)' },
  { line: 6, text: '' },
  { line: 7, text: '\tif (a)' },
  { line: 8, text: '    ' },
];
const CURSOR = { line: 5, col: 7 };
const at = (line, col) => ({ line, col });

test('13. word starts after the cursor: runs of word characters and runs of other non-blanks, in document order', () => {
  assert.deepEqual(wordStarts(LINES, CURSOR, 'forward'), [
    at(5, 10), at(5, 11), at(5, 16),   // - `(`, `baz_2`, `)`
    at(7, 2), at(7, 5), at(7, 6), at(7, 7),   // - `if`, `(`, `a`, `)`
  ]);
});

test('14. word starts before the cursor, nearest first: the cursor word start itself is excluded', () => {
  assert.deepEqual(wordStarts(LINES, CURSOR, 'backward'), [
    at(5, 6), at(5, 3),   // - `.`, `foo`
    at(4, 5), at(4, 3), at(4, 1),   // - `1`, `=`, `x`
  ]);
  assert.deepEqual(wordStarts(LINES, at(5, 8), 'backward')[0], at(5, 7));   // - mid-word: back to its start
});

test('15. letters outside ASCII are word characters', () => {
  assert.deepEqual(wordStarts([{ line: 1, text: 'été+ça' }], at(1, 1), 'forward'), [at(1, 4), at(1, 5)]);
});

test('16. line starts below the cursor: first non-blank character, column 1 for an empty or blank line', () => {
  assert.deepEqual(lineStarts(LINES, 5, 'down'), [at(6, 1), at(7, 2), at(8, 1)]);
});

test('17. line starts above the cursor, nearest first; the cursor line is never a target', () => {
  assert.deepEqual(lineStarts(LINES, 5, 'up'), [at(4, 1)]);
  assert.deepEqual(lineStarts(LINES, 8, 'up').map(p => p.line), [7, 6, 5, 4]);
  assert.deepEqual(lineStarts(LINES, 4, 'up'), []);
});

// - focused node F (centre 500,500) in a 1000x1000 view; R right, L left, D below, U above, RD right and
//   below (counts for l and j), OFF right but outside the view, EDGE right and only partly inside it
const nav = (id, x, y, w = 100, h = 100) => ({ id, x, y, w, h });
const F = nav('F', 450, 450);
const R = nav('R', 650, 450);
const L = nav('L', 150, 450);
const D = nav('D', 450, 750);
const U = nav('U', 450, 50);
const RD = nav('RD', 800, 800);
const OFF = nav('OFF', 1200, 450);
const EDGE = nav('EDGE', 950, 450);
const NODES = [F, R, L, D, U, RD, OFF, EDGE];
const VIEW = { left: 0, top: 0, right: 1000, bottom: 1000 };
const ORIGIN = { x: 500, y: 500 };
const ids = nodes => nodes.map(n => n.id);

test('18. l: visible nodes whose centre is right of the origin, nearest centre first', () => {
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'l')), ['R', 'RD', 'EDGE']);
});

test('19. h, j, k: the other three sides; the focused node is never a target', () => {
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'h')), ['L']);
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'j')), ['D', 'RD']);
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'k')), ['U']);
});

test('20. equal distances keep the input order; no visible node on that side gives nothing', () => {
  const a = nav('a', 650, 300), b = nav('b', 650, 600);   // - both 250 from the origin
  assert.deepEqual(ids(nodesInDirection([b, a], ORIGIN, VIEW, 'l')), ['b', 'a']);
  assert.deepEqual(nodesInDirection([F, L], ORIGIN, VIEW, 'l'), []);
});

test('21. a letter outside the BMP is one character: columns count UTF-16 units, classes count code points', () => {
  assert.deepEqual(wordStarts([{ line: 1, text: 'a\u{20000}b' }], at(1, 0), 'forward'), [at(1, 1)]);
  assert.deepEqual(wordStarts([{ line: 1, text: '\u{20000}.x' }], at(1, 0), 'forward'), [at(1, 1), at(1, 3), at(1, 4)]);
});

test('22. a combining mark stays in its word; a run of punctuation is one word', () => {
  assert.deepEqual(wordStarts([{ line: 1, text: 'cafe\u0301 x' }], at(1, 0), 'forward'), [at(1, 1), at(1, 7)]);
  assert.deepEqual(wordStarts([{ line: 1, text: 'a->b' }], at(1, 0), 'forward'), [at(1, 1), at(1, 2), at(1, 4)]);
});
