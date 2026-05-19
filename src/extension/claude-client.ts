/**
 * ClaudeClient — wraps the Anthropic SDK for the floating AI companion.
 *
 * Supports:
 *   - Streaming text responses
 *   - Tool use (add_note, read_node, list_nodes) with automatic multi-turn continuation
 *   - Graceful abort
 *
 * Usage:
 *   const client = new ClaudeClient();
 *   await client.chat(systemPrompt, history, { onText, onToolUse, onDone, onError });
 *   client.abort();  // cancel mid-stream
 */

import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

// ─── public types ─────────────────────────────────────────────────────────────

export type CanvasToolName = 'add_note' | 'read_node' | 'list_nodes';

export interface CanvasToolCall {
  id:    string;
  name:  CanvasToolName;
  input: Record<string, unknown>;
}

export interface ChatStreamCallbacks {
  /** - called for each streamed text delta */
  onText: (delta: string) => void;
  /**
   * - called when Claude makes a tool call.
   * - Must return the string result to send back to Claude.
   */
  onToolUse: (tool: CanvasToolCall) => Promise<string>;
  /** - called once the full exchange is complete */
  onDone: () => void;
  /** - called on API or network errors */
  onError: (message: string) => void;
}

export type SimpleMessage = { role: 'user' | 'assistant'; content: string };

// ─── tool definitions ─────────────────────────────────────────────────────────

const CANVAS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'add_note',
    description:
      'Add a text note to the canvas. The note will be positioned near and connected to the currently focused node with an edge. Use this to capture insights, findings, summaries, or next steps as permanent canvas artefacts.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Markdown content of the note. Keep it focused and concise.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'read_node',
    description:
      'Read the full text content of a canvas node by its short label (e.g. N3 or M12). Use this when you need more detail than the context provides.',
    input_schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Node label like N3 or M12 (as shown in the canvas node list)',
        },
      },
      required: ['label'],
    },
  },
  {
    name: 'list_nodes',
    description: 'List all nodes currently on the canvas with their labels, types, and titles.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ─── client class ─────────────────────────────────────────────────────────────

export class ClaudeClient {
  private _sdk: Anthropic | null = null;
  private _aborted = false;

  // - lazy-init so we pick up settings changes without restart
  private sdk(): Anthropic {
    const cfg    = vscode.workspace.getConfiguration('skena.ai');
    const apiKey = cfg.get<string>('apiKey')?.trim()
                ?? process.env['ANTHROPIC_API_KEY']
                ?? '';
    if (!apiKey) {
      throw new Error(
        'Skena AI: no API key found. Set skena.ai.apiKey in settings or the ANTHROPIC_API_KEY env var.',
      );
    }
    // - recreate if the stored key changed
    if (!this._sdk) {
      this._sdk = new Anthropic({ apiKey });
    }
    return this._sdk;
  }

  /** Call when the API key setting changes to force key reload on next call. */
  invalidate(): void {
    this._sdk = null;
  }

  /** Cancel the current streaming request. */
  abort(): void {
    this._aborted = true;
  }

  /**
   * Start a streaming chat turn.
   * `history` is the conversation so far (user+assistant alternating plain strings).
   * Tool use turns are handled internally and NOT appended to `history` — only the
   * final text response is exposed via `onText` / `onDone`.
   */
  async chat(
    systemPrompt: string,
    history: SimpleMessage[],
    callbacks: ChatStreamCallbacks,
  ): Promise<void> {
    this._aborted = false;
    const cfg   = vscode.workspace.getConfiguration('skena.ai');
    const model = cfg.get<string>('model') ?? 'claude-sonnet-4-5';

    try {
      const sdk  = this.sdk();
      const msgs = history.map(m => ({ role: m.role, content: m.content } satisfies Anthropic.MessageParam));
      await this._runTurn(sdk, model, systemPrompt, msgs, callbacks, 0);
    } catch (err: unknown) {
      const name = (err as Error).name ?? '';
      if (!name.includes('AbortError') && !this._aborted) {
        callbacks.onError((err as Error).message ?? String(err));
      }
    }
  }

  // ─── private ────────────────────────────────────────────────────────────────

  private async _runTurn(
    sdk:        Anthropic,
    model:      string,
    system:     string,
    messages:   Anthropic.MessageParam[],
    callbacks:  ChatStreamCallbacks,
    depth:      number,
  ): Promise<void> {
    if (depth > 6 || this._aborted) {
      callbacks.onDone();
      return;
    }

    // - collect tool-use blocks while streaming text deltas
    const toolInputBufs = new Map<string, string>();   // - tool_use id → partial JSON
    const toolBlocks: Array<{ id: string; name: string }> = [];
    let currentToolId: string | null = null;

    const stream = sdk.messages.stream({
      model,
      max_tokens: 4096,
      system,
      messages,
      tools: CANVAS_TOOLS,
    });

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
            toolInputBufs.set(
              currentToolId,
              (toolInputBufs.get(currentToolId) ?? '') + event.delta.partial_json,
            );
          }
          break;

        case 'content_block_stop':
          currentToolId = null;
          break;
      }
    }

    if (this._aborted) {
      callbacks.onDone();
      return;
    }

    const finalMsg = await stream.finalMessage();

    // - no tool calls → done
    if (finalMsg.stop_reason !== 'tool_use' || toolBlocks.length === 0) {
      callbacks.onDone();
      return;
    }

    // - execute each tool call and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tb of toolBlocks) {
      if (this._aborted) break;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(toolInputBufs.get(tb.id) ?? '{}') as Record<string, unknown>;
      } catch {
        // - malformed JSON, use empty input
      }
      const result = await callbacks.onToolUse({
        id:    tb.id,
        name:  tb.name as CanvasToolName,
        input,
      });
      toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
    }

    if (this._aborted) {
      callbacks.onDone();
      return;
    }

    // - continue conversation with tool results
    const next: Anthropic.MessageParam[] = [
      ...messages,
      { role: 'assistant', content: finalMsg.content },
      { role: 'user',      content: toolResults },
    ];
    await this._runTurn(sdk, model, system, next, callbacks, depth + 1);
  }
}
