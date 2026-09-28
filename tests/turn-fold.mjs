// - run: npx esbuild src/webview/canvas/chat/turnFold.ts --bundle --format=esm --outfile=tests/.build/turnFold.mjs && node --test tests/turn-fold.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { clearFolds, isTurnOpen, toggleTurn } from './.build/turnFold.mjs';

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
