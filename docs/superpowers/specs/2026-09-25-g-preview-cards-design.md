# `g` preview cards — design

Decided with the user on 2026-09-25.

## What the user asked for

`g` puts a badge on every connection of the focused node, and the next key jumps along that
connection (`EdgeFollowHints.tsx`, `connectionBadges` / `armG` in `CanvasView.tsx`). The badge says
which key to press but not where the jump lands. The user wants a small preview of the node at the
other end of each connection, next to its badge.

## Behaviour

- `g` shows the badges as today, one per connection of the focused node on all four borders,
  incoming and outgoing. Next to each badge it shows a card for the node that connection leads to.
- **No timer.** Badges and cards stay until the next key or click:
  - a badge's key jumps to that node, as today;
  - `Esc`, any other key, or a click closes them without moving.
  - `G_HINT_MS` no longer ends the chord while badges are shown. A node with no connections keeps
    the plain 400 ms chord window (`G_CHORD_MS`), since nothing is shown.
- **Card size:** fixed screen size, 228 px wide, the body at most three lines (about 58 px). It
  does not scale with the canvas zoom, the same way the badges do not.

## Card content

Header: the node's label and its type, for example `E7 · code · python` or `C1 · output of E1`,
on a card whose border is the node's border colour (`nodeBorderColor`). The dark default code
border (`#02542e`) is too dark on the card background; the card draws a lighter tint of it.

| Node type | Card body |
|---|---|
| `code` | the first 3 non-empty lines of `code`, monospace, with the editor's syntax colours |
| `text` (markdown) | rendered: the first heading in bold, then the next lines as plain text; formulas (LaTeX and typst) drawn as math, as `MarkdownRenderer` draws them |
| `file` | the path; the first heading of the file when the file preview has already loaded it |
| `cell`, `format: html` | the text of the first lines of the output, tags removed |
| `cell`, `format: markdown` | as a markdown note |
| `cell`, `format: image` | a thumbnail of the image, fitted into the body box |
| `cell`, `format: plotly` | the word "plot" (the output holds no picture to show) |
| `knowledge` | the title, then the source file |
| any other type | the title, file or URL the node already shows in its header |

The content comes from node data the webview already holds. Nothing is fetched to build a card.

## Placement

- A card sits just outside its badge, pointing away from the focused node: to the right of a
  right-border badge, below a bottom-border badge, and so on.
- Cards on one border keep the badges' order and are pushed apart along the border until they do
  not overlap, then the group is slid back so it stays centred on the badges it names. This is the
  same fan the badges use in `place()`, with the card's size instead of the badge's.
- A card that ends up away from its badge gets a thin line back to it, as badges do today.
- Cards stay inside the visible pane: near the edge of the view they are pushed in.

## Out of scope

- A picture of the node as drawn on the canvas (a scaled-down render). The user chose the card.
- Previews anywhere except the `g` chord.

## Tests

- The card content function (pure): one case per row of the table above, including a node with
  blank leading lines, a note without a heading, and an image cell.
- Placement (pure): cards on one border do not overlap, keep their order, and stay inside a given
  pane rectangle; a card moved away from its badge is marked for a line back.
- The chord: after `g`, the badges stay past the old 1.5 s; `Esc` and a click close them; a badge
  key jumps.
