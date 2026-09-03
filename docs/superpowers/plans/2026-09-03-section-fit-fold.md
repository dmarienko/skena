# Section Fit and Collapsing Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every non-last section fits its content (grows and shrinks, never below `SECTION_MIN_H`), and a folded section collapses to one grid with its members hidden and pinned to it.

**Architecture:** one pure function `fitLanes(lanes, nodes)` replaces `growLaneForNodes`; it computes, per non-last lane, a target range from its visible content and shifts everything below by the difference (both signs). Membership gains a "pinned" path: `SectionLane.folded` becomes the list of member ids hidden by the fold, and `laneIndexForNode` prefers that list over `y`. The three appliers (webview hook, MCP, host) call the same function with no "changed ids".

**Tech Stack:** TypeScript, React 18, React Flow v12, esbuild, `node --test` on bundled pure modules (`test/` gitignored).

**Spec:** `docs/superpowers/specs/2026-09-03-section-rail-followups-design.md` §4–§6.

**Verification commands:** `npm run typecheck` → exactly the 3 pre-existing `fsPath` errors in `src/extension/editor-provider.ts`; `npm run build` → three `⚡ Done`; section-lanes tests: `npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs`.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/shared/constants.ts` | `+ SECTION_MIN_H`, `+ SECTION_FOLDED_H` |
| `src/shared/sectionLanes.ts` | `folded: string[]`; `pinnedLaneIndex`, `laneIndexForNode`; `deriveLanes` with pinned members and visible content; `fitLanes` / `applyLaneFit` / `sectionTargetHeight` (replace `growLaneForNodes` / `applyLaneGrowth`); `pinOutputToLane`; migration of `folded: true` |
| `src/webview/rail/useLaneFit.ts` | renamed from `useLaneGrowth.ts`: fits after any node or lane change |
| `src/webview/canvas/CanvasView.tsx` | `applyFit`, `hiddenByFold` from the lists, fold/unfold sets the list, `+` uses the target height |
| `src/webview/rail/RailSegment.tsx`, `SegmentMenu.tsx` | `folded` is a list now: `!!lane.folded` |
| `src/extension/mcp/server.ts`, `src/extension/editor-provider.ts` | `applyLaneFit(d)` at the eight sites; outputs of pinned cells pinned too |

---

### Task 1: constants, pinned membership, `folded: string[]`, migration

**Files:**
- Modify: `src/shared/constants.ts` (after `NEW_NODE`)
- Modify: `src/shared/sectionLanes.ts` (`SectionLane`, new helpers, `deriveLanes`, `memberCodeCellsInRunOrder`, `migrateSections`)
- Test: `test/section-lanes.mjs`

- [x] **Step 1: Write the failing tests** — append to `test/section-lanes.mjs` (extend the import line with `laneIndexForNode, pinnedLaneIndex, SECTION_FOLDED_H, SECTION_MIN_H`):

```js
test('laneIndexForNode: a pinned node belongs to the lane that lists it, whatever its y', () => {
  const lanes = [lane('a', 0, { folded: ['h1'] }), lane('b', 100)];
  const pinned = pinnedLaneIndex(lanes);
  assert.equal(laneIndexForNode(lanes, { id: 'h1', y: 5000 }, pinned), 0);
  assert.equal(laneIndexForNode(lanes, { id: 'n2', y: 5000 }, pinned), 1);
});

test('deriveLanes: pinned members are listed, hidden from content, and a folded lane is one grid tall', () => {
  const lanes = [lane('a', 0, { folded: ['h1'] }), lane('b', SECTION_FOLDED_H)];
  const nodes = [node('h1', 3000, 300), node('n2', SECTION_FOLDED_H)];
  const [a, b] = deriveLanes(nodes, lanes);
  assert.deepEqual(a.memberIds, ['h1']);
  assert.equal(a.bottom, SECTION_FOLDED_H);
  assert.deepEqual(b.memberIds, ['n2']);
  const [last] = deriveLanes([node('h1', 3000, 300)], [lane('a', 0, { folded: ['h1'] })]);
  assert.equal(last.bottom, SECTION_FOLDED_H);   // - a folded last lane is one grid, not content + pad
});

test('memberCodeCellsInRunOrder includes pinned (folded) cells', () => {
  const lanes = [lane('a', 0, { folded: ['E9'] }), lane('b', 100)];
  const nodes = [typed('E9', 'code', 5000), typed('E1', 'code', 0)];
  assert.deepEqual(memberCodeCellsInRunOrder(nodes, lanes, 'a'), ['E1', 'E9']);
});

