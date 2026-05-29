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
