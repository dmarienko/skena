# Canvas HTML Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-10-06-canvas-html-export-design.md`. The command **Skena: Export canvas to HTML** and the MCP tool `canvas_export_html(canvasPath, outPath?)` write a `.canvas` file as one HTML page that loads nothing from the network: every node at its canvas box with its label and its content rendered by skena's own renderers, sections as frames (folded ones drawn unfolded), edges as SVG arrows with their labels, KaTeX/codicon/IBM Plex fonts, images and plotly.js inside the file. The `.canvas` file is only read.

**Architecture:** A pure layout module (`src/shared/exportLayout.ts`) unfolds the folded sections on a copy of the canvas and gives the page box. Pure builders in `src/extension/export/` write the edges (the canvas's own routers, moved to `src/shared/` where needed), each node's HTML (the markup of its webview component as a string), the code cell lines (the preview's shiki tokens and bracket colours) and the page (theme variables, section frames, SVG edge layer, plotly). `exportCanvas.ts` reads the file, renders markdown on the host with the canvas's routing (Typst/MathML renderer or the webview's KaTeX-HTML pipeline), inlines every image, balances each node's HTML and returns the page. `exportCommand.ts` is the only part that imports `vscode`: settings, the open webview's `--vscode-*` variables, knowledge images through `KnowledgeService`, the file write. The MCP tool does not render: it posts to a new `/export` route on the extension's 127.0.0.1 relay (`run-ipc.ts`), found through `SKENA_RUN_IPC` or a `skena-ipc-<hash>.json` file the extension writes to the OS temp dir. Stylesheets with their fonts as data URLs are written to `dist/export-assets/` by the build.

**Tech Stack:** TypeScript 5.9, the VS Code extension API, unified/remark/rehype (remark-math, rehype-katex 7, rehype-raw), KaTeX 0.16, the native Typst compiler `@myriaddreamin/typst-ts-node-compiler` 0.7, shiki 1.29 (`shiki/core` + oniguruma), plotly.js-dist-min 2.35, esbuild bundles + `node --test` (each test file's line 1 holds its run command).

---

## Before you start

- Work on branch `feature/spatial-notebook`. Stage files by name; commit only the files each task names. No attribution lines of any kind in commit messages.
- `.vscode/skena-mcp.js` and the untracked `.vscode/numbered-bookmarks.json` are not yours. Never stage them. `npm run build` rewrites `.vscode/skena-mcp.js`; leave it unstaged.
- **Never write a `.canvas` file.** `/home/quant0/projects/factors/research/review/factors-essentials.canvas` is edited by its user while you work; Task 14 only reads it. Every test writes its scratch files under the OS temp dir.
- If `git commit` fails on `index.lock`, wait a few seconds and run it again. Never delete the lock file.
- Line numbers in this plan are those of `eea4f96`. Find each edit by the quoted text; the numbers may have moved.
- Typecheck baseline at `eea4f96`: `npx tsc --noEmit` reports 3 errors, all `Property 'fsPath' does not exist on type 'ResolvedUri'` in `src/extension/editor-provider.ts` (lines 613-615). They are old. The typecheck command in this plan filters exactly those:

  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"
  ```

  Expected output: nothing.
- `tests/typst-compile.mjs` already fails at `eea4f96` (2 of 3): its ESM bundle has no `require`, so the Typst package does not load. Leave it. The new tests that need Typst bundle with the banner `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`.
- The code in this plan was applied to a copy of `eea4f96` on 2026-10-06, task by task: each test file passed with the counts stated, the typecheck command printed nothing, `npm run build` and the production build succeeded, and the existing `tests/mcp-parity.mjs` (52), `tests/section-lanes.mjs` (49) and `tests/code-cell-shiki.mjs` (9) still passed. Task 14's export of factors-essentials was run outside VS Code (no knowledge server). The VS Code command, the theme request and the relay inside a live extension host have not been run (Tasks 12 and 14, manual checks).

## Why the MCP tool asks the extension instead of rendering

- Bundling `src/extension/markdown-html.ts` into the MCP server (which has no externals) fails: `No loader is configured for ".node" files` (the Typst compiler is a native addon).
- With the Typst package external, the bundle in `/home/quant0/projects/factors/.vscode/skena-mcp.js` cannot `require` it (no `node_modules` above that folder), so every Typst formula would print "Typst not available on this platform".
- `skena.code.theme`, `skena.markdownTheme` and the knowledge server token are not in any settings file of the factors workspace on the server; the extension reads them through `vscode.workspace.getConfiguration`.

So the extension renders, and the MCP tool posts `{ canvasPath, outPath }` to the relay the extension already runs for agent runs.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/edgePath.ts` | create | `waypointPath`, `edgeLabelPoint` (moved out of `LabeledEdge.tsx`). |
| `src/shared/orthogonalRoute.ts` | move | `src/webview/canvas/routing/orthogonal.ts`, taking JSON Canvas side names instead of React Flow's `Position`. |
| `src/webview/canvas/edges/LabeledEdge.tsx` | modify | Import the two modules above. |
| `src/shared/exportLayout.ts` | create | `exportLayout` (groups out, labels, folds undone, sections), `pageBox`, `EXPORT_MARGIN`. |
| `src/extension/export/edges.ts` | create | `exportEdges`: routes, colours, dashes, arrows, label points; `canvasColor`. |
| `src/extension/export/html.ts` | create | `escapeHtml`, `jsonForScript`, `stripActiveHtml`, `imageSources`, `swapImageSources`, `decodeAttr`, `balanceHtml`. |
| `src/extension/export/offlineCheck.ts` | create | `checkOffline`: remote loads on a page, node ids missing from it. |
| `src/shared/dateTime.ts` | create | `fmtDateTime` (moved out of `RailSegment.tsx`). |
| `src/shared/fileHeader.ts` | create | `extractFrontmatter`, `filenameFromUri` (moved out of `NodeHeader.tsx`). |
| `src/webview/rail/RailSegment.tsx`, `src/webview/components/NodeHeader.tsx` | modify | Import the moved helpers. |
| `src/extension/export/nodeHtml.ts` | create | One builder per node type, `placeNode`, `plotlyEmbed`, `notebookHtml`. |
| `src/extension/export/codeHtml.ts` | create | `codeCellHtml`: a code cell's lines as the preview colours them. |
| `src/shared/markdownCodeBlocks.ts` | create | `FACTORS_THEME`, `MARKDOWN_CODE_LANGS`, `highlightCodeBlocks` (moved out of `lib/codeHighlight.ts`). |
| `src/webview/lib/codeHighlight.ts` | modify | Use the shared module. |
| `src/extension/markdown-html.ts` | modify | `renderMarkdownKatexHtml`: the webview `MarkdownRenderer`'s pipeline on the host. |
| `src/extension/export/markdown.ts` | create | `rendersOnHost`, `nodeMarkdownHtml`, `fileMarkdownHtml`. |
| `src/extension/export/page.ts` | create | `buildPage`, `sectionFrames`, `FALLBACK_THEME`. |
| `src/extension/export/export.css` | create | The page's own rules. |
| `scripts/build-export-assets.mjs` | create | `buildExportAssets`: `dist/export-assets/{katex,codicon,ibm-plex,skena}.css`. |
| `esbuild.config.mjs` | modify | Call `buildExportAssets` after each build. |
| `src/extension/export/shikiHost.ts` | create | `exportHighlighter`: shiki core with the code theme, factors, dark-plus and 10 languages. |
| `src/extension/export/exportCanvas.ts` | create | `exportCanvasHtml`, `defaultHtmlPath`, `ExportDeps`. |
| `src/extension/ipcEndpoint.ts` | create | `hashPath`, `endpointFile`, `writeEndpoint`, `readEndpoint`, `removeEndpoint`. |
| `src/extension/llm-adapters/harness.ts` | modify | Import `hashPath`. |
| `src/extension/run-ipc.ts` | modify | `/export` route, `setExportHandler`, `advertise`, endpoint files. |
| `src/shared/types.ts` | modify | `ExportReply`, `MsgExportThemeRequest`, `MsgExportThemeResult`. |
| `src/webview/exportTheme.ts` | create | `exportThemeVars`: the webview's `--vscode-*` variables. |
| `src/webview/App.tsx` | modify | Answer `exportThemeRequest`. |
| `src/extension/editor-provider.ts` | modify | `activeCanvasPath`, `knowledgeAsset`, `requestTheme`, the `exportThemeResult` case. |
| `src/extension/export/exportCommand.ts` | create | `exportToFile`, `exportCommand` (the only `vscode` import of the export). |
| `src/extension/extension.ts`, `package.json` | modify | Register `skena.exportHtml`, the relay's export handler, `advertise`. |
| `src/extension/mcp/server.ts` | modify | The tool `canvas_export_html`. |
| `tests/edge-path.mjs`, `tests/export-layout.mjs`, `tests/export-edges.mjs`, `tests/export-html.mjs`, `tests/export-nodes.mjs`, `tests/export-code.mjs`, `tests/markdown-code-blocks.mjs`, `tests/export-markdown.mjs`, `tests/export-page.mjs`, `tests/export-assets.mjs`, `tests/export-canvas.mjs`, `tests/ipc-endpoint.mjs`, `tests/run-ipc-export.mjs`, `tests/mcp-export.mjs`, `tests/export-check.mjs` | create | node:test files (6, 6, 5, 8, 9, 4, 2, 4, 5, 3, 7, 3, 3, 4, 5 tests). |

---

### Task 1: Edge paths and the fallback router in `src/shared/`

**Files:**
- Create: `src/shared/edgePath.ts`
- Move: `src/webview/canvas/routing/orthogonal.ts` → `src/shared/orthogonalRoute.ts`
- Modify: `src/webview/canvas/edges/LabeledEdge.tsx:33`, `:40-68`, `:182-186`
- Test: `tests/edge-path.mjs`

The export draws the same edge paths as `LabeledEdge`, so the path builder and the per-edge router move to `src/shared/`. `routeOrthogonal` takes the JSON Canvas side names (`'top' | 'right' | 'bottom' | 'left'`, `Side` in `edgeRouting.ts`) instead of React Flow's `Position`; React Flow's `Position` values are those strings, and TypeScript 5.9 accepts a `Position` where that union is expected, so `LabeledEdge` passes `sourcePosition` unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/edge-path.mjs`:

```js
// - run: npx esbuild src/shared/edgePath.ts --bundle --format=esm --outfile=tests/.build/edgePath.mjs && npx esbuild src/shared/orthogonalRoute.ts --bundle --format=esm --outfile=tests/.build/orthogonalRoute.mjs && node --test tests/edge-path.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { edgeLabelPoint, waypointPath } from './.build/edgePath.mjs';
import { ORTHOGONAL_CORNER_R, routeOrthogonal } from './.build/orthogonalRoute.mjs';

// - true when the open segment a-b passes through the inside of rect r grown by pad on every side
function crosses(a, b, r, pad) {
  const xa = Math.min(a[0], b[0]), xb = Math.max(a[0], b[0]);
  const ya = Math.min(a[1], b[1]), yb = Math.max(a[1], b[1]);
  return xb > r.x - pad && xa < r.x + r.w + pad && yb > r.y - pad && ya < r.y + r.h + pad;
}

test('1. a straight edge is a move and a line', () => {
  assert.equal(waypointPath([[0, 0], [100, 0]], ORTHOGONAL_CORNER_R), 'M 0,0 L 100,0');
});

test('2. a corner is cut by the radius and drawn as a quadratic curve through it', () => {
  assert.equal(waypointPath([[0, 0], [100, 0], [100, 100]], 8), 'M 0,0 L 92,0 Q 100,0 100,8 L 100,100');
});

test('3. fewer than two points draw nothing', () => {
  assert.equal(waypointPath([[5, 5]], 8), '');
});

test('4. the label sits in the middle of the middle segment', () => {
  assert.deepEqual(edgeLabelPoint([[0, 0], [100, 0], [100, 100]]), [50, 0]);
  assert.deepEqual(edgeLabelPoint([[0, 0], [0, 40], [60, 40], [60, 100]]), [30, 40]);
});

test('5. the fallback router takes the JSON Canvas side names and keeps every run axis-aligned', () => {
  const pts = routeOrthogonal(0, 50, 'right', 400, 50, 'left', []);
  assert.deepEqual(pts[0], [0, 50]);
  assert.deepEqual(pts[pts.length - 1], [400, 50]);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], `segment ${i} is not axis-aligned`);
  }
});

test('6. the fallback router goes around a box between the two ends', () => {
  const box = { x: 150, y: 0, w: 100, h: 100 };
  const pts = routeOrthogonal(0, 50, 'right', 400, 50, 'left', [box]);
  // - the first and last runs leave and enter the end points; the runs between keep clear of the box
  for (let i = 2; i < pts.length - 1; i++) assert.ok(!crosses(pts[i - 1], pts[i], box, 0), `segment ${i} crosses the box`);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/shared/edgePath.ts --bundle --format=esm --outfile=tests/.build/edgePath.mjs && npx esbuild src/shared/orthogonalRoute.ts --bundle --format=esm --outfile=tests/.build/orthogonalRoute.mjs && node --test tests/edge-path.mjs`

Expected: `✘ [ERROR] Could not resolve "src/shared/edgePath.ts"`.

- [ ] **Step 3: Write `src/shared/edgePath.ts`**

```ts
/**
 * The SVG path of a routed edge and the point its label sits on. LabeledEdge draws the canvas edges
 * with these, and the HTML export draws the same paths. Pure.
 */

export type PathPoint = [number, number];

// - the corner at `via` as a line to where the round starts and a quadratic curve through `via`
function roundedCorner(from: PathPoint, via: PathPoint, to: PathPoint, r: number): string {
  const d1x = from[0] - via[0], d1y = from[1] - via[1];
  const d1  = Math.sqrt(d1x * d1x + d1y * d1y);
  const d2x = to[0] - via[0], d2y = to[1] - via[1];
  const d2  = Math.sqrt(d2x * d2x + d2y * d2y);
  if (d1 < 0.01 || d2 < 0.01) return `L ${via[0]},${via[1]}`;
  const r1  = Math.min(r, d1 / 2);
  const r2  = Math.min(r, d2 / 2);
  const b1x = via[0] + (d1x / d1) * r1, b1y = via[1] + (d1y / d1) * r1;
  const b2x = via[0] + (d2x / d2) * r2, b2y = via[1] + (d2y / d2) * r2;
  return `L ${b1x},${b1y} Q ${via[0]},${via[1]} ${b2x},${b2y}`;
}

/** The polyline `pts` as an SVG path with every corner rounded by `r`; '' for fewer than two points. */
export function waypointPath(pts: readonly PathPoint[], r: number): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) d += ' ' + roundedCorner(pts[i - 1], pts[i], pts[i + 1], r);
  d += ` L ${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
  return d;
}

/** The middle of the polyline's middle segment, where the edge label goes. */
export function edgeLabelPoint(pts: readonly PathPoint[]): PathPoint {
  const mi = Math.max(1, Math.floor(pts.length / 2));
  return [(pts[mi - 1][0] + pts[mi][0]) / 2, (pts[mi - 1][1] + pts[mi][1]) / 2];
}
```

- [ ] **Step 4: Move the router and switch it to side names**

```bash
git mv src/webview/canvas/routing/orthogonal.ts src/shared/orthogonalRoute.ts
```

In `src/shared/orthogonalRoute.ts`, find:

```ts
import { Position } from '@xyflow/react';
```

replace with:

```ts
import type { Side } from './edgeRouting';
```

Find:

```ts
function exitPt(x: number, y: number, pos: Position, len: number = MIN_EXIT): Pt {
  const dx = pos === Position.Right ? 1 : pos === Position.Left  ? -1 : 0;
  const dy = pos === Position.Bottom ? 1 : pos === Position.Top   ? -1 : 0;
```

replace with:

```ts
function exitPt(x: number, y: number, pos: Side, len: number = MIN_EXIT): Pt {
  const dx = pos === 'right'  ? 1 : pos === 'left' ? -1 : 0;
  const dy = pos === 'bottom' ? 1 : pos === 'top'  ? -1 : 0;
```

Find:

```ts
 * Use waypointPath(pts, ORTHOGONAL_CORNER_R) in LabeledEdge to render.
```

replace with:

```ts
 * Drawn with edgePath.waypointPath(pts, ORTHOGONAL_CORNER_R).
```

Find:

```ts
  sx: number, sy: number, sPos: Position,
  tx: number, ty: number, tPos: Position,
```

replace with:

```ts
  sx: number, sy: number, sPos: Side,
  tx: number, ty: number, tPos: Side,
```

Find:

```ts
  const srcH = sPos === Position.Right || sPos === Position.Left;
```

replace with:

```ts
  const srcH = sPos === 'right' || sPos === 'left';
```

- [ ] **Step 5: Point `LabeledEdge` at the shared modules**

In `src/webview/canvas/edges/LabeledEdge.tsx` (line 33), find:

```tsx
import { routeOrthogonal, ORTHOGONAL_CORNER_R, NodeRect } from '../routing/orthogonal';
```

replace with:

```tsx
import { routeOrthogonal, ORTHOGONAL_CORNER_R, type NodeRect } from '../../../shared/orthogonalRoute';
import { edgeLabelPoint, waypointPath } from '../../../shared/edgePath';
```

Delete lines 40-69: from `// ─── SVG path builder ───…` through the closing `}` of `function waypointPath` and the blank line after it, so the line after the imports' blank line is `// - what this file needs of a React Flow node, taken structurally so it does not depend on the`.

Find (line 182):

```tsx
  const edgePath = waypointPath(pts, ORTHOGONAL_CORNER_R);
  // - label at midpoint of the middle segment
  const mi     = Math.max(1, Math.floor(pts.length / 2));
  const labelX = (pts[mi - 1][0] + pts[mi][0]) / 2;
  const labelY = (pts[mi - 1][1] + pts[mi][1]) / 2;
```

replace with:

```tsx
  const edgePath = waypointPath(pts, ORTHOGONAL_CORNER_R);
  const [labelX, labelY] = edgeLabelPoint(pts);
```

- [ ] **Step 6: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 6`, `# pass 6`, `# fail 0`.

Run: `npx esbuild src/shared/edgeRouting.ts --bundle --format=esm --outfile=tests/.build/edgeRouting.mjs && node --test tests/edge-routing.mjs`
Expected: `# pass 23`, `# fail 0`.

Run the typecheck command. Expected: nothing.

- [ ] **Step 7: Commit**

```bash
git add src/shared/edgePath.ts src/shared/orthogonalRoute.ts src/webview/canvas/routing/orthogonal.ts src/webview/canvas/edges/LabeledEdge.tsx tests/edge-path.mjs
git commit -m "refactor(edges): edge path builder and fallback router in src/shared"
```

---

### Task 2: The page layout (pure)

**Files:**
- Create: `src/shared/exportLayout.ts`
- Test: `tests/export-layout.mjs`

`exportLayout` works on copies: `migrateSections` for an old file, `ensureLabels`, groups and edges to groups dropped, then `unfoldLane` once per folded section (`sectionLanes.ts:218`), which moves the sections below down by what the fold took away and keeps the hidden members at their own y. `pageBox` is the box around nodes, section ranges and any extra points (edge routes), plus the margin.

- [ ] **Step 1: Write the failing test**

Create `tests/export-layout.mjs`:

```js
// - run: npx esbuild src/shared/exportLayout.ts --bundle --format=esm --outfile=tests/.build/exportLayout.mjs && node --test tests/export-layout.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EXPORT_MARGIN, exportLayout, pageBox } from './.build/exportLayout.mjs';

const text = (id, x, y, extra = {}) => ({ id, type: 'text', text: id, x, y, width: 700, height: 300, ...extra });

// - section a is folded over n1, which keeps the y it had before the fold; section b moved up to 100
//   with n2 when a folded. A group and an edge to it are in the file too.
function foldedCanvas() {
  return {
    nodes: [
      text('n1', 0, 300, { nodeLabel: 'N1' }),
      text('n2', 0, 150),
      { id: 'g1', type: 'group', x: -50, y: -50, width: 900, height: 900, label: 'old group' },
    ],
    edges: [
      { id: 'e1', fromNode: 'n1', fromSide: 'bottom', toNode: 'n2', toSide: 'top' },
      { id: 'e2', fromNode: 'n2', toNode: 'g1' },
    ],
    metadata: { sections: [{ id: 'a', y: 0, createdAt: 1, title: 'A', folded: ['n1'] }, { id: 'b', y: 100, createdAt: 2 }] },
  };
}

test('1. a folded section is drawn unfolded: its members keep their place, the sections below move down', () => {
  const l = exportLayout(foldedCanvas(), 0);
  const byId = Object.fromEntries(l.nodes.map(n => [n.id, n]));
  assert.equal(byId.n1.y, 300);
  // - a grows to 800 (its minimum height), so b moves from 100 to 800 and n2 by the same 700
  assert.equal(byId.n2.y, 850);
  assert.deepEqual(l.lanes.map(s => [s.id, s.label, s.top, s.bottom, s.folded]), [['a', 'S1', 0, 800, undefined], ['b', 'S2', 800, 1250, undefined]]);
  assert.deepEqual(l.lanes.map(s => s.memberIds), [['n1'], ['n2']]);
  assert.deepEqual(l.foldedLaneIds, ['a']);
});

test('2. groups and the edges that touch them are left out; every node has a label', () => {
  const l = exportLayout(foldedCanvas(), 0);
  assert.deepEqual(l.nodes.map(n => n.id), ['n1', 'n2']);
  assert.deepEqual(l.edges.map(e => e.id), ['e1']);
  assert.deepEqual(l.nodes.map(n => n.nodeLabel), ['N1', 'N2']);
});

test('3. the canvas passed in is not changed', () => {
  const c = foldedCanvas();
  const before = JSON.stringify(c);
  exportLayout(c, 0);
  assert.equal(JSON.stringify(c), before);
});

test('4. a canvas without sections gets no section', () => {
  const l = exportLayout({ nodes: [text('n1', 0, 0)], edges: [] }, 0);
  assert.deepEqual(l.lanes, []);
  assert.deepEqual(l.foldedLaneIds, []);
});

test('5. the page box holds the nodes, the section ranges and the extra points, plus the margin', () => {
  const l = exportLayout(foldedCanvas(), 0);
  assert.deepEqual(pageBox(l, [[-100, 400]]), { left: -140, top: -40, width: 880, height: 1330 });
  assert.equal(EXPORT_MARGIN, 40);
});

test('6. an empty canvas is a page of margin only', () => {
  assert.deepEqual(pageBox({ nodes: [], lanes: [] }, [], 40), { left: -40, top: -40, width: 80, height: 80 });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/shared/exportLayout.ts --bundle --format=esm --outfile=tests/.build/exportLayout.mjs && node --test tests/export-layout.mjs`

Expected: `✘ [ERROR] Could not resolve "src/shared/exportLayout.ts"`.

- [ ] **Step 3: Write `src/shared/exportLayout.ts`**

```ts
/**
 * Where everything sits on the exported HTML page: the canvas nodes at their own x/y/width/height,
 * every section unfolded with its members placed where an unfold puts them, and the page box
 * around all of it. Pure; the HTML export (src/extension/export) builds the page from this.
 */

import { deriveLanes, isGroup, migrateSections, sortLanes, unfoldLane, type DerivedLane, type SectionLane } from './sectionLanes';
import { ensureLabels } from './nodeLabels';
import type { CanvasData, CanvasEdge, CanvasNode } from './types';

/** - px of empty page around the content */
export const EXPORT_MARGIN = 40;

export interface ExportLayout {
  /** - every node but the groups, each with a label, folded members moved to where an unfold puts them */
  nodes: CanvasNode[];
  /** - the edges whose two ends are both in `nodes` */
  edges: CanvasEdge[];
  /** - every section, none folded; empty when the canvas has no sections */
  lanes: DerivedLane[];
  /** - ids of the sections that are folded on the canvas */
  foldedLaneIds: string[];
}

/** The page's top-left corner in canvas coordinates, and its size. */
export interface PageBox { left: number; top: number; width: number; height: number }

function hasSections(canvas: CanvasData): boolean {
  return (canvas.metadata?.sections?.length ?? 0) > 0 || canvas.nodes.some(n => (n as { type?: string }).type === 'section');
}

/**
 * The canvas as the export draws it. The file's data is not changed: labels, the section migration
 * and the unfolds are applied to copies. A canvas without sections gets none (the seed lane the
 * migration adds for the webview is dropped).
 */
export function exportLayout(canvas: CanvasData, now: number): ExportLayout {
  const migrated = migrateSections(canvas, now);
  let nodes = ensureLabels(migrated.nodes).filter(n => !isGroup(n));
  const ids = new Set(nodes.map(n => n.id));
  const edges = migrated.edges.filter(e => ids.has(e.fromNode) && ids.has(e.toNode));
  let lanes: SectionLane[] = hasSections(canvas) ? sortLanes(migrated.metadata?.sections ?? []) : [];
  const foldedLaneIds = lanes.filter(l => l.folded).map(l => l.id);
  for (const id of foldedLaneIds) {
    const r = unfoldLane(lanes, nodes, id);
    nodes = nodes.map(n => (r.nodeShifts[n.id] ? { ...n, y: n.y + r.nodeShifts[n.id] } : n));
    lanes = r.lanes;
  }
  return { nodes, edges, lanes: deriveLanes(nodes, lanes), foldedLaneIds };
}

/**
 * The page box: the nodes, the section ranges and `extra` points (edge routes, label anchors), with
 * `margin` on every side. Sections add their top and bottom only; their frames span the page width.
 */
export function pageBox(layout: Pick<ExportLayout, 'nodes' | 'lanes'>, extra: readonly [number, number][], margin = EXPORT_MARGIN): PageBox {
  const xs: number[] = [], ys: number[] = [];
  for (const n of layout.nodes) { xs.push(n.x, n.x + n.width); ys.push(n.y, n.y + n.height); }
  for (const l of layout.lanes) ys.push(l.top, l.bottom);
  for (const [x, y] of extra) { xs.push(x); ys.push(y); }
  if (xs.length === 0) xs.push(0);
  if (ys.length === 0) ys.push(0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { left: minX - margin, top: minY - margin, width: maxX - minX + 2 * margin, height: maxY - minY + 2 * margin };
}
```

- [ ] **Step 4: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 6`, `# pass 6`, `# fail 0`. Typecheck: nothing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/exportLayout.ts tests/export-layout.mjs
git commit -m "feat(export): page layout with every section unfolded"
```

---

### Task 3: The edges of the page (pure)

**Files:**
- Create: `src/extension/export/edges.ts`
- Test: `tests/export-edges.mjs`

As on the canvas: the edges whose two ends are in one section go through `routeSection` together (`CanvasView.tsx:934-954`); any other edge, or one `routeSection` gives up on, goes through `routeOrthogonal` from the middle of the named side (`facingSide` when the edge names none). Colour: the edge's own, else the border colour of the node it leaves (`palette.nodeBorderColor`). The code → output link (route kind `output`) is dotted. Widths are `LabeledEdge`'s at zoom 1: 1 px × `BORDER_WIDTH_SCALE` 1.8.

`src/extension/export/` imports a few pure webview modules (`canvas/palette.ts`, `canvas/codeCellShiki.ts`, `canvas/codeCellView.ts`, `canvas/nodes/knowledgeHtml.ts`): they touch no DOM at import, and the tests already bundle them for node.

- [ ] **Step 1: Write the failing test**

Create `tests/export-edges.mjs`:

```js
// - run: npx esbuild src/shared/exportLayout.ts --bundle --format=esm --outfile=tests/.build/exportLayout.mjs && npx esbuild src/extension/export/edges.ts --bundle --format=esm --outfile=tests/.build/exportEdges.mjs && node --test tests/export-edges.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { exportLayout } from './.build/exportLayout.mjs';
import { EDGE_WIDTH, exportEdges } from './.build/exportEdges.mjs';

const box = (id, type, x, y, extra = {}) => ({ id, type, x, y, width: 700, height: 300, ...extra });
const one = (canvas, id) => exportEdges(exportLayout(canvas, 0)).find(e => e.id === id);
const lanes = ys => ({ sections: ys.map((y, i) => ({ id: `s${i}`, y, createdAt: i })) });

test('1. an edge inside a section leaves and enters the middle of the sides it names', () => {
  const e = one({
    nodes: [box('a', 'text', 0, 0), box('b', 'text', 900, 0)],
    edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'uses' }],
    metadata: lanes([0]),
  }, 'e');
  assert.deepEqual(e.points[0], [700, 150]);
  assert.deepEqual(e.points[e.points.length - 1], [900, 150]);
  assert.ok(e.d.startsWith('M 700,150'));
  assert.equal(e.label, 'uses');
  assert.equal(e.labelAt[1], 150);
  assert.ok(e.labelAt[0] > 700 && e.labelAt[0] < 900);
});

