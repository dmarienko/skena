# Section Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every section's information and controls live in a pinned 44px rail left of the canvas; the canvas carries no section title; the camera returns to the origin-only rule.

**Architecture:** the rail is a sibling of `<ReactFlow>` inside `ReactFlowProvider`, reading the live transform and node array from the flow store. Section geometry stays a pure function of node `y` (`sectionLanes.ts`); two new pure functions carry the new rules — `growLaneForNodes` (dragging past a section's bottom edge pushes everything below it down) and `resolveCellKernel` (edge-bound kernel → section kernel → none). The three camera mechanisms of the previous design are deleted.

**Tech Stack:** TypeScript, React 18, React Flow v12 (`@xyflow/react`), esbuild, `node --test` for pure modules (bundled into `test/.build/`, `test/` is gitignored).

**Spec:** `docs/superpowers/specs/2026-09-02-section-rail-design.md`. Three deviations, all applied to the spec in this plan's commit:
- §9 `patchSection` is not needed: the webview already owns `metadata.sections` and persists them through `commitLanes` → `saveCanvas` (the host merges `sections` in `handleSaveCanvas`). Title and kernel edits use that path.
- §3.3 gains one rule: an output cell created by a run is never placed above its code cell's section top (today's placement centres it on the code cell, which can put its top edge in the section above).
- §6 `+`: there is no context-menu "New Section" entry today and none is added; the rail's `+` and the `skena.newSection` command are the two ways.

**Verification commands used throughout:**
```bash
npm run typecheck   # - expect exactly the 3 pre-existing errors: editor-provider.ts(454|455|456) 'fsPath' … 'ResolvedUri'
npm run build       # - expect "⚡ Done in …ms"
```

---

## File structure

| Path | Responsibility |
|---|---|
| `src/shared/sectionLanes.ts` | lane model (existing) + `growLaneForNodes`, `applyLaneGrowth`, `laneTopForY`; `colorIndex` removed |
| `src/shared/kernelBinding.ts` | edge rules (existing) + `resolveCellKernel`, `resolveKernelCellsInCanvas`, `cellKernelView` |
| `src/shared/types.ts` | `MsgRunSection` |
| `src/webview/canvas/palette.ts` | `THEME` tokens |
| `src/webview/theme.ts` | writes `--sk-*` CSS variables from the VS Code theme class |
| `src/webview/canvas/LanesContext.ts` | React context carrying `metadata.sections` to node components |
| `src/webview/rail/railGeometry.ts` | pure: `railSegments`, `railItems`, rail constants |
| `src/webview/rail/RailSegment.tsx` | one section's segment: stripe, chevron, rotated title, run, kernel dot, delete |
| `src/webview/rail/SectionRail.tsx` | the column: segments, `+`, popover state |
| `src/webview/rail/KernelPicker.tsx` | popover listing the canvas's kernel nodes |
| `src/webview/rail/TitleEditor.tsx` | popover input for the title |
| `src/webview/rail/useLaneGrowth.ts` | hook: detects node geometry changes, applies `growLaneForNodes` |
| `src/webview/canvas/SectionSeparators.tsx` | the 1px line at each section bottom, inside the flow (replaces `SectionLaneMarks.tsx`) |
| `src/webview/canvas/CanvasView.tsx` | `[rail][flow]` layout, handlers, camera per spec §8 |
| `src/extension/editor-provider.ts` | `runSection`; kernel resolution sites; output-cell growth |
| `src/extension/mcp/server.ts` | kernel resolution; growth on add/update; output-cell placement |
| delete | `src/webview/canvas/SectionStickyHeader.tsx`, `src/webview/canvas/CameraTopGuard.tsx`, `src/webview/canvas/SectionLaneMarks.tsx` |

---

### Task 1: `growLaneForNodes` / `applyLaneGrowth` / `laneTopForY` (pure)

**Files:**
- Modify: `src/shared/sectionLanes.ts` (append after `deriveLanes`, before `migrateSections`)
- Test: `test/section-lanes.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/section-lanes.mjs`. Extend the existing import line to:

```js
import { sortLanes, laneIndexForY, deriveLanes, migrateSections, LANE_BOTTOM_PAD, growLaneForNodes, applyLaneGrowth, laneTopForY } from './.build/sectionLanes.mjs';
```

Then append:

```js
const node = (id, y, height = 100, x = 0, width = 100) => ({ id, x, y, width, height });

test('growLaneForNodes: nothing crosses the next lane → no shifts', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  assert.deepEqual(growLaneForNodes(lanes, [node('n1', 0, 300)], ['n1']), { laneShifts: {}, nodeShifts: {} });
});

test('growLaneForNodes: bottom + GRID past the next lane pushes it and its nodes by a GRID multiple', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  const nodes = [node('n1', 700, 350), node('n2', 1000)];   // - 700+350+100 = 1150 → overflow 150 → 200
  const g = growLaneForNodes(lanes, nodes, ['n1']);
  assert.deepEqual(g.laneShifts, { b: 200 });
  assert.deepEqual(g.nodeShifts, { n2: 200 });
});

test('growLaneForNodes: an exact fit (bottom + GRID == next.y) is not an overflow', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  assert.deepEqual(growLaneForNodes(lanes, [node('n1', 600, 300)], ['n1']).laneShifts, {});
});

test('growLaneForNodes: several changed nodes → the largest delta at that boundary', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  const nodes = [node('n1', 900, 150), node('n2', 900, 450), node('n3', 1000)];   // - 200 vs 500
  assert.deepEqual(growLaneForNodes(lanes, nodes, ['n1', 'n2']).laneShifts, { b: 500 });
});

test('growLaneForNodes: the last lane is unbounded — nothing to push', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  assert.deepEqual(growLaneForNodes(lanes, [node('n1', 5000, 900)], ['n1']), { laneShifts: {}, nodeShifts: {} });
});

test('growLaneForNodes: shifts accumulate down the stack', () => {
  const lanes = [lane('a', 0), lane('b', 1000), lane('c', 2000)];
  const nodes = [node('n1', 950, 200), node('n2', 1000), node('n3', 2000)];   // - 1250-1000 = 250 → 300
  const g = growLaneForNodes(lanes, nodes, ['n1']);
  assert.deepEqual(g.laneShifts, { b: 300, c: 300 });
  assert.deepEqual(g.nodeShifts, { n2: 300, n3: 300 });
});

test('growLaneForNodes: a node moved up into the lane above pushes only if its bottom crosses back', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  // - n2 now at y 850 belongs to lane a; 850+100+100 = 1050 > 1000 → lane b moves by 100
  const g = growLaneForNodes(lanes, [node('n1', 0), node('n2', 850)], ['n2']);
  assert.deepEqual(g.laneShifts, { b: 100 });
  assert.deepEqual(g.nodeShifts, {});   // - n2 itself is in lane a now: it does not move
});

test('applyLaneGrowth: same reference when nothing moves; lanes and nodes shifted otherwise', () => {
  const canvas = { nodes: [node('n1', 700, 350), node('n2', 1000)], edges: [], metadata: { sections: [lane('a', 0), lane('b', 1000)] } };
  assert.equal(applyLaneGrowth(canvas, ['n2']), canvas);
  const out = applyLaneGrowth(canvas, ['n1']);
  assert.equal(out.metadata.sections.find(l => l.id === 'b').y, 1200);
  assert.equal(out.nodes.find(n => n.id === 'n2').y, 1200);
  assert.equal(out.nodes.find(n => n.id === 'n1').y, 700);
});

test('laneTopForY: the owning lane top, or -Infinity without lanes', () => {
  assert.equal(laneTopForY([lane('a', 0), lane('b', 1000)], 1500), 1000);
  assert.equal(laneTopForY([lane('b', 1000), lane('a', 0)], 20), 0);     // - unsorted input
  assert.equal(laneTopForY([], 20), -Infinity);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs`
Expected: SyntaxError — `growLaneForNodes` is not exported.

- [ ] **Step 3: Write the implementation**

Insert after `deriveLanes` in `src/shared/sectionLanes.ts`:

