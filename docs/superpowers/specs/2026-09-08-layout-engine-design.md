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
| Insert after X (`o`, `Alt+X j`, MCP `after`) / beside or above X (`Alt+X h/k/l`, `Ctrl+Shift+H/K/L`, external paste) | the new node takes a column slot and that column packs, whatever X's type. After: X's column at X.y + X's row height + GRID. Beside / above: the column one gap right of X (or one new-node width + GRID left of it) at X's row, or X's own column one new-node height + GRID above X. A slot another node already holds is not searched past — the new node packs below that occupant, and on an exact y tie the mover wins and the occupant moves down. A slot outside the canvas (left of x 0, above y 0) is refused: nothing is added. Output column untouched. A code cell forks instead on `h` / `l` (next row). |
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
   Cannot revisit a position is not the same as settles, so the step cap stays: a right or down move
   can repeat for ever at a fresh position. That is what a move carrying the node doing the bumping
   did — the overlap came out the same every step (20 000 of them on a three-node shape) until the
   cap undid the walk. Neither move carries it now: a column does not slide while it holds that node,
   and the down group leaves it, and its pair partner, where they are. Measured over 2794 random
   sections, every node as the mover: capped 266 → 13, non-idempotent 29 → 22, overlap growth 15 → 0.
   The cap is still reachable — a note dropped on an output whose code cell sits above it pushes the
   pair down, yields to the code cell, and lands on the output again, 300px lower each step.

   Three details the rule needs for a second call to change nothing:
   - a **sideways step is the overlap rounded UP to the grid**, so a column moves by one grid
     multiple and its nodes still share one snapped x — the next call reads the same column;
   - **no move carries the node doing the bumping**: a column does not slide while that node (or a
     cell the pack just laid out) sits in it, and the group that goes down leaves that node, and its
     pair partner, where they are. Carried along, it would keep the overlap exactly as it was;
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

### 3.4 Wide cells are obstacles, not column widths (decided 2026-09-23)

A node whose x-span crosses a column is an obstacle for that column, whatever column it belongs to.
Packing a column skips over obstacles: a member's row starts at `prevBottom + GRID`, and while that
row would sit in an obstacle it moves to `obstacle.bottom + GRID`. Outputs still ride at their
cell's row; a collision there is left to the bump rule as before.

**Width.** A member sets its column's width only when it leaves a full grid gap before the next
column: `column.x + w + GRID <= nextColumn.x`. Anything wider is a spanning cell: it keeps its place
in its column's y-order but does not widen the column, and both the pair's width and the tight pass
read the widest member that stays clear. So on H4's S2 the 1600-wide E15 in column 0 no longer sends
column 800 to x 2400 on Reflow, and a cell packed into column 800 lands under E15 (y 1100), not
inside it (y 600). The gap term keeps the rule stable across the tight pass, which places the next
column at `column.x + width + GRID + outputW + GRID`: a spanning cell stops spanning as soon as the
column beside it moves, and the gap is the slack that stops the two readings swapping back and
forth. Measured over 1500 random dense sections: the two rules give a different Reflow on 211 of
them, and the plain `column.x + w <= nextColumn.x` rule leaves 44 sections non-idempotent against
the gap rule's 35. On H1, H4 and H5 the two agree everywhere.

**The obstacle test.** The row clears an obstacle by a full grid gap on y, the distance the bump
rule asks for everywhere: the obstacle counts while `obstacle.y + obstacle.h + GRID > y` and
`y + member.h + GRID > obstacle.y`. On x an obstacle to the LEFT of the column counts when it
reaches within a grid gap of the column x (the line the width rule draws); one at or right of the
column counts only on a real crossing, so a node the column merely touches is moved right by the
bump rule (§3.2) instead of the column stepping under it.

**The column head.** Only a stacked row skips obstacles. The head keeps its own snapped y whatever
crosses it — it is where the user left it; a node it lands on is the bump rule's business. The one
exception is the row of a node anchored by an edge (§3.5), in its own column or in another packed
column: the head clears that row and drops below such a node it used to sit above. A head that is
itself a mover clears only the anchored nodes of its own column; the others go under it.

**Reflow.** Reflow's tight pass runs again while it still moves a column, at most 8 rounds, then
packs every column once more: a column's width is read off the members that stay clear of the next
column, so moving a column changes which of its neighbour's members span. Measured: 3 rounds on H1's
section, 2 on H4's S1 and S2, at most 5 over 1500 random dense sections, the cap never reached.
Each pack of the whole section repeats until a round moves nothing, at most 8 rounds, and keeps
every anchored node's row as a regular call does (§3.5, 2026-09-24).

**The pair rule on Reflow (decided by the user 2026-09-24).** Reflow keeps the output slot,
`OUTPUT_MIN_W` (600) plus two gaps, only right of a column where at least one cell has an output
node. A column whose code cells have not run yet ends at its own right edge, like a column of notes.
`derivePairs` gives `hasOutput` for this; its `right` still counts the slot for every column that
holds a code cell, because `forkOf` reads it so that a fork clears the outputs to come. Before this
decision the slot was kept for every column holding a code cell.

