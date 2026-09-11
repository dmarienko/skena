# Edges — design (draft, 2026-09-11)

Base: `2026-09-01-spatial-notebook-design.md` §5. Status of §5 today (FACT, read 2026-09-11):

| §5 rule | Today |
|---|---|
| Typed edges, colour = kind (code→code sequence, code→output, context) | one colour for all |
| Each drawn separately, never bundled | separate objects; `routing/orthogonal.ts` routes each edge alone (obstacle-aware, edge-unaware) → parallel edges share a channel and overlap |
| Routed orthogonally through the guaranteed gaps | orthogonal, obstacle-avoiding; not gap-aware, not edge-aware |
| Sequence / output edges engine-drawn | `o` and a run create them; a move does not re-wire |
| Run-with-upstream walks backward | done |
| `gf` follow a connection | not built |
| Phase 2 paragraph anchors, embedding links | not built |

## User inputs (2026-09-11, verbatim intent — not to be lost)

- **Follow a connection with hotkeys** — vim-style `g` prefix (the `g` chord is free since the
  heatmap was removed): `g` then `h`/`j`/`k`/`l` follows the edge attached to that border of the
  focused node (left / bottom / top / right) and focuses the node it leads to; several edges on one
  border → the nearest by the navigation score, repeat to cycle. `gg` = the first node of the current
  section, `G` = the last node of the current section (reading: top/bottom of the SECTION, not of the
  canvas — confirmed: the section). `Shift+H/J/K/L` keep their current meaning (move pinned nodes /
  scroll).
- **Section fold hotkeys**: `Shift+(` folds the current section (the one holding the focused node),
  `Shift+)` unfolds it — the same actions as the rail chevron (`e.key` is `(` / `)`).
- **Colouring**: when one border of a node has many outgoing edges, give them different colours so
  they can be told apart; and colour by execution connection (the sequence edge a run follows).
- **No bundling**: several edges must never be drawn as one line (seen on H5: two edges sharing a
  vertical trunk).

## Open questions (brainstorm in progress)

1. Scope of this round (decided 2026-09-11): no-bundling channels · colour by kind + per-border
   palette · `g{hjkl}` / `gg` / `G` follow · `Shift+(` / `Shift+)` fold. Engine-drawn sequence
   edges: **not in this round** — an edge stays as drawn even when its cell moves to a neighbouring
   column (user: unclear what a re-wire should look like).
2. Channel rule for parallel edges: spacing inside the one-grid gap (100 px holds ~4 lines at 20 px)
   vs distinct gaps.
3. What "route finding" is wrong today (through nodes / detours / odd bends).