test('2. colour: the edge colour wins, else the border colour of the node it leaves', () => {
  const canvas = {
    nodes: [box('a', 'text', 0, 0), box('b', 'text', 900, 0, { color: '4' }), box('c', 'text', 1800, 0)],
    edges: [
      { id: 'plain', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' },
      { id: 'set', fromNode: 'a', fromSide: 'bottom', toNode: 'c', toSide: 'bottom', color: '1', toEnd: 'none' },
      { id: 'accent', fromNode: 'b', fromSide: 'right', toNode: 'c', toSide: 'left' },
    ],
    metadata: lanes([0]),
  };
  const all = Object.fromEntries(exportEdges(exportLayout(canvas, 0)).map(e => [e.id, e]));
  assert.equal(all.plain.color, '#1f96bd');
  assert.equal(all.set.color, '#fb464c');
  assert.equal(all.accent.color, '#44cf6e');
  assert.equal(all.plain.arrow, true);
  assert.equal(all.set.arrow, false);
});

test('3. the link from a code cell to its output is dotted, other links are not', () => {
  const canvas = {
    nodes: [box('code', 'code', 0, 0, { code: 'x', outputNodeId: 'out' }), box('out', 'cell', 900, 0, { format: 'html', content: '' }), box('n', 'text', 0, 500)],
    edges: [
      { id: 'o', fromNode: 'code', fromSide: 'right', toNode: 'out', toSide: 'left' },
      { id: 'c', fromNode: 'code', fromSide: 'bottom', toNode: 'n', toSide: 'top' },
    ],
    metadata: lanes([0]),
  };
  const all = Object.fromEntries(exportEdges(exportLayout(canvas, 0)).map(e => [e.id, e]));
  assert.equal(all.o.dashed, true);
  assert.equal(all.c.dashed, false);
  assert.equal(all.o.color, '#02542e');
  assert.equal(EDGE_WIDTH, 1.8);
});

test('4. an edge between two sections is routed on its own, from side middle to side middle', () => {
  const e = one({
    nodes: [box('a', 'text', 0, 0), box('b', 'text', 0, 900)],
    edges: [{ id: 'x', fromNode: 'a', fromSide: 'bottom', toNode: 'b', toSide: 'top' }],
    metadata: lanes([0, 800]),
  }, 'x');
  assert.deepEqual(e.points[0], [350, 300]);
  assert.deepEqual(e.points[e.points.length - 1], [350, 900]);
  assert.equal(e.dashed, false);
});

test('5. an edge with no sides faces the other node', () => {
  const e = one({ nodes: [box('a', 'text', 0, 0), box('b', 'text', 900, 0)], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] }, 'e');
  assert.deepEqual(e.points[0], [700, 150]);
  assert.deepEqual(e.points[e.points.length - 1], [900, 150]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/shared/exportLayout.ts --bundle --format=esm --outfile=tests/.build/exportLayout.mjs && npx esbuild src/extension/export/edges.ts --bundle --format=esm --outfile=tests/.build/exportEdges.mjs && node --test tests/export-edges.mjs`

Expected: `✘ [ERROR] Could not resolve "src/extension/export/edges.ts"`.

- [ ] **Step 3: Write `src/extension/export/edges.ts`**

```ts
/**
 * The edges of the exported page, routed as the canvas routes them: every edge inside one section
 * by that section's routing pass (shared/edgeRouting.ts, as CanvasView runs it), any other edge by
 * the per-edge router LabeledEdge falls back to. Colours, dashes and arrows follow LabeledEdge at
 * zoom 1. Pure.
 */

import { borderPoint, facingSide, routeSection, sideOfHandle, type EdgeKind, type Point, type RoutedEdge, type RouteNode, type Side } from '../../shared/edgeRouting';
import { ORTHOGONAL_CORNER_R, routeOrthogonal } from '../../shared/orthogonalRoute';
import { edgeLabelPoint, waypointPath } from '../../shared/edgePath';
import { CANVAS_COLORS } from '../../shared/constants';
import type { ExportLayout } from '../../shared/exportLayout';
import type { CanvasNode } from '../../shared/types';
import { nodeBorderColor } from '../../webview/canvas/palette';

/** - LabeledEdge's 1 px line through the node border scaler at zoom 1 (BORDER_WIDTH_SCALE 1.8) */
export const EDGE_WIDTH = 1.8;
export const EDGE_OPACITY = 0.6;
// - an edge whose source type has no border colour (THEME.dark.edgeContext in palette.ts)
const FALLBACK_COLOR = '#9a8fc4';

export interface ExportEdge {
  id: string;
  points: Point[];
  /** - SVG path data, corners rounded as on the canvas */
  d: string;
  label?: string;
  labelAt: Point;
  color: string;
  /** - the code → output link is dotted */
  dashed: boolean;
  arrow: boolean;
}

/** - a JSON Canvas colour ('1'…'6' or a hex) as the hex the canvas draws */
export function canvasColor(code?: string): string | undefined {
  return code ? CANVAS_COLORS[code] ?? code : undefined;
}

const toRouteNode = (n: CanvasNode): RouteNode => ({
  id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height,
  outputNodeId: (n as { outputNodeId?: string }).outputNodeId,
});

export function exportEdges(layout: Pick<ExportLayout, 'nodes' | 'edges' | 'lanes'>): ExportEdge[] {
  const byId = new Map(layout.nodes.map(n => [n.id, n] as const));
  const routes = new Map<string, RoutedEdge>();
  for (const lane of layout.lanes) {
    const member = new Set(lane.memberIds);
    const nodes = layout.nodes.filter(n => member.has(n.id));
    const edges = layout.edges
      .filter(e => member.has(e.fromNode) && member.has(e.toNode))
      .map(e => ({ id: e.id, source: e.fromNode, target: e.toNode, sourceSide: sideOfHandle(e.fromSide), targetSide: sideOfHandle(e.toSide) }));
    if (edges.length === 0) continue;
    for (const r of routeSection(nodes.map(toRouteNode), edges)) routes.set(r.id, r);
  }
  const rects = layout.nodes.map(n => ({ x: n.x, y: n.y, w: n.width, h: n.height }));
  return layout.edges.map(e => {
    const s = byId.get(e.fromNode) as CanvasNode;
    const t = byId.get(e.toNode) as CanvasNode;
    const route = routes.get(e.id);
    let points: Point[];
    if (route && !route.fallback && route.points.length >= 2) points = route.points;
    else {
      const sb = { x: s.x, y: s.y, w: s.width, h: s.height };
      const tb = { x: t.x, y: t.y, w: t.width, h: t.height };
      const ss: Side = sideOfHandle(e.fromSide) ?? facingSide(sb, tb);
      const ts: Side = sideOfHandle(e.toSide) ?? facingSide(tb, sb);
      const [sx, sy] = borderPoint(sb, ss, 0);
      const [tx, ty] = borderPoint(tb, ts, 0);
      points = routeOrthogonal(sx, sy, ss, tx, ty, ts, rects);
    }
    const kind: EdgeKind = route?.kind ?? 'context';
    return {
      id: e.id,
      points,
      d: waypointPath(points, ORTHOGONAL_CORNER_R),
      label: e.label || undefined,
      labelAt: edgeLabelPoint(points),
      color: canvasColor(e.color) ?? nodeBorderColor(s.type, canvasColor(s.color)) ?? FALLBACK_COLOR,
      dashed: kind === 'output',
      arrow: e.toEnd === 'arrow' || !e.toEnd,
    };
  });
}
```

- [ ] **Step 4: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 5`, `# pass 5`, `# fail 0`. Typecheck: nothing.

- [ ] **Step 5: Commit**

```bash
git add src/extension/export/edges.ts tests/export-edges.mjs
git commit -m "feat(export): edges routed and coloured as on the canvas"
```

---

### Task 4: HTML helpers and the offline check (pure)

**Files:**
- Create: `src/extension/export/html.ts`, `src/extension/export/offlineCheck.ts`
- Test: `tests/export-html.mjs`

In the webview, cell and knowledge html goes in through `innerHTML`: scripts do not run, and each node's markup is closed inside the node. A static page does neither, so `stripActiveHtml` takes out what would run or load (scripts, iframes, objects, links, `srcset`, CSS `@import` and remote `url()`, event handlers and `javascript:` urls via `sanitizeHtmlAttrs`), and `balanceHtml` parses each node's html and writes it back closed (rehype-raw, which `MarkdownRenderer` already uses). `checkOffline` is what Task 14 runs on the real page: it ignores script bodies (plotly.min.js holds map-tile URLs it loads only for map traces) and `<a href>` links.

- [ ] **Step 1: Write the failing test**

Create `tests/export-html.mjs`:

```js
// - run: npx esbuild src/extension/export/html.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportHtml.mjs && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-html.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { balanceHtml, decodeAttr, escapeHtml, imageSources, jsonForScript, stripActiveHtml, swapImageSources } from './.build/exportHtml.mjs';
import { checkOffline } from './.build/offlineCheck.mjs';

test('1. escaping text and attribute values', () => {
  assert.equal(escapeHtml(`a<b & "c">`), 'a&lt;b &amp; &quot;c&quot;&gt;');
  assert.equal(decodeAttr('a&#x26;b&amp;c&#60;'), 'a&b&c<');
});

test('2. JSON in a script element cannot close it, and still parses to the same value', () => {
  const json = JSON.stringify({ t: '</script><b>x</b>' });
  const safe = jsonForScript(json);
  assert.ok(!safe.includes('</script'));
  assert.deepEqual(JSON.parse(safe), JSON.parse(json));
});

test('3. nothing that runs or loads is left in cell html; the rest is kept', () => {
  const html = [
    '<p onclick="x()">keep</p>',
    '<script src="https://cdn.example.com/a.js"></script>',
    '<script>alert(1)</script>',
    '<iframe src="https://example.com"></iframe>',
    '<link rel="stylesheet" href="https://example.com/s.css">',
    '<style>@import url(https://example.com/x.css); .a { background: url(https://example.com/i.png) }</style>',
    '<img src="data:image/png;base64,AAAA" srcset="https://example.com/2x.png 2x">',
    '<a href="javascript:alert(1)">j</a>',
    '<pre>&lt;script&gt;shown as text&lt;/script&gt;</pre>',
  ].join('\n');
  const out = stripActiveHtml(html);
  assert.ok(out.includes('<p>keep</p>'));
  assert.ok(!/<script|<iframe|<link|@import|srcset|onclick|javascript:/i.test(out));
  assert.ok(!out.includes('url(https://'));
  assert.ok(out.includes('&lt;script&gt;shown as text'));
  assert.ok(out.includes('<img src="data:image/png;base64,AAAA"'));
});

test('4. image sources: every non-data src once, as written', () => {
  const html = '<img src="a.png" alt="A"><img src=\'crtx://lib/x.jpeg\'><img src="data:image/png;base64,AA"><img src="a.png">';
  assert.deepEqual(imageSources(html), ['a.png', 'crtx://lib/x.jpeg']);
});

test('5. a resolved image gets its data url; one that could not be read shows its alt text and address', () => {
  const html = '<p><img src="a.png" alt="plot"> <img src="b.png" alt="gone"> <img src="c.png"></p>';
  const out = swapImageSources(html, new Map([['a.png', 'data:image/png;base64,QQ=='], ['b.png', null]]));
  assert.ok(out.includes('<img src="data:image/png;base64,QQ==" alt="plot">'));
  assert.ok(out.includes('<span class="skena-export-missing" title="b.png">[image: gone — b.png]</span>'));
  assert.ok(out.includes('<img src="c.png">'));
});

test('6. the offline check finds remote loads and ignores links, script bodies and local data', () => {
  const page = [
    '<link rel="stylesheet" href="https://fonts.example.com/f.css">',
    '<img src="//cdn.example.com/x.png">',
    '<img src="data:image/png;base64,AA">',
    '<a href="https://example.com/paper">paper</a>',
    '<script>var u = "<img src=\\"https://plotly.com/x.png\\">";</script>',
    '<script src="https://cdn.example.com/p.js"></script>',
    '<style>.a { background: url("https://example.com/i.png") }</style>',
    '<div style="background:url(https://example.com/j.png)"></div>',
    '<svg><use xlink:href="#g1"></use></svg>',
    '<div data-node-id="n1"></div>',
  ].join('\n');
  const r = checkOffline(page, ['n1', 'n2']);
  assert.deepEqual(r.remote, [
    'link href=https://fonts.example.com/f.css',
    'img src=//cdn.example.com/x.png',
    'script src=https://cdn.example.com/p.js',
    'css https://example.com/i.png',
    'css https://example.com/j.png',
  ]);
  assert.deepEqual(r.missingNodeIds, ['n2']);
});

test('7. a clean page passes', () => {
  const r = checkOffline('<div data-node-id="a&amp;b"><img src="data:image/png;base64,AA"></div>', ['a&b']);
  assert.deepEqual(r, { remote: [], missingNodeIds: [] });
});

test('8. a fragment is closed inside itself; JSON in a script, a template, SVG and MathML come back as they were', () => {
  assert.equal(balanceHtml('<div><p>a</div><b>x'), '<div><p>a</p></div><b>x</b>');
  const kept = [
    '<script type="application/json" id="f">{"a":"\\u003cb>"}</script>',
    '<template shadowrootmode="open"><p>x</p></template>',
    '<svg viewBox="0 0 1 1"><use xlink:href="#g1"></use></svg>',
    '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></span>',
  ];
  for (const k of kept) assert.equal(balanceHtml(k), k);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/extension/export/html.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportHtml.mjs && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-html.mjs`

Expected: `✘ [ERROR] Could not resolve "src/extension/export/html.ts"`.

- [ ] **Step 3: Write `src/extension/export/html.ts`**

```ts
/**
 * String helpers for the exported page: escaping, JSON inside a script element, and the HTML that
 * goes into it from cells, knowledge servers and files made static: nothing in it runs and nothing
 * in it loads from the network. Pure.
 */

import { unified } from 'unified';
import rehypeRaw from 'rehype-raw';
import { toHtml } from 'hast-util-to-html';
import type { Root } from 'hast';
import { sanitizeHtmlAttrs } from '../../webview/canvas/nodes/knowledgeHtml';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** - JSON text that can sit inside <script type="application/json">: no "</script" can end it early. JSON.parse reads \u003c back as "<". */
export function jsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

const ELEMENTS_WITH_BODY = /<(script|iframe|object|embed|frame|frameset|applet|noscript)\b[\s\S]*?<\/\1\s*>/gi;
// - an opening tag left without its closing one, and the void elements that load or redirect
const LONE_TAGS = /<(?:script|iframe|object|embed|frame|frameset|applet|link|base)\b[^>]*>|<meta\b[^>]*http-equiv[^>]*>/gi;
const SRCSET = /\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const CSS_IMPORT = /@import\s+[^;]*;/gi;
const CSS_REMOTE_URL = /url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi;

/**
 * `html` with everything that would run or load in a static page taken out: script, iframe, object,
 * embed and link elements, http-equiv meta, srcset, CSS @import and remote url(), event handler
 * attributes and javascript: urls (sanitizeHtmlAttrs). In the webview this html goes in through
 * innerHTML, where scripts do not run either.
 */
export function stripActiveHtml(html: string): string {
  const out = html
    .replace(ELEMENTS_WITH_BODY, '')
    .replace(LONE_TAGS, '')
    .replace(SRCSET, '')
    .replace(CSS_IMPORT, '')
    .replace(CSS_REMOTE_URL, 'none');
  return sanitizeHtmlAttrs(out);
}

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ALT_ATTR = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** The src of every <img> in `html` that is not a data: url, as written in the attribute, each once. */
export function imageSources(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(IMG_TAG) ?? []) {
    const m = SRC_ATTR.exec(tag);
    const src = m ? m[1] ?? m[2] ?? m[3] ?? '' : '';
    if (src && !/^data:/i.test(src)) out.add(src);
  }
  return [...out];
}

/**
 * Every <img> whose src is a key of `resolved`: a string replaces the src (a data: url), null
 * replaces the image with its alt text and the address it could not be read from. Other images
 * are left as they are.
 */
export function swapImageSources(html: string, resolved: ReadonlyMap<string, string | null>): string {
  return html.replace(IMG_TAG, tag => {
    const m = SRC_ATTR.exec(tag);
    const src = m ? m[1] ?? m[2] ?? m[3] ?? '' : '';
    if (!m || !resolved.has(src)) return tag;
    const got = resolved.get(src);
    if (got) return tag.slice(0, m.index) + `src="${escapeHtml(got)}"` + tag.slice(m.index + m[0].length);
    const alt = ALT_ATTR.exec(tag);
    const text = alt ? decodeAttr(alt[1] ?? alt[2] ?? '') : '';
    const where = decodeAttr(src);
    return `<span class="skena-export-missing" title="${escapeHtml(where)}">[image${text ? `: ${escapeHtml(text)}` : ''} — ${escapeHtml(where)}]</span>`;
  });
}

/** - an attribute value as written, with its character references decoded (for reading a file or a url) */
export function decodeAttr(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const parser = unified().use(rehypeRaw);

/**
 * `fragment` parsed as the browser parses it and written back, so every element it opens is closed
 * inside it. The webview puts each node's html in with innerHTML, which does this per node; one
 * static page has no such boundary, and an unclosed <div> in a cell (capOutputHtml cuts long html
 * at a byte count) would swallow every node after it.
 */
export function balanceHtml(fragment: string): string {
  const tree = parser.runSync({ type: 'root', children: [{ type: 'raw', value: fragment }] } as Root);
  return toHtml(tree as Root);
}
```

- [ ] **Step 4: Write `src/extension/export/offlineCheck.ts`**

```ts
/**
 * Checks an exported page: no element loads anything over the network, and every node is on it.
 * Script bodies are not read (plotly.min.js holds URLs it never loads unless a map trace asks), and
 * an <a href> is a link, not a load. Pure.
 */

import { escapeHtml } from './html';

export interface OfflineReport {
  /** - "<tag> <attr>=<value>" or "css <url>" for each remote load found */
  remote: string[];
  /** - node ids with no data-node-id attribute on the page */
  missingNodeIds: string[];
}

const SCRIPT_BODY = /(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi;
const LOADING_TAG = /<(script|link|img|iframe|source|video|audio|embed|object|image|track|input|frame)\b([^>]*)>/gi;
const LOADING_ATTR = /(?:^|\s)(src|href|srcset|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const STYLE_BODY = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_REMOTE = /(?:url\(\s*['"]?|@import\s+['"])((?:https?:)?\/\/[^'")\s]*)/gi;
const REMOTE = /^\s*(?:https?:)?\/\//i;

export function checkOffline(html: string, nodeIds: readonly string[]): OfflineReport {
  const page = html.replace(SCRIPT_BODY, '$1$2');
  const remote: string[] = [];
  for (const [, tag, attrs] of page.matchAll(LOADING_TAG)) {
    for (const [, name, dq, sq, bare] of attrs.matchAll(LOADING_ATTR)) {
      const value = dq ?? sq ?? bare ?? '';
      const parts = name.toLowerCase() === 'srcset' ? value.split(',').map(p => p.trim().split(/\s+/)[0]) : [value];
      if (parts.some(p => REMOTE.test(p))) remote.push(`${tag.toLowerCase()} ${name}=${value}`);
    }
  }
  const css: string[] = [];
  for (const [, body] of page.matchAll(STYLE_BODY)) css.push(body);
  for (const [, dq, sq] of page.matchAll(STYLE_ATTR)) css.push(dq ?? sq ?? '');
  for (const text of css) for (const [, url] of text.matchAll(CSS_REMOTE)) remote.push(`css ${url}`);
  const missingNodeIds = nodeIds.filter(id => !html.includes(`data-node-id="${escapeHtml(id)}"`));
  return { remote, missingNodeIds };
}
```

- [ ] **Step 5: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 8`, `# pass 8`, `# fail 0`. Typecheck: nothing.

- [ ] **Step 6: Commit**

```bash
git add src/extension/export/html.ts src/extension/export/offlineCheck.ts tests/export-html.mjs
git commit -m "feat(export): static html helpers and the offline check"
```

---

### Task 5: One node as HTML (pure)

**Files:**
- Create: `src/shared/dateTime.ts`, `src/shared/fileHeader.ts`, `src/extension/export/nodeHtml.ts`
- Modify: `src/webview/rail/RailSegment.tsx:5`, `:9-14`; `src/webview/components/NodeHeader.tsx:9`, `:20-48`
- Test: `tests/export-nodes.mjs`

Each builder writes the markup of its webview component without React Flow, Monaco or buttons: the same `.skena-node` classes and type classes (so `canvas.css` and `markdown.css` style them), the border at zoom 1 (1.5 px × 1.8 = 2.7 px, dashed for output cells), the header rows of the knowledge, code, file and chat nodes, the label badge in the top-right corner and the AI pill. The kernel node draws its label inside its ring, as on the canvas. `fmtDateTime` (section titles, knowledge fetch dates) and the frontmatter reader of `NodeHeader` move to `src/shared/` so the host can use them; the webview files import them back.

- [ ] **Step 1: Write the failing test**

Create `tests/export-nodes.mjs`:

```js
// - run: npx esbuild src/extension/export/nodeHtml.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportNodes.mjs && node --test tests/export-nodes.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  cellNodeHtml, chatNodeHtml, codeNodeHtml, fileNodeHtml, kernelNodeHtml, knowledgeNodeHtml, linkNodeHtml,
  noderefNodeHtml, notebookHtml, placeNode, portalNodeHtml, textNodeHtml,
} from './.build/exportNodes.mjs';

const at = { x: 100, y: 200, width: 700, height: 300 };

test('1. a node sits at its canvas box and carries its id and label', () => {
  const html = placeNode({ id: 'n"1', type: 'text', text: '', nodeLabel: 'N1', createdBy: 'ai', ...at }, '<p>x</p>');
  assert.ok(html.startsWith('<div class="skena-export-node" data-node-id="n&quot;1" data-label="N1" style="left:100px;top:200px;width:700px;height:300px;'));
  assert.ok(html.includes('<span class="skena-export-label">N1</span>'));
  assert.ok(html.includes('<span class="skena-export-ai">AI</span>'));
});

test('2. a text note: the markdown html in a scroll box, in the text border colour', () => {
  const html = textNodeHtml({ id: 't', type: 'text', text: '', nodeLabel: 'N2', ...at }, '<p>hello</p>');
  assert.ok(html.includes('class="skena-node skena-node--text" style="border:2.7px solid #1f96bd;'));
  assert.ok(html.includes('<div class="skena-markdown"><p>hello</p></div>'));
});

test('3. a knowledge node: server, title and fetch date, then the stored text without anything that runs', () => {
  const node = { id: 'w', type: 'knowledge', server: 'crtx', uri: 'crtx://x', title: 'A <paper>', text: '', fetchedAt: '2026-10-06T09:18:30.018Z', nodeLabel: 'W1', ...at };
  const html = knowledgeNodeHtml(node, '<p onclick="x()">body</p>');
  assert.ok(html.includes('>crtx</span>'));
  assert.ok(html.includes('A &lt;paper&gt;'));
  assert.ok(/fetched 2026-10-0\d \d\d:\d\d/.test(html));
  assert.ok(html.includes('<p>body</p>'));
});

test('4. a code cell: language and status glyph in its header, the lines below', () => {
  const html = codeNodeHtml({ id: 'c', type: 'code', code: 'x = 1', language: 'python', lastStatus: 'ok', nodeLabel: 'E1', ...at }, '<pre>LINES</pre>');
  assert.ok(html.includes('>python</span>'));
  assert.ok(html.includes('✓'));
  assert.ok(html.includes('<pre>LINES</pre>'));
});

test('5. output cells: an image inline, html without scripts, a plotly figure as escaped JSON with its plot size', () => {
  const img = cellNodeHtml({ id: 'i', type: 'cell', format: 'image', content: 'data:image/png;base64,AA', ...at }, null);
  assert.ok(img.includes('<img src="data:image/png;base64,AA"'));
  assert.ok(img.includes('dashed #1f96bd'));
  const html = cellNodeHtml({ id: 'h', type: 'cell', format: 'html', content: '<table><tr><td>1</td></tr></table><script>alert(1)</script>', ...at }, null);
  assert.ok(html.includes('<div class="skena-cell-html"><table>'));
  assert.ok(!html.includes('alert'));
  const fig = JSON.stringify({ data: [{ name: '</script>' }], layout: {} });
  const plot = cellNodeHtml({ id: 'p', type: 'cell', format: 'plotly', content: fig, ...at }, null);
  assert.ok(plot.includes('data-plotly="skena-fig-p" data-w="678.6" data-h="282.6"'));
  assert.ok(plot.includes('<script type="application/json" id="skena-fig-p">'));
  assert.equal(plot.match(/<\/script>/g).length, 1);
});

test('6. a file node: the header title and the rendered body', () => {
  const html = fileNodeHtml({ id: 'f', type: 'file', file: 'docs/a.md', nodeLabel: 'M1', ...at }, { fileType: 'markdown', title: 'Plan', status: 'research', body: '<div class="skena-markdown"><h1>Plan</h1></div>' });
  assert.ok(html.includes('codicon-markdown'));
  assert.ok(html.includes('>Plan</span>'));
  assert.ok(html.includes('>research</span>'));
  assert.ok(html.includes('<h1>Plan</h1>'));
});

test('7. a link: host and address as text and as a link, and no image', () => {
  const html = linkNodeHtml({ id: 'l', type: 'link', url: 'https://claude.ai/artifact/x?a=1&b=2', nodeLabel: 'L1', ...at });
  assert.ok(html.includes('>claude.ai</div>'));
  assert.ok(html.includes('<a href="https://claude.ai/artifact/x?a=1&amp;b=2"'));
  assert.ok(!html.includes('<img'));
});

test('8. portal, reference, kernel and chat nodes draw their own shapes; the kernel shows its label inside', () => {
  assert.ok(portalNodeHtml({ id: 'p', type: 'portal', canvas: '../a/other.canvas', nodeLabel: 'P1', ...at }).includes('>other</span>'));
  assert.ok(noderefNodeHtml({ id: 'r', type: 'noderef', canvas: 'x/other.canvas', label: 'N3', nodeLabel: 'R1', ...at }).includes('other › N3'));
  const k = kernelNodeHtml({ id: 'k', type: 'kernel', server: 's', displayName: 'factors', colorIndex: 1, nodeLabel: 'K1', ...at });
  assert.ok(k.includes('factors :: —'));
  assert.ok(k.includes('>K1</div>'));
  assert.ok(!k.includes('skena-export-label'));
  assert.ok(chatNodeHtml({ id: 'h', type: 'chat', title: 'Ask', agent: 'claude', ...at }).includes('>Ask</span>'));
});

test('9. a notebook: markdown cells as rendered, the outputs, the source only when asked', () => {
  const nb = { kernelName: 'python3', languageName: 'python', cellCount: 3, cells: [
    { type: 'markdown', source: '# T', outputs: [] },
    { type: 'code', source: 'print(1)', outputs: [{ mimeType: 'text/plain', text: '1 < 2' }], executionCount: 4 },
    { type: 'code', source: 'x = 1', outputs: [] },
  ] };
  const code = s => `<pre>${s}</pre>`;
  const html = notebookHtml(nb, ['<h1>T</h1>', '', ''], false, code, 'f', 600);
  assert.ok(html.includes('<div class="skena-markdown"><h1>T</h1></div>'));
  assert.ok(html.includes('<pre class="skena-notebook__text-output">1 &lt; 2</pre>'));
  assert.ok(!html.includes('print(1)') && !html.includes('x = 1'));
  const withSource = notebookHtml(nb, ['<h1>T</h1>', '', ''], true, code, 'f', 600);
  assert.ok(withSource.includes('[4]</span><pre>print(1)</pre>'));
  assert.ok(withSource.includes('[ ]</span><pre>x = 1</pre>'));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/extension/export/nodeHtml.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportNodes.mjs && node --test tests/export-nodes.mjs`

Expected: `✘ [ERROR] Could not resolve "src/extension/export/nodeHtml.ts"`.

- [ ] **Step 3: Move `fmtDateTime` and the frontmatter reader**

Create `src/shared/dateTime.ts`:

```ts
/** - 'YYYY-MM-DD HH:MM' local time; the title of an untitled section */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
```

In `src/webview/rail/RailSegment.tsx`, find (line 5):

```tsx
import type { RailKernel } from './SectionRail';
```

replace with:

```tsx
import type { RailKernel } from './SectionRail';
import { fmtDateTime } from '../../shared/dateTime';
```

Find (lines 9-14):

```tsx
// - 'YYYY-MM-DD HH:MM' local time; the title of an untitled section
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
```

replace with (`SectionSeparators.tsx` and `CanvasView.tsx` keep importing it from here):

```tsx
export { fmtDateTime };
```

Create `src/shared/fileHeader.ts`:

```ts
/**
 * What a file node's header shows: the frontmatter fields of a markdown file and the file name.
 * NodeHeader draws them on the canvas; the HTML export draws the same row.
 */

export interface Frontmatter {
  title?:  string;
  status?: string;
  type?:   string;
  score?:  string;
}

// - a lightweight regex parse for display only (gray-matter runs in the extension host)
export function extractFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Frontmatter = {};
  for (const line of match[1].split('\n')) {
    const [k, ...rest] = line.split(':');
    const key = k?.trim();
    const val = rest.join(':').trim().replace(/^["']|["']$/g, '');
    if (key === 'title')  fm.title  = val;
    if (key === 'status') fm.status = val;
    if (key === 'type')   fm.type   = val;
    if (key === 'score')  fm.score  = val;
  }
  return fm;
}

export function filenameFromUri(uri: string): string {
  return uri.split('/').pop()?.replace(/\.(md|ipynb|py|yaml|yml)$/, '') ?? uri;
}
```

In `src/webview/components/NodeHeader.tsx`, find (line 9):

```tsx
import { StatusBadge } from './StatusBadge';
```

replace with:

```tsx
import { StatusBadge } from './StatusBadge';
import { extractFrontmatter, filenameFromUri } from '../../shared/fileHeader';
```

Delete lines 20-48: `interface Frontmatter { … }`, `function extractFrontmatter(…) { … }` and `function filenameFromUri(…) { … }` with the blank lines between them, so `interface NodeHeaderProps { … }` is followed by one blank line and `export function NodeHeader(`.

- [ ] **Step 4: Write `src/extension/export/nodeHtml.ts`**

```ts
/**
 * One canvas node as static HTML at its canvas position, drawn after its webview component (the
 * same classes, borders and header rows) without anything that needs React Flow, Monaco or the
 * host: no handles, no resizer, no buttons. The bodies come in already rendered (markdown html,
 * code lines); the plain ones are built here. Pure.
 */

import type { CanvasNode, CellNode, ChatNode, CodeNode, FileNode, FileType, KernelNode, KnowledgeNode, LinkNode, NoderefNode, PortalNode, TextNode } from '../../shared/types';
import { FILE_TYPE_COLORS, FILE_TYPE_ICONS, STATUS_COLORS } from '../../shared/constants';
import { kernelColor } from '../../shared/kernelPalette';
import { fmtDateTime } from '../../shared/dateTime';
import { nodeBorderColor } from '../../webview/canvas/palette';
import { canvasColor } from './edges';
import { escapeHtml, jsonForScript, stripActiveHtml } from './html';
import { capOutputHtml } from '../../shared/outputCap';
import type { CellOutput, ParsedNotebook } from '../notebook-parser';

/** - a node border of 1.5 px through the zoom-invariant scaler at zoom 1 (BORDER_WIDTH_SCALE 1.8) */
export const NODE_BORDER = 2.7;

export function borderOf(node: CanvasNode): string {
  return nodeBorderColor(node.type, canvasColor(node.color)) ?? '#6b7280';
}

/**
 * The node's box on the page: positioned at its canvas x/y/width/height, its label badge in the
 * top-right corner (`badge` false for a node that draws its label inside), and the AI pill.
 */
export function placeNode(node: CanvasNode, inner: string, badge = true): string {
  const label = badge && node.nodeLabel ? `<span class="skena-export-label">${escapeHtml(node.nodeLabel)}</span>` : '';
  const ai = node.createdBy === 'ai' ? '<span class="skena-export-ai">AI</span>' : '';
  return `<div class="skena-export-node" data-node-id="${escapeHtml(node.id)}" data-label="${escapeHtml(node.nodeLabel ?? '')}"`
    + ` style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;contain-intrinsic-size:${node.width}px ${node.height}px">`
    + `${inner}${label}${ai}</div>`;
}

// - the card every rectangular node draws (.skena-node, its type class, the coloured border)
function card(type: string, border: string, body: string, style = ''): string {
  return `<div class="skena-node skena-node--${type}" style="border:${NODE_BORDER}px solid ${border};height:100%;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;${style}">${body}</div>`;
}

function scroll(inner: string, padding = '6px 8px 6px 12px'): string {
  return `<div class="skena-export-scroll" style="padding:${padding}">${inner}</div>`;
}

/** - a text note: its markdown html; `mdStyle` is the markdown.preview font the webview path applies */
export function textNodeHtml(node: TextNode, html: string, mdStyle = ''): string {
  const md = `<div class="skena-markdown"${mdStyle ? ` style="${mdStyle}"` : ''}>${html}</div>`;
  return placeNode(node, card('text', borderOf(node), scroll(md)));
}

/** - a knowledge node: the server › title · date row, then the whole stored text */
export function knowledgeNodeHtml(node: KnowledgeNode, html: string, mdStyle = ''): string {
  const border = borderOf(node);
  const t = Date.parse(node.fetchedAt);
  const fetched = Number.isNaN(t) ? 'never fetched' : `fetched ${fmtDateTime(t)}`;
  const head = `<div class="skena-export-head" title="${escapeHtml(node.error ?? node.uri)}" style="border-bottom:1px solid ${border}">`
    + `<span style="opacity:0.7">${escapeHtml(node.server)}</span><span style="opacity:0.4">›</span>`
    + (node.changed ? `<span style="color:${border}">●</span>` : '')
    + `<span class="skena-export-title">${escapeHtml(node.title)}</span><span style="opacity:0.4">·</span>`
    + `<span style="opacity:0.6">${fetched}</span>${node.error ? '<span style="opacity:0.6">!</span>' : ''}</div>`;
  const md = `<div class="skena-markdown"${mdStyle ? ` style="${mdStyle}"` : ''}>${stripActiveHtml(html)}</div>`;
  return placeNode(node, card('knowledge', border, head + scroll(md)));
}

const STATUS_GLYPH: Record<string, string> = { running: '◗', ok: '✓', error: '✗' };

/** - a code cell: the language and status row, then its lines on the editor background */
export function codeNodeHtml(node: CodeNode, linesHtml: string): string {
  const border = borderOf(node);
  const glyph = STATUS_GLYPH[node.lastStatus ?? ''] ?? '';
  const head = `<div class="skena-export-head" style="border-bottom:1px solid ${border};height:24px">`
    + `<span style="opacity:0.7">${escapeHtml(node.language ?? 'python')}</span>`
    + `<span style="margin-left:auto;font-size:14px;color:${node.lastStatus === 'error' ? '#e5484d' : border}">${glyph}</span></div>`;
  const body = node.code.trim() ? linesHtml : '<div style="padding:8px;opacity:0.5;font-size:12px;font-style:italic">empty</div>';
  return placeNode(node, card('code', border, head + scroll(body, '0'), 'background:var(--vscode-editorWidget-background)'));
}

/** - an output cell; `markdownHtml` is the rendered content of a markdown cell, null for the others */
export function cellNodeHtml(node: CellNode, markdownHtml: string | null): string {
  let body: string;
  if (node.format === 'markdown') body = `<div class="skena-markdown">${markdownHtml ?? ''}</div>`;
  else if (node.format === 'image') body = `<img src="${escapeHtml(node.content)}" alt="cell" style="max-width:100%;max-height:100%;object-fit:contain">`;
  else if (node.format === 'html') body = `<div class="skena-cell-html">${stripActiveHtml(capOutputHtml(node.content))}</div>`;
  else {
    // - the plot fills the scroll box inside the border and its 6px 8px padding, as on the canvas
    body = plotlyEmbed(`skena-fig-${node.id}`, node.content, node.width - 2 * NODE_BORDER - 16, node.height - 2 * NODE_BORDER - 12);
  }
  return placeNode(node, `<div class="skena-node skena-node--cell" style="border:${NODE_BORDER}px dashed ${borderOf(node)};height:100%;border-radius:6px;overflow:hidden;display:flex;flex-direction:column">${scroll(body, '6px 8px')}</div>`);
}

export interface FileView {
  fileType: FileType;
  /** - the frontmatter title, else the file name without its extension */
  title: string;
  status?: string;
  type?: string;
  /** - the rendered content, or the reason there is none */
  body: string;
}

// - StatusBadge: a frontmatter status as a coloured pill
function statusBadge(status: string): string {
  const c = STATUS_COLORS[status] ?? '#6b7280';
  return `<span style="font-size:9px;padding:1px 5px;border-radius:10px;background:${c}22;border:1px solid ${c}66;color:${c};font-weight:600;text-transform:uppercase;letter-spacing:0.04em;flex-shrink:0">${escapeHtml(status)}</span>`;
}

/** - a file node: the header row of NodeHeader, then the file's content */
export function fileNodeHtml(node: FileNode, view: FileView): string {
  const border = borderOf(node);
  const tint = FILE_TYPE_COLORS[view.fileType] ?? FILE_TYPE_COLORS.unknown;
  const icon = FILE_TYPE_ICONS[view.fileType] ?? 'file';
  const head = `<div class="skena-export-file-head" title="${escapeHtml(node.file)}" style="border-bottom:1px solid ${border}40;background:${tint}22">`
    + `<span class="codicon codicon-${icon}" style="font-size:16px;opacity:0.7"></span>`
    + `<span class="skena-export-title" style="flex:1;font-size:16px;font-weight:600">${escapeHtml(view.title)}</span>`
    + (view.status ? statusBadge(view.status) : '')
    + (view.type ? `<span style="font-size:11px;opacity:0.5;text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(view.type)}</span>` : '')
    + '</div>';
  return placeNode(node, card('file', border, head + scroll(view.body, '6px 8px')));
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** - a link: its host name and the address as text and as a plain link (no favicon, no thumbnail) */
export function linkNodeHtml(node: LinkNode): string {
  const body = `<div style="font-size:11px;opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(hostname(node.url))}</div>`
    + `<a href="${escapeHtml(node.url)}" style="font-size:12px;word-break:break-all;opacity:0.85">${escapeHtml(node.url)}</a>`;
  return placeNode(node, card('link', borderOf(node), body, 'background:var(--vscode-editorWidget-background);padding:8px 10px;gap:6px'));
}

function canvasBasename(p: string): string {
  const name = p.replace(/^(\.\.?\/)+/, '').split('/').pop() ?? p;
  return name.endsWith('.canvas') ? name.slice(0, -7) : name;
}

/** - a portal: the circle with the target canvas's name */
export function portalNodeHtml(node: PortalNode): string {
  const border = borderOf(node);
  const inner = `<div style="border:${2 * 1.8}px solid ${border};height:100%;box-sizing:border-box;border-radius:50%;overflow:hidden;background:${border}12;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12%">`
    + `<span style="font-size:18px;font-weight:600;opacity:0.85;text-align:center;word-break:break-word;line-height:1.2">${escapeHtml(node.label ?? canvasBasename(node.canvas))}</span>`
    + '<span style="font-size:11px;opacity:0.4">canvas</span></div>';
  return placeNode(node, inner);
}

/** - a reference to a node in another canvas: the diamond with canvas › label */
export function noderefNodeHtml(node: NoderefNode): string {
  const border = borderOf(node);
  const inner = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">'
    + `<polygon points="50,1 99,50 50,99 1,50" fill="var(--vscode-editorWidget-background, #202020)" stroke="${border}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`
    + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 18px"><div>'
    + `<div style="font-size:12px;font-weight:700">${escapeHtml(canvasBasename(node.canvas))} › ${escapeHtml(node.label)}</div>`
    + (node.title ? `<div style="font-size:10px;opacity:0.6;margin-top:2px">${escapeHtml(node.title)}</div>` : '')
    + '</div></div>';
  return placeNode(node, inner);
}

/** - a kernel node: its name and the ring with its label inside; the status light is off (no live kernel) */
export function kernelNodeHtml(node: KernelNode): string {
  const accent = kernelColor(node.colorIndex ?? 0);
  const title = `${node.displayName ?? 'kernel'} :: ${node.kernelId ? node.kernelId.slice(0, 10) : '—'}`;
  const inner = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px">'
    + `<div style="color:${accent};font-size:12px;font-family:var(--vscode-editor-font-family, monospace);white-space:nowrap">${escapeHtml(title)}</div>`
    + `<div style="position:relative;width:72px;height:72px"><div style="position:absolute;inset:0;border-radius:50%;border:2px solid ${accent}"></div>`
    + '<div style="position:absolute;inset:22px;border-radius:50%;background:#6b7280"></div>'
    + (node.nodeLabel ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:20px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.7)">${escapeHtml(node.nodeLabel)}</div>` : '')
    + '</div></div>';
  return placeNode(node, inner, false);
}

/** - a chat node: its title row (the node has no content of its own) */
export function chatNodeHtml(node: ChatNode): string {
  const border = borderOf(node);
  const head = `<div class="skena-export-head" style="border-bottom:1px solid ${border}40;font-weight:600">`
    + `<span>💬</span><span>${escapeHtml(node.title)}</span><span style="margin-left:auto;opacity:0.5;font-weight:400">${escapeHtml(node.agent)}${node.model ? ` · ${escapeHtml(node.model)}` : ''}</span></div>`;
  return placeNode(node, card('chat', border, head, 'background:var(--vscode-editorWidget-background)'));
}

// - a plotly figure: an empty box the page's plotting script fills when it scrolls near, and the figure as JSON
export function plotlyEmbed(figId: string, json: string, w: number, h: number): string {
  return `<div class="skena-plotly" data-plotly="${escapeHtml(figId)}" data-w="${w}" data-h="${h}" style="width:100%;height:100%"></div>`
    + `<script type="application/json" id="${escapeHtml(figId)}">${jsonForScript(json)}</script>`;
}

function notebookOutput(out: CellOutput, figId: string, plotWidth: number): string {
  const wrap = (inner: string, style = '') => `<div class="skena-notebook__output"${style ? ` style="${style}"` : ''}>${inner}</div>`;
  switch (out.mimeType) {
    case 'image/png':
    case 'image/svg+xml': return wrap(`<img src="data:${out.mimeType};base64,${out.data}" alt="output" style="max-width:100%">`);
    case 'text/html': return wrap(`<div class="skena-notebook__html-output">${stripActiveHtml(out.html)}</div>`);
    case 'application/vnd.plotly.v1+json': return wrap(plotlyEmbed(figId, out.json, plotWidth, 400), 'position:relative;height:400px');
    case 'text/plain': return wrap(`<pre class="skena-notebook__text-output">${escapeHtml(out.text)}</pre>`);
    default: return wrap(`<div class="skena-notebook__placeholder">${escapeHtml(out.label)}</div>`);
  }
}

/**
 * A notebook as NotebookRenderer shows it: markdown cells (`mdHtml[i]` holds cell i rendered), each
 * code cell's outputs, and its source with the execution count when `showSource`
 * (skena.notebook.showSourceCells). `codeHtml` colours a source as the file previews do.
 */
export function notebookHtml(nb: ParsedNotebook, mdHtml: readonly string[], showSource: boolean, codeHtml: (source: string) => string, figPrefix: string, plotWidth: number): string {
  const cells = nb.cells.map((cell, i) => {
    if (cell.type === 'markdown') return `<div class="skena-notebook__cell"><div class="skena-markdown">${mdHtml[i] ?? ''}</div></div>`;
    if (cell.type === 'raw') return `<div class="skena-notebook__cell"><pre>${escapeHtml(cell.source)}</pre></div>`;
    if (!showSource && cell.outputs.length === 0) return '';
    const source = showSource
      ? `<div class="skena-notebook__code-prompt"><span class="skena-notebook__execution-count">${cell.executionCount != null ? `[${cell.executionCount}]` : '[ ]'}</span>${codeHtml(cell.source)}</div>`
      : '';
    const outputs = cell.outputs.length
      ? `<div class="skena-notebook__outputs-group">${cell.outputs.map((o, k) => notebookOutput(o, `${figPrefix}-${i}-${k}`, plotWidth)).join('')}</div>`
      : '';
    return `<div class="skena-notebook__cell">${source}${outputs}</div>`;
  });
  return `<div class="skena-notebook">${cells.join('')}</div>`;
}
```

- [ ] **Step 5: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 9`, `# pass 9`, `# fail 0`. Typecheck: nothing.

- [ ] **Step 6: Commit**

```bash
git add src/shared/dateTime.ts src/shared/fileHeader.ts src/webview/rail/RailSegment.tsx src/webview/components/NodeHeader.tsx src/extension/export/nodeHtml.ts tests/export-nodes.mjs
git commit -m "feat(export): each node type as static html"
```

---

### Task 6: Code cell lines (pure)

**Files:**
- Create: `src/extension/export/codeHtml.ts`
- Test: `tests/export-code.mjs`

The canvas preview (`CodeCellPreview.tsx`) draws a code cell from `tokenizeCodeLines` / `codeRunStyle` (`codeCellShiki.ts`) and `tokenBracketLevels` / `bracketColor` / `splitRuns` / `magicRange` (`codeCellView.ts`). `codeCellHtml` draws the same runs into a `<pre>` with a line-number gutter (numbers 1..n; see "Points the spec does not settle" 2). Indentation guides are not drawn.

- [ ] **Step 1: Write the failing test**

Create `tests/export-code.mjs`:

```js
// - run: npx esbuild src/extension/export/codeHtml.ts --bundle --format=esm --platform=node --outfile=tests/.build/exportCode.mjs && npx esbuild src/webview/canvas/codeCellShiki.ts --bundle --format=esm --platform=node --outfile=tests/.build/codeCellShiki.mjs && node --test tests/export-code.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHighlighter } from 'shiki';
import { codeCellHtml } from './.build/exportCode.mjs';
import { codeTokenizer } from './.build/codeCellShiki.mjs';

// - every line one plain token of one colour, so the test reads the brackets, magic and escaping alone
const plain = {
  theme: 'stub', fg: '#cccccc', colors: ['#cccccc'],
  tokenizeLine: (line, state) => ({ tokens: line ? [{ offset: 0, color: '#aabbcc', fontStyle: 0, type: 0 }] : [], endState: state }),
};

test('1. one numbered row per line; the gutter is at least three digits wide', () => {
  const html = codeCellHtml('a = 1\n\nb = 2', plain, '#000000', true);
  assert.ok(html.startsWith('<pre class="skena-export-code" style="color:#cccccc;--skena-export-gutter:3ch">'));
  assert.equal(html.match(/class="skena-export-ln"/g).length, 3);
  assert.ok(html.includes('<span class="skena-export-ln">3</span><span style="color:#aabbcc">b = 2</span>'));
});

test('2. brackets take Monaco\'s colour for their nesting level; text is escaped', () => {
  const html = codeCellHtml('f(a[0]) < 1', plain, '#000000', true);
  assert.ok(html.includes('<span style="color:#ffd700">(</span>'));
  assert.ok(html.includes('<span style="color:#da70d6">[</span>'));
  assert.ok(html.includes('&lt; 1'));
});

test('3. an IPython magic is marked as the editor marks it', () => {
  assert.ok(codeCellHtml('%time f()', plain, '#000000', true).includes('<span class="skena-magic" style="color:#aabbcc">%time</span>'));
});

test('4. with shiki ayu-dark a keyword has the colour shiki gives it', async () => {
  const hl = await createHighlighter({ themes: ['ayu-dark'], langs: ['python'] });
  const want = hl.codeToTokens('def', { lang: 'python', theme: 'ayu-dark' }).tokens[0][0].color.toLowerCase();
  const html = codeCellHtml('def f():\n    pass', codeTokenizer(hl, 'ayu-dark'), '#000000', true);
  assert.ok(html.includes(`<span style="color:${want}">def</span>`), html.slice(0, 400));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/extension/export/codeHtml.ts --bundle --format=esm --platform=node --outfile=tests/.build/exportCode.mjs && npx esbuild src/webview/canvas/codeCellShiki.ts --bundle --format=esm --platform=node --outfile=tests/.build/codeCellShiki.mjs && node --test tests/export-code.mjs`

Expected: `✘ [ERROR] Could not resolve "src/extension/export/codeHtml.ts"`.

- [ ] **Step 3: Write `src/extension/export/codeHtml.ts`**

```ts
/**
 * A code cell's lines as static HTML, drawn from the parts the canvas preview (CodeCellPreview) is
 * drawn from: the shiki code theme's tokens, Monaco's bracket colours by nesting pair, the IPython
 * magic decoration, and a line-number gutter. Pure, given a tokenizer.
 */

import { codeRunStyle, opaqueColor, tokenizeCodeLines, type CodeTokenizer } from '../../webview/canvas/codeCellShiki';
import { LINE_NUMBERS_MIN_CHARS, bracketColor, magicRange, splitRuns, tokenBracketLevels, type RunStyle } from '../../webview/canvas/codeCellView';
import { escapeHtml } from './html';

function runCss(s: RunStyle): string {
  const css: string[] = [];
  if (s.color) css.push(`color:${s.color}`);
  if (s.italic) css.push('font-style:italic');
  if (s.bold) css.push('font-weight:bold');
  const deco = [s.underline && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  return css.join(';');
}

/**
 * `code` as a <pre>: one row per line, its number first, then its runs. `bg` is the editor
 * background a colour with alpha is mixed over; `dark` picks Monaco's bracket colours.
 */
export function codeCellHtml(code: string, tok: CodeTokenizer, bg: string, dark: boolean): string {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const tokens = tokenizeCodeLines(tok, lines);
  const brackets = new Map<number, Map<number, string>>();
  for (const mark of tokenBracketLevels(lines, tokens)) {
    let row = brackets.get(mark.line);
    if (!row) brackets.set(mark.line, row = new Map());
    row.set(mark.col, bracketColor(mark, dark));
  }
  const digits = Math.max(String(lines.length).length, LINE_NUMBERS_MIN_CHARS);
  const rows = lines.map((line, i) => {
    const runs = splitRuns(line, tokens[i].map(t => ({ offset: t.offset, style: codeRunStyle(t, bg) })), brackets.get(i), magicRange(line));
    const text = runs.map(r => `<span${r.magic ? ' class="skena-magic"' : ''} style="${runCss(r.style)}">${escapeHtml(r.text)}</span>`).join('');
    return `<span class="skena-export-ln">${i + 1}</span>${text}`;
  });
  return `<pre class="skena-export-code" style="color:${opaqueColor(tok.fg, bg)};--skena-export-gutter:${digits}ch">${rows.join('\n')}</pre>`;
}
```

- [ ] **Step 4: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 4`, `# pass 4`, `# fail 0`. Typecheck: nothing.

- [ ] **Step 5: Commit**

```bash
git add src/extension/export/codeHtml.ts tests/export-code.mjs
git commit -m "feat(export): code cell lines coloured as the preview colours them"
```

---

### Task 7: Markdown on the host, routed as the canvas routes it

**Files:**
- Create: `src/shared/markdownCodeBlocks.ts`, `src/extension/export/markdown.ts`
- Modify: `src/webview/lib/codeHighlight.ts` (whole file), `src/extension/markdown-html.ts:28`, end of file
- Test: `tests/markdown-code-blocks.mjs`, `tests/export-markdown.mjs`

The canvas renders a text on the host (`renderMarkdownToHtml`: MathML, Typst SVG) when it contains `%`, or, under the factors theme, a fence (`useHostMarkdown.ts:33`); otherwise `MarkdownRenderer` renders it in the webview with rehype-raw and rehype-katex in HTML output (`MarkdownRenderer.tsx:136`). `renderMarkdownKatexHtml` is that second pipeline on the host. Under the factors theme the webview colours the fences of host html with shiki (`lib/codeHighlight.ts`); that code moves to `src/shared/markdownCodeBlocks.ts` and the webview keeps its behaviour.

- [ ] **Step 1: Write the failing tests**

Create `tests/markdown-code-blocks.mjs`:

```js
// - run: npx esbuild src/shared/markdownCodeBlocks.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownCodeBlocks.mjs && node --test tests/markdown-code-blocks.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHighlighter } from 'shiki';
import { FACTORS_THEME, highlightCodeBlocks } from './.build/markdownCodeBlocks.mjs';

const hl = await createHighlighter({ themes: [FACTORS_THEME], langs: ['python'] });

test('1. a fenced python block becomes shiki html in the factors palette; the text around it is kept', () => {
  const html = '<p>before</p>\n<pre><code class="language-py">def f(x):\n    return x &lt; 1\n</code></pre>\n<p>after</p>';
  const out = highlightCodeBlocks(html, hl);
  assert.ok(out.startsWith('<p>before</p>\n<pre class="shiki factors"'));
  assert.ok(out.endsWith('</pre>\n<p>after</p>'));
  assert.ok(out.includes('color:#4CC8A0'));   // - the keyword def
  assert.ok(out.includes('&#x3C;') || out.includes('&lt;'));   // - the < is still escaped
});

test('2. a block in a language the highlighter has not loaded, and html with no block, are unchanged', () => {
  const rust = '<pre><code class="language-rust">fn main() {}</code></pre>';
  assert.equal(highlightCodeBlocks(rust, hl), rust);
  assert.equal(highlightCodeBlocks('<p>plain</p>', hl), '<p>plain</p>');
});
```

Create `tests/export-markdown.mjs`:

```js
// - run: npx esbuild src/extension/export/markdown.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportMarkdown.mjs --external:@myriaddreamin/typst-ts-node-compiler "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && npx esbuild src/shared/markdownCodeBlocks.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownCodeBlocks.mjs && node --test tests/export-markdown.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHighlighter } from 'shiki';
import { fileMarkdownHtml, nodeMarkdownHtml, rendersOnHost } from './.build/exportMarkdown.mjs';
import { FACTORS_THEME } from './.build/markdownCodeBlocks.mjs';

const hl = await createHighlighter({ themes: [FACTORS_THEME], langs: ['python'] });
const FENCE = '```python\ndef f():\n    pass\n```';

test('1. routing: a % or (factors) a fence goes to the host renderer, as useHostMarkdown routes it', () => {
  assert.equal(rendersOnHost('growth of 5%', false), true);
  assert.equal(rendersOnHost('```py\nx\n```', false), false);
  assert.equal(rendersOnHost('```py\nx\n```', true), true);
  assert.equal(rendersOnHost('$x$', true), false);
});

test('2. math in a text the webview renders comes out as KaTeX HTML', async () => {
  const html = await nodeMarkdownHtml('$x^2$', false, null);
  assert.ok(html.includes('class="katex-html"'));
  assert.ok(!html.includes('<math'));
});

test('3. math in a text the host renders comes out as MathML, Typst as an inline SVG', async () => {
  const html = await nodeMarkdownHtml('$x^2$ and %y^2% at 5', false, null);
  assert.ok(html.includes('<math'));
  assert.ok(html.includes('typst-math'));
});

test('4. a fence is coloured only under the factors theme', async () => {
  assert.ok((await nodeMarkdownHtml(FENCE, true, hl)).includes('<pre class="shiki factors"'));
  assert.ok(!(await nodeMarkdownHtml(FENCE, false, hl)).includes('shiki'));
  assert.ok((await fileMarkdownHtml(FENCE, true, hl)).includes('<pre class="shiki factors"'));
  assert.ok((await fileMarkdownHtml(FENCE, false, hl)).includes('<code class="language-python">'));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/shared/markdownCodeBlocks.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownCodeBlocks.mjs && node --test tests/markdown-code-blocks.mjs`

Expected: `✘ [ERROR] Could not resolve "src/shared/markdownCodeBlocks.ts"`.

- [ ] **Step 3: Write `src/shared/markdownCodeBlocks.ts`**

```ts
/**
 * Fenced code blocks in host-rendered markdown, coloured by shiki in the factors palette. The webview
 * runs this on a node's html under the factors markdown theme (webview/lib/codeHighlight.ts), and the
 * HTML export runs it on the host. Pure, given a highlighter that has the factors theme and the
 * languages loaded.
 */

import type { HighlighterCore } from 'shiki/core';

export const FACTORS_THEME = {
  name: 'factors',
  type: 'dark' as const,
  // - shiki derives the <pre> bg/fg from these top-level fields; without them it falls
  // - back to a red error colour (#ff161d / #ff0000). Keep in sync with colors[] below.
  bg: '#0f161d',
  fg: '#c7d1cc',
  colors: { 'editor.background': '#0f161d', 'editor.foreground': '#c7d1cc' },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#56635d', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control'], settings: { foreground: '#4cc8a0' } },
    { scope: ['string', 'string.quoted', 'constant.character'], settings: { foreground: '#d9a23f' } },
    { scope: ['constant.numeric', 'constant.language', 'constant.language.boolean'], settings: { foreground: '#e5707a' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: '#e8efeb' } },
    { scope: ['entity.name.class', 'support.type', 'support.class', 'entity.name.type'], settings: { foreground: '#4cc8a0' } },
    { scope: ['keyword.operator'], settings: { foreground: '#7c8a84' } },
    { scope: ['variable.parameter', 'variable.other'], settings: { foreground: '#c7d1cc' } },
  ],
};

/** - the languages a fenced block is coloured in; any other block stays plain */
export const MARKDOWN_CODE_LANGS = ['python', 'javascript', 'typescript', 'bash', 'json', 'yaml', 'sql', 'rust', 'go', 'markdown'];
const ALIAS: Record<string, string> = { sh: 'bash', zsh: 'bash', shell: 'bash', py: 'python', ts: 'typescript', js: 'javascript', yml: 'yaml', md: 'markdown', rs: 'rust', golang: 'go' };

// - the host escapes code content; undo it to recover the source shiki will re-highlight
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');   // - last, so &amp;lt; → &lt;
}

// - matches a fenced code block emitted by the host markdown pipeline
const CODE_RE = /<pre><code class="[^"]*\blanguage-([\w+-]+)[^"]*">([\s\S]*?)<\/code><\/pre>/g;

/** - true when `html` has a fenced block with a language */
export function hasCodeBlocks(html: string): boolean {
  return html.includes('language-');
}

/** `html` with every fenced block in a loaded language replaced by shiki's factors-coloured html. */
export function highlightCodeBlocks(html: string, hl: Pick<HighlighterCore, 'codeToHtml' | 'getLoadedLanguages'>): string {
  const matches = [...html.matchAll(CODE_RE)];
  if (matches.length === 0) return html;
  const loaded = new Set(hl.getLoadedLanguages());
  let out = html;
  // - splice from last match to first so earlier match indices stay valid
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const lang = ALIAS[m[1].toLowerCase()] ?? m[1].toLowerCase();
    if (!loaded.has(lang)) continue;
    let shiki: string;
    try { shiki = hl.codeToHtml(decodeEntities(m[2]), { lang, theme: 'factors' }); }
    catch { continue; }
    out = out.slice(0, m.index) + shiki + out.slice((m.index as number) + m[0].length);
  }
  return out;
}
```

- [ ] **Step 4: The webview's code-block highlighter uses it**

Replace the whole of `src/webview/lib/codeHighlight.ts` with (the hook and `highlighter()` are unchanged; `FACTORS_THEME` is re-exported for `CodeRenderer.tsx`):

```ts
/**
 * Webview-side syntax highlighting for markdown code blocks (factors theme).
 *
 * Reuses shiki — already bundled for CodeRenderer — so this adds no host cost.
 * The host renders code as <pre><code class="language-x">…</code></pre>. We rewrite the
 * HTML STRING (targeted per code block, leaving the rest incl. Typst SVGs untouched) and
 * the caller injects the result. Highlighting the string rather than mutating the DOM
 * post-render means a remount (React Flow unmounts off-screen nodes) re-injects the
 * already-highlighted HTML from cache instead of losing the colors. Only runs under the
 * factors theme. Never throws.
 */

import { createHighlighter, type Highlighter } from 'shiki';
import { useEffect, useState } from 'react';
import { FACTORS_THEME, MARKDOWN_CODE_LANGS, hasCodeBlocks, highlightCodeBlocks } from '../../shared/markdownCodeBlocks';

export { FACTORS_THEME };

let _hl: Promise<Highlighter> | null = null;
/** The one shiki highlighter of the markdown code blocks, shared with the code cells (codeCellTheme). */
export function highlighter(): Promise<Highlighter> {
  if (!_hl) _hl = createHighlighter({ themes: [FACTORS_THEME], langs: MARKDOWN_CODE_LANGS });
  return _hl;
}

/**
 * Kick off shiki's (WASM) init during idle so the first code node doesn't pay it
 * mid-interaction. Safe to call repeatedly; no-op once warm. Call under factors theme.
 */
export function warmCodeHighlighter(): void {
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
    ?? ((cb: () => void) => setTimeout(cb, 200));
  idle(() => { void highlighter(); });
}

const cache = new Map<string, string>();   // - rawHtml → highlighted html

async function highlightHtml(html: string): Promise<string> {
  if (!hasCodeBlocks(html)) return html;
  let hl: Highlighter;
  try { hl = await highlighter(); } catch { return html; }
  return highlightCodeBlocks(html, hl);
}

/**
 * Given host-rendered markdown HTML, returns it with code blocks syntax-highlighted
 * when the factors theme is active (else the input unchanged). Async — returns the raw
 * HTML first, then the highlighted version once shiki resolves; cached by input string
 * so remounts inject the highlighted HTML immediately.
 */
export function useHighlightedHtml(html: string | null | undefined): string | null {
  // - data-md-theme is stamped after nodes mount; bump on the event so `needs` recomputes
  const [, setThemeTick] = useState(0);
  useEffect(() => {
    const onTheme = () => setThemeTick(t => t + 1);
    window.addEventListener('skena:mdTheme', onTheme);
    return () => window.removeEventListener('skena:mdTheme', onTheme);
  }, []);

  const active = typeof document !== 'undefined' && document.documentElement.dataset.mdTheme === 'factors';
  const needs = active && !!html && html.includes('language-');
  const [, setHighlighted] = useState(0);

  useEffect(() => {
    if (!html || !needs || cache.has(html)) return;
    let cancelled = false;
    void highlightHtml(html).then(h => { cache.set(html, h); if (!cancelled) setHighlighted(n => n + 1); });
    return () => { cancelled = true; };
  }, [html, needs]);

  // - derived in the render, not held in state, so a new html is what the caller gets in the same
  //   render (plain until its highlighted copy is cached), never the previous html for one render
  if (!html) return null;
  return needs ? cache.get(html) ?? html : html;
}
```

- [ ] **Step 5: The webview pipeline on the host**

In `src/extension/markdown-html.ts` (line 28), find:

```ts
import rehypeKatex         from 'rehype-katex';
```

replace with:

```ts
import rehypeKatex         from 'rehype-katex';
import rehypeRaw           from 'rehype-raw';
```

Append to the end of `src/extension/markdown-html.ts`, after one blank line:

```ts
// - the pipeline of the webview's MarkdownRenderer: react-markdown runs remark-gfm and remark-math,
//   keeps raw html (rehype-raw) and renders math with rehype-katex in HTML output. A node the
//   webview renders itself is rendered this way by the HTML export.
let _webviewProcessor: ReturnType<typeof buildWebviewProcessor> | null = null;

function buildWebviewProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .use(rehypeKatex, { output: 'html', throwOnError: false } as any);
}

/** Markdown to HTML as the webview's MarkdownRenderer renders it: KaTeX HTML output, no Typst. */
export async function renderMarkdownKatexHtml(content: string): Promise<string> {
  const source = normalizeMath(content);
  if (!_webviewProcessor) _webviewProcessor = buildWebviewProcessor();
  const hast = await _webviewProcessor.run(_webviewProcessor.parse(source));
  return toHtml(hast as Root);
}
```

- [ ] **Step 6: Write `src/extension/export/markdown.ts`**

```ts
/**
 * A node's markdown as the canvas renders it: on the host (Typst and MathML, markdown-html.ts) when
 * useHostMarkdown would send it there, else as the webview's MarkdownRenderer does (KaTeX HTML).
 * Under the factors markdown theme the fenced blocks of host html are coloured as the webview
 * colours them. No vscode import.
 */

import type { HighlighterCore } from 'shiki/core';
import { renderMarkdownKatexHtml, renderMarkdownToHtml } from '../markdown-html';
import { hasCodeBlocks, highlightCodeBlocks } from '../../shared/markdownCodeBlocks';

type BlockHighlighter = Pick<HighlighterCore, 'codeToHtml' | 'getLoadedLanguages'>;

/** - useHostMarkdown's routing: a `%` (Typst) or, under the factors theme, a fenced block */
export function rendersOnHost(text: string, factors: boolean): boolean {
  return text.includes('%') || (factors && text.includes('```'));
}

/** `text` (a text note, a knowledge node, a markdown cell) as html, routed as the canvas routes it. */
export async function nodeMarkdownHtml(text: string, factors: boolean, hl: BlockHighlighter | null): Promise<string> {
  if (!rendersOnHost(text, factors)) return renderMarkdownKatexHtml(text);
  return fileMarkdownHtml(text, factors, hl);
}

/** - a markdown file: always the host renderer, as handleRequestFile renders it */
export async function fileMarkdownHtml(text: string, factors: boolean, hl: BlockHighlighter | null): Promise<string> {
  const html = await renderMarkdownToHtml(text);
  return factors && hl && hasCodeBlocks(html) ? highlightCodeBlocks(html, hl) : html;
}
```

- [ ] **Step 7: Run the tests, typecheck, build**

Run the Step 2 command. Expected: `# tests 2`, `# pass 2`, `# fail 0`.

Run: `npx esbuild src/extension/export/markdown.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportMarkdown.mjs --external:@myriaddreamin/typst-ts-node-compiler "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && npx esbuild src/shared/markdownCodeBlocks.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownCodeBlocks.mjs && node --test tests/export-markdown.mjs`
Expected: `# tests 4`, `# pass 4`, `# fail 0`. (Test 3 needs the Typst addon from `node_modules`; KaTeX prints `LaTeX-incompatible input` warnings to stderr for some inputs, which is normal.)

Typecheck: nothing. Run: `npm run build`. Expected: three `⚡ Done in …` lines, no `✘ [ERROR]`.

- [ ] **Step 8: Commit**

```bash
git add src/shared/markdownCodeBlocks.ts src/webview/lib/codeHighlight.ts src/extension/markdown-html.ts src/extension/export/markdown.ts tests/markdown-code-blocks.mjs tests/export-markdown.mjs
git commit -m "feat(export): node markdown rendered on the host with the canvas's routing"
```

---

### Task 8: The page (pure) and its stylesheet

**Files:**
- Create: `src/extension/export/page.ts`, `src/extension/export/export.css`
- Test: `tests/export-page.mjs`

The page carries the `--vscode-*` variables the webview gets from VS Code (from an open canvas, Task 12; else `FALLBACK_THEME`), the `--sk-*` tokens of `palette.THEME`, `data-md-theme` and `--skena-md-maxw` as `App.tsx` sets them. Everything inside `.skena-export-origin` is placed in canvas coordinates; the origin is moved by the page box. Section frames span the page width with `S1 · <title or creation time>` and the kernel's name, coloured like the rail (`SectionRail.laneColor`). The SVG edge layer has one arrow marker per colour; edge labels sit above the nodes as on the canvas. plotly.js and a 12-line script that plots each figure when it comes within 1000 px of the view are added only when a figure is on the page. `content-visibility: auto` on each node box lets the browser skip the layout and paint of nodes far from the view.

- [ ] **Step 1: Write the failing test**

Create `tests/export-page.mjs`:

```js
// - run: npx esbuild src/extension/export/page.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportPage.mjs && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-page.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildPage, sectionFrames } from './.build/exportPage.mjs';
import { checkOffline } from './.build/offlineCheck.mjs';

const lane = (id, label, top, bottom, extra = {}) => ({ id, label, index: Number(label.slice(1)) - 1, y: top, top, bottom, createdAt: 0, memberIds: [], ...extra });

function input(extra = {}) {
  return {
    title: 'factors <essentials>',
    box: { left: -40, top: -40, width: 1000, height: 800 },
    sections: [{ id: 's1', label: 'S1', title: 'Taxonomy', color: '#4cc8a0', kernelName: 'factors', top: 0, bottom: 700 }],
    nodesHtml: ['<div class="skena-export-node" data-node-id="n1"></div>'],
    edges: [
      { id: 'e1', points: [[0, 0], [100, 0]], d: 'M 0,0 L 100,0', label: 'uses', labelAt: [50, 0], color: '#1f96bd', dashed: false, arrow: true },
      { id: 'e2', points: [[0, 50], [100, 50]], d: 'M 0,50 L 100,50', labelAt: [50, 50], color: '#02542e', dashed: true, arrow: false },
    ],
    css: ['.a{}', '.b{}'],
    theme: { vars: { '--vscode-editor-background': '#000000', '--vscode-editor-font-family': '"JetBrains Mono", monospace' }, dark: true },
    mdTheme: 'factors',
    mdMaxWidth: 88,
    plotlyJs: null,
    ...extra,
  };
}

test('1. the page: theme variables on <html>, the dark body class, the stylesheets, the title escaped', () => {
  const html = buildPage(input());
  assert.ok(html.startsWith('<!doctype html>\n<html lang="en" data-md-theme="factors" style="--vscode-editor-background:#000000;--vscode-editor-font-family:&quot;JetBrains Mono&quot;, monospace;'));
  assert.ok(html.includes('--sk-border:#424245'));
  assert.ok(html.includes('--skena-md-maxw:88ch'));
  assert.ok(html.includes('<title>factors &lt;essentials&gt;</title><style>.a{}</style><style>.b{}</style>'));
  assert.ok(html.includes('<body class="vscode-dark">'));
  assert.ok(html.includes('<div class="skena-export-page" style="width:1000px;height:800px"><div class="skena-export-origin" style="left:40px;top:40px">'));
});

test('2. section frames span the page width with their label, title and kernel', () => {
  const html = buildPage(input());
  assert.ok(html.includes('<div class="skena-export-section" data-section-id="s1" style="left:-40px;top:0px;width:1000px;height:700px;border-color:#4cc8a0">'));
  assert.ok(html.includes('S1 · Taxonomy<span class="skena-export-section-kernel"> · factors</span>'));
});

test('3. edges: one marker per arrow colour, the dotted output link, labels above the nodes', () => {
  const html = buildPage(input());
  assert.equal(html.match(/<marker /g).length, 1);
  assert.ok(html.includes('viewBox="-40 -40 1000 800" style="left:-40px;top:-40px"'));
  assert.ok(html.includes('<path data-edge-id="e1" d="M 0,0 L 100,0" fill="none" stroke="#1f96bd" stroke-opacity="0.6" stroke-width="1.8" marker-end="url(#skena-arrow-0-1f96bd)"/>'));
  assert.ok(html.includes('stroke-dasharray="2.7 5.4"'));
  assert.ok(html.indexOf('data-node-id="n1"') < html.indexOf('skena-export-edge-label'));
  assert.ok(html.includes('<div class="skena-export-edge-label" style="left:50px;top:0px;border-color:#1f96bd">uses</div>'));
});

test('4. plotly comes once, with the plotting script, only when given; the page loads nothing remote', () => {
  assert.ok(!buildPage(input()).includes('<script>'));
  const html = buildPage(input({ plotlyJs: 'window.Plotly={newPlot(){}};' }));
  assert.equal(html.match(/window\.Plotly=/g).length, 1);
  assert.ok(html.includes('IntersectionObserver'));
  assert.deepEqual(checkOffline(html, ['n1']), { remote: [], missingNodeIds: [] });
  assert.throws(() => buildPage(input({ plotlyJs: 'x="</script>"' })));
});

test('5. section frames take the kernel colour and name, else the palette by position and the creation time', () => {
  const lanes = [
    lane('a', 'S1', 0, 700, { title: 'A', kernelId: 'k-1' }),
    lane('b', 'S2', 700, 1400, { title: 'B', kernelId: 'kn' }),
    lane('c', 'S3', 1400, 2000, { createdAt: new Date(2026, 9, 6, 12, 0).getTime() }),
  ];
  const nodes = [{ id: 'kn', type: 'kernel', server: 's', displayName: 'node kernel', colorIndex: 3, x: 0, y: 0, width: 140, height: 160 }];
  const records = [{ id: 'k-1', server: 'quantkit', displayName: 'factors', colorIndex: 1 }];
  assert.deepEqual(sectionFrames(lanes, nodes, records).map(x => [x.label, x.title, x.color, x.kernelName]), [
    ['S1', 'A', '#d9a23f', 'factors'],
    ['S2', 'B', '#e5707a', 'node kernel'],
    ['S3', '2026-10-06 12:00', '#7aa2f7', null],
  ]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/extension/export/page.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportPage.mjs && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-page.mjs`

Expected: `✘ [ERROR] Could not resolve "src/extension/export/page.ts"`.

- [ ] **Step 3: Write `src/extension/export/page.ts`**

```ts
/**
 * The exported page around the nodes: the theme variables the webview gets from VS Code, the
 * section frames, the edge layer, the edge labels, the stylesheets and, when a plotly cell is on
 * it, plotly.js once with the few lines that plot each figure as it scrolls into view. Pure.
 */

import type { DerivedLane } from '../../shared/sectionLanes';
import type { PageBox } from '../../shared/exportLayout';
import type { CanvasNode, KernelNode, KernelRecord } from '../../shared/types';
import { kernelColor } from '../../shared/kernelPalette';
import { fmtDateTime } from '../../shared/dateTime';
import { THEME } from '../../webview/canvas/palette';
import { EDGE_OPACITY, EDGE_WIDTH, type ExportEdge } from './edges';
import { escapeHtml } from './html';

export interface PageSection { id: string; label: string; title: string; color: string; kernelName: string | null; top: number; bottom: number }

/** - the `--vscode-*` variables of a canvas webview (or the fallback set) and the theme kind */
export interface PageTheme { vars: Record<string, string>; dark: boolean }

export interface PageInput {
  title: string;
  box: PageBox;
  sections: PageSection[];
  nodesHtml: string[];
  edges: ExportEdge[];
  /** - stylesheet texts, in cascade order */
  css: string[];
  theme: PageTheme;
  mdTheme: 'vscode' | 'factors';
  /** - skena.markdownMaxWidth in characters; 0 = none */
  mdMaxWidth: number;
  /** - plotly.min.js, only when a plotly figure is on the page */
  plotlyJs: string | null;
}

/**
 * The frame of every section, coloured and named as the rail and the fold band name it: the kernel's
 * colour (else the section's place in the palette), the title or else the creation time, the kernel's name.
 */
export function sectionFrames(lanes: readonly DerivedLane[], nodes: readonly CanvasNode[], records: readonly KernelRecord[]): PageSection[] {
  const kernels = new Map<string, { colorIndex: number; name: string }>();
  for (const k of records) kernels.set(k.id, { colorIndex: k.colorIndex, name: k.displayName ?? 'kernel' });
  for (const n of nodes) {
    if (n.type !== 'kernel') continue;
    const k = n as KernelNode;
    kernels.set(k.id, { colorIndex: k.colorIndex ?? 0, name: k.displayName ?? 'kernel' });
  }
  return lanes.map(l => {
    const k = l.kernelId ? kernels.get(l.kernelId) ?? null : null;
    return {
      id: l.id, label: l.label, title: l.title?.trim() || fmtDateTime(l.createdAt),
      color: kernelColor(k ? k.colorIndex : l.index), kernelName: k?.name ?? null, top: l.top, bottom: l.bottom,
    };
  });
}

// - plots a figure when its cell comes within 1000px of the view, at the size the canvas gives it
const PLOT_SCRIPT = `(function () {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      var fig = JSON.parse(document.getElementById(e.target.dataset.plotly).textContent);
      var layout = Object.assign({}, fig.layout || {}, { width: Number(e.target.dataset.w), height: Number(e.target.dataset.h) });
      Plotly.newPlot(e.target, fig.data, layout, { displaylogo: false, responsive: false });
    });
  }, { rootMargin: '1000px' });
  document.querySelectorAll('[data-plotly]').forEach(function (el) { io.observe(el); });
})();`;

function markerId(color: string, index: number): string {
  return `skena-arrow-${index}-${color.replace(/[^\w]/g, '')}`;
}

function edgeLayer(box: PageBox, edges: readonly ExportEdge[]): string {
  const colors = [...new Set(edges.filter(e => e.arrow).map(e => e.color))];
  const ids = new Map(colors.map((c, i) => [c, markerId(c, i)] as const));
  const defs = colors.map(c => `<marker id="${ids.get(c)}" markerWidth="12.5" markerHeight="12.5" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">`
    + `<polyline points="-5,-4 0,0 -5,4 -5,-4" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" stroke="${c}" fill="${c}" opacity="${EDGE_OPACITY}"/></marker>`).join('');
  const paths = edges.map(e => `<path data-edge-id="${escapeHtml(e.id)}" d="${e.d}" fill="none" stroke="${e.color}" stroke-opacity="${EDGE_OPACITY}" stroke-width="${EDGE_WIDTH}"`
    + (e.dashed ? ` stroke-dasharray="${1.5 * EDGE_WIDTH} ${3 * EDGE_WIDTH}"` : '')
    + (e.arrow ? ` marker-end="url(#${ids.get(e.color)})"` : '') + '/>').join('');
  return `<svg class="skena-export-edges" xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.left} ${box.top} ${box.width} ${box.height}" style="left:${box.left}px;top:${box.top}px"><defs>${defs}</defs>${paths}</svg>`;
}