Measured (test 78): column 0 holds two code cells without outputs, and the notes J1 and J2 sit in
column 800. Reflow leaves them at x 800 (before: x 1500), and a second Reflow changes nothing. When
the first cell of column 0 then runs, its output lands at (800, 0), on J1. The bump moves J1 and J2
down by 400, to (800, 400) and (800, 800), not right: J1 sits at the output's x, so it takes the
smaller move, 400 down against 700 right. The next Reflow moves them right, to x 1500, on the same
rows; a second Reflow changes nothing. On the current H4 S2 column 0 has outputs, so Reflow puts the
next column at x 1700 before and after the decision.

Measured, not fixed: Reflow's snapping joins a node to a column within half a pair width (700 px).
A column without an output that is 600 wide or less now puts the next column within 700 px of its
own x, so a second Reflow can merge the two. On the copy of H1 taken 2026-09-24 11:39, S1 becomes
non-idempotent this way: the second Reflow moves one note into column 7700, whose code cells are
360 wide. On the current H1, H4 and H5 no section is affected. Narrow note columns already did the
same before the decision: on H2 S1 the second Reflow moves 19 nodes, before and after (test 15).

### 3.5 A sequence edge anchors its target to the source's row (decided 2026-09-23)

A node that is the target of an edge leaving the source's right border and entering the target's
left border (a side the file leaves out counts as that border), with the source in a column strictly
left of the target's, is anchored to the source's row: its y is the source's y, the way an output
takes its code cell's y. The node types do not matter: a note, a file, a knowledge node, a code cell,
as the source or as the target. Decided 2026-09-24 on H4, where the text note N27, connected from the
code cell E18, was packed under E14 instead of taking E18's row; until then both ends had to be code
cells. The exceptions:

- the output cell of a code cell is no target: it already takes its code cell's row. A pinned cell
  that is no code cell's output is a column member like a note, and can be a target;
- a kernel badge is neither source nor target: it is in no column;
- a band (a `group` node) is neither source nor target;
- an output cell can be the source. Its row is its code cell's row, so the anchor is read from the
  code cell (`ridersOf` names the code cell), and the code cell's column has to be strictly left of
  the target's too.

In its own column that row is fixed and the other members pack around it (§3.4 treats it as an
obstacle of its own column). When the source moves, the anchored node moves with it and its column is
re-packed. Two nodes anchored to one row in one column stack in their current order: the one that
is higher before the call stays on top, and the other goes one gap under it. On a tie of y the
column's own tie order decides: the mover first, then the id. Decided by the user 2026-09-24
(test 77); before, the two stacked in id order.
An edge whose source sits in the same column, or in a column to the right, anchors nothing — those
edges stay drawings.

**A source in the same column is no source.** A node whose source is a member of the same column is
not anchored for that pack, whatever the `riders` map says: Reflow snaps columns before it packs and
can put the two in one column, and anchoring a cell on its own column-mate walked the column down
800 px per call before this rule.

