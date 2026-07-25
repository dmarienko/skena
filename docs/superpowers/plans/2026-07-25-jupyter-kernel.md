# Jupyter Kernel Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run code on live Jupyter kernels from the canvas — a `code` node holds editable Python, a `kernel` node is a live-status widget, and running a cell writes rich output into a connected `cell` output node; both the user (button/hotkey) and the AI agent (`canvas_run_cell`) can run.

**Architecture:** The extension host owns a thin Jupyter client (REST `GET /api/kernels` status poll + WS `execute_request`, from the passed spike). The webview never touches the network. Pure message-framing / config / binding logic lives in small unit-tested modules; the host `KernelManager` orchestrates polling + runs; new `KernelNode`/`CodeNode` React components render the widgets; the agent path runs the same client inside the MCP process and writes the output node to the `.canvas` file.

**Tech Stack:** TypeScript, React 18 + React Flow v12 (`@xyflow/react`), Monaco, esbuild (3 bundles: extension CJS, webview IIFE, `mcp-server.js` CJS), `ws` (WebSocket), Node built-in `fetch`. Tests: `node --test` on esbuild-bundled `.mjs` (see `test/typst-delim.mjs` for the convention).

**Branch:** `feature/jupyter-kernel`

---

## File Structure

**New (host):**
- `src/extension/jupyter/protocol.ts` — pure Jupyter v5.3 message framing: `buildExecuteRequest`, `parseReply`, `collectOutputs`. Unit-tested.
- `src/extension/jupyter/config.ts` — pure: `parseEnvFile`, `resolveKernelConfig` (`~/.aix/xlmcp/.env` fallback). Unit-tested.
- `src/extension/jupyter/client.ts` — network wrapper: `listKernels`, `startKernel`, `executeCell` (uses `ws` + `fetch` + protocol). Smoke-tested.
- `src/extension/jupyter/manager.ts` — host orchestration: status poll → `kernelStatus`; `runCell` → execute + output node + `runStatus`.

**New (webview):**
- `src/webview/canvas/nodes/KernelNode.tsx` — circular status widget.
- `src/webview/canvas/nodes/CodeNode.tsx` — Monaco code + ▶ Run.
- `src/webview/canvas/kernelBinding.ts` — pure: `resolveBoundKernel`. Unit-tested.

**Modified:**
- `src/shared/types.ts` — `KernelNode`/`CodeNode` types, unions, new messages.
- `src/webview/canvas/palette.ts` — `KERNEL_PALETTE`, `kernelColor`, `nextKernelColorIndex`, `DEFAULT_NODE_BORDER_BY_TYPE` entries.
- `src/webview/canvas/CanvasView.tsx` — register `kernel`/`code` in `NODE_TYPES`; `Shift+Enter` run; running-edge animation.
- `src/extension/editor-provider.ts` — handle `runCell`/`addKernel`; own the `KernelManager`; push `kernelStatus`/`runStatus`; poll lifecycle.
- `src/extension/mcp/server.ts` — `canvas_run_cell` tool.
- `src/extension/llm-adapters/harness.ts` — inject `SKENA_JUPYTER_KERNELS` env into the MCP config.
- `src/extension/commands/index.ts` (or existing command registration) — "Skena: Add kernel" command + QuickPick.
- `package.json` — `ws`/`@types/ws` deps; `skena.jupyter.kernels` setting; command + keybinding contributions.

**Test convention (memorise):** a pure module `src/**/foo.ts` is tested by `test/foo.mjs`:
```
npx esbuild src/path/foo.ts --bundle --format=esm --outfile=test/.build/foo.mjs && node --test test/foo.mjs
```
`test/.build/` is gitignored (verify: `git check-ignore test/.build/x` — if not ignored, add `test/.build/` to `.gitignore` as step 1 of Task 1). The test imports from `./.build/foo.mjs`.

---

## Task 1: Jupyter protocol message framing (pure)

**Files:**
- Create: `src/extension/jupyter/protocol.ts`
- Test: `test/jupyter-protocol.mjs`

- [ ] **Step 1: Ensure test build dir is ignored**

Run: `cd ~/devs/skena && git check-ignore test/.build/x || echo 'test/.build/' >> .gitignore`
Expected: either prints the path (already ignored) or appends the rule.

- [ ] **Step 2: Write the failing test**

Create `test/jupyter-protocol.mjs`:

```js
// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-protocol.mjs && node --test test/jupyter-protocol.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildExecuteRequest, parseReply, collectOutputs } from './.build/jupyter-protocol.mjs';

const IDS = { msgId: 'm1', session: 's1', date: '2026-07-25T00:00:00Z' };

test('buildExecuteRequest sets v5.3 header and code content', () => {
  const r = buildExecuteRequest('print(1)', IDS);
  assert.equal(r.channel, 'shell');
  assert.equal(r.header.msg_type, 'execute_request');
  assert.equal(r.header.version, '5.3');
  assert.equal(r.header.msg_id, 'm1');
  assert.equal(r.header.session, 's1');
  assert.equal(r.content.code, 'print(1)');
  assert.equal(r.content.silent, false);
  assert.equal(r.content.allow_stdin, false);
  assert.deepEqual(r.parent_header, {});
});

test('parseReply extracts parent msg id and stream kind', () => {
  const p = parseReply({
    channel: 'iopub', parent_header: { msg_id: 'm1' },
    header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'hi' },
  });
  assert.equal(p.parentMsgId, 'm1');
  assert.equal(p.kind, 'stream');
  assert.equal(p.text, 'hi');
});

test('collectOutputs accumulates stream then rich image, ends on idle', () => {
  const seq = [
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'busy' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'a' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'b' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'display_data' }, content: { data: { 'image/png': 'BASE64PNG' } } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'idle' } },
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.streamText, 'ab');
  assert.equal(out.done, true);
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.rich, [{ mime: 'image/png', data: 'BASE64PNG' }]);
});

test('collectOutputs marks error status on error reply', () => {
  const seq = [
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'error' }, content: { ename: 'ValueError', evalue: 'bad', traceback: ['x'] } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'idle' } },
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.status, 'error');
  assert.match(out.error, /ValueError: bad/);
});

test('collectOutputs ignores replies for other msg ids', () => {
  const seq = [
    { channel: 'iopub', parent_header: { msg_id: 'other' }, header: { msg_type: 'stream' }, content: { name: 'stdout', text: 'ZZZ' } },
    { channel: 'iopub', parent_header: { msg_id: 'm1' }, header: { msg_type: 'status' }, content: { execution_state: 'idle' } },
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.streamText, '');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/devs/skena && npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-protocol.mjs 2>&1 | head`
Expected: FAIL — esbuild error "Could not resolve … protocol.ts" (file does not exist yet).

- [ ] **Step 4: Write minimal implementation**

Create `src/extension/jupyter/protocol.ts`:

