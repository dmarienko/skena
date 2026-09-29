// - run: npx esbuild src/webview/canvas/chat/turnFold.ts --bundle --format=esm --outfile=tests/.build/turnFold.mjs && node --test tests/turn-fold.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { clearFolds, isAtBottom, isTurnOpen, toggleTurn, turnScroll } from './.build/turnFold.mjs';

const none = new Set();

test('every turn is open by default, including history loaded when the canvas opens', () => {
  assert.equal(isTurnOpen(none, 'turn-0'), true);
  assert.equal(isTurnOpen(none, 'turn-3'), true);
});

test('a click folds an open turn and a second click opens it again', () => {
  const once = toggleTurn(none, 'turn-0');
  assert.equal(isTurnOpen(once, 'turn-0'), false);
  assert.equal(isTurnOpen(toggleTurn(once, 'turn-0'), 'turn-0'), true);
});

test('a new prompt leaves an already-open turn open and an already-folded turn folded', () => {
  const folded = toggleTurn(none, 'turn-0');
  // - turn-1 was never toggled (open); turn-2 is the new prompt's own turn, also never toggled
  assert.equal(isTurnOpen(folded, 'turn-0'), false);
  assert.equal(isTurnOpen(folded, 'turn-1'), true);
  assert.equal(isTurnOpen(folded, 'turn-2'), true);
});

test('clearing the history (Reset) drops every fold', () => {
  const folded = toggleTurn(none, 'turn-0');
  const after  = clearFolds(folded, true, false);
  assert.equal(isTurnOpen(after, 'turn-0'), true);
});

test('clearFolds does nothing while turns remain, or while there were none to begin with', () => {
  const folded = toggleTurn(none, 'turn-0');
  assert.equal(clearFolds(folded, true, true), folded);
  assert.equal(clearFolds(none, false, false), none);
});

test('toggleTurn leaves its input set unchanged', () => {
  const s = new Set(['turn-0']);
  toggleTurn(s, 'turn-0');
  assert.equal(s.has('turn-0'), true);
});

test('opening a turn by a click puts its line at the top of the scroll area', () => {
  const move = turnScroll({ key: 'turn-6', opened: true, offset: 150 }, false, false, false);
  assert.deepEqual(move, { to: 'turn', key: 'turn-6', offset: 0 });
});

test('folding a turn by a click leaves its line where it was on screen', () => {
  const move = turnScroll({ key: 'turn-2', opened: false, offset: 120 }, false, false, false);
  assert.deepEqual(move, { to: 'turn', key: 'turn-2', offset: 120 });
});

test('a click is never followed by the pin to the latest, even when content arrived in the same render', () => {
  assert.equal(turnScroll({ key: 'turn-6', opened: true, offset: 150 }, true, false, false).to, 'turn');
  assert.equal(turnScroll({ key: 'turn-2', opened: false, offset: 120 }, true, false, false).to, 'turn');
});

test('a render with no click and no new content leaves the scroll where it is, even at the bottom', () => {
  assert.deepEqual(turnScroll(null, false, true, false), { to: 'stay' });
});

test('streaming while at the bottom follows the bottom', () => {
  // - streamed text / a tool step / a new answer: no click, new content, the view sat at the bottom
  assert.deepEqual(turnScroll(null, true, true, false), { to: 'latest' });
});

test('streaming while scrolled up stays put', () => {
  // - same new content, but the view had scrolled away from the bottom first
  assert.deepEqual(turnScroll(null, true, false, false), { to: 'stay' });
});

test('a new prompt follows the bottom, even if the view had scrolled up', () => {
  // - sending is the user's own action: it follows regardless of atBottomBefore
  assert.deepEqual(turnScroll(null, true, false, true), { to: 'latest' });
});

test('isAtBottom is true exactly at the bottom and within the 24px tolerance', () => {
  assert.equal(isAtBottom(976, 1000, 24), true);   // - gap 0
  assert.equal(isAtBottom(952, 1000, 24), true);   // - gap 24, inclusive
  assert.equal(isAtBottom(951, 1000, 24), false);  // - gap 25, just over
});

test('isAtBottom is false when scrolled well away from the bottom', () => {
  assert.equal(isAtBottom(0, 1000, 24), false);
});
