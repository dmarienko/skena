# Chat Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-09-27-chat-console-redesign-design.md` (`5241fa3`). Replace the floating chat panel with a console docked at the bottom centre: a see-through conversation panel of foldable turns on top, and an always-visible input bar under it with `+` attachments, the model and effort picker, and send/Stop.

**Architecture:** Pure modules hold every rule and are tested in node: console sizes (`consoleLayout.ts`), turns from the timeline (`chatTurns.ts`), which turns are open (`turnFold.ts`), attachment chips and the attachment text (`shared/chatAttachments.ts`), the saved-state upgrade (`shared/chatUIState.ts`), the effort flag (`shared/aiEffort.ts`) and the image message content (`llm-adapters/userContent.ts`). `FloatingChat.tsx` becomes the docked layout and composes `ConversationPanel`, `TurnList`, `InputBar`, `AttachMenu` and `ChatInput`. The host builds the attachment text with the same rule it uses for the focused node, sends images to the `claude` CLI as image blocks, and adds a second QuickPick step for effort.

**Tech Stack:** TypeScript, React 18, Monaco + monaco-vim, react-markdown + KaTeX, VS Code extension API, the `claude` CLI in `--input-format stream-json` mode, esbuild bundles + `node --test` (each test file's line 1 holds its run command).

---

## Before you start

- Work on branch `feature/spatial-notebook`. Commit only the files each task names. Never use `git stash`.
- `.vscode/numbered-bookmarks.json` is untracked and not yours. `npm run build` rewrites `.vscode/skena-mcp.js`; leave it unstaged.
- Never read a `.canvas` file directly.
- Typecheck baseline at `5241fa3`: `npx tsc --noEmit` reports 3 errors, all `TS2339: Property 'fsPath' does not exist on type 'ResolvedUri'` in `src/extension/editor-provider.ts` (the `copyAbsolutePath` handler). They are old. Every typecheck step in this plan runs:

  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"
  ```

  Expected output: nothing.
- Build: `npm run build`. Expected: three `⚡ Done` lines (`dist/mcp-server.js`, `dist/extension.js`, `dist/webview.js` + `dist/webview.css`) and no `[ERROR]` line. The size warnings (⚠️) are old.
- `tests/.build/` is git-ignored. Commit only `tests/*.mjs`.
- The code in this plan was applied task by task to a scratch copy of the repo at `5241fa3` on 2026-09-27: the typecheck command above printed nothing after every task, `npm run build` finished, and all ten test files in Task 18 Step 10 passed with the counts given there. Nothing was run in VS Code; Task 19 is the first run.

## The spec's two open points, settled

**Images: the CLI's stream-json input takes image blocks. FACT.**
- Agent SDK docs, "Streaming Input" (`https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode`): streaming input mode lists "Image uploads: attach images directly to messages". Its example sends `{ type: 'user', message: { role: 'user', content: [ { type: 'text', … }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data } } ] } }`. Single message mode "does not support direct image attachments".
- SDK source, `@anthropic-ai/claude-agent-sdk@0.3.283` (`npm pack`, read in the scratchpad): it spawns the CLI with `--output-format stream-json --verbose --input-format stream-json` and `streamInput` writes each user message to the CLI's stdin as one JSON line. Its `SDKUserMessage.message` doc: "content is a string or an array of content blocks (text, image, document, tool_result, ...)".
- `harness.ts` `beginTurn` writes the same `{ type: 'user', message: { role: 'user', content } }` line today, with a string `content`.
- Not run: no prompt was sent to the CLI. Installed CLI 2.1.282; the SDK bundles 2.1.283. INFERENCE: 2.1.282 takes the same message. Task 19 checks it.
- Limits (`https://platform.claude.com/docs/en/build-with-claude/vision`): PNG, JPEG, GIF, WebP; 10 MB base64 per image on the API, 5 MB on Bedrock and Google Cloud. The plan caps at 5 MB.
- A different unknown, INFERENCE: getting the image off the clipboard inside the webview. `vscode.env.clipboard` is text only. The canvas gets pasted images only from a DOM `paste` event (`CanvasView.tsx`, the `onPaste` effect). The `+` menu entry focuses a hidden textarea inside the console, tries `document.execCommand('paste')`, and if no paste event arrives within 150 ms it asks for Ctrl+V. Task 19 item 13 checks both paths. The entry shows only for the `harness` provider; the other adapters send text only.

**Attachments: nodes and files follow the focused node's rule.**
- `context-builder.ts` `nodeContent` inlines text, cell and knowledge node bodies. For file nodes it gives the harness a path (`fileNodeMode: 'path'`, the agent has Read) and inlines the file text for the other providers (`'content'`).
- Attached nodes use `nodeContent` with the same mode, capped at 3,000 characters (the focused node's cap). An attached workspace file is a path for the harness, and its text (12,000 characters max, not inlined when binary or over 2 MB) for the other providers.
- All attachments go under one heading, `ATTACHED BY THE USER (n):`, between the canvas snapshot and the message, 30,000 characters in total.
- Trade-offs: inlining costs input tokens on every send and is cut at the cap, but the agent sees the text without a tool call and it works for providers with no file tools. Paths cost nothing up front but need a Read call and work only for the harness.

**Effort: FACT.** `claude --help` (2.1.282): `--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)`. Skena passes no effort today.

## Decisions for the user

1. **Effort in the picker is new.** The spec says "model and effort picker"; skena has no effort setting. The plan adds a second QuickPick step (harness only), saved as `metadata.aiEffort` in the `.canvas` file and passed as `--effort`. To leave it out, skip Task 6's harness edit and Task 9's effort step.
2. **Attachment caps:** node 3,000 characters, file 12,000, all attachments 30,000, files over 2 MB not inlined.
3. **Placement the spec leaves open:** Compact (⤵), Reset (⟲) and the live token count go in the conversation header, left of the fold arrow. The session name goes in the model button's tooltip. The per-turn cost (`Δ … · Σ …`) goes after the turn's two actions.
4. **Tool steps are one line; their result preview shows on click.** Today Bash/Edit/canvas cards always show the preview under the card.
5. **"The answer" for copy and add-to-canvas is the turn's last reply**, not the narration written between tool calls.
6. **A canvas with nothing saved opens with the conversation open.** Today the host forces the chat collapsed on every open; the spec says folded or open is saved per canvas.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/webview/canvas/chat/consoleLayout.ts` | create | Pure. Input height from line count (1 to 8 lines of 20 px), console width limits, width from an edge drag. |
| `src/webview/canvas/chat/chatTurns.ts` | create | Pure. Timeline → turns; a turn's answer, cost, first line and clock time. |
| `src/webview/canvas/chat/turnFold.ts` | create | Pure. Which turns are open; a new prompt folds the others. |
| `src/shared/chatAttachments.ts` | create | Pure. The attachment type, chip keys and labels, merge/remove, image data URL parsing, the binary check, the attachment text. |
| `src/shared/chatUIState.ts` | create | Pure. Saved console state `{ width, folded }` and the upgrade from `{ collapsed, pos, size, inputW }`. |
| `src/shared/aiEffort.ts` | create | Pure. Effort levels and the `--effort` arguments. |
| `src/extension/llm-adapters/userContent.ts` | create | Pure. One stream-json user message content: a string, or image blocks then text. |
| `src/extension/chat-attachments.ts` | create | Host. Attachment → text block, using `nodeContent` and the file system. |
| `src/webview/canvas/chat/chatClipboard.ts` | create | The vim clipboard relay, moved out of `FloatingChat.tsx` unchanged. |
| `src/webview/styles/chat-console.css` | create | Every console style, with the mock's colours as CSS variables. |
| `src/webview/canvas/chat/TurnList.tsx` | create | The turns: folded lines, open turns, tool and thinking steps, the rendered answer, the two actions. |
| `src/webview/canvas/chat/AttachMenu.tsx` | create | The `+` menu: picked nodes, a workspace file, a clipboard image. |
| `src/webview/canvas/chat/ChatInput.tsx` | create | Monaco + vim input: height by line count, Ctrl+Enter, Alt+I, Alt+L, Shift+H/J/K/L, clipboard relay, focus return. |
| `src/webview/canvas/chat/InputBar.tsx` | create | The input bar: `+`, chips, `ChatInput`, spinner, model button, send/Stop. |
| `src/webview/canvas/chat/ConversationPanel.tsx` | create | The panel: header line, scroll box, pin-to-latest, finer wheel step, notices. |
| `src/webview/canvas/FloatingChat.tsx` | rewrite | The docked layout: width, side-edge drag, host event wiring. |
| `src/webview/hooks/useFloatingChat.ts` | rewrite | State: width, folded, history, streaming, working, attachments; host messages. |
| `src/shared/types.ts` | modify | New and changed chat messages; `metadata.aiEffort`. |
| `src/extension/editor-provider.ts` | modify | Attachments in the prompt, file picker, add-note, effort step, saved state. |
| `src/extension/llm-adapters/harness.ts` | modify | `--effort`; content blocks in the user message. |
| `src/extension/llm-client.ts` | modify | `LLMContext.images`, `LLMContext.effort`. |
| `src/webview/canvas/CanvasView.tsx` | modify | `window.__skenaGetPicked`: the nodes picked with Space. |
| `src/webview/App.tsx` | modify | New restore payload, files-picked event, effort. |
| `src/webview/index.tsx` | modify | Import `chat-console.css`. |
| `src/webview/canvas/palette.ts` | modify | Delete the four `CHAT_*_RGB` constants (no longer used). |
| `tests/console-layout.mjs`, `tests/chat-turns.mjs`, `tests/turn-fold.mjs`, `tests/chat-attachments.mjs`, `tests/chat-ui-state.mjs`, `tests/ai-effort.mjs`, `tests/user-content.mjs`, `tests/chat-attachments-host.mjs` | create | One file per helper. |

---

### Task 1: Console sizes

**Files:**
- Create: `src/webview/canvas/chat/consoleLayout.ts`
- Test: `tests/console-layout.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/console-layout.mjs`:

```js
// - run: npx esbuild src/webview/canvas/chat/consoleLayout.ts --bundle --format=esm --outfile=tests/.build/consoleLayout.mjs && node --test tests/console-layout.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { INPUT_LINE_H, INPUT_MAX_LINES, MIN_CONSOLE_W, clampConsoleWidth, dragWidth, inputHeight } from './.build/consoleLayout.mjs';

test('the input starts one line high', () => {
  assert.equal(inputHeight(0), INPUT_LINE_H);
  assert.equal(inputHeight(1), 20);
});

test('the input grows one line at a time', () => {
  assert.equal(inputHeight(3), 60);
});

test('the input stops at 8 lines (160 px)', () => {
  assert.equal(INPUT_MAX_LINES, 8);
  assert.equal(inputHeight(8), 160);
  assert.equal(inputHeight(30), 160);
});

test('a fractional line count from Monaco rounds to the nearest line', () => {
  assert.equal(inputHeight(2.02), 40);
});

test('the width stays between the minimum and the window less the side gutters', () => {
  assert.equal(clampConsoleWidth(1000, 1920), 1000);
  assert.equal(clampConsoleWidth(100, 1920), MIN_CONSOLE_W);
  assert.equal(clampConsoleWidth(5000, 1920), 1888);
});

test('a window narrower than the minimum gets its own width less the gutters', () => {
  assert.equal(clampConsoleWidth(760, 400), 368);
});

test('dragging an edge outward widens by twice the distance, since the console stays centred', () => {
  assert.equal(dragWidth(760, 50, 'right'), 860);
  assert.equal(dragWidth(760, -50, 'left'), 860);
  assert.equal(dragWidth(760, 50, 'left'), 660);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/webview/canvas/chat/consoleLayout.ts --bundle --format=esm --outfile=tests/.build/consoleLayout.mjs && node --test tests/console-layout.mjs`
Expected: esbuild stops with `Could not resolve "src/webview/canvas/chat/consoleLayout.ts"`; node does not run.

- [ ] **Step 3: Write the module**

Create `src/webview/canvas/chat/consoleLayout.ts`:

```ts
// - pure sizes for the docked chat console; no DOM
export const INPUT_LINE_H          = 20;
export const INPUT_MAX_LINES       = 8;
export const DEFAULT_CONSOLE_WIDTH = 760;
export const MIN_CONSOLE_W         = 420;
// - free space kept between the console and each side of the window
export const SIDE_GUTTER           = 16;

export function inputHeight(lines: number): number {
  const n = Math.min(INPUT_MAX_LINES, Math.max(1, Math.round(lines)));
  return n * INPUT_LINE_H;
}

export function clampConsoleWidth(width: number, viewportW: number): number {
  const max = Math.max(0, viewportW - 2 * SIDE_GUTTER);
  return Math.round(Math.min(max, Math.max(MIN_CONSOLE_W, width)));
}

// - the console is centred, so moving one edge by dx moves the other edge by dx as well
export function dragWidth(startW: number, dx: number, edge: 'left' | 'right'): number {
  return startW + (edge === 'right' ? 2 * dx : -2 * dx);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/webview/canvas/chat/consoleLayout.ts --bundle --format=esm --outfile=tests/.build/consoleLayout.mjs && node --test tests/console-layout.mjs`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/chat/consoleLayout.ts tests/console-layout.mjs
git commit -m "feat(chat): console sizes — input height by line count, width limits, edge drag"
```

---

### Task 2: Turns from the timeline

**Files:**
- Create: `src/webview/canvas/chat/chatTurns.ts`
- Test: `tests/chat-turns.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/chat-turns.mjs`:

```js
// - run: npx esbuild src/webview/canvas/chat/chatTurns.ts --bundle --format=esm --outfile=tests/.build/chatTurns.mjs && node --test tests/chat-turns.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { clockTime, firstLine, groupTurns, turnAnswer, turnCost } from './.build/chatTurns.mjs';

const at    = (h, m) => new Date(2026, 8, 27, h, m).toISOString();
const user  = (content, ts = at(14, 0)) => ({ kind: 'text', role: 'user', content, timestamp: ts });
const reply = (content, extra = {}) => ({ kind: 'text', role: 'assistant', content, timestamp: at(14, 1), ...extra });
const tool  = id => ({ kind: 'tool', id, name: 'Bash', input: {}, status: 'ok', timestamp: at(14, 1) });

test('each prompt starts a turn; its replies and steps follow it', () => {
  const turns = groupTurns([user('a'), tool('t1'), reply('x'), user('b', at(15, 30)), reply('y')]);
  assert.deepEqual(turns.map(t => t.key), ['turn-0', 'turn-3']);
  assert.deepEqual(turns.map(t => t.prompt), ['a', 'b']);
  assert.deepEqual(turns.map(t => t.items.length), [2, 1]);
  assert.equal(turns[1].time, at(15, 30));
});

test('an empty history has no turns', () => {
  assert.deepEqual(groupTurns([]), []);
});

test('items logged before the first prompt form a turn with no prompt', () => {
  const turns = groupTurns([reply('note'), user('a')]);
  assert.equal(turns[0].prompt, null);
  assert.equal(turns[0].items.length, 1);
  assert.equal(turns[1].key, 'turn-1');
});

test('earlier turn keys stay the same when the history grows', () => {
  const h = [user('a'), reply('x')];
  const before = groupTurns(h).map(t => t.key);
  const after  = groupTurns([...h, user('b'), reply('y')]).map(t => t.key);
  assert.deepEqual(after.slice(0, 1), before);
});

test('the answer is the last reply of the turn, not the narration before a tool call', () => {
  const [t] = groupTurns([user('a'), reply('Let me read N8.'), tool('t1'), reply('Added N17 under N8.')]);
  assert.equal(turnAnswer(t), 'Added N17 under N8.');
});

test('a node-added notice after the reply is not the answer', () => {
  const [t] = groupTurns([user('a'), reply('Done.'), reply('📌 *Added to canvas:*\n\nnote')]);
  assert.equal(turnAnswer(t), 'Done.');
});

test('a turn with no reply has an empty answer', () => {
  const [t] = groupTurns([user('a'), tool('t1')]);
  assert.equal(turnAnswer(t), '');
});

test('the turn cost comes from the last reply that carries one', () => {
  const [t] = groupTurns([user('a'), reply('x', { deltaUsd: 0.02, costUsd: 0.4 })]);
  assert.deepEqual(turnCost(t), { deltaUsd: 0.02, costUsd: 0.4 });
  assert.equal(turnCost(groupTurns([user('b'), reply('y')])[0]), null);
});

test('firstLine keeps the first non-empty line', () => {
  assert.equal(firstLine('  refactor E7\n1. move it'), 'refactor E7');
  assert.equal(firstLine('\n\nhello'), 'hello');
  assert.equal(firstLine(''), '');
});

test('clockTime shows local hours and minutes', () => {
  assert.equal(clockTime(at(14, 5)), '14:05');
  assert.equal(clockTime('not a date'), '');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/webview/canvas/chat/chatTurns.ts --bundle --format=esm --outfile=tests/.build/chatTurns.mjs && node --test tests/chat-turns.mjs`
Expected: esbuild stops with `Could not resolve "src/webview/canvas/chat/chatTurns.ts"`.

- [ ] **Step 3: Write the module**

Create `src/webview/canvas/chat/chatTurns.ts`:

```ts
// - pure grouping of the chat timeline into turns; no DOM
import { ChatItem } from '../../../shared/types';

export interface ChatTurn {
  // - `turn-<index of its first item>`; history only grows at the end, so a key never changes
  key:    string;
  // - null for items logged before the first prompt
  prompt: string | null;
  time:   string;
  items:  ChatItem[];
}

export const NODE_ADDED_PREFIX = '📌 *Added to canvas:*';

export function groupTurns(history: ChatItem[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  history.forEach((it, i) => {
    if (it.kind === 'text' && it.role === 'user') {
      turns.push({ key: `turn-${i}`, prompt: it.content, time: it.timestamp, items: [] });
      return;
    }
    if (turns.length === 0) turns.push({ key: `turn-${i}`, prompt: null, time: it.timestamp, items: [] });
    turns[turns.length - 1].items.push(it);
  });
  return turns;
}

export function turnAnswer(turn: ChatTurn): string {
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i];
    if (it.kind === 'text' && it.role === 'assistant' && !it.content.startsWith(NODE_ADDED_PREFIX)) return it.content;
  }
  return '';
}

export function turnCost(turn: ChatTurn): { deltaUsd: number; costUsd?: number } | null {
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i];
    if (it.kind === 'text' && it.deltaUsd !== undefined) return { deltaUsd: it.deltaUsd, costUsd: it.costUsd };
  }
  return null;
}

export function firstLine(text: string): string {
  return text.trim().split('\n')[0].trim();
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/webview/canvas/chat/chatTurns.ts --bundle --format=esm --outfile=tests/.build/chatTurns.mjs && node --test tests/chat-turns.mjs`
Expected: `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/chat/chatTurns.ts tests/chat-turns.mjs
git commit -m "feat(chat): group the timeline into turns; a turn's answer, cost and time"
```

---

### Task 3: Which turns are open

**Files:**
- Create: `src/webview/canvas/chat/turnFold.ts`
- Test: `tests/turn-fold.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/turn-fold.mjs`:

```js
// - run: npx esbuild src/webview/canvas/chat/turnFold.ts --bundle --format=esm --outfile=tests/.build/turnFold.mjs && node --test tests/turn-fold.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isTurnOpen, nextToggled, toggleTurn } from './.build/turnFold.mjs';

const none = new Set();

test('the latest turn is open and earlier turns are folded', () => {
  assert.equal(isTurnOpen(none, 'turn-3', 'turn-3'), true);
  assert.equal(isTurnOpen(none, 'turn-0', 'turn-3'), false);
});

test('a click opens an earlier turn and a second click folds it', () => {
  const once = toggleTurn(none, 'turn-0');
  assert.equal(isTurnOpen(once, 'turn-0', 'turn-3'), true);
  assert.equal(isTurnOpen(toggleTurn(once, 'turn-0'), 'turn-0', 'turn-3'), false);
});

test('a click on the latest turn folds it', () => {
  assert.equal(isTurnOpen(toggleTurn(none, 'turn-3'), 'turn-3', 'turn-3'), false);
});

test('a new prompt folds the previous turn and every opened earlier turn', () => {
  const opened = toggleTurn(none, 'turn-0');
  const after  = nextToggled(opened, 'turn-3', 'turn-5');
  assert.equal(isTurnOpen(after, 'turn-3', 'turn-5'), false);
  assert.equal(isTurnOpen(after, 'turn-0', 'turn-5'), false);
  assert.equal(isTurnOpen(after, 'turn-5', 'turn-5'), true);
});

test('the same latest turn keeps what the user opened', () => {
  const opened = toggleTurn(none, 'turn-0');
  assert.equal(nextToggled(opened, 'turn-3', 'turn-3'), opened);
});

test('toggleTurn leaves its input set unchanged', () => {
  const s = new Set(['turn-0']);
  toggleTurn(s, 'turn-0');
  assert.equal(s.has('turn-0'), true);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/webview/canvas/chat/turnFold.ts --bundle --format=esm --outfile=tests/.build/turnFold.mjs && node --test tests/turn-fold.mjs`
Expected: esbuild stops with `Could not resolve "src/webview/canvas/chat/turnFold.ts"`.

- [ ] **Step 3: Write the module**

Create `src/webview/canvas/chat/turnFold.ts`:

```ts
// - `toggled` holds the turns the user clicked: an earlier turn in it is open, the latest turn in it is folded
export function isTurnOpen(toggled: ReadonlySet<string>, key: string, latestKey: string | null): boolean {
  return key === latestKey ? !toggled.has(key) : toggled.has(key);
}

export function toggleTurn(toggled: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(toggled);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// - a new latest turn (a new prompt, or a cleared history) folds every earlier turn again
export function nextToggled(toggled: ReadonlySet<string>, prevLatest: string | null, nextLatest: string | null): ReadonlySet<string> {
  return prevLatest === nextLatest ? toggled : new Set<string>();
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/webview/canvas/chat/turnFold.ts --bundle --format=esm --outfile=tests/.build/turnFold.mjs && node --test tests/turn-fold.mjs`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/chat/turnFold.ts tests/turn-fold.mjs
git commit -m "feat(chat): turn fold state — latest open, earlier folded, a new prompt folds the rest"
```

---

### Task 4: Attachments — chips and the attachment text

**Files:**
- Create: `src/shared/chatAttachments.ts`
- Test: `tests/chat-attachments.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/chat-attachments.mjs`:

```js
// - run: npx esbuild src/shared/chatAttachments.ts --bundle --format=esm --outfile=tests/.build/chatAttachments.mjs && node --test tests/chat-attachments.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  attachmentKey, chipLabel, formatAttachments, looksBinary, mergeAttachments, parseImageDataUrl, removeAttachment,
} from './.build/chatAttachments.mjs';

const node = { kind: 'node', id: 'n1', label: 'N8' };
const file = { kind: 'file', path: '/w/a.py', name: 'a.py' };
const img  = { kind: 'image', id: 'img-1', name: 'image 1', mediaType: 'image/png', data: 'AAAA' };

test('keys tell kinds and items apart', () => {
  assert.deepEqual([node, file, img].map(attachmentKey), ['node:n1', 'file:/w/a.py', 'image:img-1']);
});

test('a chip shows the node label, or the file or image name', () => {
  assert.deepEqual([node, file, img].map(chipLabel), ['N8', 'a.py', 'image 1']);
});

test('attaching the same node twice keeps one chip, in first-seen order', () => {
  assert.deepEqual(mergeAttachments([node], [file, node]), [node, file]);
});

test('removing by key drops only that attachment', () => {
  assert.deepEqual(removeAttachment([node, file], 'node:n1'), [file]);
});

test('a PNG data URL splits into media type and base64 data', () => {
  assert.deepEqual(parseImageDataUrl('data:image/png;base64,iVBOR'), { mediaType: 'image/png', data: 'iVBOR' });
});

test('an unsupported type or a non-base64 data URL is rejected', () => {
  assert.equal(parseImageDataUrl('data:image/bmp;base64,Qk0'), null);
  assert.equal(parseImageDataUrl('data:text/plain,hello'), null);
});

test('text with a NUL character is treated as binary', () => {
  assert.equal(looksBinary('print(1)\n'), false);
  assert.equal(looksBinary('PK\u0003\u0004\u0000'), true);
});

test('no attachments give no text', () => {
  assert.equal(formatAttachments([]), '');
});

test('blocks are listed under one heading with their count', () => {
  const out = formatAttachments([
    { heading: '[N8] (text) lookup', body: 'falls back to exchange' },
    { heading: 'file /w/a.py', body: '[file on disk — read it yourself if needed: /w/a.py]' },
  ]);
  assert.equal(out, 'ATTACHED BY THE USER (2):\n### [N8] (text) lookup\nfalls back to exchange\n\n### file /w/a.py\n[file on disk — read it yourself if needed: /w/a.py]');
});

test('a block that would pass the cap is left out with a note; a smaller later block still fits', () => {
  const out = formatAttachments([
    { heading: 'A', body: 'x'.repeat(8) },
    { heading: 'B', body: 'y'.repeat(5) },
    { heading: 'C', body: 'z'.repeat(2) },
  ], 10);
  assert.equal(out, 'ATTACHED BY THE USER (3):\n### A\nxxxxxxxx\n\n### B\n[left out: attachments are capped at 10 characters]\n\n### C\nzz');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/shared/chatAttachments.ts --bundle --format=esm --outfile=tests/.build/chatAttachments.mjs && node --test tests/chat-attachments.mjs`
Expected: esbuild stops with `Could not resolve "src/shared/chatAttachments.ts"`.

- [ ] **Step 3: Write the module**

Create `src/shared/chatAttachments.ts`:

```ts
// - what the user attached to a chat message, and the text the agent reads for it; no DOM, no fs
export type ChatAttachment =
  | { kind: 'node';  id: string; label: string }
  | { kind: 'file';  path: string; name: string }
  | { kind: 'image'; id: string; name: string; mediaType: string; data: string };

export interface AttachmentBlock { heading: string; body: string }

export const MAX_ATTACHMENT_CHARS = 30000;
// - base64 length; Bedrock and Google Cloud reject a larger image
export const MAX_IMAGE_BASE64     = 5 * 1024 * 1024;
export const IMAGE_MEDIA_TYPES    = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function attachmentKey(a: ChatAttachment): string {
  switch (a.kind) {
    case 'node':  return `node:${a.id}`;
    case 'file':  return `file:${a.path}`;
    case 'image': return `image:${a.id}`;
  }
}

export function chipLabel(a: ChatAttachment): string {
  return a.kind === 'node' ? a.label : a.name;
}

export function mergeAttachments(list: ChatAttachment[], add: ChatAttachment[]): ChatAttachment[] {
  const seen = new Set(list.map(attachmentKey));
  const out  = [...list];
  for (const a of add) {
    const k = attachmentKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function removeAttachment(list: ChatAttachment[], key: string): ChatAttachment[] {
  return list.filter(a => attachmentKey(a) !== key);
}

export function parseImageDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m || !IMAGE_MEDIA_TYPES.includes(m[1])) return null;
  return { mediaType: m[1], data: m[2] };
}

// - a NUL character in text decoded as UTF-8 means the file is not text
export function looksBinary(text: string): boolean {
  return text.includes('\u0000');
}

export function formatAttachments(blocks: AttachmentBlock[], cap: number = MAX_ATTACHMENT_CHARS): string {
  if (blocks.length === 0) return '';
  let left = cap;
  const parts = blocks.map(b => {
    if (b.body.length > left) return `### ${b.heading}\n[left out: attachments are capped at ${cap} characters]`;
    left -= b.body.length;
    return `### ${b.heading}\n${b.body}`;
  });
  return `ATTACHED BY THE USER (${blocks.length}):\n${parts.join('\n\n')}`;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/shared/chatAttachments.ts --bundle --format=esm --outfile=tests/.build/chatAttachments.mjs && node --test tests/chat-attachments.mjs`
Expected: `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/chatAttachments.ts tests/chat-attachments.mjs
git commit -m "feat(chat): attachment chips and the attachment text for the agent"
```

---

### Task 5: Saved console state and its upgrade

**Files:**
- Create: `src/shared/chatUIState.ts`
- Test: `tests/chat-ui-state.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/chat-ui-state.mjs`:

```js
// - run: npx esbuild src/shared/chatUIState.ts --bundle --format=esm --outfile=tests/.build/chatUIState.mjs && node --test tests/chat-ui-state.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { migrateChatUI } from './.build/chatUIState.mjs';

test('nothing saved gives the default width and an open conversation', () => {
  assert.deepEqual(migrateChatUI(undefined), { width: null, folded: false });
});

test('the saved { width, folded } passes through', () => {
  assert.deepEqual(migrateChatUI({ width: 900, folded: true }), { width: 900, folded: true });
});

test('the floating panel\'s { collapsed, pos, size, inputW } becomes width plus folded', () => {
  const old = { collapsed: true, pos: { x: 10, y: 20 }, size: { w: 620, h: 400 }, inputW: 240 };
  assert.deepEqual(migrateChatUI(old), { width: 620, folded: true });
});

test('old saved state without a size keeps the default width', () => {
  assert.deepEqual(migrateChatUI({ collapsed: false, pos: { x: 0, y: 0 } }), { width: null, folded: false });
});

test('a broken width is ignored', () => {
  for (const w of [NaN, -5, '800', null]) assert.equal(migrateChatUI({ width: w, folded: false }).width, null);
});

test('folded wins over collapsed when both are present', () => {
  assert.equal(migrateChatUI({ folded: false, collapsed: true }).folded, false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/shared/chatUIState.ts --bundle --format=esm --outfile=tests/.build/chatUIState.mjs && node --test tests/chat-ui-state.mjs`
Expected: esbuild stops with `Could not resolve "src/shared/chatUIState.ts"`.

- [ ] **Step 3: Write the module**

Create `src/shared/chatUIState.ts`:

```ts
// - the chat console's saved state per canvas
export interface ChatUIState {
  // - null: nothing saved; the console uses its default width
  width:  number | null;
  folded: boolean;
}

function validWidth(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// - reads both { width, folded } and the floating panel's { collapsed, pos, size, inputW }.
// - size.w becomes the width and collapsed becomes folded; pos and inputW have no counterpart.
export function migrateChatUI(saved: unknown): ChatUIState {
  if (!saved || typeof saved !== 'object') return { width: null, folded: false };
  const o    = saved as Record<string, unknown>;
  const size = o.size as Record<string, unknown> | null | undefined;
  const width  = validWidth(o.width) ?? validWidth(size?.w);
  const folded = typeof o.folded === 'boolean' ? o.folded
               : typeof o.collapsed === 'boolean' ? o.collapsed
               : false;
  return { width, folded };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/shared/chatUIState.ts --bundle --format=esm --outfile=tests/.build/chatUIState.mjs && node --test tests/chat-ui-state.mjs`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/chatUIState.ts tests/chat-ui-state.mjs
git commit -m "feat(chat): saved console state { width, folded }, also read from the old panel's saved state"
```

---

### Task 6: Effort levels and the `--effort` flag

**Files:**
- Create: `src/shared/aiEffort.ts`
- Modify: `src/extension/llm-client.ts` (`LLMContext`, around line 37)
- Modify: `src/extension/llm-adapters/harness.ts` (imports; `spawnSession` args, around line 207)
- Test: `tests/ai-effort.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/ai-effort.mjs`:

```js
// - run: npx esbuild src/shared/aiEffort.ts --bundle --format=esm --outfile=tests/.build/aiEffort.mjs && node --test tests/ai-effort.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { effortArgs } from './.build/aiEffort.mjs';

test('a known level becomes the --effort flag', () => {
  assert.deepEqual(effortArgs('high'), ['--effort', 'high']);
  assert.deepEqual(effortArgs('xhigh'), ['--effort', 'xhigh']);
});

test('no level, or an unknown one, adds no flag', () => {
  assert.deepEqual(effortArgs(undefined), []);
  assert.deepEqual(effortArgs(''), []);
  assert.deepEqual(effortArgs('ultra'), []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/shared/aiEffort.ts --bundle --format=esm --outfile=tests/.build/aiEffort.mjs && node --test tests/ai-effort.mjs`
Expected: esbuild stops with `Could not resolve "src/shared/aiEffort.ts"`.

- [ ] **Step 3: Write the module**

Create `src/shared/aiEffort.ts`:

```ts
// - values the claude CLI takes for --effort
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function effortArgs(effort: string | undefined): string[] {
  return effort && (EFFORT_LEVELS as readonly string[]).includes(effort) ? ['--effort', effort] : [];
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/shared/aiEffort.ts --bundle --format=esm --outfile=tests/.build/aiEffort.mjs && node --test tests/ai-effort.mjs`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Add `effort` to `LLMContext`**

In `src/extension/llm-client.ts`, replace:

```ts
  /** - whether to resume the prior session (skena.ai.session.restore) */
  restoreSession?: boolean;
}
```

with:

```ts
  /** - whether to resume the prior session (skena.ai.session.restore) */
  restoreSession?: boolean;
  // - per-canvas effort (canvas.metadata.aiEffort); the harness passes it as --effort
  effort?:       string;
}
```

- [ ] **Step 6: Pass `--effort` when the harness spawns `claude`**

In `src/extension/llm-adapters/harness.ts`, after the line `import { runIpc } from '../run-ipc';` add:

```ts
import { effortArgs } from '../../shared/aiEffort';
```

Replace:

```ts
      '--model', model,
      '--permission-mode', permMode,
