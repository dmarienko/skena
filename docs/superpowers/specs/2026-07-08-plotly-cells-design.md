# Plotly Cell Nodes — Design

**Date**: 2026-07-08
**Status**: approved (brainstormed with user)
**Feature**: render interactive plotly figures in cell nodes — from notebook outputs, Alt+P pin, and Ctrl+V paste of figure JSON.

## Motivation

Plotly outputs in notebooks currently degrade to PNG (if present) or nothing. Pasting a `FigureWidget` output yields a useless Python repr (see `test/X3.canvas` node N9). Figures displayed as `go.Figure` carry the full spec as `application/vnd.plotly.v1+json` in the .ipynb — fully renderable offline with plotly.js.

**FigureWidget is explicitly out of scope**: its notebook output is a widget-view model reference, dead without a kernel. The supported workaround is `fig.to_json()` → copy → paste (rule 6 below).

## User decisions

- **Delivery: lazy separate asset** — plotly.js-dist-min (~3.6 MB) ships as its own file in `dist/`, script-injected on first plotly cell mount. Non-plotly canvases pay nothing. NOT bundled into webview.js.
- **Theming: render as-authored** — no template/color remapping.
- **Paste rule: included** in this feature.

## 1. Type extension (`src/shared/types.ts`)

- `CellNode.format`: `'markdown' | 'image' | 'html' | 'plotly'`. For `'plotly'`, `content` is the figure JSON string (`{"data": [...], "layout": {...}}`).
- Notebook parser output union (`src/extension/notebook-parser.ts`) gains `{ mimeType: 'application/vnd.plotly.v1+json'; json: string }`.

## 2. plotly.js delivery

- New dependency `plotly.js-dist-min`.
- esbuild config: copy `node_modules/plotly.js-dist-min/plotly.min.js` → `dist/plotly.min.js` (plain copy, not a bundle input).
- Webview HTML (editor-provider): expose the file's webview URI to the app (e.g. `window.__skenaPlotlyUri` or a data attribute). Verify the existing CSP (`webview.cspSource`) covers extension-dir scripts; extend the script-src directive if needed.
- `src/webview/renderers/plotlyLoader.ts`: `loadPlotly(): Promise<PlotlyGlobal>` — injects the `<script>` once, memoizes the promise, rejects on script error. Subsequent calls reuse the promise.
- `.vscodeignore`: ensure `dist/plotly.min.js` is INCLUDED in the VSIX (dist/ already is).

## 3. `PlotlyRenderer` (`src/webview/renderers/PlotlyRenderer.tsx`)

- Props: `{ json: string }`.
- Parse once via `useMemo`; invalid JSON → inline error box (no crash).
- `loadPlotly()` then `Plotly.newPlot(el, data, layout, { responsive: true, displaylogo: false })`.
- **Interaction isolation**: container carries React Flow's `nowheel nodrag` classes so chart pan/zoom/hover doesn't fight canvas drag — same pattern as Monaco/scrollable content.
- Resize: `ResizeObserver` on the container → `Plotly.Plots.resize(el)`.
- Cleanup: `Plotly.purge(el)` on unmount.
- States: "loading plotly…" dim placeholder while the script loads; script-load failure → warning box with the error.

## 4. Notebook pipeline

- `notebook-parser.ts`: extract `application/vnd.plotly.v1+json` from cell outputs. When the same output bundle also carries `image/png`, prefer the plotly JSON and drop the PNG (no double render).
- `NotebookRenderer.tsx`: new mimeType case → `<PlotlyRenderer json={...} />`; the 📌 pin button for that output calls `pinOutput(json, 'plotly', sourceNodeId)`.

## 5. CellNode

`format === 'plotly'` → `<PlotlyRenderer json={node.content} />` (alongside the existing markdown/image/html branches).

## 6. Paste rule (extends paste-to-node)

- `classifyClipboard` gains: plain text that is a single JSON object parsing to `{ data: Array, layout: Object }` → `{ kind: 'cell-plotly', json: <original text> }`.
- Position in priority: within the text branch, AFTER the yy-snapshot check (internal paste still wins for yy'd content) but BEFORE the URL/path/plain rules; cheap pre-filter `trimmed.startsWith('{')` before attempting `JSON.parse` (never parse arbitrary text on the hot path).
- Note: this sits after the html/uri-list branches — `fig.to_json()` copied from a terminal/editor arrives as plain text, which is the target workflow.
- Dispatch arm in the paste listener: `addCellNode(action.json, 'plotly', focused?.id)`.
- Tests extend `test/paste-classify.mjs`: valid figure JSON → cell-plotly; JSON without data/layout → text; malformed `{...` → text; priority vs yy-snapshot (snapshot match still wins — internal paste is checked first in the text branch).

## Error handling

- Invalid figure JSON in a plotly cell → inline error box, node still selectable/deletable.
- plotly.min.js fails to load (missing asset, CSP) → warning box in every plotly cell; no crash.
- Parser: malformed plotly output in .ipynb → skip that output (fall through to other mimeTypes).

## Compatibility

- `cell` is a Skena extension node type — Obsidian ignores it; no format compat change.
- Older Skena builds render unknown `plotly` format as empty cell body — acceptable.

## Testing

- Classifier: new rule + priority tests (see §6).
- Parser: unit test on a fixture .ipynb containing a plotly output (+ sibling PNG → prefer JSON).
- Manual smoke: open notebook with `go.Figure` output → interactive chart in FileNode; Alt+P pin → plotly CellNode; `fig.to_json()` → Ctrl+V → plotly CellNode; chart zoom/pan doesn't drag the canvas; node resize resizes the chart; canvas without plotly cells never loads plotly.min.js (check network/script tags).

## Out of scope

- FigureWidget live rendering (kernel bridge).
- Theme remapping of figures.
- Plotly HTML (`text/html` outputs with embedded plotly scripts) — those still render via the existing sanitized-html path, non-interactive.
