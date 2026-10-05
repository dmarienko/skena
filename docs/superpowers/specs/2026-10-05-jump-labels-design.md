# Jump labels (EasyMotion style) — design

Decided with the user on 2026-10-04/05. Mock-ups: https://claude.ai/artifact/MGcRtZXZv8VtU3MQUCkuSU (style A
chosen) and https://claude.ai/artifact/WvragcuDabuv5Beu6Qt2F2 (canvas option 1 chosen).

## What it does

Press the leader key twice and a direction key. Every target in that direction that is on screen gets a
short label drawn over it. Typing a label moves there. This works in the Monaco editors (text notes, code
cells, the chat input) and on the canvas.

No package for Monaco or monaco-vim was found that does this (web search, 2026-10-04), so skena has its own
small implementation. VSCodeVim's EasyMotion (MIT) is the model for how labels are assigned.

## Keys

The leader is a setting, `skena.vim.leader`, one key, default `;` (the user's VS Code leader).

| Keys | In an editor (vim normal mode) | On the canvas |
|---|---|---|
| leader leader `l` | word starts after the cursor, in the visible lines | visible nodes whose centre is right of the focused node's centre |
| leader leader `h` | word starts before the cursor, in the visible lines | visible nodes whose centre is left of it |
| leader leader `j` | the first non-blank character of each visible line below the cursor (column 1 for an empty line) | visible nodes whose centre is below it |
| leader leader `k` | the same for each visible line above the cursor | visible nodes whose centre is above it |

- A word start follows vim's `w`: the first character of a run of letters, digits and `_`, or of a run of
  other non-blank characters.
- "Visible" in an editor means the lines Monaco shows in the editor's viewport. On the canvas it means nodes
  that overlap the view, are not in a folded section, and are not groups. With nothing focused on the canvas,
  the view's centre stands in for the focused node.
- Editors: normal mode only. Insert and visual modes are untouched, and the keys are not bound there.
- The leader followed by anything other than the leader keeps the leader key's own meaning: in an editor,
  vim's `;` (repeat the last `f`/`t`) runs and the next key is handled as usual; on the canvas the keys are
  handled as if the leader had not been pressed.

## Labels

- Characters come from a setting, `skena.vim.jumpLabels`, default `asdfghjklqwertyuiopzxcvbnm`. The leader
  key is never used as a label even if the setting contains it.
- Targets are ordered by distance from the cursor (editor: document order outward from the cursor; canvas:
  distance between node centres). With N label characters and T targets, T ≤ N gives every target a
  one-character label, nearest first. With more targets, the nearest ones keep one-character labels and the
  rest get two-character labels that share a first character, as VSCodeVim does; no label is a prefix of
  another.
- Labels are drawn over the first character(s) of the target in the editor (the text itself is not
  changed), as VSCodeVim's easymotion draws them: bold letters in the editor's font, one character cell
  each, on the editor's own background so the characters underneath are hidden; a one-character label in
  `#ff0000`, a two-character label with its first character in `#ffb400` and its second in `#b98300`;
  the rest of the visible text is dimmed (opacity 0.45) while labels are shown (user, 2026-10-05, after
  comparing skena's red boxes with VSCodeVim). On the canvas they are tags on the top-left corner of a
  node, in the same red the cursor uses (`#f01010`, white text).
- Typing the first character of a two-character label hides every label that does not start with it;
  the labels that stay show only the character still to type (user, 2026-10-05). Typing a full label
  jumps. `Esc`, or any key that no label starts with, removes the labels and does nothing else (the key
  is not passed on).

## After the jump

- Editor: the cursor moves to the target; the mode stays normal.
- Canvas: the node is focused exactly as `h/j/k/l` focus a node (selection, the smallest pan that shows it,
  the previous-node register).

## Parts

- A pure module shared by both: assign labels to an ordered list of targets; given the typed keys, report
  "jump to target i", "narrowed", or "cancel".
- Editor part: find targets in the model's visible ranges; draw labels with Monaco decorations; read keys
  while labels are shown; bind leader leader h/j/k/l in vim normal mode through monaco-vim's `Vim` object,
  which skena already patches in `src/webview/canvas/nodes/TextNode.tsx`. Used by text notes, code cells and
  the chat input.
- Canvas part: in the canvas key handling next to the `g` chord: collect visible nodes, filter by direction,
  draw tags, read keys, focus.
- Settings `skena.vim.leader` and `skena.vim.jumpLabels` in `package.json`, read by the webview; a change
  applies to editors opened after it and to the canvas at once.

## Tests

Pure parts only (no UI): word starts and line starts in a set of lines from a cursor in each direction;
label assignment (T ≤ N, T > N, nearest-first, no label a prefix of another, leader excluded); typed-key
matching (jump, narrow, cancel); the canvas direction filter and ordering.

## Out of scope

Jumps as the target of an operator (`d` + leader leader `l`), visual mode, recording the jump in vim's jump list, jumps from an editor to other
nodes, searching by typed characters (Leap/Flash style, option B), and lines or nodes off screen.
