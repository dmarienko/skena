# Jupyter progress + ipywidgets subset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render live progress bars from cell runs — console `tqdm` (`\r` redraw on stderr) and widget `tqdm` (`tqdm.auto`/`tqdm.notebook` over the ipywidgets comm protocol) — plus a minimal general widget subset (FloatProgress/IntProgress, HTML/Label, HBox/VBox).

**Architecture:** Three layers, bottom-up. **B** (`renderStream`) collapses `\r`/`\n`/`ESC[A` terminal control in stream text (pure fn). **C** parses `comm_*` iopub messages into a widget-model registry and renders the widget subset to HTML (pure fns). **A** wires the already-plumbed `onDelta` into a throttled `runOutput` so B and C animate mid-run; disk is written once at completion. B and C each also improve the *final* output on their own, so they're built first and independently testable; A ties them together.

**Tech Stack:** TypeScript, VS Code extension host, `ws` (Jupyter v5.3 over WebSocket), esbuild. Tests: standalone `.mjs` bundled with esbuild + `node --test` (repo convention; `test/` is gitignored — commit only `src/`).

**Spec:** `docs/superpowers/specs/2026-07-28-jupyter-progress-widgets-design.md`

**Branch:** `feature/jupyter-kernel` (unmerged).

---

## File structure

- `src/extension/jupyter/protocol.ts` (modify) — add `renderStream()` (Layer B); add `comm` case to `ReplyKind`/`parseReply` and a `WidgetModel` map to `CollectedOutput` + `collectOutputs` (Layer C); add the widget-view mime to `RICH_MIMES`.
- `src/extension/jupyter/widgets.ts` (create) — `renderWidget(modelId, widgets)` widget-model → HTML (Layer C).
- `src/extension/jupyter/output.ts` (modify) — use `renderStream` for stream text; call `renderWidget` for widget-view mimes.
- `src/extension/editor-provider.ts` (modify) — `handleRunCell`: throttled `onDelta` live path; `applyAndPersist` accepts a preset output-node id (Layer A).
- `src/shared/types.ts` (modify) — widen `MsgRunOutput.lastStatus` to include `'running'`.
- `src/webview/styles/canvas.css` (modify) — widget bar/label/box styles.
- Test build command (run from repo root), reused per test file:
  `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-protocol.mjs && node --test test/jupyter-protocol.mjs`

---

## Task 1: Layer B — `renderStream` terminal line buffer

**Files:**
- Modify: `src/extension/jupyter/protocol.ts` (add exported `renderStream`)
- Test: `test/jupyter-stream.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/jupyter-stream.mjs`:
```js
// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-stream.mjs && node --test test/jupyter-stream.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderStream } from './.build/jupyter-stream.mjs';

test('carriage return overwrites from column 0', () => {
  assert.equal(renderStream('abc\rX'), 'Xbc');
  assert.equal(renderStream('10%\r 50%\r100%'), '100%');
});

test('newline commits a line', () => {
  assert.equal(renderStream('line1\nline2'), 'line1\nline2');
});

test('tqdm-style redraw collapses to the last frame', () => {
  const s = ' 10%|#         | 1/10\r 50%|#####     | 5/10\r100%|##########| 10/10';
  assert.equal(renderStream(s), '100%|##########| 10/10');
});

test('ESC[A steps the cursor up one row (nested bars)', () => {
  assert.equal(renderStream('bar1\nbar2\x1b[A\rBAR1'), 'BAR1\nbar2');
});

test('plain text passes through unchanged', () => {
  assert.equal(renderStream('hello world'), 'hello world');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-stream.mjs && node --test test/jupyter-stream.mjs`
Expected: FAIL — `renderStream` is not exported.

- [ ] **Step 3: Implement `renderStream`**

