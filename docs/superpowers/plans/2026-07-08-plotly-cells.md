# Plotly Cell Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render interactive plotly figures in Skena cell nodes — from notebook outputs, Alt+P pin, and Ctrl+V paste of figure JSON — per `docs/superpowers/specs/2026-07-08-plotly-cells-design.md`.

**Architecture:** A new `'plotly'` value on `CellNode.format` whose `content` is figure JSON. plotly.js ships as a lazily script-injected `dist/` asset (not bundled). A `PlotlyRenderer` component parses the JSON and calls `Plotly.newPlot`. The notebook parser extracts `application/vnd.plotly.v1+json` (preferred over a sibling PNG); NotebookRenderer renders + pins it; the paste classifier recognizes figure JSON.

**Tech Stack:** TypeScript, React (webview), VS Code extension host, esbuild, `plotly.js-dist-min`, `node --test` for pure modules.

**Conventions that matter here:**
- Inline comments start with `// -` and are terse. No banner/divider comments.
- Modern TS (no `typing`-style verbosity); match `src/shared/types.ts` interface style.
- `test/` is **gitignored** — run tests with `node --test` against an esbuild bundle; never `git add` test files. Inline test fixtures as string literals (no fixture files, since they wouldn't be committed).
- `npm run build` = full build; `npm run typecheck` has **exactly 3 pre-existing errors** in `src/extension/editor-provider.ts` `copyAbsolutePath` (`fsPath` on `ResolvedUri`/`ResolvedNotion`) — introduce no new ones.
- Branch: this work continues on `feature/paste-to-node` (Task 4's paste rule extends that branch's classifier). Verify with `git branch --show-current`.

---

### Task 1: Types + notebook parser extracts plotly (TDD)

**Files:**
- Modify: `src/shared/types.ts` (CellNode.format, ~line 86)
- Modify: `src/extension/notebook-parser.ts` (output union + extraction)
- Test: `test/notebook-plotly.mjs` (working-tree only, NOT committed)

- [ ] **Step 1: Write the failing test**

Create `test/notebook-plotly.mjs`:

```js
// test/notebook-plotly.mjs
// - behavioral tests: notebook parser extracts plotly outputs, prefers them over sibling PNG.
// - run: npx esbuild src/extension/notebook-parser.ts --bundle --format=esm --outfile=test/.build/notebook-parser.mjs && node --test test/notebook-plotly.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseNotebook } from './.build/notebook-parser.mjs';

// - minimal notebook: one code cell whose output carries a plotly figure AND a png
const nbWithPlotly = JSON.stringify({
  nbformat: 4,
  metadata: { language_info: { name: 'python' } },
  cells: [{
    cell_type: 'code',
    source: 'fig',
    execution_count: 1,
    outputs: [{
      output_type: 'execute_result',
      data: {
        'application/vnd.plotly.v1+json': { data: [{ type: 'scatter', y: [1, 2, 3] }], layout: { title: 'T' } },
        'image/png': 'AAAA',
        'text/plain': 'Figure(...)',
      },
    }],
  }],
});

test('plotly output extracted with json string, preferred over png', () => {
  const nb = parseNotebook(nbWithPlotly);
  const outs = nb.cells[0].outputs;
  assert.equal(outs.length, 1, 'exactly one output (png/text suppressed)');
  assert.equal(outs[0].mimeType, 'application/vnd.plotly.v1+json');
  const fig = JSON.parse(outs[0].json);
  assert.deepEqual(fig.data[0].y, [1, 2, 3]);
  assert.equal(fig.layout.title, 'T');
});

test('widget-view (FigureWidget) still becomes a placeholder', () => {
  const nb = parseNotebook(JSON.stringify({
    nbformat: 4, cells: [{
      cell_type: 'code', source: 'w', outputs: [{
        output_type: 'display_data',
        data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'x' }, 'text/plain': 'FigureWidget(...)' },
      }],
    }],
  }));
  const outs = nb.cells[0].outputs;
  assert.equal(outs[0].mimeType, 'placeholder');
});

test('png-only output still extracts png (no regression)', () => {
  const nb = parseNotebook(JSON.stringify({
    nbformat: 4, cells: [{
      cell_type: 'code', source: 'p', outputs: [{
        output_type: 'execute_result', data: { 'image/png': 'BBBB' },
      }],
    }],
  }));
  assert.equal(nb.cells[0].outputs[0].mimeType, 'image/png');
  assert.equal(nb.cells[0].outputs[0].data, 'BBBB');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd ~/devs/skena
npx esbuild src/extension/notebook-parser.ts --bundle --format=esm --outfile=test/.build/notebook-parser.mjs && node --test test/notebook-plotly.mjs
```
Expected: FAIL — the plotly output currently becomes `{ mimeType: 'placeholder' }`, so test 1 fails (`mimeType` is `placeholder`, and png/text aren't suppressed).

- [ ] **Step 3a: Add the output type** in `src/extension/notebook-parser.ts`

After the `OutputHtml` interface (~line 24), add:

```ts
export interface OutputPlotly {
  mimeType: 'application/vnd.plotly.v1+json';
  /** - JSON.stringify of the plotly figure spec ({ data, layout }) */
  json: string;
}
```

Extend the union:

```ts
export type CellOutput = OutputImage | OutputText | OutputHtml | OutputPlotly | OutputPlaceholder;
```

- [ ] **Step 3b: Extract plotly before png** in `parseOutputs`

Inside `parseOutputs`, in the `display_data or execute_result` section, add this block IMMEDIATELY BEFORE the `if (data['image/png'])` check:

```ts
// - plotly figure: full spec, prefer over any sibling png/text rendering of the same figure
if ('application/vnd.plotly.v1+json' in data) {
  outputs.push({
    mimeType: 'application/vnd.plotly.v1+json',
    json: JSON.stringify((data as Record<string, unknown>)['application/vnd.plotly.v1+json']),
  });
  continue;
}
```

Then update the trailing placeholder block: remove `'application/vnd.plotly.v1+json'` from the `knownInteractive` array so only the widget stays a placeholder:

```ts
// - jupyter widgets (e.g. FigureWidget) — kernel-bound, show placeholder
const knownInteractive = ['application/vnd.jupyter.widget-view+json'];
```

- [ ] **Step 3c: Widen `CellNode.format`** in `src/shared/types.ts` (~line 86)

```ts
  format: 'markdown' | 'image' | 'html' | 'plotly';
  /** - markdown/html: raw string; image: base64 data URI; plotly: figure JSON string */
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npx esbuild src/extension/notebook-parser.ts --bundle --format=esm --outfile=test/.build/notebook-parser.mjs && node --test test/notebook-plotly.mjs
npm run typecheck
```
Expected: 3 tests pass; typecheck shows ONLY the 3 pre-existing errors.

- [ ] **Step 5: Commit (source only)**

```bash
git add src/shared/types.ts src/extension/notebook-parser.ts
git commit -m "feat(plotly): parse plotly.v1+json notebook outputs, add plotly cell format"
```

---

### Task 2: plotly.js lazy asset + loader + PlotlyRenderer

**Files:**
- Modify: `package.json` (dependency)
- Modify: `esbuild.config.mjs` (copy asset)
- Modify: `src/extension/editor-provider.ts` (`getWebviewHtml` ~line 1139: expose asset URI)
- Create: `src/webview/renderers/plotlyLoader.ts`
- Create: `src/webview/renderers/PlotlyRenderer.tsx`

- [ ] **Step 1: Add the dependency**

```bash
cd ~/devs/skena
npm install plotly.js-dist-min@^2.35.0
```
Verify: `node -e "console.log(require.resolve('plotly.js-dist-min/plotly.min.js'))"` prints a path.

- [ ] **Step 2: Copy the asset into `dist/` during build**

In `esbuild.config.mjs`, add near the top imports:

```js
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// - copy plotly.js dist asset (lazy-loaded by the webview via <script>, NOT bundled)
function copyPlotlyAsset() {
  mkdirSync('dist', { recursive: true });
  copyFileSync(require.resolve('plotly.js-dist-min/plotly.min.js'), 'dist/plotly.min.js');
}
```

Call `copyPlotlyAsset()` in BOTH branches of the build: in the `if (watch)` branch right after the contexts are created (before the `console.log('Watching...')`), and in the `else` branch right after the `await Promise.all([...build])`.

- [ ] **Step 3: Expose the asset URI to the webview** in `getWebviewHtml` (`src/extension/editor-provider.ts` ~line 1139)

After the `styleUri` declaration add:

```ts
    const plotlyUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'plotly.min.js')
    );
```

In the returned HTML, change the root div to carry the URI as a data attribute:

```html
  <div id="root" data-plotly-uri="${plotlyUri}"></div>
```

Note on CSP: the existing `script-src ${webview.cspSource} 'unsafe-inline'` already covers a `<script src="${plotlyUri}">` (extension-dir origin). Do NOT add `'unsafe-eval'` yet — see Task 3 Step 5, which tests whether plotly needs it.

- [ ] **Step 4: Write the loader** — create `src/webview/renderers/plotlyLoader.ts`

```ts
// - lazily inject plotly.min.js from the extension dist; memoized so it loads at most once.
// - plotly.js-dist-min is a UMD bundle that attaches window.Plotly.

type PlotlyGlobal = {
  newPlot: (el: HTMLElement, data: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
  purge: (el: HTMLElement) => void;
  Plots: { resize: (el: HTMLElement) => void };
};

let _promise: Promise<PlotlyGlobal> | null = null;

export function loadPlotly(): Promise<PlotlyGlobal> {
  if (_promise) return _promise;
  _promise = new Promise<PlotlyGlobal>((resolve, reject) => {
    const w = window as unknown as { Plotly?: PlotlyGlobal };
    if (w.Plotly) { resolve(w.Plotly); return; }
    const uri = document.getElementById('root')?.dataset.plotlyUri;
    if (!uri) { reject(new Error('plotly asset URI not configured on #root')); return; }
    const s = document.createElement('script');
    s.src = uri;
    s.onload = () => {
      if (w.Plotly) resolve(w.Plotly);
      else reject(new Error('plotly.min.js loaded but window.Plotly is undefined'));
    };
    s.onerror = () => reject(new Error('failed to load plotly.min.js'));
    document.head.appendChild(s);
  });
  return _promise;
}
```

- [ ] **Step 5: Write the renderer** — create `src/webview/renderers/PlotlyRenderer.tsx`

```tsx
// - renders a plotly figure (JSON string) into a cell; lazy-loads plotly.js on first mount.
// - `nowheel nodrag` isolate chart interaction from canvas pan/drag (same as Monaco nodes).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadPlotly } from './plotlyLoader';

export function PlotlyRenderer({ json }: { json: string }): JSX.Element {
  const elRef = useRef<HTMLDivElement>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // - parse once; require a data array to count as a figure
  const fig = useMemo(() => {
    try {
      const o = JSON.parse(json);
      if (!o || typeof o !== 'object' || !Array.isArray(o.data)) return null;
      return o as { data: unknown[]; layout?: unknown };
    } catch { return null; }
  }, [json]);

  useEffect(() => {
    if (!fig) { setError('invalid figure JSON'); setLoading(false); return; }
    let cancelled = false;
    let plotly: { purge: (el: HTMLElement) => void } | null = null;
    const el = elRef.current;
    loadPlotly()
      .then(P => {
        if (cancelled || !el) return;
        plotly = P;
        P.newPlot(el, fig.data, fig.layout ?? {}, { responsive: true, displaylogo: false });
        setLoading(false);
      })
      .catch((e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => {
      cancelled = true;
      if (plotly && el) plotly.purge(el);
    };
  }, [fig]);

  // - keep the chart sized to the (resizable) node
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = window as unknown as { Plotly?: { Plots: { resize: (e: HTMLElement) => void } } };
      if (w.Plotly) w.Plotly.Plots.resize(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (error) return <div className="skena-error" style={{ padding: 8, fontSize: 11 }}>Plotly: {error}</div>;

  return (
    <div className="skena-plotly nowheel nodrag" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 11 }}>
          loading plotly…
        </div>
      )}
      <div ref={elRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```

- [ ] **Step 6: Build + typecheck**

```bash
npm run build && npm run typecheck
ls -la dist/plotly.min.js
```
Expected: build OK; `dist/plotly.min.js` exists (~3.6 MB); typecheck only the 3 pre-existing errors. (Nothing renders plotly yet — wired in Task 3.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json esbuild.config.mjs src/extension/editor-provider.ts src/webview/renderers/plotlyLoader.ts src/webview/renderers/PlotlyRenderer.tsx
git commit -m "feat(plotly): lazy plotly.js asset loader + PlotlyRenderer component"
```

---

### Task 3: Wire PlotlyRenderer into CellNode + NotebookRenderer

**Files:**
- Modify: `src/webview/canvas/nodes/CellNode.tsx` (render branch)
- Modify: `src/webview/renderers/NotebookRenderer.tsx` (OutputBlock case + pin + format union)
- Modify: `src/webview/canvas/CanvasView.tsx` (widen `addCellNode` param ~line 1861 + `pinCellOutput` handler detail type ~line 1950)

- [ ] **Step 1: CellNode plotly branch** — `src/webview/canvas/nodes/CellNode.tsx`

Add the import near the other renderer imports:

```tsx
import { PlotlyRenderer } from '../../renderers/PlotlyRenderer';
```

In the `ScrollableContent` block, after the `html` branch, add:

```tsx
        {node.format === 'plotly'   && <PlotlyRenderer json={node.content} />}
```

- [ ] **Step 2: Widen format unions in CanvasView** — `src/webview/canvas/CanvasView.tsx`

Line ~1861 (`addCellNode` param):

```ts
    format: 'html' | 'markdown' | 'image' | 'plotly',
```

Line ~1950 (the `pinCellOutput` handler's detail type):

```ts
        format:       'html' | 'markdown' | 'image' | 'plotly';
```

- [ ] **Step 3: NotebookRenderer — plotly output + pin** — `src/webview/renderers/NotebookRenderer.tsx`

Add the import:

```tsx
import { PlotlyRenderer } from './PlotlyRenderer';
```

Widen `pinOutput`'s format param:

```ts
function pinOutput(content: string, format: 'html' | 'markdown' | 'image' | 'plotly', sourceNodeId: string) {
```

In `OutputBlock`, add this case BEFORE the `text/plain` case:

```tsx
  if (out.mimeType === 'application/vnd.plotly.v1+json') {
    return (
      <div className="skena-notebook__output" style={{ position: 'relative', height: 400 }}>
        {showPin && <PinButton onClick={() => pinOutput(out.json, 'plotly', sourceNodeId)} />}
        <PlotlyRenderer json={out.json} />
      </div>
    );
  }
```

In `cellOutputsToHtml`, plotly can't flatten to static HTML — add before the final `return ''`:

```tsx
      // - plotly is interactive; can't be inlined into a static "pin all" HTML blob (has its own pin)
      if (out.mimeType === 'application/vnd.plotly.v1+json') return '';
```

- [ ] **Step 4: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; only the 3 pre-existing errors. If TS complains that `CellOutput` in `cellOutputsToHtml`/`OutputBlock` doesn't include the plotly member, confirm Task 1's union export is picked up (it is imported from `../../extension/notebook-parser`).

- [ ] **Step 5: Manual CSP/eval check (decision step)**

Open a `.canvas` (Extension Development Host: `F5`, or install the VSIX) containing a notebook FileNode with a `go.Figure` output, OR pin one. Open the webview devtools (Command Palette → "Developer: Open Webview Developer Tools").
- If the chart renders → done, CSP is fine.
- If the console shows a CSP error mentioning `unsafe-eval` / `Function` → in `getWebviewHtml` (editor-provider.ts) change the script-src directive to `` `script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'` ``, rebuild, retest. (Modern plotly.js-dist-min generally does not need eval, so try without first.) Record which was needed in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/webview/canvas/nodes/CellNode.tsx src/webview/renderers/NotebookRenderer.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat(plotly): render plotly cells + pin plotly notebook outputs"
```

---

### Task 4: Paste rule — figure JSON → plotly cell (extends paste-to-node)

**Files:**
- Modify: `src/webview/canvas/paste-classify.ts` (new action + rule)
- Modify: `src/webview/canvas/CanvasView.tsx` (paste-listener dispatch arm)
- Test: `test/paste-classify.mjs` (extend; working-tree only)

- [ ] **Step 1: Add failing tests** to `test/paste-classify.mjs`

Insert before the final `test('plain multi-line text ...')`:

```js
test('figure JSON (data + layout) -> cell-plotly', () => {
  const j = JSON.stringify({ data: [{ type: 'scatter', y: [1, 2] }], layout: { title: 'x' } });
  assert.deepEqual(classifyClipboard({ ...base, text: j }), { kind: 'cell-plotly', json: j });
});

test('JSON without a data array -> text node', () => {
  const j = JSON.stringify({ foo: 1, layout: {} });
  assert.equal(classifyClipboard({ ...base, text: j }).kind, 'text');
});

test('malformed leading-brace text -> text node', () => {
  assert.equal(classifyClipboard({ ...base, text: '{ not json' }).kind, 'text');
});

test('figure JSON equal to yy snapshot -> internal (yy still wins)', () => {
  const j = JSON.stringify({ data: [{ y: [1] }], layout: {} });
  assert.equal(classifyClipboard({ ...base, text: j, yySnapshot: j }).kind, 'internal');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx esbuild src/webview/canvas/paste-classify.ts --bundle --format=esm --outfile=test/.build/paste-classify.mjs && node --test test/paste-classify.mjs
```
Expected: the new plotly tests FAIL (figure JSON currently classifies as `text`).

- [ ] **Step 3: Implement the rule** in `src/webview/canvas/paste-classify.ts`

Add to the `PasteAction` union:

```ts
  | { kind: 'cell-plotly'; json: string }
```

Add a detector near the other helpers:

```ts
// - a plotly figure spec: a single JSON object with a `data` array (+ usually `layout`)
function asPlotlyFigure(s: string): string | null {
  if (!s.startsWith('{')) return null;   // - cheap pre-filter before JSON.parse
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && Array.isArray(o.data)) return s;
  } catch { /* - not JSON */ }
  return null;
}
```

In `classifyClipboard`, inside the `if (trimmed) {` block, AFTER the yy-snapshot check and BEFORE the `isSingleLine` block, add:

```ts
    const plotly = asPlotlyFigure(trimmed);
    if (plotly) return { kind: 'cell-plotly', json: plotly };
```

(Order matters: yy-internal still wins; figure JSON is multi-line so it must be checked before the single-line URL/path rules and before the plain-text fallthrough.)

- [ ] **Step 4: Run tests**

```bash
npx esbuild src/webview/canvas/paste-classify.ts --bundle --format=esm --outfile=test/.build/paste-classify.mjs && node --test test/paste-classify.mjs
```
Expected: all pass (15 tests).

- [ ] **Step 5: Dispatch arm** in `src/webview/canvas/CanvasView.tsx`

In the paste listener's `switch (action.kind)` (added in the paste-to-node feature), add an arm alongside `case 'cell-html':`:

```ts
      case 'cell-plotly':
        addCellNode(action.json, 'plotly', focused?.id);
        return;
```

- [ ] **Step 6: Build + typecheck**

```bash
npm run build && npm run typecheck
```
Expected: build OK; only the 3 pre-existing errors. TS will confirm the switch is exhaustive over the widened `PasteAction`.

- [ ] **Step 7: Commit**

```bash
git add src/webview/canvas/paste-classify.ts src/webview/canvas/CanvasView.tsx
git commit -m "feat(plotly): paste figure JSON as a plotly cell"
```

---

### Task 5: Manual smoke + release chores

**Files:**
- Modify: `README.md`
- Modify: `package.json` (version)

- [ ] **Step 1: Manual smoke (Extension Development Host or installed VSIX)**

1. Notebook FileNode with a `go.Figure` output → interactive chart renders inline (hover/zoom works). ✓
2. Hover that output → 📌 → plotly CellNode appears with an edge from the notebook node. ✓
3. Chart pan/zoom/hover does NOT drag the canvas; canvas drag still works on the node border. ✓
4. Resize the plotly CellNode → chart resizes to fit. ✓
5. In a terminal: `python -c "import plotly.express as px; print(px.line(y=[1,2,3]).to_json())"`, copy the JSON, Ctrl+V on canvas → plotly CellNode. ✓
6. Open a canvas with NO plotly cells → confirm `plotly.min.js` is NOT requested (webview devtools Network / no `<script>` for it). ✓
7. Paste malformed `{...` text → plain text node, no crash. ✓
8. The `test/X3.canvas` N9 case: paste `fig.to_json()` output (not the FigureWidget repr) → renders. (FigureWidget repr itself stays a text node — documented limitation.) ✓

- [ ] **Step 2: README** — add a bullet under the `### Paste anything` section (or `### Rich inline previews`):

```markdown
- **Plotly** — interactive plotly figures render live in cell nodes: from notebook outputs (`go.Figure`), via `Alt+P` pin, or by pasting `fig.to_json()` output. Pan, zoom, and hover work inside the node.
```

- [ ] **Step 3: Version bump + package**

Bump `package.json` `"version"` from `0.4.0` to `0.5.0`, then:

```bash
npm run package 2>&1 | tail -3
```
Expected: `skena-0.5.0.vsix` builds clean and includes `dist/plotly.min.js` (the packaged size jumps ~3.6 MB — that's expected).

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "chore(release): v0.5.0 — plotly cell nodes"
```

- [ ] **Step 5: Update crtx wiki**

Append a session entry to `~/projects/crtx/log.md` and the skena project page (`~/projects/crtx/projects/skena.md`): plotly cell nodes built per spec; key decisions (lazy plotly.js asset, render-as-authored, `application/vnd.plotly.v1+json` extraction preferred over PNG, FigureWidget out of scope); note whether CSP needed `'unsafe-eval'` (from Task 3 Step 5). Commit the wiki.

---

## Self-review (done at plan time)

- **Spec coverage**: type extension → Task 1 Step 3c; parser plotly extraction (prefer over PNG) → Task 1 Step 3b; plotly.js lazy asset + loader → Task 2 Steps 2/4; PlotlyRenderer (parse-once, nowheel/nodrag, ResizeObserver, purge, loading/error states) → Task 2 Step 5; CellNode branch → Task 3 Step 1; NotebookRenderer render+pin → Task 3 Step 3; pin-all excludes plotly → Task 3 Step 3; paste rule + priority → Task 4; error handling (invalid JSON, load failure, malformed paste) → Task 2 Step 5 + Task 4 tests; compatibility (Obsidian/old-Skena) → inherent (cell type unchanged); tests → Tasks 1 & 4; manual smoke → Task 5.
- **Type consistency**: `OutputPlotly.mimeType` = `'application/vnd.plotly.v1+json'` and `.json` used identically in parser (Task 1), NotebookRenderer (Task 3), tests (Task 1). `format: '…| plotly'` widened in types.ts, CellNode, CanvasView addCellNode + pinCellOutput handler, NotebookRenderer pinOutput (Tasks 1/3). `PasteAction` `cell-plotly` `{ json }` consistent across classifier, tests, dispatch arm (Task 4).
- **Delegated-to-implementer checks flagged inline**: exact `pinCellOutput` handler detail line number, whether plotly needs `'unsafe-eval'` (Task 3 Step 5 decision), esbuild copy-call placement in both build branches.
- **No placeholders**: every code step shows complete code; tests inline their fixtures (test/ is gitignored).
