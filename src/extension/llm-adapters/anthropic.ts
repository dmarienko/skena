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
