# Section Rail — Design

**Status:** approved in brainstorm 2026-09-02 (visual companion session). Replaces the header part of
`2026-09-02-virtual-sections-design.md` (§4.2 header overlay, §6 camera). The section model of that
spec (`metadata.sections`, membership by node `y`, `deriveLanes`) stays and is extended here.

**Goal:** all information and controls for a section live in a pinned left rail, outside the
canvas. The canvas itself carries no section title. The camera has one rule: the origin.

**Second spec, not this one:** restyling nodes, edges and labels onto the neutral tokens introduced
here (`2026-09-02-node-restyle-design.md`, to be written). This spec only adds the tokens and uses
them for the rail.

---

## 1. Requirements

| # | Requirement |
|---|---|
| R1 | The rail is pinned to the left edge of the panel, never pans or zooms, and is always drawn in front of the canvas. |
| R2 | Section titles in the rail are rotated 90° and read bottom → top. |
| R3 | There is no section title anywhere in the flow. The rail is the only place a section is labelled. |
| R4 | Per section, the rail holds: fold, title, run section, kernel picker, delete. |
| R5 | The rail holds a `+` that appends a new section. |
| R6 | A node never leaves its section by being dragged *down*: dragging past the bottom edge grows the section. Dragging *up* past the top edge moves the node into the section above. The first section clamps at the origin. |
| R7 | Moving a node to another section is done by cut / copy / paste. |
| R8 | Look: neutral greys, one blue accent, system font for chrome, thin 1px borders, rounded corners — the look of the brainstorm companion page. Follows the VS Code light / dark theme. |

## 2. Why the previous header failed

The 2026-09-02 header was a screen-space row anchored to the section's topmost node. To keep it from
being clipped, the camera had to reserve the header's height above the first section
(`translateExtent` term, `CameraTopGuard`, a lane term inside `clampCam`, a zoom-out cap). Eight of
the last session's commits are corrections to those reservations fighting each other. Putting the
title outside the flow removes the reservation and the three mechanisms with it.

## 3. Model

### 3.1 Stored

Unchanged shape, one field removed:

```ts
interface SectionLane {
  id: string;
  y: number;           // - flow y where the section starts; the only geometry stored
  title?: string;      // - absent → the rail shows the creation datetime
  createdAt: number;
  folded?: boolean;
  kernelId?: string;   // - id of a kernel node on this canvas; dangling id = unbound
}
// canvas.metadata.sections: SectionLane[]  — sorted by y
```

`colorIndex` is deleted. The colour of a section is the colour of its kernel node
(`kernelColor(kernelNode.colorIndex)`); an unbound section is grey (`text3`). Sections on one kernel
share its colour. Existing canvases: the field is dropped on load (part of `migrateSections`).

### 3.2 Membership

As before: sections partition the canvas by `y`; a node belongs to the section whose range
`[y_i, y_{i+1})` contains the node's top edge; the last section is unbounded; a node above the
first section's `y` belongs to the first section. `deriveLanes` is unchanged.

### 3.3 Section growth (R6, R7)

Membership is kept "by `y`" by moving the boundary, never by re-tagging the node.

After any position or size change of nodes — drag end, keyboard move, resize, `o` / Alt+X creation,
paste, MCP `canvas_add_node` / `canvas_update_node` — run:

```ts
// src/shared/sectionLanes.ts — pure
export function growLaneForNodes(
  lanes: SectionLane[], nodes: LaneNodeGeom[], changedIds: string[],
): { laneShifts: Record<string, number>; nodeShifts: Record<string, number> }
```

For each changed node in section `i` (not the last): `overflow = node.y + node.height + GRID − y_{i+1}`.
If `overflow > 0`: `delta = ceil(overflow / GRID) · GRID`. Over all changed nodes the largest `delta`
per boundary wins. Then every section below gets `y += delta`, and every node with `y ≥ y_{i+1}` gets
`y += delta`. Edges untouched. One history entry. The camera does not move.

Upward: no rule. A node dragged above `y_i` is in section `i−1` by membership. The first section's
top is the origin, already clamped by `clampToOrigin`.

