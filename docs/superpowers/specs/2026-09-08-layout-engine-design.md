# Layout engine — design

Date: 2026-09-08. Implements §4 ("Layout engine") and the placement parts of §6 of
`2026-09-01-spatial-notebook-design.md`. Sections and their fit are as in
`2026-09-03-section-rail-followups-design.md` §4; this spec does not change them.

Decisions taken with the user (visual companion, `.superpowers/brainstorm/3517288-1788875999/`):
hybrid model (code chains engine-managed, notes free), column-only push, geometry is the truth for
a column, dynamic output column width, live code-height recompute, existing canvases untouched until
an explicit Reflow, drag-and-drop reflow deferred to phase 2.

**2026-09-10:** the hybrid model is dropped. Every node is a column member and packs like a code
cell — notes and files pull up and push down the same way. An output cell is the only node that is
not a member: it rides with the code cell that owns it.

## 1. Where the engine lives and what it sees

- One pure module `src/shared/layoutEngine.ts` (no React), used by the webview, the host
  (run output) and the MCP server. One function, three callers — parity by construction.
- Input: one section's nodes as `{ id, type, x, y, w, h, outputNodeId? }` plus the section's
  range. Output: `{ [id]: { x, y, w?, h? } }` — only the nodes that changed. The caller applies it,
  pushes history, saves; `fitLanes` runs after, as for every write today.
- Nothing new in the file format. Derived on every call, never stored:
  - **column** = the nodes of a section that share a snapped x, ordered by y — every type, a note
    and a file next to a code cell. The one exception is an output cell: it rides with the code cell
    that names it and is no column member of its own.
  - **pair** = a column + its output column: output x = column x + the column's widest member +
    `GRID`; output column width = the widest output cell's real width, never under `OUTPUT_MIN_W`
    (600). `OUTPUT_MAX_W` (1400) caps an output when it is created or resized, not when measured, so
    a wider output can never overlap the next pair. Every column has a pair; the output column only
    means something for a column holding a code cell, since nothing else has an output.
  - Sequence edges (code → code, spec §5) are drawn from the column order; they are a view, not
    the record.
- **Every node is column-managed** — the same pack, the same bumps, whatever its type. "Free" says
  only that a node has no output cell of its own.
- Constants in `src/shared/constants.ts`: `GRID` 100 (already), `NODE_SIZE.code` 700×300
  (already), `CODE_MAX_H` 900, `OUTPUT_MIN_W` 600, `OUTPUT_MAX_W` 1400, `OUTPUT_MAX_H` 900,
  `CODE_H_STEP` 50.

## 2. Operations

Each row is one engine call, one history entry, section fit after.

