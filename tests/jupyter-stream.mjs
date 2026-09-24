// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=tests/.build/jupyter-stream.mjs && node --test tests/jupyter-stream.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderStream } from './.build/jupyter-stream.mjs';

test('carriage return overwrites from column 0', () => {
  assert.equal(renderStream('abc\rX'), 'Xbc');
  assert.equal(renderStream('10%\r 50%\r100%'), '100%');
});

test('newline commits a line', () => {
  assert.equal(renderStream('line1\nline2'), 'line1\nline2');
});

test('tqdm-style redraw collapses to the last frame', () => {
  const s = ' 10%|#         | 1/10\r 50%|#####     | 5/10\r100%|##########| 10/10';
  assert.equal(renderStream(s), '100%|##########| 10/10');
});

test('ESC[A steps the cursor up one row (nested bars)', () => {
  assert.equal(renderStream('bar1\nbar2\x1b[A\rBAR1'), 'BAR1\nbar2');
});

test('plain text passes through unchanged', () => {
  assert.equal(renderStream('hello world'), 'hello world');
});