function edgeLabels(edges: readonly ExportEdge[]): string {
  return edges.filter(e => e.label).map(e => `<div class="skena-export-edge-label" style="left:${e.labelAt[0]}px;top:${e.labelAt[1]}px;border-color:${e.color}">${escapeHtml(e.label as string)}</div>`).join('');
}

function frames(box: PageBox, sections: readonly PageSection[]): string {
  return sections.map(s => `<div class="skena-export-section" data-section-id="${escapeHtml(s.id)}" style="left:${box.left}px;top:${s.top}px;width:${box.width}px;height:${s.bottom - s.top}px;border-color:${s.color}">`
    + `<div class="skena-export-section-title" style="color:${s.color}">${escapeHtml(s.label)} · ${escapeHtml(s.title)}`
    + (s.kernelName ? `<span class="skena-export-section-kernel"> · ${escapeHtml(s.kernelName)}</span>` : '') + '</div></div>').join('');
}

export function buildPage(p: PageInput): string {
  if (p.plotlyJs?.includes('</script')) throw new Error('plotly.min.js contains "</script" and cannot be inlined');
  const sk = THEME[p.theme.dark ? 'dark' : 'light'];
  const vars = [
    ...Object.entries(p.theme.vars).map(([k, v]) => `${k}:${v}`),
    ...Object.entries(sk).map(([k, v]) => `--sk-${k}:${v}`),
    `--skena-md-maxw:${p.mdMaxWidth ? `${p.mdMaxWidth}ch` : 'none'}`,
  ].join(';');
  const plot = p.plotlyJs ? `<script>${p.plotlyJs}</script><script>${PLOT_SCRIPT}</script>` : '';
  return '<!doctype html>\n'
    + `<html lang="en" data-md-theme="${p.mdTheme}" style="${escapeHtml(vars)}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escapeHtml(p.title)}</title>${p.css.map(c => `<style>${c}</style>`).join('')}</head>`
    + `<body class="${p.theme.dark ? 'vscode-dark' : 'vscode-light'}">`
    + `<div class="skena-export-page" style="width:${p.box.width}px;height:${p.box.height}px">`
    + `<div class="skena-export-origin" style="left:${-p.box.left}px;top:${-p.box.top}px">`
    + frames(p.box, p.sections) + edgeLayer(p.box, p.edges) + p.nodesHtml.join('') + edgeLabels(p.edges)
    + `</div></div>${plot}</body></html>\n`;
}

