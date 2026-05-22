# LLM Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardwired Anthropic client with an `ILLMClient` interface + two adapters (Anthropic, OpenAI-compatible), so any OpenAI-format provider (Ollama, Groq, OpenAI, LM Studio) works via VS Code settings.

**Architecture:** Define `ILLMClient` in `llm-client.ts`; move existing `ClaudeClient` logic to `llm-adapters/anthropic.ts`; implement `llm-adapters/openai-compat.ts` using the `openai` npm package; wire a factory in `editor-provider.ts` that instantiates the right adapter from settings.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (existing), `openai` npm package (new), VS Code Extension API, Node.js `http` for mock server in tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/extension/llm-client.ts` | **Create** | `ILLMClient` interface, shared types (`LLMTool`, `LLMToolCall`, `LLMMessage`, `LLMCallbacks`), `CANVAS_TOOLS` constant, `createLLMClient()` factory |
| `src/extension/llm-adapters/anthropic.ts` | **Create** | Anthropic adapter — existing `ClaudeClient` logic moved here, renamed `AnthropicAdapter` |
| `src/extension/llm-adapters/openai-compat.ts` | **Create** | OpenAI-compat streaming adapter — works with Ollama, Groq, OpenAI, LM Studio |
| `src/extension/claude-client.ts` | **Delete** | Content moved to `llm-adapters/anthropic.ts` |
| `src/extension/editor-provider.ts` | **Modify** | Import `ILLMClient` + `createLLMClient`; pass `CANVAS_TOOLS` to `chat()`; update tool dispatch |
| `package.json` | **Modify** | Add `openai` dep; add `skena.ai.provider` + `skena.ai.baseURL` settings |
| `test/llm-openai-compat.mjs` | **Create** | Tests for OpenAI-compat adapter using a local mock HTTP server |

---

### Task 1: Add `openai` dependency and new VS Code settings

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the `openai` package**

```bash
cd /home/quant0/devs/skena && npm install openai
```

Expected: `package.json` and `package-lock.json` updated, `node_modules/openai/` appears.

- [ ] **Step 2: Add new settings to `package.json` contributes**

In the `"properties"` block inside `"contributes.configuration"` (after the existing `"skena.ai.model"` entry, around line 244), add:

```jsonc
"skena.ai.provider": {
  "type": "string",
  "enum": ["anthropic", "openai-compat"],
  "default": "anthropic",
  "description": "LLM provider for the AI companion. Use 'openai-compat' for Ollama, Groq, OpenAI, LM Studio, or any OpenAI-format endpoint.",
  "scope": "window"
},
"skena.ai.baseURL": {
  "type": "string",
  "default": "https://api.openai.com/v1",
  "markdownDescription": "Base URL for the `openai-compat` provider. Examples:\n- Ollama: `http://localhost:11434/v1`\n- LM Studio: `http://localhost:1234/v1`\n- Groq: `https://api.groq.com/openai/v1`",
  "scope": "window"
},
```

The existing `"skena.ai.apiKey"` stays — it's reused by both adapters (Anthropic reads it natively; openai-compat passes it as the bearer token, and Ollama ignores it but the SDK requires a non-empty string — set to `"ollama"`).

- [ ] **Step 3: Verify the build still compiles**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | tail -5
```

