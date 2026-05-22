# AI Companion Phase 2 — Design Spec

> **Status:** Approved  
> **Date:** 2026-05-22  
> **Branch:** feature/ai-companion

---

## Goal

Deepen agent immersion in the canvas: the agent sees the graph context intelligently, loads domain-specific behaviour via plugins, can interact with typed widget nodes that form composable data pipelines, and works with any OpenAI-compatible or Anthropic LLM provider.

---

## Architecture Overview

### New files

| File | Purpose |
|------|---------|
| `src/extension/llm-client.ts` | `ILLMClient` interface + shared types (`LLMMessage`, `LLMTool`, `LLMToolCall`, `LLMDelta`) |
| `src/extension/llm-adapters/anthropic.ts` | Anthropic adapter — wraps existing claude-client logic, native streaming + tool use |
| `src/extension/llm-adapters/openai-compat.ts` | OpenAI-compatible adapter — works with OpenAI, Groq, Ollama, Mistral, Together, etc. |
| `src/extension/plugin-loader.ts` | Discover + parse `*.skena-plugin.md` files; build `PluginDefinition[]` |
| `src/extension/widget-registry.ts` | Static map of widget type → `WidgetDefinition` + action handlers |
| `src/webview/canvas/nodes/WidgetNode.tsx` | React component — renders inputs, named I/O handles, action buttons, output area |
| `src/webview/canvas/nodes/AgentConfigNode.tsx` | React component — shows active plugins, model, editable persona |
| `src/webview/hooks/useWidgetAction.ts` | Webview-side hook — sends `widgetAction` message, receives `widgetActionResult` |
| `src/plugins/math.skena-plugin.md` | Built-in math plugin |
| `src/plugins/quant.skena-plugin.md` | Built-in quant/trading plugin |
| `src/plugins/research.skena-plugin.md` | Built-in research plugin |
| `src/plugins/code.skena-plugin.md` | Built-in code plugin |

### Modified files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `WidgetNodeData`, `AgentConfigNodeData`, `WidgetDefinition`, `WidgetInput`, `WidgetOutput`, `WidgetAction`, `PluginDefinition`; new message types `widgetAction`, `widgetActionResult` |
| `src/extension/claude-client.ts` | Register `invoke_widget_action` + `find_nodes` tools |
| `src/extension/context-builder.ts` | Inject active plugins, widget manifest, canvas persona into system prompt |
| `src/extension/claude-client.ts` | **Renamed** to `llm-adapters/anthropic.ts`; existing logic moved |
| `src/extension/editor-provider.ts` | Load plugins on canvas open; instantiate correct LLM adapter from settings; handle `widgetAction` messages; propagate pipe edges after action |
| `src/webview/canvas/CanvasView.tsx` | Register `WidgetNode` and `AgentConfigNode` node types |

---

## 1. LLM Provider Abstraction

### `ILLMClient` interface (`src/extension/llm-client.ts`)

```typescript
export interface LLMMessage {
  role:    'user' | 'assistant' | 'tool';
  content: string | LLMToolResult[];
}

export interface LLMTool {
  name:        string;
  description: string;
  parameters:  Record<string, unknown>;  // - JSON Schema object
}

export interface LLMToolCall {
  id:     string;
  name:   string;
  input:  Record<string, unknown>;
}

export interface LLMDelta {
  text?:     string;       // - streaming text chunk
  toolCall?: LLMToolCall;  // - completed tool call
  done?:     true;
}

export interface ILLMClient {
  /**
   * Stream a response. Calls onDelta for each chunk.
   * Resolves with all tool calls made during the turn (may be empty).
   */
  stream(
    systemPrompt: string,
    messages:     LLMMessage[],
    tools:        LLMTool[],
    onDelta:      (delta: LLMDelta) => void,
  ): Promise<LLMToolCall[]>;

  /** Submit tool results and continue streaming. */
  submitToolResults(
    toolResults: LLMToolResult[],
    onDelta:     (delta: LLMDelta) => void,
  ): Promise<LLMToolCall[]>;
}
```

### Adapters

#### `src/extension/llm-adapters/anthropic.ts`