/**
 * The theme when no canvas is open to read it from: VS Code's Dark Modern colours for the variables
 * skena's CSS reads (approximate; an open canvas gives the real ones).
 */
export const FALLBACK_THEME: PageTheme = {
  dark: true,
  vars: {
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-foreground': '#cccccc',
    '--vscode-editorWidget-background': '#202020',
    '--vscode-editorWidget-border': '#313131',
    '--vscode-sideBar-background': '#181818',
    '--vscode-list-hoverBackground': '#2a2d2e',
    '--vscode-textCodeBlock-background': '#2b2b2b',
    '--vscode-textLink-foreground': '#4daafc',
    '--vscode-editorWarning-foreground': '#cca700',
    '--vscode-inputValidation-warningBackground': '#352a05',
    '--vscode-button-secondaryBackground': '#313131',
    '--vscode-widget-border': '#313131',
    '--vscode-font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
    '--vscode-font-size': '13px',
    '--vscode-editor-font-family': 'Menlo, Monaco, "Courier New", monospace',
    '--vscode-editor-font-size': '14px',
  },
};
```

- [ ] **Step 4: Write `src/extension/export/export.css`**

```css
/* - the HTML export's own rules (src/extension/export/page.ts). The page also carries canvas.css
   - and markdown.css, so the node classes look as they do on the canvas. */