Expected: no errors (we haven't changed any TS yet).

- [ ] **Step 4: Commit**

```bash
cd /home/quant0/devs/skena && git add package.json package-lock.json && git commit -m "chore: add openai dep and provider/baseURL settings"
```

---

### Task 2: Create `src/extension/llm-client.ts` — interface + shared types + factory

**Files:**
- Create: `src/extension/llm-client.ts`

- [ ] **Step 1: Write the test first**

Create `test/llm-openai-compat.mjs` with the first test only (will fail — module doesn't exist yet):

```javascript
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
```

- [ ] **Step 2: Run test — it passes immediately (pure shape check, no imports yet)**

```bash
cd /home/quant0/devs/skena && node --test test/llm-openai-compat.mjs
```

Expected: `✔ LLMTool shape matches expected structure`

- [ ] **Step 3: Create `src/extension/llm-client.ts`**

```typescript
/**
 * llm-client — provider-agnostic LLM interface for the Skena AI companion.
 *
 * ILLMClient is implemented by:
 *   - AnthropicAdapter  (src/extension/llm-adapters/anthropic.ts)
 *   - OpenAICompatAdapter (src/extension/llm-adapters/openai-compat.ts)
 *
 * createLLMClient() reads VS Code settings and returns the right adapter.
 */

import * as vscode from 'vscode';

// ─── shared types ─────────────────────────────────────────────────────────────

/** - one message in the conversation history */
export type LLMMessage = { role: 'user' | 'assistant'; content: string };

/** - a tool the agent can call (JSON Schema parameters) */
export interface LLMTool {
  name:        string;
  description: string;
  parameters:  Record<string, unknown>;   // - JSON Schema object
}

/** - a tool invocation made by the model */
export interface LLMToolCall {
  id:    string;
  name:  string;
  input: Record<string, unknown>;
}

/** - streaming callbacks — same contract as the old ClaudeClient */
export interface LLMCallbacks {
  /** - called for each streamed text chunk */
  onText:    (delta: string) => void;
  /**
   * - called when the model invokes a tool.
   * - Implementor executes the tool and returns a result string.
   */
  onToolUse: (tool: LLMToolCall) => Promise<string>;
  /** - called once the full exchange (including all tool turns) is complete */
  onDone:    () => void;
  /** - called on network or API errors */
  onError:   (message: string) => void;
}

// ─── interface ────────────────────────────────────────────────────────────────

export interface ILLMClient {
  /**
   * Start a streaming chat turn. Handles multi-turn tool use internally.
   * `history` is the conversation so far (user+assistant plain strings).
   */
  chat(
    systemPrompt: string,
    history:      LLMMessage[],
    tools:        LLMTool[],
    callbacks:    LLMCallbacks,
  ): Promise<void>;

  /** - cancel the current in-flight request */
  abort(): void;

  /** - force re-read of API key on next call (call after settings change) */
  invalidate(): void;
}

// ─── canvas tool definitions ──────────────────────────────────────────────────

/**
 * Tools available to the AI companion. Provider-agnostic shape.
 * Each adapter converts this to its native format (Anthropic.Tool or OpenAI function).
 */
export const CANVAS_TOOLS: LLMTool[] = [
  {
    name: 'add_note',
    description:
      'Add a text note to the canvas. The note will be positioned near and connected to ' +
      'the currently focused node with an edge. Use this to capture insights, findings, ' +
      'summaries, or next steps as permanent canvas artefacts.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown content of the note. Keep it focused and concise.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'read_node',
    description:
      'Read the full text content of a canvas node by its short label (e.g. N3 or M12). ' +
      'Use this when you need more detail than the context provides.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Node label like N3 or M12 (as shown in the canvas node list)' },
      },
      required: ['label'],
    },
  },
  {
    name: 'list_nodes',
    description: 'List all nodes currently on the canvas with their labels, types, and titles.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

// ─── factory ──────────────────────────────────────────────────────────────────

/**
 * Read settings and return the appropriate LLM adapter.
 * Import the adapters lazily to avoid loading unused SDK code.
 */
export async function createLLMClient(): Promise<ILLMClient> {
  const cfg      = vscode.workspace.getConfiguration('skena.ai');
  const provider = cfg.get<string>('provider') ?? 'anthropic';

  if (provider === 'openai-compat') {
    const { OpenAICompatAdapter } = await import('./llm-adapters/openai-compat');
    return new OpenAICompatAdapter();
  }

  // - default: anthropic
  const { AnthropicAdapter } = await import('./llm-adapters/anthropic');
  return new AnthropicAdapter();
}
```

- [ ] **Step 4: Verify TypeScript accepts the file**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | grep "llm-client"
```

Expected: no errors for `llm-client.ts` (adapters don't exist yet — other errors are expected).

- [ ] **Step 5: Commit**

```bash
cd /home/quant0/devs/skena && git add src/extension/llm-client.ts test/llm-openai-compat.mjs && git commit -m "feat: add ILLMClient interface and CANVAS_TOOLS shared types"
```

---

### Task 3: Create `src/extension/llm-adapters/anthropic.ts`

Move and rename the existing `ClaudeClient` → `AnthropicAdapter`. The logic is identical; only the name and import path change.

**Files:**
- Create: `src/extension/llm-adapters/anthropic.ts`

- [ ] **Step 1: Create `src/extension/llm-adapters/anthropic.ts`**

```typescript
/**
 * AnthropicAdapter — ILLMClient implementation using @anthropic-ai/sdk.
 *
 * Preserves native Anthropic streaming and multi-turn tool use.
 * Reads apiKey from skena.ai.apiKey setting or ANTHROPIC_API_KEY env var.
 * Reads model from skena.ai.model setting.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import type { ILLMClient, LLMMessage, LLMTool, LLMToolCall, LLMCallbacks } from '../llm-client';

export class AnthropicAdapter implements ILLMClient {
  private _sdk: Anthropic | null = null;
  private _aborted = false;

  private sdk(): Anthropic {
    const cfg    = vscode.workspace.getConfiguration('skena.ai');
    const apiKey = cfg.get<string>('apiKey')?.trim()
                ?? process.env['ANTHROPIC_API_KEY']
                ?? '';
    if (!apiKey) {
      throw new Error(
        'Skena AI: no API key. Set skena.ai.apiKey in settings or the ANTHROPIC_API_KEY env var.',
      );
    }
    if (!this._sdk) this._sdk = new Anthropic({ apiKey });
    return this._sdk;
  }

  invalidate(): void { this._sdk = null; }

  abort(): void { this._aborted = true; }

  async chat(
    systemPrompt: string,
    history:      LLMMessage[],
    tools:        LLMTool[],
    callbacks:    LLMCallbacks,
  ): Promise<void> {
    this._aborted = false;
    const cfg   = vscode.workspace.getConfiguration('skena.ai');
    const model = cfg.get<string>('model') ?? 'claude-sonnet-4-5';

    // - convert LLMTool[] → Anthropic.Tool[]
    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));

    try {
      const msgs = history.map(m => ({ role: m.role, content: m.content } satisfies Anthropic.MessageParam));
      await this._runTurn(this.sdk(), model, systemPrompt, msgs, anthropicTools, callbacks, 0);
    } catch (err: unknown) {
      const name = (err as Error).name ?? '';
      if (!name.includes('AbortError') && !this._aborted) {
        callbacks.onError((err as Error).message ?? String(err));
      }
    }
  }

  private async _runTurn(
    sdk:       Anthropic,
    model:     string,
    system:    string,
    messages:  Anthropic.MessageParam[],
    tools:     Anthropic.Tool[],
    callbacks: LLMCallbacks,
    depth:     number,
  ): Promise<void> {
    if (depth > 6 || this._aborted) { callbacks.onDone(); return; }

    const toolInputBufs = new Map<string, string>();
    const toolBlocks: Array<{ id: string; name: string }> = [];
    let currentToolId: string | null = null;

    const stream = sdk.messages.stream({ model, max_tokens: 4096, system, messages, tools });

    for await (const event of stream) {
      if (this._aborted) break;
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            currentToolId = event.content_block.id;
            toolBlocks.push({ id: event.content_block.id, name: event.content_block.name });
            toolInputBufs.set(currentToolId, '');
          }
          break;
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            callbacks.onText(event.delta.text);
          } else if (event.delta.type === 'input_json_delta' && currentToolId) {
            toolInputBufs.set(currentToolId, (toolInputBufs.get(currentToolId) ?? '') + event.delta.partial_json);
          }
          break;
        case 'content_block_stop':
          currentToolId = null;
          break;
      }
    }

    if (this._aborted) { callbacks.onDone(); return; }

    const finalMsg = await stream.finalMessage();
    if (finalMsg.stop_reason !== 'tool_use' || toolBlocks.length === 0) {
      callbacks.onDone();
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tb of toolBlocks) {
      if (this._aborted) break;
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(toolInputBufs.get(tb.id) ?? '{}') as Record<string, unknown>; } catch { /* empty */ }
      const result = await callbacks.onToolUse({ id: tb.id, name: tb.name, input } satisfies LLMToolCall);
      toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
    }

    if (this._aborted) { callbacks.onDone(); return; }

    await this._runTurn(sdk, model, system, [
      ...messages,
      { role: 'assistant', content: finalMsg.content },
      { role: 'user',      content: toolResults },
    ], tools, callbacks, depth + 1);
  }
}
```

- [ ] **Step 2: Check types compile**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | grep "anthropic.ts"
```