test('migrateSections: folded: true becomes the member ids by y, once', () => {
  const canvas = { nodes: [node('n1', 0), node('n2', 1200)], edges: [], metadata: { sections: [{ id: 'a', y: 0, createdAt: 1, folded: true }, lane('b', 1000)] } };
  const once = migrateSections(canvas, 5);
  assert.deepEqual(once.metadata.sections[0].folded, ['n1']);
  assert.equal(migrateSections(once, 6), once);
});
```

- [x] **Step 2: Run to verify they fail** (import error on `laneIndexForNode`).

- [x] **Step 3: Implementation**

`src/shared/constants.ts`, after `NEW_NODE`:

```ts
// - a section (except the last) is never shorter than this: room for two default nodes and two gaps
export const SECTION_MIN_H    = 2 * NODE_SIZE.code.h + 2 * GRID;
// - a folded section's range
export const SECTION_FOLDED_H = GRID;
```

`src/shared/sectionLanes.ts`: import `SECTION_MIN_H, SECTION_FOLDED_H` with `GRID`, and re-export both (`export { SECTION_MIN_H, SECTION_FOLDED_H };`) so the test bundle sees them. `SectionLane.folded` becomes:

```ts
  /** - ids of the members hidden by a fold; present (even empty) → folded, range = SECTION_FOLDED_H */
  folded?: string[];
```

Add after `laneIndexForY`:

```ts
/** node id → index of the lane that pins it (its `folded` list). Expects sorted lanes. */
export function pinnedLaneIndex(sorted: SectionLane[]): Map<string, number> {
  const m = new Map<string, number>();
  sorted.forEach((l, i) => { for (const id of l.folded ?? []) m.set(id, i); });
  return m;
}