| Operation | Engine |
|---|---|
| Insert after node X (`o`, `Alt+X j`, MCP `after`) | new node in X's column at X.y + X's row height + GRID, whatever X's type; the column below pushed down; output column untouched |
| Fork right / left of X (`Alt+X l` / `h`, MCP `forkOf`) | new column pair: x = right edge of X's pair + GRID (left: X's column x − pair width − GRID, refused below 0); y = X.y; pairs beyond shift sideways if overlapped |
| Run → output | output cell at (pair's output x, code y); width from content within `[OUTPUT_MIN_W, OUTPUT_MAX_W]`; whatever it now overlaps is bumped (§3.2); if the output is taller than its code, the column below is pushed |
| Code height (live, on the user's edits) | h = the text's real need (editor content height + the cell's chrome, measured by the cell) rounded up to `CODE_H_STEP`, min `NODE_SIZE.code.h`, max `CODE_MAX_H`; recomputed on the user's edits only, so a hand-resized cell keeps its height until its text changes; the column below pushed; shrink pulls the column up |
| Clear output / delete a node | the column closes the hole (pull up); nothing pulls back sideways (Reflow does) |
| Paste (§9 of the follow-ups spec), drop, MCP `canvas_add_node` with x,y | placed at the target; whatever it overlaps is bumped (§3.2) |
| Node moved or resized | its column packs around it (§3.1); anything else it overlaps moves by the overlap, on the shorter axis (§3.2) |

"Pull up": a column never keeps a hole larger than one gap.

## 3. Push mechanics

One algorithm behind every row of §2, run per section:

1. **Vertical.** Every column is packed tight top → bottom, a note column exactly like a code
   column: the first cell keeps its y (snapped), every next cell gets `y = prevBottom + GRID`, and
   every cell takes the column's x. Cells are ordered by their current y; the mover
   (`moverId`, the node the operation inserted, moved or resized) wins a tie, so an inserted cell
   placed at the next cell's y lands above it. Insert / grow pushes down; delete / shrink pulls the
   cells below up to one gap. Kernel badges are not column members: a badge is a marker the user
   parks where they like, never packed and never carried along by a column. An output cell has its
   code cell's y, and the pair's output x when it sits left of that or when the operation moved its
   code cell off the row the output is on — a cell the user dragged takes its output with it. An
   output the user parked further right of a cell that did not move keeps its x, so the pack never
   drags it into something. Reflow puts every output back
   on the slot. Nothing outside the column moves in this pass.
2. **Bumps — one rule for everything the touched column did not already pack.** After step 1, the
   engine looks for real overlaps (two boxes less than one grid gap apart on both axes) between a
   node this call moved (or the mover) and any other node. Each one is resolved by moving the OTHER
   node by exactly the overlap, **right or down, never left and never up**. Sitting left of the
   mover, its only move is **down**, past the mover's row (`mover.y + mover.h + GRID`); sitting at or
   right of it, it takes the smaller of **right** and **down**, a tie going right (FORK_1 below).
   **A node above the mover never moves past it** — a column keeps its order:
   it steps aside, or **the mover yields downward** when that is the smaller move (or when there is
   nowhere to step aside), taking what sits under it in its own column; that is the one case where a
   mover moves, and only a node the operation itself placed yields — a cell the pack has just laid
   out keeps its place. A sideways move takes the node's whole **column** with it — every node in the
   section that shares its snapped x, outputs riding with their code cells, so columns stay aligned;
   a downward move takes the node and everything below it in its column. Moved nodes are checked
   again, so a bump can cascade, but only through real overlaps and only by overlap amounts — never
   by a modelled distance. Example (H5): N1 (0,0) 700×300 widened to 800 bumps N5 (800,0): the
   smaller move is 100 px right, so N5 → (900,0) and its column-mate N3 (800,400) → (900,400); N2
   does not move. Consequences: no overlap, no bump — a hand-placed section is rearranged by an edit
   only where the pack of the touched column (§3.1) reaches; an output that grows pushes the next
   pair only when it actually reaches it; shrinking never pulls anything back (Reflow does).

   **No left move (2026-09-11).** A right or a down move takes a node further right or further down
   than it was, so a walk made of them cannot come back to a position it has already been in. A left
   move can, and the walk then never settles. Measured on `test/H4.canvas`: `o` on M1 (3100,100)
   700×600 put N11 at (3100,800) 700×300, over N8 (2400,900) 900×300. N8 sits left of N11 and the
   overlap was 300 either way, so the tie went sideways: N8's column slid 300 left, reached E6's
   column at x 1600, that one slid left in turn, and the moves came back round. The walk did not
   settle at 112, 500 or 5000 steps, so the capped undo left the overlap on the canvas. With the
   left move gone, N8's only move is down: N8 → (2400,1200), one step, nothing else touched. The
   every-node-as-mover sweep over H1/H4/H5 (80 movers) goes from one capped walk to none, with the
   same idempotence and no overlap growth.

   Three details the rule needs for a second call to change nothing:
   - a **sideways step is the overlap rounded UP to the grid**, so a column moves by one grid
     multiple and its nodes still share one snapped x — the next call reads the same column;
   - a **column slides only as one**: when the mover, or a cell the pack just laid out, sits in it,
     there is no sideways move and the node in the way goes down instead;
   - the **column the pack just laid out is never bumped** (the pack owns its geometry, so the two
     cannot fight over a cell), and a **code cell and its own output never bump each other** (they
     are one row, placed by the pack).

   The walk has a step limit. A section dense enough to exceed it (a diagonal staircase, a tight
   grid) stops before it is clear, and the walk is then UNDONE — the section is left as the pack left
   it, since a half-bumped one can hold more overlaps than it started with. The engine reports it
   (`report.capped`) and the MCP reply says to run `canvas_reflow_section`.
   **FORK_1 (2026-09-09):** kept as built — the shorter move wins even when that puts a fork column
   under a wide output. The "code columns always move sideways" variant was measured and rejected
   (H1: fewer edits settle in one pass, overlaps 8 → 10, runaway on dense grids); a bounded variant
   (sideways only when ≤ N× the down move) is the thing to revisit. Details:
   `~/projects/crtx/decisions/skena-layout-engine-2026-09-08.md`.
3. **Outputs.** An output cell is the one node the pack does not treat as a column member: it is
   placed at its code cell's y, at the pair's output x or at the x the user parked it at, and a
   sideways or downward move of that cell takes it along. Everything else — notes, files, links,
   code cells — is a member of the column at its snapped x and packs there. A node that was itself
   dropped or resized is the mover and moves only to yield to a node above it (§3.2).
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
| `src/shared/layoutEngine.ts` | new: `deriveColumns`, `derivePairs`, `layoutSection(nodes, lane, { moverId? })`, `reflowSection`, `codeCellHeight(neededPx)` |
| `src/webview/canvas/CanvasView.tsx` | creation (`o`, `Alt+X`), paste, drop, resize, code-height, run-output and delete paths call the engine and apply its result with the action's history entry |
| `src/webview/rail/SegmentMenu.tsx`, `SectionRail.tsx` | "Reflow section" entry |
| `src/extension/editor-provider.ts` | run-output placement through the engine (replaces `outputCellGeom`'s free-slot search) |
| `src/extension/mcp/server.ts` | `after` / `forkOf`, `canvas_reflow_section`, engine on add/update/layout/run |
| `test/layout-engine.mjs`, `test/mcp-parity.mjs` | §6 |

## 6. Tests

`test/layout-engine.mjs` on the esbuild bundle: insert pushes the column only; delete pulls up to
one gap; output growth shifts the pairs to the right and shrink pulls them back; a note column packs
like a code column and a note in a code column packs with it; a push never crosses a section
boundary; idempotence; `codeCellHeight` at the grid steps and the cap; Reflow on copies of `test/H1–H5.canvas` under `/tmp` (never the real
files): no overlap, one-gap columns, every code cell on a column x. `test/mcp-parity.mjs` gains
`after`, `forkOf`, `canvas_reflow_section` and the engine on `canvas_add_node` with x/y.