```ts
export interface LaneGrowth {
  /** - lane id → how far it moves down, flow units */
  laneShifts: Record<string, number>;
  /** - node id → how far it moves down, flow units */
  nodeShifts: Record<string, number>;
}

/**
 * Downward growth. A changed node whose bottom edge plus one GRID crosses into the next lane pushes
 * that lane and everything below it down by a GRID multiple, so membership (by `y`) is unchanged: the
 * boundary moves, the node does not change section. The last lane is unbounded. Pushes accumulate
 * down the stack. Pure; the caller applies the shifts.
 */
export function growLaneForNodes(lanes: SectionLane[], nodes: LaneNodeGeom[], changedIds: string[]): LaneGrowth {
  const empty: LaneGrowth = { laneShifts: {}, nodeShifts: {} };
  const sorted = sortLanes(lanes);
  if (sorted.length < 2 || changedIds.length === 0) return empty;

  const byId = new Map(nodes.map(n => [n.id, n]));
  const need: number[] = sorted.map(() => 0);   // - need[i] = push of the boundary below lane i
  for (const id of changedIds) {
    const n = byId.get(id);
    if (!n) continue;
    const i = laneIndexForY(sorted, n.y);
    if (i >= sorted.length - 1) continue;
    const overflow = n.y + n.height + GRID - sorted[i + 1].y;
    if (overflow <= 0) continue;
    const delta = Math.ceil(overflow / GRID) * GRID;
    if (delta > need[i]) need[i] = delta;
  }

  const laneShifts: Record<string, number> = {};
  let acc = 0;
  for (let k = 1; k < sorted.length; k++) {
    acc += need[k - 1];
    if (acc > 0) laneShifts[sorted[k].id] = acc;
  }
  if (acc === 0) return empty;

  const nodeShifts: Record<string, number> = {};
  for (const n of nodes) {
    const s = laneShifts[sorted[laneIndexForY(sorted, n.y)].id];
    if (s) nodeShifts[n.id] = s;
  }
  return { laneShifts, nodeShifts };
}

/** Apply `growLaneForNodes` to a canvas. Same reference when nothing moves (no spurious save). */
export function applyLaneGrowth(canvas: CanvasData, changedIds: string[]): CanvasData {
  const lanes = canvas.metadata?.sections ?? [];
  const g = growLaneForNodes(lanes, canvas.nodes, changedIds);
  if (Object.keys(g.laneShifts).length === 0) return canvas;
  return {
    ...canvas,
    nodes: canvas.nodes.map(n => (g.nodeShifts[n.id] ? { ...n, y: n.y + g.nodeShifts[n.id] } : n)),
    metadata: {
      ...canvas.metadata,
      sections: sortLanes(lanes).map(l => (g.laneShifts[l.id] ? { ...l, y: l.y + g.laneShifts[l.id] } : l)),
    },
  };
}

/** Top of the lane owning flow y; -Infinity when the canvas has no lanes (nothing to clamp to). */
export function laneTopForY(lanes: SectionLane[], y: number): number {
  if (lanes.length === 0) return -Infinity;
  const sorted = sortLanes(lanes);
  return sorted[laneIndexForY(sorted, y)].y;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs`
Expected: all tests pass, `# fail 0`.

- [ ] **Step 5: Commit** (`test/` is gitignored — src only)

```bash
git add src/shared/sectionLanes.ts
git commit -m "feat: growLaneForNodes — dragging past a section's bottom edge pushes the sections below it down"
```

---

### Task 2: `resolveCellKernel` / `resolveKernelCellsInCanvas` (pure)

**Files:**
- Modify: `src/shared/kernelBinding.ts` (append)
- Test: `test/kernel-binding.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Change the import line of `test/kernel-binding.mjs` to:

```js
import { resolveBoundKernel, resolveCellKernel, resolveKernelCellsInCanvas } from './.build/kernel-binding.mjs';
```

Append:

```js
const kn   = (id) => ({ id, type: 'kernel', y: 0 });
const cell = (id, y) => ({ id, type: 'code', y });
const edge = (a, b) => ({ fromNode: a, toNode: b });
const lane = (id, y, kernelId) => ({ id, y, createdAt: 1, ...(kernelId ? { kernelId } : {}) });

test('resolveCellKernel: an edge-bound kernel wins over the section kernel', () => {
  const c = { nodes: [kn('K1'), kn('K2'), cell('E1', 0)], edges: [edge('E1', 'K2')], sections: [lane('a', 0, 'K1')] };
  assert.equal(resolveCellKernel('E1', c), 'K2');
});

test('resolveCellKernel: no edge → the kernel of the section owning the cell top edge', () => {
  const c = { nodes: [kn('K1'), cell('E1', 500), cell('E2', 1000)], edges: [], sections: [lane('a', 0, 'K1'), lane('b', 1000)] };
  assert.equal(resolveCellKernel('E1', c), 'K1');
  assert.equal(resolveCellKernel('E2', c), null);   // - lane b is unbound
});

test('resolveCellKernel: a dangling section kernelId is unbound', () => {
  const c = { nodes: [cell('E1', 0)], edges: [], sections: [lane('a', 0, 'gone')] };
  assert.equal(resolveCellKernel('E1', c), null);
});

test('resolveCellKernel: without sections only the edge rule applies', () => {
  assert.equal(resolveCellKernel('E1', { nodes: [kn('K1'), cell('E1', 0)], edges: [], sections: undefined }), null);
  assert.equal(resolveCellKernel('E1', { nodes: [kn('K1'), cell('E1', 0)], edges: [edge('K1', 'E1')], sections: [] }), 'K1');
});