html, body { margin: 0; }
body {
  background: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-foreground, #cccccc);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: var(--vscode-font-size, 13px);
}
.skena-export-page   { position: relative; overflow: hidden; }
.skena-export-origin { position: absolute; }

.skena-export-section { position: absolute; box-sizing: border-box; border: 1px solid; border-radius: 4px; }
.skena-export-section-title { position: absolute; left: 12px; top: 8px; font: 600 14px system-ui, -apple-system, sans-serif; white-space: nowrap; }
.skena-export-section-kernel { color: var(--sk-text2); font-weight: 400; }

.skena-export-edges { position: absolute; overflow: visible; pointer-events: none; }
.skena-export-edge-label {
  position: absolute; transform: translate(-50%, -50%); z-index: 10; white-space: nowrap;
  font-size: 10px; padding: 2px 7px; border-radius: 5px; border: 1.5px solid;
  background: var(--vscode-editor-background); color: var(--vscode-foreground);
}

/* - a node far from the view is neither laid out nor painted until it comes near; its content is
   - all there, so find-in-page and scrolling still reach it */
.skena-export-node { position: absolute; box-sizing: border-box; content-visibility: auto; }
.skena-export-node > .skena-node { box-sizing: border-box; }
.skena-export-scroll { flex: 1; min-height: 0; overflow: auto; }
.skena-export-head {
  display: flex; align-items: center; gap: 5px; padding: 3px 40px 3px 14px;
  font-size: 12px; white-space: nowrap; flex-shrink: 0; overflow: hidden; box-sizing: border-box;
}
.skena-export-file-head { display: flex; align-items: center; gap: 7px; padding: 6px 10px; min-height: 34px; flex-shrink: 0; box-sizing: border-box; }
.skena-export-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* - NodeLabelBadge and its AI pill (colours from canvas/palette.ts) */
.skena-export-label {
  position: absolute; top: 0; right: 0; z-index: 10; width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  font: 800 14px monospace; letter-spacing: 0.03em;
  color: rgba(0, 255, 0, 0.92); background: rgba(17, 165, 191, 0.27); border-radius: 0 6px 0 8px;
}
.skena-export-ai {
  position: absolute; bottom: 0; left: 0; z-index: 10; padding: 2px 6px;
  font-size: 9px; font-weight: 600; color: #fff; background: rgba(100, 60, 220, 0.80); border-radius: 0 4px 0 6px;
}

/* - code cells: the editor font and background, line numbers in LINE_NUMBER_COLOR */
.skena-export-code {
  margin: 0; min-height: 100%; box-sizing: border-box; white-space: pre; tab-size: 4;
  font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 12px); line-height: 1.3;
  background: var(--vscode-editor-background);
}
.skena-export-ln { display: inline-block; width: var(--skena-export-gutter); margin-right: 6px; text-align: right; color: #90be065c; user-select: none; }

.skena-export-missing { opacity: 0.6; font-size: 0.85em; font-style: italic; }
```

- [ ] **Step 5: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 5`, `# pass 5`, `# fail 0`. Typecheck: nothing.

- [ ] **Step 6: Commit**

```bash
git add src/extension/export/page.ts src/extension/export/export.css tests/export-page.mjs
git commit -m "feat(export): page with theme variables, section frames, edge layer and plotly"
```

---

### Task 9: Stylesheets with their fonts, written by the build

**Files:**
- Create: `scripts/build-export-assets.mjs`
- Modify: `esbuild.config.mjs:16`, `:116`, `:124`
- Test: `tests/export-assets.mjs`

The VSIX ships `dist/` but not `node_modules` or `src` (`.vscodeignore`), so the build writes the four stylesheets the page inlines: KaTeX's CSS with each `@font-face` pointing at its woff2 as a data URL (the woff and ttf copies left out; 20 faces), the codicon CSS with its font (the file node header icon), the IBM Plex fonts of the factors theme, and `canvas.css` + `markdown.css` + `export.css`. Sizes on 2026-10-06: 367,905 / 201,444 / 113,366 / 37,257 bytes.

- [ ] **Step 1: Write the failing test**

Create `tests/export-assets.mjs`:

```js
// - run: node --test tests/export-assets.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExportAssets } from '../scripts/build-export-assets.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'skena-export-assets-'));
buildExportAssets(ROOT, OUT);
const read = f => readFileSync(join(OUT, f), 'utf8');

test('1. KaTeX: every font face points at its woff2 as a data url, and no file is referenced', () => {
  const css = read('katex.css');
  assert.equal(css.match(/@font-face/g).length, 20);
  assert.equal(css.match(/url\(data:font\/woff2;base64,/g).length, 20);
  assert.ok(!/url\(fonts\//.test(css));
  assert.ok(!/format\("(woff|truetype)"\)/.test(css));
});

test('2. codicons: the font is a data url', () => {
  const css = read('codicon.css');
  assert.ok(css.includes('url(data:font/ttf;base64,'));
  assert.ok(!css.includes('codicon.ttf'));
});

test('3. skena.css holds the canvas, markdown and export rules; the IBM Plex fonts are copied', () => {
  const css = read('skena.css');
  assert.ok(css.includes('.skena-node {'));
  assert.ok(css.includes(':root[data-md-theme="factors"] .skena-markdown {'));
  assert.ok(css.includes('.skena-export-node {'));
  assert.equal(read('ibm-plex.css').match(/@font-face/g).length, 4);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/export-assets.mjs`

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/scripts/build-export-assets.mjs'`, `# fail 1`.

- [ ] **Step 3: Write `scripts/build-export-assets.mjs`**

```js
/**
 * The stylesheets the HTML export puts into every page, written to dist/export-assets/ by the build:
 * the packaged extension ships dist/ but not node_modules or src. KaTeX's CSS with its woff2 fonts
 * as data urls (the woff and ttf copies left out), the codicon CSS with its font, skena's canvas and
 * markdown CSS with the export's own rules, and the IBM Plex fonts of the factors theme.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dataUrl = (file, mime) => `data:${mime};base64,${readFileSync(file).toString('base64')}`;

export function katexCss() {
  const cssPath = require.resolve('katex/dist/katex.min.css');
  const dir = dirname(cssPath);
  return readFileSync(cssPath, 'utf8').replace(/src:([^;}]*)/g, (whole, list) => {
    const woff2 = /url\(([^)]+\.woff2)\)\s*format\(["']woff2["']\)/.exec(list);
    return woff2 ? `src:url(${dataUrl(join(dir, woff2[1]), 'font/woff2')}) format("woff2")` : whole;
  });
}

export function codiconCss() {
  const cssPath = require.resolve('@vscode/codicons/dist/codicon.css');
  return readFileSync(cssPath, 'utf8')
    .replace(/url\(["']?\.\/codicon\.ttf[^)"']*["']?\)/g, () => `url(${dataUrl(join(dirname(cssPath), 'codicon.ttf'), 'font/ttf')})`);
}

/** Writes katex.css, codicon.css, ibm-plex.css and skena.css into `outDir`; `root` is the repo. */
export function buildExportAssets(root, outDir) {
  const read = rel => readFileSync(join(root, rel), 'utf8');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'katex.css'), katexCss());
  writeFileSync(join(outDir, 'codicon.css'), codiconCss());
  writeFileSync(join(outDir, 'ibm-plex.css'), read('src/webview/styles/fonts-ibm-plex.css'));
  writeFileSync(join(outDir, 'skena.css'), [
    read('src/webview/styles/canvas.css'),
    read('src/webview/styles/markdown.css'),
    read('src/extension/export/export.css'),
  ].join('\n'));
}
```

- [ ] **Step 4: Call it from the build**

In `esbuild.config.mjs` (line 16), find:

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
```

replace with:

```js
import { createRequire } from 'node:module';
import { buildExportAssets } from './scripts/build-export-assets.mjs';
const require = createRequire(import.meta.url);
```

Find (line 116):

```js
  await Promise.all([extCtx.watch(), webCtx.watch(), mcpCtx.watch()]);
  copyPlotlyAsset();
```

replace with:

```js
  await Promise.all([extCtx.watch(), webCtx.watch(), mcpCtx.watch()]);
  copyPlotlyAsset();
  // - written once; a stylesheet edited while watching reaches the export after the next build
  buildExportAssets('.', 'dist/export-assets');
```

Find (line 124):

```js
    esbuild.build(mcpServerConfig),
  ]);
  copyPlotlyAsset();
