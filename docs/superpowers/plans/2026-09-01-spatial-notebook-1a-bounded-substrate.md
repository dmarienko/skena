# Spatial Notebook 1a — Bounded Canvas + Origin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the canvas a hard top-left origin — it grows right + down only, existing canvases authored in negative space normalize to the origin when opened, and a `Home` key pans the camera back to the origin keeping the current zoom.

**Architecture:** One new pure module (`src/shared/bounds.ts`) holds the origin constant and two pure transforms (`clampToOrigin`, `normalizeCanvasToOrigin`), unit-tested in isolation. The host applies `normalizeCanvasToOrigin` once on each load, right before it posts `canvasLoaded` (no write-on-open — disk is fixed lazily on the next natural save, avoiding the watcher race that caused the earlier data loss). The webview clamps node coordinates to the origin on drag and creation, bounds panning with React Flow's `translateExtent`, and binds `Home`.

**Tech Stack:** TypeScript, React Flow v12, esbuild, `node:test` (test files in `test/*.mjs`, bundled via esbuild to `test/.build/`; `test/` is gitignored, so commits carry only `src/`).

**Branch:** This is v1.x work; do NOT implement on `main`. Create/verify a feature branch (`feature/spatial-notebook`) or worktree before Task 1 (the sub-skill's git step handles this).

**Scope note:** This is Phase-1a of the spatial-notebook redesign (spec: `docs/superpowers/specs/2026-09-01-spatial-notebook-design.md`). It deliberately excludes sections, the packing engine, portrait slots and code/output auto-sizing — those are Phase-1b and depend on two unsettled data-model decisions (section representation; node→section membership). 1a is the foundation both stack on and needs neither decision.

**Typecheck baseline:** `npm run typecheck` currently reports 3 pre-existing errors in `src/extension/editor-provider.ts` (`fsPath` on `ResolvedNotion`, unrelated to this work). "Clean" below means: no NEW errors beyond those 3.

---

### Task 1: `src/shared/bounds.ts` — origin constant + pure transforms

**Files:**
- Create: `src/shared/bounds.ts`
- Test: `test/bounds.mjs` (gitignored; not committed)

- [ ] **Step 1: Write the failing test**

Create `test/bounds.mjs`:

```js
// - run: npx esbuild src/shared/bounds.ts --bundle --format=esm --outfile=test/.build/bounds.mjs && node --test test/bounds.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ORIGIN_GUTTER, clampToOrigin, normalizeCanvasToOrigin } from './.build/bounds.mjs';

test('clampToOrigin floors both axes at 0', () => {
  assert.deepEqual(clampToOrigin(-50, -10), { x: 0, y: 0 });
  assert.deepEqual(clampToOrigin(300, 20), { x: 300, y: 20 });
});

test('normalizeCanvasToOrigin shifts the min node corner to the gutter', () => {
  const canvas = { nodes: [
    { id: 'a', x: -5700, y: -300, width: 100, height: 100 },
    { id: 'b', x: -5600, y: 0,    width: 100, height: 100 },
  ], edges: [] };
  const out = normalizeCanvasToOrigin(canvas);
  assert.equal(Math.min(...out.nodes.map(n => n.x)), ORIGIN_GUTTER);
  assert.equal(Math.min(...out.nodes.map(n => n.y)), ORIGIN_GUTTER);
  // - relative geometry preserved
  assert.equal(out.nodes[1].x - out.nodes[0].x, 100);
});

test('normalizeCanvasToOrigin is idempotent — same ref when already at the gutter', () => {
  const canvas = { nodes: [{ id: 'a', x: ORIGIN_GUTTER, y: ORIGIN_GUTTER, width: 10, height: 10 }], edges: [] };
  assert.equal(normalizeCanvasToOrigin(canvas), canvas);   // - same reference → triggers no save
});

test('normalizeCanvasToOrigin shifts the saved viewport so framing is preserved', () => {
  const canvas = { nodes: [{ id: 'a', x: -100, y: -100, width: 10, height: 10 }], edges: [],
    viewport: { x: 0, y: 0, zoom: 2 } };
  const out = normalizeCanvasToOrigin(canvas);
  // - dx = ORIGIN_GUTTER - (-100) = 200; viewport.x -= dx*zoom = -400
  assert.equal(out.viewport.x, 0 - 200 * 2);
  assert.equal(out.viewport.y, 0 - 200 * 2);
});

test('normalizeCanvasToOrigin leaves an empty canvas untouched', () => {
  const canvas = { nodes: [], edges: [] };
  assert.equal(normalizeCanvasToOrigin(canvas), canvas);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx esbuild src/shared/bounds.ts --bundle --format=esm --outfile=test/.build/bounds.mjs && node --test test/bounds.mjs`
Expected: FAIL — esbuild errors with `Could not resolve "src/shared/bounds.ts"` (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/shared/bounds.ts`:

```ts
/**
 * Bounded-canvas geometry. The spatial-notebook canvas has a hard top-left origin and grows
 * right + down only. These pure helpers keep node coordinates out of negative space and park an
 * opened canvas's content near the origin. Shared by the host (load-time migration) and the
 * webview (drag / creation clamp). No Node.js APIs — this file is bundled into both contexts.
 */

import { GRID } from './constants';
import type { CanvasData } from './types';

// - one empty slot between the origin (0,0) and the top-left node
export const ORIGIN_GUTTER = GRID;

// - keep a coordinate from crossing above/left of the origin
export function clampToOrigin(x: number, y: number): { x: number; y: number } {
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

/**
 * Shift every node so the top-left corner of the content's bounding box sits at the origin
 * gutter. Runs once when a canvas is opened, to migrate canvases authored in negative space
 * (e.g. live-slippage near x = -5700) into the bounded field. Idempotent: a canvas already at
 * the gutter is returned by the same reference, so it triggers no save. The saved viewport is
 * shifted with the content so the reopened framing is unchanged.
 */
export function normalizeCanvasToOrigin(canvas: CanvasData): CanvasData {
  if (canvas.nodes.length === 0) return canvas;
  let minX = Infinity;
  let minY = Infinity;
  for (const n of canvas.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  }
  const dx = ORIGIN_GUTTER - minX;
  const dy = ORIGIN_GUTTER - minY;
  if (dx === 0 && dy === 0) return canvas;
  const nodes = canvas.nodes.map(n => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const viewport = canvas.viewport
    ? {
        ...canvas.viewport,
        x: canvas.viewport.x - dx * canvas.viewport.zoom,
        y: canvas.viewport.y - dy * canvas.viewport.zoom,
      }
    : canvas.viewport;
  return { ...canvas, nodes, viewport };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx esbuild src/shared/bounds.ts --bundle --format=esm --outfile=test/.build/bounds.mjs && node --test test/bounds.mjs`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit** (src only — `test/` is gitignored)

```bash
git add src/shared/bounds.ts
git commit -m "feat: bounded-canvas origin helpers (clamp + normalize)"
```

---

### Task 2: Apply `normalizeCanvasToOrigin` on both host load paths

**Files:**
- Modify: `src/extension/editor-provider.ts` (import; first-load ~220-225; reload ~508-512)
- Modify: `src/extension/canvas-io.ts:34-42` (fix stale doc comment)

- [ ] **Step 1: Add the import**

At the top of `src/extension/editor-provider.ts`, alongside the existing shared imports, add:

```ts
import { normalizeCanvasToOrigin } from '../shared/bounds';
```

- [ ] **Step 2: Normalize on first load**

In the `webviewReady` handler, replace the block at ~lines 220-225:

```ts
            const [canvas, clipboardText] = await Promise.all([
              readCanvas(document.uri.fsPath),
              vscode.env.clipboard.readText(),
            ]);
            document.updateFromDisk(canvas);
            send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
```

with:

```ts
            const [rawCanvas, clipboardText] = await Promise.all([
              readCanvas(document.uri.fsPath),
              vscode.env.clipboard.readText(),
            ]);
            const canvas = normalizeCanvasToOrigin(rawCanvas);
            document.updateFromDisk(canvas);
            send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
```

- [ ] **Step 3: Normalize on reload**

In `reloadFromDisk` (~lines 508-512), replace:

```ts
      const canvas = await readCanvas(document.uri.fsPath);
      document.updateFromDisk(canvas);
      send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
```

with:

```ts
      const canvas = normalizeCanvasToOrigin(await readCanvas(document.uri.fsPath));
      document.updateFromDisk(canvas);
      send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath });
```

(The rest of `reloadFromDisk` reads `document.canvas.nodes`, which is now the normalized copy — no other change needed.)

- [ ] **Step 4: Fix the stale doc comment in canvas-io.ts**

In `src/extension/canvas-io.ts`, the doc block above `writeCanvas` (~lines 34-42) claims "Direct write (not atomic rename)" while the body actually does a temp+rename. Replace that doc block with:

```ts
/**
 * Write a .canvas file atomically. A reader (the file-watcher / webview) must never see a
 * truncated file: writeFile truncates then streams, so a concurrent read of this large .canvas
 * can catch it empty and the webview would take an empty reload. We write a PID+timestamp-named
 * temp sibling, then rename (atomic on the same filesystem), so readers only ever see the
 * complete old or complete new file. (The MCP server writes non-atomically on purpose — its
 * watcher reload needs IN_CLOSE_WRITE; the webview's empty-reload guard covers that rarer path.)
 */
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck`
Expected: only the 3 pre-existing `editor-provider.ts` `fsPath` errors (no new errors).

Run: `npm run build`
Expected: esbuild completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/extension/editor-provider.ts src/extension/canvas-io.ts
git commit -m "feat: normalize canvas to top-left origin on open"
```

---

### Task 3: Bound panning with `translateExtent`

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` (import; `<ReactFlow>` props ~2918-2960)

- [ ] **Step 1: Import the origin constant**

In `src/webview/canvas/CanvasView.tsx`, next to the existing `import { GRID, snapGrid } from '../../shared/grid';` line, add:

```tsx
import { ORIGIN_GUTTER, clampToOrigin } from '../../shared/bounds';
```

(`clampToOrigin` is used in Task 4; importing both here keeps the import block in one edit.)

- [ ] **Step 2: Add the `translateExtent` prop**

In the `<ReactFlow ...>` opening tag, immediately after the `maxZoom={3}` prop (~line 2956), add:

```tsx
        // - bounded canvas: pan stops one slot above/left of the origin, grows right + down
        translateExtent={[[-ORIGIN_GUTTER, -ORIGIN_GUTTER], [1e7, 1e7]]}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx
git commit -m "feat: bound canvas panning to the origin (translateExtent)"
```

---

### Task 4: Clamp node coordinates to the origin on drag + creation

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` — `patchCanvasNode` (~213-226), `findFreePosition` (~315-348), `customOnNodesChange` (~455-464)

- [ ] **Step 1: Clamp in `patchCanvasNode`**

Replace the body of `patchCanvasNode` (~lines 217-225) so the snapped position is clamped:

```ts
  const change = { id: rfNode.id, type: 'position', position: rfNode.position } as NodePositionChange;
  const { snapX, snapY } = getHelperLines(change, nodes);
  const c = clampToOrigin(
    snapX !== undefined ? snapX : snapGrid(rfNode.position.x),
    snapY !== undefined ? snapY : snapGrid(rfNode.position.y),
  );
  return {
    ...original,
    x:      Math.round(c.x),
    y:      Math.round(c.y),
    width:  Math.round(Number(rfNode.style?.width ?? original.width)),
    height: Math.round(Number(rfNode.style?.height ?? original.height)),
  };
```

- [ ] **Step 2: Clamp both returns of `findFreePosition`**

In `findFreePosition`, replace the early return (~line 325):

```ts
  if (pushX === 0 && pushY === 0) return { x: Math.round(x), y: Math.round(y) };
```

with:

```ts
  if (pushX === 0 && pushY === 0) {
    const c = clampToOrigin(x, y);
    return { x: Math.round(c.x), y: Math.round(c.y) };
  }
```

and replace the final return (~line 347):

```ts
  return { x: Math.round(x), y: Math.round(y) };
```

with:

```ts
  const c = clampToOrigin(x, y);
  return { x: Math.round(c.x), y: Math.round(c.y) };
```

- [ ] **Step 3: Clamp in `customOnNodesChange`**

In the drag branch, replace the primary + rest snap block (~lines 455-464):

```ts
        primary.position = {
          x: snapX !== undefined ? snapX : snapGrid(primary.position!.x),
          y: snapY !== undefined ? snapY : snapGrid(primary.position!.y),
        };
        for (let i = 1; i < posChanges.length; i++) {
          posChanges[i].position = {
            x: snapGrid(posChanges[i].position!.x),
            y: snapGrid(posChanges[i].position!.y),
          };
        }
```

with:

```ts
        primary.position = clampToOrigin(
          snapX !== undefined ? snapX : snapGrid(primary.position!.x),
          snapY !== undefined ? snapY : snapGrid(primary.position!.y),
        );
        for (let i = 1; i < posChanges.length; i++) {
          posChanges[i].position = clampToOrigin(
            snapGrid(posChanges[i].position!.x),
            snapGrid(posChanges[i].position!.y),
          );
        }
```

- [ ] **Step 4: Build + typecheck**

Run: `npm run build`
Expected: no errors.
Run: `npm run typecheck`
Expected: only the 3 pre-existing errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx
git commit -m "feat: clamp node coordinates to the origin on drag and creation"
```

**Deferred to Phase 1b (surfaced by the Task 4 code review; recorded per user decision):**
Two boundary interactions are left for 1b's packing engine — which subsumes this placement logic
via insert-and-reflow — rather than patched here as code 1b would discard:
- **Creation near the origin can overlap.** On a normalized canvas (top-left node at the gutter),
  an add-left / add-up whose raw position goes negative is floored by `clampToOrigin` and can
  overlap the source node. Correct behavior = insert into the packed layout and reflow existing
  nodes to open a slot (the "rearrange-on-add" decision). Owned by 1b.
- **Multi-select drag toward the origin distorts the group.** Each node clamps independently, so a
  member that reaches the wall sticks while the others keep moving; the distorted layout persists on
  drag-stop. 1b's drag-reflow ("drag to a new spot → layout recomputes to fit") owns this
  (rigid-body move or reflow).
The Task 4 clamp still correctly enforces the drag floor (no node lands in negative space); only
these two placement refinements are deferred.

---

### Task 5: `Home` key — pan the camera to the origin (keep zoom)

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx` — keydown handler, after the `Z` zoom block (~line 1746)

- [ ] **Step 1: Add the `Home` binding**

Immediately after the `Z` zoom-out block (which closes at ~line 1746 with `}`), insert:

```tsx
      // - Home: pan the camera to the origin gutter, keeping the current zoom (pan-only invariant)
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'Home') {
        e.preventDefault();
        const { zoom } = rfRef.current.getViewport();
        rfRef.current.setViewport(
          { x: 40 - ORIGIN_GUTTER * zoom, y: 40 - ORIGIN_GUTTER * zoom, zoom },
          { duration: 300 },
        );
        return;
      }
```

(This sits after the `inField` guard at ~line 1634, so it never fires while typing in Monaco/inputs. `Home` is a named key — it is not caught by `keyToDir` and collides with no vim single-char binding.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/canvas/CanvasView.tsx
git commit -m "feat: Home key pans the canvas to the origin"
```

---

### Task 6: Whole-plan verification (manual smoke)

**Files:** none (verification only)

- [ ] **Step 1: Package and install the VSIX, or run the dev host**

Run: `npm run build`
Expected: clean build. (For a full manual check, package with `npm run package` and install the VSIX, or launch the Extension Development Host.)

- [ ] **Step 2: Origin migration**

Open a canvas authored in negative space (`~/projects/quantkit/research/loe/live-slippage.canvas`, whose content sits near x = -5700).
Expected: on open, the content appears near the top-left origin (not off-screen far left); relative node layout unchanged.

- [ ] **Step 3: `Home` key**

Pan away from the origin, press `Home`.
Expected: the camera returns to the origin gutter; the zoom level does NOT change.

- [ ] **Step 4: Drag clamp**

Drag a node toward the top-left past the origin.
Expected: the node stops at the origin (x,y never go negative); panning stops one slot above/left of the origin (no infinite overscroll into negative space).

- [ ] **Step 5: No jump after an ordinary edge-drag (the fixed Critical)**

Drag the top-left node to x=0 (a legal grid position), save, then reopen the canvas — or trigger an
external reload (agent `canvas_add_node`, `git pull`).
Expected: the canvas does NOT jump; untouched nodes stay put. Normalize migrates only genuinely
negative-space content (`min < 0`), so content parked in `[0, gutter)` is left alone.

- [ ] **Step 6: Idempotence (no spurious churn)**

Open an already-normalized canvas, make no edits, close it.
Expected: no unexpected disk write from the open alone (normalize returned the same reference; only
genuine edits save).

---

## Post-review fix (final whole-branch review)

The holistic review caught a cross-task Critical the per-task passes could not: normalize parked the
min corner at the gutter (100) while the interactive floor was 0, so a node dragged to a legal x=0,
saved, then reloaded shifted the whole canvas (incl. untouched nodes) by 100. Fixed in commit
`96c95e6`: `normalizeCanvasToOrigin` now triggers **per-axis only on negative space** (`min < 0`) and
leaves content in `[0, gutter)` untouched — matching its stated purpose (migrate negative-space
canvases). Two regression tests added. The alternative (floor drags at the gutter, reserving it) is
a product change (**Option A**) left open for the user; not taken.

**Keyboard node-move clamp (found in live smoke).** `Shift+hjkl` on space-pinned nodes added `±GRID`
to x/y with no clamp, so a keyboard move could walk a node past the origin — the same invariant hole
as the drag path, just an uncovered path. Fixed in commit `85e5813`: both the on-screen and persisted
updates route through `clampToOrigin` (per-node; group-rigidity-at-the-wall stays a 1b packing
concern, like the drag case).

**Programmatic camera clamp + Home retarget (found in live smoke).** `translateExtent` bounds only
mouse panning; every programmatic camera move (`z`/`Z`, wheel zoom, `Shift+Alt+hjkl` pan, nav
focus-pan, `Home`, Shift+C / Alt+Shift+C center, add-node centering, and the load / `jumpToMark`
viewport restores) bypassed it and could reveal space above/left of the origin. Added
`clampViewportToOrigin(x,y,zoom)` (bounds.ts, capped at `ORIGIN_GUTTER*zoom`, 3 tests) and applied it
to all 12 `setViewport` sites (0 `setCenter` remain — the 3 were converted to clamped `setViewport`);
`Home` retargets to the content's top-left corner (no more flow-0 clipping). Commits `cdfc46b`,
`749684a`, `7f63559`, `8c1d089`. Design decision confirmed with the user: **keep the hard origin** —
never show unusable negative space (empty space only ever appears in the growable bottom-right).

**Known, accepted as-is (user, deferred to 1b nav/packing):** zooming in on a node that sits near the
origin can still clip it *even when it would fit* — the hard clamp fights per-node framing at the
corner. Real symptom (a fitting node cut off), not the unavoidable node-bigger-than-viewport case;
revisit when 1b rebuilds the viewport/nav layer.

Minor follow-ups (not blocking, from the reviews): MCP `server.ts:autoPlace` hardcodes `{x:100,y:100}`
— import `ORIGIN_GUTTER` instead so it can't drift; add a one-line comment on `tryFocusPending`'s
`readCanvas` marking it exempt from normalize (reads labels only, never posts `canvasLoaded`).

## Self-Review

**Spec coverage (§1-§2 of the design spec):**
- §2 bounded canvas — hard origin, grows right+down, one-slot gutter, hard clamp (no overscroll): Tasks 3 + 4.
- §2 migration — normalize canvases in negative space on open: Tasks 1 + 2.
- §2 `Home` key: Task 5.
- §1 slot grid / portrait slots / per-type slot-counts: **deferred to Phase-1b** (portrait slots are consumed by the packing engine + code auto-height). 1a retains the shipped square `GRID=100`. Called out in the Scope note.
- §3 sections, §4 packing engine, §1 code/output auto-size: **Phase-1b** (need the two data-model decisions). Not in this plan.

**Placeholder scan:** none — every code step shows complete code; every run step shows the exact command + expected result.

**Type consistency:** `ORIGIN_GUTTER: number`, `clampToOrigin(x, y) → {x, y}`, `normalizeCanvasToOrigin(canvas: CanvasData) → CanvasData` are used identically in bounds.ts (Task 1), editor-provider.ts (Task 2), and CanvasView.tsx (Tasks 3-5). `patchCanvasNode` still returns a `CanvasNode` with the same fields. React Flow's `setViewport`/`getViewport`/`translateExtent` signatures match existing usage in the file.