test('resolveKernelCellsInCanvas: edge-bound and section-bound cells, edge wins per cell', () => {
  const c = {
    nodes: [kn('K1'), kn('K2'), cell('E1', 0), cell('E2', 100), cell('E3', 1000)],
    edges: [edge('E1', 'K1'), edge('E3', 'K2')],
    sections: [lane('a', 0, 'K1'), lane('b', 1000, 'K1')],
  };
  assert.deepEqual(resolveKernelCellsInCanvas('K1', c).sort(), ['E1', 'E2']);
  assert.deepEqual(resolveKernelCellsInCanvas('K2', c), ['E3']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx esbuild src/shared/kernelBinding.ts --bundle --format=esm --outfile=test/.build/kernel-binding.mjs && node --test test/kernel-binding.mjs`
Expected: SyntaxError — `resolveCellKernel` is not exported.

- [ ] **Step 3: Write the implementation**

Add at the top of `src/shared/kernelBinding.ts`:

```ts
import { laneIndexForY, sortLanes, type SectionLane } from './sectionLanes';
import type { CanvasData } from './types';
```

Append at the end:

```ts
/** The slice of a canvas the kernel rule needs; a React Flow store can supply it as easily as CanvasData. */
export interface CellKernelCanvas {
  nodes:    { id: string; type: string; y: number }[];
  edges:    EdgeLike[];
  sections: SectionLane[] | undefined;
}

export function cellKernelView(c: Pick<CanvasData, 'nodes' | 'edges' | 'metadata'>): CellKernelCanvas {
  return { nodes: c.nodes, edges: c.edges, sections: c.metadata?.sections };
}

// - the kernel a code cell runs on: an edge-bound kernel wins; else the kernel of the section that
// - owns the cell's top edge; else null. One rule for the host, the MCP and the webview.
export function resolveCellKernel(cellId: string, c: CellKernelCanvas): string | null {
  const byId = new Map(c.nodes.map(n => [n.id, n]));
  const isKernel = (id: string) => byId.get(id)?.type === 'kernel';
  const viaEdge = resolveBoundKernel(cellId, c.edges, isKernel);
  if (viaEdge) return viaEdge;
  const cell = byId.get(cellId);
  const lanes = c.sections ?? [];
  if (!cell || lanes.length === 0) return null;
  const sorted = sortLanes(lanes);
  const lane = sorted[laneIndexForY(sorted, cell.y)];
  return lane.kernelId && isKernel(lane.kernelId) ? lane.kernelId : null;
}

// - every code cell that resolves to `kernelId`. Used to clear run-flags when that kernel is
// - restarted or shut down (its namespace is gone, so every one of them is un-run).
export function resolveKernelCellsInCanvas(kernelId: string, c: CellKernelCanvas): string[] {
  return c.nodes.filter(n => n.type === 'code' && resolveCellKernel(n.id, c) === kernelId).map(n => n.id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx esbuild src/shared/kernelBinding.ts --bundle --format=esm --outfile=test/.build/kernel-binding.mjs && node --test test/kernel-binding.mjs`
Expected: `# fail 0`.

- [ ] **Step 5: Typecheck, commit**

Run: `npm run typecheck` — the 3 pre-existing errors only.

```bash
git add src/shared/kernelBinding.ts
git commit -m "feat: resolveCellKernel — edge-bound kernel, else the section's kernel"
```

---

### Task 3: kernel resolution switches to the one rule; `runSection` on the host

**Files:**
- Modify: `src/shared/types.ts:376` (message), `:756` (union)
- Modify: `src/extension/editor-provider.ts` — import line 27, dispatch (`case 'runCell'` block ~line 485), `runOneCell` (~1369), `handleComplete` (~1626), `handleInspect` (~1654), the two `resolveKernelCells` sites (~1686, ~1715), new `handleRunSection`
- Modify: `src/extension/mcp/server.ts:32` (import), `:942`
- Create: `src/webview/canvas/LanesContext.ts`
- Modify: `src/webview/canvas/nodes/CodeNode.tsx:17`, `:66-76`, `:373`
- Modify: `src/webview/canvas/CanvasView.tsx` — provider around the tree (see Step 6)

- [ ] **Step 1: Message type**

In `src/shared/types.ts`, after the `MsgRunCell` line (376):

```ts
// - run every code cell of a section top to bottom on its resolved kernel; the first error stops it
export interface MsgRunSection { type: 'runSection'; sectionId: string; }
```

In the `WebviewToHost` union, after `| MsgRunCell`:

```ts
  | MsgRunSection
```

- [ ] **Step 2: Host — imports and the six sites**

`src/extension/editor-provider.ts` line 27 becomes:

```ts
import { resolveUpstreamChain, resolveCellKernel, resolveKernelCellsInCanvas, cellKernelView } from '../shared/kernelBinding';
```

Line 72 becomes:

```ts
import { migrateSections, deriveLanes } from '../shared/sectionLanes';
```

Replace, in `runOneCell` (~1369):

```ts
    const boundKernelNodeId = resolveBoundKernel(codeNode.id, canvas.edges, id => nodeById.get(id)?.type === 'kernel');
```
with
```ts
    const boundKernelNodeId = resolveCellKernel(codeNode.id, cellKernelView(canvas));
```

In `handleComplete` (~1626) and `handleInspect` (~1654), replace each

```ts
    const kid = resolveBoundKernel(codeNode.id, canvas.edges, id => nodeById.get(id)?.type === 'kernel');
```
with
```ts
    const kid = resolveCellKernel(codeNode.id, cellKernelView(canvas));
```
(the `nodeById` map on the line above each stays: it is still used to look the kernel node up).

Replace the dead-kernel sweep (~1686):

```ts
      const bound = new Set(resolveKernelCells(k.id, canvas.edges, id => typeOf(id) === 'code', id => typeOf(id) === 'kernel'));
```
with
```ts
      const bound = new Set(resolveKernelCellsInCanvas(k.id, cellKernelView(canvas)));
```

and in `handleKernelAction`'s `resetBoundCellFlags` (~1715):

```ts
      const bound  = new Set(resolveKernelCells(kernelNode.id, canvas.edges, id => typeOf(id) === 'code', id => typeOf(id) === 'kernel'));
```
with
```ts
      const bound  = new Set(resolveKernelCellsInCanvas(kernelNode.id, cellKernelView(canvas)));
```

Then delete the now-unused `const typeOf = …` lines next to those two sites if the compiler reports them unused (it does not — `noUnusedLocals` is off — so delete them by hand: the one directly above the ~1686 loop and the one inside `resetBoundCellFlags`).

- [ ] **Step 3: Host — `runSection` handler and dispatch**

In the message `switch`, after the `case 'runCell': …` line:

```ts
        case 'runSection':   await this.handleRunSection(msg, manager, panel, document, v => { isSelfSaving = v; }, s => rememberWrite(s)); break;
```

Add the method after `handleRunCell`:

```ts
  /**
   * Run every code cell of one section, top to bottom (y, then x), each on its resolved kernel.
   * Every cell runs regardless of lastStatus; the first error stops the sequence.
   */
  private async handleRunSection(
    msg:            MsgRunSection,
    manager:        KernelManager,
    panel:          vscode.WebviewPanel,
    document:       SkenaDocument,
    setSelfSaving:  (v: boolean) => void,
    setLastWritten: (s: string) => void,
  ): Promise<void> {
    const canvas = document.canvas;
    const lane   = deriveLanes(canvas.nodes, canvas.metadata?.sections ?? []).find(l => l.id === msg.sectionId);
    if (!lane) return;
    const members = new Set(lane.memberIds);
    const order = canvas.nodes
      .filter((n): n is CodeNode => n.type === 'code' && members.has(n.id))
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map(n => n.id);
    for (const id of order) {
      // - re-read each turn: runOneCell rewrites the document's nodes (output node, flags)
      const cell = document.canvas.nodes.find(n => n.id === id && n.type === 'code') as CodeNode | undefined;
      if (!cell) continue;
      const st = await this.runOneCell(
        { type: 'runCell', cellNodeId: cell.id, code: cell.code ?? '' },
        manager, panel, document, setSelfSaving, setLastWritten,
      );
      if (st === 'error') return;
    }
  }
```

Add `MsgRunSection` to the types import at the top of `editor-provider.ts` (the import that already lists `MsgRunCell`).

- [ ] **Step 4: MCP server**

`src/extension/mcp/server.ts` line 32 becomes:

```ts
import { resolveCellKernel, resolveUpstreamChain, cellKernelView } from '../../shared/kernelBinding';
```

At ~942 replace

```ts
      const byId = new Map(d.nodes.map(n => [n.id, n]));
      const kid = resolveBoundKernel(cell.id, d.edges, id => byId.get(id)?.type === 'kernel');
      kernelNode = kid ? byId.get(kid) : undefined;
```
with
```ts
      const kid = resolveCellKernel(cell.id, cellKernelView(d));
      kernelNode = kid ? d.nodes.find(n => n.id === kid) : undefined;
```

- [ ] **Step 5: Webview — `LanesContext` and `CodeNode`**

Create `src/webview/canvas/LanesContext.ts`:

```ts
import { createContext, useContext } from 'react';
import type { SectionLane } from '../../shared/sectionLanes';

// - metadata.sections, provided by CanvasView so node components can apply the section-kernel rule
export const LanesContext = createContext<SectionLane[]>([]);

export function useLanes(): SectionLane[] {
  return useContext(LanesContext);
}
```

In `src/webview/canvas/nodes/CodeNode.tsx`, line 17 becomes:

```ts
import { makeCellKernelResolver } from '../../../shared/kernelBinding';
import type { SectionLane } from '../../../shared/sectionLanes';
import { useLanes } from '../LanesContext';
```

(`Node` and `Edge` types come from `@xyflow/react`; add them to the existing `@xyflow/react` import if not already there.)

Add a module-level cache above the component, after the imports:

```ts
// - one resolver per store snapshot: the selector below runs once per code node per store change, and
//   building the node index inside each call was measured at 6 ms per change for 300 nodes (1 ms shared)
let resolverKey: { nodes: unknown; edges: unknown; lanes: unknown } | null = null;
let resolverFn: ((cellId: string) => string | null) | null = null;
function cellKernelResolver(nodes: Node[], edges: Edge[], lanes: SectionLane[]): (cellId: string) => string | null {
  if (!resolverFn || !resolverKey || resolverKey.nodes !== nodes || resolverKey.edges !== edges || resolverKey.lanes !== lanes) {
    resolverFn = makeCellKernelResolver({
      nodes:    nodes.map(n => ({ id: n.id, type: String(n.type ?? ''), y: n.position.y })),
      edges:    edges.map(e => ({ fromNode: e.source, toNode: e.target })),
      sections: lanes,
    });
    resolverKey = { nodes, edges, lanes };
  }
  return resolverFn;
}
```

Replace lines 66–76 (the `bound` selector) with:

```ts
  const lanes = useLanes();
  // - selector returns a primitive (kernel id | null), so default Object.is equality is safe
  const bound = useStore(s => cellKernelResolver(s.nodes, s.edges, lanes)(id));
```

Line 373's title becomes:

```ts
            title={bound ? 'Run on bound kernel (Shift+Enter)' : 'Connect this cell to a kernel node, or bind a kernel to its section, to run'}
```

- [ ] **Step 6: Webview — provide the lanes**

In `src/webview/canvas/CanvasView.tsx`, add the import next to the other `./` imports:

```ts
import { LanesContext } from './LanesContext';
```

In the render (~3110), wrap the outer `<div style={{ width: '100%', height: '100%', … }}>` in `<LanesContext.Provider value={lanes}>` … `</LanesContext.Provider>` (inside `ZoomLevelProvider`).

- [ ] **Step 7: Typecheck + build + commit**

Run: `npm run typecheck` — 3 pre-existing errors only. `grep -n resolveBoundKernel src/extension src/webview -r` → only `kernelBinding.ts` itself. Run: `npm run build`.

```bash
git add src/shared/types.ts src/extension/editor-provider.ts src/extension/mcp/server.ts src/webview/canvas/LanesContext.ts src/webview/canvas/nodes/CodeNode.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat: run section; every kernel-resolution site uses the edge-then-section rule"
```

---

### Task 4: neutral theme tokens as CSS variables

**Files:**
- Modify: `src/webview/canvas/palette.ts` (append)
- Create: `src/webview/theme.ts`
- Modify: `src/webview/App.tsx` (imports at 13–19; a mount effect)

- [ ] **Step 1: Tokens**

Append to `src/webview/canvas/palette.ts`:

```ts
// - neutral chrome tokens (the rail now, the node restyle next). Picked by the VS Code theme kind and
// - exposed as --sk-* CSS variables on <html> by src/webview/theme.ts
export const THEME = {
  light: { bg1: '#f5f5f7', bg2: '#ffffff', bg3: '#e5e5e7', border: '#d1d1d6', text1: '#1d1d1f', text2: '#86868b', text3: '#aeaeb2', accent: '#0071e3' },
  dark:  { bg1: '#1d1d1f', bg2: '#2d2d2f', bg3: '#3d3d3f', border: '#424245', text1: '#f5f5f7', text2: '#86868b', text3: '#636366', accent: '#0a84ff' },
} as const;
```

- [ ] **Step 2: Installer**

Create `src/webview/theme.ts`:

```ts
import { THEME } from './canvas/palette';

function isDarkBody(): boolean {
  const c = document.body.classList;
  return c.contains('vscode-dark') || c.contains('vscode-high-contrast');
}

// - write the neutral tokens as --sk-* variables on <html>; re-run when VS Code swaps the theme class
export function installThemeVars(): () => void {
  const apply = () => {
    const t = isDarkBody() ? THEME.dark : THEME.light;
    for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(`--sk-${k}`, v);
  };
  apply();
  const mo = new MutationObserver(apply);
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}
```

- [ ] **Step 3: Mount**

In `src/webview/App.tsx` add to the imports:

```ts
import { installThemeVars } from './theme';
```

and, inside the `App` component next to the other effects (e.g. right before the `useEffect` at line 108):

```ts
  useEffect(() => installThemeVars(), []);
```

- [ ] **Step 4: Build + commit**

Run: `npm run build`.

```bash
git add src/webview/canvas/palette.ts src/webview/theme.ts src/webview/App.tsx
git commit -m "feat: neutral theme tokens as --sk-* variables, following the VS Code theme kind"
```

---

### Task 5: rail geometry (pure)

**Files:**
- Create: `src/webview/rail/railGeometry.ts`
- Test: `test/rail-geometry.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/rail-geometry.mjs`:

```js
// - run: npx esbuild src/webview/rail/railGeometry.ts --bundle --format=esm --outfile=test/.build/railGeometry.mjs && node --test test/rail-geometry.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { railSegments, railItems, SEG_MIN_H } from './.build/railGeometry.mjs';

const lane = (id, top, bottom) => ({ id, top, bottom });

test('railSegments: a lane projects to screen, clipped to the viewport, with the gap taken off both ends', () => {
  const [s] = railSegments([lane('a', 0, 1000)], 0, 1, 600);
  assert.deepEqual(s, { id: 'a', top: 3, height: 594, clippedTop: false });
});

test('railSegments: panned inside a lane → clippedTop and the segment starts at the viewport top', () => {
  const [s] = railSegments([lane('a', 0, 1000)], -500, 1, 600);
  assert.deepEqual(s, { id: 'a', top: 3, height: 494, clippedTop: true });
});

test('railSegments: lanes outside the viewport are not emitted', () => {
  assert.deepEqual(railSegments([lane('a', 2000, 3000)], 0, 1, 600), []);
  assert.deepEqual(railSegments([lane('a', 0, 100)], -200, 1, 600), []);
});

test('railSegments: adjacent lanes keep the 6px gap', () => {
  const [a, b] = railSegments([lane('a', 0, 300), lane('b', 300, 600)], 0, 1, 600);
  assert.equal(a.top + a.height, 297);
  assert.equal(b.top, 303);
});

test('railSegments: a tiny projection is floored at SEG_MIN_H and kept inside the viewport', () => {
  const [s] = railSegments([lane('a', 0, 1000)], 0, 0.01, 600);   // - projects to 0..10
  assert.equal(s.height, SEG_MIN_H);
  assert.equal(s.top, 0);
  const [t] = railSegments([lane('a', 0, 1000)], 590, 0.01, 600);   // - projects to 590..600
  assert.equal(t.height, SEG_MIN_H);
  assert.equal(t.top + t.height, 600);
});

test('railItems: strict priority — S#, fold, title, run, kernel, delete', () => {
  assert.deepEqual(railItems(28, 20), ['label']);
  assert.deepEqual(railItems(60, 20), ['fold', 'label']);
  assert.deepEqual(railItems(200, 20), ['fold', 'title', 'run']);
  assert.deepEqual(railItems(400, 20), ['fold', 'title', 'run', 'kernel', 'delete']);
  assert.deepEqual(railItems(10, 5), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx esbuild src/webview/rail/railGeometry.ts --bundle --format=esm --outfile=test/.build/railGeometry.mjs && node --test test/rail-geometry.mjs`
Expected: esbuild error — file not found.

- [ ] **Step 3: Write the implementation**

Create `src/webview/rail/railGeometry.ts`:

```ts
/**
 * Rail geometry, all in screen px. Pure: no React, no DOM — unit-tested like the shared modules.
 */

export const RAIL_W      = 44;
export const SEG_GAP     = 6;     // - space between adjacent segments
export const SEG_MIN_H   = 28;    // - a segment never shrinks below this: room for S#
export const SEG_PAD_TOP = 8;
export const ITEM_GAP    = 7;
export const ITEM_H      = 14;    // - chevron / run icon / ✕ box
export const LABEL_H     = 12;    // - S# drawn horizontally
export const DOT_H       = 9;     // - kernel dot
export const TITLE_PX_PER_CHAR = 6.5;   // - 10.5px system font, rotated; average advance

export interface RailSegment {
  id: string;
  top: number;
  height: number;
  /** - the lane continues above the viewport (contents sit at the viewport top) */
  clippedTop: boolean;
}

/** Project every lane that intersects the viewport to a screen segment. */
export function railSegments(
  lanes: { id: string; top: number; bottom: number }[],
  ty: number, zoom: number, viewportH: number,
): RailSegment[] {
  const out: RailSegment[] = [];
  if (viewportH <= 0) return out;
  for (const l of lanes) {
    const rawTop = l.top * zoom + ty;
    const rawBottom = l.bottom * zoom + ty;
    if (rawBottom < 0 || rawTop > viewportH) continue;
    let top = Math.max(rawTop, 0) + SEG_GAP / 2;
    let bottom = Math.min(rawBottom, viewportH) - SEG_GAP / 2;
    if (bottom - top < SEG_MIN_H) {
      const mid = (top + bottom) / 2;
      top = Math.max(mid - SEG_MIN_H / 2, 0);
      bottom = Math.min(top + SEG_MIN_H, viewportH);
      top = Math.max(bottom - SEG_MIN_H, 0);
    }
    out.push({ id: l.id, top, height: bottom - top, clippedTop: rawTop < 0 });
  }
  return out;
}

export type RailItem = 'label' | 'fold' | 'title' | 'run' | 'kernel' | 'delete';

/**
 * Which controls fit in a segment of `height` px, in display order. Strict priority: the first item
 * that does not fit stops the list. `label` (S#, horizontal) is replaced by `title` when that fits.
 */
export function railItems(height: number, titleChars: number): RailItem[] {
  const titleH = Math.ceil(titleChars * TITLE_PX_PER_CHAR);
  const steps: [RailItem, number][] = [
    ['label', LABEL_H], ['fold', ITEM_H], ['title', titleH], ['run', ITEM_H], ['kernel', DOT_H], ['delete', ITEM_H],
  ];
  let budget = height - SEG_PAD_TOP;
  const got = new Set<RailItem>();
  for (const [item, h] of steps) {
    if (budget < h) break;
    got.add(item);
    budget -= h + ITEM_GAP;
  }
  if (got.has('title')) got.delete('label');
  const order: RailItem[] = ['fold', 'title', 'label', 'run', 'kernel', 'delete'];
  return order.filter(i => got.has(i));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx esbuild src/webview/rail/railGeometry.ts --bundle --format=esm --outfile=test/.build/railGeometry.mjs && node --test test/rail-geometry.mjs`
Expected: `# fail 0`. (Arithmetic check for the floor test: 0..10 → 3..7 → mid 5 → top 0 → bottom 28.)

- [ ] **Step 5: Commit**

```bash
git add src/webview/rail/railGeometry.ts
git commit -m "feat: rail geometry — segment projection with gap and floor, item priority"
```

---

### Task 6: the rail component; the header goes

**Files:**
- Create: `src/webview/rail/RailSegment.tsx`, `src/webview/rail/SectionRail.tsx`
- Modify: `src/webview/canvas/CanvasView.tsx` (imports ~56–58; render ~3110–3116; new handlers next to `handleFoldLane` ~781)
- Delete: `src/webview/canvas/SectionStickyHeader.tsx`

- [ ] **Step 1: `RailSegment.tsx`**

```tsx
import React from 'react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { railItems, ITEM_H, type RailSegment as Seg } from './railGeometry';

const FONT = 'system-ui, -apple-system, sans-serif';

// - 'YYYY-MM-DD HH:MM' local time; the title of an untitled section
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const Chevron = ({ folded }: { folded: boolean }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: folded ? 'rotate(-90deg)' : 'none', transition: 'transform 130ms' }}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

const Play = () => (
  <svg width={ITEM_H} height={ITEM_H} viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l8 5-8 5z" /></svg>
);

const btn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
  color: 'var(--sk-text2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, flex: 'none',
};

export function RailSegment({ lane, seg, color, kernelName, current, onFold, onRun, onDelete, onKernel, onTitle }: {
  lane: DerivedLane;
  seg: Seg;
  color: string;
  kernelName: string | null;
  current: boolean;
  onFold: (id: string) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onKernel: (id: string, anchor: DOMRect) => void;
  onTitle: (id: string, anchor: DOMRect) => void;
}): JSX.Element {
  const title = lane.title?.trim() || fmtDateTime(lane.createdAt);
  const full = `${lane.label}: ${title}`;
  const { items, titleMaxPx } = railItems(seg.height, full.length);
  const tooltip = `${full} · ${fmtDateTime(lane.createdAt)} · ${kernelName ?? 'no kernel'}${lane.folded ? ' · folded' : ''}`;
  const anchor = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect();

  return (
    <div title={tooltip} style={{ position: 'absolute', left: 0, right: 0, top: seg.top, height: seg.height, opacity: lane.folded ? 0.55 : 1 }}>
      <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 4, borderRadius: 2, background: color }} />
      <div style={{ position: 'absolute', left: 10, right: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, paddingTop: 8, overflow: 'hidden', boxSizing: 'border-box' }}>
        {items.map(item => {
          switch (item) {
            case 'fold':
              return <button key={item} style={btn} title={lane.folded ? 'unfold section' : 'fold section'} onClick={() => onFold(lane.id)}><Chevron folded={!!lane.folded} /></button>;
            case 'title':
              return (
                <span key={item} onDoubleClick={e => onTitle(lane.id, anchor(e))} title="double-click to rename"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontFamily: FONT, fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap', cursor: 'default', color: current ? 'var(--sk-text1)' : 'var(--sk-text2)', userSelect: 'none', maxHeight: titleMaxPx, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color }}>{lane.label}:</span> {title}
                </span>
              );
            case 'label':
              return <span key={item} onDoubleClick={e => onTitle(lane.id, anchor(e))} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 10, color, userSelect: 'none' }}>{lane.label}</span>;
            case 'run':
              return <button key={item} style={btn} title="run section" onClick={() => onRun(lane.id)}><Play /></button>;
            case 'kernel':
              return (
                <button key={item} style={{ ...btn, height: 14 }} title={kernelName ? `kernel: ${kernelName}` : 'bind a kernel'} onClick={e => onKernel(lane.id, anchor(e))}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: kernelName ? color : 'transparent', border: kernelName ? 'none' : '1.5px solid var(--sk-text3)', display: 'block' }} />
                </button>
              );
            case 'delete':
              return <button key={item} style={{ ...btn, color: 'var(--sk-text3)', fontFamily: FONT, fontSize: 12 }} title="delete section and its nodes" onClick={() => onDelete(lane.id)}>✕</button>;
          }
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `SectionRail.tsx`** (popovers come in Task 7 — for now the kernel/title callbacks are wired to no-ops from CanvasView)

```tsx
import React from 'react';
import { useStore } from '@xyflow/react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { kernelColor } from '../canvas/palette';
import { railSegments, RAIL_W } from './railGeometry';
import { RailSegment } from './RailSegment';

/** What the rail needs to know about a kernel node on this canvas. */
export interface RailKernel {
  id: string;
  label: string;        // - K1 …
  name: string;         // - displayName or 'kernel'
  colorIndex: number;
}

export function laneColor(lane: { kernelId?: string }, kernels: RailKernel[]): { color: string; kernel: RailKernel | null } {
  const k = lane.kernelId ? kernels.find(x => x.id === lane.kernelId) ?? null : null;
  return { color: k ? kernelColor(k.colorIndex) : 'var(--sk-text3)', kernel: k };
}

export function SectionRail({ lanes, kernels, selectedNodeId, onFold, onRun, onDelete, onKernel, onTitle, onNewSection }: {
  lanes: DerivedLane[];
  kernels: RailKernel[];
  selectedNodeId: string | null;
  onFold: (id: string) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onKernel: (id: string, anchor: DOMRect) => void;
  onTitle: (id: string, anchor: DOMRect) => void;
  onNewSection: () => void;
}): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  // - the flow container's height from the store: reactive and correct on the first paint
  const height = useStore(s => s.height);
  const segs = railSegments(lanes, ty, zoom, height);
  const byId = new Map(lanes.map(l => [l.id, l]));
  const currentId = selectedNodeId ? lanes.find(l => l.memberIds.includes(selectedNodeId))?.id ?? null : null;

  return (
    <div style={{ width: RAIL_W, flex: '0 0 auto', position: 'relative', background: 'var(--sk-bg1)', borderRight: '1px solid var(--sk-border)', overflow: 'hidden' }}>
      {segs.map(seg => {
        const lane = byId.get(seg.id);
        if (!lane) return null;
        const { color, kernel } = laneColor(lane, kernels);
        return (
          <RailSegment key={seg.id} lane={lane} seg={seg} color={color} kernelName={kernel ? `${kernel.label} · ${kernel.name}` : null}
            current={lane.id === currentId} onFold={onFold} onRun={onRun} onDelete={onDelete} onKernel={onKernel} onTitle={onTitle} />
        );
      })}
      <button title="new section" onClick={onNewSection}
        style={{ position: 'absolute', bottom: 6, left: 0, right: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sk-text2)', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 18, lineHeight: 1, padding: '4px 0 4px 8px' }}>
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 3: CanvasView — imports, handlers, layout**

Replace the import at line 57 (`SectionStickyHeader`) with:

```ts
import { SectionRail, type RailKernel } from '../rail/SectionRail';
import type { KernelNode } from '../../shared/types';   // - only if not already imported
```

After `handleDeleteLane` (~line 830) add:

```ts
  const handleRunLane = useCallback((id: string) => {
    vscodePostMessage({ type: 'runSection', sectionId: id });
  }, []);

  const handleNewSectionClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('skena:newSection'));
  }, []);

  // - kernel nodes on this canvas, for the rail's colours and picker
  const railKernels = useMemo<RailKernel[]>(() => nodes
    .filter(n => n.type === 'kernel')
    .map(n => {
      const k = n.data as unknown as KernelNode;
      return { id: n.id, label: k.nodeLabel ?? 'K?', name: k.displayName ?? 'kernel', colorIndex: k.colorIndex ?? 0 };
    }), [nodes]);

  const selectedNodeId = useMemo(() => nodes.find(n => n.selected && !isBandType(n.type))?.id ?? null, [nodes]);

  // - popovers arrive with Task 7
  const noopAnchor = useCallback((_id: string, _anchor: DOMRect) => {}, []);
```

Replace the render block

```tsx
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
    <SectionStickyHeader lanes={derivedLanes} onFold={handleFoldLane} onDelete={handleDeleteLane} />
    <div ref={wrapperRef} style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }} onContextMenu={handleContextMenu}>
```
with
```tsx
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row' }}>
    <SectionRail lanes={derivedLanes} kernels={railKernels} selectedNodeId={selectedNodeId}
      onFold={handleFoldLane} onRun={handleRunLane} onDelete={handleDeleteLane}
      onKernel={noopAnchor} onTitle={noopAnchor} onNewSection={handleNewSectionClick} />
    <div ref={wrapperRef} style={{ flex: '1 1 auto', minWidth: 0, position: 'relative' }} onContextMenu={handleContextMenu}>
```

Delete `src/webview/canvas/SectionStickyHeader.tsx`:

```bash
git rm src/webview/canvas/SectionStickyHeader.tsx
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck` — 3 pre-existing errors only (if `KernelNode` was already imported in CanvasView, drop the duplicate import). Run: `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/rail/RailSegment.tsx src/webview/rail/SectionRail.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat: section rail beside the flow — stripe, rotated title, fold, run, delete, +; the sticky header goes"
```

---

### Task 7: kernel picker and title editor popovers

**Files:**
- Create: `src/webview/rail/KernelPicker.tsx`, `src/webview/rail/TitleEditor.tsx`
- Modify: `src/webview/rail/SectionRail.tsx` (popover state), `src/webview/canvas/CanvasView.tsx` (two handlers, replace the no-ops)

- [ ] **Step 1: `KernelPicker.tsx`**

```tsx
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { kernelColor } from '../canvas/palette';
import type { RailKernel } from './SectionRail';

const FONT = 'system-ui, -apple-system, sans-serif';

/** Popover listing the canvas's kernel nodes; portalled to body so the rail's overflow does not clip it. */
export function KernelPicker({ anchor, kernels, currentId, onPick, onClose }: {
  anchor: DOMRect;
  kernels: RailKernel[];
  currentId: string | null;
  onPick: (kernelId: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 12, color: 'var(--sk-text1)' };

  return createPortal(
    <div ref={ref} className="nodrag" style={{ position: 'fixed', left: anchor.right + 6, top: anchor.top - 4, zIndex: 1000, minWidth: 180, background: 'var(--sk-bg2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: '4px 0', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
      {kernels.length === 0 && (
        <div style={{ ...row, cursor: 'default', color: 'var(--sk-text2)' }}>no kernel nodes on this canvas — add one with “Skena: Add Kernel”</div>
      )}
      {kernels.map(k => (
        <div key={k.id} style={{ ...row, fontWeight: k.id === currentId ? 600 : 400 }} onClick={() => { onPick(k.id); onClose(); }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: kernelColor(k.colorIndex), flex: 'none' }} />
          <span style={{ color: 'var(--sk-text2)' }}>{k.label}</span>
          <span>{k.name}</span>
        </div>
      ))}
      <div style={{ height: 1, background: 'var(--sk-border)', margin: '4px 0' }} />
      <div style={{ ...row, color: 'var(--sk-text2)' }} onClick={() => { onPick(null); onClose(); }}>none</div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: `TitleEditor.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Popover input for a section title. Enter commits, Escape cancels, blur commits. */
export function TitleEditor({ anchor, initial, onCommit, onClose }: {
  anchor: DOMRect;
  initial: string;
  onCommit: (title: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { onCommit(value); onClose(); };
  return createPortal(
    <input ref={ref} className="nodrag" value={value} placeholder="section title"
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onClose(); e.stopPropagation(); }}
      onBlur={commit}
      style={{ position: 'fixed', left: anchor.right + 6, top: anchor.top, zIndex: 1000, width: 220, padding: '5px 8px', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12, color: 'var(--sk-text1)', background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', borderRadius: 8, outline: 'none' }} />,
    document.body,
  );
}
```

- [ ] **Step 3: Popover state in `SectionRail.tsx`**

Add imports:

```tsx
import { useState, useCallback } from 'react';
import { KernelPicker } from './KernelPicker';
import { TitleEditor } from './TitleEditor';
import { fmtDateTime } from './RailSegment';
```

Change the props: replace `onKernel: (id: string, anchor: DOMRect) => void; onTitle: (id: string, anchor: DOMRect) => void;` with

```tsx
  onBindKernel: (id: string, kernelId: string | null) => void;
  onRename: (id: string, title: string) => void;
```

Inside the component, before `return`:

```tsx
  const [pop, setPop] = useState<{ kind: 'kernel' | 'title'; laneId: string; anchor: DOMRect } | null>(null);
  const closePop = useCallback(() => setPop(null), []);
  const openKernel = useCallback((id: string, anchor: DOMRect) => setPop({ kind: 'kernel', laneId: id, anchor }), []);
  const openTitle  = useCallback((id: string, anchor: DOMRect) => setPop({ kind: 'title', laneId: id, anchor }), []);
  const popLane = pop ? byId.get(pop.laneId) : undefined;
```

Pass `onKernel={openKernel} onTitle={openTitle}` to `RailSegment`, and before the closing `</div>` of the rail add:

```tsx
      {pop && popLane && pop.kind === 'kernel' && (
        <KernelPicker anchor={pop.anchor} kernels={kernels} currentId={popLane.kernelId ?? null}
          onPick={kid => onBindKernel(popLane.id, kid)} onClose={closePop} />
      )}
      {pop && popLane && pop.kind === 'title' && (
        <TitleEditor anchor={pop.anchor} initial={popLane.title ?? ''}
          onCommit={t => onRename(popLane.id, t)} onClose={closePop} />
      )}
```

(`fmtDateTime` import is unused here if the placeholder path is not needed — remove the import if so.)

- [ ] **Step 4: Handlers in `CanvasView.tsx`**

Replace the `noopAnchor` callback with:

```ts
  const handleBindKernel = useCallback((id: string, kernelId: string | null) => {
    pushHistory();
    commitLanes(lanes.map(l => (l.id === id ? { ...l, kernelId: kernelId ?? undefined } : l)));
  }, [lanes, commitLanes, pushHistory]);

  const handleRenameLane = useCallback((id: string, title: string) => {
    const t = title.trim();
    pushHistory();
    commitLanes(lanes.map(l => (l.id === id ? { ...l, title: t || undefined } : l)));
  }, [lanes, commitLanes, pushHistory]);
```

and in the render replace `onKernel={noopAnchor} onTitle={noopAnchor}` with `onBindKernel={handleBindKernel} onRename={handleRenameLane}`.

- [ ] **Step 5: Typecheck + build + commit**

Run: `npm run typecheck` (3 pre-existing), `npm run build`.

```bash
git add src/webview/rail/KernelPicker.tsx src/webview/rail/TitleEditor.tsx src/webview/rail/SectionRail.tsx src/webview/canvas/CanvasView.tsx
git commit -m "feat: rail popovers — bind a section to a kernel node, rename a section"
```

---

### Task 8: camera returns to the origin rule; separators replace the stripes

**Files:**
- Create: `src/webview/canvas/SectionSeparators.tsx`
- Delete: `src/webview/canvas/SectionLaneMarks.tsx`, `src/webview/canvas/CameraTopGuard.tsx`
- Modify: `src/webview/canvas/CanvasView.tsx` — imports 56–58; `firstLaneTopRef` block ~726–738 and effect ~755–757; `translateExtent` ~3101–3108; mounts ~3161–3162

- [ ] **Step 1: `SectionSeparators.tsx`**

```tsx
import React from 'react';
import { useStore } from '@xyflow/react';
import type { DerivedLane } from '../../shared/sectionLanes';

/** The 1px line at each section's bottom — the only section drawing left inside the flow. */
export function SectionSeparators({ lanes }: { lanes: DerivedLane[] }): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const height = useStore(s => s.height);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {lanes.map((l, i) => {
        if (i === lanes.length - 1) return null;   // - the last lane is unbounded: no line below it
        const y = l.bottom * zoom + ty;
        if (height <= 0 || y < 0 || y > height) return null;
        return <div key={l.id} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 0, borderBottom: '1px solid var(--sk-border)' }} />;
      })}
    </div>
  );
}
```

- [ ] **Step 2: CanvasView — camera**

Imports: replace lines 56 and 58 (`SectionLaneMarks`, `CameraTopGuard`) with

```ts
import { SectionSeparators } from './SectionSeparators';
```

Replace the block from the `// - top of the first lane, for the camera clamp below` comment through the end of `clampCam` (~726–738) with:

```ts
  /**
   * The single rule every camera write obeys: one grid of margin left of the origin, flush at the
   * top. The rail lives outside the flow, so nothing above y = 0 ever needs to be shown. Twelve call
   * sites write the viewport; they all go through here.
   */
  const clampCam = useCallback((x: number, y: number, zoom: number): { x: number; y: number } => {
    const c = clampViewportToOrigin(x, y, zoom);
    return { x: c.x, y: Math.min(c.y, 0) };
  }, []);
```

Delete the effect

```ts
  useEffect(() => {
    firstLaneTopRef.current = derivedLanes.length ? derivedLanes[0].top : null;
  }, [derivedLanes]);
```

Replace the `translateExtent` block (~3101–3108, from the `// - pan bounds:` comment to the `useMemo`) with a module-level constant next to `MIN_ZOOM`:

```ts
// - pan bounds: one grid left of the origin, flush at the top (the rail is outside the flow)
const TRANSLATE_EXTENT: [[number, number], [number, number]] = [[-ORIGIN_GUTTER, 0], [1e7, 1e7]];
```

and `translateExtent={translateExtent}` becomes `translateExtent={TRANSLATE_EXTENT}`.

Replace the two mounts inside `<ReactFlow>`

```tsx
        <CameraTopGuard topFlowY={derivedLanes.length ? derivedLanes[0].top : null} />
        <SectionLaneMarks lanes={derivedLanes} />
```
with
```tsx
        <SectionSeparators lanes={derivedLanes} />
```

```bash
git rm src/webview/canvas/SectionLaneMarks.tsx src/webview/canvas/CameraTopGuard.tsx
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck` (3 pre-existing; `useMemo` may now be unused only if nothing else uses it — it is used elsewhere, keep the import). `grep -n 'firstLaneTopRef\|extentTopY\|CameraTopGuard\|SectionLaneMarks' src -r` → nothing. Run: `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/SectionSeparators.tsx src/webview/canvas/CanvasView.tsx
git commit -m "refactor: camera back to the origin rule — top flush at 0, no lane term, no top guard; stripes replaced by separators"
```

---

### Task 9: `colorIndex` goes; colour comes from the kernel

**Files:**
- Modify: `src/shared/sectionLanes.ts` (interface ~line 24; `migrateSections`)
- Modify: `src/webview/canvas/CanvasView.tsx` (new-section handler ~798)
- Test: `test/section-lanes.mjs`

- [ ] **Step 1: Write the failing test** (append to `test/section-lanes.mjs`)

```js
test('migrateSections drops a stored colorIndex and is idempotent afterwards', () => {
  const canvas = { nodes: [node('n1', 0)], edges: [], metadata: { sections: [{ id: 'a', y: 0, createdAt: 1, colorIndex: 3 }] } };
  const once = migrateSections(canvas, 5);
  assert.deepEqual(once.metadata.sections, [{ id: 'a', y: 0, createdAt: 1 }]);
  assert.equal(migrateSections(once, 6), once);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs`
Expected: the new test fails (the `colorIndex: 3` survives).

- [ ] **Step 3: Implementation**

In `SectionLane`, delete the two lines

```ts
  /** - index into the shared colour palette; gives each lane its own stripe colour */
  colorIndex?: number;
```

and change the `kernelId` comment to `/** - id of a kernel node on this canvas; the section's colour and the fallback kernel of its cells */`.

In `migrateSections`:
- add, after `const needsLift = minLaneY < 0;`:
  ```ts
  const hasColor = !!existing?.some(l => (l as { colorIndex?: number }).colorIndex !== undefined);
  ```
- change the early return to `if (legacy.length === 0 && !hasMembership && !needsSeed && !needsLift && !hasColor) return canvas;`
- in `converted`, `{ id: s.id, y: s.y, createdAt: s.createdAt ?? now, colorIndex: i }` → `{ id: s.id, y: s.y, createdAt: s.createdAt ?? now }`
- `sections.push({ id: …, y: 0, createdAt: now, colorIndex: 0 })` → `sections.push({ id: …, y: 0, createdAt: now })`
- replace `let sections = sortLanes([...(existing ?? []), ...converted]);` with
  ```ts
  const stripped = (existing ?? []).map(l => {
    const { colorIndex: _drop, ...rest } = l as SectionLane & { colorIndex?: number };
    return rest as SectionLane;
  });
  let sections = sortLanes([...stripped, ...converted]);
  ```

In `CanvasView.tsx`'s `skena:newSection` handler, `{ id: \`sec-${now.toString(36)}\`, y: flowY, createdAt: now, colorIndex: lanes.length }` → `{ id: \`sec-${now.toString(36)}\`, y: flowY, createdAt: now }`.

- [ ] **Step 4: Run the tests, typecheck, build**

Run the section-lanes test command — `# fail 0` (fix any older test in that file that asserted `colorIndex`: `grep -n colorIndex test/section-lanes.mjs`). Run: `npm run typecheck` (3 pre-existing), `grep -rn colorIndex src/shared src/webview/rail src/webview/canvas/CanvasView.tsx` → only `KernelNode.colorIndex` uses remain. Run: `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sectionLanes.ts src/webview/canvas/CanvasView.tsx
git commit -m "refactor: a section's colour is its kernel's — drop SectionLane.colorIndex"
```

---

### Task 10: history carries sections; the webview grows sections on geometry changes

**Files:**
- Create: `src/webview/rail/useLaneGrowth.ts`
- Modify: `src/webview/canvas/CanvasView.tsx` — `HistoryEntry` ~line 525; `pushHistory` ~712; `lanes` state ~721–724; `applyHistoryState`/`undo`/`redo` ~831–858; a new `applyGrowth` callback after `commitLanes`

- [ ] **Step 1: `useLaneGrowth.ts`**

```ts
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Node } from '@xyflow/react';
import { growLaneForNodes, type LaneGrowth, type SectionLane } from '../../shared/sectionLanes';

const geomOf = (n: Node) => ({
  id: n.id, x: n.position.x, y: n.position.y,
  width: Number(n.width ?? n.style?.width ?? 0), height: Number(n.height ?? n.style?.height ?? 0),
});

/**
 * Watches node geometry. After any change that is not part of an in-progress drag (drop, keyboard
 * move, resize, creation, paste, an external write), asks growLaneForNodes whether a section must
 * grow and hands the shifts to `apply`. The shifted nodes come back through this effect once more
 * and produce no further growth, so it settles in one extra pass.
 */
export function useLaneGrowth(nodes: Node[], lanes: SectionLane[], dragging: MutableRefObject<boolean>, apply: (g: LaneGrowth) => void): void {
  const prev = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (dragging.current) return;   // - record nothing mid-drag: the drop is diffed against the drag start
    const sig = new Map(nodes.map(n => { const g = geomOf(n); return [n.id, `${g.x},${g.y},${g.width},${g.height}`]; }));
    const before = prev.current;
    prev.current = sig;
    if (!before) return;
    const changed = [...sig].filter(([id, s]) => before.get(id) !== s).map(([id]) => id);
    if (changed.length === 0) return;
    const g = growLaneForNodes(lanes, nodes.map(geomOf), changed);
    if (Object.keys(g.laneShifts).length) apply(g);
  }, [nodes, lanes, dragging, apply]);
}
```

- [ ] **Step 2: History entries carry sections**

Move the two lines

```ts
  const [lanes, setLanes] = useState<SectionLane[]>(canvas.metadata?.sections ?? []);
  useEffect(() => { setLanes(canvas.metadata?.sections ?? []); }, [canvas]);
  const lanesRef = useRef<SectionLane[]>(lanes);
  useEffect(() => { lanesRef.current = lanes; }, [lanes]);
```

to just above `const pushHistory = useCallback(…)` (~712). Then:

`type HistoryEntry = { nodes: CanvasNode[]; edges: CanvasEdge[] };` → `type HistoryEntry = { nodes: CanvasNode[]; edges: CanvasEdge[]; sections: SectionLane[] };`

Every place that builds an entry — `pushHistory`, `undo` (the `redoStackRef` push), `redo` (the `undoStackRef` push) — `{ nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges] }` becomes
`{ nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges], sections: [...lanesRef.current] }`.

`applyHistoryState` becomes:

```ts
  const applyHistoryState = useCallback((entry: HistoryEntry) => {
    canvasRef.current = { ...canvasRef.current, nodes: entry.nodes, edges: entry.edges, metadata: { ...canvasRef.current.metadata, sections: entry.sections } };
    setLanes(entry.sections);
    setNodes(entry.nodes.map(toFlowNode));
    setEdges(entry.edges.map(toFlowEdge));
    scheduleSave();
  }, [setNodes, setEdges, scheduleSave]);
```

- [ ] **Step 3: Apply growth in CanvasView**

Add the import: `import { useLaneGrowth } from '../rail/useLaneGrowth';` and `type LaneGrowth` to the `sectionLanes` import.

After `commitLanes`:

```ts
  // - a node moved or resized past its section's bottom edge: push every section below it down
  const applyGrowth = useCallback((g: LaneGrowth) => {
    pushHistory();
    setNodes(nds => nds.map(n => (g.nodeShifts[n.id] ? { ...n, position: { x: n.position.x, y: n.position.y + g.nodeShifts[n.id] } } : n)));
    canvasRef.current = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.map(n => (g.nodeShifts[n.id] ? { ...n, y: n.y + g.nodeShifts[n.id] } : n)),
    };
    commitLanes(lanesRef.current.map(l => (g.laneShifts[l.id] ? { ...l, y: l.y + g.laneShifts[l.id] } : l)));
  }, [pushHistory, setNodes, commitLanes]);
  useLaneGrowth(nodes, lanes, draggingRef, applyGrowth);
```

(`draggingRef` is declared at ~438, above this point.)

- [ ] **Step 4: Typecheck + build + commit**

Run: `npm run typecheck` (3 pre-existing), `npm run build`.

```bash
git add src/webview/rail/useLaneGrowth.ts src/webview/canvas/CanvasView.tsx
git commit -m "feat: sections grow when a node is moved or resized past their bottom edge; undo restores sections"
```

---

### Task 11: host and MCP writes respect section growth; output cells never land in the section above

**Files:**
- Modify: `src/extension/mcp/server.ts` — import; `canvasAddNode` (~590), `canvasUpdateNode` (~624), the output geometry at ~826
- Modify: `src/extension/editor-provider.ts` — the two output-cell sites (~1310 and ~1444)

- [ ] **Step 1: MCP**

Add to the imports of `src/extension/mcp/server.ts`:

```ts
import { applyLaneGrowth, laneTopForY } from '../../shared/sectionLanes';
```

In `canvasAddNode`, replace

```ts
  d.nodes.push(labeled);
  await writeCanvas(p, d);
```
with
```ts
  d.nodes.push(labeled);
  const grown = applyLaneGrowth(d, [labeled.id]);
  await writeCanvas(p, grown);
```

In `canvasUpdateNode`, replace

```ts
  d.nodes[idx] = updated;
  await writeCanvas(p, d);
```
with
```ts
  d.nodes[idx] = updated;
  await writeCanvas(p, applyLaneGrowth(d, [updated.id]));
```

At ~826 replace

```ts
  const outGeom = { x: Math.round(cell.x + cell.width + 140), y: Math.round(cell.y + (cell.height - 320) / 2), width: 480, height: 320 };
```
with
```ts
  // - never above the code cell's section top: that would move the output into the section above
  const outY = Math.max(laneTopForY(d.metadata?.sections ?? [], cell.y), Math.round(cell.y + (cell.height - 320) / 2));
  const outGeom = { x: Math.round(cell.x + cell.width + 140), y: outY, width: 480, height: 320 };
```

- [ ] **Step 2: Host**

While in `editor-provider.ts`: key the run-section guard on the document too — `runningSections` entries become `` `${document.uri.fsPath}::${msg.sectionId}` `` (section ids are `sec-<Date.now()>`, so two canvases can collide on the id alone).

`src/extension/editor-provider.ts` line 72 becomes:

```ts
import { migrateSections, deriveLanes, applyLaneGrowth, laneTopForY } from '../shared/sectionLanes';
```

At both output-cell creation sites (the `cellBase` literals at ~1310 and ~1444) replace

```ts
            x: cn.x + cn.width + 140, y: Math.round(cn.y + (cn.height - 320) / 2), width: 480, height: 320,
```
with
```ts
            x: cn.x + cn.width + 140, y: Math.max(laneTopForY(c.metadata?.sections ?? [], cn.y), Math.round(cn.y + (cn.height - 320) / 2)), width: 480, height: 320,
```

and after each `c.nodes.push(outputNode);` add:

```ts
          Object.assign(c, applyLaneGrowth(c, [outputNode.id]));
```

(`c` is the document's canvas, mutated in place by the surrounding code; `Object.assign` keeps that contract — the shifted node objects are new, the unshifted ones are the same references, so `cn` stays valid.)

- [ ] **Step 3: Typecheck + build + commit**

Run: `npm run typecheck` (3 pre-existing), `npm run build`.

```bash
git add src/extension/mcp/server.ts src/extension/editor-provider.ts
git commit -m "feat: MCP and host writes grow sections; an output cell never lands above its section"
```

---

### Task 12: live verification, version, VSIX

**Files:**
- Modify: `package.json` (`"version": "0.17.0"` → `"0.17.1"`)
- Modify: `docs/superpowers/specs/2026-09-02-section-rail-design.md` (only if the smoke test forces a change)

- [ ] **Step 1: All pure tests**

```bash
npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs
npx esbuild src/shared/kernelBinding.ts --bundle --format=esm --outfile=test/.build/kernel-binding.mjs && node --test test/kernel-binding.mjs
npx esbuild src/webview/rail/railGeometry.ts --bundle --format=esm --outfile=test/.build/railGeometry.mjs && node --test test/rail-geometry.mjs
npx esbuild src/shared/bounds.ts --bundle --format=esm --outfile=test/.build/bounds.mjs && node --test test/bounds.mjs
```
Expected: `# fail 0` for each.

- [ ] **Step 2: Package**

```bash
sed -i 's/"version": "0.17.0"/"version": "0.17.1"/' package.json
npm run package
ls -la skena-0.17.1.vsix
```

- [ ] **Step 3: Install and smoke (manual, the user drives)**

Install `skena-0.17.1.vsix` (or F5 the dev host), open `test/H5.canvas`, and check at zoom 1, 0.4 and 0.07:

- R1: the rail stays at the left edge and in front while panning and zooming.
- R2: titles read bottom → top; `S1:` in the section colour.
- R3: no title anywhere in the flow; the camera cannot go above y = 0 (`Home`, zoom out, restore).
- R4: fold hides the section's nodes and survives a reload; run section runs top to bottom and stops at the first error; kernel picker with 0, 1 and 2 kernel nodes; delete asks first.
- R5: `+` appends a section at the bottom and pans to it.
- R6: drag a node past its section's bottom edge → that section grows and every section below shifts as one block; undo restores both nodes and sections; drag a node above its section's top → it joins the section above.
- Degradation: at 0.07 short segments show only `S#`; hovering shows the full tooltip.
- Reload twice → no extra sections, no stored `colorIndex` in the file.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump to 0.17.1 (section rail)"
```

---

## Self-review

**Spec coverage.** R1/R3/§4 layout → Task 6, 8. R2 → Task 6 (`writing-mode` + rotate). R4 controls → Tasks 6, 7; run section → Task 3. R5 `+` → Task 6. R6/R7 growth → Tasks 1, 10, 11; upward = membership (no code). R8 tokens → Task 4. §3.1 `colorIndex` → Task 9. §5.2–5.5 → Tasks 5, 6. §5.6 fold → existing `hiddenByFold` (unchanged). §6.1 → Task 3. §7 → Tasks 2, 3. §8 → Task 8. §9 → Task 3 (`patchSection` dropped, see header). §10 → file table. §11 tests → Tasks 1, 2, 5, 9, 12. Nothing left uncovered.

**Placeholders.** None: every code step carries its code; every command its expected output.

**Type consistency.** `growLaneForNodes(lanes, nodes, changedIds): LaneGrowth` (Task 1) is what `useLaneGrowth` (Task 10) and `applyLaneGrowth` call. `resolveCellKernel(cellId, CellKernelCanvas)` and `cellKernelView(canvas)` (Task 2) match every call in Task 3. `RailKernel` is declared in `SectionRail.tsx` (Task 6) and imported by `KernelPicker.tsx` and `CanvasView.tsx` (Task 7). `SectionRail` props change in Task 7 (`onKernel`/`onTitle` → `onBindKernel`/`onRename`) and CanvasView is updated in the same task. `laneTopForY` (Task 1) is used in Task 11.
