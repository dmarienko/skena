# Skena v1 — Spatial Notebook (design spec)

**Status:** design agreed in a brainstorm (2026-09-01). Not yet a build plan. A handful of small
items are still open (listed at the end). This is the next major version (v1.x); the MVP baseline
is tag `v0.16.25-mvp`.

**Visual companion:** the annotated mockups live in
`docs/redesign/spatial-notebook.html` (published artifact:
`https://claude.ai/code/artifact/d414e12c-318e-4d07-bf37-7f5e0aef14b4`).

**Concrete example** the user hand-built: `test/H3.canvas` — the source of the internal-layout
geometry (down = flow, right = output, fork = new column; zone title bars; grid 100).

---

## Why

After real use, ~90% of canvas time went to fixing node placement and sizing. Root cause: skena
models a free-form 2-D canvas, but the work is a mostly-linear notebook flow. v1 gives the code
flow structure and keeps 2-D freedom for the rest.

## The model in one paragraph

The canvas is a **bounded** field (origin top-left, grows right + down) holding a **vertical stack
of sections**. A **section** is a kernel-tinted band with a zoom-steady header; **everything lives
in a section** (no free-floating nodes). Inside a section, a **layout engine** packs nodes on a
grid — never overlapping, always a visible gap — with code running **down**, output stuck to its
**right**, and **forks** opening new columns left or right. Kernels belong to sections; **execution
never depends on connections**. Navigation **only pans, never auto-zooms**. A git-tree **minimap**
indexes the sections.

---

## 1. Substrate — the slot grid

- Nodes occupy whole **slots**; move and resize snap to slots (no arbitrary sizes).
- Slots are **portrait** (golden: `grid_h ≈ 1.61 × grid_w`); `grid_w ≈ ¼ of an 80-char line`.
- Already shipped and reused: `src/shared/constants.ts` holds one `GRID` (=100 today) + a per-type
  `NODE_SIZE` table; drag/resize snap to it. v1 formalizes per-type widths as slot-counts
  (doc ≈ 4 slots, code ≈ 3).
- **Open:** final slot pixel size once the base font is fixed. Code auto-height: leaning chunky
  per-slot growth over smooth-then-snap.

## 2. Bounded canvas

- Hard **top-left origin (0,0)**; nothing pans, jumps or lands above/left of it. Grows right + down
  only. **One-slot gutter** at the corner; hard clamp (no overscroll).
- **Migration:** existing canvases live in negative space (`live-slippage` near x = −5700) →
  normalize on open (shift so the min corner sits at the origin).
- Unlocks a `Home` key (jump to origin).

## 3. Section

- A kernel-tinted **band, open on the right**, with a **zoom-steady header**: fold ⌄ · title ·
  **creation time** · kernel LED+name · `#S<n>` address · delete ✕. Drawn in screen space, so it
  never scales.
