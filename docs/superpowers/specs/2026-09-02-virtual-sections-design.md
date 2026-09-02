# Virtual Sections — Design

**Status:** approved in brainstorm 2026-09-02. Replaces the section implementation built on
2026-09-01 (`docs/superpowers/plans/2026-09-01-spatial-notebook-1b-section-container.md`), which is
withdrawn.

**Goal:** a section is a horizontal lane in the canvas with a fixed-size header. It grows as its
content grows, its title is always readable, and its title never sits on top of a node.

---

## 1. Requirements

These are the user's stated requirements. Every one of them is a hard constraint.

| # | Requirement |
|---|---|
| R1 | The title never scales with zoom. It is a fixed screen size at every zoom level. |
| R2 | The title is never hidden. It is visible at every zoom level. |
| R3 | A node never overlaps the title. |
| R4 | A section grows when a node inside it is moved. Live, not on reload. |
| R5 | The header matches the visual design in `docs/redesign/spatial-notebook.html`. |
| R6 | The section label reads `S1: <title>`. No `#` prefix. `S1` is drawn in the node-ID colour. |
| R7 | Sections are virtual — not stored as nodes in the canvas. |
| R8 | No background fill on the section. The section is marked by a thin coloured stripe on the left, in the section's colour — the way Jupyter marks the active cell — plus a bottom border separating it from the next section. |
| R9 | The fold control is a real icon, large enough to read at a glance. Not a text glyph. |
| R10 | The left rail stripe is visible at all times, whatever the zoom level or pan position. |

R1, R2 and R3 are only mutually satisfiable if the title is not bounded by a flow-space box, because
any flow-space box shrinks to nothing as zoom decreases. The title is therefore positioned in screen
space, anchored to content, and bounded by nothing. This is the central decision of this design.

---

## 2. Why the previous implementation failed

Measured from the code, not inferred.

1. **Geometry was a load-time cache.** `laneGeom()` ran inside the file-open pipeline only. Node
   drags called `patchCanvasNode`, which never consulted a section. Band geometry drifted from its
   content until the next reload. This is R4, unmet by construction.
2. **No creation site assigned `sectionId`.** Every node created after migration was section-less, so
   the next load's `wrapNodesInSection` invented an additional section around the new nodes. Sections
   accumulated on every reload.
3. **Fold did not survive a reload.** `folded` was persisted on the section node, but the members'
   `hidden` flag was set once in React Flow state and never written to disk. After a reload the
   members reappeared inside a band still marked folded.
4. **Three mechanisms owned the camera at once**: `frameViewportToTopSection` (host, rewrote the
   saved viewport), `framedPathRef` (webview, one-shot `setViewport`), and a `translateExtent`
   derived from the top section. Each corrected the others.
5. **The section node drew nothing.** `SectionNode` returned `null` while carrying real
   `x/y/width/height`. Two screen-space overlays independently recomputed their own geometry from
   `SECTION_HEADER_LANE` and the live transform. Nothing kept the three in agreement.

The common cause: the section was modelled as a *stored rectangle* that several independent pieces of
code tried to keep in sync with the nodes. This design removes the stored rectangle.

---

## 3. Model

### 3.1 What is stored

Sections live in canvas metadata, which `readCanvas`/`writeCanvas` already carry:

```ts
interface SectionLane {
  id: string;          // - stable identity, e.g. "sec-mtk13z55"
  y: number;           // - where the lane starts, in flow units. The ONLY geometry stored.
  title?: string;      // - absent → the header shows the creation datetime instead
  createdAt: number;   // - epoch ms
  folded?: boolean;    // - true → members are hidden and the lane collapses to its header
  kernelId?: string;   // - tint + kernel pill; wired in a later phase
}

// canvas.metadata.sections: SectionLane[]   — kept sorted by y
```

Nodes store **nothing** about sections. `CanvasNodeBase.sectionId` is deleted.

### 3.2 Territory and membership

Sections partition the canvas vertically. With lanes sorted by `y`:

- Lane `i` owns the half-open range `[y_i, y_{i+1})`. The last lane owns `[y_n, +∞)`.
- A node belongs to the lane whose range contains the node's **top edge** (`node.y`).
- A node above the first lane's `y` belongs to the first lane (clamp; no orphans possible).

Membership is therefore a pure function of position. Nothing is bookkept, nothing can desynchronise,
and dragging a node into another lane moves it to that lane — which also gives it that lane's kernel
when kernel-per-section lands.

### 3.3 Derived geometry

