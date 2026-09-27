// - run: npx esbuild src/extension/llm-adapters/userContent.ts --bundle --format=esm --outfile=tests/.build/userContent.mjs && node --test tests/user-content.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildUserContent } from './.build/userContent.mjs';

test('text alone stays a plain string, as the harness sends today', () => {
  assert.equal(buildUserContent('hello'), 'hello');
  assert.equal(buildUserContent('hello', []), 'hello');
});

test('images come first as base64 image blocks, then the text', () => {
  const c = buildUserContent('what is this?', [{ mediaType: 'image/png', data: 'iVBOR' }]);
  assert.deepEqual(c, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
    { type: 'text', text: 'what is this?' },
  ]);
});