Add to `src/extension/jupyter/protocol.ts` (near the other helpers, above `collectOutputs`):
```ts
// - overwrite `line` starting at `col` with `s`, padding with spaces if col is past the end
function overwriteAt(line: string, col: number, s: string): string {
  const padded = col > line.length ? line + ' '.repeat(col - line.length) : line;
  return padded.slice(0, col) + s + padded.slice(col + s.length);
}

// - collapse terminal control in stream text to what a terminal would display: \r rewinds to
// - column 0 (overwrite), \n commits a line, ESC[nA / ESC[nB move the cursor up/down. tqdm's
// - console bar redraws with \r each update; without this every frame is appended.
// - SGR colour escapes (ESC[…m) are left in place for the later ansiToHtml pass and, being
// - zero-width, are treated as occupying columns — fine for the default monochrome bar; a
// - `colour=`d bar can misalign slightly (known limitation).
export function renderStream(text: string): string {
  const lines: string[] = [''];
  let row = 0;
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\x1b' && text[i + 1] === '[') {
      let j = i + 2;
      let num = '';
      while (j < text.length && text[j] >= '0' && text[j] <= '9') { num += text[j]; j++; }
      const cmd = text[j];
      const n = parseInt(num || '1', 10);
      if (cmd === 'A') { row = Math.max(0, row - n); col = 0; i = j; continue; }
      if (cmd === 'B') { row += n; while (lines.length <= row) lines.push(''); col = 0; i = j; continue; }
      // - any other CSI (colour, etc.): copy verbatim, advance the cursor by its length
      const seq = text.slice(i, j + 1);
      lines[row] = overwriteAt(lines[row], col, seq); col += seq.length; i = j; continue;
    }
    if (ch === '\r') { col = 0; continue; }
    if (ch === '\n') { row++; col = 0; while (lines.length <= row) lines.push(''); continue; }
    lines[row] = overwriteAt(lines[row], col, ch); col++;
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-stream.mjs && node --test test/jupyter-stream.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/jupyter/protocol.ts
git commit -m "feat(jupyter): renderStream terminal line buffer for console progress bars"
```

---

## Task 2: Apply `renderStream` to output rendering

**Files:**
- Modify: `src/extension/jupyter/output.ts:77` (stream branch of `renderOutput`)
- Test: `test/jupyter-output.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/jupyter-output.mjs`:
```js
// - run: npx esbuild src/extension/jupyter/output.ts --bundle --format=esm --outfile=test/.build/jupyter-output.mjs && node --test test/jupyter-output.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderOutput } from './.build/jupyter-output.mjs';

test('console tqdm stream collapses to final bar', () => {
  const out = { streamText: '10%\r50%\r100%', rich: [], status: 'ok', done: true, widgets: {} };
  const r = renderOutput(out);
  assert.equal(r.format, 'html');
  assert.ok(r.content.includes('100%'));
  assert.ok(!r.content.includes('10%'), 'earlier frames must be gone');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx esbuild src/extension/jupyter/output.ts --bundle --format=esm --outfile=test/.build/jupyter-output.mjs && node --test test/jupyter-output.mjs`
Expected: FAIL — content still contains `10%` (raw concatenation) or a type error on `widgets`.

- [ ] **Step 3: Implement**

