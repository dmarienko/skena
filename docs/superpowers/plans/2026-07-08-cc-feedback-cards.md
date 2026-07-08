# CC Feedback Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Claude Code's real-time work — tool calls, tool results, thinking, live token/cost — in the FloatingChat, per `docs/superpowers/specs/2026-07-08-cc-feedback-cards-design.md`.

**Architecture:** The harness already streams `stream-json`; we stop discarding its `tool_use`/`thinking`/`tool_result`/`usage` events. New display-only callbacks (`onToolEvent`/`onUsage`) carry them host→webview via new messages. The chat history model changes from `ChatMessage[]` to an interleaved `ChatItem[]` (text | tool | thinking), folded by pure reducer functions and rendered as cards; curation (friendly names, TodoWrite checklist, Read hiding) is a pure view layer.

**Tech Stack:** TypeScript, React (webview), VS Code extension host (persistent `claude` CLI), esbuild, `node --test` for pure modules.

**Conventions:**
- Comments `// -` terse; no banner/divider comments; modern TS.
- `test/` is **gitignored** — run pure-module tests via esbuild bundle + `node --test`; never `git add` test files; inline fixtures.
- `npm run build` = full build; `npm run typecheck` has **exactly 3 pre-existing errors** in `src/extension/editor-provider.ts` `copyAbsolutePath` (`fsPath`) — introduce no new ones.
- Branch: continue on `feature/paste-to-node` (verify `git branch --show-current`).
- **Persistence is `context.workspaceState`** (key `skena.chatHistory.<uri>`), NOT a file — despite the spec saying "sidecar". Same semantics; migration still required.

**Key facts (from the code):**
- `harness.ts:341-347` — `assistant` case keeps only `type==='text'`; drops tool_use/thinking; no `case 'user'`.
- `editor-provider.ts:268-271` — harness callbacks build `floatingChatDelta/Done/Error`; `onToolUse: async () => ''` (stub — CC runs tools itself).
- `editor-provider.ts:177-183` — restore reads `workspaceState.get<ChatMessage[]>(historyKey)` → sends `floatingChatHistoryRestored`.
- `editor-provider.ts:964-990` — `handleFloatingChatSend` maps `msg.history` (role/content) into LLM context.
- `App.tsx:59` `makeEventTarget<T>()`; `:85-90` event targets; `:158-186` message cases; `:227-232` props to FloatingChat.
- `useFloatingChat.ts` — `history: ChatMessage[]`, `historyRef`, `appendDelta`/`completeDelta`/`restoreHistory`/`sendMessage`/`addNodeAdded`; persist via `floatingChatPersistHistory`.
- `FloatingChat.tsx:699-713` — renders `history.map(ChatBubble)` + streaming bubble; `:753+` `ChatBubble`.

---

### Task 1: Shared types + callback channels (additive, compiles)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/extension/llm-client.ts`

Purely additive — keep `ChatMessage` intact; add `ChatItem` and the new event types/messages so later tasks compile incrementally.

- [ ] **Step 1: `ChatItem` + protocol types in `src/shared/types.ts`**

Add near `ChatMessage` (~line 590):

```ts
/** - interleaved chat timeline item: assistant/user text, a tool call, or a thinking block */
export type ChatItem =
  | { kind: 'text'; role: 'user' | 'assistant'; content: string; timestamp: string; costUsd?: number; deltaUsd?: number }
  | { kind: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'ok' | 'error'; resultPreview?: string; timestamp: string }
  | { kind: 'thinking'; content: string; timestamp: string };

/** - display-only tool/thinking event streamed from Claude Code (harness) */
export type ChatToolEvent =
  | { kind: 'use'; id: string; name: string; input: unknown }
  | { kind: 'result'; id: string; ok: boolean; preview: string }
  | { kind: 'thinking'; content: string };

/** - live token usage for the running turn (harness) */
export interface ChatTokenUsage {
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number;
}
```

- [ ] **Step 2: New host→webview messages in `src/shared/types.ts`**

Add next to `MsgFloatingChatDelta` (~line 300):

```ts
export interface MsgFloatingChatToolEvent { type: 'floatingChatToolEvent'; event: ChatToolEvent; }
export interface MsgFloatingChatUsage     { type: 'floatingChatUsage'; usage: ChatTokenUsage; }
```

Add both to the host→webview union (the union containing `MsgFloatingChatDelta`, ~line 389):

```ts
  | MsgFloatingChatToolEvent
  | MsgFloatingChatUsage
```

