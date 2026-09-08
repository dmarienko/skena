# Layout Engine (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-09-08-layout-engine-design.md`, phase 1 — a pure layout engine that packs a section's code columns and output pairs (column-only push), resolves free-node overlaps downward, places outputs, inserts/forks, and a Reflow command; the same function in the webview, the host run path and MCP.

**Architecture:** `src/shared/layoutEngine.ts` (pure, no React) returns patches `{ id → {x, y, w?, h?} }` for one section's nodes. Callers add/resize/delete a node first, then call the engine with the mover and apply the patches under the action's history entry; `fitLanes` runs after as today. `reflowSection` is the only whole-section pack.

**Tech Stack:** TypeScript, React Flow, esbuild bundles + `node --test` (pattern: `test/section-lanes.mjs`, `test/mcp-parity.mjs`).

**Two phase-1 simplifications (say so in the task reports; recorded for the user):**
1. Output cells are created at `OUTPUT_MIN_W × 300` (there is no content measurement yet); the pair's output column follows the widest output *as resized by the user or a later auto-measure*. Content-based width is a follow-up.
2. A regular operation **pushes** the pairs to its right but never pulls them back (that would move hand-placed forks on every edit — spec §4 promises nothing automatic on a hand-placed section). Pull-back sideways happens in **Reflow**. Vertical pull-up inside the touched column does happen on every operation (spec §3.1).

---

### Task 1: constants, `layoutEngine.ts`, tests

**Files:**
- Modify: `src/shared/constants.ts`
- Create: `src/shared/layoutEngine.ts`
- Test: `test/layout-engine.mjs` (gitignored — never staged)

- [ ] **Step 1: constants** — append to `src/shared/constants.ts`:

```ts
// - layout engine (spec 2026-09-08-layout-engine-design.md §1); all grid multiples
export const CODE_MAX_H     = 900;
export const OUTPUT_MIN_W   = 600;
export const OUTPUT_MAX_W   = 1400;
export const OUTPUT_MAX_H   = 900;
export const OUTPUT_DEFAULT_H = 300;
export const CODE_LINE_PX   = 22;
export const CODE_CHROME_PX = 60;
```

- [ ] **Step 2: the module** — `src/shared/layoutEngine.ts`:

```ts
import { GRID, NODE_SIZE, CODE_MAX_H, OUTPUT_MIN_W, OUTPUT_MAX_W, OUTPUT_DEFAULT_H, CODE_LINE_PX, CODE_CHROME_PX } from './constants';
import { snapGrid } from './grid';

/**
 * The layout engine of one section (spec 2026-09-08-layout-engine-design.md).
 * Managed = code cells and the output cells they name in `outputNodeId`; free = everything else.
 * A column = code cells sharing a snapped x, ordered by y; a pair = a column + its output column.
 * Every function is pure and returns only what changed.
 */

export interface EngineNode { id: string; type: string; x: number; y: number; w: number; h: number; outputNodeId?: string }
export interface Patch { x: number; y: number; w?: number; h?: number }
export type Patches = Record<string, Patch>;
export interface Column { x: number; codeW: number; cellIds: string[] }
export interface Pair { column: Column; outputX: number; outputW: number; right: number }
export interface LayoutOpts { moverIds?: Iterable<string>; columnX?: number }

const byId = (nodes: EngineNode[]) => new Map(nodes.map(n => [n.id, n] as const));

/** Height of a code cell for `lines` lines: grid steps from NODE_SIZE.code.h up to CODE_MAX_H. */
export function codeCellHeight(lines: number): number {
  const raw = Math.ceil((Math.max(1, lines) * CODE_LINE_PX + CODE_CHROME_PX) / GRID) * GRID;
  return Math.min(CODE_MAX_H, Math.max(NODE_SIZE.code.h, raw));
}

/** Ids of output cells owned by a code cell (the managed non-code nodes). */
export function outputOwners(nodes: EngineNode[]): Map<string, string> {
  const owners = new Map<string, string>();
  const ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) if (n.type === 'code' && n.outputNodeId && ids.has(n.outputNodeId)) owners.set(n.outputNodeId, n.id);
  return owners;
}

/** Columns of a section, left to right; cells top to bottom, a mover first on a tie. */
export function deriveColumns(nodes: EngineNode[], movers = new Set<string>()): Column[] {
  const groups = new Map<number, EngineNode[]>();
  for (const n of nodes) {
    if (n.type !== 'code') continue;
    const x = snapGrid(n.x);
    const g = groups.get(x);
    if (g) g.push(n); else groups.set(x, [n]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, cells]) => {
      cells.sort((a, b) => a.y - b.y || Number(movers.has(b.id)) - Number(movers.has(a.id)) || a.id.localeCompare(b.id));
      return { x, codeW: Math.max(...cells.map(c => c.w)), cellIds: cells.map(c => c.id) };
    });
}

/** Pairs = columns with their output column: x right of the code, width = widest output, min OUTPUT_MIN_W. */
export function derivePairs(nodes: EngineNode[], columns: Column[]): Pair[] {
  const map = byId(nodes);
  return columns.map(column => {
    let outputW = OUTPUT_MIN_W;
    for (const id of column.cellIds) {
      const out = map.get(map.get(id)?.outputNodeId ?? '');
      if (out) outputW = Math.max(outputW, Math.min(OUTPUT_MAX_W, out.w));
    }
    const outputX = column.x + column.codeW + GRID;
    return { column, outputX, outputW, right: outputX + outputW };
  });
}

// - bottom of a code cell's row = the taller of the cell and its output
function rowBottom(cell: EngineNode, map: Map<string, EngineNode>): number {
  const out = map.get(cell.outputNodeId ?? '');
  return cell.y + Math.max(cell.h, out ? out.h : 0);
}

// - two boxes need a full grid gap between them on at least one axis
function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  const sepX = a.x + a.w + GRID <= b.x || b.x + b.w + GRID <= a.x;
  const sepY = a.y + a.h + GRID <= b.y || b.y + b.h + GRID <= a.y;
  return !(sepX || sepY);
}

// - pack one column tight top → bottom; outputs follow their code (same y, output x of the pair)
function packColumn(pair: Pair, map: Map<string, EngineNode>, out: Patches): void {
  let prevBottom: number | null = null;
  for (const id of pair.column.cellIds) {
    const cell = map.get(id)!;
    const y = prevBottom === null ? snapGrid(cell.y) : prevBottom + GRID;
    const x = pair.column.x;
    if (x !== cell.x || y !== cell.y) { out[id] = { x, y }; cell.x = x; cell.y = y; }
    const o = map.get(cell.outputNodeId ?? '');
    if (o && (o.x !== pair.outputX || o.y !== y)) { out[o.id] = { x: pair.outputX, y }; o.x = pair.outputX; o.y = y; }
    prevBottom = rowBottom(cell, map);
  }
}

// - push the pairs right of `from` so each starts a gap after the previous one; never pulls back
function pushPairsRight(pairs: Pair[], fromIndex: number, map: Map<string, EngineNode>, out: Patches): void {
  for (let i = Math.max(1, fromIndex + 1); i < pairs.length; i++) {
    const prev = pairs[i - 1], cur = pairs[i];
    const minX = prev.right + GRID;
    if (cur.column.x >= minX) continue;
    const dx = minX - cur.column.x;
    for (const id of cur.column.cellIds) {
      const cell = map.get(id)!;
      cell.x += dx; out[id] = { x: cell.x, y: cell.y };
      const o = map.get(cell.outputNodeId ?? '');
      if (o) { o.x += dx; out[o.id] = { x: o.x, y: o.y }; }
    }
    cur.column.x += dx; cur.outputX += dx; cur.right += dx;
  }
}

// - free nodes that a managed node (or an earlier free node) now overlaps move down, never sideways
function settleFree(nodes: EngineNode[], map: Map<string, EngineNode>, owners: Map<string, string>, movers: Set<string>, out: Patches): void {
  const managed = nodes.filter(n => n.type === 'code' || owners.has(n.id));
  const free = nodes.filter(n => n.type !== 'code' && !owners.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: EngineNode[] = [...managed];
  for (const f of free) {
    if (movers.has(f.id)) { placed.push(f); continue; }   // - the dropped/resized free node stays put
    let moved = true;
    while (moved) {
      moved = false;
      for (const p of placed) {
        if (overlaps(f, p)) { f.y = p.y + p.h + GRID; out[f.id] = { x: f.x, y: f.y }; moved = true; }
      }
    }
    placed.push(f);
  }
}

// - a free node that was itself dropped or resized pushes the managed cells it covers down
function freeMoverPushes(nodes: EngineNode[], map: Map<string, EngineNode>, owners: Map<string, string>, movers: Set<string>, pairs: Pair[], out: Patches): void {
  for (const id of movers) {
    const f = map.get(id);
    if (!f || f.type === 'code' || owners.has(id)) continue;
    for (const pair of pairs) {
      for (const cid of pair.column.cellIds) {
        const cell = map.get(cid)!;
        if (overlaps(f, cell)) { cell.y = f.y + f.h + GRID; out[cid] = { x: cell.x, y: cell.y }; }
      }
      packColumn(pair, map, out);
    }
  }
}

function clone(nodes: EngineNode[]): EngineNode[] { return nodes.map(n => ({ ...n })); }
function diff(before: EngineNode[], after: EngineNode[], out: Patches): Patches {
  const b = byId(before);
  const res: Patches = {};
  for (const n of after) { const o = b.get(n.id)!; if (o.x !== n.x || o.y !== n.y) res[n.id] = { x: n.x, y: n.y }; }
  for (const [id, p] of Object.entries(out)) if (!(id in res)) { const o = b.get(id); if (o && (o.x !== p.x || o.y !== p.y)) res[id] = p; }
  return res;
}

/**
 * Lay out one section after an operation. `moverIds` = the nodes the operation inserted, moved or
 * resized (they win ties and, when free, push what they cover); `columnX` = the column to pack when
 * nothing moved (a delete). Only the touched column is packed; pairs right of it are pushed, not
 * pulled; free nodes settle downward. Same input → same output; a second call changes nothing.
 */
export function layoutSection(input: EngineNode[], opts: LayoutOpts = {}): Patches {
  const nodes = clone(input);
  const map = byId(nodes);
  const movers = new Set(opts.moverIds ?? []);
  const owners = outputOwners(nodes);
  const columns = deriveColumns(nodes, movers);
  const pairs = derivePairs(nodes, columns);
  const out: Patches = {};

  // - which columns are touched: the movers' (a moved output counts for its code's column) + columnX
  const touched = new Set<number>();
  for (const id of movers) {
    const n = map.get(id); if (!n) continue;
    const codeId = n.type === 'code' ? id : owners.get(id);
    if (codeId) touched.add(snapGrid(map.get(codeId)!.x));
  }
  if (opts.columnX !== undefined) touched.add(snapGrid(opts.columnX));

  let firstTouched = pairs.length;
  pairs.forEach((pair, i) => { if (touched.has(pair.column.x)) { packColumn(pair, map, out); firstTouched = Math.min(firstTouched, i); } });
  // - re-measure after the pack (an output moved with its code) and push the pairs to the right
  const repaired = derivePairs(nodes, deriveColumns(nodes, movers));
  if (firstTouched < repaired.length) pushPairsRight(repaired, firstTouched, map, out);
  freeMoverPushes(nodes, map, owners, movers, repaired, out);
  settleFree(nodes, map, owners, movers, out);
  return diff(input, nodes, out);
}

/** Whole-section pack: every code cell snapped to its column, every column and pair tight, free nodes settled. */
export function reflowSection(input: EngineNode[]): Patches {
  const nodes = clone(input);
  const map = byId(nodes);
  const owners = outputOwners(nodes);
  // - snap x to the nearest existing column within half a pair width, else its own snapped x
  const xs = [...new Set(nodes.filter(n => n.type === 'code').map(n => snapGrid(n.x)))].sort((a, b) => a - b);
  const half = (NODE_SIZE.code.w + GRID + OUTPUT_MIN_W) / 2;
  for (const n of nodes) {
    if (n.type !== 'code') continue;
    const sx = snapGrid(n.x);
    const near = xs.filter(x => Math.abs(x - sx) <= half).sort((a, b) => Math.abs(a - sx) - Math.abs(b - sx))[0];
    n.x = near ?? sx;
  }
  const columns = deriveColumns(nodes);
  const pairs = derivePairs(nodes, columns);
  const out: Patches = {};
  for (const pair of pairs) packColumn(pair, map, out);
  // - pairs tight left → right (the first keeps its x); outputs re-measured after the packs
  const tight = derivePairs(nodes, deriveColumns(nodes));
  for (let i = 1; i < tight.length; i++) {
    const want = tight[i - 1].right + GRID;
    const dx = want - tight[i].column.x;
    if (dx === 0) continue;
    for (const id of tight[i].column.cellIds) {
      const cell = map.get(id)!; cell.x += dx; out[id] = { x: cell.x, y: cell.y };
      const o = map.get(cell.outputNodeId ?? ''); if (o) { o.x += dx; out[o.id] = { x: o.x, y: o.y }; }
    }
    tight[i].column.x += dx; tight[i].outputX += dx; tight[i].right += dx;
  }
  settleFree(nodes, map, owners, new Set(), out);
  return diff(input, nodes, out);
}

/** Where a new code cell goes after `afterId`: its column, one gap below. Null when `afterId` is not a code cell. */
export function insertAfter(nodes: EngineNode[], afterId: string): { x: number; y: number } | null {
  const after = nodes.find(n => n.id === afterId);
  if (!after || after.type !== 'code') return null;
  const map = byId(nodes);
  return { x: snapGrid(after.x), y: rowBottom(after, map) + GRID };
}

/** Where a fork of `cellId` starts: a new pair right of its pair, or left of its column; null when refused. */
export function forkOf(nodes: EngineNode[], cellId: string, side: 'right' | 'left', w = NODE_SIZE.code.w): { x: number; y: number } | null {
  const cell = nodes.find(n => n.id === cellId);
  if (!cell || cell.type !== 'code') return null;
  const pairs = derivePairs(nodes, deriveColumns(nodes));
  const pair = pairs.find(p => p.column.cellIds.includes(cellId));
  if (!pair) return null;
  if (side === 'right') return { x: pair.right + GRID, y: snapGrid(cell.y) };
  const x = pair.column.x - GRID - (w + GRID + OUTPUT_MIN_W);
  return x < 0 ? null : { x, y: snapGrid(cell.y) };
}

/** Geometry of the output cell of `codeId`: the pair's output column, the code's y; existing size kept. */
export function placeOutput(nodes: EngineNode[], codeId: string, existing?: { w: number; h: number }): { x: number; y: number; width: number; height: number } | null {
  const code = nodes.find(n => n.id === codeId);
  if (!code || code.type !== 'code') return null;
  const pairs = derivePairs(nodes, deriveColumns(nodes));
  const pair = pairs.find(p => p.column.cellIds.includes(codeId));
  if (!pair) return null;
  return { x: pair.outputX, y: snapGrid(code.y), width: existing?.w ?? OUTPUT_MIN_W, height: existing?.h ?? OUTPUT_DEFAULT_H };
}

/** Adapter: canvas nodes → engine nodes (the file's `width`/`height` → `w`/`h`). */
export function toEngineNodes(nodes: { id: string; type: string; x: number; y: number; width: number; height: number; outputNodeId?: string }[]): EngineNode[] {
  return nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height, ...(n.outputNodeId ? { outputNodeId: n.outputNodeId } : {}) }));
}
```

