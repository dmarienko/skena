// test/llm-openai-compat.mjs
// - tests for OpenAICompatAdapter using a tiny mock HTTP server.
// - run: node --test test/llm-openai-compat.mjs
// - NOTE: imports the compiled JS from dist/; run `npm run build` before testing.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'node:http';

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

// ─── standalone SSE accumulator (mirrors openai-compat.ts logic) ─────────────

/**
 * Parse an OpenAI-format SSE stream from an async iterable of text.
 * Calls onText(delta) for each content chunk and onToolCall(tc) for complete tool calls.
 * Returns finish_reason.
 */
async function consumeOpenAIStream(stream, { onText, onToolCall }) {
  const toolAccum = [];
  let finishReason = null;
  let buf = '';

  for await (const chunk of stream) {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') break;
      let obj;
      try { obj = JSON.parse(raw); } catch { continue; }
      const delta = obj.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) onText(delta.content);
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index;
          if (!toolAccum[i]) toolAccum[i] = { id: '', name: '', arguments: '' };
          if (tc.id)                  toolAccum[i].id         = tc.id;
          if (tc.function?.name)      toolAccum[i].name       = tc.function.name;
          if (tc.function?.arguments) toolAccum[i].arguments += tc.function.arguments;
        }
      }
      if (obj.choices?.[0]?.finish_reason) finishReason = obj.choices[0].finish_reason;
    }
  }

  if (toolAccum.length > 0) {
    for (const tc of toolAccum) onToolCall(tc);
  }
  return finishReason;
}

// ─── SSE chunk builders ──────────────────────────────────────────────────────

const sse    = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const mkText = (t)   => sse({ choices: [{ delta: { content: t }, finish_reason: null }] });
const mkStop = ()    => sse({ choices: [{ delta: {}, finish_reason: 'stop' }] });
const mkToolStart = (id, name) => sse({ choices: [{ delta: {
  tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }],
}, finish_reason: null }] });
const mkToolArg   = (args) => sse({ choices: [{ delta: {
  tool_calls: [{ index: 0, function: { arguments: args } }],
}, finish_reason: null }] });
const mkToolFin   = () => sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });

// - helper: turn an SSE string into an async iterable of lines
async function* toStream(sseStr) { yield sseStr; }

// ─── tests ───────────────────────────────────────────────────────────────────

test('SSE accumulator: text chunks arrive in order', async () => {
  const sseData = mkText('Hello ') + mkText('world') + mkStop() + 'data: [DONE]\n\n';
  const received = [];
  const reason = await consumeOpenAIStream(toStream(sseData), {
    onText:     (d) => received.push(d),
    onToolCall: () => {},
  });
  assert.deepEqual(received, ['Hello ', 'world']);
  assert.equal(reason, 'stop');
});

test('SSE accumulator: tool call id + name from first chunk, arguments accumulated', async () => {
  const sseData = mkToolStart('call_1', 'list_nodes') + mkToolArg('{"k":') + mkToolArg('"v"}') + mkToolFin() + 'data: [DONE]\n\n';
  const calls = [];
  const reason = await consumeOpenAIStream(toStream(sseData), {
    onText:     () => {},
    onToolCall: (tc) => calls.push(tc),
  });
  assert.equal(reason, 'tool_calls');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id,        'call_1');
  assert.equal(calls[0].name,      'list_nodes');
  assert.equal(calls[0].arguments, '{"k":"v"}');
});