```

replace with:

```js
    esbuild.build(mcpServerConfig),
  ]);
  copyPlotlyAsset();
  buildExportAssets('.', 'dist/export-assets');
```

- [ ] **Step 5: Run the test, build**

Run: `node --test tests/export-assets.mjs`. Expected: `# tests 3`, `# pass 3`, `# fail 0`.

Run: `npm run build && ls -l dist/export-assets`. Expected: no `✘ [ERROR]`; `codicon.css`, `ibm-plex.css`, `katex.css`, `skena.css`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-export-assets.mjs esbuild.config.mjs tests/export-assets.mjs
git commit -m "build(export): stylesheets with their fonts in dist/export-assets"
```

---

### Task 10: The export of one canvas

**Files:**
- Create: `src/extension/export/shikiHost.ts`, `src/extension/export/exportCanvas.ts`
- Test: `tests/export-canvas.mjs`

`exportCanvasHtml(canvasPath, deps)` reads the file and never writes it, lays it out, routes the edges, creates one shiki highlighter (`shiki/core` with the code theme, the factors palette, dark-plus and 10 languages; the full `shiki` entry would put all 200+ grammars into `extension.js`), renders node by node (yielding to the event loop after each, so the extension host keeps serving other work between nodes), puts every `<img>` that is not a data URL in as one (a file next to the canvas or the markdown file, a knowledge server image through `deps.knowledgeAsset`, an http image through `deps.fetchImage`; one that cannot be read shows its alt text and address and is listed in `missing`), balances each node's html, and builds the page. A notebook file node is drawn as `NotebookRenderer` draws it (outputs; sources when `skena.notebook.showSourceCells`), an html file node inside a declarative shadow root (`<template shadowrootmode="open">`) as `HtmlShadow` scopes it.

- [ ] **Step 1: Write the failing test**

Create `tests/export-canvas.mjs`:

```js
// - run: npx esbuild src/extension/export/exportCanvas.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportCanvas.mjs --external:@myriaddreamin/typst-ts-node-compiler "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && npx esbuild src/extension/export/page.ts --bundle --format=esm --outfile=tests/.build/exportPage.mjs && node --test tests/export-canvas.mjs
// - a scratch canvas under the OS temp dir with one node of every type; no real .canvas file is read
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { buildExportAssets } from '../scripts/build-export-assets.mjs';
import { defaultHtmlPath, exportCanvasHtml } from './.build/exportCanvas.mjs';
import { checkOffline } from './.build/offlineCheck.mjs';
import { FALLBACK_THEME } from './.build/exportPage.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = mkdtempSync(join(tmpdir(), 'skena-export-canvas-'));
const ASSETS = join(DIR, 'dist');
buildExportAssets(ROOT, join(ASSETS, 'export-assets'));
writeFileSync(join(ASSETS, 'plotly.min.js'), 'window.Plotly={newPlot:function(){}};');
// - a 1x1 png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
writeFileSync(join(DIR, 'dot.png'), PNG);
writeFileSync(join(DIR, 'notes.md'), '---\ntitle: Notes\nstatus: research\n---\n# Notes\n\n![dot](dot.png)\n');

const box = (id, type, x, y, extra = {}) => ({ id, type, x, y, width: 600, height: 300, ...extra });
const CANVAS = {
  nodes: [
    box('t1', 'text', 0, 0, { text: 'Rate $r_t$ is 5%, and %x^2%.\n\n![dot](dot.png)' }),
    box('t2', 'text', 700, 0, { text: 'Plain $a+b$ math.' }),
    box('c1', 'code', 0, 400, { code: 'import numpy as np\nx = np.arange(3)  # c', outputNodeId: 'o1', lastStatus: 'ok' }),
    box('o1', 'cell', 700, 400, { format: 'html', content: '<table><tr><td>1</td></tr></table><script>alert(1)</script>' }),
    box('o2', 'cell', 1400, 400, { format: 'plotly', content: JSON.stringify({ data: [{ y: [1, 2] }], layout: {} }) }),
    box('o3', 'cell', 2100, 400, { format: 'image', content: `data:image/png;base64,${PNG.toString('base64')}` }),
    box('w1', 'knowledge', 0, 800, { server: 'crtx', uri: 'crtx://lib/p.md', title: 'Paper', text: '# Paper\n\n![fig](crtx://lib/assets/fig.png)', fetchedAt: '2026-10-06T09:00:00Z' }),
    box('m1', 'file', 700, 800, { file: 'notes.md' }),
    box('l1', 'link', 1400, 800, { url: 'https://example.com/a' }),
    box('p1', 'portal', 2100, 800, { canvas: 'other.canvas' }),
    box('r1', 'noderef', 0, 1200, { canvas: 'other.canvas', label: 'N1' }),
    box('k1', 'kernel', 700, 1200, { server: 's', displayName: 'py' }),
    box('h1', 'chat', 1400, 1200, { title: 'Ask', agent: 'claude' }),
    box('g1', 'group', -100, -100, { label: 'not shown' }),
  ],
  edges: [
    { id: 'e1', fromNode: 'c1', fromSide: 'right', toNode: 'o1', toSide: 'left' },
    { id: 'e2', fromNode: 't1', fromSide: 'right', toNode: 't2', toSide: 'left', label: 'next' },
  ],
  metadata: { sections: [{ id: 's1', y: 0, createdAt: 1, title: 'One', folded: ['o3'] }] },
};
const CANVAS_PATH = join(DIR, 'all.canvas');
writeFileSync(CANVAS_PATH, JSON.stringify(CANVAS));

const TYPES = { '.md': 'markdown', '.png': 'image' };
const deps = {
  assetDir: ASSETS, codeTheme: 'ayu-dark', mdTheme: 'factors', mdMaxWidth: 0, notebookShowSource: false, theme: FALLBACK_THEME,
  resolveFile: (uri, dir) => { const p = resolve(dir, uri); return { fsPath: p, fileType: TYPES[extname(p)] ?? 'unknown' }; },
  knowledgeAsset: async (server, uri) => (server === 'crtx' && uri === 'crtx://lib/assets/fig.png' ? 'data:image/png;base64,S05PV04=' : Promise.reject(new Error('unknown'))),
};
const result = await exportCanvasHtml(CANVAS_PATH, deps);
const html = result.html;

test('1. every node but the group is on the page, and the page loads nothing from the network', () => {
  const ids = CANVAS.nodes.filter(n => n.type !== 'group').map(n => n.id);
  assert.deepEqual(checkOffline(html, ids), { remote: [], missingNodeIds: [] });
  assert.ok(!html.includes('data-node-id="g1"'));
  assert.equal(result.nodes, 13);
  assert.equal(result.edges, 2);
});

test('2. the canvas file is only read', () => {
  assert.equal(readFileSync(CANVAS_PATH, 'utf8'), JSON.stringify(CANVAS));
});

test('3. images: a file next to the canvas, a file next to the markdown file, a knowledge server image', () => {
  assert.deepEqual(result.missing, []);
  assert.ok(html.includes('data:image/png;base64,S05PV04='));
  assert.ok(!html.includes('src="dot.png"') && !html.includes('crtx://lib/assets'));
});

test('4. math: KaTeX HTML where the webview renders, MathML and Typst where the host does', () => {
  const t1 = html.slice(html.indexOf('data-node-id="t1"'), html.indexOf('data-node-id="t2"'));
  const t2 = html.slice(html.indexOf('data-node-id="t2"'), html.indexOf('data-node-id="c1"'));
  assert.ok(t1.includes('<math') && t1.includes('typst-math'));
  assert.ok(t2.includes('katex-html'));
});

test('5. plotly once, the cell script gone, the code coloured, the section frame drawn', () => {
  assert.equal(html.match(/window\.Plotly=/g).length, 1);
  assert.ok(!html.includes('alert(1)'));
  assert.ok(html.includes('<span style="color:#ff8f40">import</span>'));
  assert.ok(html.includes('S1 · One'));
  assert.ok(html.includes('data-md-theme="factors"'));
  assert.ok(html.includes('font-family: "IBM Plex Sans"'));
});

test('6. the file node shows its frontmatter title and status', () => {
  const m1 = html.slice(html.indexOf('data-node-id="m1"'), html.indexOf('data-node-id="l1"'));
  assert.ok(m1.includes('>Notes</span>') && m1.includes('>research</span>'));
});

test('7. the default page path is the canvas path with .html', () => {
  assert.equal(defaultHtmlPath('/a/b/factors-essentials.canvas'), '/a/b/factors-essentials.html');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/extension/export/exportCanvas.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportCanvas.mjs --external:@myriaddreamin/typst-ts-node-compiler "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && npx esbuild src/extension/export/page.ts --bundle --format=esm --outfile=tests/.build/exportPage.mjs && node --test tests/export-canvas.mjs`

Expected: `✘ [ERROR] Could not resolve "src/extension/export/exportCanvas.ts"`.

- [ ] **Step 3: Write `src/extension/export/shikiHost.ts`**

```ts
/**
 * The export's shiki highlighter on the host: the code cell theme the skena.code.theme setting names,
 * the factors palette of the markdown code blocks, dark-plus of the python and yaml file previews,
 * and the languages of all three. shiki/core with only these, so the extension bundle does not carry
 * every grammar.
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { bundledThemes } from 'shiki/themes';
import { FACTORS_THEME } from '../../shared/markdownCodeBlocks';
import { CODE_THEME_FACTORS, resolveCodeTheme } from '../../webview/canvas/codeCellShiki';

export interface ExportHighlighter {
  hl: HighlighterCore;
  /** - the theme code cells are drawn in: a bundled theme id, or `factors` for the factors palette */
  codeTheme: string;
}

/** - the setting as the webview resolves it; `factors` draws code cells in the factors shiki palette */
export async function exportHighlighter(setting: unknown): Promise<ExportHighlighter> {
  const codeTheme = resolveCodeTheme(setting, Object.keys(bundledThemes));
  const themes = [FACTORS_THEME, bundledThemes['dark-plus']];
  if (codeTheme !== CODE_THEME_FACTORS && codeTheme !== 'dark-plus') themes.push(bundledThemes[codeTheme as keyof typeof bundledThemes]);
  const hl = await createHighlighterCore({
    themes,
    langs: [
      import('shiki/langs/python.mjs'), import('shiki/langs/javascript.mjs'), import('shiki/langs/typescript.mjs'),
      import('shiki/langs/bash.mjs'), import('shiki/langs/json.mjs'), import('shiki/langs/yaml.mjs'),
      import('shiki/langs/sql.mjs'), import('shiki/langs/rust.mjs'), import('shiki/langs/go.mjs'),
      import('shiki/langs/markdown.mjs'),
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
  return { hl, codeTheme };
}
```

- [ ] **Step 4: Write `src/extension/export/exportCanvas.ts`**

```ts
/**
 * Exports a .canvas file to one HTML page that needs no network: reads the file (never writes it),
 * lays it out (shared/exportLayout.ts), renders every node with skena's own renderers, puts every
 * image in as a data url and returns the page. No vscode import: the command and the relay endpoint
 * the MCP tool calls both run it with what they read from VS Code (ExportDeps).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { CanvasData, CanvasNode, FileNode, FileType } from '../../shared/types';
import { exportLayout, pageBox } from '../../shared/exportLayout';
import { extractFrontmatter, filenameFromUri } from '../../shared/fileHeader';
import { codeTokenizer } from '../../webview/canvas/codeCellShiki';
import { parseNotebook } from '../notebook-parser';
import { exportEdges } from './edges';
import { codeCellHtml } from './codeHtml';
import { balanceHtml, decodeAttr, escapeHtml, imageSources, stripActiveHtml, swapImageSources } from './html';
import { fileMarkdownHtml, nodeMarkdownHtml, rendersOnHost } from './markdown';
import {
  cellNodeHtml, chatNodeHtml, codeNodeHtml, fileNodeHtml, kernelNodeHtml, knowledgeNodeHtml, linkNodeHtml,
  NODE_BORDER, noderefNodeHtml, notebookHtml, portalNodeHtml, textNodeHtml, type FileView,
} from './nodeHtml';
import { buildPage, sectionFrames, type PageTheme } from './page';
import { exportHighlighter } from './shikiHost';

export interface ExportDeps {
  /** - the extension's dist/: plotly.min.js and export-assets/*.css */
  assetDir: string;
  /** - skena.code.theme */
  codeTheme: string;
  /** - skena.markdownTheme */
  mdTheme: 'vscode' | 'factors';
  /** - skena.markdownMaxWidth */
  mdMaxWidth: number;
  /** - markdown.preview.fontFamily / fontSize, which the webview's own markdown path applies */
  mdFont?: { family?: string; size?: number };
  /** - skena.notebook.showSourceCells */
  notebookShowSource: boolean;
  theme: PageTheme;
  /** - a file node's uri to its path and type, as FileResolver resolves it; null when it does not resolve */
  resolveFile: (uri: string, canvasDir: string) => { fsPath: string; fileType: FileType } | null;
  /** - an image a knowledge server serves, as a data url (KnowledgeService.asset) */
  knowledgeAsset?: (server: string, uri: string) => Promise<string>;
  /** - an http(s) image as a data url */
  fetchImage?: (url: string) => Promise<string>;
  progress?: (done: number, total: number) => void;
}

export interface ExportResult {
  html: string;
  nodes: number;
  edges: number;
  /** - images that could not be read: "<node label> <address>: <reason>" */
  missing: string[];
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

// - an image address only a knowledge server can serve (knowledgeAssets.isKnowledgeUri)
const SERVER_URI = /^[a-z][a-z0-9+.-]*:\/\//i;
const PLAIN_URI = /^(https?|data|blob|file|vscode-[a-z-]+):/i;

async function fileDataUrl(fsPath: string): Promise<string> {
  const mime = IMAGE_MIME[path.extname(fsPath).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${(await fs.readFile(fsPath)).toString('base64')}`;
}

// - lets the extension host's event loop run between two nodes; a large paper takes seconds to render
const yieldToHost = () => new Promise<void>(resolve => setImmediate(resolve));

export async function exportCanvasHtml(canvasPath: string, deps: ExportDeps): Promise<ExportResult> {
  const canvasDir = path.dirname(canvasPath);
  const raw = (await fs.readFile(canvasPath, 'utf-8')).trim();
  const parsed = (raw ? JSON.parse(raw) : {}) as Partial<CanvasData>;
  const canvas: CanvasData = { ...(parsed as CanvasData), nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
  const layout = exportLayout(canvas, Date.now());
  const edges = exportEdges(layout);
  const box = pageBox(layout, edges.flatMap(e => [...e.points, e.labelAt]));
  const { hl, codeTheme } = await exportHighlighter(deps.codeTheme);
  const factors = deps.mdTheme === 'factors';
  const codeTok = codeTokenizer(hl, codeTheme);
  const editorBg = deps.theme.vars['--vscode-editor-background'] ?? (deps.theme.dark ? '#1e1e1e' : '#ffffff');
  const mdStyle = [deps.mdFont?.family && `font-family:${deps.mdFont.family}`, deps.mdFont?.size && `font-size:${deps.mdFont.size}px`].filter(Boolean).join(';');
  const missing: string[] = [];

  // - every <img> of `html` that is not a data url, read and put in; `dir` resolves a relative path
  const inlineImages = async (html: string, label: string, dir: string, server?: string): Promise<string> => {
    const resolved = new Map<string, string | null>();
    await Promise.all(imageSources(html).map(async src => {
      const where = decodeAttr(src);
      try {
        if (/^https?:/i.test(where)) {
          if (!deps.fetchImage) throw new Error('no network fetch given');
          resolved.set(src, await deps.fetchImage(where));
        } else if (SERVER_URI.test(where) && !PLAIN_URI.test(where)) {
          if (!server || !deps.knowledgeAsset) throw new Error('no knowledge server for this image');
          resolved.set(src, await deps.knowledgeAsset(server, where));
        } else {
          const file = deps.resolveFile(where.replace(/^file:\/\//, ''), dir);
          if (!file) throw new Error('does not resolve');
          resolved.set(src, await fileDataUrl(file.fsPath));
        }
      } catch (e) {
        resolved.set(src, null);
        missing.push(`${label} ${where}: ${(e as Error).message}`);
      }
    }));
    return resolved.size ? swapImageSources(html, resolved) : html;
  };

  const fileView = async (n: FileNode): Promise<FileView> => {
    const title = filenameFromUri(n.file);
    const file = deps.resolveFile(n.file, canvasDir);
    if (!file) return { fileType: 'unknown', title, body: '<div class="skena-error">Error: NOT_FOUND</div>' };
    try {
      if (file.fileType === 'image') {
        return { fileType: 'image', title, body: `<img src="${await fileDataUrl(file.fsPath)}" alt="" style="width:100%;height:100%;object-fit:contain;display:block">` };
      }
      const text = await fs.readFile(file.fsPath, 'utf-8');
      if (file.fileType === 'markdown') {
        const fm = extractFrontmatter(text);
        const html = await inlineImages(await fileMarkdownHtml(text, factors, hl), n.nodeLabel ?? n.id, path.dirname(file.fsPath));
        return { fileType: 'markdown', title: fm.title ?? title, status: fm.status, type: fm.type, body: `<div class="skena-markdown">${stripActiveHtml(html)}</div>` };
      }
      const code = (src: string, lang: string) => `<div class="skena-code" style="font-size:11px;line-height:1.5;overflow:auto">${hl.codeToHtml(src, { lang, theme: factors ? 'factors' : 'dark-plus' })}</div>`;
      if (file.fileType === 'python' || file.fileType === 'yaml') return { fileType: file.fileType, title, body: code(text, file.fileType) };
      if (file.fileType === 'html') return { fileType: 'html', title, body: `<div class="skena-html"><template shadowrootmode="open">${stripActiveHtml(text)}</template></div>` };
      if (file.fileType === 'notebook') {
        const nb = parseNotebook(text);
        const md = await Promise.all(nb.cells.map(c => (c.type === 'markdown' ? nodeMarkdownHtml(c.source, factors, hl) : Promise.resolve(''))));
        const lang = hl.getLoadedLanguages().includes(nb.languageName) ? nb.languageName : 'python';
        const body = notebookHtml(nb, md, deps.notebookShowSource, s => code(s, lang), `skena-fig-${n.id}`, n.width - 2 * NODE_BORDER - 16);
        return { fileType: 'notebook', title, body: await inlineImages(body, n.nodeLabel ?? n.id, path.dirname(file.fsPath)) };
      }
      return { fileType: file.fileType, title, body: '<div class="skena-unknown">No preview available</div>' };
    } catch (e) {
      return { fileType: file.fileType, title, body: `<div class="skena-error">Error: ${escapeHtml((e as Error).message)}</div>` };
    }
  };

  const render = async (n: CanvasNode): Promise<string> => {
    const label = n.nodeLabel ?? n.id;
    switch (n.type) {
      case 'text': {
        const html = await inlineImages(await nodeMarkdownHtml(n.text, factors, hl), label, canvasDir);
        return textNodeHtml(n, html, rendersOnHost(n.text, factors) ? '' : mdStyle);
      }
      case 'knowledge': {
        const html = await inlineImages(await nodeMarkdownHtml(n.text, factors, hl), label, canvasDir, n.server);
        return knowledgeNodeHtml(n, html, rendersOnHost(n.text, factors) ? '' : mdStyle);
      }
      case 'code': return codeNodeHtml(n, codeCellHtml(n.code ?? '', codeTok, editorBg, deps.theme.dark));
      case 'cell': {
        const md = n.format === 'markdown' ? await nodeMarkdownHtml(n.content, factors, hl) : null;
        return inlineImages(cellNodeHtml(n, md), label, canvasDir);
      }
      case 'file': return fileNodeHtml(n, await fileView(n));
      case 'link': return linkNodeHtml(n);
      case 'portal': return portalNodeHtml(n);
      case 'noderef': return noderefNodeHtml(n);
      case 'kernel': return kernelNodeHtml(n);
      case 'chat': return chatNodeHtml(n);
      default: return '';
    }
  };

  const nodesHtml: string[] = [];
  for (const [i, n] of layout.nodes.entries()) {
    nodesHtml.push(balanceHtml(await render(n)));
    deps.progress?.(i + 1, layout.nodes.length);
    await yieldToHost();
  }

  const read = (f: string) => fs.readFile(path.join(deps.assetDir, f), 'utf-8');
  const css = [await read('export-assets/katex.css'), await read('export-assets/codicon.css')];
  if (factors) css.push(await read('export-assets/ibm-plex.css'));
  css.push(await read('export-assets/skena.css'));
  const plotlyJs = nodesHtml.some(h => h.includes('data-plotly=')) ? await read('plotly.min.js') : null;

  const html = buildPage({
    title: path.basename(canvasPath, '.canvas'),
    box,
    sections: sectionFrames(layout.lanes, layout.nodes, canvas.metadata?.kernels ?? []),
    nodesHtml,
    edges,
    css,
    theme: deps.theme,
    mdTheme: deps.mdTheme,
    mdMaxWidth: deps.mdMaxWidth,
    plotlyJs,
  });
  return { html, nodes: layout.nodes.length, edges: edges.length, missing };
}

/** - the page the command and the MCP tool write when no path is given: next to the canvas, same name */
export function defaultHtmlPath(canvasPath: string): string {
  return path.join(path.dirname(canvasPath), `${path.basename(canvasPath, '.canvas')}.html`);
}
```

- [ ] **Step 5: Run the tests, typecheck, build**

Run the Step 2 command. Expected: `# tests 7`, `# pass 7`, `# fail 0`.

Typecheck: nothing. Run: `npm run build`. Expected: no `✘ [ERROR]`. (`exportCanvas.ts` is not imported by `extension.ts` until Task 12, so `dist/extension.js` does not grow yet.)

- [ ] **Step 6: Commit**

```bash
git add src/extension/export/shikiHost.ts src/extension/export/exportCanvas.ts tests/export-canvas.mjs
git commit -m "feat(export): export a canvas file to one html page"
```

---

### Task 11: The relay's `/export` route and the endpoint file

**Files:**
- Create: `src/extension/ipcEndpoint.ts`
- Modify: `src/extension/run-ipc.ts` (whole file), `src/extension/llm-adapters/harness.ts:27`, `:496-501`, `src/shared/types.ts:611-614`
- Test: `tests/ipc-endpoint.mjs`, `tests/run-ipc-export.mjs`

The relay (`run-ipc.ts`) already serves `/delta` and `/persist` to an MCP server the AI companion starts with `SKENA_RUN_IPC`. It gets a `/export` route that calls a handler the extension registers (Task 12), and it writes its `port:token` to `skena-ipc-<hashPath(workspace folder)>.json` in the OS temp dir (mode 0600) for each workspace folder once it listens, and removes the files it wrote on dispose (only if they still hold its own value, as another window may have written since). `hashPath` moves from `harness.ts` (same function, which names the `skena-mcp-<hash>.json` temp file) to `ipcEndpoint.ts`, which has no `vscode` import so the MCP server can bundle it.

- [ ] **Step 1: Write the failing tests**

Create `tests/ipc-endpoint.mjs`:

```js
// - run: npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/ipc-endpoint.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { endpointFile, readEndpoint, removeEndpoint, writeEndpoint } from './.build/ipcEndpoint.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'skena-ipc-'));

test('1. what one side writes for a folder the other reads back; the file is owner-only', () => {
  writeEndpoint('/work/a', '4321:tok', TMP);
  assert.equal(readEndpoint('/work/a', TMP), '4321:tok');
  assert.equal(readEndpoint('/work/a/', TMP), '4321:tok');
  assert.equal(statSync(endpointFile('/work/a', TMP)).mode & 0o777, 0o600);
});

test('2. another folder, or no file, reads as none', () => {
  assert.equal(readEndpoint('/work/b', TMP), null);
});

test('3. removing leaves a file another window wrote since', () => {
  writeEndpoint('/work/c', '1:old', TMP);
  writeEndpoint('/work/c', '2:new', TMP);
  removeEndpoint('/work/c', '1:old', TMP);
  assert.equal(readEndpoint('/work/c', TMP), '2:new');
  removeEndpoint('/work/c', '2:new', TMP);
  assert.equal(readEndpoint('/work/c', TMP), null);
});
```

Create `tests/run-ipc-export.mjs`:

```js
// - run: npx esbuild src/extension/run-ipc.ts --bundle --platform=node --format=esm --outfile=tests/.build/runIpc.mjs && npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/run-ipc-export.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIpc } from './.build/runIpc.mjs';
import { readEndpoint } from './.build/ipcEndpoint.mjs';

// - the endpoint files go to a temp dir of this test, not the real one
const TMP = mkdtempSync(join(tmpdir(), 'skena-relay-'));
process.env.TMPDIR = TMP;

const calls = [];
runIpc.start(() => undefined);
runIpc.setExportHandler(async (canvasPath, outPath) => {
  calls.push([canvasPath, outPath]);
  return { ok: true, outPath: outPath ?? '/w/a.html', bytes: 10, nodes: 2, edges: 1, missing: [] };
});
runIpc.advertise(['/work/ws']);
for (let i = 0; i < 100 && !runIpc.endpointEnv(); i++) await new Promise(r => setTimeout(r, 10));
const endpoint = runIpc.endpointEnv();
const [port, token] = endpoint.split(':');
const post = (tok, body) => fetch(`http://127.0.0.1:${port}/export`, { method: 'POST', headers: { 'x-skena-token': tok }, body: JSON.stringify(body) });

test('1. POST /export with the token runs the export handler and answers with its reply', async () => {
  const res = await post(token, { canvasPath: '/w/a.canvas' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, outPath: '/w/a.html', bytes: 10, nodes: 2, edges: 1, missing: [] });
  assert.deepEqual(calls, [['/w/a.canvas', undefined]]);
});

test('2. a request without the token is refused', async () => {
  assert.equal((await post('wrong', { canvasPath: '/w/a.canvas' })).status, 403);
});

test('3. the workspace folder\'s endpoint file names this relay; dispose removes it', () => {
  assert.equal(readEndpoint('/work/ws', TMP), endpoint);
  runIpc.dispose();
  assert.equal(readEndpoint('/work/ws', TMP), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/ipc-endpoint.mjs`

Expected: `✘ [ERROR] Could not resolve "src/extension/ipcEndpoint.ts"`.

- [ ] **Step 3: Write `src/extension/ipcEndpoint.ts`**

```ts
/**
 * Where an MCP server started outside skena (Claude Code reading .mcp.json) finds the extension's
 * 127.0.0.1 relay: a file in the OS temp dir per workspace folder, owner-only, holding the relay's
 * "port:token". The extension writes it when the relay listens and removes it on dispose; an MCP
 * server started by the AI companion gets the same value in SKENA_RUN_IPC. No vscode import.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** - short stable token from a path, for temp-file naming */
export function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = (h * 31 + p.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

export function endpointFile(workspaceDir: string, tmp = os.tmpdir()): string {
  return path.join(tmp, `skena-ipc-${hashPath(path.resolve(workspaceDir))}.json`);
}

/** - `endpoint` is the relay's "port:token" */
export function writeEndpoint(workspaceDir: string, endpoint: string, tmp = os.tmpdir()): void {
  const file = endpointFile(workspaceDir, tmp);
  fs.writeFileSync(file, JSON.stringify({ endpoint, workspaceDir: path.resolve(workspaceDir), pid: process.pid }), { mode: 0o600 });
}

/** The "port:token" written for `workspaceDir`, or null when there is none (or it names another folder). */
export function readEndpoint(workspaceDir: string, tmp = os.tmpdir()): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(endpointFile(workspaceDir, tmp), 'utf-8')) as { endpoint?: unknown; workspaceDir?: unknown };
    return typeof j.endpoint === 'string' && j.workspaceDir === path.resolve(workspaceDir) ? j.endpoint : null;
  } catch {
    return null;
  }
}

/** - removes the file only when it still holds `endpoint`: another window may have written its own since */
export function removeEndpoint(workspaceDir: string, endpoint: string, tmp = os.tmpdir()): void {
  if (readEndpoint(workspaceDir, tmp) !== endpoint) return;
  try { fs.unlinkSync(endpointFile(workspaceDir, tmp)); } catch { /* - already gone */ }
}
```

- [ ] **Step 4: `harness.ts` imports `hashPath`**

In `src/extension/llm-adapters/harness.ts` (line 27), find:

```ts
import { runIpc } from '../run-ipc';
```

replace with:

```ts
import { runIpc } from '../run-ipc';
import { hashPath } from '../ipcEndpoint';
```

Delete the last lines of the file (lines 496-501) and the blank line before them, so the file ends with the `}` of the function above:

```ts
/** - short stable token from a path, for temp-file naming */
function hashPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = (h * 31 + p.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}
```

- [ ] **Step 5: The reply type**

In `src/shared/types.ts` (line 611), find:

```ts
export interface AgentRunPersistResult {
  handled:       boolean;        // - false when no panel is open for this canvas → MCP falls back to writeCanvas
  outputNodeId?: string;         // - authoritative output-node id (returned on 'start')
}
```

replace with:

```ts
export interface AgentRunPersistResult {
  handled:       boolean;        // - false when no panel is open for this canvas → MCP falls back to writeCanvas
  outputNodeId?: string;         // - authoritative output-node id (returned on 'start')
}

/** - the relay's answer to POST /export (the MCP tool canvas_export_html) */
export type ExportReply =
  | { ok: true; outPath: string; bytes: number; nodes: number; edges: number; missing: string[] }
  | { ok: false; error: string };
```

- [ ] **Step 6: The relay**

Replace the whole of `src/extension/run-ipc.ts` with:

```ts
import * as http from 'http';
import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import type { HostToWebview, AgentRunPersistResult, ExportReply } from '../shared/types';
import { removeEndpoint, writeEndpoint } from './ipcEndpoint';

// - a tiny 127.0.0.1 relay so the OUT-OF-PROCESS MCP server can stream a running cell's live output
// - back to the extension host, which forwards it to the right canvas webview (no canvas reload).
// - the MCP posts newline-free JSON frames to POST /delta with an x-skena-token header; the host
// - looks up the panel by canvasPath and posts the carried message straight to its webview.
interface RunFrame { canvasPath: string; message: HostToWebview }

type ResolvePanel = (canvasPath: string) => vscode.WebviewPanel | undefined;
// - request/response: apply an agent-run mutation to the host's authoritative canvas + write it
// - (single-writer). Returns handled=false when no panel is open, so the MCP falls back to a direct write.
type PersistHandler = (canvasPath: string, payload: unknown) => Promise<AgentRunPersistResult>;
// - request/response: write the canvas as one HTML page (the MCP tool canvas_export_html)
type ExportHandler = (canvasPath: string, outPath: string | undefined) => Promise<ExportReply>;

class RunIpc {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';
  private resolvePanel: ResolvePanel = () => undefined;
  private persistHandler: PersistHandler | null = null;
  private exportHandler: ExportHandler | null = null;
  // - the workspace folders whose endpoint file this relay wrote, or will write once it listens
  private advertised: string[] = [];

  // - start once on activation. Binds an ephemeral 127.0.0.1 port; the token gates every request.
  start(resolvePanel: ResolvePanel, persistHandler?: PersistHandler): void {
    if (this.server) return;
    this.resolvePanel = resolvePanel;
    this.persistHandler = persistHandler ?? null;
    this.token = randomUUID();
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.headers['x-skena-token'] !== this.token) {
        res.statusCode = 403; res.end(); return;
      }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 8_000_000) req.destroy(); });
      req.on('end', () => { void this.handle(req.url ?? '', body, res); });
    });
    this.server.on('error', () => { /* - relay is best-effort; agent runs still persist to disk */ });
    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server?.address();
      if (addr && typeof addr === 'object') this.port = addr.port;
      this.writeEndpoints();
    });
  }

  setExportHandler(fn: ExportHandler): void {
    this.exportHandler = fn;
  }

  /**
   * Writes the endpoint file of each workspace folder (ipcEndpoint.ts), so an MCP server Claude Code
   * started from .mcp.json finds this relay; before the relay listens, once it does.
   */
  advertise(workspaceDirs: string[]): void {
    this.advertised = workspaceDirs;
    this.writeEndpoints();
  }

  private writeEndpoints(): void {
    const endpoint = this.endpointEnv();
    if (!endpoint) return;
    for (const dir of this.advertised) {
      try { writeEndpoint(dir, endpoint); } catch { /* - best-effort, like the relay itself */ }
    }
  }

  // - route a POSTed body by url. /delta is fire-and-forget (forward → panel, 204); /persist is
  // - request/response (apply mutation via the host, reply with AgentRunPersistResult). Best-effort:
  // - a parse/handler error still answers {handled:false} so the MCP falls back to a direct write.
  private async handle(url: string, body: string, res: http.ServerResponse): Promise<void> {
    if (url === '/delta') {
      try {
        const frame = JSON.parse(body) as RunFrame;
        this.resolvePanel(frame.canvasPath)?.webview.postMessage(frame.message);
      } catch { /* - ignore a malformed frame */ }
      res.statusCode = 204; res.end(); return;
    }
    if (url === '/persist') {
      let result: AgentRunPersistResult = { handled: false };
      try {
        const { canvasPath, payload } = JSON.parse(body) as { canvasPath: string; payload: unknown };
        if (this.persistHandler) result = await this.persistHandler(canvasPath, payload);
      } catch { /* - fall back to {handled:false} */ }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result)); return;
    }
    if (url === '/export') {
      let reply: ExportReply = { ok: false, error: 'the extension has no export handler' };
      try {
        const { canvasPath, outPath } = JSON.parse(body) as { canvasPath: string; outPath?: string };
        if (this.exportHandler) reply = await this.exportHandler(canvasPath, outPath);
      } catch (e) {
        reply = { ok: false, error: (e as Error).message };
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply)); return;
    }
    res.statusCode = 403; res.end();
  }

  // - "port:token" for the MCP env, or null if the socket isn't listening yet (MCP then skips streaming)
  endpointEnv(): string | null {
    return this.port ? `${this.port}:${this.token}` : null;
  }

  dispose(): void {
    const endpoint = this.endpointEnv();
    if (endpoint) for (const dir of this.advertised) removeEndpoint(dir, endpoint);
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null; this.port = 0;
  }
}