**A row held by an output.** When an output cell crosses the anchored node's column on the source's
row, the node takes the first row under that output instead. The usual case
is a node in the output column of its own source. Both are pinned once their columns are packed, so
no bump would part them. Added 2026-09-24 with the rule above, without a decision of its own.
Measured without it: on a copy of H4, 32 of the 56 single-mover calls left the note N17 on top of
C4, the output of its source E2, and 2 calls were not idempotent; a second `canvas_pin_output` on one
code cell put the new cell on top of the first (MCP parity test). Measured with it, on copies of H1,
H4 and H5 with their edges, all sections, every node as the only mover: capped 0, not idempotent 0,
Reflow twice changes nothing on the second call; the overlap count grows on 6 calls, all in H4 S2,
the same 6 calls and the same pair (E13 and E3's output) as before this change. The other choice
was to anchor no node that sits in its source's output column. Measured: the overlap
count grows on the same 6 calls only, but Reflow is then not idempotent on H4 S1 — the first Reflow
moves N17 out of the output column, and the second then anchors it to E2's row. Decided by the user
2026-09-24: kept as built, one gap under the output.

**What holds the row against an anchored node (decided by the user 2026-09-24).** When a node
crosses the anchored node's column on the source's row, the anchored node goes one gap under it only
when that node keeps its row in this call anyway: an output cell of another pair, a mover and the
other half of its pair, another anchored node of a packed column, or the anchored node's own source.
A plain member of a packed column (not a mover, not anchored, not an output) does not push the
anchored node down. The anchored node keeps its row, and the member's column packs around it, as
§3.4 packs a column around any node crossing it. Three details keep the two from being left on top
of each other, since no bump parts two packed nodes:
- the head of the member's column clears the anchored node too, unless the head is a mover
  (test 76);
- the member's column counts the anchored node when it is within a gap on either side on x, not
  only when the two cross (test 80);
- a member never packs around a node anchored to it; that node goes under it instead.

The packed columns are packed again, in the same left-to-right order, until a round moves nothing,
at most 8 rounds. One round is not enough: a column packed early in the round reads the y of nodes
that a later pack in the same round moves.

Why the source is on the list: a source that reaches its anchored node's column and is packed
around it moves the row the anchored node follows. Measured in the random-section check below,
without it: a source 1100 wide crossing the column, and a source 800 wide ending inside the gap
before it, each ended on top of the node anchored to it (test 79 holds the two shapes).

Measured on H3 (one section, test 74): E4 runs and its output lands at (2400, 400), on N8, which is
anchored to E7's row. N8 goes one gap under the output, to (2400, 800), and stays there. Column 1600
packs around N8: N10, 1400 wide and crossing column 2400, goes to (1600, 1600), which is
800 + 700 + 100; N11 goes to (1600, 1800) and M6 to (1600, 2000). No two nodes are closer than one
grid gap except M1/M2 and N7/M3, the two pairs the user left that way in columns this call does not
pack. A second call returns `{}`. The rule built before this decision (commit e78de64) sent N8 to
(2400, 1000), under N10 at (1600, 800).

Test 75 (two nodes anchored to one row; X, 1500 wide, crosses R's column): X is anchored itself, so
R goes one gap under it, to (1600, 800), and a second call returns `{}`. Measured with a variant in
which only outputs, movers and their pair partners hold the row: R takes S's row, 400, on top of X.
Both are anchored nodes of packed columns, so no bump parts them. This variant reproduces an
overlap in test 75 like the one the first try at this choice left.

Measured with the random-section check (`ridercmp.mjs` in the session scratchpad: 1500 calls with
anchored nodes; its random generator repeats, so they hold 394 distinct draws), before this decision
and after: non-idempotent calls 115 and 62, capped calls 1 and 1, calls that grow the overlap count 0
and 0. The first version of this change had no source on the list and neither of the last two
details above: the overlap count then grew on 12 calls (3 distinct draws), and 122 calls were not
idempotent. On copies of H1, H4 and H5 (the fixtures in `test/` on 2026-09-24), every node as the only
mover: capped 0, overlap growth 0, non-idempotent 0, and Reflow twice changes nothing on the second
call, before and after.

**On Reflow.** Reflow packs every column, so every anchored node keeps its row against a plain
member there too, by the same rules, and the packs repeat until a round moves nothing, at most 8
rounds. Before 2026-09-24 Reflow gave its packs no anchored nodes to keep, so a wide column head, or
a member ending inside the gap before an anchored node's column, was left on top of the anchored
node (test 81). Measured, test 15's check: a second Reflow on H3's S1 moved 11 nodes before and moves
none now; on H2's S1 it moves 19 before and after (the snapping distance, §3.4).

Removing the edge releases the cell: the webview runs the engine for the target's column at once
and the cell packs up to the first row it clears (E14 lifts to y 1100, under E15). Adding such an
edge anchors the target at once (it moves onto the source's row; its old column re-packs).

**Bumps.** The engine does not move an anchored node inside the columns the operation packs. Anywhere
else a bump treats it like any node: it can be pushed off its row (a sideways push takes its whole
column, a downward push what is below it), and the next pack of its column puts it back on the
source's row. Decided 2026-09-23 on the H4 case where a node dropped on an anchored node left both
overlapping with nothing reported. An anchored node follows a downward bump of its source, with its
own output; a sideways bump changes no y. The columns a call packs are the movers' columns plus,
transitively, the columns of the nodes anchored to anything in a packed column; the pack runs left to
right, so a source is placed before the node that reads its y.

Measured over the same 1500 random dense sections: protecting an anchored node only in the packed
columns and protecting it everywhere in the section give a different first call on 13 of them, and on
none of the 13 does the packed-columns rule leave more overlap (8 fewer over the 13). The
non-idempotent share (6.8 %, against 3.7 % with no anchoring at all), the capped count (0) and the 11
calls that raise the overlap count are the same either way. On H1, H4 and H5, every node as the mover:
capped 0, overlap growth 0, non-idempotent 0 under both rules.

**What the anchor does not promise.** An anchored node the operation itself moved is a mover and can
yield downward off its source's row when a node above leaves it nowhere to step aside (§3.2); it
settles one gap below that node and stays — measured: an anchored node on row 600 with a note
reaching y 800 over it lands at 900, and the next call moves nothing. An anchored node fixes its row
against the head of its own column: a member that sat above it is packed below it.

The engine takes the anchoring as an input: `layoutSection(nodes, { riders })` /
`reflowSection(nodes, { riders })` with `riders: Map<targetId, sourceId>`, computed by every caller
from the canvas edges with one shared pure `ridersOf(nodes, edges)` in `layoutEngine.ts`. Callers:
the webview (`runEngine`, `runEngineAfterMove`, edge add/remove), the host (`layoutAround`), the
MCP server (`applyEngine`, `canvas_add_edge`, `canvas_remove_edge`, `canvas_update_edge`).

Every edge path that creates or drops an anchor runs the engine for the target: webview `onConnect`,
`onConnectEnd`, `skena:nodesFromDrop`, keyboard connect/disconnect, edge delete; MCP
`canvas_add_edge`, `canvas_remove_edge`, `canvas_update_edge`.

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
