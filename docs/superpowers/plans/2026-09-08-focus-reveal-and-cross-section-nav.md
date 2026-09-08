# Focus reveals the output; `j`/`k` cross sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-09-03-section-rail-followups-design.md` §8 — keyboard focus and a plain click pan just enough to show the node plus its output when the pair fits; `j`/`k` may land in another open section; `h`/`l` stay in the section.

**Architecture:** Two pure functions in a new `src/webview/canvas/spatialNav.ts` (`findNearestNode`, `revealPan`) replace the inline `findNearest` and the pan arithmetic of `focusNodeById` in `CanvasView.tsx`. `CanvasView` maps its refs into them; `onNodeClick` calls the same `revealNode`. The usable area is the React Flow pane (`wrapperRef` rect), chat rect converted into pane coordinates. Also folds in four minors from the batch-1 review.

**Tech Stack:** TypeScript, React Flow, esbuild bundles + `node --test` (pattern: `test/rail-geometry.mjs`).

---

### Task 1: `spatialNav.ts` + tests

**Files:**
- Create: `src/webview/canvas/spatialNav.ts`
- Test: `test/spatial-nav.mjs` (gitignored — never staged)

- [ ] **Step 1: write the module**

```ts
import { laneIndexForNode, pinnedLaneIndex, sortLanes, type SectionLane } from '../../shared/sectionLanes';

export type NavDir = 'left' | 'right' | 'up' | 'down';
export interface NavNode { id: string; x: number; y: number; w: number; h: number }
export interface NavEdge { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
export interface NavContext { nodes: NavNode[]; edges: NavEdge[]; lanes: SectionLane[] }

// - primary-axis displacement must be ≥ CONE × the perpendicular one (~59° half-cone)
const CONE = 0.6;
// - ranking inside the cone: aligned beats near
const CROSS_WEIGHT = 2.5;

const centre = (n: NavNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/**
 * The node to focus when `dir` is pressed on `from`, or null when nothing qualifies.
 * Candidates are visible nodes (in no fold list). `left`/`right` stay in `from`'s section;
 * `up`/`down` may cross into any open section. An edge attached on the pressed side wins over
 * geometry, under the same exclusions.
 */
export function findNearestNode(from: NavNode, dir: NavDir, ctx: NavContext): string | null {
  const horiz = dir === 'left' || dir === 'right';
  const sorted = sortLanes(ctx.lanes);
  const pinned = pinnedLaneIndex(sorted);
  const laneOf = (n: NavNode) => (sorted.length ? laneIndexForNode(sorted, { id: n.id, y: n.y }, pinned) : -1);
  const fromLane = laneOf(from);
  const reachable = (n: NavNode) => !pinned.has(n.id) && (!horiz || laneOf(n) === fromLane);
  const fc = centre(from);
  const inDir = (dx: number, dy: number) =>
    dir === 'left' ? dx < 0 : dir === 'right' ? dx > 0 : dir === 'up' ? dy < 0 : dy > 0;
  const inCone = (dx: number, dy: number) =>
    horiz ? Math.abs(dx) >= Math.abs(dy) * CONE : Math.abs(dy) >= Math.abs(dx) * CONE;
  const score = (dx: number, dy: number) =>
    horiz ? Math.abs(dx) + Math.abs(dy) * CROSS_WEIGHT : Math.abs(dy) + Math.abs(dx) * CROSS_WEIGHT;

  const side = dir === 'up' ? 'top' : dir === 'down' ? 'bottom' : dir;
  const byId = new Map(ctx.nodes.map(n => [n.id, n] as const));
  let best: string | null = null;
  let bestScore = Infinity;
  for (const e of ctx.edges) {
    const nid = e.source === from.id && e.sourceHandle === side ? e.target
      : e.target === from.id && e.targetHandle === side ? e.source : null;
    if (!nid) continue;
    const n = byId.get(nid);
    if (!n || !reachable(n)) continue;
    const c = centre(n);
    const s = score(c.x - fc.x, c.y - fc.y);
    if (s < bestScore) { bestScore = s; best = nid; }
  }
  if (best) return best;

  for (const n of ctx.nodes) {
    if (n.id === from.id || !reachable(n)) continue;
    const c = centre(n);
    const dx = c.x - fc.x, dy = c.y - fc.y;
    if (!inDir(dx, dy) || !inCone(dx, dy)) continue;
    const s = score(dx, dy);
    if (s < bestScore) { bestScore = s; best = n.id; }
  }
  return best;
}

export interface Box { x1: number; y1: number; x2: number; y2: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Viewport { x: number; y: number; zoom: number }

export const REVEAL_MARGIN = 24;

/**
 * The smallest pan that shows `node` — or `pair` (node + output) when that box fits inside `area`
 * at the current zoom — with `margin` px kept clear. Null when nothing has to move. Zoom is kept;
 * a box wider/taller than the area is aligned on its left/top edge.
 * `node`/`pair` are flow coordinates; `area` and the result are pane pixels.
 */
export function revealPan(node: Box, pair: Box | null, area: Rect, vp: Viewport, margin = REVEAL_MARGIN): { x: number; y: number } | null {
  const usableW = area.right - area.left - 2 * margin;
  const usableH = area.bottom - area.top - 2 * margin;
  const fits = (b: Box) => (b.x2 - b.x1) * vp.zoom <= usableW && (b.y2 - b.y1) * vp.zoom <= usableH;
  const box = pair && fits(pair) ? pair : node;
  const sx1 = box.x1 * vp.zoom + vp.x, sy1 = box.y1 * vp.zoom + vp.y;
  const sx2 = box.x2 * vp.zoom + vp.x, sy2 = box.y2 * vp.zoom + vp.y;
  let dx = 0, dy = 0;
  if (sx1 < area.left + margin) dx = area.left + margin - sx1;
  else if (sx2 > area.right - margin) dx = area.right - margin - sx2;
  if (sy1 < area.top + margin) dy = area.top + margin - sy1;
  else if (sy2 > area.bottom - margin) dy = area.bottom - margin - sy2;
  if (dx === 0 && dy === 0) return null;
  return { x: vp.x + dx, y: vp.y + dy };
}
```

