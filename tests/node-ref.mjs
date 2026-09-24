// - run: npx esbuild src/shared/nodeRef.ts --bundle --format=esm --outfile=tests/.build/node-ref.mjs && node --test tests/node-ref.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseNodeRef, formatNodeRef, isNodeRef } from './.build/node-ref.mjs';

test('parseNodeRef splits path and label', () => {
  assert.deepEqual(parseNodeRef('test/H1.canvas#N2'), { canvas: 'test/H1.canvas', label: 'N2' });
  assert.deepEqual(parseNodeRef('a/b c/x.canvas#E10'), { canvas: 'a/b c/x.canvas', label: 'E10' });
});

test('parseNodeRef trims surrounding whitespace', () => {
  assert.deepEqual(parseNodeRef('  x.canvas#K1\n'), { canvas: 'x.canvas', label: 'K1' });
});

test('parseNodeRef rejects non-references', () => {
  assert.equal(parseNodeRef('a note about x.canvas'), null);
  assert.equal(parseNodeRef('http://example.com#N2'), null);
  assert.equal(parseNodeRef('x.canvas#37'), null);
  assert.equal(parseNodeRef('x.py#N2'), null);
});

test('formatNodeRef round-trips with parseNodeRef', () => {
  const s = formatNodeRef('test/H1.canvas', 'N2');
  assert.equal(s, 'test/H1.canvas#N2');
  assert.deepEqual(parseNodeRef(s), { canvas: 'test/H1.canvas', label: 'N2' });
});

test('isNodeRef is true only for valid references', () => {
  assert.equal(isNodeRef('test/H1.canvas#N2'), true);
  assert.equal(isNodeRef('just text'), false);
});