Output cells: a run places its output cell to the right of the code cell, vertically centred on it.
That top edge can fall above the code cell's section top, which would make the output a member of
the section above. The placement is therefore floored at the section top (`laneTopForY`), on the
host and in the MCP alike; the growth rule then applies to the new cell.

Applied in three places: the webview (one hook watching node geometry, so every placement path is
covered without touching each), the MCP add/update writes, and the host's output-cell creation.

## 4. Layout

```
┌──────┬──────────────────────────────────────┐
│ rail │  <ReactFlow>  (44px narrower)         │
│ 44px │                                       │
└──────┴──────────────────────────────────────┘
```

The rail is a sibling of the flow container inside `ReactFlowProvider`, not an overlay. It reads
the live transform, the node array and `metadata.sections` from the flow store. Nothing renders
under it, so R1 needs no z-order and no pointer-event blocking.

## 5. Rail rendering

### 5.1 Tokens (`src/webview/canvas/palette.ts`)

```ts
export const THEME = {
  light: { bg1: '#f5f5f7', bg2: '#ffffff', bg3: '#e5e5e7', border: '#d1d1d6',
           text1: '#1d1d1f', text2: '#86868b', text3: '#aeaeb2', accent: '#0071e3' },
  dark:  { bg1: '#1d1d1f', bg2: '#2d2d2f', bg3: '#3d3d3f', border: '#424245',
           text1: '#f5f5f7', text2: '#86868b', text3: '#636366', accent: '#0a84ff' },
} as const;
```

Picked by the VS Code theme kind on `body`: `vscode-dark` and `vscode-high-contrast` → dark;
`vscode-light` and `vscode-high-contrast-light` → light.
Exposed as CSS variables `--sk-bg1 … --sk-accent` on the webview root so the node restyle can use
them without importing TS.

### 5.2 Segments

Rail: width 44px, full panel height, background `bg1`, 1px right border `border`. The bottom 28px of
the rail is a strip holding the `+` button (`PLUS_H`); segments are projected and clipped above it,
so a section whose projection falls entirely inside that strip has no segment until the camera moves.

One segment per section whose range intersects the viewport:

```
top    = clamp(lane.top    · zoom + ty, 0, H)
bottom = clamp(lane.bottom · zoom + ty, 0, H)
```

with a 6px gap between neighbours and a **floor of 28px** (grown about the centre, kept inside
`[0, H]`). Stripe: 4px wide, `border-radius: 2px`, at `x = 6`, in the section colour.
A 1px `border` line across the flow at `lane.bottom` separates sections. It is the only section
drawing left inside the flow: a small overlay component `SectionSeparators` (`pointer-events: none`),
what remains of today's `SectionLaneMarks`.

### 5.3 Contents

Stacked from the segment's **visible** top, centred in the remaining 34px, gap 7px:

1. fold chevron — 16px SVG, stroke 2.5, `text2`; points down when open, right when folded (130ms)
2. title — `writing-mode: vertical-rl; transform: rotate(180deg)` so it reads bottom → top (R2);
   system font 600 10.5px; `S1:` in the section colour, the title in `text1`; falls back to the
   creation datetime `YYYY-MM-DD HH:MM`
3. `▶` run section — 14px SVG, `text2`
4. kernel dot — 9px circle in the section colour; grey ring when unbound
5. `✕` delete — 12px, `text3`

`+` new section: in the 28px bottom strip, 16px, `text2`, centred on the controls column.

The **current** section (the one holding the selected node) draws its title in `text1`; the others
in `text2`.

### 5.4 Degradation

The fixed controls are taken in priority order while they fit, each with its 7px gap:

```
S#  >  fold  >  ▶  >  kernel  >  ✕
```

The title is elastic: it replaces the horizontal `S#` and takes whatever height is left, truncated
with an ellipsis, when at least 40px is left (`TITLE_MIN_PX`). A long title therefore never removes
a control. Below that, `S#` is drawn horizontally (fits in 44px up to `S99`); at the 28px floor only
`S#` remains.

The item budget uses the rendered boxes (fold / run / delete 20px, kernel 14px, `S#` 12px, 7px
gaps, 8px top pad), so a control that does not fit is dropped, never clipped.

