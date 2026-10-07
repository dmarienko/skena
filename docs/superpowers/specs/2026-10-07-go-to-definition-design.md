# Go to definition and find references from code cells — design

Decided with the user on 2026-10-07. References added the same day (user).

## What it does

In a code cell's editor, in vim normal mode, leader then `g` (`;g` with the default `skena.vim.leader`)
looks up where the name under the cursor is defined and goes there.

- The name is the identifier under the cursor together with the dotted names before it on the same
  expression (`np.linalg.solve`, `self.fit`, `pd.DataFrame`). The cursor on `solve` asks for
  `np.linalg.solve`; on `linalg` it asks for `np.linalg`.
- Only code cells. In text notes and the chat input, leader `g` keeps its current meaning (vim's `;`,
  then `g`).
- Keys are read the way jump labels read them (`src/webview/canvas/editorJumpLabels.ts`,
  `leaderStep` in `jumpLabels.ts`): a leader followed by `g` in a code cell is this command; a leader
  followed by anything else behaves as today.

## Where the answer comes from (user: Pylance, then the kernel)

1. **Pylance.** The canvas's code cells are joined into one Python document in run order
   (`memberCodeCellsInRunOrder`, `src/shared/sectionLanes.ts`, section by section in the canvas's
   section order), the way VS Code notebooks give Pylance their cells. The host asks VS Code for the
   definition at the cursor's place in that document (`vscode.executeDefinitionProvider`). A result
   inside the joined document is mapped back to a cell and a line in it. Imports resolve through the
   interpreter VS Code has selected for the workspace. A name defined in several cells resolves to the
   definitions Pylance sees reaching the cursor (the latest earlier one in run order).
2. **The running kernel**, only when Pylance returns nothing. Only if the canvas has a kernel that is
   running and idle; the request never waits behind a running cell. The kernel evaluates the dotted
   name only (identifiers and dots, never a call or subscript) and returns its source file and line
   (`inspect.getsourcefile`, `inspect.getsourcelines`, unwrapping decorators). Reading an attribute can
   run a property's code; that is accepted. A function defined in a cell has an ipykernel temporary
   file as its source file; its source text is matched to a code cell of the canvas to get the cell
   and line. The kernel run is silent: no output in any cell, no execution count, no history.

## Where it lands (user)

- **Another cell (or the same cell):** that cell is selected exactly as `h/j/k/l` select a node (the
  smallest pan, the previous-node register, so `` ` ` `` goes back), its editor opens, and the cursor is
  on the definition's line and column, in vim normal mode.
- **A file:** it opens in the editor group beside the canvas (created if none), cursor and reveal at the
  definition's line and column. The canvas stays visible.
- **Several answers:** a VS Code quick pick lists them (`file:line` or `E7:line`, with the line's
  text); picking one goes there.
- **No answer:** a short note in the cell, `no definition found for <name>`, that goes away on the next
  key.
- **No name under the cursor** (a space, an operator): nothing happens, no note (user).
- **An instance** (kernel answer for a variable holding an object): go to its class (user).

## Find references: leader `z` (user)

- In a code cell's editor, vim normal mode, leader then `z` lists every reference of the name under
  the cursor, from Pylance over the same joined file (`vscode.executeReferenceProvider`), mapped back
  to cells and files. Pylance only; no kernel step.
- Shown as Monaco's own reference peek inside the cell's editor, as VS Code shows
  `editor.action.referenceSearch.trigger`: a preview of the selected place on the left, the list
  grouped by cell or file on the right (mock-up option A,
  https://claude.ai/artifact/3fDCjAKPDFni8A9XoUopnr).
- `j`/`k` move in the list (user), Enter goes to the selected place exactly as a definition does (a cell
  opens at the line in normal mode; a file opens beside the canvas), Esc closes the peek.
- A cell shorter than the peek needs is drawn taller while the peek is open, over whatever lies below
  it; no node moves and the layout is not changed; it returns to its size on close (user).
- No references: the same short note as for definitions, `no references found for <name>`.

## Unknowns to settle first (a spike, in the plan's first task)

- Whether Pylance resolves the workspace's imports (e.g. `factors.score.ic_blends`) in a document that
  is not a file on disk (`untitled:`), and whether such a document makes VS Code ask to save on close.
- If either fails, the joined document is a real file outside the project (per-user temp folder, never
  in the user's repo) and the plan says how Pylance is pointed at the workspace's interpreter for it.
- These need a live VS Code window; the user runs the spike's check.

## Spike result (2026-10-07, user's live run, `report.txt`)

The joined file is a real `.py` file in `$XDG_RUNTIME_DIR/skena` (`/run/user/1000/skena`). In the
factors window with the venv interpreter it resolved all five test names (`sharpe` → `metrics.py:5`,
`run_walkforward` → `runner.py:98`, `REPO` → E1:30, `CACHE` → E1:29 and E15:28, `np.linalg.solve` →
numpy `_linalg.py:364`) in 126–249 ms, mapped a shifted text back to the same cells, stayed clean
(not dirty) and listed 0 problems. An `untitled:` document resolved the same names but was dirty,
listed 150 problems and left an Untitled tab; a notebook document returned cell definitions under an
internal path that does not map back to cells.

## Out of scope

`gd` and other vim keys, hover, go to definition from text notes or
markdown code blocks, definitions in notebooks other than this canvas, other languages than Python.

## Tests

Pure parts only: the dotted name at a cursor; joining cells and mapping a position both ways (cell ↔
joined document, CRLF and empty cells); choosing among results (inside the joined document → cell,
ipykernel temp file → cell by source match, file → file); the leader `g` key step; formatting quick
pick entries. The kernel snippet is checked against a real Python with a few objects (function,
class, method, decorated function, builtin, Cython-like object without source).