```

with:

```ts
      '--model', model,
      ...effortArgs(context?.effort),
      '--permission-mode', permMode,
```

- [ ] **Step 7: Typecheck and build**

Run the typecheck command from "Before you start". Expected: nothing.
Run: `npm run build`. Expected: exit 0, no `[ERROR]`.

- [ ] **Step 8: Commit**

```bash
git add src/shared/aiEffort.ts tests/ai-effort.mjs src/extension/llm-client.ts src/extension/llm-adapters/harness.ts
git commit -m "feat(ai): effort levels; the harness passes --effort when a canvas sets one"
```

---

### Task 7: Images in the harness's user message

**Files:**
- Create: `src/extension/llm-adapters/userContent.ts`
- Modify: `src/extension/llm-client.ts` (imports; `LLMContext`)
- Modify: `src/extension/llm-adapters/harness.ts` (imports, `HarnessSession.pendingMessage`, `chat`, `beginTurn`)
- Test: `tests/user-content.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/user-content.mjs`:

```js
// - run: npx esbuild src/extension/llm-adapters/userContent.ts --bundle --format=esm --outfile=tests/.build/userContent.mjs && node --test tests/user-content.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildUserContent } from './.build/userContent.mjs';

test('text alone stays a plain string, as the harness sends today', () => {
  assert.equal(buildUserContent('hello'), 'hello');
  assert.equal(buildUserContent('hello', []), 'hello');
});