- [ ] **Step 2: tests** (`test/spatial-nav.mjs`, header comment with the esbuild command as in `test/rail-geometry.mjs`; bundle to `test/.build/spatialNav.mjs`)

Fixtures: `GRID = 100`; lanes `S1 @0`, `S2 @1600`, `S3 @3200` (`{ id, y, createdAt: 1 }`); nodes 700×300: `a` (100, 200) in S1, `b` (100, 1700) in S2, `c` (100, 3300) in S3, `r` (1000, 1700) in S2 (right of `b`'s row, same y as `b`).

Cases (each an exact `assert.equal`):
1. `down` from `a` → `b` (crosses into S2).
2. S2 folded (`folded: ['b']`): `down` from `a` → `c` (the folded section is passed over).
3. S2 and S3 folded: `down` from `a` → `null`.
4. `right` from `a` with `r` present → `null` (another section, horizontal stays put).
5. `right` from `b` → `r` (same section).
6. edge `a` bottom → `b`, S2 folded → `c` (edge into a folded node not followed; cone fallback).
7. edge `a` right → `r` (other section): `right` → `null`; edge `a` bottom → `r`: `down` → `r`.
8. `up` from `c` with S2 open → `b`; with S2 folded → `a`.
9. no lanes at all: `down` from `a` → `b`.
10. `revealPan`: area `{0,0,1000,600}`, zoom 1, vp `(0,0)`, node `{100,100,460,300}`, pair `null` → `null`.
11. pair fits and its output is off the right edge: area `{0,0,1000,600}`, node `{100,100,460,300}`, pair `{100,40,960,360}`, vp `(0,0)` → box right edge 960 > 976? no → `null`; vp `(100,0)` → sx2 = 1060 → `{ x: 100 + (976 − 1060) = 16, y: 0 }`.
12. pair does not fit (pair `{100,40,1500,360}`, area width 1000) and node visible → `null`.
13. node off-screen left (vp `(-500,0)`), pair fits → pan computed on the pair: `{ x: -500 + (24 − (100 − 500)) = -76, y: 0 }`.
14. node off-screen and pair too wide → pan on the node: same vp, pair `{100,40,1500,360}` → `{ x: -76, y: 0 }` (node's left edge also at 100).
15. zoom 0.5 changes the fit: pair `{100,40,1500,360}` at zoom 0.5 is 700 px wide → fits; vp `(300,0)`: sx2 = 1500·0.5 + 300 = 1050 > 976 → `{ x: 226, y: 0 }`.
16. margin: pane area with `left: 44` (rail) — node `{0,100,360,300}` vp `(0,0)`: sx1 = 0 < 68 → `{ x: 68, y: 0 }`.

- [ ] **Step 3: run** `npx esbuild src/webview/canvas/spatialNav.ts --bundle --format=esm --outfile=test/.build/spatialNav.mjs && node --test test/spatial-nav.mjs` → all pass.

- [ ] **Step 4: commit** `src/webview/canvas/spatialNav.ts` only (`test/` is gitignored): `feat: pure spatial-nav helpers — findNearestNode (j/k cross open sections) and revealPan (node+output when the pair fits)`

### Task 2: wire `CanvasView.tsx`; click; pane area; review minors

**Files:** Modify `src/webview/canvas/CanvasView.tsx`, `src/webview/rail/SectionRail.tsx`, `src/shared/sectionLanes.ts`, `src/extension/mcp/server.ts`, `src/extension/editor-provider.ts`.

- [ ] **Step 1: `revealNode`.** Split `focusNodeById` (≈`:1358-1427`): a new `revealNode(id, forceCenter = false)` `useCallback([])` holds the pan; `focusNodeById` = `lastFocusedNodeId.set` + `setNodes(select)` + `skena:focusNode` dispatch + `revealNode(id, forceCenter)`. Inside `revealNode`:
  - `area = paneArea()` — a helper (plain function inside the component, or a module function taking the wrapper element) returning the pane rect in pane pixels: `{ left: 0, top: 0, right: rect.width, bottom: rect.height }` from `wrapperRef.current.getBoundingClientRect()` (fallback `window.innerWidth/Height` when the ref is null), then the existing chat-dock test with the chat rect shifted by `−rect.left / −rect.top`. Move the `wrapperRef` declaration (≈`:2639`) up beside `rfRef` so it is declared before use.
  - `node` box from `position` + `style.width/height` (defaults 200/150 as today); `pair` = the union with the `outputNodeId` node when found, else `null`.
  - `forceCenter`: keep today's centre + zoom-to-fit branch, but use `area` for the available size.
  - otherwise `const p = revealPan(nodeBox, pairBox, area, rfRef.current.getViewport())`; if `p`, `clampCam(p.x, p.y, zoom)` then `setViewport(..., { duration: 250 })`.
  - delete the old inline `nodeInside` / `fitsBox` / `dx,dy` arithmetic and the "FOCUSED NODE ALONE" comment; the new rule is in §8.2.
- [ ] **Step 2: `findNearest` → `findNearestNode`.** In the keyboard effect, replace the inline `findNearest` (≈`:1809-1880`) with `findNearestNode(toNav(current), dir, { nodes: nodesRef.current.filter(n => !isBandType(n.type)).map(toNav), edges: edgesRef.current, lanes: lanesRef.current })` where `toNav(n) = { id, x: position.x, y: position.y, w: Number(style?.width ?? 200), h: Number(style?.height ?? 150) }`. Delete `hiddenByFoldRef` and its effect (≈`:764-765`) — `findNearestNode` derives hidden ids from the lanes (review minor 1). `centerOf` stays only if something else uses it.
- [ ] **Step 3: click.** `<ReactFlow … onNodeClick={onNodeClick}>` with `const onNodeClick = useCallback((e: React.MouseEvent, n: Node) => { if (e.shiftKey || e.ctrlKey || e.metaKey || isBandType(n.type)) return; revealNode(n.id); }, [revealNode]);`
- [ ] **Step 4: minors.** `SectionRail.tsx:76` → `const runnable = kernel !== null;` (minor 2). `sectionLanes.ts` `applyLaneFit(canvas, now: number)` — required, no default; every caller passes `Date.now()` (`mcp/server.ts` 6 sites, `editor-provider.ts` 3 sites; `test/section-lanes.mjs` already passes it) (minor 3). Seed at `CanvasView` ≈`:2918`: `const now = Date.now();` once for id and `createdAt` (minor 5).
- [ ] **Step 5: verify.** `npm run typecheck` (only the 3 pre-existing `fsPath` errors in `editor-provider.ts:461-463`), `npm run build`, all suites: rail-geometry 13, section-lanes 41, bounds 10, kernel-binding 19, kernel-upstream 12, spatial-nav (Task 1 count).
- [ ] **Step 6: commit** (no trailer): `fix: focus and a plain click pan to show the node with its output when the pair fits; j/k cross into open sections; the pan uses the pane, not the window`

### Task 3: bump + package

- [ ] `package.json` version `0.17.5`; `npm run package` → `skena-0.17.5.vsix`; commit `chore: bump to 0.17.5 (focus reveals the output; j/k cross sections)`.
