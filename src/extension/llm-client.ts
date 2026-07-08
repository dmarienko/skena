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
import type { ChatToolEvent, ChatTokenUsage } from '../shared/types';

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

/**
 * - per-call canvas context. Used by the harness adapter to target the MCP
 * - server + tell the model which canvas to operate on. Other adapters ignore it.
 */
export interface LLMContext {
  canvasPath?:   string;
  activeNodeId?: string | null;
  workspaceDir?: string;
  /** - prior CC session id for this canvas (harness --resume); null = fresh */
  sessionId?:    string | null;
  /** - whether to resume the prior session (skena.ai.session.restore) */
  restoreSession?: boolean;
}

/** - turn cost: session-cumulative + this turn's delta (harness only) */
export interface LLMUsage {
  costUsd:  number;
  deltaUsd: number;
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
  onDone:    (usage?: LLMUsage) => void;
  /** - called on network or API errors */
  onError:   (message: string) => void;
  /** - harness: report the CC session id so it can be resumed next time */
  onSessionId?: (id: string) => void;
  /** - harness: display-only tool/thinking events (CC executes the tool itself) */
  onToolEvent?: (e: ChatToolEvent) => void;
  /** - harness: live token usage for the running turn */
  onUsage?:     (u: ChatTokenUsage) => void;
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
    context?:     LLMContext,
  ): Promise<void>;

  /** - cancel the current in-flight request */
  abort(): void;

  /** - force re-read of API key on next call (call after settings change) */
  invalidate(): void;

  /** - harness: tear down the persistent process for a canvas (on panel close) */
  disposeSession?(canvasPath: string): void;

  /** - harness: kill + forget the session so the next message starts fresh */
  resetSession?(canvasPath: string): void;

  /** - harness: summarise the live session via /compact */
  compact?(canvasPath: string, callbacks: LLMCallbacks): void;

  /** - harness: kill ALL persistent processes (on extension shutdown) */
  disposeAll?(): void;
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

  if (provider === 'harness') {
    const { HarnessAdapter } = await import('./llm-adapters/harness');
    return new HarnessAdapter();
  }

  if (provider === 'openai-compat') {
    const { OpenAICompatAdapter } = await import('./llm-adapters/openai-compat');
    return new OpenAICompatAdapter();
  }

  // - default: anthropic
  const { AnthropicAdapter } = await import('./llm-adapters/anthropic');
  return new AnthropicAdapter();
}