test('images come first as base64 image blocks, then the text', () => {
  const c = buildUserContent('what is this?', [{ mediaType: 'image/png', data: 'iVBOR' }]);
  assert.deepEqual(c, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
    { type: 'text', text: 'what is this?' },
  ]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/extension/llm-adapters/userContent.ts --bundle --format=esm --outfile=tests/.build/userContent.mjs && node --test tests/user-content.mjs`
Expected: esbuild stops with `Could not resolve "src/extension/llm-adapters/userContent.ts"`.

- [ ] **Step 3: Write the module**

Create `src/extension/llm-adapters/userContent.ts`:

```ts
// - the content of one stream-json user message: plain text, or image blocks followed by the text
export interface ImageInput { mediaType: string; data: string }

export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export type UserContent = string | UserContentBlock[];

export function buildUserContent(text: string, images: ImageInput[] = []): UserContent {
  if (images.length === 0) return text;
  return [
    ...images.map((img): UserContentBlock => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text },
  ];
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/extension/llm-adapters/userContent.ts --bundle --format=esm --outfile=tests/.build/userContent.mjs && node --test tests/user-content.mjs`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Add `images` to `LLMContext`**

In `src/extension/llm-client.ts`, after the line `import type { ChatToolEvent, ChatTokenUsage } from '../shared/types';` add:

```ts
import type { ImageInput } from './llm-adapters/userContent';
```

Replace:

```ts
  // - per-canvas effort (canvas.metadata.aiEffort); the harness passes it as --effort
  effort?:       string;
}
```

with:

```ts
  // - per-canvas effort (canvas.metadata.aiEffort); the harness passes it as --effort
  effort?:       string;
  // - images sent with this user message; only the harness sends them
  images?:       ImageInput[];
}
```

- [ ] **Step 6: Send content blocks from the harness**

In `src/extension/llm-adapters/harness.ts`, after `import { effortArgs } from '../../shared/aiEffort';` add:

```ts
import { buildUserContent, type UserContent } from './userContent';
```

Replace:

```ts
  pendingMessage: string;               // - last message (replayed on resume-fail respawn)
```

with:

```ts
  pendingMessage: UserContent;          // - last message (replayed on resume-fail respawn)
```

Replace:

```ts
    s.autoContinues = 0;   // - fresh user message: reset the auto-continue budget
    this.beginTurn(s, message, callbacks);
```

with:

```ts
    s.autoContinues = 0;   // - fresh user message: reset the auto-continue budget
    this.beginTurn(s, buildUserContent(message, context?.images), callbacks);
```

Replace:

```ts
  private beginTurn(s: HarnessSession, message: string, callbacks: LLMCallbacks): void {
```

with:

```ts
  private beginTurn(s: HarnessSession, message: UserContent, callbacks: LLMCallbacks): void {
```

The body of `beginTurn` already writes `{ type: 'user', message: { role: 'user', content: message } }`; with blocks, `content` becomes the array. `'continue'` and `'/compact'` stay strings.

- [ ] **Step 7: Typecheck and build**

Run the typecheck command. Expected: nothing.
Run: `npm run build`. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/extension/llm-adapters/userContent.ts tests/user-content.mjs src/extension/llm-client.ts src/extension/llm-adapters/harness.ts
git commit -m "feat(ai): the harness sends images as base64 image blocks before the text"
```

---

### Task 8: Attachments reach the agent

**Files:**
- Create: `src/extension/chat-attachments.ts`
- Modify: `src/shared/types.ts` (imports; `MsgFloatingChatSend`)
- Modify: `src/extension/editor-provider.ts` (imports; `handleFloatingChatSend`)
- Test: `tests/chat-attachments-host.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/chat-attachments-host.mjs`:

```js
// - run: npx esbuild src/extension/chat-attachments.ts --bundle --platform=node --format=esm --outfile=tests/.build/chatAttachmentsHost.mjs && node --test tests/chat-attachments-host.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachmentBlocks } from './.build/chatAttachmentsHost.mjs';

const dir    = mkdtempSync(join(tmpdir(), 'skena-att-'));
const canvas = {
  nodes: [{ id: 'n1', type: 'text', text: '## Lookup\nfalls back to exchange', nodeLabel: 'N8', x: 0, y: 0, width: 300, height: 100 }],
  edges: [],
};
const pathMode    = { fileNodeMode: 'path' };
const contentMode = { fileNodeMode: 'content' };

test('a picked text node brings its label, type, title and text', async () => {
  const [b] = await attachmentBlocks([{ kind: 'node', id: 'n1', label: 'N8' }], canvas, dir, pathMode, true);
  assert.deepEqual(b, { heading: '[N8] (text) Lookup', body: '## Lookup\nfalls back to exchange' });
});

test('a node deleted after it was picked says so', async () => {
  const [b] = await attachmentBlocks([{ kind: 'node', id: 'gone', label: 'N9' }], canvas, dir, pathMode, true);
  assert.deepEqual(b, { heading: '[N9]', body: '(this node is no longer on the canvas)' });
});

test('a file is a path for the harness', async () => {
  const [b] = await attachmentBlocks([{ kind: 'file', path: '/w/a.py', name: 'a.py' }], canvas, dir, pathMode, true);
  assert.deepEqual(b, { heading: 'file /w/a.py', body: '[file on disk — read it yourself if needed: /w/a.py]' });
});

test('a file is its text for providers without file tools', async () => {
  const p = join(dir, 'a.py');
  writeFileSync(p, 'print(1)\n');
  const [b] = await attachmentBlocks([{ kind: 'file', path: p, name: 'a.py' }], canvas, dir, contentMode, false);
  assert.equal(b.body, 'print(1)\n');
});

test('a binary file is not inlined', async () => {
  const p = join(dir, 'x.bin');
  writeFileSync(p, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
  const [b] = await attachmentBlocks([{ kind: 'file', path: p, name: 'x.bin' }], canvas, dir, contentMode, false);
  assert.equal(b.body, '[binary file, not inlined: x.bin]');
});

test('an image is named in the text and marked as sent or not sent', async () => {
  const img = { kind: 'image', id: 'img-1', name: 'image 1', mediaType: 'image/png', data: 'AA' };
  assert.equal((await attachmentBlocks([img], canvas, dir, pathMode, true))[0].body, '(sent with this message as an image)');
  assert.equal((await attachmentBlocks([img], canvas, dir, contentMode, false))[0].body, '(not sent: this provider takes text only)');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/extension/chat-attachments.ts --bundle --platform=node --format=esm --outfile=tests/.build/chatAttachmentsHost.mjs && node --test tests/chat-attachments-host.mjs`
Expected: esbuild stops with `Could not resolve "src/extension/chat-attachments.ts"`.

- [ ] **Step 3: Write the module**

Create `src/extension/chat-attachments.ts`:

```ts
// - one text block per chat attachment; nodes and files follow the focused node's rule in context-builder
import * as fs from 'fs/promises';
import * as path from 'path';
import { CanvasData } from '../shared/types';
import { AttachmentBlock, ChatAttachment, looksBinary } from '../shared/chatAttachments';
import { nodeContent, nodeTitle, SystemPromptOptions } from './context-builder';

const MAX_NODE_CHARS = 3000;
const MAX_FILE_CHARS = 12000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function fileText(p: string): Promise<string> {
  try {
    const st = await fs.stat(p);
    if (st.size > MAX_FILE_BYTES) return `[file over 2 MB, not inlined: ${path.basename(p)}]`;
    const raw = await fs.readFile(p, 'utf-8');
    if (looksBinary(raw)) return `[binary file, not inlined: ${path.basename(p)}]`;
    return raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) + '\n…[truncated]' : raw;
  } catch {
    return '[file not found]';
  }
}

export async function attachmentBlocks(
  attachments: ChatAttachment[],
  canvas:      CanvasData,
  canvasDir:   string,
  opts:        SystemPromptOptions,
  imagesSent:  boolean,
): Promise<AttachmentBlock[]> {
  return Promise.all(attachments.map(async (a): Promise<AttachmentBlock> => {
    if (a.kind === 'node') {
      const n = canvas.nodes.find(x => x.id === a.id);
      if (!n) return { heading: `[${a.label}]`, body: '(this node is no longer on the canvas)' };
      return {
        heading: `[${n.nodeLabel ?? a.label}] (${n.type}) ${nodeTitle(n)}`,
        body:    await nodeContent(n, canvasDir, MAX_NODE_CHARS, opts),
      };
    }
    if (a.kind === 'file') {
      const body = opts.fileNodeMode === 'path'
        ? `[file on disk — read it yourself if needed: ${a.path}]`
        : await fileText(a.path);
      return { heading: `file ${a.path}`, body };
    }
    return {
      heading: `image ${a.name}`,
      body:    imagesSent ? '(sent with this message as an image)' : '(not sent: this provider takes text only)',
    };
  }));
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx esbuild src/extension/chat-attachments.ts --bundle --platform=node --format=esm --outfile=tests/.build/chatAttachmentsHost.mjs && node --test tests/chat-attachments-host.mjs`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Carry attachments in `floatingChatSend`**

In `src/shared/types.ts`, after the line `import type { RefreshOutcome } from './knowledge/refresh';` add:

```ts
import type { ChatAttachment } from './chatAttachments';
```

Replace:

```ts
  /** - what the user currently sees on screen (viewport awareness) */
  viewport?: ViewportSnapshot;
}

/** - Webview → Host: abort the current streaming request */
```

with:

```ts
  /** - what the user currently sees on screen (viewport awareness) */
  viewport?: ViewportSnapshot;
  // - nodes, files and images attached with the + menu
  attachments?: ChatAttachment[];
}

/** - Webview → Host: abort the current streaming request */
```

- [ ] **Step 6: Put the attachment text into the prompt and pass the images**

In `src/extension/editor-provider.ts`, after the line `import { canvasSessionName } from './llm-adapters/harness';` add:

```ts
import { formatAttachments } from '../shared/chatAttachments';
import { attachmentBlocks } from './chat-attachments';
```

In `handleFloatingChatSend`, replace:

```ts
    let systemPrompt: string;
    let apiHistory: { role: 'user' | 'assistant'; content: string }[];
    try {
      if (provider === 'harness') {
        systemPrompt = buildStaticSystemPrompt(path.basename(document.uri.fsPath, '.canvas'));
        const snapshot = await buildCanvasContext(document.uri.fsPath, document.canvas, msg.activeNodeId, {
          fileNodeMode: 'path', resolveFsPath, viewport: msg.viewport,
        });
        apiHistory = [{ role: 'user', content: `${snapshot}\n\n---\n\n${msg.message}` }];
      } else {
        systemPrompt = await buildSystemPrompt(document.uri.fsPath, document.canvas, msg.activeNodeId, {
          fileNodeMode: 'content', resolveFsPath, viewport: msg.viewport,
        });
        apiHistory = [...priorHistory, { role: 'user', content: msg.message }];
      }
    } catch (e) {
```

with:

```ts
    const attachments = msg.attachments ?? [];
    const harness     = provider === 'harness';
    let systemPrompt: string;
    let apiHistory: { role: 'user' | 'assistant'; content: string }[];
    try {
      const attached = formatAttachments(await attachmentBlocks(attachments, document.canvas, canvasDir, {
        fileNodeMode: harness ? 'path' : 'content', resolveFsPath,
      }, harness));
      if (harness) {
        systemPrompt = buildStaticSystemPrompt(path.basename(document.uri.fsPath, '.canvas'));
        const snapshot = await buildCanvasContext(document.uri.fsPath, document.canvas, msg.activeNodeId, {
          fileNodeMode: 'path', resolveFsPath, viewport: msg.viewport,
        });
        apiHistory = [{ role: 'user', content: [snapshot, attached, `---\n\n${msg.message}`].filter(Boolean).join('\n\n') }];
      } else {
        systemPrompt = await buildSystemPrompt(document.uri.fsPath, document.canvas, msg.activeNodeId, {
          fileNodeMode: 'content', resolveFsPath, viewport: msg.viewport,
        });
        apiHistory = [...priorHistory, { role: 'user', content: attached ? `${attached}\n\n---\n\n${msg.message}` : msg.message }];
      }
    } catch (e) {
```

With no attachments the harness message is `${snapshot}\n\n---\n\n${msg.message}`, the same text as before.

In the same function, replace:

```ts
      model:        document.canvas.metadata?.aiModel,
    });
  }
```

with:

```ts
      model:        document.canvas.metadata?.aiModel,
      images:       harness ? attachments.flatMap(a => (a.kind === 'image' ? [{ mediaType: a.mediaType, data: a.data }] : [])) : [],
    });
  }
```

- [ ] **Step 7: Typecheck and build**

Run the typecheck command. Expected: nothing.
Run: `npm run build`. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/extension/chat-attachments.ts tests/chat-attachments-host.mjs src/shared/types.ts src/extension/editor-provider.ts
git commit -m "feat(chat): attached nodes, files and images reach the agent with the message"
```

---

### Task 9: Host — file picker, add a note, model and effort picker

**Files:**
- Modify: `src/shared/types.ts` (`CanvasData.metadata`, `MsgChatModelInfo`, three new messages, both unions)
- Modify: `src/extension/editor-provider.ts` (imports; the `webviewReady` model send; `pickModel`; two new cases; the settings-change send; a `chatModelInfo` method; `effort` in the chat context)

UI-free host code with no pure logic left to test. Typecheck and build; Task 19 items 11, 12, 17 check it by hand.

- [ ] **Step 1: Types**

In `src/shared/types.ts`, replace:

```ts
    /** - AI model for this canvas's chat; overrides the global skena.ai.model */
    aiModel?: string;
```

with:

```ts
    /** - AI model for this canvas's chat; overrides the global skena.ai.model */
    aiModel?: string;
    // - claude --effort level for this canvas's chat (harness only); unset = the model's default
    aiEffort?: string;
```

Replace:

```ts
export interface MsgChatModelInfo { type: 'chatModelInfo'; model: string; provider: string; sessionName?: string; }
```

with:

```ts
export interface MsgChatModelInfo { type: 'chatModelInfo'; model: string; effort?: string; provider: string; sessionName?: string; }
```

Replace:

```ts
/** Host → Webview: AI added a node to the canvas during tool use */
export interface MsgFloatingChatNodeAdded {
  type: 'floatingChatNodeAdded';
  node: CanvasNode;
  edge?: CanvasEdge;
}
```

with:

```ts
/** Host → Webview: AI added a node to the canvas during tool use */
export interface MsgFloatingChatNodeAdded {
  type: 'floatingChatNodeAdded';
  node: CanvasNode;
  edge?: CanvasEdge;
}

// - webview → host: open VS Code's file picker to attach workspace files to the next chat message
export interface MsgFloatingChatPickFiles { type: 'floatingChatPickFiles'; }

// - host → webview: the files picked for the next chat message
export interface MsgFloatingChatFilesPicked { type: 'floatingChatFilesPicked'; files: { path: string; name: string }[]; }

// - webview → host: add a turn's answer to the canvas as a note connected to the focused node
export interface MsgFloatingChatAddNote { type: 'floatingChatAddNote'; content: string; activeNodeId: string | null; }
```

In the `HostToWebview` union, replace:

```ts
  | MsgFloatingChatToolEvent
  | MsgFloatingChatUsage
```

with:

```ts
  | MsgFloatingChatToolEvent
  | MsgFloatingChatFilesPicked
  | MsgFloatingChatUsage
```

In the `WebviewToHost` union, replace (the two lines together; `| MsgFloatingChatCompact` alone also matches the start of `| MsgFloatingChatCompacting`):

```ts
  | MsgFloatingChatCompact
  | MsgSaveMarks
```

with:

```ts
  | MsgFloatingChatCompact
  | MsgFloatingChatPickFiles
  | MsgFloatingChatAddNote
  | MsgSaveMarks
```

- [ ] **Step 2: Imports in the host**

In `src/extension/editor-provider.ts`, in the `import { … } from '../shared/types';` block, replace:

```ts
  MsgFloatingChatSaveUIState,
```

with:

```ts
  MsgFloatingChatSaveUIState,
  MsgChatModelInfo,
```

After `import { attachmentBlocks } from './chat-attachments';` add:

```ts
import { EFFORT_LEVELS } from '../shared/aiEffort';
```

- [ ] **Step 3: One method builds `chatModelInfo`**

In `src/extension/editor-provider.ts`, replace:

```ts
  /** Handle a floating chat message: build context, call Claude, stream back. */
```

with:

```ts
  // - the model button's text: this canvas's model and effort, else the global model
  private chatModelInfo(document: SkenaDocument): MsgChatModelInfo {
    const aiCfg = vscode.workspace.getConfiguration('skena.ai');
    return {
      type:        'chatModelInfo',
      model:       document.canvas.metadata?.aiModel || aiCfg.get<string>('model') || '',
      effort:      document.canvas.metadata?.aiEffort,
      provider:    aiCfg.get<string>('provider') ?? '',
      sessionName: this.sessionNameFor(document),
    };
  }

  /** Handle a floating chat message: build context, call Claude, stream back. */
```

Replace (in the `webviewReady` case):

```ts
            // - current AI model/provider for the chat title
            const aiCfg0 = vscode.workspace.getConfiguration('skena.ai');
            send({ type: 'chatModelInfo', model: document.canvas.metadata?.aiModel || aiCfg0.get<string>('model') || '', provider: aiCfg0.get<string>('provider') ?? '', sessionName: this.sessionNameFor(document) });
```

with:

```ts
            // - current AI model, effort and provider for the model button
            send(this.chatModelInfo(document));
```

Replace (in the `onDidChangeConfiguration` handler):

```ts
        // - refresh the chat title's model/provider live on settings change
        const aiCfg = vscode.workspace.getConfiguration('skena.ai');
        send({ type: 'chatModelInfo', model: document.canvas.metadata?.aiModel || aiCfg.get<string>('model') || '', provider: aiCfg.get<string>('provider') ?? '', sessionName: this.sessionNameFor(document) });
```

with:

```ts
        // - refresh the model button live on settings change
        send(this.chatModelInfo(document));
```

- [ ] **Step 4: The model picker gets an effort step**

Replace the whole `case 'pickModel': { … }` block (from `case 'pickModel': {` through its `break;\n        }`) with:

```ts
        case 'pickModel': {
          const aiCfg = vscode.workspace.getConfiguration('skena.ai');
          const cur   = document.canvas.metadata?.aiModel || aiCfg.get<string>('model') || '';
          // - aliases the `claude` CLI resolves to the latest of each family (see `claude --help`
          // - `--model`), so this list never rots as new model versions ship. Custom… pins an exact id.
          const MODELS: Array<[string, string]> = [
            ['opus',   'latest Opus'],
            ['sonnet', 'latest Sonnet'],
            ['haiku',  'latest Haiku'],
            ['fable',  'latest Fable'],
            ['opusplan', 'Opus to plan, Sonnet to execute'],
          ];
          const items: vscode.QuickPickItem[] = [
            ...MODELS.map(([m, d]) => ({ label: m, description: m === cur ? `${d} · ● current` : d })),
            { label: 'Custom…', description: 'type an exact model id, e.g. claude-opus-4-5' },
            { label: 'Use global default', description: `skena.ai.model = ${aiCfg.get<string>('model') ?? ''}` },
          ];
          const pick = await vscode.window.showQuickPick(items, { title: 'AI model for this canvas', placeHolder: cur ? `current: ${cur}` : 'select a model' });
          if (!pick) break;
          let chosen: string | undefined = pick.label;
          if (pick.label === 'Custom…') {
            chosen = (await vscode.window.showInputBox({ title: 'Model id', value: cur, prompt: 'e.g. claude-sonnet-4-5' }))?.trim();
            if (!chosen) break;
          } else if (pick.label === 'Use global default') {
            chosen = undefined;   // - clear the per-canvas override
          }
          let effort = document.canvas.metadata?.aiEffort;
          if ((aiCfg.get<string>('provider') ?? '') === 'harness') {
            const effortItems: vscode.QuickPickItem[] = [
              { label: 'default', description: effort ? 'no --effort; the model decides' : 'no --effort; the model decides · ● current' },
              ...EFFORT_LEVELS.map(l => ({ label: l, description: l === effort ? '● current' : '' })),
            ];
            const ep = await vscode.window.showQuickPick(effortItems, { title: 'Effort for this canvas', placeHolder: `current: ${effort ?? 'default'}` });
            // - Esc on this step keeps the current effort; the model choice still applies
            if (ep) effort = ep.label === 'default' ? undefined : ep.label;
          }
          // - persist in the .canvas file (portable), respawn so the new model and effort take effect
          document.canvas.metadata = { ...(document.canvas.metadata ?? {}), aiModel: chosen, aiEffort: effort };
          await writeCanvas(document.uri.fsPath, document.canvas);
          this._llmClient?.resetSession?.(document.uri.fsPath);
          send(this.chatModelInfo(document));
          break;
        }
```

- [ ] **Step 5: File picker and add-note cases**

Replace:

```ts
        case 'floatingChatAbort': this._llmClient?.abort(); break;
```

with:

```ts
        case 'floatingChatAbort': this._llmClient?.abort(); break;
        case 'floatingChatPickFiles': {
          const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.Uri.file(path.dirname(document.uri.fsPath));
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
            defaultUri: folder, openLabel: 'Attach', title: 'Attach files to the next chat message',
          });
          if (!uris?.length) break;
          send({ type: 'floatingChatFilesPicked', files: uris.map(u => ({ path: u.fsPath, name: path.basename(u.fsPath) })) });
          break;
        }
        case 'floatingChatAddNote': {
          // - same path as the agent's add_note tool: a text node right of the focused node, with an edge
          const added = this.addNoteToCanvas(document, msg.activeNodeId, msg.content);
          if (!added) break;
          send({ type: 'floatingChatNodeAdded', node: added.node, edge: added.edge });
          try {
            await writeCanvas(document.uri.fsPath, document.canvas);
          } catch { /* - the webview already holds the node; its next save writes it */ }
          break;
        }
```

- [ ] **Step 6: Pass the canvas effort to the LLM client**

In `handleFloatingChatSend`, replace:

```ts
      model:        document.canvas.metadata?.aiModel,
      images:       harness ? attachments.flatMap(a => (a.kind === 'image' ? [{ mediaType: a.mediaType, data: a.data }] : [])) : [],
```

with:

```ts
      model:        document.canvas.metadata?.aiModel,
      effort:       document.canvas.metadata?.aiEffort,
      images:       harness ? attachments.flatMap(a => (a.kind === 'image' ? [{ mediaType: a.mediaType, data: a.data }] : [])) : [],
```

- [ ] **Step 7: Typecheck and build**

Run the typecheck command. Expected: nothing.
Run: `npm run build`. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/extension/editor-provider.ts
git commit -m "feat(chat): host side of the file picker, add-answer-as-note and the effort step"
```

---

### Task 10: The canvas tells the chat which nodes are picked with Space

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` (after the `__skenaGetViewport` effect, around line 3352)

UI plumbing, no pure logic. Typecheck and build; Task 19 item 11 checks it.

- [ ] **Step 1: Expose the picked nodes**

In `src/webview/canvas/CanvasView.tsx`, replace:

```ts
    (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport = getViewport;
    return () => { delete (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport; };
  }, []);
```

with:

```ts
    (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport = getViewport;
    return () => { delete (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport; };
  }, []);

  // - the chat's + menu reads the nodes picked with Space when it opens
  useEffect(() => {
    type Picked = { id: string; label: string };
    const getPicked = (): Picked[] => [...spaceSelectedRef.current].map(id => {
      const cn = canvasRef.current.nodes.find(n => n.id === id);
      return { id, label: cn?.nodeLabel ?? id.slice(0, 6) };
    });
    (window as unknown as { __skenaGetPicked?: () => Picked[] }).__skenaGetPicked = getPicked;
    return () => { delete (window as unknown as { __skenaGetPicked?: () => Picked[] }).__skenaGetPicked; };
  }, []);
```

- [ ] **Step 2: Typecheck and build**

Run the typecheck command. Expected: nothing.
Run: `npm run build`. Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx
git commit -m "feat(canvas): expose the Space-picked nodes to the chat"
```

---

### Task 11: Move the vim clipboard relay out of `FloatingChat.tsx`

**Files:**
- Create: `src/webview/canvas/chat/chatClipboard.ts`
- Modify: `src/webview/canvas/FloatingChat.tsx` (imports; delete lines 61–210; the Ctrl+C handler)

The code moves unchanged, so behaviour does not change. Typecheck and build; manual check in Step 5.

- [ ] **Step 1: Create the module**

Create `src/webview/canvas/chat/chatClipboard.ts`:

```ts
// - vim clipboard relay for the chat input. The webview blocks navigator.clipboard, so vim's +, * and
// - unnamed registers go through the extension host. TextNode has its own relay; the vim register
// - controller uses whichever registered last, so the chat input registers again on every focus.
import type { editor as MonacoEditor } from 'monaco-editor';
import { VimMode } from 'monaco-vim';
import { classifyHostText, rememberWritten, stripForHost } from '../vimClipboard';

type VimRegisterLike = {
  setText:               (text: string, linewise: boolean, blockwise?: boolean) => void;
  pushText:              (text: string, linewise: boolean) => void;
  clear:                 () => void;
  toString:              () => string;
  linewise:              boolean;
  blockwise:             boolean;
  keyBuffer:             string[];
  insertModeChanges:     unknown[];
  searchQueries:         string[];
  pushInsertModeChanges?:(changes: unknown) => void;
  pushSearchQuery?:      (query: string)   => void;
};

type VimSingleton = {
  defineRegister:        (n: string, r: unknown) => void;
  getRegisterController: () => { registers: Record<string, VimRegisterLike>; unnamedRegister: VimRegisterLike };
};

let chatClipboardCache: { text: string; linewise: boolean } = { text: '', linewise: false };

export function vscodePostMessage(msg: unknown): void {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function setChatClipboardCache(text: string, linewise: boolean): void {
  chatClipboardCache = { text, linewise };
}

// - `full` is the register form; `out` replaces what the host gets (Ctrl+C sends the line verbatim)
export function writeChatClipboard(full: string, linewise: boolean, out?: string): void {
  const sent = out ?? stripForHost(full, linewise);
  rememberWritten(sent, full, linewise);
  vscodePostMessage({ type: 'writeClipboard', text: sent });
}

const chatSysReg: VimRegisterLike = {
  keyBuffer:         [''],
  linewise:          false,
  blockwise:         false,
  insertModeChanges: [],
  searchQueries:     [],

  setText(text: string, linewise: boolean, blockwise?: boolean) {
    const full = text ?? '';
    this.keyBuffer = [full];
    this.linewise  = !!linewise;
    this.blockwise = !!blockwise;
    chatClipboardCache = { text: full, linewise: !!linewise };
    writeChatClipboard(full, !!linewise);
  },
  pushText(text: string, linewise: boolean) {
    if (linewise) {
      if (!this.linewise) this.keyBuffer.push('\n');
      this.linewise = true;
    }
    this.keyBuffer.push(text);
    const full = this.keyBuffer.join('');
    chatClipboardCache = { text: full, linewise: this.linewise };
    writeChatClipboard(full, this.linewise);
  },
  clear() {
    this.keyBuffer         = [];
    this.linewise          = false;
    this.blockwise         = false;
    this.insertModeChanges = [];
    this.searchQueries     = [];
  },
  toString() {
    return chatClipboardCache.text !== '' ? chatClipboardCache.text : this.keyBuffer.join('');
  },
  pushInsertModeChanges(changes: unknown) { this.insertModeChanges.push(changes); },
  pushSearchQuery(query: string)          { this.searchQueries.push(query); },
};

// - the host clipboard text becomes the relay register; the record shared with the node relay keeps
// - the linewise flag of a yank made in a cell
export function noteChatHostClipboard(text: string): void {
  const got            = classifyHostText(text);
  chatClipboardCache   = got;
  chatSysReg.linewise  = got.linewise;
  chatSysReg.keyBuffer = [got.text];
}

function getChatVimSingleton(): VimSingleton | undefined {
  return (VimMode as unknown as Record<string, unknown>).Vim as VimSingleton | undefined;
}

// - vim `o`/`O`: monaco-vim's newlineAndIndent defers editor.action.insertLineAfter, which does not run
// - from inside a vim key handler; insert the newline synchronously. Call after every initVimMode,
// - which can rebuild the command table.
export function patchVimNewlineAndIndent(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CM = VimMode as any;
  if (!CM?.commands) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CM.commands.newlineAndIndent = function(cm: any) {
    const editor = cm.editor as MonacoEditor.IStandaloneCodeEditor;
    const pos = editor.getPosition();
    if (!pos) return;
    editor.executeEdits('vim-o', [{
      range: {
        startLineNumber: pos.lineNumber, startColumn: pos.column,
        endLineNumber:   pos.lineNumber, endColumn:   pos.column,
      },
      text: '\n',
    }]);
  };
}

export function applyVimClipboard(): void {
  const Vim = getChatVimSingleton();
  if (!Vim) return;
  try { Vim.defineRegister('+', chatSysReg); } catch { /* already defined */ }
  try { Vim.defineRegister('*', chatSysReg); } catch { /* already defined */ }
  const rc = Vim.getRegisterController();
  if (rc) {
    rc.registers['"']  = chatSysReg;
    rc.unnamedRegister = chatSysReg;
  }
}
```

- [ ] **Step 2: Use it from `FloatingChat.tsx`**

In `src/webview/canvas/FloatingChat.tsx`:

1. Replace `import { initVimMode, VimMode } from 'monaco-vim';` with `import { initVimMode } from 'monaco-vim';`.
2. Replace `import { stripForHost, rememberWritten, classifyHostText } from './vimClipboard';` with:

   ```ts
   import { applyVimClipboard, noteChatHostClipboard, patchVimNewlineAndIndent, setChatClipboardCache, vscodePostMessage, writeChatClipboard } from './chat/chatClipboard';
   ```
3. Delete everything from the line `// ─── vscode message relay ─────────────────────────────────────────────────────` down to and including the closing `}` of `function applyVimClipboard(): void { … }` (lines 61–210 at `5241fa3`). The next line left in place is `// ─── props ─────…`.
4. In the Ctrl+C `addCommand`, replace:

   ```ts
          chatClipboardCache = { text, linewise: sel.isEmpty() };
   ```

   with:

   ```ts
          setChatClipboardCache(text, sel.isEmpty());
   ```

- [ ] **Step 3: Typecheck**

Run the typecheck command. Expected: nothing.

- [ ] **Step 4: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 5: Manual check**

Ctrl+F5, open `test/H3.canvas`, open the chat (Alt+`), focus it (Alt+I). In vim normal mode type a word, `yy`, then paste it into a text node with `p` in its editor. Then copy a line in a text node and `p` in the chat. Both pastes show the copied line.

- [ ] **Step 6: Commit**

```bash
git add src/webview/canvas/chat/chatClipboard.ts src/webview/canvas/FloatingChat.tsx
git commit -m "refactor(chat): move the vim clipboard relay into chat/chatClipboard.ts"
```

---

### Task 12: Console stylesheet

**Files:**
- Create: `src/webview/styles/chat-console.css`
- Modify: `src/webview/index.tsx` (the style imports)

CSS only; no class is used until Task 13. Build and check that nothing else changed.

- [ ] **Step 1: Create the stylesheet**

Create `src/webview/styles/chat-console.css`:

```css
/* - the chat console docked at the bottom centre: the conversation panel on top, inset 18 px on each
     side, and the input bar below it. The root is fixed and centred by auto margins. */
.cc-root {
  --cc-panel:      rgba(14, 20, 18, 0.42);
  --cc-panel-line: rgba(255, 255, 255, 0.08);
  --cc-bar:        rgba(20, 26, 24, 0.58);
  --cc-menu:       rgba(20, 26, 24, 0.86);
  --cc-accent:     #7fe3b8;
  --cc-accent-ink: #062016;
  --cc-done:       #4cc8a0;
  --cc-running:    #e7a93a;
  --cc-error:      #e5484d;
  --cc-ink:        #e3e7ea;
  --cc-muted:      #8f9aa4;
  --cc-line:       #262b30;
  --cc-font:       "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --cc-mono:       "IBM Plex Mono", ui-monospace, Menlo, monospace;

  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0 auto;
  padding-bottom: 18px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  font-family: var(--cc-font);
  font-size: 13px;
  color: var(--cc-ink);
  /* - the strip under the bar and the panel's side insets let clicks through to the canvas; the root's
       rect still reaches the bottom edge, so CanvasView's paneArea keeps focused nodes above it */
  pointer-events: none;
}
.cc-root > * { pointer-events: auto; }

.cc-edge { position: absolute; top: 0; bottom: 18px; width: 8px; cursor: ew-resize; z-index: 2; }
.cc-edge-left  { left: -4px; }
.cc-edge-right { right: -4px; }

.cc-out {
  margin: 0 18px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--cc-panel);
  border: 1px solid var(--cc-panel-line);
  border-bottom: none;
  border-radius: 14px 14px 0 0;
  backdrop-filter: blur(10px) saturate(1.15);
  -webkit-backdrop-filter: blur(10px) saturate(1.15);
}
.cc-out-h {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 14px;
  font-size: 12.5px;
  color: var(--cc-muted);
  user-select: none;
}
.cc-out-h .grow { flex: 1; }
.cc-tokens { font-size: 11px; opacity: 0.8; }
.cc-hbtn { background: none; border: none; padding: 0 2px; line-height: 1; font-size: 12.5px; color: var(--cc-muted); cursor: pointer; }
.cc-hbtn:hover { color: var(--cc-ink); }
.cc-out-b { display: flex; flex-direction: column; gap: 7px; min-height: 0; overflow-y: auto; padding: 0 14px 10px; }

.cc-turn { display: flex; flex-direction: column; gap: 7px; }
.cc-turn + .cc-turn,
.cc-turn + .cc-fold-line,
.cc-fold-line + .cc-turn { border-top: 1px solid var(--cc-line); padding-top: 7px; }
.cc-fold-line {
  font-family: var(--cc-mono);
  font-size: 12.5px;
  color: var(--cc-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.cc-fold-line:hover { color: var(--cc-ink); }
.cc-user {
  font-family: var(--cc-mono);
  font-size: 12.5px;
  color: var(--cc-accent);
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.cc-user::before { content: '› '; color: var(--cc-muted); }

.cc-step { display: flex; flex-direction: column; }
.cc-tool {
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--cc-panel-line);
  font-family: var(--cc-mono);
  font-size: 11.5px;
  color: var(--cc-muted);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cc-tool .ok  { color: var(--cc-done); }
.cc-tool .run { color: var(--cc-running); }
.cc-tool .err { color: var(--cc-error); }
.cc-tool-detail {
  margin: 3px 0 0 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--cc-mono);
  font-size: 10.5px;
  color: var(--cc-muted);
}

.cc-reply { font-size: 13.5px; line-height: 1.6; user-select: text; word-break: break-word; }
.cc-reply p { margin: 0 0 6px; }
.cc-reply code { font-family: var(--cc-mono); font-size: 12px; background: rgba(255, 255, 255, 0.06); padding: 1px 4px; border-radius: 4px; }
.cc-reply pre { margin: 4px 0; padding: 6px 8px; background: rgba(0, 0, 0, 0.3); border-radius: 6px; overflow: auto; }
.cc-reply pre code { background: none; padding: 0; }
.cc-caret { display: inline-block; width: 7px; height: 15px; margin-left: 2px; background: var(--cc-accent); vertical-align: -2px; opacity: 0.85; }
.cc-dots { font-size: 12px; color: var(--cc-muted); }

.cc-actions { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--cc-muted); }
.cc-act { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.cc-act:hover { color: var(--cc-ink); }
.cc-cost { margin-left: auto; font-size: 11px; opacity: 0.8; }

.cc-note { padding: 6px 10px; border-radius: 8px; font-size: 11.5px; background: rgba(127, 227, 184, 0.10); border: 1px solid rgba(127, 227, 184, 0.25); color: var(--cc-accent); }
.cc-error { padding: 6px 10px; border-radius: 8px; font-size: 11.5px; background: rgba(229, 72, 77, 0.10); border: 1px solid rgba(229, 72, 77, 0.30); color: var(--cc-error); }

.cc-bar {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 7px 7px 7px 10px;
  background: var(--cc-bar);
  border: 1px solid var(--cc-panel-line);
  border-radius: 22px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px) saturate(1.15);
  -webkit-backdrop-filter: blur(12px) saturate(1.15);
  transition: border-color 0.15s ease;
}
.cc-bar.focused { border-color: rgba(127, 227, 184, 0.45); }

.cc-plus-wrap { position: relative; flex-shrink: 0; }
.cc-plus {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  font-size: 19px;
  color: var(--cc-ink);
  cursor: pointer;
}
.cc-plus:hover { background: rgba(255, 255, 255, 0.07); }

.cc-menu {
  position: absolute;
  left: -4px;
  bottom: 43px;
  z-index: 3;
  min-width: 250px;
  display: flex;
  flex-direction: column;
  padding: 5px;
  background: var(--cc-menu);
  border: 1px solid var(--cc-panel-line);
  border-radius: 12px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  font-size: 13px;
}
.cc-menu-item {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: none;
  border: none;
  font: inherit;
  color: var(--cc-ink);
  text-align: left;
  cursor: pointer;
}
.cc-menu-item:hover { background: rgba(255, 255, 255, 0.07); }
.cc-menu-item:disabled { opacity: 0.45; cursor: default; }
.cc-menu-item .k { margin-left: auto; font-family: var(--cc-mono); font-size: 11.5px; color: var(--cc-muted); }
.cc-menu-hint { padding: 6px 10px; font-size: 12px; color: var(--cc-muted); }
.cc-paste-target { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.cc-field { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; padding: 5px 0; }
.cc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cc-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(127, 227, 184, 0.10);
  border: 1px solid rgba(127, 227, 184, 0.25);
  font-family: var(--cc-mono);
  font-size: 11.5px;
  color: var(--cc-accent);
}
.cc-chip button { background: none; border: none; padding: 0; line-height: 1; font-size: 11px; color: var(--cc-muted); cursor: pointer; }
.cc-chip button:hover { color: var(--cc-ink); }

.cc-editor { position: relative; }
/* - Monaco themes are global, so the chat input keeps the node editors' theme and turns see-through here */
.cc-editor .monaco-editor,
.cc-editor .monaco-editor .margin,
.cc-editor .monaco-editor-background,
.cc-editor .monaco-editor .inputarea.ime-input { background-color: transparent !important; }
.cc-editor .monaco-editor .cursors-layer .cursor { background-color: var(--cc-accent) !important; border-color: var(--cc-accent) !important; }
.cc-ph {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  font-family: var(--cc-mono);
  font-size: 13px;
  line-height: 20px;
  color: var(--cc-muted);
  pointer-events: none;
}

.cc-spin {
  flex-shrink: 0;
  align-self: center;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--cc-accent);
  border-radius: 50%;
  animation: cc-spin 0.8s linear infinite;
}
@keyframes cc-spin { to { transform: rotate(360deg); } }

.cc-model {
  flex-shrink: 0;
  align-self: center;
  display: inline-flex;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 8px;
  background: none;
  border: none;
  font-family: var(--cc-font);
  font-size: 12.5px;
  color: var(--cc-ink);
  white-space: nowrap;
  cursor: pointer;
}
.cc-model:hover { background: rgba(255, 255, 255, 0.07); }
.cc-model i { font-style: normal; color: var(--cc-muted); }

.cc-send {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--cc-accent);
  color: var(--cc-accent-ink);
  border: none;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.cc-send:disabled { opacity: 0.45; cursor: default; }
.cc-stop {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.10);
  border: none;
  cursor: pointer;
}
.cc-stop i { width: 11px; height: 11px; border-radius: 2px; background: var(--cc-ink); }
```

- [ ] **Step 2: Import it**

In `src/webview/index.tsx`, replace:

```ts
import './styles/preview-card.css';
```

with:

```ts
import './styles/preview-card.css';
import './styles/chat-console.css';
```

- [ ] **Step 3: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 4: Manual check**

Ctrl+F5, open `test/H3.canvas`. The canvas and the old floating chat look as before (every new rule is under `.cc-*`).

- [ ] **Step 5: Commit**

```bash
git add src/webview/styles/chat-console.css src/webview/index.tsx
git commit -m "style(chat): console stylesheet — see-through panel, input bar, menu, chips"
```

---

### Task 13: The turn list

**Files:**
- Create: `src/webview/canvas/chat/TurnList.tsx`

A component, not mounted until Task 18. Typecheck and build; Task 19 items 6–9 check it.

- [ ] **Step 1: Create the component**

Create `src/webview/canvas/chat/TurnList.tsx`:

```tsx
import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatItem } from '../../../shared/types';
import { useHostMarkdown } from '../../hooks/useHostMarkdown';
import { useHighlightedHtml } from '../../lib/codeHighlight';
import { ChatTurn, clockTime, firstLine, turnAnswer, turnCost } from './chatTurns';
import { isTurnOpen } from './turnFold';
import { toolCardView } from './toolCardView';

