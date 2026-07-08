# Claude Code Feedback in Chat — tool cards, thinking, live cost — Design

**Date**: 2026-07-08
**Status**: approved (brainstormed with user)
**Feature**: surface Claude Code's real-time work — tool calls, tool results, thinking, and live token/cost — in the FloatingChat, instead of showing only the final text.

## Decisions (locked with user)

- **Scope**: tool-use cards + thinking blocks + live token/cost meter.
- **Persistence**: persist the full interleaved timeline (text + tool cards + thinking) to the `.skena.json` sidecar → reopening a canvas shows what CC did. Requires a `ChatItem[]` model (replaces `ChatMessage[]`) with backward-compatible migration.
- **Noise**: curated — friendly tool names, `TodoWrite` rendered as a checklist, noisy `Read` + raw `TodoWrite` dumps collapsed/hidden.

## Background (current pipeline, FACT)

- `harness.ts` runs a persistent `claude --input-format stream-json --output-format stream-json --verbose --print …` per canvas.
- `onEvent()` handles `system:init`, `assistant` (**text only** — `harness.ts:343` filters `content` to `type==='text'`), `result` (cost/finish). **No `case 'user'`**, so `tool_result` is never seen; `tool_use`/`thinking`/per-event `usage` are dropped.
- Text flows `onText` → editor-provider (`floatingChatDelta`) → `useFloatingChat.appendDelta` → streaming bubble → on Done a `ChatMessage{role,content,timestamp,costUsd?,deltaUsd?}` is pushed to `history` and persisted to `.skena.json`.

This feature is **parsing + protocol + rendering only** — no CLI/architecture change. The permission-approval machinery from claude-code-chat is NOT needed (headless `acceptEdits`/`allowedTools`).

## 1. Data model — `ChatItem` (replaces `ChatMessage`)

`src/shared/types.ts`. New discriminated union; the timeline is `ChatItem[]`.

```ts
export type ChatItem =
  | { kind: 'text'; role: 'user' | 'assistant'; content: string; timestamp: string; costUsd?: number; deltaUsd?: number }
  | { kind: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'ok' | 'error'; resultPreview?: string; timestamp: string }
  | { kind: 'thinking'; content: string; timestamp: string };
```

- `ChatMessage` is kept as a type alias / retained shape ONLY for migration (see §5). All new code uses `ChatItem`.
- A `text` item is a superset of the old `ChatMessage` (adds `kind`), so migration is lossless.

## 2. Callback channel — display-only tool events

`src/extension/llm-client.ts`. Do NOT overload `onToolUse` (that means "*you* execute and return a string" — anthropic/openai path). Add optional display channels used by the harness:

```ts
export type LLMToolEvent =
  | { kind: 'use'; id: string; name: string; input: unknown }
  | { kind: 'result'; id: string; ok: boolean; preview: string }
  | { kind: 'thinking'; content: string };

export interface LLMTokenUsage {
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number;
}

// added to LLMCallbacks (both optional — only the harness emits them):
onToolEvent?: (e: LLMToolEvent) => void;
onUsage?:     (u: LLMTokenUsage) => void;
```

## 3. Harness parsing — stop dropping events (`src/extension/llm-adapters/harness.ts`)

In `onEvent`'s `case 'assistant'`, iterate `message.content` in order (not a filter):

- `type==='text'` → `s.cb?.onText(item.text)` (unchanged behavior, but per-item so ordering is preserved).
- `type==='thinking'` → `s.cb?.onToolEvent?.({ kind: 'thinking', content: item.thinking })`.
- `type==='tool_use'` → `s.cb?.onToolEvent?.({ kind: 'use', id: item.id, name: item.name, input: item.input })`.
- Read `message.usage` → `s.cb?.onUsage?.({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheCreateTokens: usage.cache_creation_input_tokens ?? 0 })`.

Add a new `case 'user'`: iterate `message.content` for `type==='tool_result'`:

- `s.cb?.onToolEvent?.({ kind: 'result', id: item.tool_use_id, ok: item.is_error !== true, preview: previewOf(item.content) })`.
- `previewOf` = stringify (join text parts) then slice to ~500 chars.

Match results to uses **by `tool_use_id`** (both events carry it) — never positional. All new emissions guarded by `!s.aborted`, mirroring the existing text guard.

## 4. Host↔Webview protocol (`src/shared/types.ts` + `editor-provider.ts`)

New host→webview messages:

```ts
export interface MsgFloatingChatToolEvent { type: 'floatingChatToolEvent'; event: LLMToolEvent; }
export interface MsgFloatingChatUsage     { type: 'floatingChatUsage'; usage: LLMTokenUsage; }
```