/** The lane owning a node: the one that pins it, else the one whose range holds its top edge. */
export function laneIndexForNode(sorted: SectionLane[], node: { id: string; y: number }, pinned: Map<string, number>): number {
  return pinned.get(node.id) ?? laneIndexForY(sorted, node.y);
}
```

`deriveLanes` becomes:

```ts
export function deriveLanes(nodes: LaneNodeGeom[], lanes: SectionLane[]): DerivedLane[] {
  if (lanes.length === 0) return [];
  const sorted = sortLanes(lanes);
  const pinned = pinnedLaneIndex(sorted);
  const members: string[][] = sorted.map(() => []);
  const maxY: number[] = sorted.map(() => -Infinity);

  for (const n of nodes) {
    const i = laneIndexForNode(sorted, n, pinned);
    members[i].push(n.id);
    // - hidden (pinned) members count for nothing in a lane's content
    if (!pinned.has(n.id) && n.y + n.height > maxY[i]) maxY[i] = n.y + n.height;
  }

  return sorted.map((l, i) => {
    const next = sorted[i + 1];
    const has = maxY[i] > -Infinity;
    // - a bounded lane ends where the next begins; a folded last lane is one grid; otherwise the
    //   last lane follows its visible content
    const bottom = next ? next.y : l.folded ? l.y + SECTION_FOLDED_H : (has ? maxY[i] : l.y) + LANE_BOTTOM_PAD;
    return { ...l, label: `S${i + 1}`, index: i, memberIds: members[i], top: l.y, bottom };
  });
}
```

`memberCodeCellsInRunOrder` already goes through `deriveLanes(...).memberIds`, so pinned cells are included — verify, no change expected.

`migrateSections`: add `const hasLegacyFold = !!existing?.some(l => (l as { folded?: unknown }).folded === true);` to the early-return condition (`… && !hasLegacyFold`), and when building `stripped`, convert: for a lane with `folded === true`, `folded` = the ids of `canvas.nodes` whose `laneIndexForY(sortedExisting, n.y)` is that lane's index (compute `sortedExisting = sortLanes(existing)` once; ignore `colorIndex` while doing it). The legacy section-node conversion (`if (s.folded) lane.folded = true;`) becomes `if (s.folded) lane.folded = [];` (its members are unknown at that point; an empty list is a folded, empty range — acceptable for a five-month-old format).

- [x] **Step 4: Run the tests** — 33 + 4 pass (older tests still hold: `folded` was only read as truthy). Fix `test/section-lanes.mjs` if any old test set `folded: true` on a lane — replace with `folded: []`. `npm run typecheck`: `CanvasView.tsx` `{ ...l, folded: !l.folded }` and `RailSegment`/`SegmentMenu` `folded` booleans will now error — expected; they are fixed in Task 4. Note the errors, do not fix them here.

- [x] **Step 5: Commit**

```bash
git add src/shared/constants.ts src/shared/sectionLanes.ts
git commit -m "feat: pinned membership — a fold lists its hidden members; SECTION_MIN_H and SECTION_FOLDED_H"
```

---

### Task 2: `fitLanes` / `applyLaneFit` / `sectionTargetHeight` / `pinOutputToLane` (pure)

**Files:**
- Modify: `src/shared/sectionLanes.ts` — replace `growLaneForNodes` and `applyLaneGrowth`
- Test: `test/section-lanes.mjs` — replace the `growLaneForNodes` / `applyLaneGrowth` tests

- [x] **Step 1: Write the failing tests** — delete every `test('growLaneForNodes…` and `test('applyLaneGrowth…` case and the corresponding imports; add `fitLanes, applyLaneFit, sectionTargetHeight, pinOutputToLane` to the import; append:

```js
test('fitLanes: an empty middle lane grows to SECTION_MIN_H; the last lane never moves', () => {
  const lanes = [lane('a', 0), lane('b', 100), lane('c', 100 + SECTION_MIN_H)];
  const f = fitLanes(lanes, [node('n1', 0), node('n3', 100 + SECTION_MIN_H)]);
  assert.deepEqual(f.laneShifts, { b: SECTION_MIN_H - 100, c: SECTION_MIN_H - 100 });
  assert.deepEqual(f.nodeShifts, { n3: SECTION_MIN_H - 100 });
});

test('fitLanes: content taller than the minimum → content + GRID, snapped up', () => {
  const lanes = [lane('a', 0), lane('b', SECTION_MIN_H)];
  const f = fitLanes(lanes, [node('n1', 0, 950)]);   // - 950 + 100 = 1050 → 1100
  assert.deepEqual(f.laneShifts, { b: 1100 - SECTION_MIN_H });
});

test('fitLanes: slack shrinks the lane back, snapped, and everything below moves up', () => {
  const lanes = [lane('a', 0), lane('b', 2000), lane('c', 3000)];
  const nodes = [node('n1', 0, 300), node('n2', 2000, 900), node('n3', 3000)];   // - a needs max(800, 400) = 800 → −1200; b: 900 + 100 = 1000 = its range
  const f = fitLanes(lanes, nodes);
  assert.deepEqual(f.laneShifts, { b: -1200, c: -1200 });
  assert.deepEqual(f.nodeShifts, { n2: -1200, n3: -1200 });
});

test('fitLanes: a folded lane is SECTION_FOLDED_H; its pinned members are ignored and move with it', () => {
  const lanes = [lane('a', 0), lane('b', SECTION_MIN_H, { folded: ['h1'] }), lane('c', SECTION_MIN_H + 2000)];
  const nodes = [node('n1', 0), node('h1', SECTION_MIN_H + 500, 300), node('n3', SECTION_MIN_H + 2000)];
  const f = fitLanes(lanes, nodes);
  assert.deepEqual(f.laneShifts, { c: SECTION_FOLDED_H - 2000 });
  assert.deepEqual(f.nodeShifts, { n3: SECTION_FOLDED_H - 2000 });   // - h1 stays: its lane b did not move
  const g = fitLanes([lane('a', 0), lane('b', 100, { folded: ['h1'] })], [node('n1', 0, 950), node('h1', 400)]);
  assert.deepEqual(g.nodeShifts, { h1: 1000 });   // - a grows to 1100: b and its pinned member move together
});

test('fitLanes is idempotent after one application', () => {
  const canvas = { nodes: [node('n1', 0, 950), node('n2', 2000), node('n3', 3000)], edges: [], metadata: { sections: [lane('a', 0), lane('b', 2000), lane('c', 3000)] } };
  const once = applyLaneFit(canvas);
  assert.notEqual(once, canvas);
  assert.equal(applyLaneFit(once), once);
  assert.equal(once.metadata.sections[1].y, 1100);
  assert.equal(once.nodes.find(n => n.id === 'n2').y, 1100);
});

test('sectionTargetHeight: minimum, content, folded', () => {
  assert.equal(sectionTargetHeight(lane('a', 0), [node('n1', 0)]), SECTION_MIN_H);
  assert.equal(sectionTargetHeight(lane('a', 0), [node('n1', 0, 950)]), 1100);
  assert.equal(sectionTargetHeight(lane('a', 0, { folded: ['n1'] }), [node('n1', 0, 950)]), SECTION_FOLDED_H);
});

test('pinOutputToLane: an output of a pinned cell is pinned too; otherwise untouched', () => {
  const lanes = [lane('a', 0, { folded: ['E1'] }), lane('b', 100)];
  assert.deepEqual(pinOutputToLane(lanes, 'E1', 'O1')[0].folded, ['E1', 'O1']);
  assert.equal(pinOutputToLane(lanes, 'E2', 'O2'), lanes);
});
```

- [x] **Step 2: Run to verify they fail** (import error).

- [x] **Step 3: Implementation** — replace `growLaneForNodes` and `applyLaneGrowth` (keep the `LaneGrowth` interface; update its doc: shifts may be negative) with:

```ts
/** Range a lane wants: one grid when folded; else its visible content plus a gap, never under the minimum. */
export function sectionTargetHeight(l: SectionLane, members: LaneNodeGeom[]): number {
  if (l.folded) return SECTION_FOLDED_H;
  let contentBottom = l.y;
  for (const n of members) if (n.y + n.height > contentBottom) contentBottom = n.y + n.height;
  const raw = Math.max(SECTION_MIN_H, contentBottom + GRID - l.y);
  return Math.ceil(raw / GRID) * GRID;
}

/**
 * Fit every lane but the last to its content: a lane taller than its target shrinks, a shorter one
 * grows; the difference moves every lane below and that lane's members (pinned members travel with
 * their lane). Pure; the caller applies the shifts. Idempotent after one application.
 */
export function fitLanes(lanes: SectionLane[], nodes: LaneNodeGeom[]): LaneGrowth {
  const empty: LaneGrowth = { laneShifts: {}, nodeShifts: {} };
  const sorted = sortLanes(lanes);
  if (sorted.length < 2) return empty;
  const pinned = pinnedLaneIndex(sorted);
  const visible: LaneNodeGeom[][] = sorted.map(() => []);
  const laneOf = new Map<string, number>();
  for (const n of nodes) {
    const i = laneIndexForNode(sorted, n, pinned);
    laneOf.set(n.id, i);
    if (!pinned.has(n.id)) visible[i].push(n);
  }

  const laneShifts: Record<string, number> = {};
  let acc = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const range = sorted[i + 1].y - sorted[i].y;
    acc += sectionTargetHeight(sorted[i], visible[i]) - range;
    if (acc !== 0) laneShifts[sorted[i + 1].id] = acc;
  }
  if (Object.keys(laneShifts).length === 0) return empty;

  const nodeShifts: Record<string, number> = {};
  for (const n of nodes) {
    const s = laneShifts[sorted[laneOf.get(n.id) ?? 0].id];
    if (s) nodeShifts[n.id] = s;
  }
  return { laneShifts, nodeShifts };
}

