# Section Rail — follow-ups from the first smoke run

**Status:** approved 2026-09-03 from the user's smoke of `skena-0.17.1.vsix` (8 of 12 items passed).
Extends `2026-09-02-section-rail-design.md`; where the two disagree, this file wins.

| Smoke # | Finding | Change |
|---|---|---|
| 11 | no border under the last section | §1 |
| 13 | every section looked the same | §2 |
| 8 | an empty section could not be deleted | §3 |
| 9 | a section never shrank back | §4 |
| 4 | fold hid the nodes but kept the area | §5 |
| 6 | the kernel dot only listed kernel nodes | separate spec: `2026-09-03-section-kernels-design.md` |

## 1. Bottom border under the last section

`SectionSeparators` draws the 1px line at every derived `bottom`, including the last lane's
(its content bottom + `GRID`, or top + `GRID` when empty).

## 2. Section colour

`laneColor`: bound → the kernel's colour; unbound → `kernelColor(lane.index)`, the palette by stack
order (S1 teal, S2 amber, S3 blue…). Used by the stripe, `S#:`, the kernel dot and the picker.
Two sections on one kernel share its colour; that is the design.

## 3. Segment context menu

Right-click anywhere on a rail segment opens `SegmentMenu` (portalled, styled like `KernelPicker`):
Fold / Unfold · Run section · Kernel… (opens the picker) · Rename… (opens the editor) · Delete
section. Every action is reachable at any segment height and any zoom. The in-segment controls stay
as they are. Deleting a section with no nodes asks nothing.

## 4. Sections fit their content (grow and shrink)

Replaces §3.3 "growth" of the rail spec with a symmetric rule. Constants in `src/shared/constants.ts`:

```ts
export const SECTION_MIN_H    = 2 * NODE_SIZE.code.h + 2 * GRID;   // - 800: a section is never shorter
export const SECTION_FOLDED_H = GRID;                              // - a folded section's range
```

For every lane except the last (the last is unbounded and follows its content):

```
content = max(y + height) over the lane's VISIBLE members, or top when there are none
target  = max(folded ? SECTION_FOLDED_H : SECTION_MIN_H, content + GRID − top)   // - content = top when nothing visible
target  = ceil(target / GRID) · GRID
delta_i = target − (next.y − top)         // - > 0 grows, < 0 shrinks
```

Shifts accumulate down the stack and apply to every lane below and to that lane's members. One pure
function, `fitLanes(lanes, nodes): LaneGrowth` (same return shape as today; negative shifts
allowed), plus `applyLaneFit(canvas)`. It replaces `growLaneForNodes` / `applyLaneGrowth` at every
applier — the webview hook (which no longer needs changed ids: it fits after any geometry or lane
change, still skipping mid-drag, mid-resize and the render after undo/redo), every MCP write, and
the host's output-cell creation. Idempotent: after one application every non-last lane has
`range == target`, so a second pass moves nothing. The webview fits on every settled change, so a canvas
written by an earlier build is fitted once on its first open and saved (no undo entry: no action
caused it). `normalizeCanvasToOrigin` lifts `metadata.sections` together with the nodes. The `+` button appends the new lane at
`last.top + target(last)`.

## 5. Fold collapses the section

`SectionLane.folded` becomes `string[] | undefined`: the ids of the members hidden by the fold. A
folded lane's range is `SECTION_FOLDED_H`; its members keep their stored positions, are hidden, and
stay **pinned** to their lane: membership for a pinned id is the lane that lists it, not its `y`, and
pinned nodes count for nothing in any lane's `content`. Fold = set the list, fit (lanes below move
up). Unfold = one step that grows the lane to its members while they still belong to it, then
clears the list (`unfoldLane`; `fitLanes` takes a membership override for that step) — releasing
the list first would hand the members whose stored `y` lies below the collapsed range to the lane
below. Members move only when their lane moves.
Migration: `folded: true` from earlier builds → the member ids by `y` at load.

`deriveLanes`, `fitLanes`, `memberCodeCellsInRunOrder`, `laneTopForNode` (used by `outputCellGeom`) and the
kernel resolver in `kernelBinding.ts` share one `laneIndexForNode(sorted, node, pinned)`: pinned → its
lane; else by `y`. A visible node placed into a folded lane still makes it fit. Deleting nodes prunes
their ids from any `folded` list; the migration never pins a legacy section node's own id. Run section still runs hidden
cells. Deleting a folded lane deletes its pinned members too.

## 6. Tests

`fitLanes`: empty middle lane → `SECTION_MIN_H`; content taller than the minimum → content + `GRID`,
snapped up; slack → negative shift, snapped down; last lane never shifts; folded lane → `SECTION_FOLDED_H`
with its pinned members ignored and moved with the lane; idempotent after one pass; `+` placement.
`migrateSections`: `folded: true` → member ids. `laneIndexForNode`: pinned beats `y`.

## 7. From the 0.17.3 smoke (2026-09-08)

- A folded segment lists its controls fold-first (`railItems(height, chars, folded)`): at the 28px
  floor exactly the chevron fits, so a folded section can always be unfolded from the rail.
- The first lane is always at the origin: `fitLanes` parks lane 0 at `y = 0` (no node moves).
- `▶` is drawn bright when the section binds a resolvable kernel, dim otherwise (tooltip says so;
  cells with a kernel edge still run through it).
- Spatial navigation (`hjkl`): candidates are the **visible nodes of the same section**, cone only —
  nothing in that direction means nothing happens; it never falls back to a far node or another
  section. Edge-following keeps its priority, with the same exclusions. Folding the section that
  holds the selected node clears the selection.
- A new node is clamped to the canvas (`clampToOrigin`) at the single creation funnel, and the first
  node added to an empty canvas seeds the first section at `y = 0` (webview and `applyLaneFit`, so MCP
  `canvas_add_node` does the same).

## 8. From the 0.17.4 smoke (2026-09-08): focus reveals the output; `j`/`k` cross sections

**8.1 `j`/`k` may leave the section.** Candidates for `j`/`k` are all visible nodes (in no fold list)
inside the cone below/above, in any section. `h`/`l` stay in the section. A folded section has no
visible nodes, so it is passed over: `j` from the last row of S1 lands in S2 when S2 is open, else in
the next open section; nothing visible below → no move. Edge-following keeps its priority under the
same exclusions per direction: an edge into a folded node is never followed; an edge into another
section is followed for `j`/`k`, not for `h`/`l`.

**8.2 Focus shows the output when it fits.** Pair = the focused code node + the node named by its
`outputNodeId` (when it exists). If the pair box fits inside the usable area at the current zoom
(24 px margin), both the move test and the minimal pan use the pair box: a visible node whose output
is off-screen pans just enough to show both. If the pair does not fit, the node alone decides, as in
0.16.16/0.16.17. Zoom never changes; only `forceCenter` (cross-canvas jumps) centres and zooms.

**8.3 The same pan on a mouse click.** A plain click on a node (no Shift/Ctrl/Meta; React Flow does
not fire `onNodeClick` after a drag) runs the same reveal pan. Selection stays React Flow's; the click
does not touch it.

**8.4 Usable area = the React Flow pane.** The pane sits right of the 44 px rail (`wrapperRef`), so
the pan uses the pane's rect, not `window.innerWidth`; the chat panel's rect is converted into pane
coordinates before the dock test.

**8.5 Pure helpers.** `src/webview/canvas/spatialNav.ts`: `findNearestNode(from, dir, { nodes,
edges, lanes })` and `revealPan(node, pair, area, viewport)` — no React, tested in
`test/spatial-nav.mjs`. `CanvasView` only maps its state into them.
