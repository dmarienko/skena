# Layout engine — design

Date: 2026-09-08. Implements §4 ("Layout engine") and the placement parts of §6 of
`2026-09-01-spatial-notebook-design.md`. Sections and their fit are as in
`2026-09-03-section-rail-followups-design.md` §4; this spec does not change them.

Decisions taken with the user (visual companion, `.superpowers/brainstorm/3517288-1788875999/`):
hybrid model (code chains engine-managed, notes free), column-only push, geometry is the truth for
a column, dynamic output column width, live code-height recompute, existing canvases untouched until
an explicit Reflow, drag-and-drop reflow deferred to phase 2.

## 1. Where the engine lives and what it sees

- One pure module `src/shared/layoutEngine.ts` (no React), used by the webview, the host
  (run output) and the MCP server. One function, three callers — parity by construction.
- Input: one section's nodes as `{ id, type, x, y, w, h, outputNodeId? }` plus the section's
  range. Output: `{ [id]: { x, y, w?, h? } }` — only the nodes that changed. The caller applies it,
  pushes history, saves; `fitLanes` runs after, as for every write today.
- Nothing new in the file format. Derived on every call, never stored:
  - **column** = the code cells of a section that share a snapped x, ordered by y;
  - **pair** = a column + its output column: output x = column x + the column's widest code cell +
    `GRID`; output column width = the widest output cell's real width, never under `OUTPUT_MIN_W`
    (600). `OUTPUT_MAX_W` (1400) caps an output when it is created or resized, not when measured, so
    a wider output can never overlap the next pair.
  - Sequence edges (code → code, spec §5) are drawn from the column order; they are a view, not
    the record.
- **Managed** = code cells and their output cells. **Free** = every other node type: placed by
  hand, moved only when a managed node would overlap it.
- Constants in `src/shared/constants.ts`: `GRID` 100 (already), `NODE_SIZE.code` 700×300
  (already), `CODE_MAX_H` 900, `OUTPUT_MIN_W` 600, `OUTPUT_MAX_W` 1400, `OUTPUT_MAX_H` 900,
  `CODE_LINE_PX` 22, `CODE_CHROME_PX` 60.

## 2. Operations

Each row is one engine call, one history entry, section fit after.

