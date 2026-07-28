# Jupyter progress + ipywidgets subset — design

**Goal:** render live progress bars from cell runs — both console `tqdm` (`\r` redraw on
stderr) and widget `tqdm` (`tqdm.auto` / `tqdm.notebook`, ipywidgets comm protocol) — plus a
minimal general ipywidgets subset (FloatProgress/IntProgress, HTML/Label, HBox/VBox).

**Scope chosen:** "+ ipywidgets subset". Full general ipywidgets (sliders, interactive callbacks,
plot widgets) is out.

---

## Why this shape

tqdm renders two completely different ways under an ipykernel:

- `from tqdm import tqdm` (std) → **console**: writes the bar to **stderr** as a `stream` message,
  redrawing with a leading `\r` each update. No widget protocol.
- `from tqdm.auto import tqdm` / `tqdm.notebook` → **widget**: creates an ipywidgets `HBox` of a
  `FloatProgress` + `HTML` label and drives it over the **comm protocol** (`comm_open` / `comm_msg`),
  displayed via a `application/vnd.jupyter.widget-view+json` mime bundle.

Real notebooks use both. Covering both needs three layers, built bottom-up.

## Current state (measured, this codebase)

- `executeCell(server, kernelId, code, ids, onDelta?)` already fires `onDelta(collectOutputs(...))`
  on **every** iopub frame (`src/extension/jupyter/client.ts:170-176`); `manager.run` forwards it.
- `handleRunCell` calls `manager.run(...)` **without** `onDelta` and sends `runOutput` **once** at
  completion (`src/extension/editor-provider.ts:1203, 1222`). → no live update today.
- `collectOutputs` accumulates stream text as `streamText += text` (`protocol.ts`) — no `\r`
  handling. → console tqdm piles up into repeated bars.
- `parseReply` has no case for `comm_open` / `comm_msg` / `comm_close` → they fall to `kind:'other'`
  and are dropped. → widget tqdm renders nothing.

So none of A/B/C exists yet; A is half-plumbed (unused callback).

---

## Layer A — live output (foundation, mandatory)

Wire `onDelta` from `handleRunCell` into a throttled `runOutput` to the webview.

- **Throttle:** coalesce deltas to ~120 ms; **always** flush the final frame on `done`.
- **UI-only:** deltas send `runOutput` messages; they do **NOT** write the `.canvas`. Persist to
  disk **once** at completion (unchanged self-save-suppressed write).
- **Output node lifecycle:** resolve/create the output node at run **start** (not completion) so
  deltas have a stable target id. Reuse the existing "persist `lastStatus:'running'` at run start".
- Webview upserts the output node's `content`/`format` on each `runOutput` (the upsert path already
  exists for the final message).

Benefits beyond tqdm: long prints, streaming logs, partial results appear as they arrive.

## Layer B — console progress (`\r` line buffer)

Replace the naive stream accumulator with a small terminal-line-buffer that renders stream text
the way a terminal would:

- `\r` → move cursor to column 0 (subsequent chars overwrite the current line).
- `\n` → commit the current line, start a new one.
- `ESC[A` (cursor-up) → step up one line (multi-bar tqdm / nested bars).
- Everything else appends at the cursor.

Output collapses to the final rendered line(s). Keep the existing ANSI→span pass (`ansiToHtml`)
after the line buffer resolves. stderr stays non-error-coloured (tqdm writes to stderr but is not
an error).

Lives in `protocol.ts` (a `renderStream(text): string` helper the collector calls), unit-testable
in isolation.

## Layer C — ipywidgets subset (comm protocol)

**Protocol (`protocol.ts`):**
- Parse `comm_open` / `comm_msg` / `comm_close`.
- Maintain a model registry: `comm_id → { modelName, state }`. `comm_open.data.state` seeds it;
  `comm_msg.data.method === 'update'` patches `state` with `comm_msg.data.state`.
