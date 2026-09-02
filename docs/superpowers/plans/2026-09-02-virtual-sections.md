# Virtual Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stored-section-node implementation with virtual sections — horizontal lanes defined by a single y coordinate in canvas metadata, with a fixed-size screen-space header and a left rail marker.

**Architecture:** A section is one number: where its lane starts. Lanes partition the canvas vertically; a node belongs to the lane whose y-range contains its top edge, so membership and geometry are pure functions of position, recomputed every render. Nothing about sections is stored on nodes, and no section rectangle is ever persisted — which removes the entire class of drift bugs in the previous implementation.

**Tech Stack:** TypeScript, React 18, React Flow v12, esbuild, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-02-virtual-sections-design.md`

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/shared/sectionLanes.ts` | **Create.** Pure lane model: `SectionLane`, `DerivedLane`, `sortLanes`, `laneIndexForY`, `deriveLanes`, `migrateSections`. No React, no Node APIs. |
| `test/section-lanes.mjs` | **Create.** Unit tests for the above. |
| `src/webview/canvas/SectionLaneMarks.tsx` | **Create.** Left rail stripes + bottom borders. |
| `src/webview/canvas/SectionLaneHeaders.tsx` | **Create.** Fixed-size headers. |
| `src/shared/types.ts` | **Modify.** Add `metadata.sections`; remove `'section'`, `SectionNode`, `sectionId`. |
| `src/shared/bounds.ts` | **Modify.** Remove the section skip. |
| `src/shared/nodeLabels.ts` | **Modify.** Remove the `'section'` case. |
| `src/extension/editor-provider.ts` | **Modify.** Migration on load; metadata merge on save. |
| `src/webview/canvas/CanvasView.tsx` | **Modify.** Mount new overlays; lane state; fold/delete/create; camera; remove section special-cases. |
| `src/webview/canvas/palette.ts` | **Modify.** Remove the dead `section` border entry. |
| `package.json` | **Modify.** Register `skena.newSection`. |
| `src/shared/sections.ts`, `SectionBands.tsx`, `SectionHeaders.tsx`, `nodes/SectionNode.tsx` | **Delete.** |

Baseline: `npx tsc --noEmit` reports exactly 3 pre-existing `fsPath` errors in `editor-provider.ts` (lines 454–456). "Clean" means only those 3.

---

### Task 1: Lane model — territory and membership

**Files:**
- Create: `src/shared/sectionLanes.ts`
- Test: `test/section-lanes.mjs`

- [ ] **Step 1: Write the failing test**

```js
// - run: npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sortLanes, laneIndexForY, deriveLanes, LANE_BOTTOM_PAD } from './.build/sectionLanes.mjs';

const lane = (id, y, extra = {}) => ({ id, y, createdAt: 1, ...extra });

test('sortLanes orders by y and does not mutate the input', () => {
  const input = [lane('b', 500), lane('a', 0)];
  const out = sortLanes(input);
  assert.deepEqual(out.map(l => l.id), ['a', 'b']);
  assert.deepEqual(input.map(l => l.id), ['b', 'a']);
});

test('laneIndexForY picks the last lane whose y is at or above the point', () => {
  const lanes = [lane('a', 0), lane('b', 500), lane('c', 900)];
  assert.equal(laneIndexForY(lanes, 0), 0);
  assert.equal(laneIndexForY(lanes, 499), 0);
  assert.equal(laneIndexForY(lanes, 500), 1);   // - boundary belongs to the LOWER lane
  assert.equal(laneIndexForY(lanes, 10000), 2); // - the last lane is unbounded
});

test('laneIndexForY clamps a node above the first lane into it (no orphans)', () => {
  const lanes = [lane('a', 100), lane('b', 500)];
  assert.equal(laneIndexForY(lanes, -9999), 0);
});

test('deriveLanes assigns members by position and labels by stack order', () => {
  const lanes = [lane('a', 0), lane('b', 500)];
  const nodes = [
    { id: 'n1', x: 300, y: 100, width: 200, height: 100 },
    { id: 'n2', x: 700, y: 200, width: 200, height: 100 },
    { id: 'n3', x: 400, y: 600, width: 200, height: 100 },
  ];
  const [s1, s2] = deriveLanes(nodes, lanes);
  assert.deepEqual(s1.memberIds, ['n1', 'n2']);
  assert.deepEqual(s2.memberIds, ['n3']);
  assert.equal(s1.label, 'S1');
  assert.equal(s2.label, 'S2');
  assert.equal(s1.top, 0);
  assert.equal(s1.bottom, 500);          // - bounded by the next lane
  assert.equal(s1.contentTop, 100);      // - min member y
  assert.equal(s1.contentLeft, 300);     // - min member x
});

test('the last lane grows with its content (this is the live-growth guarantee)', () => {
  const lanes = [lane('a', 0)];
  const near = deriveLanes([{ id: 'n', x: 0, y: 100, width: 10, height: 100 }], lanes)[0];
  const far  = deriveLanes([{ id: 'n', x: 0, y: 900, width: 10, height: 100 }], lanes)[0];
  assert.equal(near.bottom, 200 + LANE_BOTTOM_PAD);
  assert.equal(far.bottom, 1000 + LANE_BOTTOM_PAD);  // - moving the node moved the lane bottom
});

test('an empty lane derives without members and anchors to its own top', () => {
  const [s] = deriveLanes([], [lane('a', 300)]);
  assert.deepEqual(s.memberIds, []);
  assert.equal(s.contentTop, 300);
  assert.equal(s.contentLeft, 0);
  assert.equal(s.bottom, 300 + LANE_BOTTOM_PAD);
});

test('deriveLanes returns an empty array when there are no lanes', () => {
  assert.deepEqual(deriveLanes([{ id: 'n', x: 0, y: 0, width: 1, height: 1 }], []), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/devs/skena && npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs
```