In `src/extension/jupyter/output.ts`, import `renderStream` and use it for the stream line. Change the stream branch:
```ts
// - was: if (out.streamText) parts.push(`<pre class="skena-out-stream">${ansiToHtml(out.streamText)}</pre>`);
if (out.streamText) parts.push(`<pre class="skena-out-stream">${ansiToHtml(renderStream(out.streamText))}</pre>`);
```
Add the import at the top:
```ts
import { renderStream } from './protocol';
```
(Leave the `text/plain` result branch — `<pre>${ansiToHtml(r.data)}</pre>` — unchanged; results are not `\r`-redrawn.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx esbuild src/extension/jupyter/output.ts --bundle --format=esm --outfile=test/.build/jupyter-output.mjs && node --test test/jupyter-output.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extension/jupyter/output.ts
git commit -m "feat(jupyter): render console tqdm stream through the line buffer"
```

---

## Task 3: Layer C — parse comm messages

**Files:**
- Modify: `src/extension/jupyter/protocol.ts` (`ReplyKind`, `ParsedReply`, `parseReply`)
- Test: `test/jupyter-comm.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/jupyter-comm.mjs`:
```js
// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-comm.mjs && node --test test/jupyter-comm.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseReply } from './.build/jupyter-comm.mjs';

test('comm_open carries model name and initial state', () => {
  const p = parseReply({
    parent_header: { msg_id: 'm1' }, header: { msg_type: 'comm_open' },
    content: { comm_id: 'c1', target_name: 'jupyter.widget', data: { state: { _model_name: 'FloatProgressModel', value: 0, max: 10 } } },
  });
  assert.equal(p.kind, 'comm');
  assert.equal(p.comm.id, 'c1');
  assert.equal(p.comm.sub, 'open');
  assert.equal(p.comm.modelName, 'FloatProgressModel');
  assert.equal(p.comm.state.max, 10);
});

test('comm_msg update carries the changed state', () => {
  const p = parseReply({
    parent_header: { msg_id: 'm1' }, header: { msg_type: 'comm_msg' },
    content: { comm_id: 'c1', data: { method: 'update', state: { value: 5 } } },
  });
  assert.equal(p.kind, 'comm');
  assert.equal(p.comm.sub, 'msg');
  assert.equal(p.comm.state.value, 5);
});

test('comm_close is recognised', () => {
  const p = parseReply({
    parent_header: { msg_id: 'm1' }, header: { msg_type: 'comm_close' }, content: { comm_id: 'c1' },
  });
  assert.equal(p.kind, 'comm');
  assert.equal(p.comm.sub, 'close');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-comm.mjs && node --test test/jupyter-comm.mjs`
Expected: FAIL — `p.kind` is `'other'`, `p.comm` undefined.

- [ ] **Step 3: Implement**

In `src/extension/jupyter/protocol.ts`:

Widen `ReplyKind`:
```ts
export type ReplyKind = 'stream' | 'result' | 'display' | 'error' | 'status' | 'comm' | 'other';
```

Add a `comm` field to `ParsedReply`:
```ts
export interface ParsedReply {
  parentMsgId:    string | null;
  kind:           ReplyKind;
  text?:          string;
  data?:          Record<string, unknown>;
  executionState?: string;
  error?:         string;
  comm?:          { id: string; sub: 'open' | 'msg' | 'close'; modelName?: string; state?: Record<string, unknown> };
}
```

Add cases to the `switch` in `parseReply`, before `default`:
```ts
case 'comm_open': {
  const d = (content.data ?? {}) as Record<string, any>;
  const state = (d.state ?? {}) as Record<string, unknown>;
  return { parentMsgId, kind: 'comm', comm: { id: content.comm_id, sub: 'open', modelName: state._model_name as string | undefined, state } };
}
case 'comm_msg': {
  const d = (content.data ?? {}) as Record<string, any>;
  const state = (d.method === 'update' && d.state) ? d.state as Record<string, unknown> : {};
  return { parentMsgId, kind: 'comm', comm: { id: content.comm_id, sub: 'msg', state } };
}
case 'comm_close':
  return { parentMsgId, kind: 'comm', comm: { id: content.comm_id, sub: 'close' } };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-comm.mjs && node --test test/jupyter-comm.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/jupyter/protocol.ts
git commit -m "feat(jupyter): parse comm_open/comm_msg/comm_close ipywidgets frames"
```

---

## Task 4: Layer C — widget-model registry in `collectOutputs`

**Files:**
- Modify: `src/extension/jupyter/protocol.ts` (`CollectedOutput`, `RICH_MIMES`, `collectOutputs`)
- Test: `test/jupyter-widget-registry.mjs`

- [x] **Step 1: Write the failing test**

Create `test/jupyter-widget-registry.mjs`:
```js
// - run: npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-widget-registry.mjs && node --test test/jupyter-widget-registry.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { collectOutputs } from './.build/jupyter-widget-registry.mjs';

const S = (type, content) => ({ parent_header: { msg_id: 'm1' }, header: { msg_type: type }, content });

test('comm_open then comm_msg builds and patches the model', () => {
  const seq = [
    S('comm_open', { comm_id: 'c1', data: { state: { _model_name: 'FloatProgressModel', value: 0, max: 10 } } }),
    S('comm_msg',  { comm_id: 'c1', data: { method: 'update', state: { value: 7 } } }),
    S('status',    { execution_state: 'idle' }),
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.widgets.c1.modelName, 'FloatProgressModel');
  assert.equal(out.widgets.c1.state.value, 7);
  assert.equal(out.widgets.c1.state.max, 10);
});

test('comm frames are kept even without the execute parent (relaxed filter)', () => {
  const orphan = { parent_header: { msg_id: 'OTHER' }, header: { msg_type: 'comm_msg' }, content: { comm_id: 'c1', data: { method: 'update', state: { value: 3 } } } };
  const seq = [
    S('comm_open', { comm_id: 'c1', data: { state: { _model_name: 'IntProgressModel', value: 0, max: 5 } } }),
    orphan,
    S('status', { execution_state: 'idle' }),
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.widgets.c1.state.value, 3);
});

test('widget-view mime is captured as rich output', () => {
  const seq = [
    S('display_data', { data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'c1' }, 'text/plain': 'FloatProgress(value=0.0)' } }),
    S('status', { execution_state: 'idle' }),
  ];
  const out = collectOutputs(seq, 'm1');
  assert.equal(out.rich[0].mime, 'application/vnd.jupyter.widget-view+json');
  assert.ok(out.rich[0].data.includes('c1'));
});
```

- [x] **Step 2: Run the test, verify it fails**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-widget-registry.mjs && node --test test/jupyter-widget-registry.mjs`
Expected: FAIL — `out.widgets` undefined; widget-view mime not preferred.

- [x] **Step 3: Implement**

In `src/extension/jupyter/protocol.ts`:

Add a `WidgetModel` type and extend `CollectedOutput`:
```ts
export interface WidgetModel { modelName: string; state: Record<string, unknown> }

export interface CollectedOutput {
  streamText: string;
  rich:       { mime: string; data: string }[];
  status:     'ok' | 'error' | 'running';
  error?:     string;
  done:       boolean;
  widgets:    Record<string, WidgetModel>;
}
```

Add the widget-view mime to `RICH_MIMES` (right after plotly, so it wins over the `text/plain` fallback tqdm.notebook also emits):
```ts
const RICH_MIMES = ['application/vnd.plotly.v1+json', 'application/vnd.jupyter.widget-view+json', 'image/png', 'image/jpeg', 'text/html', 'application/json', 'text/plain'];
```

Rewrite the `collectOutputs` loop to handle comm frames first (relaxed filter) and to always return `widgets`:
```ts
export function collectOutputs(replies: unknown[], ourMsgId: string): CollectedOutput {
  let streamText = '';
  const rich: { mime: string; data: string }[] = [];
  const widgets: Record<string, WidgetModel> = {};
  let status: 'ok' | 'error' | 'running' = 'running';
  let error: string | undefined;
  let done = false;

  for (const raw of replies) {
    const p = parseReply(raw);
    // - comm frames drive widgets; accept regardless of parent (single WS, single run — some
    // - widget libs don't stamp the execute parent on updates, and filtering would drop the bar)
    if (p.kind === 'comm' && p.comm) {
      const w = p.comm;
      if (w.sub === 'open') widgets[w.id] = { modelName: String(w.modelName ?? ''), state: { ...(w.state ?? {}) } };
      else if (w.sub === 'msg' && widgets[w.id]) Object.assign(widgets[w.id].state, w.state ?? {});
      continue;
    }
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
  return { streamText, rich, status, error, done, widgets };
}
```

- [x] **Step 4: Run the test, verify it passes**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=test/.build/jupyter-widget-registry.mjs && node --test test/jupyter-widget-registry.mjs`
Expected: PASS (3 tests). Also re-run Task 2's test — `renderOutput` now needs `widgets` on its input; the Task 2 test already passes `widgets: {}`.

- [x] **Step 5: Commit**

```bash
git add src/extension/jupyter/protocol.ts
git commit -m "feat(jupyter): widget-model registry + widget-view mime in collectOutputs"
```

---

## Task 5: Layer C — `renderWidget` (widget-model → HTML)

**Files:**
- Create: `src/extension/jupyter/widgets.ts`
- Test: `test/jupyter-widget-render.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/jupyter-widget-render.mjs`:
```js
// - run: npx esbuild src/extension/jupyter/widgets.ts --bundle --format=esm --outfile=test/.build/jupyter-widget-render.mjs && node --test test/jupyter-widget-render.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderWidget } from './.build/jupyter-widget-render.mjs';

test('FloatProgress renders a fill at the right percentage', () => {
  const widgets = { c1: { modelName: 'FloatProgressModel', state: { value: 5, min: 0, max: 10 } } };
  const html = renderWidget('c1', widgets);
  assert.ok(html.includes('width:50.0%'), html);
  assert.ok(html.includes('skena-w-progress'));
});

test('HTML label renders its value', () => {
  const widgets = { c1: { modelName: 'HTMLModel', state: { value: '5/10 [00:03<00:03]' } } };
  assert.ok(renderWidget('c1', widgets).includes('5/10 [00:03<00:03]'));
});

test('HBox resolves IPY_MODEL_ children in order', () => {
  const widgets = {
    box:  { modelName: 'HBoxModel', state: { children: ['IPY_MODEL_bar', 'IPY_MODEL_lbl'] } },
    bar:  { modelName: 'IntProgressModel', state: { value: 2, min: 0, max: 4 } },
    lbl:  { modelName: 'HTMLModel', state: { value: 'half' } },
  };
  const html = renderWidget('box', widgets);
  assert.ok(html.includes('width:50.0%'));
  assert.ok(html.includes('half'));
  assert.ok(html.indexOf('width:50.0%') < html.indexOf('half'), 'children in order');
});

test('unknown model → placeholder, never throws', () => {
  const widgets = { c1: { modelName: 'SliderModel', state: {} } };
  assert.ok(renderWidget('c1', widgets).includes('[unsupported widget: SliderModel]'));
});

test('missing model id → empty string', () => {
  assert.equal(renderWidget('nope', {}), '');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx esbuild src/extension/jupyter/widgets.ts --bundle --format=esm --outfile=test/.build/jupyter-widget-render.mjs && node --test test/jupyter-widget-render.mjs`
Expected: FAIL — `widgets.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/extension/jupyter/widgets.ts`:
```ts
import type { WidgetModel } from './protocol';

// - escape for HTML text nodes (label content can be arbitrary text)
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// - ipywidgets child refs look like "IPY_MODEL_<comm_id>"
function stripRef(ref: string): string {
  return ref.startsWith('IPY_MODEL_') ? ref.slice('IPY_MODEL_'.length) : ref;
}

function barColour(style: string): string {
  switch (style) {
    case 'success': return '#2ea043';
    case 'info':    return '#1f96bd';
    case 'warning': return '#d29922';
    case 'danger':  return '#e5484d';
    default:        return '#4cc8a0';
  }
}

// - render one widget model (by comm id) to a static HTML snapshot. Supports the subset needed
// - for tqdm.notebook: (Float|Int)Progress, HTML/Label, HBox/VBox. Unknown → placeholder.
export function renderWidget(modelId: string, widgets: Record<string, WidgetModel>, depth = 0): string {
  if (depth > 20) return '';
  const w = widgets[modelId];
  if (!w) return '';
  const name = w.modelName || String((w.state as Record<string, unknown>)._model_name ?? '');
  const s = w.state as Record<string, unknown>;

  if (name === 'FloatProgressModel' || name === 'IntProgressModel' || name === 'ProgressModel') {
    const min = num(s.min, 0), max = num(s.max, 100), val = num(s.value, 0);
    const pct = max > min ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;
    const colour = barColour(String(s.bar_style ?? ''));
    return `<div class="skena-w-progress"><div class="skena-w-progress-fill" style="width:${(pct * 100).toFixed(1)}%;background:${colour}"></div></div>`;
  }
  if (name === 'HTMLModel' || name === 'LabelModel') {
    // - HTMLModel value is already HTML (tqdm's numbers/timing); LabelModel is plain text
    const raw = String(s.value ?? '');
    return `<span class="skena-w-label">${name === 'LabelModel' ? esc(raw) : raw}</span>`;
  }
  if (name === 'HBoxModel' || name === 'VBoxModel') {
    const dir = name === 'VBoxModel' ? 'column' : 'row';
    const kids = Array.isArray(s.children) ? (s.children as string[]) : [];
    const inner = kids.map(ref => renderWidget(stripRef(ref), widgets, depth + 1)).join('');
    return `<div class="skena-w-box" style="display:flex;flex-direction:${dir};gap:6px;align-items:center">${inner}</div>`;
  }
  return `<span class="skena-w-unsupported">[unsupported widget: ${esc(name)}]</span>`;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx esbuild src/extension/jupyter/widgets.ts --bundle --format=esm --outfile=test/.build/jupyter-widget-render.mjs && node --test test/jupyter-widget-render.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/jupyter/widgets.ts
git commit -m "feat(jupyter): renderWidget — ipywidgets subset (progress/label/box) to HTML"
```

---

## Task 6: Wire `renderWidget` into `renderOutput`

**Files:**
- Modify: `src/extension/jupyter/output.ts` (widget-view branch in the rich loop)
- Modify: `src/webview/styles/canvas.css` (widget styles)
- Test: `test/jupyter-output.mjs` (extend Task 2's file)

- [ ] **Step 1: Add the failing test**

Append to `test/jupyter-output.mjs`:
```js
test('widget-view mime renders the referenced model, not the json', () => {
  const out = {
    streamText: '',
    rich: [{ mime: 'application/vnd.jupyter.widget-view+json', data: JSON.stringify({ model_id: 'c1' }) }],
    status: 'ok', done: true,
    widgets: { c1: { modelName: 'FloatProgressModel', state: { value: 3, min: 0, max: 6 } } },
  };
  const r = renderOutput(out);
  assert.equal(r.format, 'html');
  assert.ok(r.content.includes('width:50.0%'), r.content);
  assert.ok(!r.content.includes('model_id'), 'raw json must not leak');
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx esbuild src/extension/jupyter/output.ts --bundle --format=esm --outfile=test/.build/jupyter-output.mjs && node --test test/jupyter-output.mjs`
Expected: FAIL — the widget-view JSON is dumped as text (falls to the generic `<pre>` branch).

- [ ] **Step 3: Implement**

In `src/extension/jupyter/output.ts`, import the renderer:
```ts
import { renderWidget } from './widgets';
```
In the `for (const r of rich)` loop, add a branch **before** the `else` text branch:
```ts
} else if (r.mime === 'application/vnd.jupyter.widget-view+json') {
  let modelId = '';
  try { modelId = String((JSON.parse(r.data) as { model_id?: string }).model_id ?? ''); } catch { /* ignore */ }
  const html = modelId ? renderWidget(modelId, out.widgets) : '';
  parts.push(html || '<pre class="skena-out-note">[widget]</pre>');
}
```
Note: `renderOutput`'s `lone` fast-paths (single plotly / single image) do not match widget-view, so widgets always go through the HTML-stacking path — correct.

Add widget styles to `src/webview/styles/canvas.css` (near the `.skena-cell-html` block):
```css
/* - ipywidgets subset (tqdm.notebook etc.) rendered as a static HTML snapshot per run frame */
.skena-cell-html .skena-w-progress { position: relative; height: 12px; min-width: 120px; flex: 1; border-radius: 6px; background: var(--vscode-editorWidget-border, #333); overflow: hidden; }
.skena-cell-html .skena-w-progress-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; transition: width 0.1s linear; }
.skena-cell-html .skena-w-label { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; white-space: nowrap; }
.skena-cell-html .skena-w-unsupported { opacity: 0.6; font-style: italic; font-size: 11px; }
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx esbuild src/extension/jupyter/output.ts --bundle --format=esm --outfile=test/.build/jupyter-output.mjs && node --test test/jupyter-output.mjs`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/extension/jupyter/output.ts src/webview/styles/canvas.css
git commit -m "feat(jupyter): render ipywidgets subset in cell output + widget styles"
```

---

## Task 7: Layer A — throttled live output in `handleRunCell`

**Files:**
- Modify: `src/shared/types.ts` (`MsgRunOutput.lastStatus`)
- Modify: `src/extension/editor-provider.ts` (`applyAndPersist` preset id; `handleRunCell` onDelta)

- [ ] **Step 1: Widen the message type**

In `src/shared/types.ts`, change `MsgRunOutput`:
```ts
export interface MsgRunOutput {
  type:         'runOutput';
  codeNodeId:   string;
  lastStatus:   'ok' | 'error' | 'running';   // - 'running' = a mid-run live delta (UI-only, not persisted)
  kernelNodeId: string;
  kernelId?:    string;
  outputNode?:  CellNode;
  edge?:        CanvasEdge;
}
```

- [ ] **Step 2: Let `applyAndPersist` reuse a preset id**

In `src/extension/editor-provider.ts`, change the `applyAndPersist` signature and the create branch so the persisted node id matches the live one. Signature:
```ts
const applyAndPersist = async (
  status: 'ok' | 'error',
  output: { format: 'markdown' | 'image' | 'html' | 'plotly'; content: string } | null,
  presetId?: string,
): Promise<{ outputNode?: CellNode; edge?: CanvasEdge }> => {
```
In the `else` (create) branch, replace the id line:
```ts
// - was: const id = `ai-${Date.now().toString(36)}`;
const id = presetId ?? `ai-${Date.now().toString(36)}`;
```

- [ ] **Step 3: Add the throttled live path and pass `onDelta` to the run**

In `handleRunCell`, replace the block that runs the cell (currently `out = await manager.run(server, kernelId, msg.code, ids);` inside the `try`) with a live-streaming version. Add, just before that `try`:
```ts
// - live output: stream partial results to the webview (UI-only, no disk write) so tqdm bars
// - and long prints animate. The output node id is generated once here and reused by the final
// - applyAndPersist so the persisted node matches what the webview already shows.
let liveOutputId: string | undefined;
let latest: CollectedOutput | null = null;
let deltaTimer: ReturnType<typeof setTimeout> | null = null;
const flushDelta = () => {
  deltaTimer = null;
  if (!latest) return;
  const hasOut = latest.rich.length > 0 || latest.streamText.length > 0 || Object.keys(latest.widgets).length > 0;
  if (!hasOut) return;
  const cn = document.canvas.nodes.find(n => n.id === msg.cellNodeId && n.type === 'code') as CodeNode | undefined;
  if (!cn) return;
  if (!liveOutputId) liveOutputId = `ai-${Date.now().toString(36)}`;
  const { format, content } = renderOutput(latest);
  const outputNode: CellNode = {
    id: liveOutputId, type: 'cell',
    x: cn.x + cn.width + 140, y: cn.y, width: 480, height: 320,
    format, content, createdBy: 'ai',
  };
  const edge: CanvasEdge = { id: `e-${liveOutputId}`, fromNode: cn.id, fromSide: 'right', toNode: liveOutputId, toSide: 'left', toEnd: 'arrow' };
  try {
    send({ type: 'runOutput', codeNodeId: codeNode.id, lastStatus: 'running', kernelNodeId: kernelNode.id, kernelId, outputNode, edge });
  } catch { /* - webview disposed mid-run; disk write at completion still happens */ }
};
const onDelta = (partial: CollectedOutput) => {
  latest = partial;
  if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 120);   // - coalesce high-frequency frames
};
```
Change the run call to pass `onDelta`:
```ts
// - was: out = await manager.run(server, kernelId, msg.code, ids);
out = await manager.run(server, kernelId, msg.code, ids, onDelta);
```
Immediately after the run resolves (after the `try/catch` that assigns `out`), cancel any pending delta:
```ts
if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
```
Finally, in the success completion call, pass `liveOutputId` so the persisted node reuses the live id:
```ts
// - was: const { outputNode, edge } = await applyAndPersist(status, hasOutput ? { format, content } : null);
const { outputNode, edge } = await applyAndPersist(status, hasOutput ? { format, content } : null, liveOutputId);
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck 2>&1 | grep -v fsPath | grep "error TS"` → Expected: no output (only the 3 known pre-existing `fsPath` errors, filtered out).
Run: `npm run build` → Expected: `Done` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/extension/editor-provider.ts
git commit -m "feat(jupyter): throttled live cell output (streams tqdm/prints mid-run)"
```

---

## Task 8: Webview — tolerate `running` deltas on the runOutput handler

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` (the `runOutput` / `skena:runOutput` handler)

- [ ] **Step 1: Locate the handler**

Run: `grep -n "runOutput\|MsgRunOutput\|d.lastStatus" src/webview/canvas/CanvasView.tsx`
Read the handler (around line 2134). It upserts the output node by id, mirrors into `canvasRef`, and sets the code node's `data.lastStatus = d.lastStatus`.

- [ ] **Step 2: Verify it already handles repeated upserts + `running`**

The handler upserts by node id (`nds.some(n => n.id === out.id)`), so repeated deltas with the same `liveOutputId` update content in place — no change needed for animation. `lastStatus: 'running'` flows into the code node's data, which drives the marching-ants border and the derived run-edge animation (`runningPathEdgeIds`) — a desirable side effect. The final `runOutput` (`lastStatus: 'ok'|'error'`) clears it.

- [ ] **Step 3: Guard the disk mirror on running deltas**

Deltas are UI-only. In the handler, ensure the `canvasRef.current` mirror does not treat a `running` delta as an authoritative save. If the handler currently writes the output node into `canvasRef` unconditionally, wrap that mirror so a `running` delta updates the on-screen node but the persisted mirror is only reconciled on a terminal status. Concretely, find the mirror block (the `const cr = canvasRef.current;` section) and gate the node-array mutation:
```ts
// - only reconcile the persistent mirror on a terminal status; running deltas are UI-only
if (d.lastStatus !== 'running') {
  // ... existing canvasRef mirror code ...
}
```
Leave the `setNodes` upsert (the on-screen update) outside this guard so the bar still animates.

- [ ] **Step 4: Build + manual sanity**

Run: `npm run build` → Expected: `Done`, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx
git commit -m "fix(canvas): treat running runOutput deltas as UI-only (no mirror write)"
```

---

## Task 9: Live smoke test (real kernel, dev host)

**Files:** none (manual verification).

- [ ] **Step 1: Launch**

Run `npm run dev` in one terminal (watch build). Open the Extension Development Host (F5) and open a canvas with a `code` node bound to a running kernel (`Skena: Add Kernel` if needed).

- [ ] **Step 2: Console tqdm**

Run in a code cell:
```python
from tqdm import tqdm
import time
for _ in tqdm(range(20)):
    time.sleep(0.1)
```
Expected: the output cell shows a single bar that fills live (not a pile of frames); final saved snapshot shows the completed bar. Reload the window → the final bar persists.

- [ ] **Step 3: Widget tqdm**

Run:
```python
from tqdm.auto import tqdm
import time
for _ in tqdm(range(20)):
    time.sleep(0.1)
```
Expected: a widget progress bar (green fill) with a live-updating `n/20 [elapsed<remaining]` label; animates during the run; final snapshot persists.

- [ ] **Step 4: Live prints**

Run:
```python
import time
for i in range(5):
    print("step", i); time.sleep(0.3)
```
Expected: lines appear one at a time (~120 ms cadence), not all at once at the end.

- [ ] **Step 5: Regression — no focus/scroll jump**

While a cell streams, confirm the running cell does not shift position or steal focus (the earlier no-reload guarantee still holds; deltas are targeted `runOutput`, not canvas reloads). Confirm `kernelId` is reused across two runs (no leaked kernel) and the marching-ants border + animated edge light up during the run and clear at the end.

- [ ] **Step 6: Update the wiki**

Append results to `~/projects/crtx/projects/skena.md` and `~/projects/crtx/log.md`; if any gotcha surfaced (e.g. tqdm.notebook widget-tree shape), add it to `~/projects/crtx/knowledge/skena-monaco-in-webview-gotchas-2026-07-26.md`.

---

## Notes for the implementer

- **Tests are gitignored** (`test/` is not tracked) — the commit steps intentionally add only `src/`. The `.mjs` files still run; they just aren't committed (repo convention).
- **Every `CollectedOutput` now carries `widgets`** — `collectOutputs` is the only constructor, and it always sets it. `renderOutput` reads `out.widgets`; the Task 2/6 tests pass it explicitly.
- **Throttle trade-off:** 120 ms drops intermediate frames — fine for a bar. If choppy, lower it; if a long run floods `comm_msg`, note that `collectOutputs` re-scans all replies per frame (O(n²)) and may need incremental accumulation — measure first (spec risk).
- **Out of scope (do not build):** interactive-after-run widgets (post-`done` slider drags). The run WS closes at `done`.