interface TurnListProps {
  turns:     ChatTurn[];
  toggled:   ReadonlySet<string>;
  streaming: string;
  thinking:  boolean;
  working:   boolean;
  onToggle:  (key: string) => void;
  onCopy:    (text: string) => void;
  onAddNote: (text: string) => void;
}

export function TurnList({ turns, toggled, streaming, thinking, working, onToggle, onCopy, onAddNote }: TurnListProps): JSX.Element {
  const latestKey = turns.length ? turns[turns.length - 1].key : null;
  return (
    <>
      {turns.map(t => {
        const latest = t.key === latestKey;
        return isTurnOpen(toggled, t.key, latestKey)
          ? (
            <OpenTurn
              key={t.key}
              turn={t}
              streaming={latest ? streaming : ''}
              thinking={latest && thinking}
              working={latest && working}
              onToggle={onToggle}
              onCopy={onCopy}
              onAddNote={onAddNote}
            />
          )
          : <FoldedTurn key={t.key} turn={t} onToggle={onToggle} />;
      })}
    </>
  );
}

function FoldedTurn({ turn, onToggle }: { turn: ChatTurn; onToggle: (key: string) => void }): JSX.Element {
  const prompt = turn.prompt === null ? '(no prompt)' : firstLine(turn.prompt);
  return (
    <div className="cc-fold-line" title={turn.prompt ?? undefined} onClick={() => onToggle(turn.key)}>
      › {prompt} · {clockTime(turn.time)}
    </div>
  );
}

