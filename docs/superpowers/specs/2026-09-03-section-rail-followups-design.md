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
target  = folded ? max(SECTION_FOLDED_H, visible content, if any) : max(SECTION_MIN_H, content + GRID − top)
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
up). Unfold = clear the list, fit (lanes below move down). Members move only when their lane moves.
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