- Wraps `@anthropic-ai/sdk` — preserves native streaming, extended tool use depth, and prompt caching headers
- Reads `apiKey` from VS Code secret storage (`skena.ai.anthropic.apiKey`)
- Translates `ILLMClient` calls → Anthropic SDK `messages.stream()`
- Maps Anthropic tool_use blocks → `LLMToolCall[]`

#### `src/extension/llm-adapters/openai-compat.ts`

- Uses `openai` npm package with configurable `baseURL`
- Covers: OpenAI, Groq, Together, Mistral, Ollama (local), LM Studio, any OpenAI-format provider
- Reads `baseURL` + `apiKey` from settings
- Translates `ILLMClient` calls → OpenAI `chat.completions.create({ stream: true })`
- Maps OpenAI `tool_calls` chunks → `LLMToolCall[]`

### VS Code settings (`package.json` contributes)

```jsonc
"skena.ai.provider": {
  "type": "string",
  "enum": ["anthropic", "openai-compat"],
  "default": "anthropic",
  "description": "LLM provider to use for the AI companion"
},
"skena.ai.model": {
  "type": "string",
  "default": "claude-opus-4-5",
  "description": "Model name (must match the selected provider)"
},
"skena.ai.baseURL": {
  "type": "string",
  "default": "https://api.openai.com/v1",
  "description": "Base URL for openai-compat provider (e.g. http://localhost:11434/v1 for Ollama)"
}
```

API keys are stored in VS Code secret storage (not settings) via `context.secrets`:
- `skena.ai.anthropic.apiKey` — set via command `Skena: Set Anthropic API Key`
- `skena.ai.openai.apiKey` — set via command `Skena: Set OpenAI API Key`

### Adapter instantiation (`editor-provider.ts`)

```typescript
function createLLMClient(context: vscode.ExtensionContext): ILLMClient {
  const provider = vscode.workspace.getConfiguration('skena.ai').get<string>('provider', 'anthropic');
  if (provider === 'anthropic') {
    const apiKey = await context.secrets.get('skena.ai.anthropic.apiKey') ?? '';
    return new AnthropicAdapter({ apiKey });
  }
  const apiKey  = await context.secrets.get('skena.ai.openai.apiKey') ?? '';
  const baseURL = vscode.workspace.getConfiguration('skena.ai').get<string>('baseURL', 'https://api.openai.com/v1');
  const model   = vscode.workspace.getConfiguration('skena.ai').get<string>('model', 'gpt-4o');
  return new OpenAICompatAdapter({ apiKey, baseURL, model });
}
```

The returned `ILLMClient` is passed into the existing streaming + tool use pipeline in `editor-provider.ts`. All higher-level code (context building, tool dispatch, widget action invocation) is provider-agnostic.

### Example provider configs

| Provider | `provider` | `baseURL` | `model` |
|---|---|---|---|
| Anthropic (default) | `anthropic` | — | `claude-opus-4-5` |
| OpenAI | `openai-compat` | `https://api.openai.com/v1` | `gpt-4o` |
| Groq | `openai-compat` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local) | `openai-compat` | `http://localhost:11434/v1` | `qwen2.5:32b` |
| LM Studio | `openai-compat` | `http://localhost:1234/v1` | *(model loaded in LM Studio)* |

---

## 2. Plugin System

### Plugin file format

```markdown
---
name: quant
description: Quantitative trading research assistant
widgets:
  - backtest-report
---

# Quant Plugin

You are a quantitative trading assistant. You understand Qubx backtesting
framework, trading strategy development and analysis.

When you see a backtest-report widget you can load and analyse it automatically.
```

- **`name`** — unique identifier, referenced by config node
- **`description`** — shown in AgentConfigNode UI
- **`widgets`** — list of widget types this plugin activates (informs widget manifest filtering)
- **Body** — injected verbatim as a section in the system prompt

### Plugin discovery order

1. `src/plugins/` — built-ins bundled with the extension
2. `~/.skena/plugins/` — user global plugins
3. `.skena-plugins/` — workspace-local plugins

Later entries with the same `name` override earlier ones.

### Built-in plugins (Day 1)

| Name | Focus |
|------|-------|
| `math` | Equations, proofs, LaTeX notation |
| `quant` | Trading, Qubx, backtests — activates `backtest-report` widget |
| `research` | Literature review, citations |
| `code` | Python/TS, debugging, refactoring |

### `plugin-loader.ts` responsibilities