- [ ] **Step 3: tests** — `test/layout-engine.mjs` (header comment: `// - run: npx esbuild src/shared/layoutEngine.ts --bundle --format=esm --outfile=test/.build/layoutEngine.mjs && node --test test/layout-engine.mjs`). Fixtures: `code(id, x, y, h = 300, out?)` → `{ id, type: 'code', x, y, w: 700, h, outputNodeId: out }`, `cell(id, x, y, w = 600, h = 300)`, `note(id, x, y, w, h)` (type `text`). Cases, each with exact `assert.deepEqual` on the patches:

1. `codeCellHeight`: 1 → 300, 11 → 300 (302 → ceil 400? compute: 11×22+60 = 302 → 400; so 10 → 280 → 300 and 11 → 400), 40 → 900 (cap), 0 → 300.
2. insert pushes only its column: E1@(1600,400) E2@(1600,800) E3@(1600,1200) fork F1@(3100,800); NEW@(1600,800) as mover → E2 1200, E3 1600, F1 unchanged.
3. delete pulls up: E1, E3@(1600,1200) with `columnX: 1600` and no mover → E3 → 800.
4. output rides and is placed: E2 with out C2@(2000,500) (wrong spot) → mover E2 → C2 → (2400, 800).
5. tall output pushes the column: C2 h 700 → E3 → 800 + 700 + 100 = 1600.
6. output growth pushes the pair to the right: C2 w 1000 (pair right = 1600+700+100+1000 = 3400) with F1@(3100,…) → F1 → 3500; its output (if any) too.
7. growth never pulls back: F1@(4000,800) with all outputs 600 → no patch for F1.
8. free note overlapped moves down: note@(1600,1250) 300×200 after case 2's insert → note → below the pushed E3 (E3 at 1600, h 300 → 2000).
9. free mover stays and pushes: note dropped at (1600,800) 300×200 as mover → E2 → 1100 → snapped? (800+200+100 = 1100) then E3 packed below.
10. idempotence: `layoutSection(apply(nodes, patches), sameOpts)` → `{}` for cases 2, 5, 6, 9.
11. `reflowSection` on a hand-made mess: E1@(1600,400), E2@(1650,900) (off-column), E3@(1600,1700) (hole), F1@(5000,400) far right with output 600 → E2 x 1600 y 800, E3 1200, F1 → 3100; second call → `{}`.
12. `insertAfter` → `{x: 1600, y: 800}` for E1 (h 300, no output); with a taller output (700) → 1200; null for a text node.
13. `forkOf` right → `{x: 3100, y: 400}` for E1 with outputs 600; left from E1@x 1600 → 1600 − 100 − 1400 = 100 → `{x:100,y:400}`; left from x 1400 → null.
14. `placeOutput` → `{x: 2400, y: 400, width: 600, height: 300}`; with existing `{w: 1000, h: 500}` → those kept.
15. Reflow on copies of `test/H1.canvas` … `H5.canvas` (read them with `fs.readFileSync` from `/tmp/skena-engine/*.json` copies made by the test's setup, never the originals): after applying the patches, assert no two managed nodes overlap (the `overlaps` rule) and every code cell's x is one of the column xs. If a fixture has no sections or code cells, skip it with a message.

- [ ] **Step 4: run** the bundle + tests → all pass (15 cases). `npm run typecheck` → 3 pre-existing only.
- [ ] **Step 5: commit** `src/shared/constants.ts src/shared/layoutEngine.ts`: `feat: layout engine — columns, pairs, column-only push, free-node settle, reflow, insertAfter/forkOf/placeOutput`

### Task 2: webview wiring

**Files:** `src/webview/canvas/CanvasView.tsx`, `src/webview/canvas/nodes/CodeNode.tsx`, `src/webview/rail/SegmentMenu.tsx`, `src/webview/rail/SectionRail.tsx`, `src/webview/rail/RailSegment.tsx` (only if the menu needs a new prop path).

- [ ] **Step 1: one apply helper** in `CanvasView.tsx` next to `shiftNodes` (~798): `applyPatches(p: Patches)` — sets `position` (and `style.width/height` + `width/height` when `w/h` present) on the RF nodes and `x/y/width/height` on `canvasRef.current.nodes`; no history entry of its own. And `engineNodesOf(sectionId)`: the section's members (via `deriveLanes(nodes.map(flowGeom), lanesRef.current)` → `memberIds`, folded members included) mapped with `toEngineNodes` (`outputNodeId` from `n.data.outputNodeId`). `runEngine(sectionOfNodeId, opts)` = `applyPatches(layoutSection(engineNodesOf(...), opts))`. The lane fit follows through `useLaneFit` as today.
- [ ] **Step 2: `o` on a code cell** (`skena:addCodeBelow` handler ~2670-2700): replace `findFreePosition(...)` with `insertAfter(engineNodesOf(section of src), sourceId)`; keep id/edge/`addNodeResult` as they are. In the `addNodeResult` funnel (~2812, after the node is in `canvasRef` and the lanes are seeded): `runEngine(section of cn, { moverIds: [cn.id] })`. This covers `o`, `Alt+X`, context-menu adds, host QuickPick adds and kernel-node adds (a kernel node is free → nothing moves unless it covers something).
- [ ] **Step 3: forks** — in the keyboard `Alt+X` chord handler (`requestAddNodeInDirection` ~1835): when `current.type === 'code'` and key is `L`/`H`, compute `forkOf(engineNodesOf(section), current.id, key === 'L' ? 'right' : 'left')`; null → do nothing (left fork refused at the origin); else post `addNodeRequest` with that position and `width: NODE_SIZE.code.w, height: NODE_SIZE.code.h`. `J` on a code cell = `insertAfter`. `K` unchanged. Non-code nodes keep today's `findFreePosition` path.
- [ ] **Step 4: paste** (`pasteInternalClipboard` ~1636): after the nodes are added, `runEngine(section of the top-left pasted node, { moverIds: all pasted ids })`.
- [ ] **Step 5: resize** (`skena:nodeResize` handler ~2553): after the node is updated, `runEngine(section of id, { moverIds: [id] })`.
- [ ] **Step 6: delete** (`performDelete` ~1680, and the `onNodesDelete` path if separate): before removing, note each deleted code cell's snapped x and section; after removal, `runEngine(section, { columnX })` per distinct column. An output cell deleted alone: the column of its code (owner from `outputNodeId`).
- [ ] **Step 7: live code height** — `CodeNode.tsx`: in the existing `editorInstance.onDidChangeModelContent` (~171) also dispatch `skena:codeLines { id, lines: model.getLineCount() }` (throttle to once per animation frame). `CanvasView.tsx`: a handler computes `codeCellHeight(lines)`; when it differs from the node's current height: `pushHistory()` once per editing session (keep a ref of the id whose height changed since the last edit commit; simplest: push on the first change after `skena:enterEdit`/focus and not again until blur), set the height (RF node + canvasRef), `runEngine(section, { moverIds: [id] })`, `scheduleSave()`.
- [ ] **Step 8: run output in the webview** (`skena:runOutput` upsert ~2750-2800): when a NEW output node is created from the message, its geometry comes from the host (Task 3 places it through the engine); after the upsert, `runEngine(section, { moverIds: [outId] })` so pushed neighbours match the host's result. When the host already sent moved neighbours (it does not, in phase 1), nothing changes — the engine is idempotent.
- [ ] **Step 9: Reflow section** — `SegmentMenu.tsx`: a row `Reflow section` between `Run section` and `Kernel…` calling a new `onReflow`; thread it `SectionRail` → `RailSegment` → menu like `onRun`. `CanvasView.tsx` `handleReflowLane(id)`: `pushHistory(); applyPatches(reflowSection(engineNodesOf(id)));`.
- [ ] **Step 10: verify** — typecheck (3 pre-existing), build, all suites (layout-engine 15, section-lanes 46, spatial-nav 16, rail-geometry 13, bounds 10, kernel-binding 19, kernel-upstream 12, mcp-parity 11). Manual smoke in the extension host is the user's.
- [ ] **Step 11: commit** `fix: creation, paste, resize, delete, live code height and run output go through the layout engine; Reflow section in the rail menu`

### Task 3: host run output + MCP

**Files:** `src/extension/editor-provider.ts`, `src/extension/mcp/server.ts`, `test/mcp-parity.mjs`.

- [ ] **Step 1: host** — the three `outputCellGeom(...)` sites (`editor-provider.ts` ~1325, ~1460, ~1524): replace with `placeOutput(toEngineNodes(c.nodes), cn.id, existing ? { w: existing.width, h: existing.height } : undefined)` (null → fall back to `outputCellGeom` — a code cell outside any column cannot happen, but keep the fallback and say so in a `// -`). After pushing the new output node and `pinOutputToLane`, apply `layoutSection(toEngineNodes(section members), { moverIds: [outId] })` patches to `c.nodes` (helper `applyPatchesToCanvas(c, patches)` in `layoutEngine.ts`: sets `x/y/width/height` on the matching nodes, returns the same reference when empty), then `applyLaneFit` as today. Section members = `deriveLanes(...)` member ids of the lane holding `cn`.
- [ ] **Step 2: MCP `canvas_add_node`** (`server.ts` ~573): new optional args `after` (cell ref) and `forkOf` (cell ref) with `side: 'right' | 'left'` (default right); when given, `type` defaults to `code`, position from `insertAfter` / `forkOf` (error text when null: `after must be a code cell` / `forkOf must be a code cell` / `a left fork does not fit before the origin`), `x`/`y` ignored with a note in the reply. In every case, after `d.nodes.push(labeled)`: `applyPatchesToCanvas(d, layoutSection(toEngineNodes(section members of labeled), { moverIds: [labeled.id] }))` then `applyLaneFit`. Reply lists the moved node labels when any.
- [ ] **Step 3: MCP `canvas_update_node` / `canvas_layout`** — after a size or position change: `layoutSection(..., { moverIds: [id] })` (moved ids in `canvas_layout`), then fit. `canvas_remove_node`: `columnX` of each removed code cell, as Task 2 Step 6.
- [ ] **Step 4: MCP run** (`server.ts` ~883 `outputCellGeom`) → `placeOutput` + `layoutSection` with the output as mover, mirroring Step 1.
- [ ] **Step 5: `canvas_reflow_section(canvasPath, ref)`** — tool + `case`: `sectionByRef`, `reflowSection` on the members, `applyPatchesToCanvas`, `applyLaneFit`, write; reply `Reflowed S1: N node(s) moved` or `Reflowed S1: nothing moved`. Description: "Packs the section's code columns and output pairs tight and settles overlapped notes downward — the only whole-section move; regular writes touch one column."
- [ ] **Step 6: parity tests** — `test/mcp-parity.mjs`: `after` inserts below and pushes the column (positions asserted); `forkOf` right lands at the pair's right + 100; left fork at the origin is refused with the exact error; `canvas_reflow_section` on a fixture with an off-column cell and a hole → exact positions, second call reports nothing moved; `canvas_add_node` with x/y onto a code cell pushes it down (column-only).
- [ ] **Step 7: verify** — typecheck (3 pre-existing), build, suites (parity 16), then commit `feat: host run output and MCP add/update/layout/run go through the layout engine; canvas_reflow_section`.

### Task 4: bump + package

- [ ] `package.json` → `0.17.11`; `npm run package`; commit `chore: bump to 0.17.11 (layout engine phase 1)`.