```ts
// src/shared/sectionLanes.ts — pure, no Node.js APIs, bundled into host and webview
interface DerivedLane extends SectionLane {
  label: string;        // - "S1", "S2" … by stack order, top to bottom
  index: number;
  memberIds: string[];
  top: number;          // - flow y where the lane starts (= y)
  bottom: number;       // - flow y where the lane ends (next lane's y, or content bottom + GRID)
  contentTop: number;   // - min y over members; = top when the lane is empty
  contentLeft: number;  // - min x over members; = 0 when the lane is empty
}

export function deriveLanes(nodes: CanvasNode[], lanes: SectionLane[]): DerivedLane[]
```

`deriveLanes` is called from a `useMemo` keyed on the live React Flow node array. Dragging a node
recomputes it on the same frame, so the band follows the node immediately. That is R4.

Labels are derived from stack order rather than stored, so the top lane is always `S1`. Inserting a
lane renumbers the lanes below it.

---

## 4. Rendering

Two screen-space overlays, both reading the live transform. Neither stores or caches geometry.

### 4.1 Lane marker — `SectionLaneMarks.tsx`

**No background fill** (R8). A lane is marked by two elements only:

- **Left rail stripe** — a vertical bar marking the lane. **Always visible, at every zoom and every
  pan position** (R10). It achieves that by being anchored in screen space on both axes:
  - **Horizontally fixed**: drawn at a constant screen x near the viewport's left edge. Panning the
    canvas sideways never moves it or takes it off screen.
  - **Vertically clipped to the viewport**: the segment is the *intersection* of the lane's territory
    with the visible area — `top = clamp(lane.top * zoom + ty, 0, viewportH)`,
    `bottom = clamp(lane.bottom * zoom + ty, 0, viewportH)`. A lane larger than the screen therefore
    shows a stripe down the full viewport height, so when you are zoomed inside a lane its colour is
    always present.
  - **Minimum height 24px**: at far zoom-out a territory can compute to a couple of pixels; the
    segment is floored at 24px (grown about its centre) so it never shrinks into invisibility. This
    is what makes it independent of scale.
  - Drawn for every lane that intersects the viewport at all.

  4px wide, `border-radius: 2px`, colour = the lane's colour (`SECTION_RGB` until kernel tint lands),
  full opacity, with a 6px gap between adjacent segments so boundaries read from the rail alone. This
  is the Jupyter active-cell marker, applied to a lane.
- **Bottom border** — `1px solid rgba(SECTION_RGB, 0.3)` across the full viewport width at
  `lane.bottom`, separating a lane from the one below it.

Both are `pointerEvents: none`, `zIndex: 0`. Folded → the territory collapses to the header's screen
height; the rail segment still honours its 24px floor, so a folded lane keeps a visible marker. A
lane under 2px tall draws its rail segment but skips the border, so a lone hairline never reads as a
stray line across the canvas.

There is no header strip in flow space. That construct is what forced the title to scale, and it is
gone.

### 4.2 Header — `SectionLaneHeaders.tsx`

Fixed screen size. Never scales (R1), never hides (R2).

- Vertical: the header's **bottom edge** sits `HEADER_PAD` above the lane's topmost node, in screen
  space: `top = lane.contentTop * zoom + ty - HEADER_H - HEADER_PAD`. Anchored to the node's screen
  position and bounded by nothing, it cannot cover that node at any zoom (R3). An empty lane anchors
  to `lane.top` instead.
- Horizontal: `left = max(lane.contentLeft * zoom + tx, 0)`, so it stays on screen when panned.
- `pointerEvents: auto` on the row; the container stays `none`.

Layout and styling, from `docs/redesign/spatial-notebook.html` `.sband-head` (R5):

| Element | Style |
|---|---|
| row | `height: 26px`, flex, `align-items: center`, `gap: 9px`, `padding: 0 12px`, IBM Plex Mono / editor font |
| fold | **16px SVG chevron**, `stroke-width: 2.5`, `var(--vscode-foreground)` at full opacity — a real icon, high contrast, clearly readable (R9). Points **down** when open, rotates to point **right** when folded, with a 130ms transition. Not a text glyph (`⌄`/`▸`), which rendered thin and washed out. Hit area 20×20px. |
| `S1:` | 11.5px, weight 600, `rgba(0, 255, 0, 0.92)` — `LABEL_TEXT_COLOR`, the node-ID green (R6) |
| title | 12.5px, weight 600, `letter-spacing: -0.01em`, `var(--vscode-foreground)`; falls back to the creation datetime `YYYY-MM-DD HH:MM` when there is no title |
| time | 10px, `var(--vscode-descriptionForeground)`; shown only when a title is set |
| kernel pill | 10px muted, 1px border, `border-radius: 999px`, `padding: 2px 8px`, 8px dot — rendered only when `kernelId` is set |
| delete | `✕` 11px muted |

