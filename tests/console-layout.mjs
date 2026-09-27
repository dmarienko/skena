// - run: npx esbuild src/webview/canvas/chat/consoleLayout.ts --bundle --format=esm --outfile=tests/.build/consoleLayout.mjs && node --test tests/console-layout.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { INPUT_LINE_H, INPUT_MAX_LINES, MIN_CONSOLE_W, clampConsoleWidth, dragWidth, inputHeight } from './.build/consoleLayout.mjs';

test('the input starts one line high', () => {
  assert.equal(inputHeight(0), INPUT_LINE_H);
  assert.equal(inputHeight(1), 20);
});

test('the input grows one line at a time', () => {
  assert.equal(inputHeight(3), 60);
});

test('the input stops at 8 lines (160 px)', () => {
  assert.equal(INPUT_MAX_LINES, 8);
  assert.equal(inputHeight(8), 160);
  assert.equal(inputHeight(30), 160);
});

test('a fractional line count from Monaco rounds to the nearest line', () => {
  assert.equal(inputHeight(2.02), 40);
});

test('the width stays between the minimum and the window less the side gutters', () => {
  assert.equal(clampConsoleWidth(1000, 1920), 1000);
  assert.equal(clampConsoleWidth(100, 1920), MIN_CONSOLE_W);
  assert.equal(clampConsoleWidth(5000, 1920), 1888);
});

test('a window narrower than the minimum gets its own width less the gutters', () => {
  assert.equal(clampConsoleWidth(760, 400), 368);
});

test('dragging an edge outward widens by twice the distance, since the console stays centred', () => {
  assert.equal(dragWidth(760, 50, 'right'), 860);
  assert.equal(dragWidth(760, -50, 'left'), 860);
  assert.equal(dragWidth(760, 50, 'left'), 660);
});