interface OpenTurnProps {
  turn:      ChatTurn;
  streaming: string;
  thinking:  boolean;
  working:   boolean;
  onToggle:  (key: string) => void;
  onCopy:    (text: string) => void;
  onAddNote: (text: string) => void;
}

function OpenTurn({ turn, streaming, thinking, working, onToggle, onCopy, onAddNote }: OpenTurnProps): JSX.Element {
  const answer = working ? '' : turnAnswer(turn);
  const cost   = working ? null : turnCost(turn);
  return (
    <div className="cc-turn">
      {turn.prompt !== null && (
        <div className="cc-user" title={turn.prompt} onClick={() => onToggle(turn.key)}>{firstLine(turn.prompt)}</div>
      )}
      {turn.items.map((it, i) => <TurnItem key={it.kind === 'tool' ? it.id : `${it.kind}-${i}`} item={it} />)}
      {streaming !== '' && <AnswerText content={streaming} streaming />}
      {thinking && streaming === '' && <div className="cc-dots">● ● ●</div>}
      {answer !== '' && (
        <div className="cc-actions">
          <button className="cc-act" title="Copy the answer" onClick={() => onCopy(answer)}>⧉</button>
          <button className="cc-act" title="Add the answer to the canvas as a note" onClick={() => onAddNote(answer)}>＋ canvas</button>
          {cost && (
            <span className="cc-cost">{`Δ $${cost.deltaUsd.toFixed(2)}${cost.costUsd !== undefined ? ` · Σ $${cost.costUsd.toFixed(2)}` : ''}`}</span>
          )}
        </div>
      )}
    </div>
  );
}

// - memoized: an item object is replaced only when it changes, so the other rows skip re-rendering
const TurnItem = memo(function TurnItem({ item }: { item: ChatItem }): JSX.Element | null {
  if (item.kind === 'text') {
    return item.role === 'user' ? <div className="cc-user">{firstLine(item.content)}</div> : <AnswerText content={item.content} />;
  }
  if (item.kind === 'thinking') return <ThinkingStep content={item.content} />;
  return <ToolStep item={item} />;
});

function ToolStep({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const v = toolCardView(item.name, item.input);
  if (v.hidden) return null;
  const mark = item.status === 'running' ? <span className="run">●</span>
             : item.status === 'ok'      ? <span className="ok">✓</span>
             :                             <span className="err">✗</span>;
  const canOpen = v.kind !== 'todo';
  return (
    <div className="cc-step">
      <div className="cc-tool" style={canOpen ? undefined : { cursor: 'default' }} onClick={canOpen ? () => setOpen(o => !o) : undefined}>
        {mark}<span>{v.title}</span>
      </div>
      {v.kind === 'todo' && v.todos && (
        <div className="cc-tool-detail">
          {v.todos.map((t, j) => <div key={j}>{t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} {t.text}</div>)}
        </div>
      )}
      {open && canOpen && <pre className="cc-tool-detail">{JSON.stringify(item.input, null, 1)}</pre>}
      {open && v.showResult && item.resultPreview && <div className="cc-tool-detail">{item.resultPreview}</div>}
    </div>
  );
}

function ThinkingStep({ content }: { content: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="cc-step">
      <div className="cc-tool" onClick={() => setOpen(o => !o)}><span>∴</span><span>thinking {open ? '▾' : '▸'}</span></div>
      {open && <pre className="cc-tool-detail">{content}</pre>}
    </div>
  );
}

// - a finished reply with Typst (%…%) renders host-side; streaming and plain text use ReactMarkdown
const AnswerText = memo(function AnswerText({ content, streaming = false }: { content: string; streaming?: boolean }): JSX.Element {
  const hostHtml  = useHostMarkdown(streaming ? '' : content);
  const shownHtml = useHighlightedHtml(hostHtml);
  return (
    <div className="cc-reply">
      {hostHtml !== null ? (
        <div className="skena-markdown skena-chat-md" dangerouslySetInnerHTML={{ __html: shownHtml ?? hostHtml }} />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { output: 'mathml', throwOnError: false }]]}
        >
          {content}
        </ReactMarkdown>
      )}
      {streaming && <span className="cc-caret" />}
    </div>
  );
});
```

- [ ] **Step 2: Typecheck**

Run the typecheck command. Expected: nothing.

- [ ] **Step 3: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/chat/TurnList.tsx
git commit -m "feat(chat): turn list — folded lines, open turns, one-line steps, answer actions"
```

---

### Task 14: The `+` menu

**Files:**
- Create: `src/webview/canvas/chat/AttachMenu.tsx`

A component, not mounted until Task 18. Typecheck and build; Task 19 items 11–13 check it.

- [ ] **Step 1: Create the component**

Create `src/webview/canvas/chat/AttachMenu.tsx`:

