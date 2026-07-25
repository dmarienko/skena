# Jupyter Kernel Nodes — Design (v1)

**Goal:** Run code on live Jupyter kernels from the canvas. A code cell node holds
editable Python; a kernel node is a live status widget; running a cell writes rich
output into a connected output node. Both the user (button/hotkey) and the AI agent
(`canvas_run_cell`) can run cells.

**Status:** design approved 2026-07-25. Spike PASSED 2026-07-24 (REST `/api/kernels`
status + WS `execute_request` round-trip against the live JupyterHub, standalone of xlmcp).

**Branch:** `feature/jupyter-kernel`

---

## Architecture

The **extension host owns the Jupyter client**. The webview never touches the network;
the token stays host-side. One thin client (`src/extension/jupyter/client.ts`, ~150 lines,
from the spike): REST `GET /api/kernels` for status, WS `/api/kernels/{id}/channels` for
execute. Auth = `Authorization: token <t>` header (REST) + `?token=<t>` (WS). JupyterHub
base URL keeps its `/user/<name>` prefix.

Three node roles:

| role | node type | source | what it is |
|---|---|---|---|
| kernel | `kernel` (new) | this spec | circular live-status widget; ring = drag-to-connect |
| code cell | `code` (new) | this spec | editable Monaco code + ▶ Run + status |
| output | `cell` (existing) | reused unchanged | rich output (image/html/markdown/plotly), one per code cell |

The existing `cell` node ("standalone output cell — table, image, HTML") already renders
every rich mime we need. Output reuses it verbatim; no new output renderer.

### Config

`skena.jupyter.kernels: [{ name: string, hubUrl: string, token: string }]`. Defaults to
reading `~/.aix/xlmcp/.env` (`JUPYTER_SERVER_URL`, `JUPYTER_API_TOKEN`) when the setting is
empty, so an existing xlmcp user needs zero config. Multiple servers supported.

The host passes the resolved kernel config to the MCP server process via an `env` field on
its spawn entry in the written MCP config (`SKENA_JUPYTER_KERNELS` = JSON), so the agent-run
path (`canvas_run_cell`, which runs in the MCP process) can open its own WS.

---

## Kernel node (`kernel`)

Type:

```ts
export interface KernelNode extends CanvasNodeBase {
  type: 'kernel';
  server: string;      // - matches a skena.jupyter.kernels[].name
  kernelId?: string;   // - live Jupyter kernel id once started/bound; absent = not yet connected
  displayName?: string;// - e.g. "python3"; shown in the title
  colorIndex?: number; // - index into the kernel palette; assigned at creation
}
```

Visual (from sketch C5 in `test/X3.canvas`):

- Title above the circle: `{displayName} :: {kernelId short}` (e.g. `python3 :: kernel-123`).
- Two concentric circles. **Inner circle = status LED**:
  - **green** — idle
  - **blinking green** — busy (a cell is running on this kernel)
  - **grey** — dead / disconnected / not yet connected
  - **red** — error (last execute errored, or kernel died)
- **Ring** (the band between inner and outer circle) is the **drag-to-connect zone**: dragging
  from it starts an edge. Dropping on a code cell binds it; dropping on empty canvas creates a
  new code cell already bound (reuses the existing drop-connection-to-empty path in
  `CanvasView.onConnectEnd`).
- Each kernel node gets a palette color (`colorIndex`) tinting its circles and its outgoing
  edges. Palette in `src/webview/canvas/palette.ts`, cycled by creation order.

Fixed compact size (e.g. 140×160 incl. title); not resizable.

Live status: the host polls each configured server's `GET /api/kernels` every ~2s while a
canvas with kernel nodes is open, and pushes a `kernelStatus` message (see protocol) → the
node renders the LED. Busy is derived from the running-cell set (see execution), not only from
the coarse `execution_state`, so the correct kernel blinks.

### Creation

Command **"Skena: Add kernel"** (also a canvas context-menu entry) → QuickPick listing live
kernels across all configured servers (`{server} · {name} · {state}`), plus
**"+ start new kernel on \<server\>"** per server. Selection drops a `kernel` node at the
viewport centre. No persistent status panel — each kernel is its own on-canvas widget.

---

## Code cell node (`code`)

Type:

```ts
export interface CodeNode extends CanvasNodeBase {
  type: 'code';
  code: string;
  language?: string;    // - default 'python'
  outputNodeId?: string;// - id of the linked output `cell` node, once first run created it
  lastRun?: number;     // - ms timestamp of last execution start
  lastStatus?: 'ok' | 'error' | 'running';
}
```

- Monaco editor (reuse the TextNode editor setup: markdown-style theme sync, vim, focus
  handling) with `language: python`.
- Header holds a **▶ Run** button and a small status glyph reflecting `lastStatus`
  (idle / running spinner / ✓ / ✗).
- Bound to a kernel by a **manual edge** to a `kernel` node (either direction). Resolved by
  walking edges for a connected `kernel` node. **Unbound → Run is disabled** with a hint
  ("connect to a kernel"). Many code cells may bind to one kernel (shared namespace; execution
  order is whatever order runs happen, exactly like a notebook).

### Run triggers (all three, v1)

