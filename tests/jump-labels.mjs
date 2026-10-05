// - run: npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_JUMP_LABELS, assignLabels, labelKey, leaderStep, matchKeys, normalizeLeader, vimKeyOf,
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
  assert.equal(vimKeyOf(';'), ';');
  assert.equal(vimKeyOf(' '), '<Space>');
});