| Operation | Engine |
|---|---|
| Insert code after cell X (`o`, `Alt+X j`, MCP `after`) | new cell in X's column at X.y + X.h + GRID; the column below pushed down; output column untouched |
| Fork right / left of X (`Alt+X l` / `h`, MCP `forkOf`) | new column pair: x = right edge of X's pair + GRID (left: X's column x − pair width − GRID, refused below 0); y = X.y; pairs beyond shift sideways if overlapped |
| Run → output | output cell at (pair's output x, code y); width from content within `[OUTPUT_MIN_W, OUTPUT_MAX_W]`; whatever it now overlaps is bumped (§3.2); if the output is taller than its code, the column below is pushed |
| Code height (live, on every new line) | h = `max(NODE_SIZE.code.h, ceil((lines × CODE_LINE_PX + CODE_CHROME_PX) / GRID) × GRID)` capped at `CODE_MAX_H`; grows at grid steps; the column below pushed; shrink pulls the column up |
| Clear output / delete cell | the column closes the hole (pull up); nothing pulls back sideways (Reflow does) |
| Paste (§9 of the follow-ups spec), drop, MCP `canvas_add_node` with x,y | placed at the target; whatever it overlaps is bumped (§3.2) |
| Free node moved or resized | only the nodes it overlaps move, by the overlap, on the shorter axis (§3.2) |

"Pull up": a column never keeps a hole larger than one gap.

## 3. Push mechanics

One algorithm behind every row of §2, run per section:

1. **Vertical, managed.** Each column is packed tight top → bottom: the first cell keeps its y,
   every next cell gets `y = prevBottom + GRID`. Cells are ordered by their current y; the mover
   (`moverId`, the node the operation inserted, moved or resized) wins a tie, so an inserted cell
   placed at the next cell's y lands above it. Insert / grow pushes down; delete / shrink pulls the
   cells below up to one gap. An output cell has its code cell's y. Nothing outside the column moves
   in this pass.
2. **Bumps — one rule for everything the touched column did not already pack.** After step 1, the
   engine looks for real overlaps (two boxes less than one grid gap apart on both axes) between a
   node this call moved (or the mover) and any other node. Each one is resolved by moving the OTHER
   node by exactly the overlap, on the axis that needs the smaller move: **right** when it sits at or
   right of the mover, **left** when it sits left of it (never below x = 0), **down** when it sits at
   or below it; never up. A sideways move takes the node's whole **column** with it — every node in
   the section that shares its snapped x, outputs riding with their code cells, so columns stay
   aligned; a downward move takes the node and everything below it in its column. Moved nodes are
   checked again, so a bump can cascade, but only through real overlaps and only by overlap amounts —
   never by a modelled distance. Example (H5): N1 (0,0) 700×300 widened to 800 bumps N5 (800,0): the
   smaller move is 100 px right, so N5 → (900,0) and its column-mate N3 (800,400) → (900,400); N2
   does not move. Consequences: a hand-placed section is never rearranged by an edit (no overlap, no
   move); an output that grows pushes the next pair only when it actually reaches it; shrinking never
   pulls anything back (Reflow does).
3. **Free vs managed.** The same bump rule applies to free and managed nodes; the only difference is
   what a column is: a code column brings its outputs; a free column is every free node at that x.
   A node that was itself dropped or resized is the mover and never moves.
4. **Sections.** The engine works inside one section: the caller hands it that section's nodes and
   nothing else, which is how a push never moves a node across a section boundary (the engine takes
   no lane range). `fitLanes` runs after it, so a section that grew pushes the sections below.
5. **Determinism.** Same input → same output; the result holds only the nodes that changed; a second
   run on the result changes nothing.

## 4. Reflow, MCP, undo, phases

- **Reflow section** — rail segment menu entry and MCP `canvas_reflow_section(ref)`. The only time
  the engine touches a hand-placed section as a whole: every code cell's x is snapped to the nearest
  existing column x (its own, snapped, when none lies within half a pair width), then §3 runs.
  Nothing is automatic on open; H1–H5 stay as they are until asked.
- **MCP** — `canvas_add_node` gains `after: <cellRef>` and `forkOf: <cellRef>` (engine placement,
  x/y ignored when given); plain `x, y` still accepted and engine-resolved. `canvas_run_cell` /
  `canvas_run_section` place outputs through the engine, as does the host's run path.
  `canvas_update_node` size changes and `canvas_layout` moves go through it. Tool descriptions say
  what moves.
- **Undo** — engine moves ride on the history entry of the action that caused them (as lane
  growth does). Reflow is its own entry.
- **Phases** — 1: engine core (§1–§3), Reflow, MCP, run output, paste, `o` / `Alt+X` creation.
  2: drag-and-drop reflow (rules below), if still wanted after phase 1. Out of scope: the edge `+`
  knob (spec §6), sequence-edge drawing changes.
- **Phase 2 rules (recorded, not built):** a dropped managed cell snaps to the nearest column x
  when the drop lands inside that pair's span, else starts a new column at the snapped x (must fit a
  full pair, else joins the nearest); its y sets its place in the column; the column it left pulls up;
  its output travels with it; a cell dropped in another section adopts that section's kernel; a free
  node dropped onto managed cells stays, the overlapped cells are pushed down.

## 5. Files

| File | Change |
|---|---|
| `src/shared/constants.ts` | the constants of §1 |
| `src/shared/layoutEngine.ts` | new: `deriveColumns`, `derivePairs`, `layoutSection(nodes, lane, { moverId? })`, `reflowSection`, `codeCellHeight(lines)` |
| `src/webview/canvas/CanvasView.tsx` | creation (`o`, `Alt+X`), paste, drop, resize, code-height, run-output and delete paths call the engine and apply its result with the action's history entry |
| `src/webview/rail/SegmentMenu.tsx`, `SectionRail.tsx` | "Reflow section" entry |
| `src/extension/editor-provider.ts` | run-output placement through the engine (replaces `outputCellGeom`'s free-slot search) |
| `src/extension/mcp/server.ts` | `after` / `forkOf`, `canvas_reflow_section`, engine on add/update/layout/run |
| `test/layout-engine.mjs`, `test/mcp-parity.mjs` | §6 |

## 6. Tests

`test/layout-engine.mjs` on the esbuild bundle: insert pushes the column only; delete pulls up to
one gap; output growth shifts the pairs to the right and shrink pulls them back; a free node is moved
only when overlapped, downward; a push never crosses a section boundary; idempotence; `codeCellHeight`
at the grid steps and the cap; Reflow on copies of `test/H1–H5.canvas` under `/tmp` (never the real
files): no overlap, one-gap columns, every code cell on a column x. `test/mcp-parity.mjs` gains
`after`, `forkOf`, `canvas_reflow_section` and the engine on `canvas_add_node` with x/y.