/** Apply `fitLanes` to a canvas. Same reference when nothing moves (no spurious save). */
export function applyLaneFit(canvas: CanvasData): CanvasData {
  const lanes = canvas.metadata?.sections ?? [];
  const f = fitLanes(lanes, canvas.nodes);
  if (Object.keys(f.laneShifts).length === 0) return canvas;
  return {
    ...canvas,
    nodes: canvas.nodes.map(n => (f.nodeShifts[n.id] ? { ...n, y: n.y + f.nodeShifts[n.id] } : n)),
    metadata: { ...canvas.metadata, sections: sortLanes(lanes).map(l => (f.laneShifts[l.id] ? { ...l, y: l.y + f.laneShifts[l.id] } : l)) },
  };
}

/** A run's output cell for a pinned (folded) code cell is pinned to the same lane. Same reference otherwise. */
export function pinOutputToLane(lanes: SectionLane[], codeId: string, outId: string): SectionLane[] {
  const i = lanes.findIndex(l => l.folded?.includes(codeId));
  if (i < 0 || lanes[i].folded?.includes(outId)) return lanes;
  return lanes.map((l, k) => (k === i ? { ...l, folded: [...(l.folded ?? []), outId] } : l));
}
```

- [x] **Step 4: Run the tests** — expect all pass (count: previous minus the removed growth/applyLaneGrowth cases plus 7). `npm run typecheck` will now fail on the callers of the removed functions (MCP, host, hook) — expected; fixed in Task 3.

- [x] **Step 5: Commit**

```bash
git add src/shared/sectionLanes.ts
git commit -m "feat: fitLanes — sections grow and shrink to their content with a minimum height; folded lanes collapse to one grid"
```

---

### Task 3: the three appliers use `fitLanes`

**Files:**
- Rename: `src/webview/rail/useLaneGrowth.ts` → `src/webview/rail/useLaneFit.ts`
- Modify: `src/webview/canvas/CanvasView.tsx` (`applyGrowth` → `applyFit`, the hook call, the `+` handler)
- Modify: `src/extension/mcp/server.ts` (5 sites), `src/extension/editor-provider.ts` (3 sites + pinning)

- [x] **Step 1: the hook** — `git mv src/webview/rail/useLaneGrowth.ts src/webview/rail/useLaneFit.ts`; contents:

```ts
import { useEffect, type MutableRefObject } from 'react';
import type { Node } from '@xyflow/react';
import { fitLanes, type LaneGrowth, type SectionLane } from '../../shared/sectionLanes';