- The header replaces the old circular kernel node and doubles as the bird's-eye / minimap label.
- Sections are **addressable**: `<file>.canvas#S3` opens the canvas and centers that section (like
  today's node references).
- **Foldable** (collapses to the title bar, which always survives) and **deletable**.

## 4. Layout engine (inside a section)

Nodes are packed by an engine, not placed by pixel. Rules:

1. **Never overlap.**
2. **Always ≥ 1 grid-cell gap** between any two node borders — connections are drawn through the gap.
3. **Insert / remove between** reflows the rest; nothing overlaps.
4. **Drag & drop** to a new spot → layout recomputes to fit.
5. **Resize** → neighbours reflow; the section grows taller if needed.
6. **Code cell**: starts at the `NODE_SIZE` default, **grows with its lines** up to a max height and
   shrinks back (Jupyter-style); sizes are grid-multiples.
7. **Output cell**: **stuck to its code** (moves with it); **empty output → no cell**; starts wider
   than a code cell and **grows to a max width (const)**; resizing still obeys 1–5.

**Arrangement (from H3):** code runs **down** (the sequence), output attaches to the **right**, a
**fork opens a new column** (left or right; a right fork sits beyond the output). Docs and notes go
**anywhere** in the section, not pinned to a side.

## 5. Connections (edges)

Typed, each drawn **separately** (never bundled into one line), routed orthogonally through the
guaranteed gaps so every connection stays traceable. Color = meaning:

- **code → code** (one color): records the **sequence** (down-flow + fork). Optional — a cell needs
  no connection to run. Engine-drawn.
- **code → output** (another color): the stuck-output edge. Engine-drawn.
- **context** (varies by group): the **paragraph-anchored links** (paragraph → node or
  paragraph → paragraph). User-drawn.

**Execution ≠ connection.** A code cell runs on its **section's kernel**, connected or not; edges
never bind execution (today's kernel-edge/BFS binding goes away). Drop a lone cell into a section
and run it.

**Run order (run-with-upstream).** Running a cell walks its connections **backward** and runs
**only the cells it's connected to**, skipping any already run; nothing off that backward path is
touched. "Run all" = topological order over the section. One shared section kernel, so forks are
**contextual** parallelism, not isolated state.

**Follow a connection** (`gf`): jump along an edge to what it connects — edge-following on top of
spatial nav.

**Phase 2:** paragraph anchors + pull **crtx-server embedding links** in (each paragraph already
carries related-passage in/out edges from the vector DB) as suggested context connections.

## 6. Creating nodes & forks

- Keyboard off the focused cell: `o` / `Alt+X j` = **next cell** (down, continue sequence);
  `Alt+X l` = **fork right** (new column beyond the output); `Alt+X h` = **fork left**. **No `k`** —
  append-only, nothing goes above.
- **Edge `+` knob**: hover an edge → a `+` appears → click to insert a node **between** the two it
  connects; the edge splits, neighbours reflow.
- Every creation obeys the engine (grid size, gaps, no overlap).

## 7. Sections: stack, create, move

- **Stacked** vertically from the origin; **append-only** (add at the bottom, never insert
  above/between). The stack **is** the timeline (each section stamped with its creation time).
- **Many sections → one kernel**; a shared kernel means a **shared color/tint**; title + time
  disambiguate.
- **Three ways to add a section:** the **New section** button (bottom), an **MCP command** (AI can
  add one), or **drop a document on free canvas** → it becomes a new section.
- **Move between sections:** drag-drop or cut/paste. A code node **adopts the new section's
  kernel**; its output moves with it. **Open:** context edges span sections (keep); a sequence edge
  across sections would make run-with-upstream cross kernels, so it likely **breaks** on the move.

## 8. Bird's-eye & minimap

- **Bird's-eye:** zoom out and cells shrink, but each section's **label holds its screen size**
  (kernel · time · cell-count) — read the map at any zoom.
- **Minimap:** a git-tree-style **left rail**, toggleable, one **knob per section** (color = kernel,
  same-kernel runs share a lane, a kernel switch changes color), with `#S` · title · time; current
  section highlighted, folded ones hollow; click a knob to jump.

## 9. Navigation — hard invariant

**Spatial navigation only pans, never rescales.** The zoom level stays exactly where you left it
until you **deliberately** zoom in/out — no focus, jump, follow, search, Home or cross-section move
ever changes it.

Keys: `h/j/k/l` pan-to-focus · `Home` origin · `Ctrl+U`/`Ctrl+D` (PgUp/PgDn) section up/down ·
`[` / `]` section begin/end · `` ` `` jump-back · `m` / `'` cell bookmarks · `/` search-and-jump ·
`gf` follow a connection · `z` / `Z` / Ctrl+scroll = the **only** zoom paths.

---

## Open calls (not yet decided)

- **Context-edge color assignment** — auto by group vs. you assign per link.
- **Cross-section edges on move** — context keep / sequence break (proposed), confirm.
- **Code auto-height** — chunky per-slot (leaning) vs. smooth-then-snap.
- **Paragraph links + crtx embeddings** — phase 2 vs. pull into v1.
- **Slot pixel size** — final numbers once the base font is fixed.

## Phasing (proposed)

1. **Layout core** — slot grid, bounded canvas, sections (header/fold/delete/address), the packing
   engine, code+output sizing, migration.
2. **Connections + run-order** — typed edges, orthogonal routing, backward run-with-upstream,
   creation (keys + edge `+`), forks.
3. **Overview + nav** — bird's-eye labels, minimap, pan-only nav guardrails, bookmarks, follow-edge.
4. **Phase 2** — paragraph-anchored links + crtx-server embedding links.

## Next

Confirm the open calls, then this spec → `superpowers:writing-plans` for a task-by-task
implementation plan.
