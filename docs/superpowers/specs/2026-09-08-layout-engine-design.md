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
   mover moves. A node the operation itself placed yields (a mover, or the other half of its pair),
   and since 2026-09-25 so does a cell pinned only because this call packs its column (below); a held
   node keeps its place. A sideways move takes the node's whole **column** with it — every node in the
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
   Open (2026-09-24): seed 819 of the reviewer's generator (mover N2) is capped on every engine
   since e145b3b. Its bumps go round a cycle between the mover N2, N4, E3 and E3's output OE3, and N2
   ends 800 px lower after each cycle. The order of two anchored nodes on one row (§3.5) is read once
   per call, and the log shows the same order in both pack rounds, so re-reading it is not the cause;
   reading it by id gives a different start from which the walk settles.

   **A column does not step aside for one of its outputs (2026-09-25).** When the node in the way of a
   bump is an output cell, its code cell's column does not move sideways, whichever move is smaller.
   The output's row goes down instead, by the ordinary downward move: the code cell, what sits under
   it in its column, and their outputs. Before, that sideways move took every code cell of the column
   onto the next column. Measured on H3 (the user's E1 run of 2026-09-25): C4, E10's output, sat above
   M6, so the code column 1800 (E7, E2, N11, E9, E10, E11 and the outputs C2 and C4) moved 900 px
   right, onto E1's column. A 7-node section reduced from that run slides the same way at 4a9f3db and
   at 76e4ec4. On those 7 nodes with E1 dragged 400 down (test 117), column 1800 moved 1700 px right
   before; now E10 and C4 go down to 3200 and nothing moves sideways.
   Only an output as the node in the way is covered. A code column still moves sideways when a node
   lands on one of its members. Measured on the same 7 nodes, every node dragged by −300 to 300 px on
   x and −400 to 1600 px on y: the calls that move a code cell sideways other than the dragged one
   are 47 at 4a9f3db and 39 now. The 39 move column 2600 (E1, M6) or column 3400 (E4).
   Measured with this change alone against 4a9f3db, on the reviewer's generator (7703 calls, §3.5):
   bad calls (capped, leaving a new pair closer than a gap, or changed by a second call) go from 316
   to 284; 16 are worse and 48 better. 15 of the 16 start with an output 200 px below its code
   cell's row, and 12 are capped. In the one traced (seed 969, mover N1), a wide member of the code
   cell's column, above the cell, lies on the output: the output's row goes under it, the cell lands
   on it, it goes down past the cell and lies on the output again, lower each time, until the walk is
   capped. At 4a9f3db the same walk ran, and a code column that moved sideways took one of its nodes
   out of it.

   **A cell pinned by the pack gives way to a node above it (decided by the user 2026-09-25 on H3).**
   When a bump would push a node down past the node below it, and that node below is pinned only
   because this call packs its column — not a mover, not the other half of a mover's pair, not held
   (§3.5) — the node below gives way instead. It drops by the overlap, with what sits under it in its
   own column, as a mover does. As for a mover, when the node above can step aside by a smaller move,
   it steps aside instead. A node that gives way never takes along the node it gives way to,
   even when that node is held to its row (§3.5): that node would land on it again. Before, only a node
   the operation placed gave way, and the node above went down past the packed cell. The user chose
   this over letting every node that is not held give way, pinned or not.
   Example (test 123, H3 reduced to six nodes): C5, E1's output, grows from 300 to 400 tall and reaches
   N10 (2300 wide), which goes 100 down, onto E3 at (4100, 1000). E3's column is packed because C3,
   held to N8 in E1's column, is in it. E3 gives way to 1100 and N10 stays at 900. At 1060d24 N10 went
   past E3, to 1400. The whole H3 result is under "A node hanging below a node of another column"
   (§3.5).

   **Packs and bumps take turns (2026-09-24).** After the bumps, the packed columns are packed again
   on the new rows, then the bumps run again, until a turn moves nothing, at most 4 turns; a capped
   walk still ends the call. A bump can move a node a pack read: a mover that yields below a node
   the bumps pushed down, a node a column packed around. Example: N8 and E1 dragged together, N5
   anchored to N8. The pack put N5 under E1's first row; the bumps then dropped E1 to 1600, onto N5,
   and a second call moved N5. Now N5 goes back under N8, to 800 (test 93). Measured on the
   reviewer's generator (7703 calls): not idempotent 775 → 233, a new overlap 97 → 66; no call worse.

   **A packed column reads its slot again between turns (2026-09-25).** After the bumps of a turn,
   every column the call packs reads its width and output slot again from where the nodes now sit,
   while it holds the same members. A column that moved right, by a bump or to make room for a new
   output (§3.5), changes which members of the column on its left stay a gap clear of it (§3.4), so
   that column's width and slot change. The next turn puts its outputs on the new slot, as the next
   call would, and the turns stop only when nothing moved and no slot changed. Example (test 122): on
   test 117's 7 nodes E1 runs, E4's column moves 700 right, M6 (800 wide, in E1's column) then stays
   a gap clear of it, and C1 goes to the new slot, 3500, in the same call; before, a second call moved
   C1 and E4. Measured on its own against 4a9f3db, no call is worse: bad calls on the reviewer's
   generator 316 → 207, in the tidy trials 88 → 69 and 237 → 191 (§3.5); the calls where one code
   cell's output is the mover and the 170 fixture calls are unchanged.

   **The turn cap.** When the turns have not settled after 4, the call runs once more on its result.
   If that moves nothing, the result stands. If it moves something, the call keeps what the first
   turn gave and reports it capped, as a capped bump walk does, so the MCP reply says to run Reflow
   (tests 99, 101). Measured: 365 of the 7703 calls used all 4 turns, and with 40 turns the same 365
   used all 40. Without the cap their results drifted further each call: in the case of test 99, N7
   moved 400 px per call where 26cf0ab moved it 100, and N8 1600 px where 26cf0ab moved it 400; with
   it they move 100 and 400 again. Capped calls: 135 of 7703 now, against 78 at 26cf0ab; of the 57
   that are capped now and were not there, 56 were not idempotent at 26cf0ab either.
   Since 2026-09-25 the first shape of test 99 (N7) settles: the dragged output OE5 lands on N3, and
   N3's column moves right to make room (§3.5). That shape is test 121 now; test 99 keeps the second.

   Open (2026-09-24), measured on the same 7703 calls:
   - a call that falls back to its first turn is reported capped, and the next call moves it again:
     all 56 such calls do;
   - a call whose turns do not settle, but whose result a second call leaves alone, is kept and not
     reported: 311 calls, and 6 of them leave a new pair of nodes closer than a gap.

   Three details the rule needs for a second call to change nothing:
   - a **sideways step is the overlap rounded UP to the grid**, so a column moves by one grid
     multiple and its nodes still share one snapped x — the next call reads the same column;
   - **no move carries the node doing the bumping**: a column does not slide while that node (or a
     cell the pack just laid out) sits in it, and the group that goes down leaves that node, and its
     pair partner, where they are. Carried along, it would keep the overlap exactly as it was;
   - the **column the pack just laid out is never pushed by a bump** (the pack owns its geometry),
     and a **code cell and its own output never bump each other** (they are one row, placed by the
     pack). Since 2026-09-25 a cell of that column that is not held can still give way downward to a
     node above it (above); where the next turn's pack puts it back, the two can fight, and the
     measurements under §3.5 count those calls.

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

**The output slot clears every code cell (2026-09-25).** A pair's output x is one gap right of the
column's width and one gap right of every code cell in the column, whichever is further. So a code
cell that the width rule leaves out still never touches its own output. Measured on H3 (the user's
E1 run of 2026-09-25): column 2600's width was 600, read off N3, because E1, N8 and N16 (700 wide)
and M6 (800 wide) end within a gap of N4's column at 3300. The slot was 3300, E1's right edge: the
new output C1 touched E1 and landed on E4 at (3400, 400). The slot is 3400 now (test 115; test 116
holds a 3-node shape). Reflow reads the slot from the same `derivePairs`, so its tight pass puts the
next column right of it and a second Reflow returns `{}` (test 116). Measured with this change alone
against 4a9f3db, on the reviewer's generator (7703 calls): 5 calls differ, 0 worse, 2 better.

**The obstacle test.** The row clears an obstacle by a full grid gap on y, the distance the bump
rule asks for everywhere: the obstacle counts while `obstacle.y + obstacle.h + GRID > y` and
`y + member.h + GRID > obstacle.y`. On x an obstacle to the LEFT of the column counts when it
reaches within a grid gap of the column x (the line the width rule draws); one at or right of the
column counts only on a real crossing, so a node the column merely touches is moved right by the
bump rule (§3.2) instead of the column stepping under it.

**The column head.** In a regular call the head keeps its own snapped y against a node a bump can
still move — it is where the user left it, and such a node is the bump rule's business. Against a
node no bump will move in this call (a member or output of a packed column, a mover, an anchored
node) the head clears a full gap like a stacked member, since no bump would part the two (2026-09-24,
test 100). It also clears the row of a node anchored in its own column, and that node's output. It
clears an anchored node of another column only once this call has put that node on its row. It
starts every round of the packs from the y it had when those rounds began, so a node the user left in
place moves only for a row a node really takes at the end (decided 2026-09-24: N7 went from 1800 to
2600 while N3 ended at 1000; test 94).
A loop can keep a head going up and down, so after 8 rounds the heads keep their current y and only
move down, which settles (test 95: two nodes moved together). A head that is a mover, or the other half of a mover's
pair, clears only its own column's anchored nodes; the others go under it.

**The column head on Reflow (2026-09-24).** Reflow runs no bumps, so a head that kept its y on a node
crossing it stayed on top of it. On Reflow every head clears obstacles like a stacked member. Two
more details, on Reflow only:
- a member's output clears obstacles too, on its slot at the member's row;
- the heads start every round of both Reflow packs from their rows before the Reflow (the tight pass
  moves x only), so a head the first pack moved down comes back once the tight pass has moved the
  column it cleared (test 98).

**The wide node gives way (decided by the user 2026-09-24).** When a node wider than its column
reaches a node of the next column, both clear each other, and the column packed first — the left one,
the wide node's — goes under. Example (test 97): W, 1400 wide at (0, 0) heading column 0, and N,
heading column 800 at (800, 100). W goes to (0, 500), under N, and E, under W, to (0, 900); N stays.
The other choice shown to the user made the wide node the obstacle for the column it reaches into, so
N went under W instead; on the H3 fixture it moved M4 from y 2000 to 3800. With this choice M4 keeps
(800, 2000). Measured over 3000 and over 6000 sections of the reviewer's generator: Reflows that leave
two boxes intersecting (a code cell and its own output apart) 0, and Reflows that leave two boxes
closer than a gap 0 (at 26cf0ab: 149 and 231 of 3000; at 76e4ec4: 125 and 257).

**Reflow.** Reflow's tight pass runs again while it still moves a column, at most 8 rounds, then
packs every column once more: a column's width is read off the members that stay clear of the next
column, so moving a column changes which of its neighbour's members span. Measured: 3 rounds on H1's
section, 2 on H4's S1 and S2, at most 5 over 1500 random dense sections, the cap never reached.
Each pack of the whole section repeats until a round moves nothing, at most 16 rounds, and keeps
every anchored node's row as a regular call does (§3.5, 2026-09-24).

**The pair rule on Reflow (decided by the user 2026-09-24).** Reflow keeps the output slot,
`OUTPUT_MIN_W` (600) plus two gaps, only right of a column where at least one cell has an output
node. A column whose code cells have not run yet ends at its own right edge, like a column of notes.
`derivePairs` gives `hasOutput` for this; its `right` still counts the slot for every column that
holds a code cell, because `forkOf` reads it so that a fork clears the outputs to come. Before this
decision the slot was kept for every column holding a code cell.

Measured (test 78): column 0 holds two code cells without outputs, and the notes J1 and J2 sit in
column 800. Reflow leaves them at x 800 (before: x 1500), and a second Reflow changes nothing. When
the first cell of column 0 then runs, its output lands at (800, 0), on J1. Until 2026-09-25 the bump
moved J1 and J2 down by 400, the smaller move, and the next Reflow moved them right to x 1500. Since
the rule for a new output of that day (§3.5), column 800 moves right to make room: J1 and J2 go to
x 1500 on their rows (test 118). On the current H4 S2 column 0 has outputs, so Reflow puts the
next column at x 1700 before and after the decision.

**The snap on Reflow (decided by the user 2026-09-24, option b).** Reflow first puts every node on a
column: a node joins the nearest column found so far that reaches it, or starts a column at its own
snapped x. A column on its left reaches it while no member of that column ends a full gap before it;
a column on its right reaches it only one grid step (100 px) away. Before, a node joined any column
within half a pair width (700 px); with the output slot kept only for a column with an output, a
column 600 wide or less put the next column inside that distance, and a second Reflow merged the two
(the H1 copy of 2026-09-24 11:39, S1; H2 S1). The tight pass reads a column's width off the members
that stay a gap clear of the next column, so a node one of them stays clear of is a column of its own
there, and a second Reflow does not merge a column the first one placed. Measured: E1 and F1 (code,
600 wide, no outputs, F1 at x 1500): Reflow puts F1 at x 700 and a second Reflow returns `{}`
(before: F1 merged into column 0). Over the reviewer's 3000 sections a second Reflow changes the
column set on 660 at 26cf0ab and on 0 now. The cost the user accepted: a node well left of a column
starts its own column (test 48: T1, 500 px left of a code column, keeps x 1000); with option b alone
the first Reflow differs from 26cf0ab's on 876 of the 3000.

Open: a second Reflow still moves something on 66 of the 3000 sections and on H2 S1 (6 nodes, test
15), without changing the columns. In the ones looked at (H2 S1 and five fuzz sections) the
anchoring map changes after the snap: two sources of one node end in one column, the tie then picks
the other one, and a second Reflow with the first map moves nothing.

### 3.5 A sequence edge anchors its target to the source's row (decided 2026-09-23)

A node that is the target of an edge leaving the source's right border and entering the target's
left border (a side the file leaves out counts as that border), with the source in a column strictly
left of the target's, is anchored to the source's row: its y is the source's y, the way an output
takes its code cell's y. Since 2026-09-25 the edge also has to carry `keepRow: true` (see "Which
edges hold" at the end of this section). The node types do not matter: a note, a file, a knowledge node, a code cell,
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
An output that is itself the mover is the exception: see "A new output on an anchored node" below.
A plain member of a packed column (not a mover, not the other half of a mover's pair, not
anchored, not an output) does not push the anchored node down. The anchored node keeps its row, and
the member's column packs around it, as §3.4 packs a column around any node crossing it. No bump
parts two packed nodes, so the pack itself has to leave the full gap:
- a plain member counts every node no bump will move in this call (the members and outputs of the
  packed columns, the movers, the anchored nodes) when it is within a gap of it on either side on
  x, not only when the two cross (tests 80, 82). Reflow runs no bumps, so there this is every node;
- the head of the member's column clears the anchored node too (test 76), within that same gap
  (test 88), once this call has put the anchored node on its row (test 84);
- a column packs around the outputs of its own anchored nodes, not only the nodes (test 90);
- a member never packs around a node anchored to it; that node goes under it instead (tests 86, 87).

A mover, or the other half of a mover's pair, does not pack around the anchored nodes of other
columns: they go one gap under it (tests 83, 85). Against every other node it clears what no bump
will move by the same gap as any member (2026-09-24: a mover dropped so it ended inside the gap
before a plain head of a packed column stayed next to it; it now goes one gap under that head,
test 92). The anchored node clears what holds its row by the same gap on either side, so
it goes under an output it would otherwise end 50 px short of (test 89).

The packed columns are packed again, in the same left-to-right order, until a round moves nothing,
at most 16 rounds (the heads' 8 of §3.4, then 8 more). One round is not enough: a column packed early
in the round reads the y of nodes that a later pack in the same round moves. The order of two nodes
anchored to one row is read once per call, from the positions before the call (decision 3b).

Why the source is on the list: a source that reaches its anchored node's column and is packed
around it moves the row the anchored node follows. Measured in the random-section check below,
without it: a source 1100 wide crossing the column, and a source 800 wide ending inside the gap
before it, each ended on top of the node anchored to it (test 79 holds the two shapes).

Measured on H3 (one section, test 74): E4 runs and its output lands at (2400, 400), on N8, which is
anchored to E7's row. Under this decision N8 went one gap under the output, to (2400, 800), and column
1600 packed around it: N10, 1400 wide and crossing column 2400, went to (1600, 1600), which is
800 + 700 + 100; N11 to (1600, 1800) and M6 to (1600, 2000). The rule built before this decision
(commit e78de64) sent N8 to (2400, 1000), under N10 at (1600, 800). Since the next decision (a new
output on an anchored node, below) N8 keeps (2400, 400), E4 and its output go to 1200
(400 + 700 + 100), N10 to 1600, N11 to 1800 and M6 to 2000. No two nodes are closer than one grid gap
except M1/M2 and N7/M3, the two pairs the user left that way in columns this call does not pack. A
second call returns `{}`.

**A new output on an anchored node (decided by the user 2026-09-24 on H3).** When a code cell's
output is the mover and it would land on a node anchored to another node's row, the anchored node
stays. The code cell and its output go down together to one gap under the anchored node; the output
stays on its code cell's row, and everything below the code cell in its column moves down to make
room.

The pack makes the move, not the bumps (`belowHeld` in `packColumn`). When it places the code cell, it
takes the first row where the output, at the x it has in this call, clears the anchored node by a
gap. The anchored node's own pack leaves that output out of the nodes it goes under, so the result
does not depend on which of the two columns packs first (test 109). A code cell that is anchored
itself leaves its own row the same way (test 110). Once the code cell has moved down, the cell and
its output also clear the nodes of columns this call does not pack whose top is above their new
row: such a node counts when it reaches into that row or ends less than a gap above it, and when it
is within a gap of the cell or the output on x, on either side (tests 112, 114). A node whose top is
at or below the new row is left to the bumps (test 113). Without this step, on the shape of test
112, the bumps sent the output under such a node and onto a node below it, the next pack put the
cell back under the anchored node, the turns did not settle, and the call returned the output on
top of that node, not reported as capped.

Scope:
- the anchored node is in a column this call packs, where no bump moves it. An anchored node in a
  column the call does not pack is moved by the bumps, as before (test 108). Measured with those
  nodes in scope too, against 56158b8: 8 of the 7703 calls of the reviewer's generator and 1 of the
  36528 tidy trials (NMAX=10 EMAX=7, below) got worse (capped, a new pair closer than a gap, or not
  idempotent), and all 9 had the anchored node in a column the call does not pack. In the one traced
  (seed 2613), the code cell went under E0 and landed on E0's source N2; the bump pushed N2 down, E0
  followed N2 onto the output, and the code cell went under E0 again, 400 px lower each time, until
  the walk was capped;
- the output's code cell is not the anchored node's source, directly or through a chain. A node
  anchored to the code cell still goes one gap under the output (the user's answer 2a, test 104). A
  node anchored to a node anchored to the code cell moves with the code cell, so the code cell cannot
  go under it: it goes under the output too (test 107). Without this, the code cell, the two anchored
  nodes and the output went 3200 px down with the output still on the node, and a second call moved
  them 3200 px more;
- a node the `riders` map anchors to a member of its own column is anchored to nothing there (see
  "A source in the same column is no source" above): its column moves right to make room (the next
  rule, test 111);
- an output landing on a node anchored to nothing moves that node's column right (the next rule,
  test 105);
- an anchored node carried onto another cell's output because its source moved goes one gap under
  that output, as before: that output is not the mover (test 106).

The rule acts only while the output is the mover. A later call that packs the code cell's column
without that output as the mover packs the cell back up to one gap under the cell above it; the
output then lands on the anchored node again, and the node goes under it. Measured on H3 after the
run: of the 33 calls with one node as the mover, 11 put E4 back at 400 and push N8 down (to 2200 in
9 of them, to 1800 when C2 moves, to 800 when C4 moves): each of E7, E4, N10, N11, E9, M6, E10, E11
and the outputs C1, C2 and C4. The user chose this over applying the rule in every call to every
output of a packed column. That variant kept the result in all 33 calls, but it failed tests 89 and
95 and left 6 calls of the reviewer's generator not idempotent that were idempotent at 56158b8.

The engine cannot tell a new output from one the user dragged: both are movers. A dragged output
that lands on an anchored node takes its code cell down the same way. This was shown to the user
with option A (the scope above), and the user chose A. An output the user resized by hand is told
apart since 2026-09-25: the resize path names it in `resized`, and the rule does not act for it (see
"An output resized by hand" below).

Measured on H3 (`tests/fixtures/H3.json` S1, test 103): E4 runs, and its output C6 gets the slot
(2600, 400), on N8 (2600, 0, 600×700), which is anchored to E7's row. N8 stays at (2600, 0), and C3,
anchored to N8, at (4000, 0). E4 and C6 go to 800 (0 + 700 + 100). Column 1800 moves down under E4:
N10, 2200 wide, would start at 1200, but N4 at (3300, 1000), 300 tall, lies across that row, so N10
goes one gap under N4, to 1400; N11 goes to 1600, E9 to 2000, E10 to 2400, E11 to 2800 and M6 to
3200. The outputs C4 and C2 take their cells' rows, and N16 takes E11's row, 2800. In column 2600,
N3 is a plain member (the edge from N10 to N3 leaves N10's bottom and anchors nothing): it goes under
C6 and then under N10, to 1600, and C5 goes under N16, to 3200. Before the call the only pair closer
than a gap is N8 and C6; after it, none. The call is not capped and a second call returns `{}`. At
56158b8 N8 went to (2600, 2200), under C6, N10, N3, C4 and C2, and C3 followed it to (4000, 2200).

Measured against 56158b8, both engines given the same calls. "Bad" is a call that is capped, leaves
a new pair closer than a gap, or is changed by a second identical call. The random generators are
the reviewer's; their settings are given here.
- H1 to H6, every node of every section as the only mover (170 calls): none differ. On H1, H4 and H5:
  capped 0, overlap growth 0, not idempotent 0, and a second Reflow moves nothing, before and after.
- The 394 distinct random sections: not idempotent 1, capped 2, overlap growth 0, before and after.
  They hold no output cells.
- The reviewer's section generator, seeds 1 to 3000: 3 to NMAX + 2 nodes (NMAX 6 unless given) on
  columns 0, 800, 1600 and 2400, some 100 px off, at rows 0 to 1100; about a third code cells, half
  of them with an output; 0 to EMAX − 1 right-to-left edges (EMAX 4 unless given). Sections with an
  anchored node, every node as the mover (7703 calls): capped 135 and 135, overlap growth 2 and 2, a
  new pair closer than a gap 37 and 36, not idempotent 231 and 230. None worse.
- One code cell whose output is the only mover, seeds 1 to 150000: the cell in a column of 1 to 4
  nodes, 2 to 6 notes in the columns right of it, 1 to 4 right-to-left edges from its column-mates
  or the notes to the notes; the output at its slot, or dragged up to 1500 px right and 600 px up or
  down; sections that start with a pair closer than a gap, the output aside, left out (34834 calls):
  with the output at its slot, bad 123 and 72, 2 worse (below); dragged, bad 131 and 72, none worse.
- A denser variant of it, seeds 1 to 250000 (29632 calls in each mode): with the output at its slot,
  dragged, and dragged with its code cell, 2, 3 and 1 calls worse (below), and none worse than
  bbf7978.
- Tidy trials: the section generator's sections after a 56158b8 Reflow, kept when that Reflow leaves
  no pair closer than a gap and a second Reflow moves nothing; each node as the mover without moving,
  each node dragged by a random step, four two-node drags, and each node deleted with its column
  closed. Seeds 1 to 2500.
  - NMAX 6, EMAX 4: 840 sections, 18589 calls, bad 88 and 88, none worse;
  - NMAX 6, EMAX 6: 1153 sections, 25295 calls, bad 118 and 119, 1 worse (below);
  - NMAX 6, EMAX 8: 1341 sections, 29416 calls, bad 149 and 150, 1 worse, the same call;
  - NMAX 10, EMAX 7: 1266 sections, 36528 calls, bad 240 and 237, none worse.
- Reflow on the section generator's 3000 sections: 0 leave two boxes intersecting and 0 leave a pair
  closer than a gap, before and after. A second Reflow still changes 66 of the 3000, before and
  after.

Open (2026-09-24), the calls that got worse:
- Not idempotent, seeds 80109 and 119447 (output at its slot). A bump pushes a node right, and the
  anchoring map the next call computes from the canvas is no longer the one this call had. On 80109,
  N0 now takes its source's row, lands on N2 and pushes it down; N2 then goes from x 900 to 1500 for
  the output, so N1's leftmost source is N0, not N2. On 119447, the output under N1 pushes N0 from
  x 800 to 1500, and the edge from N1 to N0 now anchors N0. Given the first call's map, a second call
  moves nothing on both. The engine takes the map as an input and cannot see the change.
- A new pair closer than a gap, tidy seed 837 (NMAX 6, EMAX 6 or 8): OE3 and E1 dragged 300 right and
  300 down. OE3 lands on E7, which is anchored to E6 and sits in a column this call packs, so E7 stays
  and E3 goes under it. E1's output OE1 then ends within a gap of E7's output OE7. No bump moves
  either of the two in this call, so they stay. At 56158b8, E7 went one gap under OE3, to 1200, which
  took OE7 clear of OE1.
- A second call can change a result while the anchoring map stays the same. In the one looked at
  (denser variant, seed 125350, output at its slot), a bump slides a node into a column this call
  packs, and the next call packs the node anchored to it: R0 comes back to A0's row, 0, and pushes
  the plain note P0 from (900, 0) to (1600, 0), into column 1600, which this call packs for R1. P1 is
  anchored to P0. The first call does not pack P1's column; the second does, and moves P1 from
  (3000, 400) to (3000, 0). On the denser variant, a second call changes the result with the map
  unchanged in all 2 worse calls with the output at its slot (seeds 117403, 125350), in 2 of the 3
  dragged (112349, 125350) and in the 1 dragged with its code cell (125350). The third dragged call
  (39017) is capped, and the first turn it keeps leaves the output on P1, a plain note below the new
  row in a column this call does not pack. All of them are as bad at bbf7978, so the rule for a new
  output sets them off, not the step that clears the nodes above.

**The next column makes room for a new output (decided by the user 2026-09-25 on H3).** When an
output cell is the mover (a new output, or one the user dragged) and it lands on a member of another
column, that column moves right by the overlap rounded up to the grid, with all its members and
their outputs, even when down is the smaller move. Any member type counts: a code cell, a note, a
file, a knowledge node (the user confirmed notes the same day). The column has to be at or right of
the output's x; a wide member of a column on the left still moves down. Columns further right move
by the ordinary bumps (§3.2).

Where the rule does not apply:
- the member is held to a source in another column. In a column the call packs it keeps its row and
  the code cell goes under it ("A new output on an anchored node" above); elsewhere the bumps move
  it (test 108). A node held to the output's own code cell goes one gap under the output (test 104);
- the column holds a mover, the other half of a mover's pair, or a held node the output's code cell
  went under in this call. The column keeps its x and packs around the output (test 103: N3, in the
  column of N8, goes under C6);
- the output was resized by hand, not placed or dragged (decided by the user 2026-09-25, below);
- the member reaches over the next column on its right, or ends less than a gap before it: a member
  that does not set its column's width (§3.4). It goes down by the ordinary bump; a column whose
  members stay clear of the next column still moves right (decided by the user 2026-09-25, below).

In a column the call packs, the move is made before the column packs (`makeRoom` in `layoutCall`);
elsewhere a bump makes it (`resolveBumps`).

Example (test 118): E1 and E2 in column 0 have no output; J1 (800, 0) and J2 (800, 400) are 700
wide. E1 runs, its output lands on J1, and column 800 moves 800 + 600 + 100 − 800 = 700 right: J1
and J2 go to x 1500 on their rows. Before, J1 and J2 moved 400 down. Tests 119 (a code cell), 120 (a
column the call packs) and 121 (a dragged output) hold the other cases.

Measured on H3 (`tests/fixtures/H3-E1.json`, H3 before the user ran E1 on 2026-09-25, geometry only;
test 115; the host's run path replayed on the same file gives the same moves):
- the slot is (3400, 400) (§3.4), and C1 lands on E4 at (3400, 400);
- column 3400 (C3, E4, W1) moves 3400 + 600 + 100 − 3400 = 700 right: C3 to (4100, 0), E4 to
  (4100, 400). C3 keeps its row but not its x: it is a member of column 3400;
- the call packs column 3400, because C3 is held to N8 in E1's column, so W1 also moves up, from
  (3400, 1400) to (4100, 1000), one gap under N10;
- nothing else moves: column 1800 and N8 stay. No pair is closer than a gap after the call, and a
  second call returns `{}`.
At 4a9f3db the same run moved 17 nodes (column 1800 to x 4200, N8 and C3 to y 2500), left C1
touching E1, and a second call moved 6 more.

Measured against 4a9f3db with the four changes of 2026-09-25: the output slot that clears every code
cell (§3.4), a column that does not step aside for one of its outputs and a packed column that reads
its slot again between turns (§3.2), and this rule. "Bad" is as above:
capped, a new pair closer than a gap, or changed by a second call.
- H1 to H6, every node of every section as the only mover (170 calls): none differ. On H1, H4 and
  H5: capped 0, overlap growth 0, not idempotent 0, and a second Reflow moves nothing, before and
  after.
- The reviewer's section generator, seeds 1 to 3000 (7703 calls): bad 316 and 193 (capped 135 and
  134, a new close pair 36 and 30, changed by a second call 230 and 101); 34 worse, 157 better.
- Tidy trials, NMAX 6, EMAX 4 (18589 calls): bad 88 and 70; 8 worse, 26 better. NMAX 10, EMAX 7
  (36528 calls): bad 237 and 186; 20 worse, 71 better.
- One code cell whose output is the only mover, seeds 1 to 150000 (34834 calls): with the output at
  its slot, bad 72 and 189, 146 worse, 29 better; boxes intersecting 22 and 2, capped 13 and 3,
  changed by a second call 36 and 185. Dragged: bad 72 and 75, 21 worse, 18 better.
- Reflow on the generator's 3000 sections: 0 leave two boxes intersecting and 0 leave a pair closer
  than a gap, before and after; a second Reflow changes 66, before and after.

Open (2026-09-25), the calls that got worse, by what the result shows:
- The anchoring map changes: the column moved right takes a node past the source of an edge drawn
  right to left, and the next call reads that edge as holding the node. Given the call's own map, a
  second call moves nothing. With the output at its slot 128 of the 146, dragged 14 of the 21, the
  generator 8 of the 34, the tidy trials 3 of the 28. Seed 1164 (output at its slot): N0 moves from
  x 1600 to 2300, right of N2 at 1700, and the edge from N2 to N0 then holds N0 on N2's row. N0 is
  1100 wide and reaches over column 1700; since 2026-09-25 it goes down instead (below, test 128).
- Two columns become one: the column moved right lands on the x of the next column, the ordinary
  bumps move the nodes of that column down rather than right, and the next call packs the two as one
  column. With the output at its slot 18, dragged 7, the tidy trials 24, the generator 6. 3 more in
  the generator come from the §3.2 change for outputs, where the walk then moves another column
  sideways onto the next one (seed 1519, mover N3). Tidy seed 480 (NMAX 10, EMAX 7, OE4 dragged):
  column 1500 moves 700 right onto E3's column at 2200, and E3 goes down 2200 under the notes that
  came with it. Pushing the next column right instead, whenever a column moved for an output lands on
  it, was measured and changes almost nothing (tidy NMAX 10: 24 worse → 22 without the slot read
  again between turns, 20 → 18 with it): the column landed on is most often one the call packs, and
  no bump moves those.
- Capped: the generator 18. 12 come from the §3.2 change for outputs (the walk described there), 6
  from this rule, where the columns it moves start the same walk (seed 328, mover OE5). Seed 1390,
  mover OE4, is capped and also has two columns become one.
- One tidy trial leaves a new close pair (NMAX 10, EMAX 7, seed 1689, OE2 dragged 400 right and 600
  down): at 4a9f3db OE2 went down 200 under N5 and E6, held to OE2's code cell, followed it. Now N5's
  column moves right instead, E6 stays at 1000, and the pack of column 3500 puts E1 at 600, where its
  output OE1 (500 tall) reaches 100 px into E6's output OE6. A regular pack does not check a member's
  output against the nodes it packs around.

**An output resized by hand (decided by the user 2026-09-25).** An output the user resizes is a
mover too, and until this decision an output that grew onto a member of the next column moved that
column right. The webview's resize handler (`skena:nodeResize`) now names the resized node in
`resized` (`LayoutOpts`). A resized output is not a moved output: it pushes what it grows onto with
the ordinary bumps (§3.2). The engine also leaves it out of "A new output on an anchored node": a
held node it grows onto goes one gap under it, as under any output that is not the mover. That second
part was not asked about; it follows from how `resized` is built.
Example (test 127): E at (0, 0) with its output O at (800, 0), grown from 300 to 500 tall; a note N
at (800, 500) and E2 at (0, 400). N goes 100 down, to (800, 600); before, it went to (1500, 500). E2
goes to (0, 600) either way, one gap under E's row, which O now ends at 500. The same geometry with O
as a new output still moves N to (1500, 500).
A size change the MCP makes (`canvas_update_node`) does not pass `resized`.

**A member that reaches into the next column (decided by the user 2026-09-25).** A new or dragged
output that lands on a member reaching over the next column on its right, or ending less than a gap
before it (a member that does not set its column's width, §3.4), no longer moves that member's
column right. The member goes down by the ordinary bump (§3.2). A member that stays clear of the next
column still moves its column right: test 118 (J1 and J2 to x 1500) is unchanged. When the output
lands on both kinds in one column, the column moves right for the one that stays clear and takes the
other along.
Example (test 128; the reviewer's generator for one output, seed 1164, output at its slot): N0, 1100
wide, is the only member of column 1600 and reaches over column 1700. At 1060d24 N0 went to (2300,
400), right of N2; the edge N2 → N0 then held N0 on N2's row, and a second call moved N0 to (2300,
1200). Now N1 takes A0's row and pushes N0 100 down, O moves N0 down by the overlap, to 1000, and N0
goes one gap under N2, to (1600, 1200), as before 0.17.66. A second call returns `{}`.

Test 75 (two nodes anchored to one row; X, 1500 wide, crosses R's column): X is anchored itself, so
R goes one gap under it, to (1600, 800), and a second call returns `{}`. Measured with a variant in
which only outputs, movers and their pair partners hold the row: R takes S's row, 400, on top of X.
Both are anchored nodes of packed columns, so no bump parts them. This variant reproduces an
overlap in test 75 like the one the first try at this choice left.

Measured with a random-section check: sections of 4 to 10 nodes at random rows on columns 0, 800,
1600 and 2400, random sizes, two random right-to-left edges, one random node as the mover. Its random
generator repeats, so 1500 draws hold 394 distinct sections; each counted once, before this decision
(commit 76e4ec4) and after: not idempotent 28 and 14, capped 1 and 1, the overlap count grows 0 and
0. The first version of this change, with no source on the list and no gap on either side, grew the
overlap count on 3 of the 394.

A review of that first version found three more shapes: a member packed next to a packed node it
only came within a gap of, a mover below its column's head pushed off its row by an anchored node,
and a head moved down for a row an anchored node was about to leave. The list above covers them.
Measured on a second generator (3000 distinct sections of 3 to 8 nodes and up to 3 edges; on those
with an anchored node, every node as the mover, 7703 calls), before this decision and after: capped 99 and 78, the overlap count grows
12 and 2, a call leaves a new overlap 204 and 100, not idempotent 1229 and 775. Three calls leave a
new overlap that did not before; in each, the packs end clean, then a bump moves a source down and
its anchored node follows it into a member of its own packed column (**Bumps** below). On copies of
H1, H4 and H5 (the fixtures in `test/` on 2026-09-24), every node as the only mover: capped 0,
overlap growth 0, non-idempotent 0, and Reflow twice changes nothing on the second call, before and
after.

**On Reflow.** Reflow packs every column, so every anchored node keeps its row against a plain
member there too, by the same rules, and the packs repeat until a round moves nothing, at most 16
rounds. A node the snap has put in its source's own column is not anchored (see above), so it does
not keep a row either (test 91). Before 2026-09-24 Reflow gave its packs no anchored nodes to keep,
so a wide column head, or a member ending inside the gap before an anchored node's column, was left
on top of the anchored node (test 81). Measured, test 15's check: a second Reflow on H3's S1 moved 11
nodes before and moves none now; on H2's S1 it moves 19 before and after (the snapping distance,
§3.4). On the second generator's sections with an anchored node, a second Reflow changed something
on 192 at 76e4ec4 and 290 at 26cf0ab (the column merge of §3.4); with the snap of option b and the
head rules on Reflow it is 30.

Removing an edge that holds its target releases the cell: the webview runs the engine for the
target's column at once and the cell packs up to the first row it clears (E14 lifts to y 1100, under
E15). Adding an edge moves nothing since 2026-09-25 ("Which edges hold", below). Before, adding such
an edge anchored the target at once: it moved onto the source's row and its old column re-packed.

**Bumps.** The engine does not move an anchored node inside the columns the operation packs. Anywhere
else a bump treats it like any node: it can be pushed off its row (a sideways push takes its whole
column, a downward push what is below it), and the next pack of its column puts it back on the
source's row. Decided 2026-09-23 on the H4 case where a node dropped on an anchored node left both
overlapping with nothing reported. An anchored node in a column this call packs follows a downward
bump of its source, with its own output; a sideways bump changes no y. An anchored node elsewhere
follows too, unless it is a source, directly or up the chain, of the node doing the bumping
(2026-09-24): E3, moved and anchored to N4, N4 anchored to N2 in a column not packed. E3 pushed N2
down, N4 followed N2 onto E3, E3 yielded below N4 and pushed N2 again, 100 px lower each time, capped
even at 10 000 steps (test 96). A first version stopped every anchored node outside the packed
columns from following; that made five calls of the reviewer's generator worse than 26cf0ab (seed
1600 became a walk that moves 800 px lower each cycle) and seed 1600 is test 102 now. The narrower
rule gives those five 26cf0ab's result or better; seed 3892, which the first version settled, is
capped again, as at 26cf0ab.

Open (2026-09-24): the rule does not catch a loop that runs through a third node. Example: N5, 1500
wide, is moved; N0 is anchored to N3, and N1 sits between them. N1 pushes N3 down, N0 follows N3 and
lands on N1, N0 pushes N1 down, and N1 pushes N3 again, 600 px lower each round, until the walk is
capped. 610b737 settled the same call with N0 at (3200, 100), N1 at (2400, 900) and N3 at (1700,
1300). Measured on the reviewer's generator: 30 calls are capped now that 610b737 settled with no new
close pair and a stable second call; 29 of them were capped at 26cf0ab too. The columns a call packs are the movers' columns plus,
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

**A node hanging below a node of another column moves down with it (decided by the user 2026-09-25
on H3).** On H3, N10, a note 2300 wide, has edges from its bottom border to the top borders of N11,
N3 and N4, and N4 has one to W1. When N10 moved down, only N11, in N10's own column, came along. The
user decided that such nodes move down with the source, by the same amount.

Which pairs count (`hangingBelow(nodes, edges)`, source id → target ids):
- the edge leaves the source's bottom border and enters the target's top border;
- the target's top is at or below the source's bottom;
- the two x-spans cross, and the two are in different columns (a target in the source's own column
  packs under it anyway);
- the target is a column member and not a band; the source is not a kernel badge or a band;
- a pair is left out when the source is held, directly or up the chain, to the target or to a node
  under the target in its column: the source would follow the target's row while the target
  follows the source down. Which node is held to which is read from where the nodes are now
  (test 129).

What moves:
- when the packs move a source down, its targets and what sits under them in their own column move
  down by the same amount, in the columns the call does not pack. A target in a packed column is
  placed by its pack (test 124);
- when a downward bump moves a source, its targets and what sits under them come along the same
  way, except when the source is the node that gives way (§3.2): a pack puts that node back up in
  the next turn or call, and its targets went down again with every yield (test 132);
- a source does not pack around its targets, nor around what sits under them in their column, since
  those follow it or pack under it. A target held to another node's row keeps that row, and the
  source packs around it (tests 124, 130);
- a turn in which nodes followed runs the packs again, so a node held to one of them takes its new
  row in the same call (test 131).

**A node the user drags down (decided by the user 2026-09-25).** The engine sees a dragged node
already moved. So the webview passes where each moved node sat before a mouse drop or a keyboard
step (`draggedFrom`), the targets follow by the drag's amount, and the pairs are read from the
positions before the drag: a node dragged onto or past a node hanging below it still takes that node
along (test 126). Down only: after an upward drag the targets stay. Measured, not built: letting the
targets follow an upward drag too changes 31 of the 25718 tidy trials with mixed edges (NMAX 10,
EMAX 7; bad 105 either way) and 17 of 10981 with NMAX 6, EMAX 4 (bad 40 either way).

Measured on H3 (`tests/fixtures/H3-C5.json`: H3 on 2026-09-25 before the user resized C5, E1's
output, geometry only; the webview's resize path replayed on the same file; test 125):
- C5 from 300 to 400: N10 and, under it in column 1800, N11, E9, E10, E11 with the outputs C1 and C4;
  N4, W1, N3, N16 and M6 in column 3300; and E3 with its output C2 all go 100 down. E3 gives way
  under N10 (§3.2); N4 and N3 hang below N10 and W1 below N4, and N16 and M6 sit under them. At
  1060d24 N10 and column 1800 went 1200 down, N16 1900 down, N4, W1, N3 and M6 100 down, and E3 and
  C2 200 up, to 800;
- C5 to 600 or to 900: the same 12 nodes of columns 1800 and 3300 go 600 down; E3 and C2 go up to
  800, as they do at 1060d24. At 1060d24 the result at 600 is the one at 400; at 900, N16 went 2400
  down and the other 11 went 600;
- in all three, no call is capped, no pair is closer than a gap after the call, and a second call
  returns `{}`.

Measured against 1060d24 with all the changes of 2026-09-25 made after it: the cell pinned by the
pack that gives way (§3.2), this rule with the drag, and the two exceptions to "The next column makes
room for a new output" above (no call below resizes an output). "Bad" is as above: capped, a new pair closer than a gap, or changed by a
second call; the output generator also counts two boxes that intersect. The tidy trials pass the
positions before a drag, as the webview does.

| Calls | Count | Bad at 1060d24 | Bad now | Worse | Better |
|---|---|---|---|---|---|
| H1 to H6, every node as the only mover | 170 | 1 | 0 | 0 | 1 |
| The reviewer's section generator, seeds 1 to 3000 | 7703 | 193 | 191 | 24 | 26 |
| The same with half the edges bottom to top | 4949 | 121 | 125 | 16 | 12 |
| Tidy trials, NMAX 6, EMAX 4 | 18589 | 70 | 63 | 0 | 7 |
| Tidy trials, NMAX 10, EMAX 7 | 36528 | 186 | 172 | 0 | 14 |
| Tidy trials, NMAX 10, EMAX 7, half the edges bottom to top | 25718 | 112 | 105 | 0 | 7 |
| One code cell whose output is the only mover, at its slot | 34834 | 189 | 91 | 13 | 111 |
| The same, the output dragged | 34834 | 75 | 64 | 3 | 14 |

On the fixtures 3 calls differ: H1 mover X4 (the cell that gives way; 10 nodes move instead of 5,
both results clean), H2 mover N3 (this rule; C14 and N10 end 10 px lower) and H2 mover N5 (the cell
that gives way; at 1060d24 a second call moved 2 nodes, now none). On H1, H4 and H5: capped 0,
overlap growth 0, not idempotent 0. Reflow is unchanged: on the generator's 3000 sections 0 leave
two boxes intersecting, 0 leave a pair closer than a gap, and a second Reflow changes 66, before and
after. With the output at its slot: capped 3 and 13, two boxes intersecting 2 and 8, changed by a
second call 185 and 73.

Open (2026-09-25), the calls that got worse, by the change that each goes away without:
- The cell that gives way (§3.2): 21 on the section generator, 15 with bottom-to-top edges (one of
  them also needs this rule). In 16 of the 21 one node gives way in every turn, the next turn's pack
  puts it back on its row, and the turns do not settle: the call keeps its first turn and is reported
  capped, or keeps its last turn with a new close pair. That node is an output in 14 of the 16 (seed
  1285, mover E1: OE6, the output of E6, which is held to E1's row). In the other 5 the bump walk
  itself runs out of steps (seed 544, mover N1: N0, packed under N1, gives way
  under N2, lands on N2's source N4 and pushes it down, N2 follows N4 onto N0, and N0 gives way
  again, 400 px lower each step). Seeds: 544, 663, 823, 947, 1177, 1285 (four movers), 1600 (two),
  1608, 1689, 1944, 2106 (two), 2122 (two), 2485, 2809, 2909.
- A member that reaches into the next column: 13 with the output at its slot, 3 dragged, 3 on the
  section generator. Of the 13, 5 leave two boxes intersecting (seeds 26178, 83237, 92615, 100254,
  114269), 3 are capped walks in which the output pushes the member down every step (16529, 30528,
  39292), 1 more is capped (96651) and 4 are changed by a second call (29540, 46443, 73900,
  133800). Traced, seed 26178: the output lands on N2, 1100 wide, which sits above it; the output
  gives way under N2, the next turn's pack puts its code cell E back on its row, and the turns do not
  settle. The call keeps its last turn, where N0, held to E's row, lies on N1.
- This rule: 2 with bottom-to-top edges. Seed 2745, mover N2, a section that starts with 11 pairs
  closer than a gap: N0 hangs below OE6 and N2. In the trace N0 comes along when E6's row is pushed
  down, lands on N4 and N1, and the bumps among these nodes run until the walk is out of steps.
  Seed 339, mover N1, needs this rule and the cell that gives way.

The engine takes the anchoring as an input: `layoutSection(nodes, { riders, hanging })` /
`reflowSection(nodes, { riders })` with `riders: Map<targetId, sourceId>` and `hanging:
Map<sourceId, targetIds>`, computed by every caller from the canvas edges with the shared pure
`ridersOf(nodes, edges)` and `hangingBelow(nodes, edges, draggedFrom?)` in `layoutEngine.ts`.
Callers: the webview (`runEngine`, `runEngineAfterMove`, edge add/remove), the host
(`layoutAround`), the MCP server (`applyEngine`, `canvas_remove_edge`, `canvas_update_edge`). Two
options come from the webview only: `draggedFrom` from `runEngineAfterMove` (a mouse drop or a
keyboard step) and `resized` from the resize handler. Reflow takes no `hanging`: it packs every
column.

Every edge path that drops a hold runs the engine for the target: webview edge delete, keyboard
disconnect, a node delete, the input edge `onConnect` and `onConnectEnd` replace; MCP
`canvas_remove_edge`, and `canvas_update_edge` when the new sides end the hold. A path that creates
an edge runs no engine call for it (below).

**Which edges hold: `keepRow` on the edge (decided by the user 2026-09-25 on H3).** Connecting two
nodes never moves anything. A right-to-left edge holds its target on the source's row only when the
edge carries `keepRow: true`. The field is stored on the edge object in the `.canvas` file
(`CanvasEdge.keepRow`). `ridersOf` reads the field and the conditions above, nothing else: an edge
with no `keepRow`, or with `keepRow: false`, holds nothing.

Before, every such edge held its target, and drawing one moved the target onto the source's row at
once. On H3 the user connected M1 to M6: M6 went from y 3100 to M1's row, 0, and N10 and E9 went
200 down under it. `tests/fixtures/H3-M1M6.json` holds the four nodes of H3 that still show it
(test 134). Now the edge gets `keepRow: false` and nothing moves.

When holding moves nothing (`holdsInPlace`): the edges under test are read as `keepRow: true`, every
other edge as stored. An edge passes when `ridersOf` then picks its source for the target, and a pack
of the target's column (`layoutSection` with `columnX`, those holds and `hangingBelow` of the same
edges) leaves the target's y where it is.

On load (`markKeepRowOnLoad`): an edge the file stores with no `keepRow` gets `keepRow: true` when
holding moves nothing. All such edges of a section are tested at once, so the pack sees every hold
the engine read before this decision. An edge that has the field, `true` or `false`, is left alone.
Nothing gets `false` on load: an edge that fails keeps no field and is tested again at the next
load. No save runs for the marks; they reach the file with the next save.
- The editor marks when it opens a canvas and when it reloads one from disk (`openedCanvas` in
  `editor-provider.ts`), so the webview and the host's copy hold the same marks. On a reload, a mark
  the editor holds and has not saved yet is kept for an edge the file stores without the field.
- The MCP server marks on every read (`readCanvas` in `mcp/server.ts`). A tool that writes the file
  writes the marks with it.

At creation (`keepRowOf`): a new edge gets `keepRow: true` when holding moves nothing, the other
edges read as stored, and `keepRow: false` otherwise. No engine call runs for the new edge. The paths:
- webview: drag-connect (`onConnect`), a connection dropped on a node (`onConnectEnd`), the `c` key,
  paste onto a node (`skena:nodesFromDrop`), and every node created with an edge
  (`skena:addNodeResult`: Shift+hjkl, a connection dropped on empty canvas, a pinned output, a paste
  beside the focused node, the host's add-node). A node created with its edge is still laid out as
  the mover, as before; it keeps the source's row only when its edge got `keepRow: true`;
- MCP: `canvas_add_edge`, and the edge of a `canvas_pin_output` that is not adopted as the cell's
  output;
- an input edge of a code cell that `onConnect` or `onConnectEnd` replaces still releases the node
  it held, as a removed edge does.

When an edge's sides change: MCP `canvas_update_edge` with a new `fromSide` or `toSide` tests the edge
again, the same way. When the edge stops holding its target, the target's column packs, as when the
edge is removed; when it starts, nothing moves. The webview has no path that changes an edge's sides.

A held node the user drags far off its row keeps `keepRow: true`. The call after the drag puts it
back on the source's row, as before (test 138).

Tests 133 to 138 hold the rule. 56 of the 132 tests written before it fail without `keepRow: true`
on their edges. Every right-to-left edge in them now carries it, and the fixture edges are all read
as holding (`allHeld`), so they test the engine as before. 45 of the 132 fail when each edge is
instead marked by the load rule the first time a call reads it. The 38 counted before this decision
were counted by position alone: the target on the source's row, or one gap under the source's output
on that row.

Holds the load rule keeps on the fixtures, of those the engine read before: H1 7 of 7, H2 3 of 6,
H3 8 of 8, H4 13 of 15, H5 3 of 3, H6 1 of 1; 35 of 40. H2 loses C14 held to N1, N4 to N3 and C2 to
N7; H4 loses N7 held to N24 and N11 to N26 (test 136).

Measured against 59da217, both engines given the same calls. The edges of every generated section and
every fixture section get the load marks first; the engine at 59da217 reads every edge as holding.
"Bad" is as above: capped, a new pair closer than a gap, or changed by a second call; the output
generator also counts two boxes that intersect. "With a hold" = the calls whose section has at least
one hold before the call, at 59da217 and now.

| Calls | Count | With a hold | Bad at 59da217 | Bad now | Worse | Better |
|---|---|---|---|---|---|---|
| H1 to H6, every node as the only mover | 170 | 170 / 168 | 0 | 0 | 0 | 0 |
| The reviewer's section generator, seeds 1 to 3000 | 7703 | 7703 / 610 | 191 | 71 | 26 | 146 |
| The same with half the edges bottom to top | 4949 | 4356 / 400 | 125 | 61 | 21 | 85 |
| Tidy trials, NMAX 6, EMAX 4 | 18589 | 17047 / 16995 | 63 | 59 | 1 | 5 |
| Tidy trials, NMAX 10, EMAX 7 | 36528 | 34711 / 34600 | 172 | 163 | 4 | 13 |
| Tidy trials, NMAX 10, EMAX 7, half the edges bottom to top | 25718 | 23377 / 23309 | 105 | 97 | 1 | 9 |
| One code cell whose output is the only mover, at its slot | 34834 | 30067 / 2700 | 91 | 2 | 0 | 89 |
| The same, the output dragged | 34834 | 30067 / 2700 | 64 | 2 | 2 | 64 |

On the fixtures 20 of the 170 calls differ: 9 in H2 and 11 in H4, the two with holds lost. Reflow on
the generator's 3000 sections: 0 leave two boxes intersecting and 0 leave a pair closer than a gap,
before and after; a second Reflow changes 66 at 59da217 and 0 now. The section generator and the
output generator put nodes at random rows, and the load rule marks few of their edges: a call there
has a hold in 610 of 7703 and 2700 of 34834 calls now. The tidy trials start from a Reflow.

Open (2026-09-25), the calls that got worse, none traced:
- section generator (seed and mover): 328 E4, 328 N7, 404 E1, 404 OE1, 404 N5, 633 OE4, 819 E1,
  819 OE1, 839 N5, 1027 OE5, 1183 N0, 1550 E0, 1585 N4, 1783 OE0, 1784 E4, 1785 OE5, 1841 E3,
  2042 E2, 2042 N4, 2413 OE1, 2709 E2, 2762 N0, 2762 E5, 2791 N5, 2884 N4, 2988 E2;
- the same with bottom-to-top edges: 69 N3, 211 N1, 211 E2, 213 E2, 404 E1, 404 OE1, 404 N5,
  420 N1, 633 N1, 819 E1, 819 OE1, 947 OE6, 1027 OE5, 1684 N4, 1784 E4, 2084 E4, 2549 N1, 2549 E7,
  2622 OE4, 2709 E2, 2791 N5;
- tidy trials (seed, movers, drag): NMAX 6, EMAX 4: 2486, E2 and OE1, 200 right and 200 up. NMAX 10,
  EMAX 7: 407, OE11 and N1, 900 right and 200 up; 1168, E0 and E9, 100 right and 300 down; 2148, E5
  and N4, 400 right and 600 up; 2213, N5 and N2, 100 right and 300 down. With bottom-to-top edges:
  1828, E5 and E1, 800 right and 500 down;
- the output dragged: seeds 22932 and 106116.

Other open items:
- the load rule writes no `false`, so an edge that fails is tested again at every load and can pass
  later, once its target sits where holding moves nothing;
- a new connection that replaces a code cell's input edge still releases the node that edge held,
  so that connection can move one node;
- the AI companion's `add_note` in the host writes its edge with no `keepRow`. Read in the code, not
  run: the reload from disk that follows marks it.

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
| `tests/layout-engine.mjs`, `tests/mcp-parity.mjs` | §6 |

## 6. Tests

`tests/layout-engine.mjs` on the esbuild bundle: insert pushes the column only; delete pulls up to
one gap; output growth shifts the pairs to the right and shrink pulls them back; a note column packs
like a code column and a note in a code column packs with it; a push never crosses a section
boundary; idempotence; `codeCellHeight` at the grid steps and the cap; Reflow on copies of `test/H1–H5.canvas` under `/tmp` (never the real
files): no overlap, one-gap columns, every code cell on a column x. `tests/mcp-parity.mjs` gains
`after`, `forkOf`, `canvas_reflow_section` and the engine on `canvas_add_node` with x/y.
