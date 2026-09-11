# Edges — routing, lanes, colour, follow keys (2026-09-11)

Base: `2026-09-01-spatial-notebook-design.md` §5. Decided with the user in the terminal and the visual
companion (`.superpowers/brainstorm/844143-1789127551/`).

## 0. State of §5 before this round (FACT, read 2026-09-11)

| §5 rule | Today |
|---|---|
| Typed edges, colour = kind | one colour for all |
| Each drawn separately, never bundled | separate objects; `routing/orthogonal.ts` routes each edge alone, obstacle-aware, edge-unaware → parallel edges share a channel (seen on H5) |
| Routed through the guaranteed gaps | orthogonal, obstacle-avoiding; its last resorts (a Z around the bounding box of ALL obstacles, then an unconstrained Z) are the long detours the user sees |
| Sequence / output edges engine-drawn | `o` and a run create them; a move never re-wires — **stays so** (user: a re-wire on a move to a neighbouring column has no clear meaning) |
| Run-with-upstream | done |
| `gf` follow | not built |

Scope of this round: §1–§4 below. Out: engine-drawn sequence edges, paragraph anchors, embedding links.

## 1. Routing on the gap grid

- Inside a section the layout engine guarantees one-grid (100 px) gaps between columns and between
  rows. The router builds a graph from them: vertical channels = the gaps between neighbouring
  columns (plus the free space beyond the last column), horizontal channels = the row gaps inside
  each column; graph nodes = channel crossings, plus the edge's exit point on the source border and
  its entry point on the target border.
- A route is the shortest orthogonal path on that graph with a bend penalty (a corner costs one
  grid). An edge therefore runs down its own gap, across a row gap, into the target — no detour
  around everything; a bend only where the path changes channel.
- The existing obstacle router (`routing/orthogonal.ts`) is the fallback: no section (legacy
  canvases), or a target in another section (route down the source's gap to the section boundary,
  along it, into the target's gap).
- One router for every edge kind, user-drawn context edges included.

## 2. Lanes and exit points

- Every gap channel has lanes **10 px apart** (10, 20 … 90 inside a 100 px gap: 9 lanes). A route
  takes the first free lane in each channel segment it uses; a tenth edge shares lane 1. Lanes are
  assigned in a stable order (edges sorted by id), so a re-render never swaps them.
- The edges leaving or entering one border are spread along it 10 px apart, centred on the border's
  middle, ordered by the position of the node at the other end (topmost / leftmost first). An edge
  keeps its point while the set of edges on that border is unchanged.
- Corners keep today's small radius; arrowheads stay.
- All edges of a section are routed in one pass whenever its nodes or edges change, so lane
  assignment sees every edge.

## 3. Colour

- Base colour by kind: **sequence** (code → code), **output** (code → output), **context**
  (everything else, user-drawn included). Three tokens in the theme.
- Many edges on one border: each gets a distinct variant of its kind's base colour (hue shifted
  around the base, up to 6 variants, then repeat), in the same stable order as the exit points — the
  colour and the exit position tell the same story.
- Execution: while a cell runs, the sequence edges on the run's upstream path draw bright (today's
  running style); at rest they return to the base colour.
- The selected node's edges draw one step brighter than the rest (today's selected style stays).

## 4. Keys

- `g` then `h` / `j` / `k` / `l`: follow the edge on that border of the focused node (left / bottom
  / top / right), whichever end the node is on; several → the nearest by the navigation score
  first, `g` + the same key again cycles; none → nothing. The target is focused and revealed
  (follow-ups spec §8.2).
- `gg`: first node of the current section (by y, then x); `G`: its last node. Both reveal.
- `Shift+(` / `Shift+)`: fold / unfold the current section — the rail chevron's action and history
  entry (`e.key` is `(` / `)`).
- `g` waits 400 ms for its second key; any other key cancels; `g` alone does nothing.
  `Shift+H/J/K/L` keep their meaning (move pinned nodes / scroll content).

## 5. Files and tests

| File | Change |
|---|---|
| `src/shared/edgeRouting.ts` (new, pure) | `buildGapGraph(sectionNodes)`, `routeOnGaps(edges, graph)` → per edge: waypoints, lane per segment, exit/entry offsets; stable order; a flag when no gap route exists |
| `src/webview/canvas/edges/LabeledEdge.tsx` | draws the route it is given (waypoints, colour, offsets); no per-edge routing |
| `src/webview/canvas/CanvasView.tsx` | one routing pass per section on node/edge change, results in a context the edges read; the `g` chord, `gg`, `G`, `Shift+(`/`)` |
| `src/webview/canvas/palette.ts`, `theme.ts` | kind colours + the variant rule |
| `src/webview/canvas/routing/orthogonal.ts` | kept as the fallback |
| `test/edge-routing.mjs` | gap graph from a two-column section; shortest route with the bend penalty on the H4/H5 shapes (no detour); lanes 10 px, 9 per gap, stable order; exit spreading; fallback when no gap route |
| `README.md` | the keys |

## 6. Open / later

- Engine-drawn sequence edges (re-wire on move) — deliberately not built.
- Paragraph anchors and embedding links (spatial-notebook §5 phase 2).