1. **▶ button** on the code cell header.
2. **Hotkey** `Shift+Enter` on the focused/selected code cell.
3. **Agent** via new MCP tool `canvas_run_cell`.

---

## Execution flow

### User run (button / hotkey)

1. Webview → host `runCell { cellNodeId, code }`.
2. Host resolves the bound kernel node from the canvas edges → its `server` + `kernelId`
   (starting a kernel first if `kernelId` is absent).
3. Host opens/reuses the WS, sends a v5.3 `execute_request`, matches replies on
   `parent_header.msg_id`, ends on `status: idle`.
4. While busy: host marks the kernel busy (blink) and sends `runStatus { cellNodeId, kernelNodeId, state: 'running' }`
   → the webview animates the **cell→kernel edge** as a running dashed line and shows the cell
   spinner.
5. Output routing: the host accumulates `stream` text and captures `execute_result` /
   `display_data` mime bundles. It ensures the code cell's **single output node**:
   - first run → create a `cell` node at the code cell's **right edge** (x = cell.x + cell.width + 60)
     + an edge code→output; store its id in `code.outputNodeId`.
   - subsequent runs → **replace** that output node's content.
   - v1 rendering: accumulated stream text first, then the final rich mime below it
     (image → `format:'image'` base64 data-URI; `text/html` → `format:'html'`; else markdown/plain).
     Multiple ordered outputs in one run are not stacked in v1 (deferred).
6. On idle: host writes the final output content + `code.lastStatus` to the `.canvas` file
   (persist), clears running state, sends `runStatus … state:'ok'|'error'`.

### Agent run (`canvas_run_cell`)

New MCP tool in `src/extension/mcp/server.ts`:

```
canvas_run_cell(canvasPath, cellRef, kernelRef?)
```

- Resolves the code node by ref; resolves the kernel from the explicit `kernelRef` or the code
  node's bound-kernel edge.
- Runs the execute over WS using the **same** `jupyter/client.ts` module (bundled into
  `skena-mcp.js`), reading server URL+token from `SKENA_JUPYTER_KERNELS` env.
- Writes the output node to the `.canvas` file (reusing the `canvas_pin_output` placement +
  labelling logic), updates `code.outputNodeId` / `lastStatus`. The host's soft-reload picks up
  the file change and re-renders.
- Returns a text summary (status + captured stdout/first rich-output note) to the agent.

**Known v1 limitation:** because the agent-run path runs in the MCP process (not the host),
the precise running-edge animation and per-node spinner do not fire for agent runs — the host's
status poll only shows the kernel go busy. Output-to-node works for both paths. Precise
agent-run indicators are a v2 refinement (host↔MCP run signalling).

---

## Message protocol additions (`src/shared/types.ts`)

Webview → Host:
- `runCell { type:'runCell', cellNodeId, code }`
- `addKernel { type:'addKernel' }` (opens the QuickPick; or a dedicated command)

Host → Webview:
- `kernelStatus { type:'kernelStatus', kernels: { server, kernelId, state, connections }[] }`
  (pushed every poll; the webview maps to kernel nodes by `server`+`kernelId`)
- `runStatus { type:'runStatus', cellNodeId, kernelNodeId, state:'running'|'ok'|'error', error? }`

Add `KernelNode` and `CodeNode` to `SkenaNodeType` and the `CanvasNode` union.

---

## Kernel color assignment

`src/webview/canvas/palette.ts` gains a `KERNEL_PALETTE: string[]` (distinct hues). A kernel
node's `colorIndex` is assigned at creation = `(count of existing kernel nodes) % KERNEL_PALETTE.length`.
Applied to: the node's circles, the node's outgoing edges (kernel→cell), and the bound cells'
output-node accent border.

---

## v1 scope

**In:** `kernel` node (status widget, LED, drag-to-connect, color); `code` node (Monaco + Run +
status); manual cell↔kernel binding; user run (button + `Shift+Enter`); host Jupyter client
(status poll + WS execute); output to a reused `cell` node at the right edge (single, replaced
per run); rich output (stream + final image/html/plotly/markdown); `canvas_run_cell` MCP tool;
"Skena: Add kernel" QuickPick; config with `~/.aix/xlmcp/.env` fallback.

**Deferred to v2:** typed dependency edges between cells; run-with-upstream (DAG execution);
staleness dots; ordered multi-output stacking; precise agent-run running indicators;
interrupt/restart-from-node UI (restart via kernel node menu can be a small add if cheap).

---

## Testing

- `jupyter/client.ts` — unit test the message framing (build `execute_request`, parse a captured
  reply sequence → correct stream/result/idle) against recorded fixtures; no live server in CI.
- Live smoke (manual, documented): open a canvas, Add kernel, create a code cell, bind, Run a
  `print` + a `matplotlib` plot, confirm LED blinks, edge animates, output node shows text then
  image, second run replaces content, `canvas_run_cell` from the agent writes an output node.
- Node components: render `kernel` at each LED state; `code` disabled-Run when unbound.

## Open questions (for spec review)

1. Host-owns-client + MCP-side agent run (two live connections, shared code) accepted for v1?
2. Kernel node fixed size / not resizable — OK, or allow resize?
3. Restart kernel in v1 (kernel node right-click) or defer with the rest?