```tsx
import { useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { MAX_IMAGE_BASE64, parseImageDataUrl } from '../../../shared/chatAttachments';

export interface PastedImage { id: string; name: string; mediaType: string; data: string }

interface Props {
  pickedCount: number;
  // - only the harness sends images; the other adapters take text only
  allowImage:  boolean;
  imageCount:  number;
  onPickNodes: () => void;
  onPickFile:  () => void;
  onImage:     (img: PastedImage) => void;
  onWarn:      (text: string) => void;
}

export function AttachMenu({ pickedCount, allowImage, imageCount, onPickNodes, onPickFile, onImage, onWarn }: Props): JSX.Element {
  const pasteTargetRef = useRef<HTMLTextAreaElement>(null);
  const pastedRef      = useRef(false);
  const [waiting, setWaiting] = useState(false);

  // - vscode.env.clipboard is text only; an image arrives only in a DOM paste event. Focus a hidden
  // - textarea and try a scripted paste; if the webview refuses it, the user's Ctrl+V lands there instead.
  const askClipboard = () => {
    const target = pasteTargetRef.current;
    if (!target) return;
    pastedRef.current = false;
    target.focus();
    try { document.execCommand('paste'); } catch { /* - refused; the timer below asks for Ctrl+V */ }
    setTimeout(() => { if (!pastedRef.current) setWaiting(true); }, 150);
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    pastedRef.current = true;
    e.preventDefault();
    e.stopPropagation();
    const item = Array.from(e.clipboardData.items).find(it => it.kind === 'file' && it.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) { onWarn('Skena: the clipboard holds no image.'); return; }
    const reader = new FileReader();
    reader.onerror = () => onWarn('Skena: could not read the clipboard image.');
    reader.onload = () => {
      const img = parseImageDataUrl(String(reader.result));
      if (!img) { onWarn(`Skena: ${file.type} is not supported; use PNG, JPEG, GIF or WebP.`); return; }
      if (img.data.length > MAX_IMAGE_BASE64) { onWarn('Skena: the clipboard image is over 5 MB.'); return; }
      onImage({ id: `img-${Date.now().toString(36)}`, name: `image ${imageCount + 1}`, ...img });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="cc-menu" role="menu">
      <button className="cc-menu-item" disabled={pickedCount === 0} onClick={onPickNodes}>
        ◇ Nodes picked with Space <span className="k">{pickedCount} picked</span>
      </button>
      <button className="cc-menu-item" onClick={onPickFile}>▤ File from the workspace…</button>
      {allowImage && <button className="cc-menu-item" onClick={askClipboard}>▣ Image from the clipboard</button>}
      {waiting && <div className="cc-menu-hint">Press Ctrl+V to attach the image · Esc to cancel</div>}
      <textarea ref={pasteTargetRef} className="cc-paste-target" aria-hidden="true" tabIndex={-1} onPaste={onPaste} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command. Expected: nothing.

- [ ] **Step 3: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/chat/AttachMenu.tsx
git commit -m "feat(chat): + menu — picked nodes, a workspace file, a clipboard image"
```

---

### Task 15: The chat input

**Files:**
- Create: `src/webview/canvas/chat/ChatInput.tsx`

The Monaco editor and every key handler that belongs to it, moved from `FloatingChat.tsx` with three changes: its height follows the line count, Alt+I no longer opens or folds anything (the input is always visible), and it never takes focus on mount. Not mounted until Task 18. Typecheck and build; Task 19 items 4–5 check it.

- [ ] **Step 1: Create the component**

Create `src/webview/canvas/chat/ChatInput.tsx`:

```tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode } from 'monaco-vim';
import { patchVimDeleteLastLine, patchVimExternalSelection, patchVimLastLine, patchVimVisualCursor } from '../nodes/TextNode';
import {
  applyVimClipboard, noteChatHostClipboard, patchVimNewlineAndIndent, setChatClipboardCache, vscodePostMessage, writeChatClipboard,
} from './chatClipboard';
import { INPUT_LINE_H, inputHeight } from './consoleLayout';

export interface ChatInputHandle {
  focus:  () => void;
  submit: () => void;
}

interface Props {
  // - the conversation's scroll box; Shift+H/J/K/L scroll it from vim normal mode
  scrollTarget:  RefObject<HTMLDivElement>;
  onSend:        (text: string) => void;
  onFocusChange: (focused: boolean) => void;
  onEmptyChange: (empty: boolean) => void;
}

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(props, ref) {
  const editorRef          = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const vimRef             = useRef<{ dispose: () => void } | null>(null);
  const pendingPasteRef    = useRef(false);
  const vimModeRef         = useRef('normal');
  // - the input had focus when focus left the webview; give it back when the webview returns
  const restoreOnReturnRef = useRef(false);
  // - listeners are registered once; they read the latest props from here
  const propsRef           = useRef(props);
  propsRef.current         = props;
  const [lines, setLines]  = useState(1);
  const [empty, setEmpty]  = useState(true);

  const submit = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const text = ed.getValue().trim();
    if (!text) return;
    propsRef.current.onSend(text);
    ed.setValue('');
    ed.focus();
  }, []);

  useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.focus(), submit }), [submit]);

  // - host clipboard text: refreshes the vim register and completes a pending Ctrl+V
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail ?? '';
      noteChatHostClipboard(text);
      if (!pendingPasteRef.current) return;
      pendingPasteRef.current = false;
      const ed  = editorRef.current;
      const sel = ed?.getSelection();
      if (!ed || !sel) return;
      ed.executeEdits('system-paste', [{ range: sel, text, forceMoveMarkers: true }]);
      ed.focus();
    };
    window.addEventListener('skena:clipboardContent', handler);
    return () => window.removeEventListener('skena:clipboardContent', handler);
  }, []);

  // - Ctrl+Enter in the capture phase: Monaco's addCommand drops other bindings once Ctrl+V and Ctrl+C are bound
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if (!editorRef.current?.hasTextFocus()) return;
      e.preventDefault();
      e.stopPropagation();
      submit();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [submit]);

  // - Alt+I moves focus between the input and the canvas; the capture phase runs before Monaco
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.key.toLowerCase() !== 'i') return;
      e.preventDefault();
      e.stopPropagation();
      const ed = editorRef.current;
      if (ed?.hasTextFocus()) {
        (document.activeElement as HTMLElement | null)?.blur();
        window.dispatchEvent(new CustomEvent('skena:restoreCanvasFocus'));
      } else {
        ed?.focus();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // - back from another VS Code panel: panelActivated covers other editor groups; window focus covers the
  // - sidebar and terminal, where the canvas stays the active editor and panelActivated never fires
  useEffect(() => {
    const restore = () => {
      if (!restoreOnReturnRef.current) return;
      restoreOnReturnRef.current = false;
      requestAnimationFrame(() => editorRef.current?.focus());
    };
    const onWinFocus = () => {
      if (!restoreOnReturnRef.current) return;
      // - window focus fires in short-lived pairs; act only if the focus is still here a tick later
      setTimeout(() => { if (document.hasFocus()) restore(); }, 0);
    };
    window.addEventListener('skena:panelActivated', restore);
    window.addEventListener('focus', onWinFocus);
    return () => {
      window.removeEventListener('skena:panelActivated', restore);
      window.removeEventListener('focus', onWinFocus);
    };
  }, []);

  // - Monaco binds Alt+L to find-in-selection and swallows it; send VS Code's navigateRight instead
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'l') return;
      if (!editorRef.current?.hasTextFocus()) return;
      e.preventDefault();
      e.stopPropagation();
      vscodePostMessage({ type: 'navigateFocus', dir: 'right' });
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // - Shift+H/J/K/L scroll the conversation from vim normal mode; the capture phase runs before vim's J/H/L
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!['H', 'J', 'K', 'L'].includes(e.key)) return;
      if (!editorRef.current?.hasTextFocus() || vimModeRef.current !== 'normal') return;
      const el = propsRef.current.scrollTarget.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const vStep = 60;
      const hStep = 120;
      switch (e.key) {
        case 'J': el.scrollBy({ top:  vStep, behavior: 'smooth' }); break;
        case 'K': el.scrollBy({ top: -vStep, behavior: 'smooth' }); break;
        case 'L': el.scrollBy({ left:  hStep, behavior: 'smooth' }); break;
        case 'H': el.scrollBy({ left: -hStep, behavior: 'smooth' }); break;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // - Monaco themes are global: keep the same 'skena-editor' definition the node editors use;
  // - the see-through background comes from chat-console.css
  const handleBeforeMount: BeforeMount = useCallback((monacoInstance) => {
    const bg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    monacoInstance.editor.defineTheme('skena-editor', {
      base:    'vs-dark',
      inherit: true,
      rules:   [],
      colors: {
        'editor.background':               bg || '#1e1e2e',
        'editor.lineHighlightBackground':  '#00000000',
        'editor.lineHighlightBorderColor': '#00000000',
      },
    });
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    editor.updateOptions({
      minimap:              { enabled: false },
      lineNumbers:          'off',
      glyphMargin:          false,
      folding:              false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars:  0,
      overviewRulerLanes:   0,
      scrollBeyondLastLine: false,
      wordWrap:             'on',
      scrollbar:            { vertical: 'auto', horizontal: 'hidden', alwaysConsumeMouseWheel: false, verticalScrollbarSize: 3 },
      // - no padding: the content height is then exactly lines × INPUT_LINE_H
      padding:              { top: 0, bottom: 0 },
    });
    editor.onDidContentSizeChange(e => setLines(e.contentHeight / INPUT_LINE_H));
    editor.onDidChangeModelContent(() => {
      const isEmpty = editor.getValue().trim() === '';
      setEmpty(isEmpty);
      propsRef.current.onEmptyChange(isEmpty);
    });

    vimRef.current = initVimMode(editor, null) as { dispose: () => void };
    // - track the vim mode so Shift+H/J/K/L scroll only outside insert mode
    (vimRef.current as unknown as { on?: (ev: string, cb: (e: { mode: string }) => void) => void })
      .on?.('vim-mode-change', ev => { vimModeRef.current = ev.mode; });
    patchVimNewlineAndIndent();
    patchVimLastLine();
    patchVimVisualCursor();
    patchVimExternalSelection();
    patchVimDeleteLastLine();
    applyVimClipboard();

    editor.onDidFocusEditorText(() => {
      // - a node editor may have taken the vim registers while it had focus; take them back
      applyVimClipboard();
      vscodePostMessage({ type: 'requestClipboardRead' });
      propsRef.current.onFocusChange(true);
    });
    editor.onDidBlurEditorText(() => {
      propsRef.current.onFocusChange(false);
      // - document.hasFocus() still reads the old value during blur; read it a tick later
      setTimeout(() => { restoreOnReturnRef.current = !document.hasFocus(); }, 0);
    });

    // - Ctrl+V outside vim normal mode pastes the host clipboard; navigator.clipboard is blocked here
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
      pendingPasteRef.current = true;
      vscodePostMessage({ type: 'requestClipboardRead' });
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
      const sel   = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model) return;
      const text = sel.isEmpty() ? model.getLineContent(sel.startLineNumber) + '\n' : model.getValueInRange(sel);
      if (!text) return;
      setChatClipboardCache(text, sel.isEmpty());
      // - a whole-line copy keeps its trailing newline on the host, as VS Code's own Ctrl+C does
      writeChatClipboard(text, sel.isEmpty(), text);
    });
  }, []);

  useEffect(() => () => { vimRef.current?.dispose(); }, []);

  return (
    <div className="cc-editor">
      {empty && <span className="cc-ph">Ask the agent</span>}
      <Editor
        height={inputHeight(lines)}
        defaultLanguage="markdown"
        theme="skena-editor"
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          fontSize:            13,
          lineHeight:          INPUT_LINE_H,
          fontFamily:          MONO,
          suggest:             { showWords: false },
          quickSuggestions:    false,
          parameterHints:      { enabled: false },
          renderLineHighlight: 'none',
          automaticLayout:     true,
        }}
      />
    </div>
  );
});
```

- [ ] **Step 2: Typecheck**

Run the typecheck command. Expected: nothing.

- [ ] **Step 3: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/chat/ChatInput.tsx
git commit -m "feat(chat): chat input — Monaco + vim, grows by line to 8 lines, the existing key handlers"
```

---

### Task 16: The input bar

**Files:**
- Create: `src/webview/canvas/chat/InputBar.tsx`

A component, not mounted until Task 18. Typecheck and build; Task 19 items 4, 7, 11–13, 17 check it.

- [ ] **Step 1: Create the component**

Create `src/webview/canvas/chat/InputBar.tsx`:

```tsx
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChatAttachment, attachmentKey, chipLabel } from '../../../shared/chatAttachments';
import { AttachMenu } from './AttachMenu';
import { ChatInput, type ChatInputHandle } from './ChatInput';

interface Props {
  inputRef:     RefObject<ChatInputHandle>;
  scrollTarget: RefObject<HTMLDivElement>;
  attachments:  ChatAttachment[];
  working:      boolean;
  model?:       string;
  effort?:      string;
  provider?:    string;
  sessionName?: string;
  onSend:       (text: string) => void;
  onStop:       () => void;
  onPickModel:  () => void;
  onPickFile:   () => void;
  onAttach:     (add: ChatAttachment[]) => void;
  onRemove:     (key: string) => void;
  onWarn:       (text: string) => void;
}

type Picked = { id: string; label: string };

function pickedNodes(): Picked[] {
  return (window as unknown as { __skenaGetPicked?: () => Picked[] }).__skenaGetPicked?.() ?? [];
}