const geomOf = (n: Node) => ({
  id: n.id, x: n.position.x, y: n.position.y,
  width: Number(n.width ?? n.style?.width ?? 0), height: Number(n.height ?? n.style?.height ?? 0),
});

/**
 * After any node or lane change that is not part of an in-progress drag or resize, fits every
 * section to its content and hands the shifts to `apply`. The shifted state comes back through this
 * effect once more and fits with no shifts, so it settles in one extra pass.
 */
export function useLaneFit(nodes: Node[], lanes: SectionLane[], dragging: MutableRefObject<boolean>, skipOnce: MutableRefObject<boolean>, apply: (f: LaneGrowth) => void): void {
  useEffect(() => {
    if (dragging.current || nodes.some(n => n.resizing)) return;   // - mid-gesture: the end state is fitted
    if (skipOnce.current) { skipOnce.current = false; return; }    // - a state restored by undo/redo is taken as is
    const f = fitLanes(lanes, nodes.map(geomOf));
    if (Object.keys(f.laneShifts).length) apply(f);
  }, [nodes, lanes, dragging, skipOnce, apply]);
}
```

- [x] **Step 2: CanvasView** — import `useLaneFit` (not `useLaneGrowth`), `fitLanes`-adjacent `sectionTargetHeight`; rename `applyGrowth` → `applyFit` (body unchanged; comment: `// - fit every section to its content: shifts below may be up or down. No history entry of its own — the action that changed the geometry pushed one`); `useLaneFit(nodes, lanes, draggingRef, fromHistoryRef, applyFit)`. The `skena:newSection` handler: `const flowY = last ? last.top + sectionTargetHeight(last, visibleMembersOf(last)) : 0;` where the visible members are `nodes` (mapped through the same `geomOf` shape as `derivedLanes` uses) filtered to `last.memberIds` minus `last.folded ?? []` — write a tiny local helper next to the handler.