The 28px floor grows a segment only into free space: never into a neighbour's projected range.
So at extreme zoom-out stacked sections become thin stripes without labels rather than
overlapping; the tooltip still names them. Every segment has a tooltip `S2: <title> · <created> · <kernel name>`,
which is how short segments stay readable.

### 5.5 Tall section

A section taller than the viewport yields a segment clipped to `[0, H]`, so its contents sit at
the top edge: the title is on screen while the camera is anywhere inside the section.

### 5.6 Fold

`folded` toggles in metadata and saves. Members' `hidden` is derived from `folded` on every render,
so a fold survives a reload. The section's range does not change and no node moves; the segment
dims to 55% and the chevron points right. Compacting folded sections is left to the layout engine.

## 6. Interactions

| Control | Action |
|---|---|
| chevron | toggle `folded`, save |
| title (double-click) | `TitleEditor` popover beside the segment: input, Enter saves, Esc cancels; empty → title cleared |
| `▶` | host message `runSection { sectionId }` |
| kernel dot | `KernelPicker` popover: this canvas's kernel nodes as `K1 name` with their colour dot (live status in a later phase), plus "none". Clicking the dot again closes it. Pick → sets `kernelId` on the lane, saves. No kernel nodes → the popover says so and names the command *Skena: Add Kernel*. |
| `✕` | as today: host confirm, then delete the section, its member nodes and their edges; the next section absorbs the range; undoable |
| `+` | append a section at the last derived lane's `bottom` (= its content bottom + `GRID`, snapped), pan so its top sits at the viewport top. `skena.newSection` command does the same (no context-menu entry). |
| hover | tooltip (5.4) |

### 6.1 Run section

Host handler. Order: member code nodes by `y`, then `x`. For each: resolve its kernel with
`resolveCellKernel`; run through `runOneCell`; stop at the first `'error'`. Every cell runs
regardless of `lastStatus` (unlike run-with-upstream, which skips already-run cells). A section
with no resolvable kernel for its first cell reports `runStatus … 'no kernel bound'` for that cell
and stops. One run per section at a time: a second `▶` while a run is in flight is answered with an
information message, as is `▶` on a section with no code cell. The order is computed by the pure
`memberCodeCellsInRunOrder(nodes, lanes, sectionId)` in `sectionLanes.ts`, unit-tested. Folded
sections run too: fold is visual only (hidden cells are still members).

## 7. Kernel resolution

```ts
// src/shared/kernelBinding.ts
interface CellKernelCanvas { nodes: { id; type; y }[]; edges: EdgeLike[]; sections: SectionLane[] | undefined }
function cellKernelView(canvas: CanvasData): CellKernelCanvas          // - adapter for host / MCP
function makeCellKernelResolver(c: CellKernelCanvas): (cellId: string) => string | null   // - index built once per snapshot
function resolveCellKernel(cellId: string, c: CellKernelCanvas): string | null            // - one-shot form
```

The webview builds one resolver per React Flow store snapshot (node index and sorted lanes computed
once) and asks it once per code node; the host and the MCP use the one-shot form.