```ts
export interface ExecuteIds {
  msgId:   string;
  session: string;
  date:    string;
}

export interface ExecuteRequest {
  header:        { msg_id: string; session: string; username: string; msg_type: 'execute_request'; version: '5.3'; date: string };
  parent_header: Record<string, never>;
  metadata:      Record<string, never>;
  content:       { code: string; silent: boolean; store_history: boolean; user_expressions: Record<string, never>; allow_stdin: boolean; stop_on_error: boolean };
  channel:       'shell';
}

export type ReplyKind = 'stream' | 'result' | 'display' | 'error' | 'status' | 'other';

export interface ParsedReply {
  parentMsgId:    string | null;
  kind:           ReplyKind;
  text?:          string;
  data?:          Record<string, unknown>;
  executionState?: string;
  error?:         string;
}

export interface CollectedOutput {
  streamText: string;
  rich:       { mime: string; data: string }[];
  status:     'ok' | 'error' | 'running';
  error?:     string;
  done:       boolean;
}

export function buildExecuteRequest(code: string, ids: ExecuteIds): ExecuteRequest {
  return {
    header: {
      msg_id:   ids.msgId,
      session:  ids.session,
      username: 'skena',
      msg_type: 'execute_request',
      version:  '5.3',
      date:     ids.date,
    },
    parent_header: {},
    metadata:      {},
    content: {
      code,
      silent:           false,
      store_history:    true,
      user_expressions: {},
      allow_stdin:      false,
      stop_on_error:    true,
    },
    channel: 'shell',
  };
}

export function parseReply(raw: unknown): ParsedReply {
  const m = raw as Record<string, any>;
  const parentMsgId = m?.parent_header?.msg_id ?? null;
  const type = m?.header?.msg_type as string | undefined;
  const content = (m?.content ?? {}) as Record<string, any>;
  switch (type) {
    case 'stream':
      return { parentMsgId, kind: 'stream', text: String(content.text ?? '') };
    case 'execute_result':
      return { parentMsgId, kind: 'result', data: content.data ?? {} };
    case 'display_data':
      return { parentMsgId, kind: 'display', data: content.data ?? {} };
    case 'error':
      return { parentMsgId, kind: 'error', error: `${content.ename}: ${content.evalue}` };
    case 'status':
      return { parentMsgId, kind: 'status', executionState: content.execution_state };
    default:
      return { parentMsgId, kind: 'other' };
  }
}

// - preference order when picking a single rich mime from a data bundle
const RICH_MIMES = ['image/png', 'image/jpeg', 'text/html', 'application/json', 'text/plain'];

function pickRich(data: Record<string, unknown>): { mime: string; data: string } | null {
  for (const mime of RICH_MIMES) {
    if (data[mime] != null) {
      const v = data[mime];
      return { mime, data: typeof v === 'string' ? v : JSON.stringify(v) };
    }
  }
  return null;
}

export function collectOutputs(replies: unknown[], ourMsgId: string): CollectedOutput {
  let streamText = '';
  const rich: { mime: string; data: string }[] = [];
  let status: 'ok' | 'error' | 'running' = 'running';
  let error: string | undefined;
  let done = false;

  for (const raw of replies) {
    const p = parseReply(raw);
    if (p.parentMsgId !== ourMsgId) continue;
    if (p.kind === 'stream' && p.text) streamText += p.text;
    else if ((p.kind === 'result' || p.kind === 'display') && p.data) {
      const r = pickRich(p.data);
      if (r) rich.push(r);
    } else if (p.kind === 'error') {
      status = 'error';
      error = p.error;
    } else if (p.kind === 'status' && p.executionState === 'idle') {
      done = true;
      if (status !== 'error') status = 'ok';
    }
  }
  return { streamText, rich, status, error, done };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/devs/skena && npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-protocol.mjs && node --test test/jupyter-protocol.mjs`
Expected: PASS — 5 tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
cd ~/devs/skena && git add src/extension/jupyter/protocol.ts test/jupyter-protocol.mjs .gitignore
git commit -m "feat(jupyter): v5.3 execute-request framing + reply collection"
```

---

## Task 2: Kernel config resolution with .env fallback (pure)

**Files:**
- Create: `src/extension/jupyter/config.ts`
- Test: `test/jupyter-config.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/jupyter-config.mjs`:

```js
// - run: npx esbuild src/extension/jupyter/config.ts --bundle --format=esm --outfile=test/.build/jupyter-config.mjs && node --test test/jupyter-config.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseEnvFile, resolveKernelConfig } from './.build/jupyter-config.mjs';

test('parseEnvFile reads KEY=VALUE, skips comments and blanks', () => {
  const env = parseEnvFile('# comment\nJUPYTER_SERVER_URL=https://h/user/q\n\nJUPYTER_API_TOKEN=tok123\n');
  assert.equal(env.JUPYTER_SERVER_URL, 'https://h/user/q');
  assert.equal(env.JUPYTER_API_TOKEN, 'tok123');
});

test('parseEnvFile strips surrounding quotes and inline whitespace', () => {
  const env = parseEnvFile('JUPYTER_API_TOKEN = "abc" \n');
  assert.equal(env.JUPYTER_API_TOKEN, 'abc');
});

test('resolveKernelConfig prefers the setting when present', () => {
  const out = resolveKernelConfig([{ name: 'a', hubUrl: 'u', token: 't' }], 'JUPYTER_SERVER_URL=x\nJUPYTER_API_TOKEN=y');
  assert.deepEqual(out, [{ name: 'a', hubUrl: 'u', token: 't' }]);
});

test('resolveKernelConfig falls back to env text as a default server', () => {
  const out = resolveKernelConfig(undefined, 'JUPYTER_SERVER_URL=https://h/user/q\nJUPYTER_API_TOKEN=tok');
  assert.deepEqual(out, [{ name: 'default', hubUrl: 'https://h/user/q', token: 'tok' }]);
});

