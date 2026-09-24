// - run: npx esbuild src/webview/canvas/palette.ts --bundle --format=esm --outfile=tests/.build/palette.mjs && node --test tests/kernel-palette.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KERNEL_PALETTE, kernelColor, nextKernelColorIndex, DEFAULT_NODE_BORDER_BY_TYPE } from './.build/palette.mjs';

test('KERNEL_PALETTE has distinct non-empty colors', () => {
  assert.ok(KERNEL_PALETTE.length >= 4);
  assert.equal(new Set(KERNEL_PALETTE).size, KERNEL_PALETTE.length);
});

test('kernelColor cycles by index', () => {
  assert.equal(kernelColor(0), KERNEL_PALETTE[0]);
  assert.equal(kernelColor(KERNEL_PALETTE.length), KERNEL_PALETTE[0]);
});

test('nextKernelColorIndex wraps on existing count', () => {
  assert.equal(nextKernelColorIndex(0), 0);
  assert.equal(nextKernelColorIndex(KERNEL_PALETTE.length), 0);
});

test('default borders defined for code and kernel', () => {
  assert.ok(DEFAULT_NODE_BORDER_BY_TYPE.code);
  assert.ok(DEFAULT_NODE_BORDER_BY_TYPE.kernel);
});