- Scan the three discovery directories for `*.skena-plugin.md`
- Parse YAML frontmatter using `gray-matter` (already a transitive dep via vscode tooling; add explicitly if absent)
- Return `PluginDefinition[]` keyed by name
- Called by `editor-provider.ts` when a canvas opens

---

## 3. Agent Config Node

### Node type: `agent-config`

A special canvas node. Exactly one per canvas (soft constraint — loader uses first found).

### Content format (edited inline like any text node)

```yaml
---
type: agent-config
plugins:
  - quant
  - my-rules
model: claude-opus-4-5   # optional — overrides default
---

Focus on strategy performance analysis.
Be concise. Use markdown tables for metrics.
```

- **`plugins`** — names of plugins to activate; `my-rules` is a user plugin at `~/.skena/plugins/my-rules.skena-plugin.md`
- **`model`** — optional model override per canvas
- **Body** — per-canvas persona, appended after plugin blocks in system prompt

### `AgentConfigNode.tsx`

- Renders as a distinct node style (subtle border, ⚙ icon, plugin list visible)
- Body editable via Monaco like a text node
- Read-only summary of active plugins shown as badges

---

## 4. Widget Node System

### `WidgetDefinition` type

```typescript
interface WidgetDefinition {
  type:        string;           // - "backtest-report"
  label:       string;           // - "Backtest Report"
  description: string;           // - shown in agent's widget manifest
  icon:        string;           // - emoji or codicon
  inputs:      WidgetInput[];    // - left-side handles
  outputs:     WidgetOutput[];   // - right-side handles
  actions:     WidgetAction[];   // - runnable actions
}

interface WidgetInput  { name: string; type: string; label: string; required: boolean }
interface WidgetOutput { name: string; type: string; label: string }
interface WidgetAction { name: string; label: string; description: string }
```

### `WidgetNodeData` type

```typescript
interface WidgetNodeData extends CanvasNodeBase {
  widgetType:  string;
  inputs:      Record<string, string>;           // - current input values
  outputs:     Record<string, unknown>;          // - last action outputs, persisted
  lastAction?: string;                           // - last action name run
  status?:     'idle' | 'running' | 'done' | 'error';
  error?:      string;
}
```

### `WidgetNode.tsx` layout

```
┌─────────────────────────────┐
│ 📊  Backtest Report    idle │  ← header (icon + label + status badge)
├─────────────────────────────┤
●─ path  [  s3://…        ]   │  ← input handle (left) + editable field
│                             │
│  [   output area / markdown ]│  ← shown after action runs, scrollable
│                             │
│               [▶ run] [↺]  ●│─ output handles (right, per output)
└─────────────────────────────┘
```

- **Left handles** — one per `inputs[]` entry, `id = "in:<name>"`
- **Right handles** — one per `outputs[]` entry, `id = "out:<name>"`
- **Action buttons** — small row at bottom-right; disabled until required inputs filled
- **Output area** — renders `lastOutput` as markdown; hidden when empty
- **Status badge** — `idle` / `running…` / `done ✓` / `error ✗`

### Data-pipe edges

Regular ReactFlow edges between widget nodes that connect an output handle to an input handle carry:

```typescript
{
  sourceHandle: "out:sharpe",
  targetHandle: "in:value",
  data: { pipe: true }
}
```

After an action completes, `editor-provider.ts`:
1. Reads the node's new `outputs`
2. Finds all outgoing edges where `data.pipe === true`
3. For each, copies `String(outputs[sourceHandle.replace("out:","")])` → `target.inputs[targetHandle.replace("in:","")]` (coerce to string — inputs are always strings)
4. Saves updated canvas

### Built-in widget types (Day 1)

#### `show-message` (test/debug)

```typescript
inputs:  [{ name: "message", type: "string", label: "Message", required: true }]
outputs: []   // - terminal widget, no outputs
actions: [{ name: "show", label: "Show", description: "Display the message in the output area" }]
```

Action handler: returns `{ output: inputs.message }` immediately. No external calls. Used to validate the full pipeline.

#### `backtest-report`