Expected: no errors for this file.

- [ ] **Step 3: Commit**

```bash
cd /home/quant0/devs/skena && git add src/extension/llm-adapters/anthropic.ts && git commit -m "feat: add AnthropicAdapter (extracted from claude-client)"
```

---

### Task 4: Create `src/extension/llm-adapters/openai-compat.ts`

**Files:**
- Create: `src/extension/llm-adapters/openai-compat.ts`

- [ ] **Step 1: Write the SSE accumulator tests**

The VS Code adapter imports `vscode` which isn't available in Node test context, so we
test the *protocol layer* directly: a standalone SSE-parsing helper that mirrors the
accumulation logic inside the adapter. This validates our understanding of the OpenAI
streaming wire format without touching VS Code at all.

Append to `test/llm-openai-compat.mjs`:

```javascript
import { createServer } from 'node:http';

// ─── standalone SSE accumulator (mirrors openai-compat.ts logic) ─────────────

/**
 * Parse an OpenAI-format SSE stream from a ReadableStream of text.
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

// helper: turn an SSE string into an async iterable of lines
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
```

- [ ] **Step 2: Run tests — both new tests should pass**

```bash
cd /home/quant0/devs/skena && node --test test/llm-openai-compat.mjs 2>&1
```

Expected:
```
✔ LLMTool shape matches expected structure
✔ SSE accumulator: text chunks arrive in order
✔ SSE accumulator: tool call id + name from first chunk, arguments accumulated
```