- [ ] **Step 3: Callback fields in `src/extension/llm-client.ts`**

Import the two event types at the top (`import { ChatToolEvent, ChatTokenUsage } from '../shared/types';` — match the file's existing import style). Add to `LLMCallbacks` (after `onSessionId?`, ~line 66):

```ts
  /** - harness: display-only tool/thinking events (CC executes the tool itself) */
  onToolEvent?: (e: ChatToolEvent) => void;
  /** - harness: live token usage for the running turn */
  onUsage?:     (u: ChatTokenUsage) => void;
```

- [ ] **Step 4: Build + typecheck**

```bash
cd ~/devs/skena && npm run build && npm run typecheck
```
Expected: build OK; only the 3 pre-existing errors (all additive/optional, nothing consumes these yet).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/extension/llm-client.ts
git commit -m "feat(chat): ChatItem + tool-event/usage types and callbacks"
```

---

### Task 2: Harness emits tool/thinking/usage/result (host)

**Files:**
- Modify: `src/extension/llm-adapters/harness.ts` (`onEvent`, ~line 335-380)
- Modify: `src/extension/editor-provider.ts` (harness callbacks ~line 268; generic path ~line 1016)

- [ ] **Step 1: Parse the dropped events in `harness.ts` `case 'assistant'`**

Replace the current `case 'assistant'` block:

```ts
      case 'assistant': {
        const msg = ev['message'] as {
          content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
          usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
        } | undefined;
        if (msg?.usage && !s.aborted) {
          s.cb?.onUsage?.({
            inputTokens:       msg.usage.input_tokens ?? 0,
            outputTokens:      msg.usage.output_tokens ?? 0,
            cacheReadTokens:   msg.usage.cache_read_input_tokens ?? 0,
            cacheCreateTokens: msg.usage.cache_creation_input_tokens ?? 0,
          });
        }
        for (const item of msg?.content ?? []) {
          if (s.aborted) break;
          if (item.type === 'text' && item.text) { s.cb?.onText(item.text); s.anyText = true; }
          else if (item.type === 'thinking' && item.thinking) { s.cb?.onToolEvent?.({ kind: 'thinking', content: item.thinking }); }
          else if (item.type === 'tool_use' && item.id && item.name) { s.cb?.onToolEvent?.({ kind: 'use', id: item.id, name: item.name, input: item.input }); }
        }
        break;
      }
```

- [ ] **Step 2: Add `case 'user'` for tool results in `harness.ts` (right after `case 'assistant'`)**

```ts
      case 'user': {
        if (s.aborted) break;
        const msg = ev['message'] as {
          content?: Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>;
        } | undefined;
        for (const item of msg?.content ?? []) {
          if (item.type === 'tool_result' && item.tool_use_id) {
            s.cb?.onToolEvent?.({ kind: 'result', id: item.tool_use_id, ok: item.is_error !== true, preview: previewToolResult(item.content) });
          }
        }
        break;
      }
```

Add a module-scope helper near the top of the class file (below imports):

```ts
// - flatten a tool_result content payload to a short display string
function previewToolResult(content: unknown): string {
  let s: string;
  if (typeof content === 'string') s = content;
  else if (Array.isArray(content)) s = content.map(c => (c && typeof c === 'object' && 'text' in c) ? String((c as { text: unknown }).text) : '').join('');
  else s = content == null ? '' : JSON.stringify(content);
  return s.length > 500 ? s.slice(0, 500) + '…' : s;
}
```

- [ ] **Step 2b: Mark in-flight tools failed on abort/finish**

Not needed in the harness — the webview marks running cards on the Done/Error path (Task 6). No harness change here; this bullet is a reminder only, not a code step.

- [ ] **Step 3: Wire the callbacks in `editor-provider.ts`**

In BOTH callback objects (the harness stub block ~line 268 and the generic `client.chat(...)` block ~line 1016), add:

```ts
              onToolEvent: (event) => send({ type: 'floatingChatToolEvent', event }),
              onUsage:     (usage) => send({ type: 'floatingChatUsage', usage }),
```

(Match the indentation of each block. The generic path won't emit them today; harmless.)

- [ ] **Step 4: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; only 3 pre-existing errors.

- [ ] **Step 5: Commit**

```bash
git add src/extension/llm-adapters/harness.ts src/extension/editor-provider.ts
git commit -m "feat(chat): harness emits tool_use/thinking/tool_result/usage"
```

---

### Task 3: App.tsx forwards the new events to FloatingChat

**Files:**
- Modify: `src/webview/App.tsx` (event targets ~line 85; cases ~line 158; props ~line 227)

- [ ] **Step 1: Add event targets** (after `historyRestoredEvt`, ~line 90)

```ts
  const toolEventEvt = useRef(makeEventTarget<import('../shared/types').ChatToolEvent>());
  const usageEvt     = useRef(makeEventTarget<import('../shared/types').ChatTokenUsage>());
```

(If the file already imports from `../shared/types`, use named imports at the top instead of inline `import(...)` — match the file's style.)

- [ ] **Step 2: Emit on the new messages** (in the chat message switch, next to `floatingChatDelta`, ~line 158)

```ts
        case 'floatingChatToolEvent':
          toolEventEvt.current.emit(msg.event);
          break;
        case 'floatingChatUsage':
          usageEvt.current.emit(msg.usage);
          break;
```

- [ ] **Step 3: Pass as props to `<FloatingChat>`** (~line 227)

```ts
        onToolEvent={toolEventEvt.current.subscribe}
        onUsage={usageEvt.current.subscribe}
```

- [ ] **Step 4: Build + typecheck**

FloatingChat doesn't accept these props yet → expect a TS error on the new props. That's fine *within this task only if* you also add the prop types in Task 6; to keep this task green, add the two optional props to `FloatingChat`'s prop interface now as no-ops:

In `src/webview/canvas/FloatingChat.tsx`, add to the props interface (near `onHistoryRestored`):

```ts
  onToolEvent?:      (cb: (e: import('../../shared/types').ChatToolEvent) => void) => () => void;
  onUsage?:          (cb: (u: import('../../shared/types').ChatTokenUsage) => void) => () => void;
```

```bash
npm run build && npm run typecheck
```
Expected: build OK; only 3 pre-existing errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview/App.tsx src/webview/canvas/FloatingChat.tsx
git commit -m "feat(chat): route tool-event/usage messages to FloatingChat props"
```

---

### Task 4: `toolCardView` curation (pure, TDD)

**Files:**
- Create: `src/webview/canvas/chat/toolCardView.ts`
- Test: `test/tool-card-view.mjs` (gitignored)

- [ ] **Step 1: Write the failing test** — `test/tool-card-view.mjs`

```js
// test/tool-card-view.mjs
// - run: npx esbuild src/webview/canvas/chat/toolCardView.ts --bundle --format=esm --outfile=test/.build/toolCardView.mjs && node --test test/tool-card-view.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toolCardView } from './.build/toolCardView.mjs';

test('Edit → basename title, result shown', () => {
  const v = toolCardView('Edit', { file_path: '/home/u/proj/src/app.ts' });
  assert.equal(v.title, 'Edit app.ts');
  assert.equal(v.hidden, false);
  assert.equal(v.showResult, true);
});

test('Write and MultiEdit behave like Edit', () => {
  assert.equal(toolCardView('Write', { file_path: '/a/b.py' }).title, 'Edit b.py');
  assert.equal(toolCardView('MultiEdit', { file_path: '/a/c.md' }).title, 'Edit c.md');
});

test('Bash → truncated command', () => {
  const v = toolCardView('Bash', { command: 'git status --porcelain' });
  assert.equal(v.title, 'Bash: git status --porcelain');
  const long = toolCardView('Bash', { command: 'x'.repeat(80) });
  assert.ok(long.title.length <= 6 + 60 + 1, 'command truncated to ~60');
  assert.ok(long.title.endsWith('…'));
});

test('Read → hidden', () => {
  assert.equal(toolCardView('Read', { file_path: '/a/b' }).hidden, true);
});

test('TodoWrite → todo kind with items, result hidden', () => {
  const v = toolCardView('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] });
  assert.equal(v.kind, 'todo');
  assert.equal(v.showResult, false);
  assert.deepEqual(v.todos, [{ text: 'a', status: 'completed' }, { text: 'b', status: 'pending' }]);
});

test('mcp__skena__canvas_add_node → friendly canvas label', () => {
  assert.equal(toolCardView('mcp__skena__canvas_add_node', {}).title, 'canvas: add node');
});

test('unknown tool → raw name', () => {
  assert.equal(toolCardView('Grep', { pattern: 'x' }).title, 'Grep');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd ~/devs/skena
npx esbuild src/webview/canvas/chat/toolCardView.ts --bundle --format=esm --outfile=test/.build/toolCardView.mjs
```
Expected: esbuild FAILS — file doesn't exist.

- [ ] **Step 3: Implement** — `src/webview/canvas/chat/toolCardView.ts`

```ts
// - pure mapping from a raw CC tool call to a curated card view; no DOM. Unit-tested.

export interface ToolTodo { text: string; status: string }

export interface ToolCardView {
  title:      string;
  hidden:     boolean;                 // - suppress the card entirely (e.g. Read)
  showResult: boolean;                 // - render resultPreview under the card
  kind:       'generic' | 'todo';
  todos?:     ToolTodo[];
}

function basename(p: unknown): string {
  const s = typeof p === 'string' ? p : '';
  const i = s.replace(/\/+$/, '').lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

export function toolCardView(name: string, input: unknown): ToolCardView {
  const inp = (input ?? {}) as Record<string, unknown>;

  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') {
    return { title: `Edit ${basename(inp.file_path)}`, hidden: false, showResult: true, kind: 'generic' };
  }
  if (name === 'Bash') {
    const cmd = typeof inp.command === 'string' ? inp.command : '';
    const short = cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd;
    return { title: `Bash: ${short}`, hidden: false, showResult: true, kind: 'generic' };
  }
  if (name === 'Read') {
    return { title: `Read ${basename(inp.file_path)}`, hidden: true, showResult: false, kind: 'generic' };
  }
  if (name === 'TodoWrite') {
    const todos = Array.isArray(inp.todos)
      ? (inp.todos as Array<Record<string, unknown>>).map(t => ({ text: String(t.content ?? t.text ?? ''), status: String(t.status ?? '') }))
      : [];
    return { title: 'Todo', hidden: false, showResult: false, kind: 'todo', todos };
  }
  if (name.startsWith('mcp__skena__')) {
    const rest = name.slice('mcp__skena__'.length).replace(/^canvas_/, 'canvas ').replace(/_/g, ' ');
    return { title: rest.startsWith('canvas ') ? rest.replace('canvas ', 'canvas: ') : `canvas: ${rest}`, hidden: false, showResult: true, kind: 'generic' };
  }
  return { title: name, hidden: false, showResult: true, kind: 'generic' };
}
```

- [ ] **Step 4: Run tests**

```bash
npx esbuild src/webview/canvas/chat/toolCardView.ts --bundle --format=esm --outfile=test/.build/toolCardView.mjs && node --test test/tool-card-view.mjs
```
Expected: 7 pass.

- [ ] **Step 5: Commit (source only)**

```bash
git add src/webview/canvas/chat/toolCardView.ts
git commit -m "feat(chat): pure toolCardView curation"
```

---

### Task 5: `chatTimeline` reducer + migration (pure, TDD)

**Files:**
- Create: `src/webview/canvas/chat/chatTimeline.ts`
- Test: `test/chat-timeline.mjs` (gitignored)

- [ ] **Step 1: Write the failing test** — `test/chat-timeline.mjs`

```js
// test/chat-timeline.mjs
// - run: npx esbuild src/webview/canvas/chat/chatTimeline.ts --bundle --format=esm --outfile=test/.build/chatTimeline.mjs && node --test test/chat-timeline.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyToolEvent, flushPendingText, migrateHistory } from './.build/chatTimeline.mjs';

const TS = '2026-07-08T00:00:00Z';

test('tool use flushes pending text, then appends a running card', () => {
  let items = [];
  let pending = 'hello ';
  ({ items, pending } = applyToolEvent(items, pending, { kind: 'use', id: 't1', name: 'Bash', input: { command: 'ls' } }, TS));
  assert.equal(items.length, 2);
  assert.deepEqual({ kind: items[0].kind, role: items[0].role, content: items[0].content }, { kind: 'text', role: 'assistant', content: 'hello ' });
  assert.equal(items[1].kind, 'tool');
  assert.equal(items[1].status, 'running');
  assert.equal(pending, '');   // - buffer reset so later text starts a new item
});

test('result updates the matching card by id', () => {
  let items = [{ kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'running', timestamp: TS }];
  let pending = '';
  ({ items, pending } = applyToolEvent(items, pending, { kind: 'result', id: 't1', ok: true, preview: 'done' }, TS));
  assert.equal(items[0].status, 'ok');
  assert.equal(items[0].resultPreview, 'done');
});

test('result with error → status error', () => {
  let items = [{ kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'running', timestamp: TS }];
  ({ items } = applyToolEvent(items, '', { kind: 'result', id: 't1', ok: false, preview: 'boom' }, TS));
  assert.equal(items[0].status, 'error');
});

test('result for unknown id is ignored (no throw)', () => {
  const { items } = applyToolEvent([], '', { kind: 'result', id: 'nope', ok: true, preview: 'x' }, TS);
  assert.deepEqual(items, []);
});

test('thinking flushes text then appends a thinking item', () => {
  const { items, pending } = applyToolEvent([], 'partial', { kind: 'thinking', content: 'hmm' }, TS);
  assert.equal(items[0].content, 'partial');
  assert.equal(items[1].kind, 'thinking');
  assert.equal(items[1].content, 'hmm');
  assert.equal(pending, '');
});

test('empty pending text does not create an empty text item', () => {
  const { items } = applyToolEvent([], '', { kind: 'use', id: 't2', name: 'Read', input: {} }, TS);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'tool');
});

test('flushPendingText appends assistant text with cost', () => {
  const items = flushPendingText([], 'final answer', TS, { costUsd: 0.1, deltaUsd: 0.02 });
  assert.deepEqual(
    { kind: items[0].kind, content: items[0].content, deltaUsd: items[0].deltaUsd },
    { kind: 'text', content: 'final answer', deltaUsd: 0.02 },
  );
});

test('flushPendingText with empty text is a no-op', () => {
  assert.deepEqual(flushPendingText([{ kind: 'thinking', content: 'x', timestamp: TS }], '', TS), [{ kind: 'thinking', content: 'x', timestamp: TS }]);
});

test('migrateHistory upgrades legacy ChatMessage[] to ChatItem text items', () => {
  const legacy = [
    { role: 'user', content: 'hi', timestamp: TS },
    { role: 'assistant', content: 'yo', timestamp: TS, costUsd: 0.3, deltaUsd: 0.1 },
  ];
  const out = migrateHistory(legacy);
  assert.equal(out[0].kind, 'text');
  assert.equal(out[0].role, 'user');
  assert.equal(out[1].deltaUsd, 0.1);
});

test('migrateHistory passes through already-migrated items', () => {
  const items = [{ kind: 'tool', id: 't', name: 'Bash', input: {}, status: 'ok', timestamp: TS }];
  assert.deepEqual(migrateHistory(items), items);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx esbuild src/webview/canvas/chat/chatTimeline.ts --bundle --format=esm --outfile=test/.build/chatTimeline.mjs
```
Expected: esbuild FAILS — file doesn't exist.

- [ ] **Step 3: Implement** — `src/webview/canvas/chat/chatTimeline.ts`

```ts
// - pure folds over the chat timeline (ChatItem[]); no DOM/React. Unit-tested.
import { ChatItem, ChatToolEvent } from '../../../shared/types';

// - append the pending assistant text (if any) as a text item; optionally stamp cost
export function flushPendingText(
  items: ChatItem[],
  pending: string,
  ts: string,
  cost?: { costUsd?: number; deltaUsd?: number },
): ChatItem[] {
  if (!pending) return items;
  return [...items, { kind: 'text', role: 'assistant', content: pending, timestamp: ts, costUsd: cost?.costUsd, deltaUsd: cost?.deltaUsd }];
}

// - fold one display tool event into (items, pending). `use`/`thinking` flush pending
// - text first (preserving interleave order); `result` updates the matching card by id.
export function applyToolEvent(
  items: ChatItem[],
  pending: string,
  e: ChatToolEvent,
  ts: string,
): { items: ChatItem[]; pending: string } {
  if (e.kind === 'result') {
    const next = items.map(it =>
      it.kind === 'tool' && it.id === e.id
        ? { ...it, status: e.ok ? 'ok' as const : 'error' as const, resultPreview: e.preview }
        : it,
    );
    return { items: next, pending };
  }
  const flushed = flushPendingText(items, pending, ts);
  const item: ChatItem = e.kind === 'use'
    ? { kind: 'tool', id: e.id, name: e.name, input: e.input, status: 'running', timestamp: ts }
    : { kind: 'thinking', content: e.content, timestamp: ts };
  return { items: [...flushed, item], pending: '' };
}

// - upgrade persisted history: legacy ChatMessage (no `kind`) → text ChatItem
export function migrateHistory(raw: unknown[]): ChatItem[] {
  return (raw ?? []).map(r => {
    const o = r as Record<string, unknown>;
    if (o && typeof o === 'object' && 'kind' in o) return o as unknown as ChatItem;
    return { kind: 'text', role: (o?.role as 'user' | 'assistant') ?? 'assistant', content: String(o?.content ?? ''), timestamp: String(o?.timestamp ?? ''), costUsd: o?.costUsd as number | undefined, deltaUsd: o?.deltaUsd as number | undefined };
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npx esbuild src/webview/canvas/chat/chatTimeline.ts --bundle --format=esm --outfile=test/.build/chatTimeline.mjs && node --test test/chat-timeline.mjs
```
Expected: 10 pass.

- [ ] **Step 5: Commit (source only)**

```bash
git add src/webview/canvas/chat/chatTimeline.ts
git commit -m "feat(chat): pure chatTimeline reducer + legacy migration"
```

---

### Task 6: Wire `ChatItem[]` into `useFloatingChat` + host persistence/mapping

**Files:**
- Modify: `src/webview/hooks/useFloatingChat.ts`
- Modify: `src/extension/editor-provider.ts` (restore ~177, send-mapping ~964)

- [ ] **Step 1: Switch the hook's model to `ChatItem[]` + add handlers**

In `useFloatingChat.ts`:
- Import: `import { ChatItem, ChatToolEvent, ChatTokenUsage } from '../../shared/types';` and `import { applyToolEvent, flushPendingText, migrateHistory } from '../canvas/chat/chatTimeline';`.
- Change `history`/`historyRef` from `ChatMessage[]` to `ChatItem[]`.
- Add usage state: `const [usage, setUsage] = useState<ChatTokenUsage | null>(null);` and a `usageRef`.

Replace `completeDelta`, and update `appendDelta`/`sendMessage`/`addNodeAdded`/`restoreHistory` to the `ChatItem` shape:

```ts
  const appendDelta = useCallback((delta: string) => {
    setThinking(false);
    streamingRef.current += delta;
    setStreaming(s => s + delta);
  }, []);

  // - a display tool/thinking event: flush the open text bubble, then append/update the card
  const applyTool = useCallback((e: ChatToolEvent) => {
    setThinking(false);
    const r = applyToolEvent(historyRef.current, streamingRef.current, e, new Date().toISOString());
    streamingRef.current = r.pending;
    setStreaming(r.pending);
    historyRef.current = r.items;
    setHistory(r.items);
    persistHistory(r.items);
  }, [persistHistory]);

  const applyUsage = useCallback((u: ChatTokenUsage) => { usageRef.current = u; setUsage(u); }, []);

  const completeDelta = useCallback((cost?: { costUsd?: number; deltaUsd?: number }) => {
    const next = flushPendingText(historyRef.current, streamingRef.current, new Date().toISOString(), cost);
    streamingRef.current = '';
    setStreaming('');
    setThinking(false);
    setUsage(null); usageRef.current = null;
    // - any card still 'running' at turn end (aborted mid-tool) → mark error
    const closed = next.map(it => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error' as const } : it));
    historyRef.current = closed;
    setHistory(closed);
    persistHistory(closed);
  }, [persistHistory]);
```

Update `sendMessage`'s user push to a `ChatItem`:

```ts
    const userMsg: ChatItem = { kind: 'text', role: 'user', content: trimmed, timestamp: new Date().toISOString() };
```

Update `addNodeAdded`'s pushed item to `{ kind: 'text', role: 'assistant', content: … , timestamp: … }`.

Update `restoreHistory` to migrate:

```ts
  const restoreHistory = useCallback((payload: { history: unknown[]; collapsed?: boolean; pos?: FloatingChatPos; size?: FloatingChatSize; inputW?: number }) => {
    const migrated = migrateHistory(payload.history);
    historyRef.current = migrated;
    setHistory(migrated);
    if (payload.collapsed !== undefined) setCollapsed(payload.collapsed);
    if (payload.pos)  setPos(payload.pos);
    if (payload.size) setSize(payload.size);
    if (payload.inputW) { inputWRef.current = payload.inputW; setInputW(payload.inputW); }
  }, []);
```

Add `applyTool`, `applyUsage`, `usage` to the hook's return object.

- [ ] **Step 2: Host — migrate on restore + map ChatItem→LLM context in `editor-provider.ts`**

Restore (~line 179): the stored value may be legacy or new; send it as-is (webview migrates). Change the generic type to `unknown[]`:

```ts
            const savedHistory = this.context.workspaceState.get<unknown[]>(historyKey) ?? [];
```
(The `floatingChatHistoryRestored` payload type is now `unknown[]`/`ChatItem[]`; ensure `MsgFloatingChatHistoryRestored.history` is typed `ChatItem[]` in types.ts and the send compiles — cast if needed.)

Send-mapping (~line 971, `handleFloatingChatSend`): `msg.history` is now `ChatItem[]`; map only text items into LLM messages:

```ts
    const priorHistory = (msg.history ?? [])
      .filter((m): m is Extract<ChatItem, { kind: 'text' }> => (m as ChatItem).kind === 'text')
      .map(m => ({ role: m.role, content: m.content }));
```
(Adjust to the real variable/shape at that site; the key change is filtering to `kind==='text'` and using `role`/`content`. Import `ChatItem` in editor-provider.)

Also update `MsgFloatingChatSend.history` and `MsgFloatingChatPersistHistory.history` and `MsgFloatingChatHistoryRestored.history` in types.ts from `ChatMessage[]` to `ChatItem[]`.

- [ ] **Step 3: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; only the 3 pre-existing errors. Fix any `ChatMessage` vs `ChatItem` mismatch the compiler flags at the touched sites.

- [ ] **Step 4: Re-run pure tests (unaffected) + commit**

```bash
npx esbuild src/webview/canvas/chat/chatTimeline.ts --bundle --format=esm --outfile=test/.build/chatTimeline.mjs && node --test test/chat-timeline.mjs
git add src/webview/hooks/useFloatingChat.ts src/extension/editor-provider.ts src/shared/types.ts
git commit -m "feat(chat): ChatItem timeline in hook + host persistence/context mapping"
```

---

### Task 7: Render tool cards, thinking, live meter (`FloatingChat.tsx`)

**Files:**
- Modify: `src/webview/canvas/FloatingChat.tsx`

- [ ] **Step 1: Consume the new subscriptions + usage**

In the FloatingChat body where the other `onDelta`/`onDone` effects live (~line 242), add:

```ts
  useEffect(() => onToolEvent?.(chat.applyTool), [onToolEvent, chat.applyTool]);
  useEffect(() => onUsage?.(chat.applyUsage),    [onUsage, chat.applyUsage]);
```

(`chat.applyTool`/`chat.applyUsage`/`chat.usage` come from Task 6's hook return.)

- [ ] **Step 2: Render `ChatItem[]` (replace the history map ~line 699)**

```tsx
            {chat.history.map((it, i) =>
              it.kind === 'text'     ? <ChatBubble key={i} msg={{ role: it.role, content: it.content, timestamp: it.timestamp }} />
            : it.kind === 'thinking' ? <ThinkingBlock key={i} content={it.content} />
            :                          <ToolCard key={i} item={it} />
            )}
```

- [ ] **Step 3: Add `ToolCard` + `ThinkingBlock` components** (near `ChatBubble`, ~line 753)

```tsx
function ToolCard({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }): JSX.Element | null {
  const v = toolCardView(item.name, item.input);
  const [open, setOpen] = React.useState(false);
  if (v.hidden) return null;
  const glyph = item.status === 'running' ? '⏳' : item.status === 'ok' ? '✓' : '✗';
  const color = item.status === 'error' ? '#F87171' : 'var(--vscode-foreground)';
  return (
    <div style={{ margin: '3px 8px', padding: '4px 8px', borderRadius: 4, background: 'var(--vscode-editorWidget-background)', border: '1px solid var(--vscode-panel-border, #333)', fontSize: 11 }}>
      <div style={{ display: 'flex', gap: 6, cursor: 'pointer', color }} onClick={() => setOpen(o => !o)}>
        <span>{glyph}</span><span style={{ fontWeight: 600 }}>{v.title}</span>
      </div>
      {v.kind === 'todo' && v.todos && (
        <div style={{ marginTop: 3, opacity: 0.85 }}>
          {v.todos.map((t, j) => <div key={j}>{t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} {t.text}</div>)}
        </div>
      )}
      {open && v.kind !== 'todo' && (
        <pre style={{ marginTop: 3, whiteSpace: 'pre-wrap', opacity: 0.7, fontSize: 10 }}>{JSON.stringify(item.input, null, 1)}</pre>
      )}
      {v.showResult && item.resultPreview && (
        <div style={{ marginTop: 3, opacity: 0.7, whiteSpace: 'pre-wrap', fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: 10 }}>{item.resultPreview}</div>
      )}
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ margin: '3px 8px', fontSize: 11, opacity: 0.55 }}>
      <div style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>💭 thinking{open ? ' ▾' : ' ▸'}</div>
      {open && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10, marginTop: 2 }}>{content}</pre>}
    </div>
  );
}
```

Add imports at the top: `import { toolCardView } from './chat/toolCardView';` and ensure `ChatItem` is imported from `../../shared/types` (replace the `ChatMessage` import if now unused — keep `ChatMessage` only if `ChatBubble` still references it; `ChatBubble` now takes an inline `{role,content,timestamp}` so you can drop the `ChatMessage` type usage there).

- [ ] **Step 4: Live token/cost meter in the header**

Find the title-bar area (~line 559-599, where Reset/Compact buttons render) and add a compact readout when `chat.usage` is set:

```tsx
        {chat.usage && (
          <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 8 }}>
            {chat.usage.inputTokens + chat.usage.cacheReadTokens}▸{chat.usage.outputTokens} tok
          </span>
        )}
```

(Place it inside the header row container; match the existing button styling context.)

- [ ] **Step 5: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; only the 3 pre-existing errors.

- [ ] **Step 6: Commit**

```bash
git add src/webview/canvas/FloatingChat.tsx
git commit -m "feat(chat): render tool cards, thinking blocks, live token meter"
```

---

### Task 8: Manual smoke + release chores

**Files:**
- Modify: `README.md`, `package.json`

- [ ] **Step 1: Manual smoke (Extension Development Host / installed VSIX, harness provider)**

Ask the companion to do a multi-tool task, e.g. *"read package.json, tell me the version, then add a text node saying hi"*:
1. Tool cards appear in order (Read hidden, canvas/add-node card visible) with ⏳→✓ transitions. ✓
2. Thinking block shows (💭, expandable) if the model emits thinking. ✓
3. Token meter ticks during the turn; final cost still shows on Done. ✓
4. Text before/after a tool call renders as separate bubbles in correct order (interleave). ✓
5. Reopen the canvas → the full timeline (text + cards + thinking) restores from workspaceState. ✓
6. A canvas whose stored history predates this change (legacy `ChatMessage[]`) still loads (migrated to text items). ✓
7. Abort mid-tool (Reset/stop) → running card flips to ✗, not stuck spinning. ✓

- [ ] **Step 2: README** — under the AI companion section, add a bullet:

```markdown
- **Live tool feedback** — watch Claude Code work: tool calls (edits, shell, canvas ops) stream in as cards with running→done status, thinking blocks, and a live token/cost meter. The full timeline is saved with the canvas.
```

- [ ] **Step 3: Version bump + package**

Bump `package.json` `version` minor (0.5.0 → 0.6.0), then:

```bash
npm run package 2>&1 | tail -3
```
Expected: `skena-0.6.0.vsix` builds clean.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "chore(release): v0.6.0 — live CC tool feedback in chat"
```

- [ ] **Step 5: Update crtx wiki**

Append to `~/projects/crtx/log.md` + `~/projects/crtx/projects/skena.md`: live CC feedback built per spec; key decisions (ChatItem model replacing ChatMessage w/ migration, display-only onToolEvent/onUsage channel separate from onToolUse, curation in view layer, persisted to workspaceState); note the pure modules `toolCardView`/`chatTimeline` + their gitignored tests. Commit the wiki.

---

## Self-review (done at plan time)

- **Spec coverage**: §1 ChatItem → Task 1; §2 callbacks → Task 1/2; §3 harness parsing (tool_use/thinking/usage/tool_result by id) → Task 2; §4 protocol+wiring → Tasks 1/2/3; §5 persistence+migration (workspaceState, not file — corrected) → Tasks 5/6; §6 timeline interleave/flush + render → Tasks 5/6/7; §7 curation → Task 4/7; live cost meter → Task 6/7; error handling (drop malformed, ignore unmatched result, mark running→error on finish) → Tasks 2/5/6; tests → Tasks 4/5; manual smoke → Task 8.
- **Type consistency**: `ChatItem`/`ChatToolEvent`/`ChatTokenUsage` defined once (Task 1) and used identically in harness (2), App (3), reducer (5), hook (6), render (7). `applyToolEvent`/`flushPendingText`/`migrateHistory` signatures match between Task 5 definition and Task 6 usage. `toolCardView`/`ToolCardView` match between Task 4 and Task 7.
- **Compiles incrementally**: Tasks 1-5 are additive (ChatMessage untouched); the `ChatMessage→ChatItem` swap is contained to Task 6 (hook + host + the three msg history fields) with Task 7 consuming the new render props. Task 3 adds the no-op FloatingChat props so it stays green before Task 7.
- **No placeholders**: every code step has complete code; tests inline fixtures (test/ gitignored).
- **Delegated-to-implementer** (flagged inline): exact indentation of the two editor-provider callback blocks; the real variable name/shape at the `priorHistory` map site (~line 971); the header-row container for the meter.
