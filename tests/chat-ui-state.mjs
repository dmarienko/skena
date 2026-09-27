// - run: npx esbuild src/shared/chatUIState.ts --bundle --format=esm --outfile=tests/.build/chatUIState.mjs && node --test tests/chat-ui-state.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { migrateChatUI } from './.build/chatUIState.mjs';

test('nothing saved gives the default width and an open conversation', () => {
  assert.deepEqual(migrateChatUI(undefined), { width: null, folded: false });
});

test('the saved { width, folded } passes through', () => {
  assert.deepEqual(migrateChatUI({ width: 900, folded: true }), { width: 900, folded: true });
});

test('the floating panel\'s { collapsed, pos, size, inputW } becomes width plus folded', () => {
  const old = { collapsed: true, pos: { x: 10, y: 20 }, size: { w: 620, h: 400 }, inputW: 240 };
  assert.deepEqual(migrateChatUI(old), { width: 620, folded: true });
});

test('old saved state without a size keeps the default width', () => {
  assert.deepEqual(migrateChatUI({ collapsed: false, pos: { x: 0, y: 0 } }), { width: null, folded: false });
});

test('a broken width is ignored', () => {
  for (const w of [NaN, -5, '800', null]) assert.equal(migrateChatUI({ width: w, folded: false }).width, null);
});

test('folded wins over collapsed when both are present', () => {
  assert.equal(migrateChatUI({ folded: false, collapsed: true }).folded, false);
});