If any fail, fix `consumeOpenAIStream` in the test file before continuing — the adapter's `_runTurn` uses the identical accumulation logic.

- [ ] **Step 3: Create `src/extension/llm-adapters/openai-compat.ts`**

```typescript
/**
 * OpenAICompatAdapter — ILLMClient implementation for any OpenAI-format provider.
 *
 * Works with: OpenAI, Groq, Together, Mistral, Ollama, LM Studio, and any other
 * provider that implements the OpenAI chat completions API.
 *
 * Configuration (VS Code settings):
 *   skena.ai.baseURL  — API base URL  (default: https://api.openai.com/v1)
 *   skena.ai.model    — model name    (default: gpt-4o)
 *   skena.ai.apiKey   — API key       (use "ollama" for Ollama, which ignores it)
 */

import OpenAI from 'openai';
import * as vscode from 'vscode';
import type { ILLMClient, LLMMessage, LLMTool, LLMToolCall, LLMCallbacks } from '../llm-client';

interface AdapterOptions {
  baseURL?: string;
  apiKey?:  string;
  model?:   string;
}

export class OpenAICompatAdapter implements ILLMClient {
  private _client: OpenAI | null = null;
  private _aborted = false;
  private _opts: AdapterOptions;

  /**
   * @param opts - override settings (used in tests with a mock server URL).
   *   When omitted, values are read from VS Code settings on each call.
   */
  constructor(opts: AdapterOptions = {}) {
    this._opts = opts;
  }

  invalidate(): void { this._client = null; }

  abort(): void { this._aborted = true; }

  private client(): OpenAI {
    if (this._client) return this._client;
    const cfg     = vscode.workspace.getConfiguration('skena.ai');
    const baseURL = this._opts.baseURL ?? cfg.get<string>('baseURL') ?? 'https://api.openai.com/v1';
    const apiKey  = this._opts.apiKey  ?? cfg.get<string>('apiKey')?.trim() ?? process.env['OPENAI_API_KEY'] ?? '';
    if (!apiKey) {
      throw new Error(
        'Skena AI (openai-compat): no API key. Set skena.ai.apiKey in settings.\n' +
        'For Ollama, set it to any non-empty string (e.g. "ollama").',
      );
    }
    this._client = new OpenAI({ baseURL, apiKey });
    return this._client;
  }

  private model(): string {
    if (this._opts.model) return this._opts.model;
    return vscode.workspace.getConfiguration('skena.ai').get<string>('model') ?? 'gpt-4o';
  }

  async chat(
    systemPrompt: string,
    history:      LLMMessage[],
    tools:        LLMTool[],
    callbacks:    LLMCallbacks,
  ): Promise<void> {
    this._aborted = false;

    // - convert LLMTool[] → OpenAI ChatCompletionTool[]
    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map(t => ({
      type:     'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    // - build initial message list
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content } as OpenAI.ChatCompletionMessageParam)),
    ];

    try {
      await this._runTurn(messages, openaiTools, callbacks, 0);
    } catch (err: unknown) {
      if (!this._aborted) {
        callbacks.onError((err as Error).message ?? String(err));
      }
    }
  }

  private async _runTurn(
    messages:  OpenAI.ChatCompletionMessageParam[],
    tools:     OpenAI.ChatCompletionTool[],
    callbacks: LLMCallbacks,
    depth:     number,
  ): Promise<void> {
    if (depth > 6 || this._aborted) { callbacks.onDone(); return; }

    const stream = await this.client().chat.completions.create({
      model:    this.model(),
      messages,
      tools:    tools.length > 0 ? tools : undefined,
      stream:   true,
    });

    // - accumulate streamed tool call fragments
    const toolCallAccum: Array<{ id: string; name: string; arguments: string }> = [];
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      if (this._aborted) break;

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // - text delta
      if (delta.content) {
        callbacks.onText(delta.content);
      }

      // - tool call delta (accumulate fragments)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccum[idx]) {
            toolCallAccum[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id)                      toolCallAccum[idx].id         = tc.id;
          if (tc.function?.name)          toolCallAccum[idx].name       = tc.function.name;
          if (tc.function?.arguments)     toolCallAccum[idx].arguments += tc.function.arguments;
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    if (this._aborted) { callbacks.onDone(); return; }

    // - text response complete
    if (finishReason === 'stop' || toolCallAccum.length === 0) {
      callbacks.onDone();
      return;
    }

    // - tool calls: execute each, then continue with results
    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
    const assistantToolCalls: OpenAI.ChatCompletionMessageToolCall[] = toolCallAccum.map(tc => ({
      id:       tc.id,
      type:     'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    for (const tc of toolCallAccum) {
      if (this._aborted) break;
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.arguments || '{}') as Record<string, unknown>; } catch { /* empty input */ }
      const result = await callbacks.onToolUse({ id: tc.id, name: tc.name, input } satisfies LLMToolCall);
      toolResults.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }

    if (this._aborted) { callbacks.onDone(); return; }

    await this._runTurn([
      ...messages,
      { role: 'assistant', content: null, tool_calls: assistantToolCalls },
      ...toolResults,
    ], tools, callbacks, depth + 1);
  }
}
```