- A `display_data` (or `execute_result`) carrying `application/vnd.jupyter.widget-view+json`
  records an ordered widget-view referencing `model_id` (== the comm_id).
- Keep only rendered fields from state: `_model_name`, `value`, `min`, `max`, `description`,
  `bar_style`, `children`, `value`/`plaintext` for HTML/Label. Drop the rest (state can be large).

**Renderer (new `src/extension/jupyter/widgets.ts`, feeding `output.ts`):**
- `FloatProgress` / `IntProgress` → a bar `<div>`; fill width `(value−min)/(max−min)`; colour by
  `bar_style` (info/success/warning/danger → palette).
- `HTML` / `Label` → the `value` html/text (tqdm's `42/100 [00:03<00:07]`).
- `HBox` / `VBox` → flex row/column; resolve `children` (comm_id refs) recursively.
- Unknown `_model_name` → `[unsupported widget: <name>]` placeholder (never throw).
- Produces HTML → flows through the existing `format:'html'` CellNode path. Re-rendered each delta
  (Layer A) so it animates.

**Comm-message filtering (DECISION):** accept **all** comm frames during the active run rather
than filtering by `parent_header.msg_id == ourMsgId`. Rationale: single WS, single run; some widget
libs don't stamp the execute parent on `comm_msg` updates, and strict filtering would drop the bar.
Non-comm frames keep the existing parent filter.

**Persistence (DECISION):** on completion, persist the **last rendered HTML snapshot** (bar at final
value + final label) as the output node's html content — a static final state, same as a real
notebook's saved output.

**Boundary (DECISION — out of scope):** interactive-*after*-run widgets (dragging a slider once the
cell finished). The run WS closes at `done`, so post-run frontend→kernel comm is not handled.
Progress-*during*-a-run is fully covered.

---

## Data-flow summary

```
kernel iopub ─▶ executeCell WS ─▶ collectOutputs (stream line-buffer + comm model registry)
             │                      │
             │                      ├─▶ renderOutput/widgets ─▶ html
             ▼                      ▼
        onDelta (≤120ms) ─▶ manager.run ─▶ handleRunCell ─▶ runOutput(html) ─▶ webview upsert
                                                     └─(on done)─▶ persist .canvas once
```

## Files

- `src/extension/jupyter/protocol.ts` — `\r` line buffer (`renderStream`); comm parsing; widget
  registry in `CollectedOutput`.
- `src/extension/jupyter/widgets.ts` — **new**; widget-model → html renderer.
- `src/extension/jupyter/output.ts` — call the widget renderer for widget-view mimes; stream via B.
- `src/extension/editor-provider.ts` — `handleRunCell` passes a throttled `onDelta`; resolve output
  node at run start; persist only on done.
- `src/shared/types.ts` — (if needed) `runOutput` already carries the fields; confirm no schema change.
- `src/webview/canvas/CanvasView.tsx` — the `runOutput` upsert already exists; confirm it handles
  repeated in-run updates without focus/scroll jump.

## Testing

- `test/jupyter-stream-linebuffer.mjs` — `\r`, `\n`, `ESC[A`, mixed; asserts collapsed output.
- `test/jupyter-widget-registry.mjs` — comm_open seeds, comm_msg update patches, HBox children
  resolve, unknown model → placeholder.
- Live smoke (dev host, real kernel): `from tqdm import tqdm` (console), `from tqdm.auto import tqdm`
  (widget), nested bars, a plain `print` loop (live streaming). Verify animation + final persisted
  snapshot + no scroll/focus jump on repeated in-run updates.

## Risks / open

- Throttle vs fidelity: 120 ms drops intermediate frames (fine for a bar). Tune if choppy.
- `collectOutputs` currently re-scans all replies per frame (O(n²)); with high-frequency comm_msg
  this could get heavy on long runs → may need incremental accumulation. Measure before optimising.
- tqdm.notebook's exact widget tree (HBox vs container) can vary by version; renderer must degrade
  gracefully (placeholder) rather than assume structure.