export const runIpc = new RunIpc();
```

- [ ] **Step 7: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 3`, `# pass 3`, `# fail 0`.

Run: `npx esbuild src/extension/run-ipc.ts --bundle --platform=node --format=esm --outfile=tests/.build/runIpc.mjs && npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/run-ipc-export.mjs`
Expected: `# tests 3`, `# pass 3`, `# fail 0`.

Typecheck: nothing.

- [ ] **Step 8: Commit**

```bash
git add src/extension/ipcEndpoint.ts src/extension/llm-adapters/harness.ts src/shared/types.ts src/extension/run-ipc.ts tests/ipc-endpoint.mjs tests/run-ipc-export.mjs
git commit -m "feat(export): relay route /export and its endpoint file for .mcp.json servers"
```

---

### Task 12: The command, the theme of the open canvas, the relay handler

**Files:**
- Create: `src/webview/exportTheme.ts`, `src/extension/export/exportCommand.ts`
- Modify: `src/shared/types.ts` (after `ExportReply`, `:497-498`, `:817-818`), `src/webview/App.tsx:23`, `:163-165`, `src/extension/editor-provider.ts:79-80`, `:166-167`, `:170-171`, `:560`, `src/extension/extension.ts:6`, `:129-134`, `:136-137`, `package.json:110-112`

The webview is where VS Code puts its theme colours and editor font (`--vscode-*` variables); the extension API gives the host only the theme kind (`window.activeColorTheme.kind`), not the colours (INFERENCE from the API). The export asks an open canvas webview (that canvas's own, else the focused one, else any) with `exportThemeRequest` and waits two seconds for `exportThemeResult`; with no answer it uses `FALLBACK_THEME`. The command and the relay handler load `export/exportCommand.ts` with `await import(…)`; esbuild still puts it in `extension.js` (no code splitting in the CJS bundle) but runs its module code only on the first export.

- [ ] **Step 1: The messages**

In `src/shared/types.ts`, find the `ExportReply` type added in Task 11:

```ts
export type ExportReply =
  | { ok: true; outPath: string; bytes: number; nodes: number; edges: number; missing: string[] }
  | { ok: false; error: string };
```

replace with:

```ts
export type ExportReply =
  | { ok: true; outPath: string; bytes: number; nodes: number; edges: number; missing: string[] }
  | { ok: false; error: string };

/** - host → webview: the HTML export asks for the theme variables VS Code gave this webview */
export interface MsgExportThemeRequest { type: 'exportThemeRequest'; requestId: string; }
/** - webview → host: every --vscode-* variable on the page, and whether the theme is dark */
export interface MsgExportThemeResult { type: 'exportThemeResult'; requestId: string; vars: Record<string, string>; dark: boolean; }
```

Find (line 497):

```ts
export type HostToWebview =
  | MsgCanvasLoaded
```

replace with:

```ts
export type HostToWebview =
  | MsgCanvasLoaded
  | MsgExportThemeRequest
```

Find (line 817):

```ts
export type WebviewToHost =
  | MsgRequestFile
```

replace with:

```ts
export type WebviewToHost =
  | MsgRequestFile
  | MsgExportThemeResult
```

- [ ] **Step 2: The webview answers**

Create `src/webview/exportTheme.ts`:

```ts
import { isDarkTheme } from './canvas/palette';

/**
 * Every --vscode-* variable VS Code set on this webview, and whether its theme is dark: the HTML
 * export colours its page with them (export/exportCommand.ts asks through exportThemeRequest).
 */
export function exportThemeVars(): { vars: Record<string, string>; dark: boolean } {
  const vars: Record<string, string> = {};
  const take = (d: CSSStyleDeclaration) => {
    for (let i = 0; i < d.length; i++) {
      const name = d[i];
      if (name.startsWith('--vscode-')) vars[name] = d.getPropertyValue(name).trim();
    }
  };
  // - VS Code writes them as inline style on <html>; the computed style is the fallback
  take(document.documentElement.style);
  if (Object.keys(vars).length === 0) take(getComputedStyle(document.documentElement));
  return { vars, dark: isDarkTheme() };
}
```

In `src/webview/App.tsx` (line 23), find:

```tsx
import { setCodeTheme } from './canvas/codeCellTheme';
```

replace with:

```tsx
import { setCodeTheme } from './canvas/codeCellTheme';
import { exportThemeVars } from './exportTheme';
```

Find (line 163):

```tsx
        case 'codeConfig':
          setCodeTheme(msg.config.theme);
          break;
```

replace with:

```tsx
        case 'codeConfig':
          setCodeTheme(msg.config.theme);
          break;
        case 'exportThemeRequest':
          postMessage({ type: 'exportThemeResult', requestId: msg.requestId, ...exportThemeVars() });
          break;
```

- [ ] **Step 3: The provider asks, and serves knowledge images**

In `src/extension/editor-provider.ts` (line 79), find:

```ts
  AgentRunPersist,
  AgentRunPersistResult,
} from '../shared/types';
```

replace with:

```ts
  AgentRunPersist,
  AgentRunPersistResult,
  MsgExportThemeRequest,
} from '../shared/types';
```

Find (line 166):

```ts
  // - canvasPath (fsPath) → nodeLabel to focus once that canvas's webview reports ready
  private pendingFocus = new Map<string, string>();
```

replace with:

```ts
  // - canvasPath (fsPath) → nodeLabel to focus once that canvas's webview reports ready
  private pendingFocus = new Map<string, string>();

  /** - the canvas of the focused canvas tab, or null */
  static activeCanvasPath(): string | null {
    for (const [p, panel] of SkenaEditorProvider.panelsByPath) if (panel === SkenaEditorProvider.activePanel) return p;
    return null;
  }

  /** An image a knowledge server serves, as a data url, for the HTML export; the server list is re-read from settings. */
  async knowledgeAsset(server: string, uri: string): Promise<string> {
    this.knowledge.configure(await getKnowledgeServers());
    return this.knowledge.asset(server, uri);
  }

  /**
   * The --vscode-* variables of an open canvas webview for the HTML export: that canvas's own, else
   * the focused one's, else any. Null when no canvas is open or none answers within two seconds.
   */
  requestTheme(canvasPath: string): Promise<{ vars: Record<string, string>; dark: boolean } | null> {
    const panel = SkenaEditorProvider.panelsByPath.get(canvasPath) ?? SkenaEditorProvider.activePanel ?? [...SkenaEditorProvider.panelsByPath.values()][0];
    if (!panel) return Promise.resolve(null);
    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.themeWaiters.delete(requestId); resolve(null); }, 2000);
      this.themeWaiters.set(requestId, theme => { clearTimeout(timer); this.themeWaiters.delete(requestId); resolve(theme); });
      void panel.webview.postMessage({ type: 'exportThemeRequest', requestId } satisfies MsgExportThemeRequest);
    });
  }
```

Find (line 170):

```ts
  /** - providers for skena.knowledge.servers; reconfigured from settings on every webview ready */
  private knowledge = new KnowledgeService();
```

replace with:

```ts
  /** - providers for skena.knowledge.servers; reconfigured from settings on every webview ready */
  private knowledge = new KnowledgeService();

  /** - the HTML export's theme requests waiting for a webview's answer, by request id */
  private themeWaiters = new Map<string, (theme: { vars: Record<string, string>; dark: boolean }) => void>();
```

Find (line 560):

```ts
        case 'knowledgeAsset': {
```

replace with:

```ts
        case 'exportThemeResult': this.themeWaiters.get(msg.requestId)?.({ vars: msg.vars, dark: msg.dark }); break;
        case 'knowledgeAsset': {
```

- [ ] **Step 4: Write `src/extension/export/exportCommand.ts`**

```ts
/**
 * The VS Code side of the HTML export: what exportCanvasHtml needs, read from the settings, the
 * open canvas webviews and the knowledge servers; the "Skena: Export canvas to HTML" command; and
 * the file write both the command and the relay's /export (the MCP tool) go through.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExportReply } from '../../shared/types';
import { FileResolver } from '../file-resolver';
import { getVaults } from '../settings';
import type { SkenaEditorProvider } from '../editor-provider';
import { defaultHtmlPath, exportCanvasHtml, type ExportDeps } from './exportCanvas';
import { FALLBACK_THEME } from './page';

// - an http(s) image for the page, as a data url; 15 s per image
async function fetchDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

async function exportDeps(context: vscode.ExtensionContext, provider: SkenaEditorProvider, canvasPath: string, progress?: ExportDeps['progress']): Promise<ExportDeps> {
  const skena = vscode.workspace.getConfiguration('skena');
  const preview = vscode.workspace.getConfiguration('markdown.preview');
  const resolver = new FileResolver(await getVaults());
  return {
    assetDir: context.asAbsolutePath('dist'),
    codeTheme: skena.get<string>('code.theme') ?? 'ayu-dark',
    mdTheme: skena.get<'vscode' | 'factors'>('markdownTheme') ?? 'vscode',
    mdMaxWidth: skena.get<number>('markdownMaxWidth') ?? 0,
    mdFont: { family: preview.get<string>('fontFamily'), size: preview.get<number>('fontSize') },
    notebookShowSource: skena.get<{ showSourceCells?: boolean }>('notebook')?.showSourceCells ?? false,
    theme: (await provider.requestTheme(canvasPath)) ?? FALLBACK_THEME,
    resolveFile: (uri, dir) => {
      const r = resolver.resolve(uri, dir);
      return r && !r.isNotion ? { fsPath: r.fsPath, fileType: r.fileType } : null;
    },
    knowledgeAsset: (server, uri) => provider.knowledgeAsset(server, uri),
    fetchImage: fetchDataUrl,
    progress,
  };
}

/** Exports `canvasPath` to `outPath` (default: next to it, .html). Never throws: a failure is the reply. */
export async function exportToFile(
  context: vscode.ExtensionContext, provider: SkenaEditorProvider, canvasPath: string, outPath?: string, progress?: ExportDeps['progress'],
): Promise<ExportReply> {
  try {
    const target = outPath ?? defaultHtmlPath(canvasPath);
    const r = await exportCanvasHtml(canvasPath, await exportDeps(context, provider, canvasPath, progress));
    await fs.writeFile(target, r.html, 'utf-8');
    return { ok: true, outPath: target, bytes: Buffer.byteLength(r.html), nodes: r.nodes, edges: r.edges, missing: r.missing };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** "Skena: Export canvas to HTML": the focused canvas (else one picked), a save dialog, a progress note. */
export async function exportCommand(context: vscode.ExtensionContext, provider: SkenaEditorProvider, active: string | null): Promise<void> {
  let canvasPath = active;
  if (!canvasPath) {
    const picked = await vscode.window.showOpenDialog({ filters: { 'Canvas files': ['canvas'] }, canSelectMany: false });
    canvasPath = picked?.[0]?.fsPath ?? null;
  }
  if (!canvasPath) return;
  const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultHtmlPath(canvasPath)), filters: { HTML: ['html'] } });
  if (!target) return;
  const from = canvasPath;
  const reply = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Skena: exporting ${path.basename(from)}` },
    p => exportToFile(context, provider, from, target.fsPath, (done, total) => p.report({ message: `${done}/${total} nodes`, increment: 100 / total })),
  );
  if (!reply.ok) { void vscode.window.showErrorMessage(`Skena: export failed: ${reply.error}`); return; }
  const missing = reply.missing.length ? `; ${reply.missing.length} images could not be read (their address is shown instead)` : '';
  const choice = await vscode.window.showInformationMessage(
    `Skena: exported ${reply.nodes} nodes to ${path.basename(reply.outPath)} (${(reply.bytes / 1e6).toFixed(1)} MB)${missing}`, 'Open in browser',
  );
  if (choice) void vscode.env.openExternal(vscode.Uri.file(reply.outPath));
}
```

- [ ] **Step 5: Register the command and the relay handler**

In `package.json` (line 110), find:

```json
      {
        "command": "skena.newSection",
        "title": "Skena: New Section"
      }
    ],