- [ ] **Step 4: Check types**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1 | grep -E "openai-compat|error TS" | head -20
```

Expected: no errors for `openai-compat.ts`.

- [ ] **Step 5: Commit**

```bash
cd /home/quant0/devs/skena && git add src/extension/llm-adapters/openai-compat.ts test/llm-openai-compat.mjs && git commit -m "feat: add OpenAICompatAdapter + streaming mock tests"
```

---

### Task 5: Update `editor-provider.ts` — wire factory, remove `claude-client.ts`

**Files:**
- Modify: `src/extension/editor-provider.ts`
- Delete: `src/extension/claude-client.ts`

- [ ] **Step 1: Update imports in `editor-provider.ts`**

Replace the existing import of `ClaudeClient` (line 22):

```typescript
// REMOVE:
import { ClaudeClient } from './claude-client';

// ADD:
import { createLLMClient, CANVAS_TOOLS, ILLMClient } from './llm-client';
```

- [ ] **Step 2: Replace `claudeClient` field and add lazy init**

Find the line (around line 58):
```typescript
private readonly claudeClient = new ClaudeClient();
```

Replace with:
```typescript
private _llmClient: ILLMClient | null = null;

private async llmClient(): Promise<ILLMClient> {
  if (!this._llmClient) this._llmClient = await createLLMClient();
  return this._llmClient;
}
```

Also add a handler to re-create the client when settings change. In the `resolveCustomEditor` method, after the existing `panel.onDidDispose` setup (search for `onDidDispose`), add:

```typescript
// - re-create LLM client when provider/key/model settings change
const cfgDisposable = vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('skena.ai')) {
    this._llmClient = null;   // - force re-creation on next chat
  }
});
panel.onDidDispose(() => cfgDisposable.dispose());
```

- [ ] **Step 3: Update abort handler and `handleFloatingChatSend`**

Find (around line 163):
```typescript
case 'floatingChatAbort': this.claudeClient.abort(); break;
```
Replace with:
```typescript
case 'floatingChatAbort': this._llmClient?.abort(); break;
```

Find `handleFloatingChatSend` — it calls (around line 872):
```typescript
await this.claudeClient.chat(systemPrompt, apiHistory, {
  onText: ...
  onToolUse: ...
  onDone: ...
  onError: ...
});
```

Replace with (note `tools` parameter added, and `await llmClient()`):
```typescript
const client = await this.llmClient();
await client.chat(systemPrompt, apiHistory, CANVAS_TOOLS, {
  onText: (delta) => {
    send({ type: 'floatingChatDelta', delta });
  },

  onToolUse: async (tool) => {
    if (tool.name === 'add_note') {
      const content = (tool.input['content'] as string) ?? '';
      const addResult = this.addNoteToCanvas(document, msg.activeNodeId, content);
      if (addResult) {
        send({ type: 'floatingChatNodeAdded', node: addResult.node, edge: addResult.edge });
      }
      try { await writeCanvas(document.uri.fsPath, document.canvas); } catch { /* non-fatal */ }
      return content ? 'Note added to canvas.' : 'No content provided.';
    }

    if (tool.name === 'read_node') {
      const label = (tool.input['label'] as string) ?? '';
      const node  = document.canvas.nodes.find(n => n.nodeLabel === label);
      if (!node) return `No node with label ${label} found.`;
      const content = await nodeContent(node, canvasDir, 3000);
      return content || '(empty)';
    }

    if (tool.name === 'list_nodes') {
      const lines = document.canvas.nodes
        .filter(n => n.type !== 'group')
        .map(n => `[${n.nodeLabel ?? n.id.slice(0, 6)}] (${n.type}) ${nodeTitle(n)}`);
      return lines.join('\n') || '(no nodes)';
    }

    return 'Unknown tool.';
  },

  onDone:  () => send({ type: 'floatingChatDone' }),
  onError: (message) => send({ type: 'floatingChatError', message }),
});
```

- [ ] **Step 4: Delete the old `claude-client.ts`**

```bash
cd /home/quant0/devs/skena && rm src/extension/claude-client.ts
```

- [ ] **Step 5: Full typecheck — must be clean**

```bash
cd /home/quant0/devs/skena && npm run typecheck 2>&1
```

Expected: zero errors. Fix any that appear before continuing.

- [ ] **Step 6: Commit**

```bash
cd /home/quant0/devs/skena && git add -A && git commit -m "feat: wire ILLMClient factory in editor-provider, remove claude-client.ts"
```

---

### Task 6: Build, run tests, and smoke-test with Ollama

**Files:**
- No new files

- [ ] **Step 1: Build the extension**

```bash
cd /home/quant0/devs/skena && npm run build 2>&1 | tail -10
```

Expected: build completes with no errors. `dist/extension.js` updated.

- [ ] **Step 2: Run the full test suite**

```bash
cd /home/quant0/devs/skena && node --test test/heatmap-bfs.mjs test/llm-openai-compat.mjs 2>&1
```

Expected:
```
✔ isolated node gets gray and 0.45 opacity
✔ single cluster of 2 nodes — newer node gets higher intensity
... (all 8 heatmap tests)
✔ LLMTool shape matches expected structure
✔ OpenAICompatAdapter streams text deltas
✔ OpenAICompatAdapter invokes tool and continues
```

If a test fails, investigate before continuing.

- [ ] **Step 3: Verify the extension packages cleanly**

```bash
cd /home/quant0/devs/skena && npm run package 2>&1 | tail -5
```

Expected: `.vsix` file created, no errors.

- [ ] **Step 4: Configure VS Code settings for Ollama smoke test**

Add to your VS Code `settings.json` (User or Workspace):

```jsonc
"skena.ai.provider": "openai-compat",
"skena.ai.baseURL":  "http://localhost:11434/v1",
"skena.ai.model":    "qwen2.5:32b",
"skena.ai.apiKey":   "ollama"
```

*(Adjust `model` to whatever you have pulled in Ollama — `ollama list` to check.)*

- [ ] **Step 5: Reload extension and test chat**

1. In VS Code: `Ctrl+Shift+P` → `Developer: Reload Window`
2. Open any `.canvas` file
3. Press `Ctrl+\`` to open the floating chat
4. Type a message and verify a response streams back from Ollama
5. Ask the agent to `list all nodes` — verify the `list_nodes` tool fires and results are used