```typescript
inputs:  [{ name: "path", type: "string", label: "Backtest path", required: true }]
outputs: [
  { name: "report",  type: "string",  label: "Full report (markdown)" },
  { name: "sharpe",  type: "number",  label: "Sharpe ratio" },
  { name: "mdd",     type: "number",  label: "Max drawdown %" },
  { name: "trades",  type: "number",  label: "Trade count" },
]
actions: [{ name: "load_report", label: "Load Report", description: "Load backtest results and generate a performance report" }]
```

Action handler: reads backtest result from `path` (S3 or local), formats as markdown, extracts key metrics into named outputs.

---

## 5. Agent Integration

### System prompt assembly (`context-builder.ts`)

```
## Focused Node
[full content — 3 000 chars max]

## Connected Nodes
[1-hop neighbours — title + 200 char excerpt each]

## Plugin: quant
[plugin body text]

## Plugin: my-rules
[plugin body text]

## Canvas Persona
[agent-config node body text]

## Available Widget Actions
[show-message:node-abc] inputs: {message: string} — actions: show
[backtest-report:node-xyz] inputs: {path: string} — actions: load_report
  outputs: report (string), sharpe (number), mdd (number), trades (number)

## Canvas Node Index
[title list of all nodes — for graph queries]
```

Widget manifest includes **all widget nodes present on the current canvas**, regardless of which plugins are active. Plugins affect only the system prompt text injected — not widget availability. A widget node on canvas is always visible to the agent.

### New tools (`claude-client.ts`)

#### `invoke_widget_action`

```typescript
{
  name: "invoke_widget_action",
  description: "Invoke an action on a widget node. Use when you want to load data, run a computation, or display output through a widget already on the canvas.",
  input_schema: {
    type: "object",
    properties: {
      nodeId:  { type: "string", description: "The widget node ID from the widget manifest" },
      action:  { type: "string", description: "Action name to invoke" },
      inputs:  { type: "object", description: "Input values — merged with existing node inputs" },
    },
    required: ["nodeId", "action"],
  }
}
```

Tool result: `{ output: string; outputs: Record<string, unknown>; error?: string }`

#### `find_nodes`

```typescript
{
  name: "find_nodes",
  description: "Search canvas nodes by label or content. Use to locate nodes relevant to the user's question before reading them.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search term" },
      type:  { type: "string", description: "Optional: filter by node type (text, file, widget, agent-config, …)" },
    },
    required: ["query"],
  }
}
```

Tool result: `Array<{ id, label, type, excerpt }>`

### New message types (`shared/types.ts`)

```typescript
// - webview → host
{ type: "widgetAction";       nodeId: string; action: string; inputs: Record<string, string> }
// - host → webview
{ type: "widgetActionResult"; nodeId: string; output: string; outputs: Record<string, unknown>; error?: string }
```

### Action invocation — dual paths

**Path A — agent triggers:**
1. Agent calls `invoke_widget_action` tool
2. `claude-client.ts` sends `widgetAction` message to host
3. `editor-provider.ts` → `widget-registry.ts` executes handler
4. Host sends `widgetActionResult` → webview (node re-renders) + tool result (agent sees output)
5. Agent continues response with result in context
6. Host propagates outputs along pipe edges

**Path B — user clicks ▶ run:**
1. User clicks action button in `WidgetNode.tsx`
2. `useWidgetAction` hook sends `widgetAction` message
3. Same handler path as above
4. `widgetActionResult` → webview only (agent not involved)
5. Host propagates outputs along pipe edges

---

## 6. Data Flow Summary

```
canvas open
  → plugin-loader scans plugin dirs
  → editor-provider loads PluginDefinition[] + reads agent-config node
  → context-builder assembles system prompt with plugins + widget manifest

user focuses node / opens chat
  → context-builder re-runs with new focused node
  → new system prompt sent to claude-client

agent or user triggers widget action
  → widgetAction msg → editor-provider → widget-registry.execute(type, action, inputs)
  → handler returns { output, outputs }
  → widgetActionResult → webview (node update) + tool result (if agent-triggered)
  → editor-provider walks pipe edges → propagates outputs to downstream inputs
  → canvas saved
```

---

## 7. Out of Scope (Phase 2)

- Chart widget (future)
- Code runner widget (future)
- Plugin marketplace / versioning
- Widget output type validation (inputs accept any string for now)
- Multi-agent / agent-to-agent messaging
- Cycle detection in pipe graphs (deferred — show error if cycle detected at runtime)

---

## Open Questions

None — all design decisions resolved.