Expected: esbuild fails — `Could not resolve "src/shared/sectionLanes.ts"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Virtual section lanes. A section is one number — the flow y where its lane starts. Lanes partition
 * the canvas vertically: lane i owns [y_i, y_{i+1}), the last owns [y_n, +inf). A node belongs to the
 * lane whose range contains its top edge, so membership and geometry are pure functions of position
 * and never need to be stored, migrated or kept in sync. Pure; bundled into host and webview.
 */

import { GRID } from './constants';

// - how far a lane extends past its lowest node when nothing bounds it from below
export const LANE_BOTTOM_PAD = GRID;

export interface SectionLane {
  id: string;
  /** - flow y where this lane starts; the only geometry a section stores */
  y: number;
  /** - absent → the header shows the creation datetime instead */
  title?: string;
  createdAt: number;
  /** - true → members are hidden and the lane collapses to its header */
  folded?: boolean;
  /** - tint + kernel pill; wired in a later phase */
  kernelId?: string;
}

/** Minimal node shape the lane maths needs; both CanvasNode and a React Flow node can supply it. */
export interface LaneNodeGeom {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DerivedLane extends SectionLane {
  /** - S1, S2 … by stack order, top to bottom; derived, never stored */
  label: string;
  index: number;
  memberIds: string[];
  top: number;
  bottom: number;
  /** - min y over members; the lane's own top when empty (what the header anchors to) */
  contentTop: number;
  /** - min x over members; 0 when empty */
  contentLeft: number;
}

/** Lanes ordered top to bottom. Returns a new array; never mutates the input. */
export function sortLanes(lanes: SectionLane[]): SectionLane[] {
  return [...lanes].sort((a, b) => a.y - b.y);
}

/**
 * Index of the lane owning a flow y: the last lane starting at or above it. A point above the first
 * lane clamps into it, so a node can never be orphaned. Expects lanes already sorted.
 */
export function laneIndexForY(lanes: SectionLane[], y: number): number {
  let idx = 0;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i].y <= y) idx = i;
  }
  return idx;
}

/**
 * Resolve lanes against the live nodes: membership, bounds and labels. Called from a useMemo on the
 * node array, so dragging a node re-derives on the same frame — that is how a lane tracks its content
 * without any stored geometry.
 */
export function deriveLanes(nodes: LaneNodeGeom[], lanes: SectionLane[]): DerivedLane[] {
  if (lanes.length === 0) return [];
  const sorted = sortLanes(lanes);
  const members: string[][] = sorted.map(() => []);
  const minX: number[] = sorted.map(() => Infinity);
  const minY: number[] = sorted.map(() => Infinity);
  const maxY: number[] = sorted.map(() => -Infinity);

  for (const n of nodes) {
    const i = laneIndexForY(sorted, n.y);
    members[i].push(n.id);
    if (n.x < minX[i]) minX[i] = n.x;
    if (n.y < minY[i]) minY[i] = n.y;
    if (n.y + n.height > maxY[i]) maxY[i] = n.y + n.height;
  }

  return sorted.map((l, i) => {
    const next = sorted[i + 1];
    const has = members[i].length > 0;
    // - a bounded lane ends where the next begins; the last lane follows its own content
    const bottom = next ? next.y : (has ? maxY[i] : l.y) + LANE_BOTTOM_PAD;
    return {
      ...l,
      label: `S${i + 1}`,
      index: i,
      memberIds: members[i],
      top: l.y,
      bottom,
      contentTop: has ? minY[i] : l.y,
      contentLeft: has ? minX[i] : 0,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/devs/skena && npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs
```

Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd ~/devs/skena && git add src/shared/sectionLanes.ts && git commit -m "feat: virtual section lane model (territory, membership, derived bounds)"
```

---

### Task 2: Migration from stored section nodes

**Files:**
- Modify: `src/shared/sectionLanes.ts`
- Test: `test/section-lanes.mjs`

- [ ] **Step 1: Write the failing test** (append to `test/section-lanes.mjs`, and add `migrateSections` to the existing import line)

```js
test('migrateSections converts legacy section nodes into lanes and strips node membership', () => {
  const canvas = { nodes: [
    { id: 's-old', type: 'section', x: 100, y: 40, width: 900, height: 500, title: 'mongo probe', createdAt: 7, folded: true },
    { id: 'n1', type: 'text', x: 300, y: 100, width: 200, height: 100, sectionId: 's-old' },
  ], edges: [] };
  const out = migrateSections(canvas, 999);
  assert.equal(out.nodes.length, 1);
  assert.equal(out.nodes[0].id, 'n1');
  assert.equal('sectionId' in out.nodes[0], false);
  assert.deepEqual(out.metadata.sections, [{ id: 's-old', y: 40, title: 'mongo probe', createdAt: 7, folded: true }]);
});

