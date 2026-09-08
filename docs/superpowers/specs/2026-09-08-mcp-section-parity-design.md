# MCP parity — every section and kernel operation the rail has, with the same rules

**Status:** requested 2026-09-08 ("all MCP functions must follow the same rules as in UI"), spec for
review. Extends `2026-09-03-section-rail-followups-design.md` and `2026-09-03-section-kernels-design.md`.

**FACT today:** the MCP has 15 tools, none for sections or kernels. Its node writes fit sections, pin
outputs of folded cells, prune fold lists and (after the 0.17.3 batch-1 fixes) seed the first
section — but `canvas_add_node` / `canvas_update_node` / `canvas_layout` snap to the grid without
clamping to the origin, and an agent can neither create, rename, fold, delete nor bind a section.

## 1. Rules shared with the rail (one implementation each, in `src/shared/`)

| Rule | Function | Used by |
|---|---|---|
| a node is never off the canvas | `clampToOrigin` (bounds.ts) | add, update, layout — after `snapGrid` |
| sections fit their content, first lane at 0, seed on first node | `applyLaneFit(canvas, now)` | every write, as today |
| fold = pinned member list, unfold grows before releasing | `unfoldLane`, the list | `canvas_update_section` |
| an output of a folded cell stays folded | `pinOutputToLane` | run / pin, as today |
| deleted nodes leave the fold lists | `pruneFoldedIds` | remove node / section |
| run order = top to bottom, left to right | `memberCodeCellsInRunOrder` | `canvas_run_section` |
| a cell's kernel = edge → section → none | `resolveCellKernel`, `kernelById` | run, as today |
| new section goes under the last one's fitted range | `sectionTargetHeight` | `canvas_add_section` |

Section references: `S1`… (stack order, as printed by `canvas_list`) or the lane id. Kernel
references: as `canvas_run_cell` — record id or display name, or a kernel node label/id.

## 2. New tools

| Tool | Args | Does |
|---|---|---|
| `canvas_add_section` | `canvasPath, title?, y?` | no `y`: append at `last.top + sectionTargetHeight(last)` (the rail's `+`); with `y`: snap and insert there (the lane it lands in is split; nodes stay where they are, membership follows `y`). Fit. Returns the new `S#`. |
| `canvas_remove_section` | `canvasPath, ref` | as the rail's `✕`: the section, its nodes (pinned ones too) and their edges go; the first lane re-parks at 0; fold lists pruned; fit. |
| `canvas_update_section` | `canvasPath, ref, title?, kernelRef?, folded?` | `title` (empty string clears); `kernelRef` (a kernel reference, or `null` to unbind — no un-run, as picking "none" in the rail); `folded: true` = list the visible members, `false` = `unfoldLane`; fit. |
| `canvas_run_section` | `canvasPath, ref` | the section's code cells in run order, one after another, each on its resolved kernel, stopping at the first error; the same live-kernel requirement as `canvas_run_cell`. |
| `canvas_add_kernel` | `canvasPath, server, spec?, displayName?, bindSection?, start?` | a `KernelRecord` (next colour); `start` (default true) starts the kernel through the Jupyter client so it is live at once, as the rail's New kernel… does; `bindSection` binds it. |
| `canvas_remove_kernel` | `canvasPath, ref` | records only (a kernel node is removed with `canvas_remove_node`): shut down if live, remove, unbind every section, un-run the cells that ran on it, write. |

`canvas_list`: the `Sections:` line gains `folded` and the member count; `canvas_read` marks a node
`hidden (folded in S2)`. `canvas_add_node` / `canvas_update_node` / `canvas_layout` clamp.

## 3. Open panel

MCP writes are plain file writes; the host's watcher reloads the panel, which then mirrors everything
(sections, fold lists, kernels) from the file — no extra messages. The host's own record write-back
(`runOutput`) is unaffected.

## 4. Tests

Pure: `sectionByRef(lanes, ref)`, `insertLaneAt(lanes, y, now)` (splitting; idempotent when a lane
already starts there), `foldLane(lanes, derived, id)`. Tools: a stdio JSON-RPC probe script under
`test/` (gitignored) driving `dist/mcp-server.js` over scratch canvases for each tool — add, add at y,
remove, rename, bind/unbind, fold/unfold round trip, run order, kernel add/remove — asserting the
written files.

## 5. Out of scope

Prompting (the MCP cannot show a QuickPick — `canvas_add_kernel` takes the server and spec as
arguments); interrupt/restart/shutdown of a kernel as separate tools (later).