test('resolveKernelConfig returns [] when neither setting nor env present', () => {
  assert.deepEqual(resolveKernelConfig(undefined, null), []);
  assert.deepEqual(resolveKernelConfig([], null), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/devs/skena && npx esbuild src/extension/jupyter/config.ts --bundle --format=esm --outfile=test/.build/jupyter-config.mjs 2>&1 | head`
Expected: FAIL — "Could not resolve … config.ts".

- [ ] **Step 3: Write minimal implementation**

Create `src/extension/jupyter/config.ts`:

```ts
export interface KernelServerConfig {
  name:   string;
  hubUrl: string;
  token:  string;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function resolveKernelConfig(
  setting: KernelServerConfig[] | undefined,
  envText: string | null,
): KernelServerConfig[] {
  if (setting && setting.length) return setting;
  if (envText) {
    const env = parseEnvFile(envText);
    const hubUrl = env.JUPYTER_SERVER_URL;
    const token = env.JUPYTER_API_TOKEN;
    if (hubUrl && token) return [{ name: 'default', hubUrl, token }];
  }
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/devs/skena && npx esbuild src/extension/jupyter/config.ts --bundle --format=esm --outfile=test/.build/jupyter-config.mjs && node --test test/jupyter-config.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/devs/skena && git add src/extension/jupyter/config.ts test/jupyter-config.mjs
git commit -m "feat(jupyter): kernel server config resolution with xlmcp .env fallback"
```

---

## Task 3: Kernel binding resolver (pure)

**Files:**
- Create: `src/webview/canvas/kernelBinding.ts`
- Test: `test/kernel-binding.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/kernel-binding.mjs`:

```js
// - run: npx esbuild src/webview/canvas/kernelBinding.ts --bundle --format=esm --outfile=test/.build/kernel-binding.mjs && node --test test/kernel-binding.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveBoundKernel } from './.build/kernel-binding.mjs';

const isKernel = (id) => id.startsWith('k');

test('finds kernel on an edge from the code node', () => {
  const edges = [{ fromNode: 'c1', toNode: 'k1' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), 'k1');
});

test('finds kernel on an edge into the code node (either direction)', () => {
  const edges = [{ fromNode: 'k2', toNode: 'c1' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), 'k2');
});

test('returns null when no adjacent kernel', () => {
  const edges = [{ fromNode: 'c1', toNode: 'c2' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), null);
});

test('ignores edges not touching the code node', () => {
  const edges = [{ fromNode: 'c9', toNode: 'k1' }];
  assert.equal(resolveBoundKernel('c1', edges, isKernel), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/devs/skena && npx esbuild src/webview/canvas/kernelBinding.ts --bundle --format=esm --outfile=test/.build/kernel-binding.mjs 2>&1 | head`
Expected: FAIL — "Could not resolve … kernelBinding.ts".

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/canvas/kernelBinding.ts`:

```ts
export interface EdgeLike {
  fromNode: string;
  toNode:   string;
}

// - returns the id of the kernel node adjacent to `codeNodeId` (either edge direction),
// - or null when the cell is unbound. First match wins.
export function resolveBoundKernel(
  codeNodeId: string,
  edges: EdgeLike[],
  isKernel: (nodeId: string) => boolean,
): string | null {
  for (const e of edges) {
    if (e.fromNode === codeNodeId && isKernel(e.toNode)) return e.toNode;
    if (e.toNode === codeNodeId && isKernel(e.fromNode)) return e.fromNode;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/devs/skena && npx esbuild src/webview/canvas/kernelBinding.ts --bundle --format=esm --outfile=test/.build/kernel-binding.mjs && node --test test/kernel-binding.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/devs/skena && git add src/webview/canvas/kernelBinding.ts test/kernel-binding.mjs
git commit -m "feat(canvas): resolve a code cell's bound kernel from edges"
```

---

## Task 4: Kernel palette colors (pure)

**Files:**
- Modify: `src/webview/canvas/palette.ts`
- Test: `test/kernel-palette.mjs`

- [ ] **Step 1: Read the current palette file**

Run: `cd ~/devs/skena && sed -n '1,80p' src/webview/canvas/palette.ts`
Expected: shows `DEFAULT_NODE_BORDER_BY_TYPE` and existing exports. Note whether `code`/`kernel` keys exist (they do not yet).

- [ ] **Step 2: Write the failing test**

Create `test/kernel-palette.mjs`:

```js
// - run: npx esbuild src/webview/canvas/palette.ts --bundle --format=esm --outfile=test/.build/palette.mjs && node --test test/kernel-palette.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KERNEL_PALETTE, kernelColor, nextKernelColorIndex, DEFAULT_NODE_BORDER_BY_TYPE } from './.build/palette.mjs';

test('KERNEL_PALETTE has distinct non-empty colors', () => {
  assert.ok(KERNEL_PALETTE.length >= 4);
  assert.equal(new Set(KERNEL_PALETTE).size, KERNEL_PALETTE.length);
});

test('kernelColor cycles by index', () => {
  assert.equal(kernelColor(0), KERNEL_PALETTE[0]);
  assert.equal(kernelColor(KERNEL_PALETTE.length), KERNEL_PALETTE[0]);
});

test('nextKernelColorIndex wraps on existing count', () => {
  assert.equal(nextKernelColorIndex(0), 0);
  assert.equal(nextKernelColorIndex(KERNEL_PALETTE.length), 0);
});

test('default borders defined for code and kernel', () => {
  assert.ok(DEFAULT_NODE_BORDER_BY_TYPE.code);
  assert.ok(DEFAULT_NODE_BORDER_BY_TYPE.kernel);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/devs/skena && npx esbuild src/webview/canvas/palette.ts --bundle --format=esm --outfile=test/.build/palette.mjs && node --test test/kernel-palette.mjs 2>&1 | tail`
Expected: FAIL — `KERNEL_PALETTE` undefined / `DEFAULT_NODE_BORDER_BY_TYPE.code` undefined.

- [ ] **Step 4: Add the exports**

Append to `src/webview/canvas/palette.ts` (and add `code`/`kernel` keys to the existing `DEFAULT_NODE_BORDER_BY_TYPE` object — match its existing style):

```ts
// - per-kernel accent colors, cycled by creation order (see KernelNode / manager)
export const KERNEL_PALETTE: string[] = [
  '#4cc8a0', // - teal
  '#d9a23f', // - amber
  '#7aa2f7', // - blue
  '#e5707a', // - red
  '#bb9af7', // - violet
  '#9ece6a', // - green
];

export function kernelColor(colorIndex: number): string {
  return KERNEL_PALETTE[((colorIndex % KERNEL_PALETTE.length) + KERNEL_PALETTE.length) % KERNEL_PALETTE.length];
}

export function nextKernelColorIndex(existingKernelCount: number): number {
  return existingKernelCount % KERNEL_PALETTE.length;
}
```

In the existing `DEFAULT_NODE_BORDER_BY_TYPE` map add:
```ts
  code:   '#9ece6a',
  kernel: '#4cc8a0',
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/devs/skena && npx esbuild src/webview/canvas/palette.ts --bundle --format=esm --outfile=test/.build/palette.mjs && node --test test/kernel-palette.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
cd ~/devs/skena && git add src/webview/canvas/palette.ts test/kernel-palette.mjs
git commit -m "feat(canvas): kernel color palette + code/kernel default borders"
```

---

## Task 5: Shared types — nodes and messages

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Read the surrounding declarations**

Run: `cd ~/devs/skena && grep -n "SkenaNodeType\|export type CanvasNode =\|WebviewToHost\|HostToWebview\|MsgPickModel\|export type.*Message" src/shared/types.ts | head -40`
Expected: locates the `SkenaNodeType` union, the `CanvasNode` union, and the two message unions.

- [ ] **Step 2: Add node interfaces + extend `SkenaNodeType`**

Change `SkenaNodeType`:
```ts
export type SkenaNodeType = 'cell' | 'chat' | 'portal' | 'kernel' | 'code';
```

Add after the `CellNode` interface:
```ts
/** Live Jupyter kernel — circular status widget; drag its ring to bind a code cell */
export interface KernelNode extends CanvasNodeBase {
  type: 'kernel';
  /** - matches a skena.jupyter.kernels[].name (the server it lives on) */
  server: string;
  /** - live Jupyter kernel id once started/bound; absent = not yet connected */
  kernelId?: string;
  /** - e.g. "python3"; shown in the title */
  displayName?: string;
  /** - index into KERNEL_PALETTE, assigned at creation */
  colorIndex?: number;
}

/** Editable code cell — runs on a bound kernel node, output goes to a linked cell node */
export interface CodeNode extends CanvasNodeBase {
  type: 'code';
  code: string;
  /** - default 'python' */
  language?: string;
  /** - id of the linked output CellNode, once the first run created it */
  outputNodeId?: string;
  /** - ms timestamp of last execution start */
  lastRun?: number;
  lastStatus?: 'ok' | 'error' | 'running';
}
```

- [ ] **Step 3: Extend the `CanvasNode` union**

Add `| KernelNode | CodeNode` to the `export type CanvasNode =` union.

- [ ] **Step 4: Add message types**

Add to the Webview→Host union (find the union that contains `MsgPickModel` / `pickModel`) two new members and their interfaces:
```ts
export interface MsgRunCell   { type: 'runCell'; cellNodeId: string; code: string }
export interface MsgAddKernel { type: 'addKernel' }
```
Add `| MsgRunCell | MsgAddKernel` to the Webview→Host union.

Add to the Host→Webview union:
```ts
export interface KernelStatusEntry { server: string; kernelId: string; state: 'idle' | 'busy' | 'dead' | 'error'; connections?: number }
export interface MsgKernelStatus { type: 'kernelStatus'; kernels: KernelStatusEntry[] }
export interface MsgRunStatus    { type: 'runStatus'; cellNodeId: string; kernelNodeId: string | null; state: 'running' | 'ok' | 'error'; error?: string }
```
Add `| MsgKernelStatus | MsgRunStatus` to the Host→Webview union.

- [ ] **Step 5: Typecheck**

Run: `cd ~/devs/skena && npm run typecheck 2>&1 | grep -v "editor-provider.ts.*fsPath" | grep "error TS" | head`
Expected: no NEW errors (the 3 pre-existing `editor-provider.ts` `fsPath` errors are the only ones allowed). Empty output = good.

- [ ] **Step 6: Commit**

```bash
cd ~/devs/skena && git add src/shared/types.ts
git commit -m "feat(types): KernelNode, CodeNode, run + kernel-status messages"
```

---

## Task 6: KernelNode component

**Files:**
- Create: `src/webview/canvas/nodes/KernelNode.tsx`
- Modify: `src/webview/canvas/CanvasView.tsx` (register in `NODE_TYPES`)

- [ ] **Step 1: Read a reference node + the registry**

Run: `cd ~/devs/skena && sed -n '40,75p' src/webview/canvas/CanvasView.tsx && grep -n "kernelStatus\|useState\|CustomEvent('skena:kernelStatus'" src/webview/App.tsx | head`
Expected: shows `NODE_TYPES` map + how App routes host messages. Kernel status arrives as a host message; the component reads it from a small event/context. Use a window CustomEvent `skena:kernelStatus` dispatched by App (added in Task 8) and read via a `useSyncExternalStore`-free `useState`+listener, mirroring how other transient host state reaches nodes.

- [ ] **Step 2: Implement the component**

Create `src/webview/canvas/nodes/KernelNode.tsx`:

```tsx
/**
 * KernelNode — circular live-status widget for a Jupyter kernel.
 * Inner circle is the status LED (idle green / busy blink / dead grey / error red).
 * The ring between the circles is the drag-to-connect zone (React Flow source handle).
 */

import React, { useEffect, useState, memo } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { KernelNode } from '../../../shared/types';
import type { KernelStatusEntry } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE } from './nodeShared';
import { kernelColor } from '../palette';

type LedState = KernelStatusEntry['state'];

function useKernelState(server: string, kernelId?: string): LedState {
  const [state, setState] = useState<LedState>('dead');
  useEffect(() => {
    const onStatus = (e: Event) => {
      const kernels = (e as CustomEvent).detail as KernelStatusEntry[];
      const hit = kernels.find(k => k.server === server && (kernelId ? k.kernelId === kernelId : true));
      setState(hit ? hit.state : 'dead');
    };
    window.addEventListener('skena:kernelStatus', onStatus);
    return () => window.removeEventListener('skena:kernelStatus', onStatus);
  }, [server, kernelId]);
  return state;
}

const LED_COLOR: Record<LedState, string> = {
  idle:  '#3fbf6f',
  busy:  '#3fbf6f',
  dead:  '#6b7280',
  error: '#e5484d',
};

function KernelNodeInner({ data }: NodeProps): JSX.Element {
  const node = data as unknown as KernelNode;
  const accent = kernelColor(node.colorIndex ?? 0);
  const state = useKernelState(node.server, node.kernelId);
  const led = LED_COLOR[state];
  const title = `${node.displayName ?? 'kernel'} :: ${node.kernelId ? node.kernelId.slice(0, 10) : '—'}`;

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', justifyContent: 'center', gap: 8 }}>
        <div style={{ color: accent, fontSize: 12, fontFamily: 'var(--vscode-editor-font-family)', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ position: 'relative', width: 72, height: 72 }}>
          {/* - outer ring (accent) */}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${accent}` }} />
          {/* - inner status LED */}
          <div
            className={state === 'busy' ? 'skena-kernel-busy' : undefined}
            style={{
              position: 'absolute', inset: 22, borderRadius: '50%',
              background: led,
              boxShadow: state === 'error' ? `0 0 6px ${led}` : 'none',
            }}
          />
        </div>
      </div>
      {/* - ring = drag-to-connect: source handles on all sides, output typically downward */}
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    </>
  );
}

export const KernelNodeComponent = memo(KernelNodeInner);
```

- [ ] **Step 3: Add the busy-blink CSS**

Append to `src/webview/styles/canvas.css`:
```css
@keyframes skena-kernel-blink { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }
.skena-kernel-busy { animation: skena-kernel-blink 0.9s ease-in-out infinite; }
```

- [ ] **Step 4: Register in `NODE_TYPES`**

In `src/webview/canvas/CanvasView.tsx`, import `KernelNodeComponent` and add to the `NODE_TYPES` object:
```ts
  kernel: KernelNodeComponent,
```

- [ ] **Step 5: Build + typecheck**

Run: `cd ~/devs/skena && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | grep "error TS" | grep -v fsPath | head`
Expected: build succeeds ("done"/no errors); typecheck shows only the 3 pre-existing fsPath errors (filtered out → empty).

- [ ] **Step 6: Manual smoke (documented, no automated UI test — matches CellNode/TextNode)**

In a scratch `.canvas`, add a node `{ "type":"kernel", "server":"default", "displayName":"python3", "colorIndex":0, "x":0,"y":0,"width":140,"height":160 }`, open in the Extension Development Host, confirm the circular widget renders with a grey LED (no status yet) and a teal ring. (Real status arrives after Task 8.)

- [ ] **Step 7: Commit**

```bash
cd ~/devs/skena && git add src/webview/canvas/nodes/KernelNode.tsx src/webview/canvas/CanvasView.tsx src/webview/styles/canvas.css
git commit -m "feat(canvas): KernelNode circular status widget"
```

---

## Task 7: CodeNode component

**Files:**
- Create: `src/webview/canvas/nodes/CodeNode.tsx`
- Modify: `src/webview/canvas/CanvasView.tsx` (register in `NODE_TYPES`)

- [ ] **Step 1: Read the TextNode editor setup to reuse Monaco wiring**

Run: `cd ~/devs/skena && grep -n "Editor\|beforeMount\|onMount\|monaco\|language\|value=\|onChange" src/webview/canvas/nodes/TextNode.tsx | head -30`
Expected: shows the `@monaco-editor/react` usage, theme `beforeMount`, and vim wiring. Reuse the same editor import + theme; set `language="python"`; wire an `onChange` that dispatches a `skena:nodeTextEdit`-style content update (find the exact event/prop TextNode uses to persist edits and reuse it for `code`).

- [ ] **Step 2: Implement the component**

Create `src/webview/canvas/nodes/CodeNode.tsx`:

```tsx
/**
 * CodeNode — editable code cell that runs on a bound kernel node.
 * Header has a Run button + status glyph; body is a Monaco editor.
 * Run is disabled until the cell is connected to a kernel node (see kernelBinding).
 */

import React, { useCallback, useEffect, useState, memo } from 'react';
import { NodeProps, Handle, Position, NodeResizer, useStore } from '@xyflow/react';
import Editor from '@monaco-editor/react';
import { CodeNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';
import { resolveBoundKernel } from '../kernelBinding';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

function CodeNodeInner({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CodeNode & { accentColor?: string };
  const bw = useZoomInvariantBorderWidth(1.5);
  const selectedStyle = useSelectedStyle(selected);
  const borderColor = node.accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE.code;
  const [code, setCode] = useState(node.code ?? '');

  // - is this cell bound to a kernel? read live edges + node types from the RF store
  const bound = useStore(s => {
    const edges = s.edges.map(e => ({ fromNode: e.source, toNode: e.target }));
    const kernelIds = new Set(s.nodes.filter(n => (n.data as any)?.type === 'kernel' || n.type === 'kernel').map(n => n.id));
    return resolveBoundKernel(id, edges, nid => kernelIds.has(nid));
  });

  const run = useCallback(() => {
    if (!bound) return;
    vscodePostMessage({ type: 'runCell', cellNodeId: id, code });
  }, [bound, id, code]);

  // - Shift+Enter runs when the editor is focused inside this node
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.shiftKey && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(); }
  }, [run]);

  const status = node.lastStatus;
  const glyph = status === 'running' ? '◗' : status === 'ok' ? '✓' : status === 'error' ? '✗' : '';

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
      <div
        className="skena-node skena-node--code"
        onKeyDown={onKeyDown}
        style={{ border: `${bw}px solid ${borderColor}`, height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', background: 'var(--vscode-editorWidget-background)', ...selectedStyle }}
      >
        <NodeResizer minWidth={160} minHeight={90} isVisible={selected}
          onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
            detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
          }))}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', fontSize: 12, borderBottom: `1px solid ${borderColor}` }}>
          <button
            onClick={e => { e.stopPropagation(); run(); }}
            disabled={!bound}
            title={bound ? 'Run on bound kernel (Shift+Enter)' : 'Connect this cell to a kernel node to run'}
            style={{ cursor: bound ? 'pointer' : 'not-allowed', background: 'transparent', border: 'none', color: bound ? borderColor : '#6b7280', fontSize: 13 }}
          >▶</button>
          <span style={{ opacity: 0.7 }}>{node.language ?? 'python'}</span>
          <span style={{ marginLeft: 'auto', color: status === 'error' ? '#e5484d' : borderColor }}>{glyph}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            language="python"
            theme="skena-editor"
            value={code}
            onChange={v => {
              const next = v ?? '';
              setCode(next);
              window.dispatchEvent(new CustomEvent('skena:nodeCodeEdit', { detail: { id, code: next } }));
            }}
            options={{ minimap: { enabled: false }, lineNumbers: 'off', fontFamily: 'var(--vscode-editor-font-family)', fontSize: 12, scrollBeyondLastLine: false, folding: false, glyphMargin: false }}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}

export const CodeNodeComponent = memo(CodeNodeInner);
```

- [ ] **Step 3: Persist code edits + status in CanvasView**

In `src/webview/canvas/CanvasView.tsx`: (a) import `CodeNodeComponent`, add `code: CodeNodeComponent` to `NODE_TYPES`. (b) Add a `skena:nodeCodeEdit` window listener mirroring the existing `skena:nodeTextEdit` handler (find it: `grep -n "skena:nodeTextEdit" src/webview/canvas/CanvasView.tsx`) — it should write `code` back into the node's data and mark the canvas dirty, using the same update path. (c) Add a `skena:runStatusApply` handler wired in Task 9.

- [ ] **Step 4: Build + typecheck**

Run: `cd ~/devs/skena && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | grep "error TS" | grep -v fsPath | head`
Expected: build succeeds; no new TS errors.

- [ ] **Step 5: Manual smoke**

Add a `{ "type":"code","code":"print('hi')","x":0,"y":0,"width":320,"height":180 }` node; confirm Monaco renders Python, the ▶ button is disabled (grey) with the "connect to a kernel" tooltip, and editing persists on save.

- [ ] **Step 6: Commit**

```bash
cd ~/devs/skena && git add src/webview/canvas/nodes/CodeNode.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat(canvas): CodeNode editable cell with Run gated on kernel binding"
```

---

## Task 8: Jupyter client + host KernelManager (status poll)

**Files:**
- Create: `src/extension/jupyter/client.ts`
- Create: `src/extension/jupyter/manager.ts`
- Modify: `src/extension/editor-provider.ts`
- Modify: `src/webview/App.tsx`
- Modify: `package.json` (add `ws` + `@types/ws`)

- [ ] **Step 1: Add the ws dependency**

Run: `cd ~/devs/skena && npm install ws@^8 && npm install -D @types/ws`
Expected: installs; `node -e "require('ws')"` exits 0.

- [ ] **Step 2: Implement the client**

Create `src/extension/jupyter/client.ts`:

```ts
import WebSocket from 'ws';
import { buildExecuteRequest, collectOutputs, type CollectedOutput } from './protocol';
import type { KernelServerConfig } from './config';

export interface LiveKernel {
  id:    string;
  name:  string;
  state: 'idle' | 'busy' | 'starting' | 'dead';
  connections?: number;
}

function restBase(hubUrl: string): string {
  return hubUrl.replace(/\/+$/, '');
}

function wsBase(hubUrl: string): string {
  return restBase(hubUrl).replace(/^http/, 'ws');
}

export async function listKernels(server: KernelServerConfig): Promise<LiveKernel[]> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels`, {
    headers: { Authorization: `token ${server.token}` },
  });
  if (!res.ok) throw new Error(`GET /api/kernels ${res.status}`);
  const arr = (await res.json()) as any[];
  return arr.map(k => ({ id: k.id, name: k.name, state: k.execution_state, connections: k.connections }));
}

export async function startKernel(server: KernelServerConfig, name = 'python3'): Promise<LiveKernel> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels`, {
    method: 'POST',
    headers: { Authorization: `token ${server.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`POST /api/kernels ${res.status}`);
  const k = (await res.json()) as any;
  return { id: k.id, name: k.name, state: k.execution_state ?? 'starting' };
}

// - open a WS, run one cell, resolve with the collected output. onDelta fires as replies stream.
export async function executeCell(
  server:  KernelServerConfig,
  kernelId: string,
  code:    string,
  ids:     { msgId: string; session: string; date: string },
  onDelta?: (partial: CollectedOutput) => void,
): Promise<CollectedOutput> {
  const url = `${wsBase(server.hubUrl)}/api/kernels/${kernelId}/channels?token=${encodeURIComponent(server.token)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `token ${server.token}` } });
  const replies: unknown[] = [];

  return new Promise<CollectedOutput>((resolve, reject) => {
    const finish = (out: CollectedOutput) => { try { ws.close(); } catch { /* noop */ } resolve(out); };
    ws.on('open', () => ws.send(JSON.stringify(buildExecuteRequest(code, ids))));
    ws.on('message', raw => {
      try {
        replies.push(JSON.parse(raw.toString()));
        const out = collectOutputs(replies, ids.msgId);
        onDelta?.(out);
        if (out.done) finish(out);
      } catch { /* - ignore non-JSON frames */ }
    });
    ws.on('error', err => reject(err));
    ws.on('close', () => resolve(collectOutputs(replies, ids.msgId)));
  });
}
```

- [ ] **Step 3: Implement the manager**

Create `src/extension/jupyter/manager.ts`:

```ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveKernelConfig, type KernelServerConfig } from './config';
import { listKernels, startKernel, executeCell, type LiveKernel } from './client';
import type { CollectedOutput } from './protocol';
import type { KernelStatusEntry } from '../../shared/types';