Reads: `⌄  S1: mongo probe   14:32 · Aug 17   ● quantkit   ✕`

At far zoom-out the header keeps its size while nodes shrink beneath it, which is the intended
bird's-eye behaviour: the lane labels stay legible when the content is no longer readable.

---

## 5. Interactions

**Fold** — toggles `folded` in metadata and saves. Members' `hidden` is *derived* from `folded` on
every render, so fold survives a reload. Fixes failure 3.

**Delete** — removes the lane and every node whose position falls in its territory, plus edges
touching them. Undoable through the existing history stack. The next lane's territory absorbs the
freed range.

**Create** — `skena.newSection` command plus a context-menu entry. Inserts a lane at the pointer's
flow y (snapped to `GRID`), so a new lane splits the lane it lands in. Title defaults to empty, which
renders as the creation datetime.

---

## 6. Camera

All three competing mechanisms are deleted and replaced by one rule:

```
translateExtent.top.y = firstLane.y - (HEADER_H + HEADER_PAD) / zoom
```

This reserves exactly the header's screen height above the first lane at any zoom — enough that the
top header is never clipped, and no more. `frameViewportToTopSection` and `framedPathRef` are
removed; the saved viewport is restored normally, as on any other canvas.

---

## 7. Migration

One pass on the host load path, replacing the current four-function composition:

1. For each legacy `type: 'section'` node, append `{id, y: node.y, title, createdAt, folded}` to
   `metadata.sections`.
2. Drop every `type: 'section'` node from `nodes`.
3. Delete `sectionId` from every node.
4. If there are no lanes and the canvas has nodes, create one lane at `y = 0`.
5. Sort lanes by `y`.

Idempotent: a canvas with no section nodes and no `sectionId` is returned by the same reference.
Legacy `title: 'Section'` placeholders are dropped so the datetime shows.

---

## 8. Deletions

| Path | Action |
|---|---|
| `src/shared/sections.ts` | delete (replaced by `sectionLanes.ts`) |
| `src/webview/canvas/SectionBands.tsx` | delete (replaced by `SectionLaneMarks.tsx`) |
| `src/webview/canvas/SectionHeaders.tsx` | delete (replaced by `SectionLaneHeaders.tsx`) |
| `src/webview/canvas/nodes/SectionNode.tsx` | delete |
| `types.ts` | remove `'section'` from `SkenaNodeType`, the `SectionNode` interface, its union arm, and `CanvasNodeBase.sectionId` |
| `nodeLabels.ts` | remove the `'section'` case |
| `bounds.ts` | remove the section skip in `normalizeCanvasToOrigin` |
| `CanvasView.tsx` | `isBandType` returns to `group`-only; remove `selectable`/`deletable`/`zIndex` section special-cases, `hasSection`, `framedPathRef`, and the `topSec` extent |
| `editor-provider.ts` | replace the four-function load composition with `migrateSections` |
| `palette.ts` | drop the dead `section` border entry; keep `SECTION_RGB` |

Sections stop being nodes, so every node-dispatch site that never handled `'section'` (MCP
`nodeSnippet`, `canvas_read`, `canvas_add_node`, `typeLabel`; `context-builder` `nodeTitle` /
`nodeContent`; `searchMatch`; `MarksPanel`) needs no section arm at all. The bug where
`canvas_add_node` silently coerced a section request into a text node disappears with the type.

MCP gains `canvas_add_section` / `canvas_remove_section` operating on metadata, and `canvas_read`
reports lane membership per node so the agent can see the structure.

---

## 9. Testing

`src/shared/sectionLanes.ts` is pure, so it is unit-tested with the repo convention
(`npx esbuild … --bundle --format=esm` → `node --test`, `test/` gitignored):

- territory partition: boundaries are half-open; the last lane is unbounded
- membership: a node exactly on a boundary belongs to the lower lane; a node above the first lane
  clamps to it
- `deriveLanes` recomputes bounds from members (the R4 guarantee, tested as a pure function)
- labels follow stack order and renumber on insert
- migration: legacy section nodes convert to lanes; running it twice returns the same reference
- empty lane: derives without members and anchors its header to `lane.top`

The screen-space overlays are verified by inspection at three zoom levels — normal, 0.4, and 0.07 —
against R1, R2, R3, R8 (no fill; rail + bottom border present) and R9 (fold icon readable).

---

## 10. Out of scope

Kernel-per-section tinting, the left-rail minimap, section reordering by dragging a boundary,
cross-section edge rules, and the packing/reflow engine. This design covers the lane model, the
header, and the migration only.
