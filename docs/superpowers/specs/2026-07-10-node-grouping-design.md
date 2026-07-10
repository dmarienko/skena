# Node Grouping with Collapse — Design

**Date**: 2026-07-10
**Status**: approved (brainstormed with user)
**Branch**: `feature/node-grouping` (off `feature/paste-to-node`)
**Feature**: select multiple nodes → group them (`alt+g` / context menu) → collapse/expand the group via a title-bar chevron or hotkey.

## Decisions (locked with user)

- **Membership**: explicit member id list stored on the group node (not spatial containment).
- **Collapse behavior**: hide member nodes, shrink the group to a title bar.
- **Create**: `alt+g` auto-fits a group box to the selected nodes' bounding box.
- **External edges on collapse**: re-route to the collapsed group's bar (connection stays visible).
- **Deferred (v1)**: nested groups (a group cannot be a member of another) — flatten.
- **`alt+g` overload kept**: selection has non-group nodes → create; selection is exactly one group (nothing else) → toggle its collapse.

## Background (current state, FACT)

Skena groups today are **purely visual**: a `GroupNode` (`type:'group'`, `label`, `background`,
`backgroundStyle`) rendered as a dashed background box at `zIndex:-1`, `draggable:false`
(CanvasView.tsx:90-94). There is **no membership model** — JSON Canvas groups are spatial only;
a node is "in" a group merely by overlapping it. Groups are excluded from spatial nav / focus
everywhere (`type !== 'group'` guards). `GroupNode.tsx` renders the box + label.

## 1. Data model (`src/shared/types.ts`)

Add two Skena-only fields to `GroupNode` (Obsidian ignores unknown props, same as the existing
`nodeLabel`/`createdBy`; `.canvas` stays interoperable):

```ts
export interface GroupNode extends CanvasNodeBase {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
  members?: string[];      // - node ids belonging to this group
  collapsed?: boolean;     // - folded to a title bar
}
```

Membership lives only on the group node; member nodes store nothing. Both fields round-trip
through the `.canvas` file. A group saved `collapsed` loads collapsed.

## 2. Create — `alt+g` / context menu "Group selection"

- Read the selected **non-group** nodes. If none, no-op.
- Compute their bounding box; pad by a constant (e.g. 24px).
- Create a `group` node at that rect with `members = [selected node ids]`, a fresh `G#` label,
  and a default color. Insert behind (`zIndex:-1`, as today).
- Undoable via the existing `pushHistory()` + `scheduleSave()`.

Pure helper `createGroupFromSelection(selectedNodes) → { group: CanvasNode }` (bbox math only).

## 3. Collapse / expand

**Toggle entry points:**
- Chevron button on the group's title bar (primary — needs no keyboard focus).
- Context menu "Collapse group" / "Expand group".
- `alt+g` when exactly one group is selected and no other nodes are selected.

**Collapse** (`group.collapsed = true`):
- Member RF nodes → `hidden: true` (React Flow skips them). Their stored `x/y` are untouched.
- Group node resized to a title bar: keep width, height → `GROUP_BAR_H` (~30px). The expanded
  box is recovered on expand by refitting to members' bbox, so no extra field is stored.
- Bar renders: chevron ▸, label, member count (e.g. "3 nodes").

**Expand** (`group.collapsed = false`):
- Unhide members. Refit the group box to the members' bounding box + padding.

**Persistence / load:** on canvas load, a `collapsed` group starts folded — members hidden, box
at bar height. (The load path runs the same collapse view-transform.)

## 4. Edges — re-route to the bar on collapse

Applied as a **render-only** transform over the RF edge list; the stored `.canvas` edges never
change. For the collapsed group with member set `M`:

- Edge with exactly one endpoint in `M` (the other outside) → re-attach the member endpoint to
  the **group node id** (so the connection lands on the bar). Keep the other endpoint.
- Edge with **both** endpoints in `M` → `hidden: true` (internal, invisible while folded).
- Edge with **no** endpoint in `M` → untouched.

On expand, restore original endpoints (recompute from stored canvas edges, not by mutating).

## 5. Architecture

- **`src/webview/canvas/groupOps.ts`** (pure, unit-tested — like `toolCardView`/`chatTimeline`):
  - `createGroupFromSelection(nodes) → CanvasNode` (bbox + padding).
  - `collapsedNodeView(nodes, groupId) → nodes` (member `hidden` flags + group bar height).
  - `collapsedEdgeView(edges, memberIds, groupId) → edges` (reroute/hide per §4).
  - `groupBBox(memberNodes, pad) → {x,y,width,height}` (used by create + expand refit).
- **`GroupNode.tsx`**: when `collapsed`, render the title bar (chevron + label + count) instead of
  the box; chevron click dispatches `skena:toggleGroupCollapse` with the group id. Group must be
  clickable/selectable for the alt+g path (verify: it sits at zIndex:-1; the bar is on top).
- **`CanvasView.tsx`**:
  - `alt+g` keydown branch → create-or-toggle (per §3).
  - Context-menu items "Group selection" (when ≥1 non-group selected) and "Collapse/Expand group"
    (when a group is under the cursor / selected).
  - `skena:toggleGroupCollapse` handler: flip `group.collapsed`, apply the pure node/edge
    view-transforms via `setNodes`/`setEdges`, update `canvasRef`, `pushHistory()`, `scheduleSave()`.

## Error / edge cases

- A member id no longer exists (node deleted) → skipped in all transforms.
- Deleting a **group** node leaves its members intact (just removes the box + membership).
- Deleting a **member** while grouped → prune it from `group.members` on delete.
- Nested groups → v1 excludes: a `group` node is never added as a member; grouping a selection
  that includes a group ignores the group.
- Empty group (all members deleted) → renders as a normal empty box; collapse shows an empty bar.

## Testing

- **Pure unit** (`test/group-ops.mjs`, gitignored, `node --test`): create bbox math; collapse hides
  exactly the members + sets bar height; external edge reroutes to group id; internal edge hidden;
  external-external edge untouched; expand restores; missing-member id skipped.
- **Manual smoke**: select 3 nodes → alt+g → group box fits them; chevron collapses to a bar with
  "3 nodes"; an edge to an outside node re-routes to the bar; expand restores positions + edges;
  save + reload keeps collapsed state; delete a member → pruned from the group.

## Out of scope (v1)

- Nested groups.
- Auto-membership by dragging a node onto a group (membership is only set at create time / via a
  future "add to group" action).
- Group-level move (dragging the collapsed bar moves only the box, not members) — future.