// - reads skena.jupyter.kernels, falling back to ~/.aix/xlmcp/.env
export function loadKernelServers(): KernelServerConfig[] {
  const setting = vscode.workspace.getConfiguration('skena').get<KernelServerConfig[]>('jupyter.kernels');
  let envText: string | null = null;
  try { envText = fs.readFileSync(path.join(os.homedir(), '.aix', 'xlmcp', '.env'), 'utf8'); } catch { /* - no env */ }
  return resolveKernelConfig(setting, envText);
}

export class KernelManager {
  private servers: KernelServerConfig[] = loadKernelServers();
  private timer:   ReturnType<typeof setInterval> | null = null;
  // - kernel ids currently running a cell, so the LED blinks the right kernel
  private running = new Set<string>();

  constructor(private readonly push: (kernels: KernelStatusEntry[]) => void) {}

  reloadConfig(): void { this.servers = loadKernelServers(); }

  serverByName(name: string): KernelServerConfig | undefined {
    return this.servers.find(s => s.name === name);
  }

  allServers(): KernelServerConfig[] { return this.servers; }

  startPolling(): void {
    if (this.timer) return;
    const tick = () => void this.poll();
    tick();
    this.timer = setInterval(tick, 2000);
  }

  stopPolling(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async poll(): Promise<void> {
    const entries: KernelStatusEntry[] = [];
    for (const s of this.servers) {
      try {
        const kernels = await listKernels(s);
        for (const k of kernels) entries.push({ server: s.name, kernelId: k.id, state: this.ledFor(k), connections: k.connections });
      } catch { /* - server unreachable: report nothing for it (nodes go grey) */ }
    }
    this.push(entries);
  }

  private ledFor(k: LiveKernel): KernelStatusEntry['state'] {
    if (k.state === 'dead') return 'dead';
    if (this.running.has(k.id) || k.state === 'busy') return 'busy';
    return 'idle';
  }

  async ensureKernel(server: KernelServerConfig, kernelId?: string): Promise<string> {
    if (kernelId) return kernelId;
    const k = await startKernel(server);
    return k.id;
  }

  async run(
    server: KernelServerConfig,
    kernelId: string,
    code: string,
    ids: { msgId: string; session: string; date: string },
    onDelta?: (o: CollectedOutput) => void,
  ): Promise<CollectedOutput> {
    this.running.add(kernelId);
    void this.poll();
    try {
      return await executeCell(server, kernelId, code, ids, onDelta);
    } finally {
      this.running.delete(kernelId);
      void this.poll();
    }
  }
}
```

- [ ] **Step 4: Own the manager in editor-provider + push status to the webview**

In `src/extension/editor-provider.ts`:
- import `KernelManager` and construct one per open panel (near where `resolver` is set up), wiring `push` to `send({ type: 'kernelStatus', kernels })`.
- call `manager.startPolling()` after `webviewReady`; `manager.stopPolling()` in the panel dispose handler.
- refresh on config change: in the existing `onDidChangeConfiguration` listener, add `if (e.affectsConfiguration('skena.jupyter.kernels')) manager.reloadConfig();`.

Add the message case (placeholder for now; run wired in Task 9):
```ts
        case 'runCell': { await this.handleRunCell(msg, manager, panel, document, canvasDir); break; }
        case 'addKernel': { await this.handleAddKernel(manager, canvasDir, send); break; }
```

- [ ] **Step 5: Route kernelStatus in App.tsx**

In `src/webview/App.tsx`, in the host-message switch, add:
```ts
        case 'kernelStatus':
          window.dispatchEvent(new CustomEvent('skena:kernelStatus', { detail: msg.kernels }));
          break;
```

- [ ] **Step 6: Build + typecheck**

Run: `cd ~/devs/skena && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | grep "error TS" | grep -v fsPath | head`
Expected: build succeeds; only pre-existing fsPath errors. (Handlers `handleRunCell`/`handleAddKernel` are added in Tasks 9/10 — for this task stub them as `private async handleRunCell(){}` / `handleAddKernel(){}` returning void so it compiles, OR order Task 9/10 before this step's case additions. Implementer: add minimal stubs now, fill in next tasks.)

- [ ] **Step 7: Manual smoke**

With `~/.aix/xlmcp/.env` present, open a canvas containing a `kernel` node whose `server:"default"` and set its `kernelId` to a real id from `curl -H "Authorization: token $TOK" $URL/api/kernels`. Confirm within ~2s the LED turns green (idle) or blinks (busy). Kill the kernel → LED goes grey.

- [ ] **Step 8: Commit**

```bash
cd ~/devs/skena && git add src/extension/jupyter/client.ts src/extension/jupyter/manager.ts src/extension/editor-provider.ts src/webview/App.tsx package.json package-lock.json
git commit -m "feat(jupyter): host kernel client + status-poll manager pushed to webview"
```

---

## Task 9: Run orchestration — execute, output node, run status

**Files:**
- Modify: `src/extension/editor-provider.ts` (`handleRunCell`)
- Modify: `src/webview/canvas/CanvasView.tsx` (apply `runStatus` → node state + edge animation)

- [ ] **Step 1: Read canvas-io + pin placement helpers**

Run: `cd ~/devs/skena && grep -n "readCanvas\|writeCanvas\|export function" src/extension/canvas-io.ts | head && grep -n "randomUUID\|uid(" src/extension/mcp/server.ts | head -3`
Expected: shows how the host reads/writes the `.canvas` and generates ids. Reuse `readCanvas`/`writeCanvas` from `canvas-io.ts`; use `crypto.randomUUID()` for ids/session/msgId.

- [ ] **Step 2: Implement handleRunCell**

Replace the `handleRunCell` stub in `src/extension/editor-provider.ts`:

```ts
  private async handleRunCell(
    msg: { cellNodeId: string; code: string },
    manager: KernelManager,
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    canvasDir: string,
  ): Promise<void> {
    const send = (m: HostToWebview) => panel.webview.postMessage(m);
    const canvasPath = document.uri.fsPath;
    const canvas = await readCanvas(canvasPath);
    const cell = canvas.nodes.find(n => n.id === msg.cellNodeId) as any;
    if (!cell || cell.type !== 'code') return;

    // - resolve bound kernel node via edges
    const kernelNode = canvas.nodes.find(n => {
      if ((n as any).type !== 'kernel') return false;
      return canvas.edges.some(e =>
        (e.fromNode === cell.id && e.toNode === n.id) || (e.toNode === cell.id && e.fromNode === n.id));
    }) as any;
    if (!kernelNode) {
      send({ type: 'runStatus', cellNodeId: cell.id, kernelNodeId: null, state: 'error', error: 'no kernel bound' });
      return;
    }

    const server = manager.serverByName(kernelNode.server);
    if (!server) {
      send({ type: 'runStatus', cellNodeId: cell.id, kernelNodeId: kernelNode.id, state: 'error', error: `unknown server ${kernelNode.server}` });
      return;
    }

    send({ type: 'runStatus', cellNodeId: cell.id, kernelNodeId: kernelNode.id, state: 'running' });
    const kernelId = await manager.ensureKernel(server, kernelNode.kernelId);
    if (kernelId !== kernelNode.kernelId) { kernelNode.kernelId = kernelId; }

    const ids = { msgId: randomUUID(), session: randomUUID(), date: new Date().toISOString() };
    const out = await manager.run(server, kernelId, msg.code, ids);

    // - build output content: stream text, then the last rich mime
    const rich = out.rich[out.rich.length - 1];
    let format: 'markdown' | 'image' | 'html' | 'plotly' = 'markdown';
    let content = out.streamText ? '```\n' + out.streamText + '\n```' : '';
    if (rich) {
      if (rich.mime.startsWith('image/')) { format = 'image'; content = `data:${rich.mime};base64,${rich.data}`; }
      else if (rich.mime === 'text/html') { format = 'html'; content = rich.data; }
      else if (rich.mime === 'application/json') { format = 'markdown'; content += '\n\n```json\n' + rich.data + '\n```'; }
      else { format = 'markdown'; content += '\n\n' + rich.data; }
    }
    if (out.error) content += '\n\n```\n' + out.error + '\n```';

    // - ensure single output node at the cell's right edge, replace content on re-run
    let outNode = canvas.nodes.find(n => n.id === cell.outputNodeId) as any;
    if (!outNode) {
      outNode = {
        id: randomUUID(), type: 'cell', format, content,
        x: Math.round(cell.x + cell.width + 60), y: Math.round(cell.y),
        width: 480, height: 320, createdBy: 'ai',
      };
      canvas.nodes.push(outNode);
      canvas.edges.push({ id: `edge-out-${randomUUID()}`, fromNode: cell.id, fromSide: 'right', toNode: outNode.id, toSide: 'left', toEnd: 'arrow' } as any);
      cell.outputNodeId = outNode.id;
    } else {
      outNode.format = format;
      outNode.content = content;
    }
    cell.lastStatus = out.status === 'error' ? 'error' : 'ok';
    cell.lastRun = Date.now();

    await writeCanvas(canvasPath, canvas);
    send({ type: 'runStatus', cellNodeId: cell.id, kernelNodeId: kernelNode.id, state: out.status === 'error' ? 'error' : 'ok', error: out.error });
  }
```

Ensure imports at the top of the file include `import { randomUUID } from 'crypto';` and `readCanvas`/`writeCanvas` from `./canvas-io`.

- [ ] **Step 3: Apply runStatus in the webview (spinner + edge animation)**

In `src/webview/canvas/CanvasView.tsx`, add a host-message/event handler for `runStatus` that:
- sets the code node's `data.lastStatus` to the incoming `state` (drives the CodeNode glyph),
- toggles an `animated: true` flag on the edge between `cellNodeId` and `kernelNodeId` while `state === 'running'`, clearing it otherwise (React Flow renders `animated` edges as a moving dashed line).

Find how App forwards host messages to CanvasView (`grep -n "runStatus\|case '" src/webview/App.tsx`); route `runStatus` via a `skena:runStatus` CustomEvent like `kernelStatus`, and add the listener in CanvasView:

```ts
  useEffect(() => {
    const onRun = (e: Event) => {
      const d = (e as CustomEvent).detail as { cellNodeId: string; kernelNodeId: string | null; state: string };
      setNodes(ns => ns.map(n => n.id === d.cellNodeId ? { ...n, data: { ...n.data, lastStatus: d.state } } : n));
      setEdges(es => es.map(ed => {
        const between = (ed.source === d.cellNodeId && ed.target === d.kernelNodeId) || (ed.target === d.cellNodeId && ed.source === d.kernelNodeId);
        return between ? { ...ed, animated: d.state === 'running' } : ed;
      }));
    };
    window.addEventListener('skena:runStatus', onRun);
    return () => window.removeEventListener('skena:runStatus', onRun);
  }, [setNodes, setEdges]);
```
(Match the actual node/edge state setters used in CanvasView — they may be named differently; adapt to the real ones found via grep.)

Add to `App.tsx` message switch:
```ts
        case 'runStatus':
          window.dispatchEvent(new CustomEvent('skena:runStatus', { detail: msg }));
          break;
```

- [ ] **Step 4: Build + typecheck**

Run: `cd ~/devs/skena && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | grep "error TS" | grep -v fsPath | head`
Expected: build succeeds; only pre-existing fsPath errors.

- [ ] **Step 5: Manual smoke (live kernel required)**

Add a kernel node + code node, draw an edge between them, type `print("hi"); import matplotlib.pyplot as plt; plt.plot([1,2,3])`, press ▶. Expect: edge animates while running; an output `cell` node appears at the right showing the stdout text then the plot image; the cell glyph turns ✓. Run again with different code → same output node content replaced. Run `1/0` → glyph ✗, output shows the traceback.

- [ ] **Step 6: Commit**

```bash
cd ~/devs/skena && git add src/extension/editor-provider.ts src/webview/canvas/CanvasView.tsx src/webview/App.tsx
git commit -m "feat(jupyter): user-run orchestration — execute, output node, run-status + edge animation"
```

---

## Task 10: "Skena: Add kernel" command + QuickPick + config contribution

**Files:**
- Modify: `src/extension/editor-provider.ts` (`handleAddKernel`) or the command registration module
- Modify: `package.json` (command + menu + `skena.jupyter.kernels` setting)

- [ ] **Step 1: Read how existing commands + addNode results are registered**

Run: `cd ~/devs/skena && grep -n "registerCommand\|contributes\|commands\|addNodeResult" src/extension/extension.ts package.json | head -30`
Expected: shows the command contribution pattern + how a new node reaches the canvas (`addNodeResult` message, `MsgAddNodeResult`).

- [ ] **Step 2: Implement handleAddKernel**

Replace the `handleAddKernel` stub in `src/extension/editor-provider.ts`:

```ts
  private async handleAddKernel(
    manager: KernelManager,
    canvasDir: string,
    send: (m: HostToWebview) => void,
  ): Promise<void> {
    const servers = manager.allServers();
    if (!servers.length) {
      void vscode.window.showWarningMessage('Skena: no Jupyter kernels configured (skena.jupyter.kernels or ~/.aix/xlmcp/.env).');
      return;
    }
    type Item = vscode.QuickPickItem & { server: string; kernelId?: string; start?: boolean };
    const items: Item[] = [];
    for (const s of servers) {
      try {
        const kernels = await listKernels(s);
        for (const k of kernels) items.push({ label: `${s.name} · ${k.name}`, description: `${k.state} · ${k.id.slice(0, 8)}`, server: s.name, kernelId: k.id });
      } catch { /* - unreachable server */ }
      items.push({ label: `${s.name} · + start new kernel`, server: s.name, start: true });
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Add a kernel to the canvas' });
    if (!pick) return;

    let kernelId = pick.kernelId;
    let displayName = 'python3';
    if (pick.start) {
      const server = manager.serverByName(pick.server)!;
      const k = await startKernel(server);
      kernelId = k.id; displayName = k.name;
    }

    // - color assigned in the webview from the current kernel-node count; host just seeds it
    const node = {
      id: `kernel-${Date.now().toString(36)}`,
      type: 'kernel', server: pick.server, kernelId, displayName,
      x: 0, y: 0, width: 140, height: 160,
    };
    send({ type: 'addNodeResult', node: node as any, autoEdit: false } as HostToWebview);
  }
```

Import `listKernels`, `startKernel` from `./jupyter/client`. The webview's `addNodeResult` handler places the node at the viewport centre and assigns `colorIndex = nextKernelColorIndex(existing kernel count)` — extend that handler (in CanvasView) to compute `colorIndex` for `type === 'kernel'` nodes lacking one.

- [ ] **Step 3: Register the command + config in package.json**

Add to `contributes.commands`:
```json
{ "command": "skena.addKernel", "title": "Skena: Add Kernel" }
```
Add to `contributes.configuration.properties`:
```json
"skena.jupyter.kernels": {
  "type": "array",
  "default": [],
  "description": "Jupyter servers for kernel nodes. Each: {name, hubUrl, token}. When empty, falls back to ~/.aix/xlmcp/.env.",
  "items": {
    "type": "object",
    "properties": {
      "name":   { "type": "string" },
      "hubUrl": { "type": "string" },
      "token":  { "type": "string" }
    }
  }
}
```
Register `skena.addKernel` in `extension.ts` to post `{ type: 'addKernel' }` to the active canvas panel (mirror an existing command that targets the active panel), which routes into `handleAddKernel`.

- [ ] **Step 4: Build + typecheck**

Run: `cd ~/devs/skena && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | grep "error TS" | grep -v fsPath | head`
Expected: build succeeds; only pre-existing fsPath errors.

- [ ] **Step 5: Manual smoke**

Run "Skena: Add Kernel" from the palette → QuickPick lists live kernels + "start new"; pick one → a kernel node appears at viewport centre with its LED going green within 2s. Add a second → it gets the next palette color.

- [ ] **Step 6: Commit**

```bash
cd ~/devs/skena && git add src/extension/editor-provider.ts src/extension/extension.ts package.json
git commit -m "feat(jupyter): 'Skena: Add Kernel' command + QuickPick + skena.jupyter.kernels config"
```

---

## Task 11: canvas_run_cell MCP tool + env plumbing

**Files:**
- Modify: `src/extension/mcp/server.ts`
- Modify: `src/extension/llm-adapters/harness.ts`

- [ ] **Step 1: Read how MCP tools are declared + how canvasPinOutput writes**

Run: `cd ~/devs/skena && sed -n '793,835p' src/extension/mcp/server.ts && grep -n "assignLabel\|autoPlace\|withFileLock\|findNode\|readCanvas\|writeCanvas" src/extension/mcp/server.ts | head`
Expected: shows the `canvas_pin_output` tool schema + the file-lock/label/place helpers to reuse.

- [ ] **Step 2: Add the tool schema**

In the tool list array (near the `canvas_pin_output` schema, ~line 793), add:
```ts
  {
    name: 'canvas_run_cell',
    description: 'Run a code cell node on a Jupyter kernel and write its output to a linked cell node. Resolves the kernel from kernelRef or the code node\'s bound-kernel edge.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        cellRef:    { type: 'string', description: 'label or id of the code node to run' },
        kernelRef:  { type: 'string', description: 'optional label or id of the kernel node; defaults to the bound one' },
      },
      required: ['canvasPath', 'cellRef'],
    },
  },
