// - run: npx esbuild src/webview/canvas/gChord.ts --bundle --format=esm --outfile=tests/.build/gChord.mjs && node --test tests/g-chord.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { G_CHORD_MS, gChordStep } from './.build/gChord.mjs';

// - g pressed at t = 1000 on a node with two connections, and on one with none
const shown = { armedAt: 1000, showing: true, labels: new Map([['l', 'N8'], ['1', 'E4']]) };
const plain = { armedAt: 1000, showing: false, labels: new Map() };
const key = (k, mods = {}) => ({ key: k, shift: false, ctrl: false, meta: false, alt: false, ...mods });

test('1. with badges shown, a badge key still jumps long after the old 1.5 s', () => {
  assert.deepEqual(gChordStep(shown, key('1'), 1000 + 60_000), { do: 'jump', nodeId: 'E4' });
  assert.deepEqual(gChordStep(shown, key('l'), 1000 + 2_000), { do: 'jump', nodeId: 'N8' });
});

test('2. with badges shown, Esc and any other key close them and do nothing else', () => {
  assert.deepEqual(gChordStep(shown, key('Escape'), 1200), { do: 'close' });
  assert.deepEqual(gChordStep(shown, key('x'), 1200), { do: 'close' });
  assert.deepEqual(gChordStep(shown, key('l', { ctrl: true }), 1200), { do: 'close' });
});

test('3. a second g goes to the first member of the section, with or without badges', () => {
  assert.deepEqual(gChordStep(shown, key('g'), 5000), { do: 'first' });
  assert.deepEqual(gChordStep(plain, key('g'), 1000 + G_CHORD_MS - 1), { do: 'first' });
});

test('4. a node without connections keeps the 400 ms window, and another key passes through', () => {
  assert.deepEqual(gChordStep(plain, key('h'), 1100), { do: 'pass' });
  assert.equal(gChordStep(plain, key('g'), 1000 + 400), null);
});

test('5. a disarmed chord reads no key', () => {
  assert.equal(gChordStep({ ...shown, armedAt: 0 }, key('l'), 1200), null);
});