test('migrateSections drops the legacy "Section" placeholder title so the datetime shows', () => {
  const canvas = { nodes: [
    { id: 's', type: 'section', x: 0, y: 0, width: 10, height: 10, title: 'Section' },
    { id: 'n', type: 'text', x: 0, y: 100, width: 10, height: 10 },
  ], edges: [] };
  const s = migrateSections(canvas, 999).metadata.sections[0];
  assert.equal(s.title, undefined);
  assert.equal(s.createdAt, 999);   // - no createdAt on the legacy node → stamped with `now`
});

test('migrateSections creates one lane at y=0 for a canvas that has nodes but no sections', () => {
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 300, width: 10, height: 10 }], edges: [] };
  const out = migrateSections(canvas, 999);
  assert.equal(out.metadata.sections.length, 1);
  assert.equal(out.metadata.sections[0].y, 0);
  assert.equal(out.metadata.sections[0].createdAt, 999);
});

test('migrateSections is idempotent — an already-migrated canvas returns the same reference', () => {
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 0, width: 10, height: 10 }], edges: [],
    metadata: { sections: [{ id: 'a', y: 0, createdAt: 1 }] } };
  assert.equal(migrateSections(canvas, 999), canvas);
});

test('migrateSections leaves an empty canvas untouched', () => {
  const canvas = { nodes: [], edges: [] };
  assert.equal(migrateSections(canvas, 999), canvas);
});