Add both to the host→webview union. In `editor-provider.ts` where the harness callbacks are built (~L268 and the generic path ~L1016), wire:

```ts
onToolEvent: (event) => send({ type: 'floatingChatToolEvent', event }),
onUsage:     (usage) => send({ type: 'floatingChatUsage', usage }),
```

`floatingChatHistoryRestored` / `floatingChatSend` / persistence messages change their payload type `ChatMessage[]` → `ChatItem[]`.

## 5. Persistence + migration (`.skena.json` sidecar)

- Persisted history becomes `ChatItem[]`.
- **Migration on restore**: an item lacking a `kind` field is a legacy `ChatMessage` → coerce to `{ kind: 'text', ...item }`. Do this in the restore handler (host side when reading the sidecar, and defensively in `useFloatingChat.restoreHistory`).
- Tool/thinking items ARE persisted (that's the decision). Sidecar grows; acceptable.

## 6. Webview timeline (`useFloatingChat.ts` + `FloatingChat.tsx`)

**State**: `history: ChatItem[]`. During a turn:

- User send → push `{kind:'text', role:'user', …}`.
- Streaming assistant text accumulates in `streaming` (as today) — this is the **current open text item**.
- On a tool/thinking event: **flush** the current `streaming` buffer as a `{kind:'text', role:'assistant'}` item (if non-empty), then push the `{kind:'tool'|'thinking'}` item, then reset the buffer so subsequent text starts a new item. This preserves interleave order (text → tool → text …).
- Tool `result` event: find the open `{kind:'tool', id}` and update its `status`/`resultPreview` in place.
- On Done: flush any remaining `streaming` text as a final assistant text item; stamp cost onto the last assistant text item; persist the whole `ChatItem[]`.
- `onUsage`: update a live token counter (see meter below); does not create history items.

**Rendering** (`FloatingChat.tsx`), in `history` order:

- `text` → existing markdown bubble (user/assistant styles).
- `thinking` → dim, collapsible block ("💭 thinking", expandable).
- `tool` → a compact card: friendly label + status glyph (⏳ running / ✓ ok / ✗ error) + expandable input + `resultPreview`.
- Live token/cost **meter** in the chat header/status line: shows running in/out (+cache) tokens during the turn (from `onUsage`) and the turn cost from `floatingChatDone` (existing `costUsd`/`deltaUsd`).

## 7. Curation (webview, keep harness dumb)

A pure `toolCardView(name, input)` helper (webview) maps raw tool → friendly display:

- `Edit`/`MultiEdit`/`Write` → `Edit <basename(input.file_path)>`.
- `Bash` → `Bash: <input.command truncated ~60 chars>`.
- `Read` → **suppressed** by default (render nothing, or a subtle "· read <file>" line) — its result is also hidden.
- `TodoWrite` → **checklist**: render `input.todos` as ☐/☑/◐ lines; the tool_result for TodoWrite is hidden (the card already shows state).
- `mcp__skena__<x>` → strip prefix → `canvas: <x>` (e.g. `canvas: add node`).
- Unknown → the raw name + collapsed JSON input.

Noise policy lives entirely in this view layer, so the persisted timeline keeps full fidelity while the UI stays clean.

## Error handling

- Malformed tool event / missing `tool_use_id` → drop that event (never throw in the stream loop; mirrors the existing `JSON.parse` guard).
- A `result` with no matching open `use` (out-of-order/aborted) → ignored.
- Aborted turn → in-flight `running` cards are marked `error` on the abort/Done path so no card is stuck spinning.

## Testing

- **Pure unit (node --test, gitignored `test/`)**: `toolCardView` mapping (Edit/Bash/Read/TodoWrite/mcp/unknown); the interleave/flush reducer (text→tool→text ordering; result updates the right card by id; migration of a legacy `ChatMessage[]` sidecar → `ChatItem[]`).
- **Manual smoke (live VS Code)**: ask CC to do a multi-tool task (read a file, edit it, run a bash cmd, add a canvas node) → cards appear in order with running→ok transitions; thinking shows; token meter ticks; final cost shows; reopen the canvas → the full timeline restored from the sidecar; a pre-existing sidecar (old ChatMessage[]) still loads.

## Out of scope

- Token-level "typing" streaming (needs `--include-partial-messages` + `content_block_delta`) — text/thinking arrive as whole blocks.
- Interactive permission approval UI (headless; not applicable).
- Editing/re-running tool calls from the UI.
- Before/after edit diffs (claude-code-chat's file-read trick) — deferred; could be a later enhancement.
