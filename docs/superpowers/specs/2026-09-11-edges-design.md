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

- Every gap channel has lanes **10 px apart**, filled from its centre line outwards (0, −10, +10,
  −20 … ±40: 9 lanes in a 100 px gap), so a lone route keeps the centre and a pair straddles it. A
  route takes the first free lane in each channel segment it uses; a tenth edge shares the centre. Lanes are
  assigned in a stable order (edges sorted by id), so a re-render never swaps them.
- A route never has a slanted segment. A run that has to move into a lane usually has a corner at
  each end, and the corner slides along the run beside it. A run that lies in line with the step
  out of a border (or into one) has no corner there. It leaves its gap line and comes back to it
  in right-angle jogs, each on a gap line of the other axis: the last one before the stretch of
  its own line that another route already uses. A jog that touches another route, even at one
  point, is used only when no lane has a jog that does not. (2026-09-25. Before, the router wrote
  each run's coordinate into both of its end points, so the step wrote the shared point back onto
  its own line and the route got two slanted segments: M1→M6 on H3 was (700,350) (750,340)
  (5550,350) (5600,350).)
- The edges leaving or entering one border are spread along it 10 px apart, centred on the border's
  middle. They are ordered by where each route first turns after leaving the border: routes that
  turn towards the first slot (up on a left or right border, left on a top or bottom border) come
  first, the sooner the turn the further out; straight routes come next; routes that turn the other
  way come last, the sooner the turn the further out. Ties go by the position of the node at the
  other end (topmost / leftmost first). To know where a route turns, every edge is first routed with
  the edges of each border ordered by the position of the node at the other end alone; an edge
  whose end point then moves is routed again (2026-09-25). A border
  with a single edge takes the offset of the other end's slot, so a facing pair runs straight
  across.
- An edge keeps its point while the edges on that border and their routes are unchanged. A route
  can change when a node that is neither of its ends moves; the order on that border, and the `g`
  labels of §4 that follow it, can then change too. Before 2026-09-25 only a move of the node at
  the other end could change the order.
- Corners keep today's small radius; arrowheads stay.
- All edges of a section are routed in one pass whenever its nodes or edges change, so lane
  assignment sees every edge.

### 2.1 Measured, 2026-09-25 (FACT)

Router before the two changes (`76fc79f`), after the right-angle jogs (`e5c29a3`), after the exit
order (`bf6f23e`). The benchmark is the 300 random sections of `tests/edge-routing.mjs` case 10
(seed 20260911, 6000 edges). The fixtures are `tests/fixtures/*.json`, one routing pass per section
as the webview runs it. Crossings: two segments of different edges whose interiors cross. Overlaps:
two collinear segments of different edges that share length. Time: median of 3 runs.

| Set | Bends | Crossings | Overlaps | Slanted | µs per edge |
|---|---|---|---|---|---|
| Benchmark | 15924 / 15924 / 15910 | 15070 / 15070 / 14695 | 250 / 250 / 255 | 0 / 0 / 0 | 82 / 84 / 96 |
| H1–H6, H3-C5, H3-E1 (206 edges) | 296 / 296 / 296 | 70 / 70 / 62 | 0 / 0 / 0 | 0 / 0 / 0 | — |
| M1 case, 6 nodes (case 19) | 8 / 10 / 10 | 1 / 1 / 1 | 0 / 0 / 0 | 2 / 0 / 0 | — |
| H3 as captured 2026-09-25 (not in the repo) | 34 / 36 / 36 | 8 / 8 / 8 | 0 / 0 / 0 | 2 / 0 / 0 | — |
| H3 with M6 at (3400,800) (case 21) | 32 / 32 / 34 | 9 / 9 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | — |

All 255 overlapping pairs of the benchmark are two first or last runs, which take no lane.

## 3. Colour

Edges are chrome, not content. An edge takes its source node's border colour (an explicit edge
colour wins); the code → output link is dotted, every other edge is a plain line. The kind tokens in
the theme stay as the last resort, for an edge whose source node is not on the canvas. No per-border
variants: the edges of one border are told apart by their exit point. Every edge draws 1 px
at 60% opacity; the focused node's edges draw at full opacity and 1.3× width, and running edges —
the upstream path of a running cell — draw lighter and wider. The selected style stays as it is.

## 4. Keys

- `g` on a focused node labels every connection it has — in and out, all four borders — and waits
  1.5 s for one of those keys; that key focuses and reveals the node at the other end (follow-ups
  spec §8.2). No connection → nothing is drawn and the wait is the plain 400 ms.
