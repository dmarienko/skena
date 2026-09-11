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

- **Follow a connection with hotkeys**: `Shift+{h,j,k,l}` starts following from the matching border
  of the focused node (left / bottom / top / right) — jump to the node the edge on that side leads to.
  Open: `Shift+H/J/K/L` today move Space-pinned nodes and otherwise scroll the focused node's content;
  the binding has to be resolved (e.g. follow when nothing is pinned and the content does not scroll,
  or move the pinned-move to another chord).
- **Colouring**: when one border of a node has many outgoing edges, give them different colours so
  they can be told apart; and colour by execution connection (the sequence edge a run follows).
- **No bundling**: several edges must never be drawn as one line (seen on H5: two edges sharing a
  vertical trunk).

## Open questions (brainstorm in progress)

1. Scope of this round: no-bundling channels · colour by kind + per-border palette · engine-drawn
   sequence edges (derived from column order, re-wired on move) · `gf` / `Shift+hjkl` follow.
2. Channel rule for parallel edges: spacing inside the one-grid gap (100 px holds ~4 lines at 20 px)
   vs distinct gaps.
3. What "route finding" is wrong today (through nodes / detours / odd bends).