test('migrateSections preserves other metadata (aiModel must survive)', () => {
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 0, width: 10, height: 10 }], edges: [],
    metadata: { aiModel: 'opus' } };
  const out = migrateSections(canvas, 999);
  assert.equal(out.metadata.aiModel, 'opus');
  assert.equal(out.metadata.sections.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/devs/skena && npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs
```

Expected: FAIL — `migrateSections is not a function` (esbuild emits no such export).

- [ ] **Step 3: Write the implementation** (append to `src/shared/sectionLanes.ts`)

```ts
import type { CanvasData, CanvasNode } from './types';

/**
 * One-time conversion from the stored-section-node model to lanes. Legacy `type: 'section'` nodes
 * become lane records keyed on their y; the nodes themselves and every `sectionId` are dropped. A
 * canvas with content but no sections gets a single lane at the origin. Returns the same reference
 * when there is nothing to do, so a migrated canvas never triggers a spurious save.
 */
export function migrateSections(canvas: CanvasData, now: number): CanvasData {
  const legacy = canvas.nodes.filter(n => (n as { type?: string }).type === 'section');
  const hasMembership = canvas.nodes.some(n => (n as { sectionId?: string }).sectionId !== undefined);
  const existing = canvas.metadata?.sections;
  const needsSeed = !existing?.length && legacy.length === 0 && canvas.nodes.length > 0;
  if (legacy.length === 0 && !hasMembership && !needsSeed) return canvas;

  const converted: SectionLane[] = legacy.map(n => {
    const s = n as CanvasNode & { title?: string; createdAt?: number; folded?: boolean };
    const lane: SectionLane = { id: s.id, y: s.y, createdAt: s.createdAt ?? now };
    // - 'Section' was the old placeholder; drop it so the header falls back to the datetime
    if (s.title && s.title !== 'Section') lane.title = s.title;
    if (s.folded) lane.folded = true;
    return lane;
  });

  const sections = sortLanes([...(existing ?? []), ...converted]);
  if (sections.length === 0) sections.push({ id: `sec-${now.toString(36)}`, y: 0, createdAt: now });

  const nodes = canvas.nodes
    .filter(n => (n as { type?: string }).type !== 'section')
    .map(n => {
      if ((n as { sectionId?: string }).sectionId === undefined) return n;
      const { sectionId: _drop, ...rest } = n as CanvasNode & { sectionId?: string };
      return rest as CanvasNode;
    });

  return { ...canvas, nodes, metadata: { ...canvas.metadata, sections } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/devs/skena && npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs
```

Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd ~/devs/skena && git add src/shared/sectionLanes.ts && git commit -m "feat: migrate stored section nodes to virtual lanes"
```

---

### Task 3: Types — add lane metadata, remove the section node type

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/nodeLabels.ts:40`
- Modify: `src/shared/bounds.ts:44-46`

- [ ] **Step 1: Add `sections` to canvas metadata**

In `src/shared/types.ts`, add the import at the top of the file (after the existing imports) and extend `metadata`:

```ts
import type { SectionLane } from './sectionLanes';
```

```ts
  /** - canvas-scoped skena metadata (portable in the .canvas file) */
  metadata?: {
    /** - AI model for this canvas's chat; overrides the global skena.ai.model */
    aiModel?: string;
    /** - virtual section lanes, sorted by y; see sectionLanes.ts */
    sections?: SectionLane[];
  };
```

- [ ] **Step 2: Remove the section node type**

In `src/shared/types.ts`:
- line 17: change `export type SkenaNodeType = 'cell' | 'chat' | 'portal' | 'kernel' | 'code' | 'noderef' | 'section';` to drop `| 'section'`.
- delete the whole `sectionId` field block on `CanvasNodeBase` (lines 58–62).
- delete the whole `SectionNode` interface (lines 83–94).
- delete the `| SectionNode` arm of the `CanvasNode` union (line 177).

In `src/shared/nodeLabels.ts`: delete `case 'section': return 'S';` (line 40) and the `S — section container` docstring line (line 20).

In `src/shared/bounds.ts`, restore the plain loop (sections are no longer nodes, so the skip is meaningless):

```ts
  for (const n of canvas.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  }
```

- [ ] **Step 3: Verify the compiler finds every remaining reference**

```bash
cd ~/devs/skena && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "editor-provider.ts(45[456]"
```

Expected: errors in `editor-provider.ts` (imports `sections.ts`), `CanvasView.tsx` (section special-cases), `palette.ts`, `SectionBands.tsx`, `SectionHeaders.tsx`, `nodes/SectionNode.tsx`. These are the exact call sites Tasks 4–8 remove; leaving them red here is expected and intentional.

- [ ] **Step 4: Commit**

```bash
cd ~/devs/skena && git add src/shared/types.ts src/shared/nodeLabels.ts src/shared/bounds.ts && git commit -m "refactor: sections move to canvas metadata; drop the section node type"
```

---

### Task 4: Host — migrate on load, preserve lanes on save

**Files:**
- Modify: `src/extension/editor-provider.ts:72,226,513,790`

- [ ] **Step 1: Replace the import**

Replace line 72:

```ts
import { migrateSections } from '../shared/sectionLanes';
```

- [ ] **Step 2: Replace both load pipelines**

Line 226 becomes:

```ts
            const canvas = normalizeCanvasToOrigin(migrateSections(rawCanvas, Date.now()));
```

Line 513 becomes:

```ts
        const canvas = normalizeCanvasToOrigin(migrateSections(await readCanvas(document.uri.fsPath), Date.now()));
```

`frameViewportToTopSection` and `fitSectionsToContent` are gone: the saved viewport is restored normally, like any other canvas.

- [ ] **Step 3: Fix the metadata clobber on save**

This is load-bearing. `handleSaveCanvas` currently writes `metadata: document.canvas.metadata`, which would discard every fold, create and delete the webview performs. Replace that line (790) with a merge — `aiModel` stays host-authoritative, `sections` come from the webview, which owns lane edits:

```ts
      const canvasToWrite = {
        ...msg.canvas,
        nodes: mergedNodes,
        // - aiModel is host-owned (set via pickModel); sections are webview-owned (fold/create/delete).
        //   A blanket `metadata: document.canvas.metadata` would silently drop every lane edit.
        metadata: {
          ...document.canvas.metadata,
          sections: msg.canvas.metadata?.sections ?? document.canvas.metadata?.sections,
        },
      };
```

- [ ] **Step 4: Verify**

```bash
cd ~/devs/skena && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "editor-provider.ts(45[456]" | grep "editor-provider"
```

Expected: no output (`editor-provider.ts` is clean apart from the 3 baseline errors).

- [ ] **Step 5: Commit**

```bash
cd ~/devs/skena && git add src/extension/editor-provider.ts && git commit -m "feat: host migrates sections to lanes on load and preserves them on save"
```

---

### Task 5: Left rail marker overlay

**Files:**
- Create: `src/webview/canvas/SectionLaneMarks.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_RGB } from './palette';
import type { DerivedLane } from '../../shared/sectionLanes';

// - rail geometry, all in screen px
const RAIL_X = 8;
const RAIL_W = 4;
const RAIL_GAP = 6;       // - space between adjacent segments, so boundaries read from the rail alone
const RAIL_MIN_H = 24;    // - a segment never shrinks below this, whatever the zoom (spec R10)

/**
 * SectionLaneMarks — the only always-on section chrome: a coloured stripe at a fixed screen x marking
 * each lane, plus a hairline at each lane's bottom. There is deliberately NO background fill.
 *
 * The stripe is anchored in screen space on both axes: fixed horizontally (panning never moves it off
 * screen) and clipped to the viewport vertically, with a minimum height, so a lane that is on screen
 * always shows its marker at any zoom.
 */
export function SectionLaneMarks({ lanes, height }: { lanes: DerivedLane[]; height: number }): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {lanes.map(l => {
        const rawTop = l.top * zoom + ty;
        const rawBottom = (l.folded ? l.top + RAIL_MIN_H / Math.max(zoom, 0.0001) : l.bottom) * zoom + ty;
        if (rawBottom < 0 || rawTop > height) return null;  // - lane entirely off screen

        // - clip to the viewport, then enforce the minimum height about the segment's centre
        let top = Math.max(rawTop, 0) + RAIL_GAP / 2;
        let bottom = Math.min(rawBottom, height) - RAIL_GAP / 2;
        if (bottom - top < RAIL_MIN_H) {
          const mid = (top + bottom) / 2;
          top = Math.max(mid - RAIL_MIN_H / 2, 0);
          bottom = Math.min(top + RAIL_MIN_H, height);
          top = Math.max(bottom - RAIL_MIN_H, 0);
        }

        const drawBorder = rawBottom > 0 && rawBottom < height && rawBottom - rawTop >= 2;
        return (
          <React.Fragment key={l.id}>
            <div
              style={{
                position: 'absolute',
                left: RAIL_X,
                top,
                width: RAIL_W,
                height: bottom - top,
                borderRadius: RAIL_W / 2,
                background: `rgb(${SECTION_RGB})`,
              }}
            />
            {drawBorder && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: rawBottom,
                  height: 0,
                  borderBottom: `1px solid rgba(${SECTION_RGB}, 0.3)`,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ~/devs/skena && npx tsc --noEmit 2>&1 | grep "SectionLaneMarks"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd ~/devs/skena && git add src/webview/canvas/SectionLaneMarks.tsx && git commit -m "feat: section lane rail marker (no background fill, always visible)"
```

---

### Task 6: Header overlay

**Files:**
- Create: `src/webview/canvas/SectionLaneHeaders.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { useStore } from '@xyflow/react';
import { LABEL_TEXT_COLOR, SECTION_RGB } from './palette';
import type { DerivedLane } from '../../shared/sectionLanes';

/** - the header's fixed screen height; it NEVER scales with zoom (spec R1) */
export const HEADER_H = 26;
/** - gap between the header's bottom edge and the lane's topmost node */
export const HEADER_PAD = 8;

const MONO = 'var(--vscode-editor-font-family), "IBM Plex Mono", monospace';

// - 'YYYY-MM-DD HH:MM' in local time; the header's label when a lane has no title
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * SectionLaneHeaders — one fixed-size header per lane: fold · `S1:` · title · time · kernel · delete.
 *
 * The header is drawn in screen space at a constant size, so it neither scales nor hides at any zoom.
 * Its BOTTOM edge is anchored HEADER_PAD above the lane's topmost node, so it cannot cover that node
 * however far you zoom out — it is bounded by nothing, which is what makes all three of "fixed size",
 * "always visible" and "never overlaps a node" hold at once.
 */
export function SectionLaneHeaders({ lanes, onFold, onDelete }: {
  lanes: DerivedLane[];
  onFold: (id: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {lanes.map(l => {
        const top = l.contentTop * zoom + ty - HEADER_H - HEADER_PAD;
        const left = Math.max(l.contentLeft * zoom + tx, 0);
        const hasTitle = !!l.title?.trim();
        return (
          <div
            key={l.id}
            style={{
              position: 'absolute',
              left,
              top,
              height: HEADER_H,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '0 12px',
              pointerEvents: 'auto',
              fontFamily: MONO,
              whiteSpace: 'nowrap',
            }}
          >
            <button
              title={l.folded ? 'unfold section' : 'fold section'}
              onClick={() => onFold(l.id)}
              style={{ ...ctl, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {/* - a real 16px icon at full foreground contrast, not a text glyph (spec R9) */}
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ display: 'block', transform: l.folded ? 'rotate(-90deg)' : 'none', transition: 'transform 130ms ease' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: LABEL_TEXT_COLOR }}>
              {l.label}:
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--vscode-foreground)' }}>
              {hasTitle ? l.title : fmtDateTime(l.createdAt)}
            </span>
            {hasTitle && (
              <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                {fmtDateTime(l.createdAt)}
              </span>
            )}
            {l.kernelId && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10,
                color: 'var(--vscode-descriptionForeground)',
                border: '1px solid var(--vscode-panel-border)', borderRadius: 999, padding: '2px 8px',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: `rgb(${SECTION_RGB})` }} />
                {l.kernelId}
              </span>
            )}
            <button title="delete section and its nodes" onClick={() => onDelete(l.id)} style={{ ...ctl, fontSize: 11 }}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

const ctl: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-foreground)',
  cursor: 'pointer',
  lineHeight: 1,
  padding: 0,
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ~/devs/skena && npx tsc --noEmit 2>&1 | grep "SectionLaneHeaders"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd ~/devs/skena && git add src/webview/canvas/SectionLaneHeaders.tsx && git commit -m "feat: fixed-size section header (S1: title, real fold icon)"
```

---

### Task 7: Wire the overlays into CanvasView

**Files:**
- Modify: `src/webview/canvas/CanvasView.tsx`

- [ ] **Step 1: Swap the imports**

Remove the three old imports (`SectionNodeComponent`, `SectionBands`, `SectionHeaders`) and add:

```tsx
import { SectionLaneMarks } from './SectionLaneMarks';
import { SectionLaneHeaders, HEADER_H, HEADER_PAD } from './SectionLaneHeaders';
import { deriveLanes, sortLanes, type SectionLane } from '../../shared/sectionLanes';
```

Remove `section: SectionNodeComponent` from `NODE_TYPES`, and in `toFlowNode` remove the
`selectable: cn.type !== 'section'` and `deletable: cn.type !== 'section'` lines. Change `isBandType`
back to group-only:

```tsx
const isBandType = (t?: string): boolean => t === 'group';
```

- [ ] **Step 2: Add lane state and derivation**

Insert after the `canvasRef` declaration:

```tsx
  // - lanes live in canvas metadata; the webview owns fold/create/delete and the host merges them back
  const [lanes, setLanes] = useState<SectionLane[]>(canvas.metadata?.sections ?? []);
  useEffect(() => { setLanes(canvas.metadata?.sections ?? []); }, [canvas]);

  // - derived every render from the LIVE node array, so dragging a node moves its lane on the same
  //   frame. Nothing about a lane is stored except its y.
  const derivedLanes = useMemo(
    () => deriveLanes(nodes.map(n => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: Number(n.width ?? n.style?.width ?? 0),
      height: Number(n.height ?? n.style?.height ?? 0),
    })), lanes),
    [nodes, lanes],
  );

  // - fold is derived, never a one-shot mutation, so it survives a reload
  const hiddenByFold = useMemo(() => {
    const ids = new Set<string>();
    for (const l of derivedLanes) if (l.folded) for (const id of l.memberIds) ids.add(id);
    return ids;
  }, [derivedLanes]);
  const rfNodes = useMemo(
    () => (hiddenByFold.size === 0 ? nodes : nodes.map(n => (hiddenByFold.has(n.id) ? { ...n, hidden: true } : n))),
    [nodes, hiddenByFold],
  );

  // - persist a lane edit: update local state, mirror into canvasRef, schedule the save
  const commitLanes = useCallback((next: SectionLane[]) => {
    const sorted = sortLanes(next);
    setLanes(sorted);
    canvasRef.current = {
      ...canvasRef.current,
      metadata: { ...canvasRef.current.metadata, sections: sorted },
    };
    scheduleSave();
  }, [scheduleSave]);
```

`useMemo` must be added to the React import on line 7.

- [ ] **Step 3: Replace the fold and delete handlers**

Delete `handleFoldSection` and `handleDeleteSection` wholesale and put these in their place:

```tsx
  const handleFoldLane = useCallback((id: string) => {
    pushHistory();
    commitLanes(lanes.map(l => (l.id === id ? { ...l, folded: !l.folded } : l)));
  }, [lanes, commitLanes, pushHistory]);

  const handleDeleteLane = useCallback((id: string) => {
    const target = derivedLanes.find(l => l.id === id);
    if (!target) return;
    pushHistory();
    const doomed = new Set(target.memberIds);
    setNodes(nds => nds.filter(n => !doomed.has(n.id)));
    setEdges(eds => eds.filter(e => !doomed.has(e.source) && !doomed.has(e.target)));
    canvasRef.current = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.filter(n => !doomed.has(n.id)),
      edges: canvasRef.current.edges.filter(e => !doomed.has(e.fromNode) && !doomed.has(e.toNode)),
    };
    commitLanes(lanes.filter(l => l.id !== id));
  }, [derivedLanes, lanes, commitLanes, pushHistory, setNodes, setEdges]);
```

- [ ] **Step 4: Replace the camera code**

Delete the `framedPathRef` effect entirely, and the `hasSection` special-cases in the reload effect (the saved viewport now restores normally: change `if (isInitialLoad && canvas.viewport && !hasSection)` back to `if (isInitialLoad && canvas.viewport)`, and `if (canvas.viewport || !isInitialLoad || hasSection)` back to `if (canvas.viewport || !isInitialLoad)`).

Replace the `topSec`/`extentTop` block before `return (` with:

```tsx
  // - pan bound: allow a fixed flow-space margin above the first lane so its header (drawn above the
  //   content, in screen space) is never clipped. A zoom-derived margin would be exact, but reading
  //   zoom here re-renders every node on every zoom step — a perf trap this canvas has hit before.
  const HEADER_ROOM_FLOW = 800;
  const firstLaneY = derivedLanes.length ? derivedLanes[0].top : -ORIGIN_GUTTER;
  const extentTopY = firstLaneY - HEADER_ROOM_FLOW;
  const extentTopX = derivedLanes.length ? Math.min(0, derivedLanes[0].contentLeft) : -ORIGIN_GUTTER;
  const translateExtent = useMemo<[[number, number], [number, number]]>(
    () => [[extentTopX, extentTopY], [1e7, 1e7]],
    [extentTopX, extentTopY],
  );
```

- [ ] **Step 5: Mount the overlays and use the folded node list**

Change the `<ReactFlow>` `nodes` prop to `nodes={rfNodes}`, and replace the two old overlay mounts with:

```tsx
        <SectionLaneMarks lanes={derivedLanes} height={wrapperRef.current?.clientHeight ?? 0} />
        <SectionLaneHeaders lanes={derivedLanes} onFold={handleFoldLane} onDelete={handleDeleteLane} />
```

- [ ] **Step 6: Verify**

```bash
cd ~/devs/skena && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "editor-provider.ts(45[456]" && npm run build 2>&1 | tail -3
```

Expected: no TS output beyond the baseline; build completes.

- [ ] **Step 7: Commit**

```bash
cd ~/devs/skena && git add src/webview/canvas/CanvasView.tsx && git commit -m "feat: render virtual lanes; derived fold; single camera rule"
```

---

### Task 8: Delete the old implementation

**Files:**
- Delete: `src/shared/sections.ts`, `src/webview/canvas/SectionBands.tsx`, `src/webview/canvas/SectionHeaders.tsx`, `src/webview/canvas/nodes/SectionNode.tsx`
- Modify: `src/webview/canvas/palette.ts:30`

- [ ] **Step 1: Delete the files and the dead palette entry**

```bash
cd ~/devs/skena && git rm src/shared/sections.ts src/webview/canvas/SectionBands.tsx src/webview/canvas/SectionHeaders.tsx src/webview/canvas/nodes/SectionNode.tsx
```

In `src/webview/canvas/palette.ts`, delete the `section:` line from `DEFAULT_NODE_BORDER_BY_TYPE` (it was never drawn — the old component rendered `null`). Keep `SECTION_RGB`.

- [ ] **Step 2: Verify nothing references them**

```bash
cd ~/devs/skena && grep -rn "SectionBands\|SectionHeaders\|SectionNode\|shared/sections\|sectionId\|SECTION_HEADER_LANE\|SECTION_OPEN_RIGHT" src/ ; echo "--- (no output above = clean) ---"
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "editor-provider.ts(45[456]" ; echo "--- (no output above = baseline only) ---"
npm run build 2>&1 | tail -3
```

Expected: no grep hits, no TS errors beyond baseline, build completes.

- [ ] **Step 3: Delete the obsolete test file and re-run the suite**

```bash
cd ~/devs/skena && rm -f test/sections.mjs test/.build/sections.mjs
npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=test/.build/sectionLanes.mjs && node --test test/section-lanes.mjs
npx esbuild src/shared/bounds.ts --bundle --format=esm --outfile=test/.build/bounds.mjs && node --test test/bounds.mjs
```

Expected: `# fail 0` from both. `test/bounds.mjs` still contains a test asserting that
`normalizeCanvasToOrigin` ignores section nodes — delete that single test, since sections are no
longer nodes.

- [ ] **Step 4: Commit**

```bash
cd ~/devs/skena && git add -A src/ && git commit -m "chore: delete the stored-section-node implementation"
```

---

### Task 9: New Section command

**Files:**
- Modify: `package.json`
- Modify: `src/extension/editor-provider.ts`
- Modify: `src/webview/canvas/CanvasView.tsx`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Register the command**

In `package.json`, add to `contributes.commands`:

```json
        {
          "command": "skena.newSection",
          "title": "Skena: New Section"
        }
```

- [ ] **Step 2: Add the host→webview message**

In `src/shared/types.ts`, add to the host→webview message union:

```ts
export interface MsgNewSectionTrigger { type: 'newSectionTrigger'; }
```

and add `| MsgNewSectionTrigger` to `HostToWebviewMessage`.

- [ ] **Step 3: Relay the command**

In `src/extension/editor-provider.ts`, register alongside the existing `skena.addKernel` command
registration, posting to the active panel:

```ts
    vscode.commands.registerCommand('skena.newSection', () => {
      this._activePanel?.webview.postMessage({ type: 'newSectionTrigger' });
    }),
```

Follow the exact pattern used by `skena.addKernel` in this file, including the App-side relay in
`src/webview/App.tsx` (`addKernelTrigger` has the same shape — copy it, renaming to
`newSectionTrigger`, and dispatch a `skena:newSection` window event).

- [ ] **Step 4: Handle it in CanvasView**

```tsx
  // - a new lane starts at the viewport's top edge, snapped to the grid, so it splits wherever you
  //   are looking. An empty title renders as the creation datetime.
  useEffect(() => {
    const handler = () => {
      if (!rfRef.current) return;
      const { y, zoom } = rfRef.current.getViewport();
      const flowY = snapGrid(-y / zoom);
      const now = Date.now();
      pushHistory();
      commitLanes([...lanes, { id: `sec-${now.toString(36)}`, y: flowY, createdAt: now }]);
    };
    window.addEventListener('skena:newSection', handler);
    return () => window.removeEventListener('skena:newSection', handler);
  }, [lanes, commitLanes, pushHistory]);
```

- [ ] **Step 5: Verify and commit**

```bash
cd ~/devs/skena && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "editor-provider.ts(45[456]" ; npm run build 2>&1 | tail -3
git add -A src/ package.json && git commit -m "feat: skena.newSection command creates a lane at the viewport top"
```

---

### Task 10: Live verification

**Files:** none — this is the acceptance pass against the spec's requirements.

- [ ] **Step 1: Rebuild and reload**

```bash
cd ~/devs/skena && npm run build
```

Then run **Developer: Reload Window** in the Extension Development Host. A panel reload is not
enough — the webview bundle is cached per window.

- [ ] **Step 2: Check each requirement on `test/H5.canvas` and `test/H2.canvas`**

| Req | Check |
|---|---|
| R1 | Zoom from 1.0 down to 0.07. The title's pixel size never changes. |
| R2 | At every zoom in that range the title is still on screen. |
| R3 | At every zoom, no node is drawn under the title. |
| R4 | Drag the lowest node down. The lane's bottom border and rail segment follow it immediately, with no reload. |
| R5 | Header reads `⌄ S1: <title> <time> ✕` in monospace. |
| R6 | `S1` is green (`rgba(0,255,0,0.92)`), matching the `N1` node badges. No `#`. |
| R7 | `grep -c '"type": "section"' test/H5.canvas` returns 0; `metadata.sections` is present. |
| R8 | No background tint on the lane. A 4px coloured stripe sits at the left edge, and each lane has a bottom border. |
| R9 | The fold chevron is clearly visible; clicking it collapses the lane; the icon rotates. |
| R10 | Pan far right and zoom to 0.07 — the rail stripe is still visible in both cases. |

- [ ] **Step 3: Check fold survives a reload**

Fold a section, then run Developer: Reload Window. Expected: the section is still folded and its
members are still hidden. (This is the bug the old implementation had — `hidden` lived only in React
Flow state.)

- [ ] **Step 4: Check no spurious sections accumulate**

Add three nodes, reload the window, then run `grep -c '"id": "sec-' test/H5.canvas`. Expected: the
lane count is unchanged. (The old implementation invented a new section per reload because no
creation site assigned `sectionId`.)

---

## Self-Review

**Spec coverage:** R1/R2/R3 → Task 6 (header anchored in screen space, bounded by nothing) + Task 10.
R4 → Task 1 (`deriveLanes` from live nodes) + Task 7 Step 2 (`useMemo` on `nodes`) + Task 10.
R5/R6 → Task 6. R7 → Tasks 2, 3, 4, 8. R8 → Task 5. R9 → Task 6 (16px SVG). R10 → Task 5 (fixed x,
viewport clip, 24px floor). Spec §5 fold/delete/create → Task 7 Steps 3 and Task 9. Spec §6 camera →
Task 7 Step 4. Spec §7 migration → Task 2. Spec §8 deletions → Tasks 3 and 8. Spec §9 testing →
Tasks 1, 2, 10.

**Deviation from the spec, deliberate:** §6 specifies a zoom-derived pan bound
(`(HEADER_H + HEADER_PAD) / zoom`). Task 7 Step 4 uses a fixed 800-flow-unit margin instead, because
subscribing to zoom inside `CanvasView` re-renders every node on every zoom step — a documented perf
regression in this repo (`bugs/skena-hjkl-altI-lag-context-churn-2026-07-09.md`). 800 units gives
≥40px of room down to zoom 0.05, above the 34px the header needs.

**Out of scope, per spec §10:** MCP `canvas_add_section`/`canvas_remove_section`, kernel tint, the
left-rail minimap, boundary dragging.

**Type consistency:** `SectionLane` (id, y, title?, createdAt, folded?, kernelId?) is defined in
Task 1 and used unchanged in Tasks 2, 3, 4, 7, 9. `DerivedLane` adds label/index/memberIds/top/
bottom/contentTop/contentLeft, consumed by Tasks 5, 6, 7. `deriveLanes(nodes, lanes)`,
`sortLanes(lanes)`, `laneIndexForY(lanes, y)`, `migrateSections(canvas, now)` keep the same
signatures throughout. `HEADER_H`/`HEADER_PAD` are exported from `SectionLaneHeaders.tsx` (Task 6)
and imported in Task 7.