export function InputBar(p: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [picked,   setPicked]   = useState<Picked[]>([]);
  const [focused,  setFocused]  = useState(false);
  const [empty,    setEmpty]    = useState(true);
  const plusRef = useRef<HTMLDivElement>(null);

  // - a mouse press outside the + button and its menu closes the menu
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!plusRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [menuOpen]);

  const toggleMenu = () => {
    if (!menuOpen) setPicked(pickedNodes());
    setMenuOpen(o => !o);
  };
  const closeMenu = () => {
    setMenuOpen(false);
    p.inputRef.current?.focus();
  };

  const imageCount = p.attachments.filter(a => a.kind === 'image').length;
  const modelTitle = `Change the model for this canvas${p.provider ? ` · provider: ${p.provider}` : ''}${p.sessionName ? ` · session: ${p.sessionName}` : ''}`;

  return (
    <div
      className={`cc-bar${focused ? ' focused' : ''}`}
      onKeyDown={e => { if (menuOpen && e.key === 'Escape') { e.preventDefault(); closeMenu(); } }}
    >
      <div className="cc-plus-wrap" ref={plusRef}>
        {menuOpen && (
          <AttachMenu
            pickedCount={picked.length}
            allowImage={p.provider === 'harness'}
            imageCount={imageCount}
            onPickNodes={() => { p.onAttach(picked.map((n): ChatAttachment => ({ kind: 'node', id: n.id, label: n.label }))); closeMenu(); }}
            onPickFile={() => { setMenuOpen(false); p.onPickFile(); }}
            onImage={img => { p.onAttach([{ kind: 'image', ...img }]); closeMenu(); }}
            onWarn={text => { p.onWarn(text); closeMenu(); }}
          />
        )}
        <button className="cc-plus" title="Attach nodes, a file or an image" onClick={toggleMenu}>+</button>
      </div>
      <div className="cc-field">
        {p.attachments.length > 0 && (
          <div className="cc-chips">
            {p.attachments.map(a => (
              <span key={attachmentKey(a)} className="cc-chip">
                {chipLabel(a)}
                <button title="Remove" onClick={() => p.onRemove(attachmentKey(a))}>×</button>
              </span>
            ))}
          </div>
        )}
        <ChatInput ref={p.inputRef} scrollTarget={p.scrollTarget} onSend={p.onSend} onFocusChange={setFocused} onEmptyChange={setEmpty} />
      </div>
      {p.working && <span className="cc-spin" />}
      <button className="cc-model" title={modelTitle} onClick={p.onPickModel}>
        {p.model || 'model'}{p.effort && <i>{p.effort}</i>} ▾
      </button>
      {p.working ? (
        // - soft abort: the UI stops showing this turn; the claude process finishes it in the background
        <button className="cc-stop" title="Stop — interrupt the current reply" onClick={p.onStop}><i /></button>
      ) : (
        <button className="cc-send" title="Send (Ctrl+Enter)" disabled={empty} onClick={() => p.inputRef.current?.submit()}>↑</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command. Expected: nothing.

- [ ] **Step 3: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/chat/InputBar.tsx
git commit -m "feat(chat): input bar — +, chips, input, model button, send and Stop"
```

---

### Task 17: The conversation panel

**Files:**
- Create: `src/webview/canvas/chat/ConversationPanel.tsx`

A component, not mounted until Task 18. Typecheck and build; Task 19 items 6, 10, 14 check it.

- [ ] **Step 1: Create the component**

Create `src/webview/canvas/chat/ConversationPanel.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChatItem, ChatTokenUsage } from '../../../shared/types';
import { clockTime, groupTurns } from './chatTurns';
import { nextToggled, toggleTurn } from './turnFold';
import { TurnList } from './TurnList';

interface Props {
  scrollRef:    RefObject<HTMLDivElement>;
  history:      ChatItem[];
  streaming:    string;
  thinking:     boolean;
  working:      boolean;
  error:        string | null;
  compacting:   boolean;
  usage:        ChatTokenUsage | null;
  folded:       boolean;
  onToggleFold: () => void;
  onCompact:    () => void;
  onReset:      () => void;
  onCopy:       (text: string) => void;
  onAddNote:    (text: string) => void;
}

export function ConversationPanel(p: Props): JSX.Element | null {
  const { scrollRef } = p;
  const turns     = useMemo(() => groupTurns(p.history), [p.history]);
  const latest    = turns.length ? turns[turns.length - 1] : null;
  const latestKey = latest?.key ?? null;
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set<string>());
  const prevLatestRef = useRef<string | null>(latestKey);

  useEffect(() => {
    setToggled(t => nextToggled(t, prevLatestRef.current, latestKey));
    prevLatestRef.current = latestKey;
  }, [latestKey]);

  const busy    = p.working || p.compacting;
  const visible = turns.length > 0 || busy || p.error !== null;

  // - pin to the latest content on unfold, on restored history and while streaming; opening an
  // - earlier turn changes none of these, so it does not jump
  useEffect(() => {
    if (!visible || p.folded) return;
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [visible, p.folded, p.history, p.streaming, scrollRef]);

  // - a finer wheel step: the native one jumps too far to follow the text; ctrl+wheel is the host's zoom
  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const px = e.deltaMode === 1 ? e.deltaY * 18
               : e.deltaMode === 2 ? e.deltaY * el.clientHeight
               : e.deltaY;
      el.scrollBy({ top: px * 0.5 });
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [visible, scrollRef]);

  if (!visible) return null;
  const status = busy ? 'working' : latest ? clockTime(latest.time) : '';

  return (
    <div className="cc-out">
      <div className="cc-out-h">
        <span>Latest turn{status ? ` · ${status}` : ''}</span>
        <span className="grow" />
        {p.usage && <span className="cc-tokens">{p.usage.inputTokens + p.usage.cacheReadTokens}▸{p.usage.outputTokens} tok</span>}
        <button className="cc-hbtn" title="Compact session (summarise to shrink context)" onClick={p.onCompact}>⤵</button>
        <button className="cc-hbtn" title="Reset — new session, clear history" onClick={p.onReset}>⟲</button>
        <button className="cc-hbtn" title={p.folded ? 'Open the conversation (Alt+`)' : 'Fold the conversation (Alt+`)'} onClick={p.onToggleFold}>
          {p.folded ? '▸' : '▾'}
        </button>
      </div>
      {/* - hidden, not unmounted, when folded: reopening must not re-parse every answer's markdown and KaTeX */}
      <div ref={scrollRef} className="cc-out-b" style={{ display: p.folded ? 'none' : 'flex' }}>
        <TurnList
          turns={turns}
          toggled={toggled}
          streaming={p.streaming}
          thinking={p.thinking}
          working={p.working}
          onToggle={key => setToggled(t => toggleTurn(t, key))}
          onCopy={p.onCopy}
          onAddNote={p.onAddNote}
        />
        {p.compacting && <div className="cc-note">⏳ Compacting session… summarising the conversation to shrink context.</div>}
        {p.error && <div className="cc-error">Error: {p.error}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command. Expected: nothing.

- [ ] **Step 3: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/chat/ConversationPanel.tsx
git commit -m "feat(chat): conversation panel — header line, fold, turn list, pin to latest"
```

---

### Task 18: Switch to the docked console

**Files:**
- Modify: `src/shared/types.ts` (`MsgFloatingChatHistoryRestored`, `MsgFloatingChatSaveUIState`)
- Modify: `src/extension/editor-provider.ts` (imports; restore on `webviewReady`; `floatingChatSaveUIState`)
- Rewrite: `src/webview/hooks/useFloatingChat.ts`
- Rewrite: `src/webview/canvas/FloatingChat.tsx`
- Modify: `src/webview/App.tsx`
- Modify: `src/webview/canvas/palette.ts` (delete the `CHAT_*_RGB` block)

All six change together: the saved-state messages change their fields, and the hook, the layout and App read them. Typecheck, build, all tests, a quick manual check, then one commit.

- [ ] **Step 1: New saved-state messages**

In `src/shared/types.ts`, replace:

```ts
/** Host → Webview: restore chat state from workspaceState on canvas open */
export interface MsgFloatingChatHistoryRestored {
  type: 'floatingChatHistoryRestored';
  history:   ChatItem[];
  collapsed?: boolean;
  pos?:       { x: number; y: number };
  size?:      { w: number; h: number };
  inputW?:    number;
}

/** Webview → Host: persist floating chat panel UI state (pos/size/collapsed) */
export interface MsgFloatingChatSaveUIState {
  type:      'floatingChatSaveUIState';
  collapsed: boolean;
  pos:       { x: number; y: number };
  size:      { w: number; h: number };
  inputW?:   number;
}
```

with:

```ts
// - host → webview: this canvas's chat history and console state, on open
export interface MsgFloatingChatHistoryRestored {
  type:    'floatingChatHistoryRestored';
  history: ChatItem[];
  // - null: nothing saved; the console uses its default width
  width:   number | null;
  folded:  boolean;
}

// - webview → host: save the console's width and folded state for this canvas
export interface MsgFloatingChatSaveUIState {
  type:   'floatingChatSaveUIState';
  width:  number;
  folded: boolean;
}
```

- [ ] **Step 2: The host saves and restores `{ width, folded }`**

In `src/extension/editor-provider.ts`, after `import { EFFORT_LEVELS } from '../shared/aiEffort';` add:

```ts
import { migrateChatUI, type ChatUIState } from '../shared/chatUIState';
```

Replace:

```ts
            const savedUI      = this.context.workspaceState.get<{ collapsed?: boolean; pos?: { x: number; y: number }; size?: { w: number; h: number }; inputW?: number }>(uiKey);
            send({
              type:      'floatingChatHistoryRestored',
              history:   savedHistory as ChatItem[],
              collapsed: true,              // - always start collapsed; user opens explicitly
              pos:       savedUI?.pos,
              size:      savedUI?.size,
              inputW:    savedUI?.inputW,
            } satisfies MsgFloatingChatHistoryRestored);
```

with:

```ts
            // - canvases saved before the docked console hold { collapsed, pos, size, inputW }
            const savedUI      = migrateChatUI(this.context.workspaceState.get<unknown>(uiKey));
            send({
              type:    'floatingChatHistoryRestored',
              history: savedHistory as ChatItem[],
              width:   savedUI.width,
              folded:  savedUI.folded,
            } satisfies MsgFloatingChatHistoryRestored);
```

Replace:

```ts
        case 'floatingChatSaveUIState': {
          const uiKey = `skena.chatUI.${document.uri.toString()}`;
          void this.context.workspaceState.update(uiKey, {
            collapsed: (msg as MsgFloatingChatSaveUIState).collapsed,
            pos:       (msg as MsgFloatingChatSaveUIState).pos,
            size:      (msg as MsgFloatingChatSaveUIState).size,
            inputW:    (msg as MsgFloatingChatSaveUIState).inputW,
          });
          break;
        }
```

with:

```ts
        case 'floatingChatSaveUIState': {
          const uiKey = `skena.chatUI.${document.uri.toString()}`;
          const ui: ChatUIState = { width: (msg as MsgFloatingChatSaveUIState).width, folded: (msg as MsgFloatingChatSaveUIState).folded };
          void this.context.workspaceState.update(uiKey, ui);
          break;
        }
```

- [ ] **Step 3: Rewrite the hook**

Replace the whole content of `src/webview/hooks/useFloatingChat.ts` with:

```ts
// - state and host messages for the docked chat console. History, width and folded state persist
// - per canvas through the host's workspaceState.
import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatItem, ChatToolEvent, ChatTokenUsage, ViewportSnapshot } from '../../shared/types';
import { ChatAttachment, mergeAttachments, removeAttachment as withoutAttachment } from '../../shared/chatAttachments';
import { applyToolEvent, flushPendingText, migrateHistory } from '../canvas/chat/chatTimeline';
import { NODE_ADDED_PREFIX } from '../canvas/chat/chatTurns';
import { DEFAULT_CONSOLE_WIDTH } from '../canvas/chat/consoleLayout';

export interface RestoredChat {
  history: unknown[];
  width:   number | null;
  folded:  boolean;
}

export function useFloatingChat(postMessage: (msg: unknown) => void) {
  const [width,       setWidthState]       = useState(DEFAULT_CONSOLE_WIDTH);
  const [folded,      setFolded]           = useState(false);
  const [history,     setHistory]          = useState<ChatItem[]>([]);
  const [streaming,   setStreaming]        = useState('');
  // - waiting for the first token or tool event of a reply
  const [thinking,    setThinking]         = useState(false);
  // - a turn is running: from send until done, error or reset
  const [working,     setWorking]          = useState(false);
  const [error,       setError]            = useState<string | null>(null);
  const [usage,       setUsage]            = useState<ChatTokenUsage | null>(null);
  const [attachments, setAttachmentsState] = useState<ChatAttachment[]>([]);

  // - refs mirror state so handlers build the next state without nested setState updaters
  const historyRef     = useRef<ChatItem[]>([]);
  const streamingRef   = useRef('');
  const widthRef       = useRef(DEFAULT_CONSOLE_WIDTH);
  const foldedRef      = useRef(false);
  const attachmentsRef = useRef<ChatAttachment[]>([]);

  const persistHistory = useCallback((h: ChatItem[]) => {
    postMessage({ type: 'floatingChatPersistHistory', history: h });
  }, [postMessage]);

  const saveUIState = useCallback(() => {
    postMessage({ type: 'floatingChatSaveUIState', width: widthRef.current, folded: foldedRef.current });
  }, [postMessage]);

  // - runs on every mousemove of an edge drag; the caller saves once on mouseup
  const setWidth = useCallback((w: number) => {
    widthRef.current = w;
    setWidthState(w);
  }, []);

  const toggleFolded = useCallback(() => {
    foldedRef.current = !foldedRef.current;
    setFolded(foldedRef.current);
    saveUIState();
  }, [saveUIState]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // - key or code: some layouts send a dead key for Alt+`
      if (e.altKey && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        e.stopPropagation();
        toggleFolded();
      }
    };
    // - capture phase: Monaco stops keydown propagation while it has focus
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [toggleFolded]);

  const setAttachments = useCallback((next: ChatAttachment[]) => {
    attachmentsRef.current = next;
    setAttachmentsState(next);
  }, []);

  const addAttachments = useCallback((add: ChatAttachment[]) => {
    setAttachments(mergeAttachments(attachmentsRef.current, add));
  }, [setAttachments]);

  const removeAttachment = useCallback((key: string) => {
    setAttachments(withoutAttachment(attachmentsRef.current, key));
  }, [setAttachments]);

  const appendDelta = useCallback((delta: string) => {
    setThinking(false);
    streamingRef.current += delta;
    setStreaming(s => s + delta);
  }, []);

  const applyTool = useCallback((e: ChatToolEvent) => {
    setThinking(false);
    const r = applyToolEvent(historyRef.current, streamingRef.current, e, new Date().toISOString());
    streamingRef.current = r.pending;
    setStreaming(r.pending);
    historyRef.current = r.items;
    setHistory(r.items);
    // - no persist mid-turn: a running card would restore as spinning forever; completeDelta persists
  }, []);

  const applyUsage = useCallback((u: ChatTokenUsage) => setUsage(u), []);

  const completeDelta = useCallback((cost?: { costUsd?: number; deltaUsd?: number }) => {
    const flushed = flushPendingText(historyRef.current, streamingRef.current, new Date().toISOString(), cost);
    streamingRef.current = '';
    setStreaming('');
    setThinking(false);
    setWorking(false);
    setUsage(null);
    // - a card still running at the end of the turn was cut off by Stop
    const closed = flushed.map(it => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error' as const } : it));
    historyRef.current = closed;
    setHistory(closed);
    persistHistory(closed);
  }, [persistHistory]);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setThinking(false);
    setWorking(false);
    streamingRef.current = '';
    setStreaming('');
    setUsage(null);
  }, []);

  // - Reset: the host cleared its copy and the claude process
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    streamingRef.current = '';
    setHistory([]);
    setStreaming('');
    setThinking(false);
    setWorking(false);
    setError(null);
    setUsage(null);
  }, []);

  const sendMessage = useCallback((text: string, activeNodeId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: ChatItem = { kind: 'text', role: 'user', content: trimmed, timestamp: new Date().toISOString() };
    const next = [...historyRef.current, userMsg];
    historyRef.current = next;
    setHistory(next);
    // - what the user sees now: zoom, on-screen nodes, the focused node's visible text
    const viewport = (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport?.();
    postMessage({ type: 'floatingChatSend', message: trimmed, activeNodeId, history: next, viewport, attachments: attachmentsRef.current });
    setAttachments([]);
    setError(null);
    streamingRef.current = '';
    setStreaming('');
    setThinking(true);
    setWorking(true);
  }, [postMessage, setAttachments]);

  const restoreHistory = useCallback((payload: RestoredChat) => {
    const migrated = migrateHistory(payload.history);
    historyRef.current = migrated;
    setHistory(migrated);
    foldedRef.current = payload.folded;
    setFolded(payload.folded);
    if (payload.width !== null) {
      widthRef.current = payload.width;
      setWidthState(payload.width);
    }
  }, []);

  const addNodeAdded = useCallback((note: string) => {
    const next: ChatItem[] = [...historyRef.current, {
      kind:      'text',
      role:      'assistant',
      content:   `${NODE_ADDED_PREFIX}\n\n${note}`,
      timestamp: new Date().toISOString(),
    }];
    historyRef.current = next;
    setHistory(next);
    persistHistory(next);
  }, [persistHistory]);

  return {
    width, folded, history, streaming, thinking, working, error, usage, attachments,
    setWidth, saveUIState, toggleFolded,
    addAttachments, removeAttachment,
    sendMessage,
    appendDelta, completeDelta, handleError, addNodeAdded,
    applyTool, applyUsage,
    restoreHistory, clearHistory,
  };
}
```

- [ ] **Step 4: Rewrite `FloatingChat.tsx` as the docked layout**

Replace the whole content of `src/webview/canvas/FloatingChat.tsx` with:

```tsx
// - the chat console, docked at the bottom centre: the conversation panel above the input bar
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChatAttachment } from '../../shared/chatAttachments';
import { ChatToolEvent, ChatTokenUsage } from '../../shared/types';
import { useFloatingChat, type RestoredChat } from '../hooks/useFloatingChat';
import { ConversationPanel } from './chat/ConversationPanel';
import { InputBar } from './chat/InputBar';
import type { ChatInputHandle } from './chat/ChatInput';
import { clampConsoleWidth, dragWidth } from './chat/consoleLayout';

interface Props {
  activeNodeId: string | null;
  model?:       string;
  effort?:      string;
  provider?:    string;
  sessionName?: string;
  postMessage:  (msg: unknown) => void;

  onDelta:           (handler: (delta: string) => void) => () => void;
  onDone:            (handler: (usage: { costUsd?: number; deltaUsd?: number }) => void) => () => void;
  onError:           (handler: (msg: string) => void) => () => void;
  onResetDone:       (handler: () => void) => () => void;
  onNodeAdded:       (handler: (note: string) => void) => () => void;
  onHistoryRestored: (handler: (payload: RestoredChat) => void) => () => void;
  onToolEvent?:      (cb: (e: ChatToolEvent) => void) => () => void;
  onUsage?:          (cb: (u: ChatTokenUsage) => void) => () => void;
}

