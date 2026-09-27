// - run: npx esbuild src/webview/canvas/chat/turnFold.ts --bundle --format=esm --outfile=tests/.build/turnFold.mjs && node --test tests/turn-fold.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isTurnOpen, nextToggled, toggleTurn } from './.build/turnFold.mjs';

const none = new Set();

test('the latest turn is open and earlier turns are folded', () => {
  assert.equal(isTurnOpen(none, 'turn-3', 'turn-3'), true);
  assert.equal(isTurnOpen(none, 'turn-0', 'turn-3'), false);
});

test('a click opens an earlier turn and a second click folds it', () => {
  const once = toggleTurn(none, 'turn-0');
  assert.equal(isTurnOpen(once, 'turn-0', 'turn-3'), true);
  assert.equal(isTurnOpen(toggleTurn(once, 'turn-0'), 'turn-0', 'turn-3'), false);
});

test('a click on the latest turn folds it', () => {
  assert.equal(isTurnOpen(toggleTurn(none, 'turn-3'), 'turn-3', 'turn-3'), false);
});

test('a new prompt folds the previous turn and every opened earlier turn', () => {
  const opened = toggleTurn(none, 'turn-0');
  const after  = nextToggled(opened, 'turn-3', 'turn-5');
  assert.equal(isTurnOpen(after, 'turn-3', 'turn-5'), false);
  assert.equal(isTurnOpen(after, 'turn-0', 'turn-5'), false);
  assert.equal(isTurnOpen(after, 'turn-5', 'turn-5'), true);
});

test('the same latest turn keeps what the user opened', () => {
  const opened = toggleTurn(none, 'turn-0');
  assert.equal(nextToggled(opened, 'turn-3', 'turn-3'), opened);
});

test('toggleTurn leaves its input set unchanged', () => {
  const s = new Set(['turn-0']);
  toggleTurn(s, 'turn-0');
  assert.equal(s.has('turn-0'), true);
});
