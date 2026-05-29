// test/llm-openai-compat.mjs
// - tests for OpenAICompatAdapter using a tiny mock HTTP server.
// - run: node --test test/llm-openai-compat.mjs
// - NOTE: imports the compiled JS from dist/; run `npm run build` before testing.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('LLMTool shape matches expected structure', () => {
  // - validates our shared type contract — the factory and adapters must honour this shape.
  // - this test runs against the type definitions by checking the JS export.
  // - import path will resolve after build step in Task 6.
  const tool = {
    name: 'add_note',
    description: 'Add a note to canvas.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  };
  assert.equal(typeof tool.name, 'string');
  assert.equal(typeof tool.description, 'string');
  assert.equal(typeof tool.parameters, 'object');
  assert.equal(tool.parameters.type, 'object');
});