export function FloatingChat({
  activeNodeId, model, effort, provider, sessionName, postMessage,
  onDelta, onDone, onError, onResetDone, onNodeAdded, onHistoryRestored, onToolEvent, onUsage,
}: Props): JSX.Element {
  const chat      = useFloatingChat(postMessage);
  const inputRef  = useRef<ChatInputHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [compacting, setCompacting] = useState(false);
  const [viewportW,  setViewportW]  = useState(() => window.innerWidth);

  // - read at send time, so a send never uses a stale focused node
  const activeNodeIdRef = useRef(activeNodeId);
  activeNodeIdRef.current = activeNodeId;

  useEffect(() => onDelta(chat.appendDelta),               [onDelta, chat.appendDelta]);
  useEffect(() => onDone(chat.completeDelta),              [onDone, chat.completeDelta]);
  useEffect(() => onError(chat.handleError),               [onError, chat.handleError]);
  useEffect(() => onResetDone(chat.clearHistory),          [onResetDone, chat.clearHistory]);
  useEffect(() => onNodeAdded(chat.addNodeAdded),          [onNodeAdded, chat.addNodeAdded]);
  useEffect(() => onHistoryRestored(chat.restoreHistory),  [onHistoryRestored, chat.restoreHistory]);
  useEffect(() => onToolEvent?.(chat.applyTool),           [onToolEvent, chat.applyTool]);
  useEffect(() => onUsage?.(chat.applyUsage),              [onUsage, chat.applyUsage]);

  useEffect(() => {
    const on = (e: Event) => setCompacting((e as CustomEvent<boolean>).detail);
    window.addEventListener('skena:compacting', on);
    return () => window.removeEventListener('skena:compacting', on);
  }, []);

  useEffect(() => {
    const on = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const { addAttachments } = chat;
  useEffect(() => {
    const on = (e: Event) => {
      const files = (e as CustomEvent<{ path: string; name: string }[]>).detail ?? [];
      addAttachments(files.map((f): ChatAttachment => ({ kind: 'file', path: f.path, name: f.name })));
    };
    window.addEventListener('skena:chatFilesPicked', on);
    return () => window.removeEventListener('skena:chatFilesPicked', on);
  }, [addAttachments]);

  const width = clampConsoleWidth(chat.width, viewportW);

  const onEdgeDown = (edge: 'left' | 'right') => (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (me: MouseEvent) => chat.setWidth(clampConsoleWidth(dragWidth(startW, me.clientX - startX, edge), window.innerWidth));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      chat.saveUIState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const { sendMessage } = chat;
  const send = useCallback((text: string) => sendMessage(text, activeNodeIdRef.current), [sendMessage]);

  // - keys stop here so CanvasView's handlers (Space, hjkl) never see typing. Alt combos must reach the
  // - window, where VS Code's keybinding forwarder listens; skena's own Alt keys are taken in capture phase.
  return (
    <div
      className="cc-root"
      data-skena-chat="1"
      style={{ width }}
      onKeyDown={e => { if (!e.altKey) e.stopPropagation(); }}
      onKeyUp={e => { if (!e.altKey) e.stopPropagation(); }}
    >
      <div className="cc-edge cc-edge-left" title="Drag to change the width" onMouseDown={onEdgeDown('left')} />
      <div className="cc-edge cc-edge-right" title="Drag to change the width" onMouseDown={onEdgeDown('right')} />
      <ConversationPanel
        scrollRef={scrollRef}
        history={chat.history}
        streaming={chat.streaming}
        thinking={chat.thinking}
        working={chat.working}
        error={chat.error}
        compacting={compacting}
        usage={chat.usage}
        folded={chat.folded}
        onToggleFold={chat.toggleFolded}
        onCompact={() => postMessage({ type: 'floatingChatCompact' })}
        onReset={() => postMessage({ type: 'floatingChatReset' })}
        onCopy={text => postMessage({ type: 'writeClipboard', text })}
        onAddNote={text => postMessage({ type: 'floatingChatAddNote', content: text, activeNodeId: activeNodeIdRef.current })}
      />
      <InputBar
        inputRef={inputRef}
        scrollTarget={scrollRef}
        attachments={chat.attachments}
        working={chat.working}
        model={model}
        effort={effort}
        provider={provider}
        sessionName={sessionName}
        onSend={send}
        onStop={() => postMessage({ type: 'floatingChatAbort' })}
        onPickModel={() => postMessage({ type: 'pickModel' })}
        onPickFile={() => postMessage({ type: 'floatingChatPickFiles' })}
        onAttach={chat.addAttachments}
        onRemove={chat.removeAttachment}
        onWarn={text => postMessage({ type: 'showWarning', text })}
      />
    </div>
  );
}
```

- [ ] **Step 5: App passes the new payload, the picked files and the effort**

In `src/webview/App.tsx`, after `import { FloatingChat } from './canvas/FloatingChat';` add:

```ts
import type { RestoredChat } from './hooks/useFloatingChat';
```

Replace:

```ts
  const [chatModel, setChatModel] = useState<{ model: string; provider: string; sessionName?: string } | null>(null);
```

with:

```ts
  const [chatModel, setChatModel] = useState<{ model: string; effort?: string; provider: string; sessionName?: string } | null>(null);
```

Replace:

```ts
  const historyRestoredEvt = useRef(makeEventTarget<{
    history:    unknown[];
    collapsed?: boolean;
    pos?:       { x: number; y: number };
    size?:      { w: number; h: number };
  }>());
```

with:

```ts
  const historyRestoredEvt = useRef(makeEventTarget<RestoredChat>());
```

Replace:

```ts
        case 'floatingChatHistoryRestored':
          historyRestoredEvt.current.emit({
            history:   msg.history,
            collapsed: msg.collapsed,
            pos:       msg.pos,
            size:      msg.size,
          });
          break;
```

with:

```ts
        case 'floatingChatHistoryRestored':
          historyRestoredEvt.current.emit({ history: msg.history, width: msg.width, folded: msg.folded });
          break;
        case 'floatingChatFilesPicked':
          window.dispatchEvent(new CustomEvent('skena:chatFilesPicked', { detail: msg.files }));
          break;
```

Replace:

```ts
          setChatModel({ model: msg.model, provider: msg.provider, sessionName: msg.sessionName });
```

with:

```ts
          setChatModel({ model: msg.model, effort: msg.effort, provider: msg.provider, sessionName: msg.sessionName });
```

Replace:

```tsx
        model={chatModel?.model}
```

with:

```tsx
        model={chatModel?.model}
        effort={chatModel?.effort}
```

Replace the stale comment:

```ts
  // - Unmounting it would reset useFloatingChat to collapsed:false every reload.
```

with:

```ts
  // - Unmounting it would drop the history, width and folded state on every reload.
```

- [ ] **Step 6: Delete the unused chat colours**

In `src/webview/canvas/palette.ts`, delete these five lines (the `// ─── AI chat …` line and the four constants under it):

```ts
// ─── AI chat (FloatingChat message roles + input) ───────────────────────────────
export const CHAT_USER_RGB      = '16, 170, 16';    // - user message accent (green)
export const CHAT_ASSISTANT_RGB = '167, 139, 250';  // - assistant accent (purple, #A78BFA)
export const CHAT_ERROR_RGB     = '248, 113, 113';  // - error text / banner (red, #F87171)
export const CHAT_ACCENT_RGB    = '56, 189, 248';   // - input glyph + focused-panel glow (blue)
```

Then check nothing still uses them:

Run: `grep -rn "CHAT_USER_RGB\|CHAT_ASSISTANT_RGB\|CHAT_ERROR_RGB\|CHAT_ACCENT_RGB" src`
Expected: no output.

- [ ] **Step 7: Nothing of the floating panel is left**

Run: `grep -n "onHeaderMouseDown\|onResizeMouseDown\|onSplitMouseDown\|inputW\|collapsed\|pos\.x" src/webview/canvas/FloatingChat.tsx src/webview/hooks/useFloatingChat.ts src/webview/App.tsx`
Expected: no output.

- [ ] **Step 8: Typecheck**

Run the typecheck command. Expected: nothing.

- [ ] **Step 9: Build**

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 10: All chat tests**

Run each line (one command per test; no shell loop, so it works the same in bash and zsh):

```bash
npx esbuild src/webview/canvas/chat/consoleLayout.ts --bundle --format=esm --outfile=tests/.build/consoleLayout.mjs --log-level=warning && node --test tests/console-layout.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/webview/canvas/chat/chatTurns.ts --bundle --format=esm --outfile=tests/.build/chatTurns.mjs --log-level=warning && node --test tests/chat-turns.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/webview/canvas/chat/turnFold.ts --bundle --format=esm --outfile=tests/.build/turnFold.mjs --log-level=warning && node --test tests/turn-fold.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/shared/chatAttachments.ts --bundle --format=esm --outfile=tests/.build/chatAttachments.mjs --log-level=warning && node --test tests/chat-attachments.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/shared/chatUIState.ts --bundle --format=esm --outfile=tests/.build/chatUIState.mjs --log-level=warning && node --test tests/chat-ui-state.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/shared/aiEffort.ts --bundle --format=esm --outfile=tests/.build/aiEffort.mjs --log-level=warning && node --test tests/ai-effort.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/extension/llm-adapters/userContent.ts --bundle --format=esm --outfile=tests/.build/userContent.mjs --log-level=warning && node --test tests/user-content.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/webview/canvas/chat/chatTimeline.ts --bundle --format=esm --outfile=tests/.build/chatTimeline.mjs --log-level=warning && node --test tests/chat-timeline.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/webview/canvas/chat/toolCardView.ts --bundle --format=esm --outfile=tests/.build/toolCardView.mjs --log-level=warning && node --test tests/tool-card-view.mjs 2>&1 | grep -E "^# (pass|fail)"
npx esbuild src/extension/chat-attachments.ts --bundle --platform=node --format=esm --outfile=tests/.build/chatAttachmentsHost.mjs --log-level=warning && node --test tests/chat-attachments-host.mjs 2>&1 | grep -E "^# (pass|fail)"
```

Expected, in order: pass 7, 10, 6, 10, 6, 2, 2, 11, 7, 6; every `# fail 0`.

- [ ] **Step 11: Quick manual check**

Ctrl+F5, open `test/H3.canvas`. The input bar sits at the bottom centre, one line high, with `+`, "Ask the agent", the model button and the send button. Type `hi`, Ctrl+Enter. The panel appears above the bar with `› hi` and the reply. No error in the webview developer tools console (Help → Toggle Developer Tools, then the webview's frame).

- [ ] **Step 12: Commit**

```bash
git add src/shared/types.ts src/extension/editor-provider.ts src/webview/hooks/useFloatingChat.ts src/webview/canvas/FloatingChat.tsx src/webview/App.tsx src/webview/canvas/palette.ts
git commit -m "feat(chat): docked chat console — conversation panel over an always-visible input bar"
```

---

### Task 19: Manual check list for the user

**Files:** none.

Run with Ctrl+F5 (the "Run Extension" launch config builds first and opens `test/`). Open `test/H3.canvas`. Set `skena.ai.provider` to `harness` for items 1–17, then `anthropic` for item 18. Tick each item or note what differs.

- [ ] **1. Placement.** The console is centred at the bottom. The conversation panel is inset on both sides, so the input bar is wider. The canvas shows through both, blurred.
- [ ] **2. Saved state from before.** If H3 was opened with the old floating panel, it opens without an error, at the old panel's width, folded if the old panel was collapsed.
- [ ] **3. Width.** Drag the left edge, then the right edge: the console widens and narrows around the centre and never passes the window edges. Close and reopen H3: the width is kept.
- [ ] **4. Input height.** Type 10 lines (vim `o`): the bar grows one line at a time up to 8 lines (160 px), then the input scrolls. Send and the bar goes back to one line.
- [ ] **5. Keys that must not change.** Alt+I moves focus from the canvas to the input and back. Alt+L in the input moves to the right VS Code group. In vim normal mode Shift+J/K scroll the conversation. Ctrl+Enter sends. `yy` in the input then `p` in a text node pastes the line; a yank in a text node then `p` in the input pastes it.
- [ ] **6. Turns.** Send a first prompt, then a second. The first turn folds to `› first prompt · HH:MM`. The latest turn is open. Click the folded line: it opens; click its `›` line: it folds. The header reads "Latest turn · working" during the reply, then "Latest turn · HH:MM".
- [ ] **7. Streaming and Stop.** During a reply the text streams with the green caret, a spinner shows in the bar, and the send button is Stop. Stop frees the input; the process keeps the session.
- [ ] **8. Steps.** Tool steps are one line: ✓ in teal when done, ● in amber while running, ✗ in red on error. A click shows the input and the result preview. Thinking shows as `∴ thinking ▸`.
- [ ] **9. Turn actions.** Under a finished answer: ⧉ copies the answer (paste it somewhere to check); "＋ canvas" adds a text node with the answer right of the focused node, with an edge from the focused node.
- [ ] **10. Fold.** The ▾ arrow and Alt+` fold the conversation to its header line; the input bar stays. Close and reopen H3: folded or open is kept.
- [ ] **11. Picked nodes.** Pick N8 and E7 with Space. `+` shows "Nodes picked with Space · 2 picked". Choose it: chips N8 and E7 appear at the start of the input; × removes one. Send "what did I attach?": the answer names the attached nodes' content.
- [ ] **12. Workspace file.** `+` → "File from the workspace…" opens VS Code's file picker at the workspace. Pick a `.py` file: a chip with its name appears. Send "summarise the attached file": the agent reads it (a Read step shows or the answer quotes it).
- [ ] **13. Clipboard image.** Copy a screenshot to the clipboard. `+` → "Image from the clipboard". Either a chip "image 1" appears at once, or the menu says "Press Ctrl+V to attach the image" and Ctrl+V adds the chip. Send "what is in this image?": the answer describes the screenshot. If no chip appears after Ctrl+V, write down which step failed: the image entry does not work in the webview and needs another way in.
- [ ] **14. Compact, Reset, notices.** ⤵ asks for confirmation, then shows the compacting notice until it finishes. ⟲ asks, then clears the conversation. An error (for example a stopped CLI) shows in red at the end of the panel.
- [ ] **15. History per canvas.** Close H3 and reopen it: the turns are back, earlier ones folded, the latest open. Open H4: its own history shows.
- [ ] **16. Focus never lands behind the console.** Navigate with hjkl to a node near the bottom of the view: the view pans so the node sits above the console.
- [ ] **17. Model and effort.** Click the model button: the model QuickPick opens, then the effort QuickPick (low … max, default). Pick `high`: the button reads `<model> high ▾`. The next reply comes from the new session (the "Skena AI (harness)" output channel logs a spawn).
- [ ] **18. Other provider.** With `skena.ai.provider` = `anthropic`, `+` shows no image entry. Attach a node and a file and send: the answer uses their text.

---

## Self-review against the spec

| Spec item | Task |
|---|---|
| Docked bottom centre, not dragged or freely resized | 12 (`.cc-root`), 18 (layout) |
| Width by dragging either side edge, saved per canvas via `floatingChatSaveUIState` | 1 (`dragWidth`, `clampConsoleWidth`), 18 |
| Panel inset 18 px each side; input bar wider | 12 (`.cc-out { margin: 0 18px }`) |
| Panel grows to 60 % of the view height, then scrolls | 12 (`max-height: 60vh`), 17 |
| Colours, blur, borders, corners, accent, done/running colours, fonts, shadow | 12 (values copied from the mock's CSS) |
| Input bar always visible, including when folded | 17 (only the body hides), 18 |
| Monaco with vim, clipboard relay, Ctrl+Enter | 11, 15 |
| One line high, grows to 8 lines (160 px), then scrolls | 1 (`inputHeight`), 15 |
| `+` menu: Space-picked nodes with count, workspace file via VS Code's picker, clipboard image | 10, 14, 16, 9 (`showOpenDialog`) |
| Chips at the start of the input, with a remove control | 4 (`chipLabel`, `removeAttachment`), 16 |
| Model and effort picker replaces the header label, opens the same picker | 6, 9, 16 |
| Spinner while working; send becomes Stop (same soft abort) | 16, 18 (`working`) |
| Header "Latest turn · time" and a fold arrow; Alt+` folds; saved per canvas | 17, 18, 5 |
| Earlier turns fold to `› prompt · time`; click opens; latest open; a new prompt folds the previous | 2, 3, 13, 17 |
| Prompt as one mono line with `›` in the accent colour, no bubble | 12 (`.cc-user`), 13 |
| Tool steps and thinking as compact one-line entries | 13 |
| Answer as rendered markdown | 13 (`AnswerText`, same host/ReactMarkdown split as before) |
| Two actions: copy, add to the canvas as a note connected to the focused node | 13, 9 (`floatingChatAddNote` → `addNoteToCanvas`) |
| Unchanged: Alt+I, Alt+L, Shift+H/J/K/L, pin-to-latest, streaming, compacting notice, history per canvas | 15, 17, 18 |
| Removed: side-by-side input column, draggable/resizable panel, collapsed bar, header label | 18 |
| Open point: images through stream-json | Settled above (FACT); 7, 8, 14; checked in 19 item 13 |
| Open point: how attachments reach the agent | Settled above; 4, 8 |
| Old `pos` / `size` / `collapsed` / `inputW` open cleanly | 5, 18 |

Changes the spec did not ask for, each listed under "Decisions for the user": the effort step (1), the caps (2), where Compact/Reset/tokens/session name/cost go (3), result preview on click (4), last reply as the answer (5), conversation open by default (6).

Behaviour notes:
- Alt+I no longer opens or folds the conversation; the input is always visible, so Alt+I only moves focus.
- The input never takes focus when the canvas opens; before, the host forced the chat collapsed so it could not.
- The `working` flag is new: the spinner and Stop stay up while a tool runs between replies. Before, Stop showed only while waiting for the first token or while text streamed.