- [ ] **Step 6: Commit**

```bash
cd /home/quant0/devs/skena && git add -A && git commit -m "test: verify LLM adapter build and Ollama smoke test passes"
```

---

### Task 7: Final cleanup — update remaining references and docs

**Files:**
- Modify: `src/extension/context-builder.ts` (if it imports from `claude-client`)
- Modify: `package.json` — clean up old `skena.ai.apiKey` description

- [ ] **Step 1: Check for stale imports**

```bash
cd /home/quant0/devs/skena && grep -r "claude-client" src/ 2>/dev/null
```

Expected: no results. If any appear, update those imports to point to `llm-client.ts` or `llm-adapters/anthropic.ts`.

- [ ] **Step 2: Update `skena.ai.apiKey` description in `package.json`**

Find `skena.ai.apiKey` in `package.json` and update its `markdownDescription`:

```jsonc
"skena.ai.apiKey": {
  "type": "string",
  "default": "",
  "markdownDescription": "API key for the AI companion.\n- **anthropic** provider: Anthropic API key (falls back to `ANTHROPIC_API_KEY` env var)\n- **openai-compat** provider: OpenAI / Groq / etc. key. For **Ollama** set this to any non-empty string (e.g. `\"ollama\"`).",
  "scope": "window"
},
```

- [ ] **Step 3: Final typecheck + build**

```bash
cd /home/quant0/devs/skena && npm run typecheck && npm run build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Final commit**

```bash
cd /home/quant0/devs/skena && git add -A && git commit -m "chore: update apiKey docs and verify no stale claude-client refs"
```

---

## Ollama Quick-Start (for reference)

If Ollama is not yet running:

```bash
# - pull a model (qwen2.5 is a good default for code/reasoning)
ollama pull qwen2.5:32b

# - start Ollama (if not already running as a service)
ollama serve
```

Verify it's up:
```bash
curl http://localhost:11434/v1/models
```

Then configure VS Code settings as in Task 6 Step 4.