- [x] **Step 3: MCP** — `src/extension/mcp/server.ts`: import `applyLaneFit` instead of `applyLaneGrowth`; the five `Object.assign(d, applyLaneGrowth(d, […]))` become `Object.assign(d, applyLaneFit(d));` (the `changed` collection in `canvas_layout` goes; keep the comment's meaning: "every write fits the sections"). In `runCellCore`'s `!hostOwns` output branch and in `canvasPinOutput`, before the fit: `d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata?.sections ?? [], cell.id, outId) };` (only when sections exist; use the code cell's id and the new output id).

- [x] **Step 4: Host** — `src/extension/editor-provider.ts`: import `applyLaneFit, pinOutputToLane`; the three `Object.assign(c, applyLaneGrowth(c, [outputNode.id]))` become: `c.metadata = { ...c.metadata, sections: pinOutputToLane(c.metadata?.sections ?? [], cn.id, outputNode.id) }; Object.assign(c, applyLaneFit(c));` (keep the existing "c IS document.canvas" comments).

- [x] **Step 5: Typecheck + build + tests** — `npm run typecheck`: only the `folded` boolean errors in `CanvasView.tsx` / `RailSegment.tsx` / `SegmentMenu.tsx` may remain (Task 4) — list them; everything else clean. `npm run build` may fail on those — if so, do Task 4 before building and commit both together.

- [x] **Step 6: Commit**

```bash
git add src/webview/rail/useLaneFit.ts src/webview/canvas/CanvasView.tsx src/extension/mcp/server.ts src/extension/editor-provider.ts
git commit -m "feat: every applier fits sections (grow and shrink) instead of growing only; outputs of folded cells stay folded"
```

---

### Task 4: fold collapses — the webview sets the member list

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` (`hiddenByFold`, `handleFoldLane`)
- Modify: `src/webview/rail/RailSegment.tsx`, `src/webview/rail/SegmentMenu.tsx`, `src/webview/rail/SectionRail.tsx` (folded booleans)

- [x] **Step 1: CanvasView** — `hiddenByFold`: `for (const l of derivedLanes) for (const id of l.folded ?? []) ids.add(id);` (the list, not `memberIds`). `handleFoldLane`:

```ts
  const handleFoldLane = useCallback((id: string) => {
    const target = derivedLanes.find(l => l.id === id);
    if (!target) return;
    pushHistory();
    // - fold pins the visible members and collapses the range (the fit hook moves everything below up);
    //   unfold releases them and the fit expands the range again
    commitLanes(lanes.map(l => (l.id === id ? { ...l, folded: l.folded ? undefined : target.memberIds.filter(m => !(l.folded ?? []).includes(m)) } : l)));
  }, [derivedLanes, lanes, commitLanes, pushHistory]);
```

(`{ ...l, folded: undefined }` leaves an own key; `JSON.stringify` drops it — same pattern as `kernelId`.)

- [x] **Step 1b: prune and polish** — in `CanvasView.tsx`'s node-delete path (`onNodesDelete` / the history-free delete that filters `canvasRef.current.nodes`) also drop the deleted ids from every lane's `folded` list via `commitLanes` when any list changes. In `RailSegment.tsx`: the tooltip ends `· right-click for the menu` instead of `· double-click the title to rename`; `onContextMenu` uses the existing `anchor(e)` helper. In `sectionLanes.ts` `migrateSections`: the legacy-fold member scan skips `type: 'section'` nodes.

- [x] **Step 2: rail files** — wherever `lane.folded` is used as a boolean (`RailSegment.tsx` tooltip/opacity/chevron, `SegmentMenu` `folded` prop from `SectionRail`), use `!!lane.folded`; `Chevron folded={!!lane.folded}` already coerces — check each.

- [x] **Step 3: Typecheck + build** — clean (3 pre-existing). Manual reasoning check: fold S2 → its members hidden and listed; `derivedLanes` gives S2 `bottom = S3.y` still → the hook fits: S2 target = 100 → S3 and below move up by (range − 100); unfold → list cleared → target = content → S3 moves down. Undo of a fold: history restored lanes (list cleared) + nodes → `skipOnce` prevents a re-fit on that render, and the next real change re-fits consistently.

- [x] **Step 4: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx src/webview/rail/RailSegment.tsx src/webview/rail/SegmentMenu.tsx src/webview/rail/SectionRail.tsx
git commit -m "feat: fold collapses a section to one grid; its members stay hidden and pinned; unfold expands it again"
```

---

### Task 5: verification

- [x] All suites: section-lanes, bounds, kernel-binding, kernel-upstream, rail-geometry → `# fail 0`.
- [x] `npm run typecheck` (3 pre-existing), `npm run build`, `npm run package` → `skena-0.17.2.vsix` after bumping `package.json` to `0.17.2` (commit `chore: bump to 0.17.2 (section fit, collapsing fold, rail follow-ups)`).
- [ ] Manual (user): an empty middle section is 800 tall; drag a node down past the edge → grows; drag it back → shrinks after the drop, never under 800; fold → collapses to one grid and everything below moves up; unfold → back; run section on a folded section still runs its cells and their outputs stay hidden; reload → all of it survives; `+` lands the new section right under the previous one's fitted range.

---

## Self-review

Spec §4 → Tasks 2–3 (`fitLanes`, appliers, `+`); §5 → Tasks 1, 4 (pinned membership, list, migration, hiddenByFold); §6 tests → Tasks 1–2. `LaneGrowth` keeps its name to limit churn (documented). Types: `fitLanes(lanes, nodes): LaneGrowth`, `applyLaneFit(canvas)`, `sectionTargetHeight(lane, members)`, `pinOutputToLane(lanes, codeId, outId)`, `laneIndexForNode(sorted, node, pinned)`, `pinnedLaneIndex(sorted)` — used consistently across tasks.