```
Add the dispatch case: `case 'canvas_run_cell': text = await canvasRunCell(args); break;`

- [ ] **Step 3: Implement canvasRunCell**

Add to `src/extension/mcp/server.ts` (imports at top: `import { resolveKernelConfig } from '../jupyter/config'; import { executeCell } from '../jupyter/client'; import { randomUUID } from 'crypto';`):

```ts
function loadKernelServersFromEnv(): { name: string; hubUrl: string; token: string }[] {
  const raw = process.env.SKENA_JUPYTER_KERNELS;
  if (raw) { try { return JSON.parse(raw); } catch { /* - fall through */ } }
  return resolveKernelConfig(undefined, null);
}

async function canvasRunCell(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const cell = findNode(d, args.cellRef as string) as any;
    if (!cell || cell.type !== 'code') return `error: ${args.cellRef} is not a code node`;

    const kernelNode = (args.kernelRef ? findNode(d, args.kernelRef as string) : d.nodes.find((n: any) =>
      n.type === 'kernel' && d.edges.some((e: any) =>
        (e.fromNode === cell.id && e.toNode === n.id) || (e.toNode === cell.id && e.fromNode === n.id)))) as any;
    if (!kernelNode || kernelNode.type !== 'kernel') return 'error: no kernel bound to this cell';

    const servers = loadKernelServersFromEnv();
    const server = servers.find(s => s.name === kernelNode.server);
    if (!server) return `error: unknown server ${kernelNode.server}`;
    if (!kernelNode.kernelId) return 'error: kernel node has no live kernelId (open the canvas so Skena starts it)';

    const ids = { msgId: randomUUID(), session: randomUUID(), date: new Date().toISOString() };
    const out = await executeCell(server, kernelNode.kernelId, cell.code, ids);

    const rich = out.rich[out.rich.length - 1];
    let format: 'markdown' | 'image' | 'html' = 'markdown';
    let content = out.streamText ? '```\n' + out.streamText + '\n```' : '';
    if (rich) {
      if (rich.mime.startsWith('image/')) { format = 'image'; content = `data:${rich.mime};base64,${rich.data}`; }
      else if (rich.mime === 'text/html') { format = 'html'; content = rich.data; }
      else { content += '\n\n' + rich.data; }
    }
    if (out.error) content += '\n\n```\n' + out.error + '\n```';

    let outNode = d.nodes.find((n: any) => n.id === cell.outputNodeId) as any;
    if (!outNode) {
      outNode = { id: uid(), type: 'cell', format, content,
        x: Math.round(cell.x + cell.width + 60), y: Math.round(cell.y), width: 480, height: 320, createdBy: 'ai' };
      const labeled = assignLabel(outNode, d.nodes);
      d.nodes.push(labeled);
      d.edges.push({ id: `edge-out-${uid()}`, fromNode: cell.id, fromSide: 'right', toNode: labeled.id, toSide: 'left', toEnd: 'arrow' });
      cell.outputNodeId = labeled.id;
    } else {
      outNode.format = format; outNode.content = content;
    }
    cell.lastStatus = out.status === 'error' ? 'error' : 'ok';
    await writeCanvas(p, d);
    return `ran ${cell.nodeLabel ?? cell.id} on ${kernelNode.server}: ${out.status}${out.error ? ' — ' + out.error : ''}\n${out.streamText.slice(0, 500)}`;
  });
}
```

- [ ] **Step 4: Inject SKENA_JUPYTER_KERNELS into the MCP spawn**

In `src/extension/llm-adapters/harness.ts` `writeMcpConfig`, change the skena server entry to carry the env. The manager exposes the resolved servers; pass them in. Simplest: read them where `writeMcpConfig` runs and add:
```ts
    const kernels = loadKernelServers(); // - import from ../jupyter/manager
    const servers: Record<string, unknown> = {
      skena: { type: 'stdio', command: 'node', args: [mcpJs], env: { SKENA_JUPYTER_KERNELS: JSON.stringify(kernels) } },
    };
