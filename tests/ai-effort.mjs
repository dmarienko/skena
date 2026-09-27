// - run: npx esbuild src/shared/aiEffort.ts --bundle --format=esm --outfile=tests/.build/aiEffort.mjs && node --test tests/ai-effort.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { effortArgs } from './.build/aiEffort.mjs';

test('a known level becomes the --effort flag', () => {
  assert.deepEqual(effortArgs('high'), ['--effort', 'high']);
  assert.deepEqual(effortArgs('xhigh'), ['--effort', 'xhigh']);
});

test('no level, or an unknown one, adds no flag', () => {
  assert.deepEqual(effortArgs(undefined), []);
  assert.deepEqual(effortArgs(''), []);
  assert.deepEqual(effortArgs('ultra'), []);
});