```

replace with:

```json
      {
        "command": "skena.newSection",
        "title": "Skena: New Section"
      },
      {
        "command": "skena.exportHtml",
        "title": "Skena: Export canvas to HTML"
      }
    ],
```

In `src/extension/extension.ts` (line 6), find:

```ts
 * - Commands: openCanvas, quickSearch, addNode, addTextNode*, addKernel, newSection
```

replace with:

```ts
 * - Commands: openCanvas, quickSearch, addNode, addTextNode*, addKernel, newSection, exportHtml
```

Find (line 129):

```ts
    vscode.commands.registerCommand('skena.newSection', () => {
      const panel = SkenaEditorProvider.activePanel;
      if (!panel) { void vscode.window.showInformationMessage('Skena: open a canvas first.'); return; }
      panel.webview.postMessage({ type: 'newSectionTrigger' });
    })
  );
```

replace with:

```ts
    vscode.commands.registerCommand('skena.newSection', () => {
      const panel = SkenaEditorProvider.activePanel;
      if (!panel) { void vscode.window.showInformationMessage('Skena: open a canvas first.'); return; }
      panel.webview.postMessage({ type: 'newSectionTrigger' });
    }),

    // - the export module (shiki, the markdown renderers) is loaded on first use, not at activation
    vscode.commands.registerCommand('skena.exportHtml', async () => {
      const { exportCommand } = await import('./export/exportCommand');
      await exportCommand(context, editorProvider as SkenaEditorProvider, SkenaEditorProvider.activeCanvasPath());
    })
  );

  // - the relay's /export: the MCP tool canvas_export_html renders through this extension
  runIpc.setExportHandler(async (canvasPath, outPath) => {
    const { exportToFile } = await import('./export/exportCommand');
    return exportToFile(context, editorProvider as SkenaEditorProvider, canvasPath, outPath);
  });
```

Find (line 136):

```ts
  // - deploy MCP server to each workspace folder
  const folders = vscode.workspace.workspaceFolders ?? [];
```

replace with:

```ts
  // - deploy MCP server to each workspace folder
  const folders = vscode.workspace.workspaceFolders ?? [];
  // - and tell an MCP server started from .mcp.json where the relay is (ipcEndpoint.ts)
  runIpc.advertise(folders.map(f => f.uri.fsPath));
```

- [ ] **Step 6: Typecheck, build, the tests so far**

Typecheck: nothing. Run: `npm run build`. Expected: no `✘ [ERROR]`; `dist/extension.js` is now several MB larger (production: 1.30 MB → 3.85 MB, measured with `node esbuild.config.mjs --production`).

Run the test commands of Tasks 1-11 (line 1 of each test file). Expected: all pass with the counts above.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/webview/exportTheme.ts src/webview/App.tsx src/extension/editor-provider.ts src/extension/export/exportCommand.ts src/extension/extension.ts package.json
git commit -m "feat(export): command Skena: Export canvas to HTML and the relay export handler"
```

- [ ] **Step 8: Manual check (the user runs this)**

Ctrl+F5 (Extension Development Host) on a workspace with a canvas. The implementer reports this step as not run.
- [ ] Open a canvas with text (with `$…$` and `%…%`), code cells, an output cell, a plotly cell and a folded section. Command palette → **Skena: Export canvas to HTML**: the save dialog proposes `<canvas dir>/<name>.html`. Save: a progress note counts nodes, then "exported N nodes to … (x MB)" with **Open in browser**.
- [ ] In the browser: the background and text colours, and the code cell font, are those of the VS Code window (not Dark Modern grey, unless that is the theme). The folded section is drawn unfolded, its members inside its frame.
- [ ] Close every canvas tab, run the command again (it asks for a canvas file): the page uses the Dark Modern fallback colours.
- [ ] Disconnect the network (or block it in DevTools → Network → Offline) and reload the page: nothing is missing; DevTools → Network shows only the page itself.

---

### Task 13: The MCP tool `canvas_export_html`

**Files:**
- Modify: `src/extension/mcp/server.ts:41`, `:1700`, `:2051-2052`, `:2125`
- Test: `tests/mcp-export.mjs`

The tool resolves the paths, refuses anything that is not an existing `.canvas` file, finds the relay (`SKENA_RUN_IPC`, else the endpoint file of the workspace folder above the canvas, else of the working directory), posts `{ canvasPath, outPath }` to `/export` and reports what was written. With no relay it says so; a 403 means the running extension is older than the script (no `/export`) or the file is stale.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-export.mjs`:

```js
// - run: npm run build && npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/mcp-export.mjs
// - the MCP tool canvas_export_html against a fake relay; scratch files under the OS temp dir only
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { writeEndpoint } from './.build/ipcEndpoint.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), 'skena-mcp-export-'));
const WS = join(TMP, 'ws');
mkdirSync(join(WS, '.vscode'), { recursive: true });
const CANVAS = join(WS, 'a.canvas');
writeFileSync(CANVAS, JSON.stringify({ nodes: [], edges: [] }));

// - a relay that answers /export the way run-ipc.ts does, and records what it was asked
const seen = [];
const relay = createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, token: req.headers['x-skena-token'], body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, outPath: join(WS, 'a.html'), bytes: 2_500_000, nodes: 3, edges: 2, missing: ['W1 crtx://x/img.png: HTTP 404'] }));
  });
});
await new Promise(r => relay.listen(0, '127.0.0.1', r));
const PORT = relay.address().port;
after(() => relay.close());

// - one MCP call in a fresh server process
function call(env, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(REPO, 'dist/mcp-server.js')], { cwd: WS, env: { PATH: process.env.PATH, TMPDIR: TMP, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d;
      for (const line of buf.split('\n').slice(0, -1)) {
        const msg = JSON.parse(line);
        if (msg.id === 2) { proc.kill(); resolve(msg.result.content[0].text); }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    proc.on('error', reject);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'canvas_export_html', arguments: args } }) + '\n');
  });
}

test('1. without a running extension the tool says how to get one', async () => {
  const text = await call({}, { canvasPath: CANVAS });
  assert.match(text, /^Error: no running skena extension found for this workspace/);
});

test('2. with SKENA_RUN_IPC it asks that relay and reports what it wrote', async () => {
  const text = await call({ SKENA_RUN_IPC: `${PORT}:tok-env` }, { canvasPath: CANVAS, outPath: join(TMP, 'out.html') });
  assert.equal(text, `Exported 3 nodes and 2 edges to ${join(WS, 'a.html')} (2.5 MB).\n1 images could not be read and show their address instead:\nW1 crtx://x/img.png: HTTP 404`);
  assert.deepEqual(seen.at(-1), { url: '/export', token: 'tok-env', body: { canvasPath: CANVAS, outPath: join(TMP, 'out.html') } });
});

test('3. started from .mcp.json it finds the relay through the endpoint file of the canvas\'s workspace', async () => {
  writeEndpoint(WS, `${PORT}:tok-file`, TMP);
  await call({}, { canvasPath: CANVAS });
  assert.deepEqual(seen.at(-1), { url: '/export', token: 'tok-file', body: { canvasPath: CANVAS } });
});

test('4. a path that is not a .canvas file is refused before anything is asked', async () => {
  const before = seen.length;
  assert.match(await call({ SKENA_RUN_IPC: `${PORT}:t` }, { canvasPath: join(WS, 'a.md') }), /^Error: not a \.canvas file/);
  assert.equal(seen.length, before);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/mcp-export.mjs`

Expected: `# fail 4` (the server answers `Error: Unknown tool: canvas_export_html`).

- [ ] **Step 3: The tool**

In `src/extension/mcp/server.ts` (line 41), find:

```ts
import type { CollectedOutput } from '../jupyter/protocol';
```

replace with:

```ts
import type { CollectedOutput } from '../jupyter/protocol';
import { readEndpoint } from '../ipcEndpoint';
import type { ExportReply } from '../../shared/types';
```

Find (line 1700):

```ts
// ─── tool definitions ─────────────────────────────────────────────────────────
```

replace with:

```ts
const NO_EXPORT_HOST = 'no running skena extension found for this workspace. The page is rendered by the extension, which has Typst, the code theme setting and the knowledge server token: open the workspace in VS Code, open any .canvas in it once (that starts skena), and call this again.';

// - the relay of the extension running this workspace: the AI companion passes it in SKENA_RUN_IPC;
//   an MCP server started from .mcp.json reads the endpoint file the extension wrote (ipcEndpoint.ts)
function exportHost(canvasPath: string): { port: number; token: string } | null {
  const fromEnv = parseRunIpc(process.env.SKENA_RUN_IPC);
  if (fromEnv) return fromEnv;
  const dirs = [workspaceDirAbove(path.dirname(canvasPath)), process.cwd()].filter((d): d is string => !!d);
  for (const dir of dirs) {
    const ipc = parseRunIpc(readEndpoint(dir) ?? undefined);
    if (ipc) return ipc;
  }
  return null;
}

async function canvasExportHtml(args: Record<string, unknown>): Promise<string> {
  const canvasPath = resolvePath(String(args.canvasPath ?? ''));
  if (!canvasPath.endsWith('.canvas')) throw new Error(`not a .canvas file: ${canvasPath}`);
  await fs.access(canvasPath);
  const outPath = typeof args.outPath === 'string' && args.outPath.trim() ? resolvePath(args.outPath) : undefined;
  const ipc = exportHost(canvasPath);
  if (!ipc) throw new Error(NO_EXPORT_HOST);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${ipc.port}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-skena-token': ipc.token },
      body: JSON.stringify({ canvasPath, outPath }),
    });
  } catch {
    throw new Error(NO_EXPORT_HOST);
  }
  // - an extension older than this script has no /export and refuses it like a wrong token
  if (res.status === 403) throw new Error('the skena extension of this workspace refused the export: it may be older than this MCP script; reload the VS Code window');
  if (!res.ok) throw new Error(`the skena extension answered HTTP ${res.status}`);
  const reply = await res.json() as ExportReply;
  if (!reply.ok) throw new Error(reply.error);
  const missing = reply.missing.length
    ? `\n${reply.missing.length} images could not be read and show their address instead:\n${reply.missing.slice(0, 20).join('\n')}`
    : '';
  return `Exported ${reply.nodes} nodes and ${reply.edges} edges to ${reply.outPath} (${(reply.bytes / 1e6).toFixed(1)} MB).${missing}`;
}

// ─── tool definitions ─────────────────────────────────────────────────────────
```

Find the end of `TOOLS` (lines 2050-2052, after the `canvas_run_cell` entry):

```ts
      required: ['canvasPath', 'cellRef'],
    },
  },
];
```

replace with:

```ts
      required: ['canvasPath', 'cellRef'],
    },
  },
  {
    name: 'canvas_export_html',
    description: 'Write the canvas as one self-contained HTML page that loads nothing from the network: every node at its canvas position and size with its label, sections as frames (folded ones drawn unfolded), edges with their labels, math (KaTeX, Typst), code cells in the skena.code.theme colours, output cells (html, images, plotly), knowledge nodes and markdown files in full, all fonts and images inlined. Read-only on the .canvas file. The page is rendered by the skena extension of the running VS Code window of this workspace; without one this tool says so.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        outPath:    { type: 'string', description: 'Where to write the page; default: next to the canvas, same name, .html. An existing file is overwritten.' },
      },
      required: ['canvasPath'],
    },
  },
];
```

Find (line 2125):

```ts
        case 'canvas_remove_kernel':  text = await canvasRemoveKernel(args);  break;
```

replace with:

```ts
        case 'canvas_remove_kernel':  text = await canvasRemoveKernel(args);  break;
        case 'canvas_export_html':    text = await canvasExportHtml(args);    break;
```

- [ ] **Step 4: Run the tests, typecheck**

Run the Step 2 command. Expected: `# tests 4`, `# pass 4`, `# fail 0`.

Run: `node --test tests/mcp-parity.mjs`. Expected: `# pass 52`, `# fail 0`.

Typecheck: nothing.

- [ ] **Step 5: Commit**

```bash
git add src/extension/mcp/server.ts tests/mcp-export.mjs
git commit -m "feat(mcp): canvas_export_html asks the running extension to export"
```

---

### Task 14: Export factors-essentials and check the page

**Files:**
- Create: `tests/export-check.mjs`
- Read only: `/home/quant0/projects/factors/research/review/factors-essentials.canvas`

`tests/export-check.mjs` checks one exported page against the canvas it came from; its tests are skipped unless `SKENA_EXPORT_HTML` and `SKENA_EXPORT_CANVAS` are set. The export itself runs here through a throwaway driver outside the repo (not committed: the user wants no standalone script), with the fallback theme, the default settings and no knowledge server, so the 124 `crtx://` images of the knowledge nodes stay out and are listed as missing. The user's export through the command (Task 12) and the MCP tool brings them in.

- [ ] **Step 1: Write the check**

Create `tests/export-check.mjs`:

```js
// - run: npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && SKENA_EXPORT_HTML=<page.html> SKENA_EXPORT_CANVAS=<file.canvas> node --test tests/export-check.mjs
// - checks one exported page against the canvas it came from; every test is skipped when the two variables are not set
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkOffline } from './.build/offlineCheck.mjs';

const HTML = process.env.SKENA_EXPORT_HTML;
const CANVAS = process.env.SKENA_EXPORT_CANVAS;
const skip = !HTML || !CANVAS ? 'set SKENA_EXPORT_HTML and SKENA_EXPORT_CANVAS' : false;
const html = skip ? '' : readFileSync(HTML, 'utf8');
const canvas = skip ? { nodes: [], edges: [] } : JSON.parse(readFileSync(CANVAS, 'utf8'));
const nodes = canvas.nodes.filter(n => n.type !== 'group');
const ids = new Set(nodes.map(n => n.id));

test('1. the page loads nothing from the network', { skip }, () => {
  assert.deepEqual(checkOffline(html, []).remote, []);
});

test('2. every node but the groups is on the page, with its label', { skip }, () => {
  assert.deepEqual(checkOffline(html, [...ids]).missingNodeIds, []);
  const unlabelled = nodes.filter(n => n.nodeLabel && !html.includes(`data-label="${n.nodeLabel}"`)).map(n => n.nodeLabel);
  assert.deepEqual(unlabelled, []);
});

test('3. every edge between two shown nodes is drawn', { skip }, () => {
  const drawn = canvas.edges.filter(e => ids.has(e.fromNode) && ids.has(e.toNode));
  assert.equal((html.match(/<path data-edge-id="/g) ?? []).length, drawn.length);
});

test('4. every section has a frame', { skip }, () => {
  for (const s of canvas.metadata?.sections ?? []) assert.ok(html.includes(`data-section-id="${s.id}"`), s.id);
});

test('5. plotly.js is in the page once when a figure is, and every figure has its JSON', { skip }, () => {
  const figures = (html.match(/data-plotly="/g) ?? []).length;
  const json = (html.match(/<script type="application\/json" id="skena-fig-/g) ?? []).length;
  assert.equal(json, figures);
  assert.equal((html.match(/<script>/g) ?? []).length, figures ? 2 : 0);
});
```

Run: `npx esbuild src/extension/export/offlineCheck.ts --bundle --format=esm --outfile=tests/.build/offlineCheck.mjs && node --test tests/export-check.mjs`
Expected: `# tests 5`, `# skipped 5`.

- [ ] **Step 2: Export the canvas outside VS Code**

```bash
REPO=$(git rev-parse --show-toplevel)
RUN=$(mktemp -d)
CANVAS=/home/quant0/projects/factors/research/review/factors-essentials.canvas
sha256sum "$CANVAS" > "$RUN/before.sha"
npm run build
cat > "$RUN/driver.ts" <<EOF
import * as fs from 'fs';
import * as path from 'path';
import type { FileType } from '$REPO/src/shared/types';
import { exportCanvasHtml } from '$REPO/src/extension/export/exportCanvas';
import { FALLBACK_THEME } from '$REPO/src/extension/export/page';

// - FileResolver.resolve without vault:// (that class imports vscode): a path relative to the given folder
const TYPES: Record<string, FileType> = {
  '.md': 'markdown', '.ipynb': 'notebook', '.py': 'python', '.yaml': 'yaml', '.yml': 'yaml',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image', '.html': 'html', '.htm': 'html',
};

async function main(): Promise<void> {
  const [canvasPath, out, assetDir] = process.argv.slice(2);
  const t0 = Date.now();
  const r = await exportCanvasHtml(canvasPath, {
    assetDir, codeTheme: 'ayu-dark', mdTheme: 'vscode', mdMaxWidth: 0, notebookShowSource: false, theme: FALLBACK_THEME,
    resolveFile: (uri, dir) => {
      if (uri.startsWith('vault://')) return null;
      const p = path.resolve(dir, uri);
      return { fsPath: p, fileType: TYPES[path.extname(p).toLowerCase()] ?? 'unknown' };
    },
  });
  fs.writeFileSync(out, r.html);
  console.log(JSON.stringify({ ms: Date.now() - t0, bytes: Buffer.byteLength(r.html), nodes: r.nodes, edges: r.edges, missing: r.missing.length, firstMissing: r.missing.slice(0, 3) }, null, 1));
}

void main();
EOF
npx esbuild "$RUN/driver.ts" --bundle --platform=node --format=cjs --outfile="$RUN/driver.js" --external:@myriaddreamin/typst-ts-node-compiler
NODE_PATH="$REPO/node_modules" node "$RUN/driver.js" "$CANVAS" "$RUN/factors-essentials.html" "$REPO/dist" 2>/dev/null
sha256sum -c "$RUN/before.sha"
```

Expected: a JSON summary like the one measured on 2026-10-06 (the canvas changes as its user works on it): `ms` about 9500, `bytes` about 14000000, `nodes` 126, `edges` 115, `missing` 124 (all `crtx://…: no knowledge server for this image`). `sha256sum -c` prints `…factors-essentials.canvas: OK`; if it prints `FAILED`, compare the file's modification time with your run before reporting anything: its user may have saved it meanwhile.

- [ ] **Step 3: Check the page**

Run: `SKENA_EXPORT_HTML="$RUN/factors-essentials.html" SKENA_EXPORT_CANVAS="$CANVAS" node --test tests/export-check.mjs`
Expected: `# tests 5`, `# pass 5`, `# fail 0`.

Report: the driver's summary, the test counts, and the page's size.

- [ ] **Step 4: Commit**

```bash
git add tests/export-check.mjs
git commit -m "test(export): check an exported page against its canvas"
```

- [ ] **Step 5: Manual checks (the user runs these)**

The implementer reports these as not run.
- [ ] In the VS Code window of `/home/quant0/projects/factors` (with the new build installed, or the Extension Development Host opened on that folder), open `factors-essentials.canvas`, run **Skena: Export canvas to HTML**, save next to the canvas. The message reports 0 images that could not be read (the knowledge images come from crtx).
- [ ] From a Claude Code session in `/home/quant0/projects/factors`: `canvas_export_html` with `canvasPath` = the canvas and `outPath` = `/tmp/fe-mcp.html`. It answers "Exported … nodes and … edges to /tmp/fe-mcp.html (… MB)."
- [ ] Run Task 14 Step 3 on both pages (`SKENA_EXPORT_HTML=<page>`): `# pass 5`.
- [ ] Open the page offline in a browser. S1–S4 are drawn unfolded inside their frames with their titles; every node shows its label (N1, E3, C7, W21…); edges end in arrows on the sides the canvas shows, with their labels.
- [ ] N16: the `$…$` formulas and the `%%…%%` Typst block render (no raw `$` or `%%` text). C7 and C2 plot when scrolled to, with plotly's hover. Code cells are in the Ayu Dark colours (or the `skena.code.theme` set). M1 and M2 show their markdown files with images. W-nodes scroll inside their box and hold the whole paper with its figures.
- [ ] DevTools → Performance: record a reload, then scrolling across the page; note the load time and whether scrolling stutters.

If a check fails, write down the node label, what the canvas shows and what the page shows.

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| One static HTML file, no network request | `stripActiveHtml`, image inlining (Task 10), `checkOffline` (Tasks 4, 14), fonts in `dist/export-assets` (Task 9) |
| Command and MCP tool, no standalone script | Task 12 (`skena.exportHtml`), Task 13 (`canvas_export_html` through the relay); Task 14's driver is not committed |
| skena's own renderers | `renderMarkdownToHtml` + Typst, the webview pipeline on the host (`renderMarkdownKatexHtml`), `codeCellShiki`/`codeCellView`, `routeSection`/`routeOrthogonal`, `sanitizeHtmlAttrs`, `parseNotebook`, `capOutputHtml` |
| Same x/y/width/height; labels on every node | `placeNode` (Task 5); kernel label inside its ring |
| Sections as frames with titles; folded ones unfolded with members | `exportLayout` (Task 2), `sectionFrames` (Task 8) |
| Edges as SVG arrows from fromSide/toSide, with labels | `exportEdges` (Task 3), `edgeLayer`/`edgeLabels` (Task 8) |
| Groups not shown | `exportLayout` drops them and their edges |
| KaTeX CSS + fonts, plotly once, images, code colours inside | Tasks 8-10 |
| No interactivity but scrolling; plotly hover/zoom kept | `PLOT_SCRIPT` plots on approach; nothing else runs |
| Every node type | `nodeHtml.ts` (text, knowledge, code, cell, file incl. markdown/notebook/python/yaml/image/html, link, portal, noderef, kernel, chat) |
| Read-only on the .canvas | `exportCanvasHtml` only reads; test 2 of `export-canvas.mjs`; sha256 in Task 14 |
| Defaults: save dialog / outPath default; 1:1 with a margin; full content in scroll boxes | `defaultHtmlPath`, `pageBox` (40 px), `.skena-export-scroll` |
| Size does not matter; keep the page responsive | whole texts, all fonts; `content-visibility: auto`, plots drawn on approach |

## Points the spec does not settle, or that differ from the canvas

Each is in the code as described; the user may want another choice.
1. **MCP tool without a running VS Code window**: an error naming what to open. Rendering inside the MCP server would need the Typst addon from the installed extension and would lose the user-level settings and the knowledge token.
2. **Code cell line numbers** are 1..n; the canvas preview shows relative numbers (cursor on line 1: 1, 1, 2, 3 …). Indentation guides are not drawn.
3. **`skena.code.theme = factors`**: the canvas tokenizes with Monaco's python grammar; the page uses shiki with the factors markdown palette.
4. **Knowledge node header** shows `fetched YYYY-MM-DD HH:MM` instead of "2h ago"; the ↻ and ↗ buttons are not drawn.
5. **Theme**: the colours and the editor font of an open canvas webview of that window; none open → `FALLBACK_THEME` (VS Code Dark Modern values, approximate). The page uses the exporting machine's fonts by name; a reader without that font gets the browser's fallback.
6. **Link nodes** show no favicon and no YouTube thumbnail (network images on the canvas).
7. **`markdown.styles`** (external stylesheet URLs the canvas links) are not on the page.
8. **Unsaved edits**: the export reads the file on disk; an edit still in the webview's save debounce is not on the page.
9. **Edges without a side** face the other node (`facingSide`), as `routeSection` does; React Flow would take the node's first handle for a cross-section edge without a side.
10. **The export blocks the extension host** for the time one node takes to render (W25: 2.4 s), and yields between nodes.