```
Import `loadKernelServers` from `../jupyter/manager`.

- [ ] **Step 5: Build + typecheck**

Run: `cd ~/devs/skena && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | grep "error TS" | grep -v fsPath | head`
Expected: build succeeds; only pre-existing fsPath errors. Confirm the mcp bundle built: `ls -la dist/mcp-server.js`.

- [ ] **Step 6: Manual smoke**

In the chat, ask the agent to "run cell N<x> on the kernel". Confirm `canvas_run_cell` executes and an output `cell` node appears/updates (via soft-reload) with the result; the kernel LED blinks during the run.

- [ ] **Step 7: Commit**

```bash
cd ~/devs/skena && git add src/extension/mcp/server.ts src/extension/llm-adapters/harness.ts
git commit -m "feat(mcp): canvas_run_cell — agent runs code cells, output to node"
```

---

## Task 12: Deploy MCP bundle + final verification

**Files:**
- Modify: `.vscode/skena-mcp.js` (redeployed build artifact), version bump in `package.json`

- [ ] **Step 1: Confirm the MCP bundle is deployed where the harness loads it**

Run: `cd ~/devs/skena && grep -n "skena-mcp.js\|copyFile\|writeFileSync.*mcp\|deployMcp" src/extension/*.ts | head`
Expected: shows how `dist/mcp-server.js` gets copied to `.vscode/skena-mcp.js` (on activation). If it's copied on activation, no manual step; otherwise document the copy. Rebuild: `npm run build`.

- [ ] **Step 2: Run the full pure-logic test suite**

Run:
```bash
cd ~/devs/skena && for m in jupyter-protocol jupyter-config kernel-binding kernel-palette; do \
  src=$(case $m in jupyter-*) echo src/extension/jupyter/${m#jupyter-}.ts;; kernel-binding) echo src/webview/canvas/kernelBinding.ts;; kernel-palette) echo src/webview/canvas/palette.ts;; esac); \
  npx esbuild "$src" --bundle --format=esm --outfile=test/.build/$m.mjs && node --test test/$m.mjs || exit 1; done; echo ALL_PASS
```
Expected: ends with `ALL_PASS`.

- [ ] **Step 3: Full typecheck (only pre-existing errors)**

Run: `cd ~/devs/skena && npm run typecheck 2>&1 | grep "error TS"`
Expected: exactly the 3 pre-existing `editor-provider.ts` `fsPath` errors, nothing else.

- [ ] **Step 4: Bump version**

In `package.json`, bump `version` (e.g. `0.7.8` → `0.8.0`).

- [ ] **Step 5: Package the VSIX (verify `ws` ships)**

Run: `cd ~/devs/skena && npm run package 2>&1 | tail -5 && ls -la *.vsix`
Expected: a `.vsix` is produced. (No `.vscodeignore` change needed — `ws` is bundled into `dist/extension.js` and `dist/mcp-server.js` by esbuild; nothing to whitelist.)

- [ ] **Step 6: Commit**

```bash
cd ~/devs/skena && git add package.json .vscode/skena-mcp.js
git commit -m "chore: deploy kernel MCP bundle, bump version"
```

---

## Self-Review

**Spec coverage:**
- Host-owns-client (REST poll + WS execute) → Tasks 8, 9. ✓
- Config `skena.jupyter.kernels` + `.env` fallback → Tasks 2, 10. ✓
- Kernel node (circular, LED idle/busy/dead/error, ring drag-to-connect, color) → Tasks 4, 6. ✓
- Live status poll → Task 8. ✓
- Code node (Monaco + Run, disabled when unbound) → Task 7. ✓
- Manual edge binding resolution → Tasks 3, 7, 9. ✓
- Run triggers: button + Shift+Enter → Task 7; agent `canvas_run_cell` → Task 11. ✓
- Output to single reused `cell` node at right edge, replaced per run → Tasks 9, 11. ✓
- Rich output (stream + final image/html/json/plain) → protocol Task 1, render Tasks 9/11. ✓
- Running edge animation → Task 9. ✓
- `canvas_run_cell` + env plumbing → Task 11. ✓
- "Skena: Add kernel" QuickPick → Task 10. ✓
- v2-deferred items (dependency edges, DAG, staleness, multi-output stacking, precise agent indicators, restart) — intentionally out. ✓

**Placeholder scan:** every code step carries full code; test steps carry full tests; commands are exact. One ordering note flagged inline (Task 8 Step 6): the `handleRunCell`/`handleAddKernel` cases reference handlers implemented in Tasks 9/10 — implementer adds no-op stubs in Task 8 and fills them in later tasks. No TODO/TBD text remains.

**Type consistency:** `CollectedOutput`, `KernelServerConfig`, `LiveKernel`, `KernelStatusEntry`, `ExecuteIds` names are used identically across protocol/client/manager/server. Node field names (`server`, `kernelId`, `displayName`, `colorIndex`, `code`, `outputNodeId`, `lastStatus`) match between `types.ts` (Task 5) and every consumer. Message `type` strings (`runCell`, `addKernel`, `kernelStatus`, `runStatus`) match sender and receiver. `resolveBoundKernel(codeNodeId, edges, isKernel)` signature identical in Tasks 3, 7, 9. ✓
