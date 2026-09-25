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
- Spatial navigation (`hjkl`): candidates are the **visible nodes** (in no fold list); `h`/`l` stay
  in the section, `j`/`k` may cross into another (§8.1). A node counts only if it shares part of the
  focused node's range across the direction of travel: the row band (y-span) for `h`/`l`, the column
  band (x-span) for `j`/`k`. It must lie in the pressed direction; its near edge may sit up to half a
  grid behind the focused node's far edge. The nearest by gap wins. On a tied gap, the nearest top
  edge wins for `h`/`l` and the nearest left edge for `j`/`k`; then the wider overlap, then the first
  node in canvas order. No candidate means no move; it never falls back to a far node. Edges play no
  part: a connected node elsewhere is reached with `g`. Folding the section that holds the selected
  node clears the selection.
- A new node is clamped to the canvas (`clampToOrigin`) at the single creation funnel, and the first
  node added to an empty canvas seeds the first section at `y = 0` (webview and `applyLaneFit`, so MCP
  `canvas_add_node` does the same).

## 8. From the 0.17.4 smoke (2026-09-08): focus reveals the output; `j`/`k` cross sections

**8.1 `j`/`k` may leave the section.** Candidates for `j`/`k` are all visible nodes (in no fold list)
below/above that share part of the focused node's column band, in any section. `h`/`l` stay in the
section. A folded section has no visible nodes, so it is passed over: `j` from the last row of S1
lands in S2 when S2 has a node in the column, else in the next open section that has one; nothing
visible below in the column → no move. The rule of §7 decides between candidates. Edges are not
followed by `hjkl`; `g` follows them.

**8.2 Focus shows the output when it fits.** Pair = the focused code node + the node named by its
`outputNodeId` (when it exists). If the pair box fits inside the usable area at the current zoom
(24 px margin), both the move test and the minimal pan use the pair box: a visible node whose output
is off-screen pans just enough to show both. If the pair does not fit, the node alone decides, as in
0.16.16/0.16.17. Zoom never changes; only `forceCenter` (cross-canvas jumps) centres and zooms.

**8.3 The same pan on a mouse click.** A plain click on a node that is not yet selected (no
Shift/Ctrl/Meta; React Flow does not fire `onNodeClick` after a drag) runs the same reveal pan. A click
on the already-selected node does nothing (the second click of a double-click must not pan). A click
inside an open editor never reaches the node. Selection stays React Flow's; the click does not touch
it, but it is remembered as the last focus.

**8.4 Usable area = the React Flow pane.** The pane sits right of the 44 px rail (`wrapperRef`), so
the pan uses the pane's rect, not `window.innerWidth`; the chat panel's rect is converted into pane
coordinates before the dock test.

**8.5 Pure helpers.** `src/webview/canvas/spatialNav.ts`: `findNearestNode(from, dir, { nodes,
lanes })` and `revealPan(node, pair, area, viewport)` — no React, tested in
`tests/spatial-nav.mjs`. `CanvasView` only maps its state into them.

## 9. Paste lands at the focused node (2026-09-08, from the 0.17.6 smoke)

`yy` → `p` and Ctrl+V of copied nodes place the pasted group **right of the focused node**: the
group keeps its relative layout; its top-left goes to `(focused.x + focused.w + GRID, focused.y)`,
pushed right to the next free slot (`findFreePosition`, push +x). No focused node → the group is
centred on the React Flow pane's centre, snapped to the grid and clamped to the origin. The nodes
belong to the section they land in (this is the copy/paste section move of the rail spec) and the
sections fit as usual. The pasted group is selected and revealed (§8.2). Today's rule — each pasted
node at the copied node's own x/y + 40 px — is gone.

## 10. Folded sections and section switching (2026-09-19, user)

- **A folded section shows its title in the band.** The folded lane (one grid tall) draws the
  section's title centred in its area (same font as the rail title, the section's colour), with a
  second line below in the muted text colour: the member count, e.g. `12 nodes`, plus the kernel
  name when the section is bound (`12 nodes · rwa`). Nothing is drawn in an open section.
- **Sections in the marks panel.** `Ctrl+M` (the bookmarks/marks panel) gains a `Sections` list
  above the marks: `S1 First experiment`, `S2 …` (label, title, member count, `folded` when
  folded). Choosing one: unfold it when folded, then focus and reveal its first node (by y, then
  x); an empty section only unfolds and pans to its top. Keyboard: the panel's existing navigation.
- `Shift+(` / `Shift+)` stay on the focused node's section.
