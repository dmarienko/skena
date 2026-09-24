// tests/typst-compile.mjs
// - run: npx esbuild src/extension/typst.ts --bundle --platform=node --format=esm --outfile=tests/.build/typst.mjs --external:@myriaddreamin/typst-ts-node-compiler && node --test tests/typst-compile.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { typstMathToSvg } from './.build/typst.mjs';

test('inline math compiles to an SVG with glyph paths', () => {
  const svg = typstMathToSvg('x^2 + y^2', false);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<path/);
});

test('block math compiles to an SVG', () => {
  const svg = typstMathToSvg('sum_(i=1)^n i', true);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<path/);
});

test('malformed math returns an error marker, does not throw', () => {
  const out = typstMathToSvg('$ unterminated', false);
  assert.ok(typeof out === 'string');
  assert.doesNotMatch(out, /^<svg/);
  assert.match(out, /typst-error/);
});