1. the edge-bound kernel (`resolveBoundKernel`, today's BFS) — wins
2. else the `kernelId` of the cell's section, if that node exists and is a kernel
3. else `null`

The six call sites switch to it: `handleRunCell`, run-with-upstream, the two completion handlers
(`editor-provider.ts`), MCP `canvas_run_cell` (`mcp/server.ts`), and `CodeNode` (webview; it gets
the lanes from the store). `resolveKernelCells(kernelId, …)` gains the same fallback so a restart
or status refresh reaches section-bound cells. `resolveUpstreamChain` is unchanged: a section-bound
cell with no edges has no upstream and simply runs.

## 8. Camera

```ts
translateExtent = [[-ORIGIN_GUTTER, 0], [1e7, 1e7]]
```

One-grid gutter on the left as today; flush at the top. `clampCam` stays as the single funnel for
every viewport write and becomes exactly `clampViewportToOrigin` with the top at 0. Deleted:
`firstLaneTopRef`, the lane term in `clampCam`, the lane-dependent `translateExtent`,
`CameraTopGuard`. `MIN_ZOOM = 0.05` unchanged. The rail is outside the flow: no extent term, no
zoom cap, no reservation.

## 9. Messages

```ts
interface MsgRunSection { type: 'runSection'; sectionId: string }
```

Webview → host; §6.1. Title, kernel and fold edits need no message: the webview owns
`metadata.sections` and persists them through `commitLanes` → `saveCanvas` (the host merges
`sections` in `handleSaveCanvas`), which is how fold already works.

## 10. Files

| Path | Change |
|---|---|
| `src/webview/rail/SectionRail.tsx` | new: the column; segments, degradation, `+`, bottom borders |
| `src/webview/rail/RailSegment.tsx` | new: one segment and its controls |
| `src/webview/rail/KernelPicker.tsx`, `TitleEditor.tsx` | new: the two popovers |
| `src/webview/canvas/SectionSeparators.tsx` | new: the 1px lines at each `lane.bottom`, inside the flow |
| `src/webview/rail/railGeometry.ts` | new, pure: `railSegments(lanes, transform, H)`, `railItems(segmentH, titleLen)` |
| `src/shared/sectionLanes.ts` | `+ growLaneForNodes`; `− colorIndex`; `migrateSections` drops the field |
| `src/shared/kernelBinding.ts` | `+ resolveCellKernel`; `resolveKernelCells` section fallback |
| `src/webview/canvas/palette.ts` | `+ THEME` tokens |
| `src/shared/types.ts` | `+ MsgRunSection` |
| `src/extension/editor-provider.ts` | `runSection` handler; six sites → `resolveCellKernel`; output cells floored at the section top + `applyLaneGrowth` |
| `src/extension/mcp/server.ts` | `canvas_run_cell` → `resolveCellKernel`; `applyLaneGrowth` on add/update; output cell floored at the section top |
| `src/webview/canvas/CanvasView.tsx` | `[rail][flow]` layout; `growLaneForNodes` on commit; camera per §8; remove the three overlay mounts |
| `src/webview/App.tsx` | sets the `--sk-*` variables from the theme kind |
| **delete** | `SectionStickyHeader.tsx`, `CameraTopGuard.tsx`; `SectionLaneMarks.tsx` shrinks to `SectionSeparators.tsx` |

## 11. Testing

Pure functions, repo convention (`esbuild --bundle --format=esm` into `test/.build`, `node --test`;
`test/` is gitignored):

- `growLaneForNodes`: no overflow → empty shifts; overflow snaps up to `GRID`; several changed nodes →
  the largest delta; last section never shifts; only nodes with `y ≥ next.y` move; every section
  below shifts by the same delta; upward move → empty shifts.
- `resolveCellKernel`: edge wins over section; section fallback; dangling `kernelId` → `null`;
  no section → `null`. `resolveKernelCells` includes a section-bound cell.
- `railSegments`: clipping to `[0, H]`; 6px gap; 28px floor grown about the centre and kept inside
  `[0, H]`; a section taller than the viewport → `[0, H]`; sections outside the viewport → none.
- `railItems`: the drop order of §5.4 at decreasing heights.
- `migrateSections` drops `colorIndex` and is idempotent.

Manual, on `test/H5.canvas` at zoom 1, 0.4 and 0.07: R1–R5 by inspection; fold survives reload; run
section order and stop-on-error; kernel picker with 0, 1 and 2 kernel nodes; drag a node past the
bottom edge → the section grows and the sections below shift as one; drag it up → it joins the
section above; `+` appends and pans; reload → no extra sections.

## 12. Out of scope

Known, pre-existing, not fixed here: about 20 sites in `CanvasView.tsx` use `window.innerWidth` /
`innerHeight` as the flow viewport size (`focusNodeById`, zoom centre, new-node placement); with the
44px rail those are off by 44px horizontally, as they were off by 28px vertically with the old header.
The store's `s.width` / `s.height` are the right numbers.

Node / edge / label restyle (second spec). Kernelspec-driven kernels in the rail (replacing kernel
nodes). Reordering sections. Compacting folded sections. Cross-section edge rules. The packing /
reflow engine beyond the vertical push of §3.3. Section minimap.