- The labels: the first connection of a border takes that border's vim key — left `h`, top `k`,
  right `l`, bottom `j` — and every further one takes the next symbol of one sequence shared by all
  four borders, `1`–`9` then `a b c d e f i m n o p q r s t u v w x y z` (never `g`, and never
  `h j k l`, which are already a border's first label). The borders are walked left, top, right,
  bottom, and the connections inside a border in the drawn exit-slot order of §2. So two connections
  left and three right read `h 1` and `l 2 3`. A border with no connection contributes nothing, and
  a node's labels do not move while its connections do not. Past the 34th connection there are no
  symbols left and the rest go unlabelled.
- While the chord is armed `h` / `k` / `l` / `j` are labels, not directions; a border with no
  connection leaves its key unclaimed, so it cancels the chord and navigates as usual. There is no
  cycle key any more — the labels name every connection outright, so nothing has to be stepped
  through. Two edges between the same pair on one border draw two wires but carry one label, on the
  first of their two slots: the follow lands on the node, so one key is all there is to press.
- The labels are drawn only while `g` is armed: a small badge 8 px outside each exit / entry point.
  They go away on the label key, on a cancel, on the timeout and on a canvas switch. The exit points
  are 10 flow px apart and the badge is a fixed 14 px, so the badges of one border are fanned apart
  on screen — slot order kept, at least 16 px between centres, the run centred on the points it
  names — and a badge the fan moved keeps a 1 px line back to its own exit point. Each border is
  fanned along its own axis. A connection the routing pass did not route has no exit point of its
  own; its badge is spread along the border the way the router spreads the rest.
- `gg`: first node of the current section (by y, then x); `G`: its last node. Both reveal.
- `Shift+(` / `Shift+)`: fold / unfold the current section — the rail chevron's action and history
  entry (`e.key` is `(` / `)`).
- `g` waits 400 ms for its next key, or 1.5 s while the labels are on screen; a second `g` is `gg`;
  any other key cancels and is then handled normally; `g` alone does nothing. `Shift+H/J/K/L` keep
  their meaning (move pinned nodes / scroll content).

## 5. Files and tests

| File | Change |
|---|---|
| `src/shared/edgeRouting.ts` (new, pure) | `buildGapGraph(sectionNodes)`, `routeOnGaps(edges, graph)` → per edge: waypoints, lane per segment, exit/entry offsets; stable order; a flag when no gap route exists |
| `src/webview/canvas/edges/LabeledEdge.tsx` | draws the route it is given (waypoints, colour, offsets); no per-edge routing |
| `src/webview/canvas/CanvasView.tsx` | one routing pass per section on node/edge change, results in a context the edges read; the `g` chord, `gg`, `G`, `Shift+(`/`)` |
| `src/webview/canvas/spatialNav.ts` | `edgesOnSide(from, side, ctx)` — the border's candidates in exit-point order, from the pass's `variant` / `variantIn`; `connectionLabels(from, ctx)` — the key for every connection of a node |
| `src/webview/canvas/EdgeFollowHints.tsx` (new) | the labels shown while `g` is armed; same overlay as `SectionSeparators`, flow coordinates through React Flow's transform, each border fanned on screen |
| `src/webview/canvas/palette.ts`, `theme.ts` | kind colours + the variant rule |
| `src/webview/canvas/routing/orthogonal.ts` | kept as the fallback |
| `tests/spatial-nav.mjs` | `edgesOnSide`: order by slot; `variantIn` on the target side; an unrouted edge last, by the other end's y. `connectionLabels`: the 2-left/3-right case reads `h 1 l 2 3`; twelve on one border read `h 1`–`9 a b`; no connection → none; the sequence never hands out `g h j k l` |
| `tests/edge-routing.mjs` | gap graph from a two-column section; shortest route with the bend penalty on the H4/H5 shapes (no detour); lanes 10 px, 9 per gap, stable order; exit spreading; fallback when no gap route; no slanted segment on the 300 random sections and on the H fixtures; the six-node M1 case under all 24 edge-id orders (right-angle jogs, clear of the other exits' corners); H3 with M6 below-right (M1's exits ordered by where they turn, no crossing among them) |
| `README.md` | the keys |

## 6. Open / later

- Engine-drawn sequence edges (re-wire on move) — deliberately not built.
- The exit order by turn (§2) lets a move of an unrelated node reorder a border's slots and its
  `g` labels. Open: keep it, or order by the other node only and accept the crossings (benchmark
  14695 vs 15070).
- A run that has to move but whose line is used right up to its end point can only jog at that end
  point, where the neighbouring exits of a busy border turn; the jog then touches them, or draws
  over part of one of them. The benchmark has no such run, so it does not measure this.
- Paragraph anchors and embedding links (spatial-notebook §5 phase 2).
