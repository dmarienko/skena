# Go to Definition and Find References from Code Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-10-07-go-to-definition-design.md` (`b5d38ab`). In a code cell's editor, in vim normal mode, leader then `g` (`;g` by default) goes to where the dotted name under the cursor is defined: Pylance first, on the canvas's code cells joined in run order; the canvas's kernel when Pylance finds nothing and the kernel is idle. A definition in a cell selects that cell as `h/j/k/l` do and opens its editor at the line; one in a file opens beside the canvas; several go to a quick pick; none leaves a short note in the cell. Leader then `z` (`;z`) lists every reference of the name, from Pylance on the same joined cells, in Monaco's own reference peek inside the cell's editor: `j`/`k` move in its list, Enter goes to the place as a definition does, Esc closes it; while it is open the cell is drawn taller over what lies below, and nothing moves.

**Architecture:** Task 1 (the spike, done) chose the kind of document Pylance is asked about: a real `.py` file in the per-user temporary folder. The joined cells are written to `$XDG_RUNTIME_DIR/skena/definition` (else `<tmpdir>/skena-<user>/definition`), one file per canvas and text, opened with `openTextDocument` and never shown; `vscode.executeDefinitionProvider` or `vscode.executeReferenceProvider` is asked at the cursor's place in it. The pure parts (`src/shared/goToDefinition.ts`, `src/shared/findReferences.ts`) find the dotted name, join the cells, map positions both ways, turn answers into places to go, say what Monaco's peek is given and how tall the cell must be; they are tested in node, the peek's grouping against Monaco's own `ReferencesModel`. The kernel part sends one silent `execute_request` with a `user_expressions` entry that looks the name up with `inspect`; it was run against a real ipykernel. In the webview, the jump-label key reader in each Monaco editor (`installJumpLabels`) takes leader `g` and leader `z` in code cells only; landing in a cell reuses `focusNodeById` and the `skena:enterEdit` event with a cursor. The peek is Monaco's (`editor.action.referenceSearch.trigger`, already in the bundle): for the time it is open the webview creates a model per other cell and file, registers a reference provider that returns the host's answer, draws the cell taller, maps `j`/`k`/Enter in its list, and goes to an opened reference through `monaco.editor.registerEditorOpener`.

**Tech Stack:** TypeScript 5, React 18, React Flow 12, Monaco 0.55.1 + monaco-vim 0.4.4, the VS Code extension API (`vscode.executeDefinitionProvider`, `vscode.executeReferenceProvider`, `showTextDocument`, `showQuickPick`), Pylance (`ms-python.vscode-pylance`), the Jupyter messaging protocol 5.3 over the Jupyter server's websocket (`ws`), Python 3 (`inspect`, `linecache`), esbuild bundles + `node --test` (each test file's line 1 holds its run command).

---

## Task 1 (the spike) is done. Tasks 2 to 15 start now.

Task 1 was committed as `c2670d7`, and `11d5fbf` made its command read a picked `.canvas` file when no canvas tab has focus. The user ran it on 2026-10-07 and chose the kind "file"; the numbers are under "Spike result" at the end of this file. Task 2 reverts both commits. The tasks after it are written for the kind "file".

## Before you start

- Work on branch `feature/spatial-notebook`. Stage files by name; commit only the files each task names. No attribution lines of any kind in commit messages.
- `.vscode/skena-mcp.js` and the untracked `.vscode/numbered-bookmarks.json` are not yours. Never stage them. `npm run build` rewrites `.vscode/skena-mcp.js`; leave it unstaged. If `git status` shows uncommitted changes in a file this plan edits and you did not make them, stop and ask.
- If `git commit` fails on `index.lock`, wait a few seconds and run it again. Never delete the lock file.
- Line numbers in this plan are those of `771c94b`. After Task 2 the source is that of `771c94b` again (FACT: `git revert --no-commit 11d5fbf c2670d7` on a clone at `b5d38ab` staged exactly the three spike files, and the staged `src/` and `package.json` equal `771c94b`'s). Find each edit by the quoted text; the numbers may have moved.
- Typecheck baseline at `b5d38ab` (FACT, run on the repository): `npx tsc --noEmit` reports 3 errors, all `Property 'fsPath' does not exist on type 'ResolvedUri'` in `src/extension/editor-provider.ts` (lines 645-647). They are old. The typecheck command in this plan filters exactly those out:

  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"
  ```

  Expected output: nothing. (Filtering by the file name instead, `grep -v "src/extension/editor-provider.ts"`, also prints nothing at every step; it would hide a new error in that file, which Tasks 10 and 13 edit.)
- `tests/jupyter-protocol.mjs` test 4 (`collectOutputs marks error status on error reply`) already fails at `b5d38ab` (FACT, run on a copy: 5 tests, 4 pass). It is not this plan's; Task 8 expects it to keep failing.
- `tests/kernel-definition.mjs` (Task 7) runs `python3` from `PATH` (set `PYTHON=` to use another). It installs nothing. FACT: its 8 tests passed with Python 3.10.12, 3.11.9, 3.12.12 (the factors venv) and 3.14.2 (the first plan's runs), and with Python 3.12.12 from `PATH` in the run below.
- `tests/find-references.mjs` (Task 12) bundles Monaco's own `referencesModel.js` from `node_modules` for node; it needs nothing else.
- Verification done for this plan (FACT, 2026-10-07): the plan was applied by a script, task by task from Task 2, to a `git archive` copy of `b5d38ab` (Task 2's revert replaced by the same change applied with `git apply -R --index`, an archive having no history), running the commands written here. Each test step failed and then passed as stated, the typecheck command printed nothing wherever a task runs it (and so did the file-name filter), `npm run build` succeeded in Tasks 10, 11 and 14, and after each commit `git status` showed nothing, or only `.vscode/skena-mcp.js` once a build had run. Nothing that needs a live VS Code window was run: Task 15 and the peek's behaviour in Task 14 are the user's.

## What is known before the spike

From a web and source search before Task 1 (sources in brackets; "code" means read in the source, Pylance 2026.4.1 is closed source and its shipped bundle was searched). The spike's measurements are under "Spike result"; where they differ, they win.

- Pylance takes `file` and `untitled` Python documents, notebook cells (`vscode-notebook-cell`), and a few other schemes; not any other scheme unless the experimental setting `python.analysis.supportAllPythonDocuments` is on [code: Pylance 2026.4.1 `dist/extension.bundle.js` document selector].
- A document is analysed when it is opened with `openTextDocument`; it does not need to be shown [code: vscode-languageclient sends `didOpen` for every open document that matches, `client/src/common/textSynchronization.ts`, https://github.com/microsoft/vscode-languageserver-node].
- Which workspace (interpreter, settings) a file outside every folder gets: pyright's `_getBestWorkspaceForFile` gives it the only workspace when the window has one folder, and a `<default>` workspace when there are several [code: https://github.com/microsoft/pyright/blob/main/packages/pyright-internal/src/workspaceFactory.ts]. The spike confirmed it for one folder: the venv's imports resolved.
- An untitled document created with content through the API is dirty from the start and is not released while dirty [code: `mainThreadDocuments.ts` "mark as dirty", `untitledTextEditorModel.ts`, https://github.com/microsoft/vscode]. There is no API to close a document [maintainer, https://github.com/microsoft/vscode/issues/187008].
- An empty answer right after Pylance starts was reported, with a sleep as the workaround [user report, https://github.com/microsoft/vscode/issues/133952].
- Go to definition prefers `.py` sources over `.pyi` stubs and falls back to stubs when there is no source [release note, https://github.com/microsoft/pylance-release/releases/tag/2021.2.1; code: pyright `DefinitionFilter.PreferSource`].

What the kernel part was checked against (FACT, the script in the Appendix, factors venv: Python 3.12.12, ipykernel 6.31.0, IPython 9.12.0, jupyter_client 8.8.0): after five cells ran (execution count 5), 19 silent requests each published only `status: busy` and `status: idle` on iopub, answered in 8 to 21 ms, left the execution count at 5 (the next cell got 6), left `len(In)` at 6 and the user namespace unchanged. A request sent while a 3-second cell ran was answered after 2822 ms. The outputs per name are in Task 7.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/extension/definitionLookupTest.ts` | created in Task 1 (`c2670d7`, `11d5fbf`), deleted in Task 2 | The spike's command. |
| `src/shared/goToDefinition.ts` | create | Pure. `isDottedName`, `dottedNameAt`, `codeCellsInRunOrder`, `joinCells`, `toJoined`, `fromJoined`, `targetsFromLocations`, `targetsFromKernel`, `fileUri`, `pickEntry`, the types. |
| `tests/go-to-definition.mjs` | create | node:test for `goToDefinition.ts` (15 tests). |
| `src/webview/canvas/jumpLabels.ts` | modify | `leaderStep` takes leader `g` and leader `z` in code cells. |
| `tests/jump-labels.mjs` | modify | Test 24. |
| `src/extension/jupyter/definitionSnippet.ts` | create | The Python lookup as a `user_expressions` expression; `parseDefinitionValue`. |
| `tests/kernel-definition.mjs`, `tests/fixtures/definition_fixture.py`, `tests/fixtures/definition_driver.py` | create | Runs the expression in a real Python (8 tests). |
| `src/extension/jupyter/protocol.ts` | modify | `buildSilentEvaluateRequest`, `parseEvaluateReply`. |
| `tests/jupyter-protocol.mjs` | modify | 2 tests. |
| `src/extension/jupyter/client.ts`, `src/extension/jupyter/manager.ts` | modify | `kernelState`, `evaluateExpressions`; `isIdle`, `evaluate`. |
| `src/extension/ipcEndpoint.ts` | modify | Export `userTempDir`. |
| `src/extension/definition/joinedFile.ts` | create | Writes the joined file per canvas and text; deletes old ones. |
| `tests/joined-file.mjs` | create | 2 tests. |
| `src/extension/definition/pylanceLocations.ts` | create | Asks `vscode.executeDefinitionProvider` or `vscode.executeReferenceProvider`, asks again while a new file gives nothing. |
| `src/extension/definition/goToDefinition.ts` | create | `findDefinitions` (Pylance, then the kernel), `showDefinitions` (open beside, quick pick), `canvasCells`. |
| `src/shared/types.ts` | modify | `MsgGoToDefinition`, `MsgShowDefinitions`, `MsgDefinitionResult`, `MsgDefinitionGoto`; `MsgFindReferences`, `MsgReferencesResult`. |
| `src/extension/editor-provider.ts` | modify | Three message cases. |
| `src/webview/canvas/editorJumpLabels.ts` | modify | `onLookup` option; `moveVimCursor` exported. |
| `src/webview/canvas/nodes/cellDefinition.ts` | create | The webview's half of both lookups: send the request, act on the answer, drop an answer that comes after another key. |
| `src/webview/canvas/nodes/CodeNode.tsx` | modify | Leader `g` and `z`, the note, opening the editor at a cursor, the taller cell while the peek is open. |
| `src/webview/App.tsx` | modify | Route `definitionResult`, `definitionGoto`, `referencesResult`. |
| `src/webview/canvas/CanvasView.tsx` | modify | `skena:goToCell`: select the cell, unfold its section if folded, open its editor at the line. |
| `src/webview/styles/canvas.css` | modify | `.skena-code-def-note`; the taller cell over other nodes. |
| `src/shared/findReferences.ts` | create | Pure. `referencesFromLocations`, `openCellUri`, `peekCellUri`, `peekPlan`, `openedTarget`, `peekBoxHeight`, the types. |
| `tests/find-references.mjs`, `tests/fixtures/monaco-references-model.js` | create | node:test for `findReferences.ts` (5 tests), the peek's grouping checked with Monaco's `ReferencesModel`. |
| `src/extension/definition/findReferences.ts` | create | `findReferences`: Pylance's references, with the text of each cell and file. |
| `src/webview/canvas/nodes/referencePeek.ts` | create | Monaco's reference peek on the host's answer: models, provider, keys, opener, the taller cell, undone on close. |
| `src/webview/canvas/nodes/NodeBorder.tsx` | modify | `height` prop. |

---

### Task 1: Definition lookup test (spike; done)

**Commits:** `c2670d7` (the command "Skena: Definition lookup test (dev)", `src/extension/definitionLookupTest.ts`, registered in `src/extension/extension.ts` only in an Extension Development Host, declared in `package.json` with a notebook type for the notebook kind), `11d5fbf` (the command reads a picked `.canvas` file, read-only, when no canvas tab has focus).

The command joined the canvas's code cells in run order, asked `vscode.executeDefinitionProvider` at the last place each typed name occurs, for three kinds of document (untitled, a `.py` file in the per-user temporary folder, a notebook of its own type), on the canvas's text and on a text shifted by 3 lines (one cell for the notebook), and wrote the answers, timings, dirty state and problem counts to `/run/user/1000/skena/definition-spike/report.txt`. The user's second run (factors folder, venv interpreter, `factors-essentials.canvas` read from disk) is under "Spike result". The user chose the kind "file".

---

### Task 2: Remove the spike

**Files:**
- Delete: `src/extension/definitionLookupTest.ts`
- Modify: `src/extension/extension.ts`, `package.json` (back to `771c94b`)

- [ ] **Step 1: Revert the two spike commits**

Run: `git revert --no-commit 11d5fbf c2670d7`
Then: `git status --short`
Expected: `M  package.json`, `D  src/extension/definitionLookupTest.ts`, `M  src/extension/extension.ts` (plus the unstaged `.vscode` files).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

- [ ] **Step 3: Commit**

The revert has already staged the three files; its result is recorded under "Spike result" in this plan.

```bash
git commit -m "chore(dev): remove the definition lookup test"
```

---

### Task 3: Leader g and leader z: the key step and the editor key reader

**Files:**
- Modify: `src/webview/canvas/jumpLabels.ts:16-27`, `src/webview/canvas/jumpLabels.ts:97-104`
- Modify: `tests/jump-labels.mjs` (append at the end)
- Modify: `src/webview/canvas/editorJumpLabels.ts:141-145`, `:155`, `:251`, `:260-262`

`leaderStep` (`jumpLabels.ts:98`) reads one key of leader leader `h/j/k/l` for every Monaco editor and the canvas. It gets a fourth argument, `code`: where it is true (code cells, Tasks 11 and 14), the leader then a plain `g` is `{ do: 'definition' }` and the leader then a plain `z` is `{ do: 'references' }`. Where it is false (text notes, the chat input, the canvas), leader `g` and leader `z` are a `release` as today, so vim runs `;` and then the key.

`installJumpLabels` (`editorJumpLabels.ts:144`) reads the keys at capture on the editor's container, before Monaco and monaco-vim, and its module-level window listener (`:31-34`) ends a held leader before later window listeners take the key; both call `leaderStep`. It gets an `onLookup` option: when given, leader `g` and leader `z` stop the key and call it with `'definition'` or `'references'`. Nothing passes it until Task 11, so no editor changes behaviour in this task.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/jump-labels.mjs`, after one blank line:

```js
test('24. leader g and leader z are the code cell lookups, only where they are on and only after one leader', () => {
  assert.deepEqual(leaderStep(1, key('g'), ';', true), { do: 'definition' });
  assert.deepEqual(leaderStep(1, key('z'), ';', true), { do: 'references' });
  for (const k of ['g', 'z']) {
    assert.deepEqual(leaderStep(1, key(k), ';'), { do: 'release', held: 1 }, k);
    assert.deepEqual(leaderStep(1, key(k), ';', false), { do: 'release', held: 1 }, k);
    assert.deepEqual(leaderStep(2, key(k), ';', true), { do: 'release', held: 2 }, k);
    assert.deepEqual(leaderStep(0, key(k), ';', true), { do: 'none' }, k);
    assert.deepEqual(leaderStep(1, key(k.toUpperCase()), ';', true), { do: 'release', held: 1 }, k);
    assert.deepEqual(leaderStep(1, key(k, { ctrl: true }), ';', true), { do: 'release', held: 1 }, k);
  }
  assert.deepEqual(leaderStep(1, key(';'), ';', true), { do: 'hold', next: 2 });
  assert.deepEqual(leaderStep(1, key('Shift'), ';', true), { do: 'none' });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`

Expected: `not ok 24`, the first assertion shows `do: 'release'` where `do: 'definition'` was expected; `# pass 23`, `# fail 1`.

- [ ] **Step 3: Add the step**

In `src/webview/canvas/jumpLabels.ts` (lines 16-27), find:

```ts
 * - `release`: any other key ends the sequence; the `held` leaders keep their own meaning, then the
 *   key goes on as usual
 */
export type LeaderStep =
  | { do: 'none' }
  | { do: 'hold'; next: 1 | 2 }
  | { do: 'show'; dir: JumpDir }
  | { do: 'release'; held: 1 | 2 };
```

replace with:

```ts
 * - `release`: any other key ends the sequence; the `held` leaders keep their own meaning, then the
 *   key goes on as usual
 * - `definition`: leader + g in a code cell; stop the key and look up where the name is defined
 * - `references`: leader + z in a code cell; stop the key and list the name's references
 */
export type LeaderStep =
  | { do: 'none' }
  | { do: 'hold'; next: 1 | 2 }
  | { do: 'show'; dir: JumpDir }
  | { do: 'release'; held: 1 | 2 }
  | { do: 'definition' }
  | { do: 'references' };
```

In `src/webview/canvas/jumpLabels.ts` (lines 97-104), find:

```ts
/** - one key of leader leader h/j/k/l, from `state` leaders held. Shift does not count as a modifier. */
export function leaderStep(state: LeaderState, k: JumpKey, leader: string): LeaderStep {
  if (MODIFIER_KEYS.has(k.key)) return { do: 'none' };
  const plain = !k.ctrl && !k.meta && !k.alt;
  if (state === 0) return plain && k.key === leader ? { do: 'hold', next: 1 } : { do: 'none' };
  if (state === 1) return plain && k.key === leader ? { do: 'hold', next: 2 } : { do: 'release', held: 1 };
  return plain && DIRS.has(k.key) ? { do: 'show', dir: k.key as JumpDir } : { do: 'release', held: 2 };
}
```

replace with:

```ts
/**
 * - one key of leader leader h/j/k/l, from `state` leaders held. Shift does not count as a modifier.
 *   With `code` (a code cell's editor) leader g is go to definition and leader z find references.
 */
export function leaderStep(state: LeaderState, k: JumpKey, leader: string, code = false): LeaderStep {
  if (MODIFIER_KEYS.has(k.key)) return { do: 'none' };
  const plain = !k.ctrl && !k.meta && !k.alt;
  if (state === 0) return plain && k.key === leader ? { do: 'hold', next: 1 } : { do: 'none' };
  if (state === 1) {
    if (plain && k.key === leader) return { do: 'hold', next: 2 };
    if (plain && code && k.key === 'g') return { do: 'definition' };
    if (plain && code && k.key === 'z') return { do: 'references' };
    return { do: 'release', held: 1 };
  }
  return plain && DIRS.has(k.key) ? { do: 'show', dir: k.key as JumpDir } : { do: 'release', held: 2 };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`
Expected: `# tests 24`, `# pass 24`, `# fail 0`.

- [ ] **Step 5: The editor key reader takes leader g and leader z when asked to**

In `src/webview/canvas/editorJumpLabels.ts` (lines 141-145), find:

```ts
 * Call once per editor, after initVimMode. The settings are read on every key: the chat input mounts
 * before the host has sent them.
 */
export function installJumpLabels(editor: MonacoEditor.IStandaloneCodeEditor, vim: VimAdapterInstance): void {
  const decorations = editor.createDecorationsCollection();
```

replace with:

```ts
 * Call once per editor, after initVimMode. The settings are read on every key: the chat input mounts
 * before the host has sent them. With `onLookup` (code cells) leader g and leader z call it instead
 * of handing the leader to vim.
 */
export function installJumpLabels(editor: MonacoEditor.IStandaloneCodeEditor, vim: VimAdapterInstance, opts: { onLookup?: (what: 'definition' | 'references') => void } = {}): void {
  const code = opts.onLookup !== undefined;
  const decorations = editor.createDecorationsCollection();
```

In `src/webview/canvas/editorJumpLabels.ts` (line 155), find:

```ts
      const step = leaderStep(held, keyOf(e), vimSettings().leader);
```

replace with:

```ts
      const step = leaderStep(held, keyOf(e), vimSettings().leader, code);
```

In `src/webview/canvas/editorJumpLabels.ts` (line 251), find:

```ts
    const step = leaderStep(held, k, leader);
```

replace with:

```ts
    const step = leaderStep(held, k, leader, code);
```

In `src/webview/canvas/editorJumpLabels.ts` (lines 260-262), find:

```ts
    if (step.do === 'hold') { held = step.next; return; }
    held = 0;
    show(step.dir);
```

replace with:

```ts
    if (step.do === 'hold') { held = step.next; return; }
    held = 0;
    if (step.do === 'definition' || step.do === 'references') { opts.onLookup?.(step.do); return; }
    show(step.dir);
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

- [ ] **Step 7: Commit**

```bash
git add src/webview/canvas/jumpLabels.ts tests/jump-labels.mjs src/webview/canvas/editorJumpLabels.ts
git commit -m "feat(definition): leader g and leader z key step for code cells"
```

---

### Task 4: The dotted name under the cursor (pure)

**Files:**
- Create: `src/shared/goToDefinition.ts`
- Test: `tests/go-to-definition.mjs`

The spec: the name is the identifier under the cursor with the dotted names before it (`np.linalg.solve`; on `linalg`, `np.linalg`). The column is the one Monaco reports in vim normal mode, 1-based, the character under the block cursor. When the chain before the word goes through a call, a subscript or a literal (`df.groupby(k).mean`), there is no dotted name (`dotted: null`): Pylance is still asked at the cursor, the kernel is not, because only identifiers and dots are ever evaluated. `isDottedName` is that check; the kernel side calls it again before building its expression (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/go-to-definition.mjs`:

```js
// - run: npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dottedNameAt, isDottedName } from './.build/goToDefinition.mjs';

// - the 1-based column of the n-th (0-based) occurrence of `part` in `line`
const colOf = (line, part, n = 0) => {
  let i = -1;
  for (let k = 0; k <= n; k++) i = line.indexOf(part, i + 1);
  return i + 1;
};

test('1. dotted names: names and dots only', () => {
  for (const ok of ['x', 'np.linalg.solve', '_a1.b_2', 'été.ça']) assert.ok(isDottedName(ok), ok);
  for (const bad of ['', '1x', 'a.', '.a', 'a..b', 'f()', 'a[0]', 'a b', 'a.1']) assert.ok(!isDottedName(bad), bad);
});

test('2. the cursor on solve asks for np.linalg.solve, on linalg for np.linalg, on np for np', () => {
  const line = 'x = np.linalg.solve(a, b)';
  assert.deepEqual(dottedNameAt(line, colOf(line, 'solve') + 2), { word: 'solve', dotted: 'np.linalg.solve', start: colOf(line, 'solve'), end: colOf(line, 'solve') + 5 });
  assert.equal(dottedNameAt(line, colOf(line, 'linalg')).dotted, 'np.linalg');
  assert.equal(dottedNameAt(line, colOf(line, 'np')).dotted, 'np');
  assert.equal(dottedNameAt(line, colOf(line, '(a') + 1).dotted, 'a');
});

test('3. a chain through a call or subscript has no dotted name; the word is still there', () => {
  const line = 'df.groupby(k).mean().x[0].y';
  assert.deepEqual(dottedNameAt(line, colOf(line, 'mean')), { word: 'mean', dotted: null, start: colOf(line, 'mean'), end: colOf(line, 'mean') + 4 });
  assert.equal(dottedNameAt(line, line.length).dotted, null);   // - the final y
  assert.equal(dottedNameAt(line, colOf(line, 'groupby')).dotted, 'df.groupby');
});

test('4. no name under the cursor: a blank, an operator, a dot, a number, past the end', () => {
  const line = 'y = f(1.5) + self.fit';
  for (const col of [2, 3, colOf(line, '('), colOf(line, '1'), colOf(line, '5'), colOf(line, '.', 1), line.length + 1, 0]) {
    assert.equal(dottedNameAt(line, col), null, `col ${col}`);
  }
  assert.equal(dottedNameAt(line, colOf(line, 'fit')).dotted, 'self.fit');
});

test('5. letters outside ASCII are name characters', () => {
  const line = 'v = été.ça';
  assert.equal(dottedNameAt(line, colOf(line, 'ça')).dotted, 'été.ça');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/shared/goToDefinition.ts"`.

- [ ] **Step 3: Write the module**

Create `src/shared/goToDefinition.ts`:

```ts
/**
 * Go to definition from a code cell, the pure part: the dotted name under the cursor, the canvas's
 * code cells joined into one Python document in run order with positions mapped both ways, the
 * answers of Pylance and of the kernel as places to go, and their quick pick entries. Bundled into
 * the host and the webview; no vscode import.
 */

// - one part of a Python name: a letter or _, then letters, digits, marks and connectors
const PART = String.raw`[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*`;
const DOTTED = new RegExp(`^${PART}(?:\\.${PART})*$`, 'u');
const NAME_CHAR = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]/u;

/** - names and dots only: the one kind of text the kernel is ever asked to evaluate */
export function isDottedName(s: string): boolean {
  return DOTTED.test(s);
}

/** - the name under the cursor: `word` spans columns [start, end), 1-based */
export interface NameAtCursor {
  word:   string;
  /** - `word` with the dotted names before it; null when the chain before it holds a call, subscript or literal */
  dotted: string | null;
  start:  number;
  end:    number;
}

/**
 * The identifier the cursor is on (1-based `col`: the character under vim's block cursor) and the
 * dotted names before it on the same line: on `solve` of `np.linalg.solve(a)` the word is `solve`
 * and the dotted name `np.linalg.solve`; on `linalg` it is `np.linalg`. Null when the cursor is not
 * on a name (a blank, an operator, a number).
 */
export function dottedNameAt(text: string, col: number): NameAtCursor | null {
  const i = col - 1;
  if (i < 0 || i >= text.length || !NAME_CHAR.test(text[i])) return null;
  let start = i;
  let end = i + 1;
  while (start > 0 && NAME_CHAR.test(text[start - 1])) start--;
  while (end < text.length && NAME_CHAR.test(text[end])) end++;
  const word = text.slice(start, end);
  if (!isDottedName(word)) return null;
  let head = start;
  let plain = true;
  while (head > 0 && text[head - 1] === '.') {
    let q = head - 1;
    while (q > 0 && NAME_CHAR.test(text[q - 1])) q--;
    if (!isDottedName(text.slice(q, head - 1))) { plain = false; break; }
    head = q;
  }
  return { word, dotted: plain ? text.slice(head, end) : null, start: start + 1, end: end + 1 };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs`
Expected: `# tests 5`, `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/goToDefinition.ts tests/go-to-definition.mjs
git commit -m "feat(definition): the dotted name under the cursor"
```

---

### Task 5: Run order, the joined text, positions both ways (pure)

**Files:**
- Modify: `src/shared/goToDefinition.ts` (import after the header comment; append at the end)
- Modify: `tests/go-to-definition.mjs` (import; append at the end)

Run order is the spec's: section by section in the canvas's section order (`sortLanes`, by y), each section's cells as `memberCodeCellsInRunOrder` orders them for Run Section (`src/shared/sectionLanes.ts:343`: top to bottom, then left to right). A canvas without sections: every code cell by y, then x.

The joined text: header lines (Task 10 passes `# type: ignore` first, pyright's comment for ignoring a whole file; the spike's joined file with that first line listed 0 problems), then each cell's lines followed by one empty line. Lines are split at CRLF, CR or LF, so a cell saved with CRLF maps line for line. An IPython magic or shell line (`%name`, `%%name`, `!cmd`, the rule of `magicRange` in `src/webview/canvas/codeCellView.ts:251`) is commented out by turning its first non-blank character into `#`, so no column moves; a cell under a cell magic whose body is not Python (`%%bash`, `%%html`, `%%writefile` …; Python bodies: `time`, `timeit`, `capture`, `prun`) is commented out whole. An empty cell is one empty line. Lines between cells and header lines map to no cell.

- [ ] **Step 1: Write the failing tests**

In `tests/go-to-definition.mjs`, find:

```js
import { dottedNameAt, isDottedName } from './.build/goToDefinition.mjs';
```

replace with:

```js
import { codeCellsInRunOrder, dottedNameAt, fromJoined, isDottedName, joinCells, toJoined } from './.build/goToDefinition.mjs';
```

Then append to the end of `tests/go-to-definition.mjs`, after one blank line:

```js
// - S1 (y 0) holds B (500,0) and A (0,100); S2 (y 1000, listed first) holds D (600,1200) and C (0,1200).
//   T is a text note. Without sections every code cell goes by y, then x.
const NODES = [
  { id: 'A', type: 'code', x: 0, y: 100, width: 400, height: 200 },
  { id: 'B', type: 'code', x: 500, y: 0, width: 400, height: 200 },
  { id: 'T', type: 'text', x: 0, y: 0, width: 400, height: 50 },
  { id: 'D', type: 'code', x: 600, y: 1200, width: 400, height: 200 },
  { id: 'C', type: 'code', x: 0, y: 1200, width: 400, height: 200 },
];
const LANES = [{ id: 's2', y: 1000, createdAt: 2 }, { id: 's1', y: 0, createdAt: 1 }];

test('6. run order: section by section from the top, in each top to bottom then left to right; code cells only', () => {
  assert.deepEqual(codeCellsInRunOrder(NODES, LANES), ['B', 'A', 'C', 'D']);
  assert.deepEqual(codeCellsInRunOrder(NODES, []), ['B', 'A', 'C', 'D']);
});

const CELLS = [
  { id: 'A', code: 'import numpy as np\r\nx = 1' },
  { id: 'E', code: '' },
  { id: 'B', code: '%matplotlib inline\n  !ls -la\ndef f():\n    return x\n' },
  { id: 'C', code: '%%bash\necho (\n' },
  { id: 'D', code: '%%time\ny = f()' },
];

test('7. joined: header, each cell then an empty line; CRLF split; magic lines and non-Python cell magics commented', () => {
  const j = joinCells(CELLS, ['# type: ignore']);
  assert.equal(j.text, [
    '# type: ignore',
    'import numpy as np', 'x = 1', '',
    '', '',
    '#matplotlib inline', '  #ls -la', 'def f():', '    return x', '', '',
    '#%bash', '#cho (', '', '',
    '#%time', 'y = f()', '',
  ].join('\n'));
  assert.deepEqual(j.spans, [
    { id: 'A', first: 1, lines: 2 }, { id: 'E', first: 4, lines: 1 }, { id: 'B', first: 6, lines: 5 },
    { id: 'C', first: 12, lines: 3 }, { id: 'D', first: 16, lines: 2 },
  ]);
});

test('8. positions both ways: cell line/col (1-based) <-> joined line/character (0-based)', () => {
  const j = joinCells(CELLS, ['# type: ignore']);
  assert.deepEqual(toJoined(j, 'A', 2, 1), { line: 2, character: 0 });
  assert.deepEqual(toJoined(j, 'B', 4, 12), { line: 9, character: 11 });
  assert.deepEqual(toJoined(j, 'E', 1, 1), { line: 4, character: 0 });
  assert.deepEqual(fromJoined(j, { line: 9, character: 11 }), { cellId: 'B', line: 4, col: 12 });
  assert.deepEqual(fromJoined(j, { line: 4, character: 0 }), { cellId: 'E', line: 1, col: 1 });
  for (let line = 0; line < 19; line++) {
    const c = fromJoined(j, { line, character: 3 });
    if (c) assert.deepEqual(toJoined(j, c.cellId, c.line, c.col), { line, character: 3 }, `line ${line}`);
  }
  assert.equal(fromJoined(j, { line: 0, character: 0 }), null);   // - the header
  assert.equal(fromJoined(j, { line: 3, character: 0 }), null);   // - between A and E
  assert.equal(toJoined(j, 'A', 3, 1), null);
  assert.equal(toJoined(j, 'Z', 1, 1), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs`

Expected: `SyntaxError: The requested module './.build/goToDefinition.mjs' does not provide an export named 'codeCellsInRunOrder'`, `# fail 1`.

- [ ] **Step 3: Write the functions**

In `src/shared/goToDefinition.ts`, find:

```ts
 * the host and the webview; no vscode import.
 */
```

replace with:

```ts
 * the host and the webview; no vscode import.
 */
import { memberCodeCellsInRunOrder, sortLanes, type LaneNodeGeom, type SectionLane } from './sectionLanes';
```

Then append to the end of `src/shared/goToDefinition.ts`, after one blank line:

```ts
/** - a code cell as the joined document needs it */
export interface JoinCell { id: string; code: string }

/**
 * The ids of the canvas's code cells in run order: section by section, top to bottom, each section's
 * cells as memberCodeCellsInRunOrder orders them for Run Section (top to bottom, then left to right).
 * A canvas without sections: all its code cells in that order.
 */
export function codeCellsInRunOrder(nodes: (LaneNodeGeom & { type: string })[], lanes: SectionLane[]): string[] {
  if (lanes.length === 0) return nodes.filter(n => n.type === 'code').sort((a, b) => a.y - b.y || a.x - b.x).map(n => n.id);
  return sortLanes(lanes).flatMap(l => memberCodeCellsInRunOrder(nodes, lanes, l.id));
}

/** - the cells as one Python text, and where each cell's lines are in it (0-based first line, line count) */
export interface JoinedCells {
  text:  string;
  spans: { id: string; first: number; lines: number }[];
}

// - an IPython magic or shell line (%name, %%name, !cmd), the rule of codeCellView's magicRange
const MAGIC = /^(\s*)(?:%{1,2}\s*[A-Za-z_]\w*|!)/;
const CELL_MAGIC = /^\s*%%\s*([A-Za-z_]\w*)/;
// - cell magics whose body is Python; any other (%%bash, %%html, %%writefile …) hides the whole cell
const PYTHON_CELL_MAGICS: ReadonlySet<string> = new Set(['time', 'timeit', 'capture', 'prun']);

// - the line as a comment: its first non-blank character becomes #, so no column moves
function commentOut(line: string): string {
  const i = line.search(/\S/);
  return i < 0 ? line : `${line.slice(0, i)}#${line.slice(i + 1)}`;
}

function cellLines(code: string): string[] {
  const lines = code.split(/\r\n|\r|\n/);
  const first = lines.find(l => l.trim() !== '');
  const magic = first !== undefined ? CELL_MAGIC.exec(first) : null;
  if (magic && !PYTHON_CELL_MAGICS.has(magic[1])) return lines.map(commentOut);
  return lines.map(l => (MAGIC.test(l) ? commentOut(l) : l));
}

/**
 * The cells as one Python document: the `header` lines, then each cell's lines (split at CRLF, CR or
 * LF; magic and shell lines commented out, a whole cell under a non-Python cell magic too) followed by
 * one empty line; joined with LF. An empty cell is one empty line.
 */
export function joinCells(cells: readonly JoinCell[], header: readonly string[] = []): JoinedCells {
  const lines: string[] = [...header];
  const spans: JoinedCells['spans'] = [];
  for (const c of cells) {
    const own = cellLines(c.code);
    spans.push({ id: c.id, first: lines.length, lines: own.length });
    lines.push(...own, '');
  }
  return { text: lines.join('\n'), spans };
}

/** - 0-based line and UTF-16 character, as VS Code counts them */
export interface DocPos { line: number; character: number }

/** - a cell's 1-based line and column (Monaco) as a position in the joined text; null outside the cell */
export function toJoined(j: JoinedCells, cellId: string, line: number, col: number): DocPos | null {
  const s = j.spans.find(x => x.id === cellId);
  if (!s || line < 1 || line > s.lines || col < 1) return null;
  return { line: s.first + line - 1, character: col - 1 };
}

/** - a position in the joined text as a cell's 1-based line and column; null on a line between cells */
export function fromJoined(j: JoinedCells, pos: DocPos): { cellId: string; line: number; col: number } | null {
  const s = j.spans.find(x => pos.line >= x.first && pos.line < x.first + x.lines);
  return s ? { cellId: s.id, line: pos.line - s.first + 1, col: pos.character + 1 } : null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs`
Expected: `# tests 8`, `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/goToDefinition.ts tests/go-to-definition.mjs
git commit -m "feat(definition): code cells joined in run order, positions both ways"
```

---

### Task 6: Where to go: Pylance locations, kernel answers, quick pick entries (pure)

**Files:**
- Modify: `src/shared/goToDefinition.ts` (append at the end)
- Modify: `tests/go-to-definition.mjs` (import; append at the end)

`targetsFromLocations`: a location inside the joined file goes to its cell, any other to its document. The spec says a name defined in several cells resolves to the latest earlier one in run order; Pylance on one joined file returns every assignment it finds (the spike: `CACHE` asked in E26 gave E1:29 and E15:28) and may return ones after the cursor too, so of several locations inside the joined file only the last one at or before the cursor is kept; when none is before it, all are kept (a function defined in a later cell).

`targetsFromKernel`: the kernel names an ipykernel temporary file for anything defined in a cell (`<TMPDIR>/ipykernel_<pid>/<number>.py`, not on disk; FACT, real kernel). Its text is the cell as the kernel compiled it, after IPython turned magics into calls (`%time x = 1` became `get_ipython().run_line_magic('time', 'x = 1')`; FACT, real kernel). So a cell whose text equals the kernel's copy (lines compared without trailing blanks, trailing empty lines ignored) is the answer at the kernel's line; else every cell that holds the definition's block (decorators and body, from `getsourcelines`) as consecutive lines, at its def line. A cell edited after it ran can still be found by its unchanged function; a function found in two cells gives two places (quick pick).

`pickEntry`: the spec's `file:line` or `E7:line` with the line's text. A file is shown relative to the workspace folder that holds it, else with `~` for the home folder, else in full.

- [ ] **Step 1: Write the failing tests**

In `tests/go-to-definition.mjs`, find:

```js
import { codeCellsInRunOrder, dottedNameAt, fromJoined, isDottedName, joinCells, toJoined } from './.build/goToDefinition.mjs';
```

replace with:

```js
import {
  codeCellsInRunOrder, dottedNameAt, fileUri, fromJoined, isDottedName, joinCells, pickEntry, targetsFromKernel,
  targetsFromLocations, toJoined,
} from './.build/goToDefinition.mjs';
```

Then append to the end of `tests/go-to-definition.mjs`, after one blank line:

```js
const J = joinCells([{ id: 'A', code: 'x = 1\ny = 2' }, { id: 'B', code: 'x = 3\nprint(x)' }, { id: 'C', code: 'x = 4' }]);
const DOC = 'file:///run/user/1000/skena/def.py';
const loc = (line, character, uri = DOC) => ({ uri, line, character });

test('9. Pylance: a definition in the joined document goes to its cell; of several the last one before the cursor', () => {
  const cursor = { line: 4, character: 6 };   // - the x of print(x) in B
  assert.deepEqual(targetsFromLocations([loc(0, 0), loc(3, 0), loc(6, 0)], DOC, J, cursor), [{ kind: 'cell', cellId: 'B', line: 1, col: 1 }]);
  assert.deepEqual(targetsFromLocations([loc(6, 0)], DOC, J, { line: 0, character: 0 }), [{ kind: 'cell', cellId: 'C', line: 1, col: 1 }]);
});

test('10. Pylance: a definition in a file goes to the file; none before the cursor keeps all; repeats and gaps dropped', () => {
  const lib = 'file:///venv/lib/numpy/linalg/_linalg.py';
  assert.deepEqual(targetsFromLocations([loc(363, 4, lib), loc(363, 4, lib)], DOC, J, { line: 0, character: 0 }), [{ kind: 'file', uri: lib, line: 364, col: 5 }]);
  assert.deepEqual(targetsFromLocations([loc(3, 0), loc(6, 0)], DOC, J, { line: 0, character: 0 }), [
    { kind: 'cell', cellId: 'B', line: 1, col: 1 }, { kind: 'cell', cellId: 'C', line: 1, col: 1 },
  ]);
  assert.deepEqual(targetsFromLocations([loc(2, 0)], DOC, J, { line: 4, character: 0 }), []);
});

// - what the kernel sent for after_magic in a real ipykernel 6.31 (IPython 9.12): the cell as compiled,
//   its %time line already turned into a call
const KCELL = "get_ipython().run_line_magic('time', 'x = 1')\ndef after_magic():\n    return 2\n";
const kdef = (over = {}) => ({ file: '/tmp/ipykernel_1/2.py', line: 2, col: 5, exists: false, cell: KCELL, start: 2, count: 2, ...over });

test('11. kernel: the cell whose text is the kernel copy (CRLF, trailing blanks ignored), at the kernel line', () => {
  const cells = [{ id: 'A', code: 'z = 0' }, { id: 'B', code: "get_ipython().run_line_magic('time', 'x = 1')\r\ndef after_magic():   \r\n    return 2\r\n\r\n" }];
  assert.deepEqual(targetsFromKernel(kdef(), cells), [{ kind: 'cell', cellId: 'B', line: 2, col: 5 }]);
});

test('12. kernel: else every cell holding the block, at its def line; a decorated def counts from the decorator', () => {
  const cells = [
    { id: 'A', code: '%time x = 1\ndef after_magic():\n    return 2' },
    { id: 'B', code: '# copy\n\n\ndef after_magic():\n    return 2' },
  ];
  assert.deepEqual(targetsFromKernel(kdef(), cells), [{ kind: 'cell', cellId: 'A', line: 2, col: 5 }, { kind: 'cell', cellId: 'B', line: 4, col: 5 }]);
  const deco = { file: '/tmp/ipykernel_1/3.py', line: 3, col: 5, exists: false, cell: 'import f\n@f.wrap\ndef g():\n    pass\n', start: 2, count: 3 };
  assert.deepEqual(targetsFromKernel(deco, [{ id: 'C', code: 'x = 1\n@f.wrap\ndef g():\n    pass' }]), [{ kind: 'cell', cellId: 'C', line: 3, col: 5 }]);
});

test('13. kernel: a cell file found nowhere gives nothing; a file on disk is the file', () => {
  assert.deepEqual(targetsFromKernel(kdef(), [{ id: 'A', code: 'def after_magic():\n    return 3' }]), []);
  const file = { file: '/home/u/p/src/m.py', line: 5, col: 5, exists: true };
  assert.deepEqual(targetsFromKernel(file, []), [{ kind: 'file', uri: 'file:///home/u/p/src/m.py', line: 5, col: 5 }]);
});

test('14. file URIs from kernel paths: segments encoded, Windows drives kept', () => {
  assert.equal(fileUri('/home/u/my dir/a#b.py'), 'file:///home/u/my%20dir/a%23b.py');
  assert.equal(fileUri('C:\\Users\\u\\a.py'), 'file:///C:/Users/u/a.py');
});

test('15. quick pick: E7:12 for a cell; a file relative to its workspace folder, else ~, else in full', () => {
  const labelOf = id => ({ A: 'E7' })[id] ?? id;
  const pathOf = uri => decodeURIComponent(uri.replace(/^file:\/\//, ''));
  const roots = ['/home/u/proj'];
  const at = (t, text = '    def solve(a, b):') => pickEntry(t, text, labelOf, pathOf, roots, '/home/u');
  assert.deepEqual(at({ kind: 'cell', cellId: 'A', line: 12, col: 5 }, 'def f():'), { label: 'E7:12', description: 'def f():' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///home/u/proj/src/m.py', line: 3, col: 1 }), { label: 'src/m.py:3', description: 'def solve(a, b):' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///home/u/.venv/lib/np.py', line: 364, col: 5 }), { label: '~/.venv/lib/np.py:364', description: 'def solve(a, b):' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///usr/lib/x.py', line: 1, col: 1 }), { label: '/usr/lib/x.py:1', description: 'def solve(a, b):' });
  assert.deepEqual(at({ kind: 'file', uri: 'file:///home/u/projx/a.py', line: 1, col: 1 }), { label: '~/projx/a.py:1', description: 'def solve(a, b):' });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs`

Expected: `SyntaxError: The requested module './.build/goToDefinition.mjs' does not provide an export named 'fileUri'`, `# fail 1`.

- [ ] **Step 3: Write the functions**

Append to the end of `src/shared/goToDefinition.ts`, after one blank line:

```ts
/** - a place to go: a line of a code cell, or of a file (by URI string); 1-based line and column */
export type DefinitionTarget =
  | { kind: 'cell'; cellId: string; line: number; col: number }
  | { kind: 'file'; uri: string; line: number; col: number };

/** - one location from vscode.executeDefinitionProvider: its document's URI string and 0-based start */
export interface DefLocation { uri: string; line: number; character: number }

const atOrBefore = (a: DocPos, b: DocPos) => a.line < b.line || (a.line === b.line && a.character <= b.character);

/**
 * Pylance's locations as places to go. One in the joined document (`joinedUri`) goes to its cell and
 * is dropped on a line between cells; any other goes to its document. Of several in the joined
 * document only the last one that starts at or before `cursor` is kept, the definition a run in order
 * reaches; when none starts before it, all are kept. Repeats are dropped.
 */
export function targetsFromLocations(locs: readonly DefLocation[], joinedUri: string, j: JoinedCells, cursor: DocPos): DefinitionTarget[] {
  const inDoc = locs.filter(l => l.uri === joinedUri);
  const reaching = inDoc.filter(l => atOrBefore(l, cursor));
  const keep = new Set(reaching.length > 0 ? [reaching.reduce((a, b) => (atOrBefore(a, b) ? b : a))] : inDoc);
  const out: DefinitionTarget[] = [];
  const seen = new Set<string>();
  const add = (t: DefinitionTarget) => {
    const key = t.kind === 'cell' ? `c ${t.cellId} ${t.line} ${t.col}` : `f ${t.uri} ${t.line} ${t.col}`;
    if (!seen.has(key)) { seen.add(key); out.push(t); }
  };
  for (const l of locs) {
    if (l.uri !== joinedUri) { add({ kind: 'file', uri: l.uri, line: l.line + 1, col: l.character + 1 }); continue; }
    if (!keep.has(l)) continue;
    const c = fromJoined(j, l);
    if (c) add({ kind: 'cell', ...c });
  }
  return out;
}

/** - the kernel's answer (definitionSnippet.ts); `cell`, `start` and `count` only for a cell's temporary file */
export interface KernelDefinition {
  file:   string;
  /** - 1-based line and column of the name on its def or class line (line 1, column 1 for a module) */
  line:   number;
  col:    number;
  /** - the file is on disk */
  exists: boolean;
  /** - the whole cell as the kernel compiled it, the 1-based line the definition's block starts on, its line count */
  cell?:  string;
  start?: number;
  count?: number;
}

const trimEnd = (s: string) => s.replace(/\s+$/, '');
const splitLines = (s: string) => s.split(/\r\n|\r|\n/);

/**
 * Where the kernel's answer goes. A cell's temporary file is found among the cells: the cells whose
 * text equals the kernel's copy (lines compared without trailing blanks, trailing empty lines
 * ignored) at the kernel's line; else every place a cell holds the definition's block (decorators
 * and body) as consecutive lines, at its def line. None found and the file is on disk: the file.
 * A file that is not a cell's: the file.
 */
export function targetsFromKernel(def: KernelDefinition, cells: readonly JoinCell[]): DefinitionTarget[] {
  const file: DefinitionTarget[] = def.exists ? [{ kind: 'file', uri: fileUri(def.file), line: def.line, col: def.col }] : [];
  if (def.cell === undefined || def.start === undefined || def.count === undefined) return file;
  const norm = (s: string) => {
    const ls = splitLines(s).map(trimEnd);
    while (ls.length > 0 && ls[ls.length - 1] === '') ls.pop();
    return ls;
  };
  const kernelLines = norm(def.cell);
  const block = kernelLines.slice(def.start - 1, def.start - 1 + def.count);
  const offset = def.line - def.start;
  const lines = cells.map(c => norm(c.code));
  const same = cells.flatMap((c, i) => (lines[i].join('\n') === kernelLines.join('\n') ? [{ kind: 'cell' as const, cellId: c.id, line: def.line, col: def.col }] : []));
  if (same.length > 0) return same;
  if (block.length === 0) return file;
  const hits = cells.flatMap((c, i) => lines[i].flatMap((_, at) =>
    block.every((b, k) => lines[i][at + k] === b) ? [{ kind: 'cell' as const, cellId: c.id, line: at + 1 + offset, col: def.col }] : []));
  return hits.length > 0 ? hits : file;
}

/** - a file path from the kernel as a URI string: file:// with each segment encoded; Windows drive paths too */
export function fileUri(path: string): string {
  const p = path.replace(/\\/g, '/');
  const withRoot = /^[A-Za-z]:\//.test(p) ? `/${p}` : p;
  return `file://${withRoot.split('/').map(seg => encodeURIComponent(seg).replace(/%3A/g, ':')).join('/')}`;
}

/** - what a quick pick shows for a target: `E7:12` or `path:12`, and the line's text without its indentation */
export interface PickEntry { label: string; description: string }

/**
 * The quick pick entry of a target. A cell by its label (E7); a file by its path relative to the
 * workspace folder that holds it, else with ~ for the home folder, else in full. `text` is the
 * target line's text.
 */
export function pickEntry(t: DefinitionTarget, text: string, labelOf: (cellId: string) => string, filePath: (uri: string) => string, roots: readonly string[], home: string): PickEntry {
  const description = text.trim();
  if (t.kind === 'cell') return { label: `${labelOf(t.cellId)}:${t.line}`, description };
  const path = filePath(t.uri);
  const root = roots.find(r => path.startsWith(r.endsWith('/') ? r : `${r}/`));
  const shown = root !== undefined
    ? path.slice(root.length).replace(/^\/+/, '')
    : home !== '' && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
  return { label: `${shown}:${t.line}`, description };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/shared/goToDefinition.ts --bundle --format=esm --outfile=tests/.build/goToDefinition.mjs && node --test tests/go-to-definition.mjs`
Expected: `# tests 15`, `# pass 15`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/goToDefinition.ts tests/go-to-definition.mjs
git commit -m "feat(definition): places to go from Pylance and kernel answers, quick pick entries"
```

---

### Task 7: The kernel lookup (Python, run in a real interpreter)

**Files:**
- Create: `src/extension/jupyter/definitionSnippet.ts`
- Create: `tests/fixtures/definition_fixture.py`, `tests/fixtures/definition_driver.py`
- Test: `tests/kernel-definition.mjs`

How it is sent (Task 8): one `execute_request` with `code: ''`, `silent: true`, `store_history: false` and `user_expressions: { skena_definition: <expression> }`. IPython evaluates each user expression with `eval` in the user's namespace and returns its display data (`text/plain`, and `application/json` from `_repr_json_`) in the `execute_reply`. The expression is `(lambda d: (exec(SOURCE, d), d['out'])[1])({'g': globals(), 'l': locals(), 'name': NAME})`: the lookup's code runs in a fresh dict, so the user's namespace gains nothing (FACT, real kernel: the sorted list of names was the same before and after 19 requests).

What the lookup does:
- `name` is checked again (`[^\W\d]\w*(?:\.[^\W\d]\w*)*`); the TypeScript side refuses anything else before sending (`definitionExpression` throws).
- The first part comes from the namespace or the builtins (`NameError` otherwise); the others are attributes. The last one is read with `inspect.getattr_static` when that finds it, so a property's code does not run and its getter is found (the spec accepts that a property may run; this way it does not for the last part).
- Properties, class and static methods, partials, cached properties, bound methods and `functools.wraps` wrappers (`inspect.unwrap`) are unwrapped. Any other value stands for its class (`sq = Shape()`, then `sq` goes to `class Shape`).
- A module is its file at line 1. Anything else: `inspect.getsourcefile` and `inspect.getsourcelines`; the answer is the `def`/`class` line in that block (so a decorated function lands on `def`, not on the decorator) and the column of the name.
- A class defined in a cell: its module is `__main__`, which has no `__file__` in a kernel (FACT, real kernel), so `inspect` cannot find it (Python 3.13+ reads `__firstlineno__` but still needs the module's file). Its methods' code objects name the cell's temporary file; the line is `__firstlineno__` (3.13+) or the nearest `class Name` line above the first method. Only cell files count there, so a dataclass's generated `__repr__` (which lives in `dataclasses.py`) is not taken for the class.
- No source (a builtin, a C type, a ufunc): `{ ok: false, error: 'no source' }`. Any exception: `{ ok: false, error: '<Type>: <message>' }`.
- For a cell's temporary file the answer also carries the cell's whole text (`linecache`), and where the block starts and how many lines it has, for `targetsFromKernel` (Task 6).

FACT, real kernel (factors venv, ipykernel 6.31.0, IPython 9.12.0, Python 3.12.12; paths shortened; every reply had `application/json` and `text/plain`, and the `text/plain` was the same JSON):

```text
cells run: 1 imports numpy as np, pandas as pd, functools, sharpe, WalkForwardConfig, run_walkforward;
           2 logged (functools.wraps), @logged decorated (lines 7-9), in_cell (line 11);
           3 class Shape (area; side as a property that raises), sq = Shape();
           4 %time x = 1, def after_magic;  5 @dataclasses.dataclass class Pt (no methods)
sharpe             12 ms {"ok": true, "file": "<factors>/src/factors/backtest/metrics.py", "line": 5, "col": 5, "exists": true}
run_walkforward    16 ms {"ok": true, "file": "<factors>/src/factors/walkforward/runner.py", "line": 76, "col": 5, "exists": true}
WalkForwardConfig  17 ms {"ok": true, "file": "<factors>/src/factors/walkforward/runner.py", "line": 38, "col": 7, "exists": true}
np.linalg.solve    12 ms {"ok": true, "file": "<site>/numpy/linalg/_linalg.py", "line": 364, "col": 5, "exists": true}
np.add             21 ms {"ok": false, "error": "no source"}
np.linalg           8 ms {"ok": true, "file": "<site>/numpy/linalg/__init__.py", "line": 1, "col": 1, "exists": true}
pd.DataFrame.merge 16 ms {"ok": true, "file": "<site>/pandas/core/frame.py", "line": 10842, "col": 9, "exists": true}
len                 9 ms {"ok": false, "error": "no source"}
functools.reduce    9 ms {"ok": false, "error": "no source"}
in_cell            10 ms {"ok": true, "file": "<TMPDIR>/ipykernel_1456482/3182560987.py", "line": 11, "col": 5, "exists": false, "cell": "def logged(f):\n…", "start": 11, "count": 2}
decorated          10 ms {"ok": true, "file": "<TMPDIR>/ipykernel_1456482/3182560987.py", "line": 8, "col": 5, "exists": false, "cell": "def logged(f):\n…", "start": 7, "count": 3}
Shape              12 ms {"ok": true, "file": "<TMPDIR>/ipykernel_1456482/690875657.py", "line": 1, "col": 7, "exists": false, "cell": "class Shape:\n…", "start": 1, "count": 7}
sq.area            12 ms {"ok": true, "file": "<TMPDIR>/ipykernel_1456482/690875657.py", "line": 2, "col": 9, "exists": false, "cell": "class Shape:\n…", "start": 2, "count": 2}
sq.side            11 ms {"ok": true, "file": "<TMPDIR>/ipykernel_1456482/690875657.py", "line": 6, "col": 9, "exists": false, "cell": "class Shape:\n…", "start": 5, "count": 3}
sq                 11 ms {"ok": true, "file": "<TMPDIR>/ipykernel_1456482/690875657.py", "line": 1, "col": 7, "exists": false, "cell": "class Shape:\n…", "start": 1, "count": 7}
Pt                 12 ms {"ok": false, "error": "no source"}
after_magic        13 ms {"ok": true, "file": "<TMPDIR>/ipykernel_1456482/1118388474.py", "line": 2, "col": 5, "exists": false, "cell": "get_ipython().run_line_magic('time', 'x = 1')\n…", "start": 2, "count": 2}
nope               11 ms {"ok": false, "error": "NameError: name 'nope' is not defined"}
np.nope            12 ms {"ok": false, "error": "AttributeError: module 'numpy' has no attribute 'nope'"}
every request: iopub status busy, status idle; nothing else. execution_count stayed 5; the next cell got 6.
```

`sq.side` did not raise: the property did not run. The node test below runs the same expression through a driver that evaluates it the way IPython does (`eval`, then `text/plain` = `repr` and `application/json` = `_repr_json_()`), in a namespace that is a `__main__` module without `__file__`, as in the kernel.

- [ ] **Step 1: Write the fixtures**

Create `tests/fixtures/definition_fixture.py`:

```python
# - objects for tests/kernel-definition.mjs; the tests find lines by their text, so keep each def unique
import dataclasses
import functools


def plain(x):
    return x


class Box:
    size = 3

    def area(self):
        return self.size ** 2

    @property
    def side(self):
        raise RuntimeError('the property ran')

    @classmethod
    def make(cls):
        return cls()


def logged(f):
    @functools.wraps(f)
    def inner(*a, **k):
        return f(*a, **k)
    return inner


@logged
def decorated(y):
    return y


@dataclasses.dataclass
class Point:
    x: int = 0


box = Box()
```

Create `tests/fixtures/definition_driver.py`:

```python
# - run by tests/kernel-definition.mjs: evaluates each expression of the JSON list on stdin in one
#   namespace the way IPython evaluates user_expressions (eval, then the text/plain and
#   application/json of the value), prints each as a JSON line, then the names the namespace gained
import array, functools, json, linecache, math, os, sys, tempfile, types

sys.dont_write_bytecode = True

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import definition_fixture as fx

# - IPython's namespace is the dict of a __main__ module without __file__ (checked in a real kernel)
main = types.ModuleType('__main__')
sys.modules['__main__'] = main
ns = main.__dict__
ns.update({'fx': fx, 'functools': functools, 'array': array, 'math': math})
# - a cell as ipykernel runs it: compiled under a temporary file name that is only in linecache
CELL = 'import dataclasses, functools\n\n@functools.lru_cache\ndef in_cell(a):\n    return a + 1\n\nclass CellBox:\n    def grow(self):\n        return 2\n\n@dataclasses.dataclass\nclass CellPoint:\n    x: int = 0\n'
NAME = os.path.join(tempfile.gettempdir(), 'ipykernel_4242', '2718281828.py')
linecache.cache[NAME] = (len(CELL), None, CELL.splitlines(True), NAME)
exec(compile(CELL, NAME, 'exec'), ns)
before = set(ns)
for expr in json.load(sys.stdin):
    value = eval(expr, ns, ns)
    print(json.dumps({'status': 'ok', 'data': {'text/plain': repr(value), 'application/json': value._repr_json_()}}))
print(json.dumps({'added': sorted(set(ns) - before), 'cellFile': NAME, 'version': list(sys.version_info[:2])}))
```

- [ ] **Step 2: Write the failing test**

Create `tests/kernel-definition.mjs`:

```js
// - run: npx esbuild src/extension/jupyter/definitionSnippet.ts --bundle --format=esm --outfile=tests/.build/definitionSnippet.mjs && node --test tests/kernel-definition.mjs
// - needs python3 on PATH (PYTHON=… picks another); nothing is installed
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { definitionExpression, parseDefinitionValue } from './.build/definitionSnippet.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/definition_fixture.py', import.meta.url));
const DRIVER = fileURLToPath(new URL('./fixtures/definition_driver.py', import.meta.url));
const lineOf = text => readFileSync(FIXTURE, 'utf8').split('\n').findIndex(l => l.includes(text)) + 1;

// - every name in one python run; name -> the parsed answer and the raw text/plain
const NAMES = [
  'fx.plain', 'fx.Box', 'fx.Box.area', 'fx.box.area', 'fx.box.side', 'fx.Box.make', 'fx.decorated', 'fx.Point', 'fx.box', 'fx',
  'len', 'math.sqrt', 'array.array', 'in_cell', 'CellBox', 'CellPoint', 'nope', 'fx.nope',
];
const run = spawnSync(process.env.PYTHON ?? 'python3', [DRIVER], { input: JSON.stringify(NAMES.map(definitionExpression)), encoding: 'utf8' });
const out = run.stdout.trim().split('\n').map(l => JSON.parse(l));
const tail = out.pop();
const answers = Object.fromEntries(NAMES.map((n, i) => [n, parseDefinitionValue(out[i])]));
const textPlain = Object.fromEntries(NAMES.map((n, i) => [n, out[i].data['text/plain']]));
const at = (name, text, col) => ({ ok: true, def: { file: FIXTURE, line: lineOf(text), col, exists: true } });

test('1. a function, a class and a method: the def or class line, the column of the name', () => {
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(answers['fx.plain'], at('fx.plain', 'def plain(', 5));
  assert.deepEqual(answers['fx.Box'], at('fx.Box', 'class Box:', 7));
  assert.deepEqual(answers['fx.Box.area'], at('fx.Box.area', 'def area(', 9));
  assert.deepEqual(answers['fx.box.area'], at('fx.box.area', 'def area(', 9));
});

test('2. a property is not run and its getter is found; a classmethod; a decorated function at its def line', () => {
  assert.deepEqual(answers['fx.box.side'], at('fx.box.side', 'def side(', 9));
  assert.deepEqual(answers['fx.Box.make'], at('fx.Box.make', 'def make(', 9));
  assert.deepEqual(answers['fx.decorated'], at('fx.decorated', 'def decorated(', 5));
});

test('3. a dataclass; a value stands for its class; a module is its file at line 1', () => {
  assert.deepEqual(answers['fx.Point'], at('fx.Point', 'class Point:', 7));
  assert.deepEqual(answers['fx.box'], at('fx.box', 'class Box:', 7));
  assert.deepEqual(answers.fx, { ok: true, def: { file: FIXTURE, line: 1, col: 1, exists: true } });
});

test('4. builtins and C types have no source', () => {
  for (const n of ['len', 'math.sqrt', 'array.array']) assert.deepEqual(answers[n], { ok: false, error: 'no source' }, n);
});

test('5. a function and a class of a cell: the temporary file, the cell text, the block; a cell class without methods has none before 3.14', () => {
  const cell = 'import dataclasses, functools\n\n@functools.lru_cache\ndef in_cell(a):\n    return a + 1\n\nclass CellBox:\n    def grow(self):\n        return 2\n\n@dataclasses.dataclass\nclass CellPoint:\n    x: int = 0\n';
  assert.deepEqual(answers.in_cell, { ok: true, def: { file: tail.cellFile, line: 4, col: 5, exists: false, cell, start: 3, count: 3 } });
  assert.deepEqual(answers.CellBox, { ok: true, def: { file: tail.cellFile, line: 7, col: 7, exists: false, cell, start: 7, count: 3 } });
  // - 3.14 gives an annotated class an __annotate__ function, which names the cell's file
  const annotate = tail.version[0] > 3 || tail.version[1] >= 14;
  assert.deepEqual(answers.CellPoint, annotate
    ? { ok: true, def: { file: tail.cellFile, line: 12, col: 7, exists: false, cell, start: 11, count: 3 } }
    : { ok: false, error: 'no source' });
});

test('6. unknown names and attributes come back as the error, nothing is added to the namespace', () => {
  assert.deepEqual(answers.nope, { ok: false, error: "NameError: name 'nope' is not defined" });
  assert.equal(answers['fx.nope'].ok, false);
  assert.match(answers['fx.nope'].error, /^AttributeError: /);
  assert.deepEqual(tail.added, []);
});

test('7. text/plain is the same JSON, for a kernel that sends no application/json', () => {
  for (const n of NAMES) assert.deepEqual(parseDefinitionValue({ status: 'ok', data: { 'text/plain': textPlain[n] } }), answers[n], n);
});

test('8. only names and dots are ever sent; an expression error is reported', () => {
  for (const bad of ['fx.plain()', 'a[0]', 'x + y', '__import__("os")', 'a..b', '', '1x']) assert.throws(() => definitionExpression(bad), /not a dotted name/, bad);
  assert.deepEqual(parseDefinitionValue({ status: 'error', ename: 'SyntaxError', evalue: 'invalid syntax' }), { ok: false, error: 'SyntaxError: invalid syntax' });
  assert.deepEqual(parseDefinitionValue(undefined), { ok: false, error: 'no reply' });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx esbuild src/extension/jupyter/definitionSnippet.ts --bundle --format=esm --outfile=tests/.build/definitionSnippet.mjs && node --test tests/kernel-definition.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/extension/jupyter/definitionSnippet.ts"`.

- [ ] **Step 4: Write the module**

Create `src/extension/jupyter/definitionSnippet.ts`:

```ts
/**
 * The kernel's half of go to definition: a Python expression, sent as a user_expression of a silent
 * execute_request (protocol.ts buildSilentEvaluateRequest), that says where a dotted name of the
 * kernel's namespace is defined. The name is looked up without eval: its first part in the namespace
 * or the builtins, the rest as attributes, the last one with inspect.getattr_static when it can be (so
 * a property's code does not run and its getter is found). Properties, class and static methods,
 * partials and decorated functions (__wrapped__) are unwrapped; any other value stands for its class.
 * The helpers run in a fresh dict, so the user's namespace gains nothing. No vscode import.
 */
import { isDottedName, type KernelDefinition } from '../../shared/goToDefinition';

/** - the key the expression is sent under in user_expressions */
export const DEFINITION_KEY = 'skena_definition';
/** - how long the host waits for the kernel's reply */
export const DEFINITION_TIMEOUT_MS = 3000;

// - runs with g (globals), l (locals) and name in its globals; leaves its reply in `out`. A class
//   defined in a cell has no source file through inspect (its module, __main__, has none in a kernel;
//   3.13+ would read __main__'s own file if it had one): its methods' code objects name the cell's
//   temporary file, and __firstlineno__ (3.13+) or the nearest `class Name` line above them gives the
//   line. Only cell files count there, so a dataclass's generated __repr__ (dataclasses.py) does not.
export const DEFINITION_SOURCE = String.raw`
import builtins, functools, inspect, json, linecache, os, re

HEAD = re.compile(r'\s*(?:async\s+)?(?:def|class)\s+(\w+)')
DOTTED = re.compile(r'[^\W\d]\w*(?:\.[^\W\d]\w*)*')
CELL_FILE = re.compile(r'[\\/]ipykernel_\d+[\\/]\d+\.py$')

def lookup(name):
    first, *rest = name.split('.')
    if first in l:
        obj = l[first]
    elif first in g:
        obj = g[first]
    else:
        try:
            obj = getattr(builtins, first)
        except AttributeError:
            raise NameError("name '%s' is not defined" % first) from None
    for i, part in enumerate(rest):
        if i == len(rest) - 1:
            try:
                obj = inspect.getattr_static(obj, part)
                break
            except AttributeError:
                pass
        obj = getattr(obj, part)
    return obj

def unwrap(obj):
    for _ in range(20):
        if isinstance(obj, property) and obj.fget is not None:
            obj = obj.fget
        elif isinstance(obj, (classmethod, staticmethod)):
            obj = obj.__func__
        elif isinstance(obj, (functools.partial, functools.partialmethod, functools.cached_property)):
            obj = obj.func
        elif inspect.ismethod(obj):
            obj = obj.__func__
        else:
            break
    try:
        obj = inspect.unwrap(obj)
    except ValueError:
        pass
    return obj

def target(obj):
    obj = unwrap(obj)
    if inspect.ismodule(obj) or inspect.isclass(obj) or inspect.isroutine(obj) or inspect.iscode(obj):
        return obj
    return type(obj)

def cell_file(file):
    return bool(CELL_FILE.search(file)) or (file in linecache.cache and not os.path.isfile(file))

def class_place(cls):
    codes = []
    for v in vars(cls).values():
        f = unwrap(v)
        code = getattr(f, '__code__', None)
        if code is not None and getattr(f, '__qualname__', '').startswith(cls.__qualname__ + '.') and cell_file(code.co_filename):
            codes.append(code)
    if not codes:
        return None
    file = codes[0].co_filename
    first = getattr(cls, '__firstlineno__', None)
    if first is None:
        lines = linecache.getlines(file)
        top = min(c.co_firstlineno for c in codes if c.co_filename == file)
        head = re.compile(r'\s*class\s+' + re.escape(cls.__name__) + r'\b')
        first = next((i + 1 for i in range(min(top, len(lines)) - 1, -1, -1) if head.match(lines[i])), None)
    return None if first is None else (file, first)

def where(name):
    if not DOTTED.fullmatch(name):
        return {'ok': False, 'error': 'not a dotted name'}
    obj = target(lookup(name))
    if inspect.ismodule(obj):
        file = inspect.getsourcefile(obj)
        if not file:
            return {'ok': False, 'error': 'no source'}
        return {'ok': True, 'file': file, 'line': 1, 'col': 1, 'exists': os.path.isfile(file)}
    place = class_place(obj) if inspect.isclass(obj) else None
    if place is not None:
        file, start = place
        lines = inspect.getblock(linecache.getlines(file)[start - 1:])
    else:
        try:
            file = inspect.getsourcefile(obj)
            lines, start = inspect.getsourcelines(obj)
        except (OSError, TypeError):
            return {'ok': False, 'error': 'no source'}
    if not file:
        return {'ok': False, 'error': 'no source'}
    line, col = start, len(lines[0]) - len(lines[0].lstrip()) + 1
    for i, text in enumerate(lines):
        m = HEAD.match(text)
        if m:
            line, col = start + i, m.start(1) + 1
            break
    exists = os.path.isfile(file)
    out = {'ok': True, 'file': file, 'line': line, 'col': col, 'exists': exists}
    if cell_file(file):
        out['cell'] = ''.join(linecache.getlines(file))
        out['start'] = start
        out['count'] = len(lines)
    return out

class Reply:
    def __init__(self, value):
        self.value = value
    def _repr_json_(self):
        return self.value
    def __repr__(self):
        return json.dumps(self.value)

try:
    out = Reply(where(name))
except Exception as e:
    out = Reply({'ok': False, 'error': type(e).__name__ + ': ' + str(e)})
`;

/** - the expression that looks up `name`; throws unless `name` is names and dots only */
export function definitionExpression(name: string): string {
  if (!isDottedName(name)) throw new Error(`not a dotted name: ${JSON.stringify(name)}`);
  // - a JSON string is a valid Python string literal; globals() and locals() are those of the
  //   user_expressions eval, the user's namespace
  return `(lambda d: (exec(${JSON.stringify(DEFINITION_SOURCE)}, d), d['out'])[1])({'g': globals(), 'l': locals(), 'name': ${JSON.stringify(name)}})`;
}

/** - why the kernel gave no place: its own words ('no source', 'NameError: …'), or what was wrong with the reply */
export type KernelAnswer = { ok: true; def: KernelDefinition } | { ok: false; error: string };

/**
 * The definition in one user_expressions entry of an execute_reply ({ status, data }): the
 * application/json data, else the text/plain one parsed as JSON.
 */
export function parseDefinitionValue(entry: unknown): KernelAnswer {
  const e = entry as { status?: unknown; data?: Record<string, unknown>; ename?: unknown; evalue?: unknown } | null;
  if (!e || typeof e !== 'object') return { ok: false, error: 'no reply' };
  if (e.status !== 'ok' || !e.data) return { ok: false, error: `${String(e.ename ?? 'error')}: ${String(e.evalue ?? '')}` };
  let v: unknown = e.data['application/json'];
  if (v === undefined && typeof e.data['text/plain'] === 'string') {
    try { v = JSON.parse(e.data['text/plain']); } catch { return { ok: false, error: 'unreadable reply' }; }
  }
  const r = v as (Partial<KernelDefinition> & { ok?: unknown; error?: unknown }) | null;
  if (!r || typeof r !== 'object') return { ok: false, error: 'unreadable reply' };
  if (r.ok !== true) return { ok: false, error: typeof r.error === 'string' ? r.error : 'unreadable reply' };
  if (typeof r.file !== 'string' || typeof r.line !== 'number' || typeof r.col !== 'number' || typeof r.exists !== 'boolean') return { ok: false, error: 'unreadable reply' };
  const def: KernelDefinition = { file: r.file, line: r.line, col: r.col, exists: r.exists };
  if (typeof r.cell === 'string' && typeof r.start === 'number' && typeof r.count === 'number') {
    def.cell = r.cell;
    def.start = r.start;
    def.count = r.count;
  }
  return { ok: true, def };
}
```

- [ ] **Step 5: Run the test**

Run: `npx esbuild src/extension/jupyter/definitionSnippet.ts --bundle --format=esm --outfile=tests/.build/definitionSnippet.mjs && node --test tests/kernel-definition.mjs`
Expected: `# tests 8`, `# pass 8`, `# fail 0`.

Run: `ls tests/fixtures/__pycache__ 2>&1`
Expected: `ls: cannot access 'tests/fixtures/__pycache__': No such file or directory` (the driver writes no bytecode).

- [ ] **Step 6: Commit**

```bash
git add src/extension/jupyter/definitionSnippet.ts tests/fixtures/definition_fixture.py tests/fixtures/definition_driver.py tests/kernel-definition.mjs
git commit -m "feat(definition): kernel lookup of where a dotted name is defined"
```

---

### Task 8: Silent evaluation on the kernel, and the kernel's state

**Files:**
- Modify: `src/extension/jupyter/protocol.ts:62` (insert before `export interface CompleteResult`)
- Modify: `tests/jupyter-protocol.mjs:4` (import), append at the end
- Modify: `src/extension/jupyter/client.ts:2`, `:72`, `:155`
- Modify: `src/extension/jupyter/manager.ts:4`, `:105`

What the client sends today (checked): `buildExecuteRequest` (`protocol.ts:38-60`) always sends `silent: false`, `store_history: true`, `user_expressions: {}`; completion and inspection open a websocket per request and wait 4 s at most (`client.ts:100-153`). The new request follows the inspection pattern: its own websocket, the reply on the shell channel matched by `parent_header.msg_id`, a timeout (`DEFINITION_TIMEOUT_MS`, 3000 ms), `null` on timeout, error or close. A kernel that gets the request after the timeout still runs it, silently; nothing reads that answer.

Idle: `KernelManager.isIdle` is false while a cell of this window runs on the kernel (`running`, the same set the status light uses, `manager.ts:19`) and otherwise asks the server (`GET /api/kernels/{id}`, `execution_state`). The request is sent only when it is `idle`, because a request sent while a cell runs waits for that cell to finish (FACT, real kernel: answered 2822 ms after it was sent behind a 3-second cell).

- [ ] **Step 1: Write the failing tests**

In `tests/jupyter-protocol.mjs` (line 4), find:

```js
import { buildExecuteRequest, parseReply, collectOutputs } from './.build/jupyter-protocol.mjs';
```

replace with:

```js
import { buildExecuteRequest, buildSilentEvaluateRequest, parseEvaluateReply, parseReply, collectOutputs } from './.build/jupyter-protocol.mjs';
```

Append to the end of `tests/jupyter-protocol.mjs`, after one blank line:

```js
test('buildSilentEvaluateRequest runs no code, silently, without history, and sends the expressions', () => {
  const r = buildSilentEvaluateRequest({ k: 'len(In)' }, IDS);
  assert.equal(r.header.msg_type, 'execute_request');
  assert.equal(r.header.msg_id, 'm1');
  assert.equal(r.channel, 'shell');
  assert.deepEqual(r.content, { code: '', silent: true, store_history: false, user_expressions: { k: 'len(In)' }, allow_stdin: false, stop_on_error: false });
});

test('parseEvaluateReply returns the user_expressions of our execute_reply only', () => {
  const ue = { k: { status: 'ok', data: { 'text/plain': '6' }, metadata: {} } };
  const reply = { parent_header: { msg_id: 'm1' }, header: { msg_type: 'execute_reply' }, content: { status: 'ok', user_expressions: ue } };
  assert.deepEqual(parseEvaluateReply(reply, 'm1'), ue);
  assert.equal(parseEvaluateReply(reply, 'other'), null);
  assert.equal(parseEvaluateReply({ ...reply, header: { msg_type: 'status' } }, 'm1'), null);
  assert.deepEqual(parseEvaluateReply({ ...reply, content: { status: 'error' } }, 'm1'), {});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=tests/.build/jupyter-protocol.mjs && node --test tests/jupyter-protocol.mjs`

Expected: `SyntaxError: The requested module './.build/jupyter-protocol.mjs' does not provide an export named 'buildSilentEvaluateRequest'`, `# fail 1`.

- [ ] **Step 3: Build the request and read the reply**

In `src/extension/jupyter/protocol.ts` (line 62), find:

```ts
export interface CompleteResult {
```

replace with:

```ts
/**
 * Jupyter v5.3 execute_request that runs no code and evaluates `expressions` (user_expressions) in the
 * user's namespace. silent: no output on iopub, no execution count; store_history false: no history.
 */
export function buildSilentEvaluateRequest(expressions: Record<string, string>, ids: ExecuteIds) {
  return {
    header: {
      msg_id:   ids.msgId,
      session:  ids.session,
      username: 'skena',
      msg_type: 'execute_request' as const,
      version:  '5.3' as const,
      date:     ids.date,
    },
    parent_header: {},
    metadata:      {},
    content: {
      code:             '',
      silent:           true,
      store_history:    false,
      user_expressions: expressions,
      allow_stdin:      false,
      stop_on_error:    false,
    },
    channel: 'shell' as const,
  };
}

// - the user_expressions of the execute_reply for `ourMsgId` (key -> { status, data } or the error), else null
export function parseEvaluateReply(raw: unknown, ourMsgId: string): Record<string, unknown> | null {
  const m = raw as Record<string, any>;
  if (m?.parent_header?.msg_id !== ourMsgId) return null;
  if (m?.header?.msg_type !== 'execute_reply') return null;
  const ue = m.content?.user_expressions;
  return ue && typeof ue === 'object' ? ue as Record<string, unknown> : {};
}

export interface CompleteResult {
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/extension/jupyter/protocol.ts --bundle --format=esm --outfile=tests/.build/jupyter-protocol.mjs && node --test tests/jupyter-protocol.mjs`
Expected: `# tests 7`, `# pass 6`, `# fail 1`; the one failure is test 4, `collectOutputs marks error status on error reply`, as at `771c94b` (see "Before you start").

- [ ] **Step 5: The client and the manager**

In `src/extension/jupyter/client.ts` (line 2), find:

```ts
import { buildExecuteRequest, collectOutputs, buildCompleteRequest, parseCompleteReply, buildInspectRequest, parseInspectReply, type CollectedOutput, type CompleteResult, type InspectResult } from './protocol';
```

replace with:

```ts
import { buildExecuteRequest, collectOutputs, buildCompleteRequest, parseCompleteReply, buildInspectRequest, parseInspectReply, buildSilentEvaluateRequest, parseEvaluateReply, type CollectedOutput, type CompleteResult, type InspectResult } from './protocol';
```

In `src/extension/jupyter/client.ts` (line 72), find:

```ts
// - POST /api/kernels/{id}/interrupt — stop a long-running cell without losing state
```

replace with:

```ts
// - GET /api/kernels/{id} — the server's execution state of one kernel; null when it is gone
export async function kernelState(server: KernelServerConfig, kernelId: string): Promise<LiveKernel['state'] | null> {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels/${kernelId}`, {
    headers: { Authorization: `token ${server.token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/kernels/${kernelId} ${res.status}`);
  const k = (await res.json()) as { execution_state?: LiveKernel['state'] };
  return k.execution_state ?? null;
}

// - POST /api/kernels/{id}/interrupt — stop a long-running cell without losing state
```

In `src/extension/jupyter/client.ts` (line 155), find:

```ts
// - open a WS, run one cell, resolve with the collected output. onDelta fires as replies stream.
```

replace with:

```ts
// - open a WS, evaluate user_expressions in a silent execute_request, resolve with them; null on
//   timeout, error or close. The kernel still runs a request it got after the timeout (silently).
export async function evaluateExpressions(
  server:    KernelServerConfig,
  kernelId:  string,
  expressions: Record<string, string>,
  ids:       { msgId: string; session: string; date: string },
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const url = `${wsBase(server.hubUrl)}/api/kernels/${kernelId}/channels?token=${encodeURIComponent(server.token)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `token ${server.token}` } });

  return new Promise<Record<string, unknown> | null>(resolve => {
    let done = false;
    const finish = (r: Record<string, unknown> | null) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* noop */ } resolve(r); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(buildSilentEvaluateRequest(expressions, ids))));
    ws.on('message', raw => {
      try {
        const r = parseEvaluateReply(JSON.parse(raw.toString()), ids.msgId);
        if (r) finish(r);
      } catch { /* - ignore non-JSON frames */ }
    });
    ws.on('error', () => finish(null));
    ws.on('close', () => finish(null));
  });
}

// - open a WS, run one cell, resolve with the collected output. onDelta fires as replies stream.
```

In `src/extension/jupyter/manager.ts` (line 4), find:

```ts
import { listKernels, startKernel, executeCell, completeCode, inspectCode, restartKernel, shutdownKernel, interruptKernel, type LiveKernel } from './client';
```

replace with:

```ts
import { listKernels, startKernel, executeCell, completeCode, inspectCode, restartKernel, shutdownKernel, interruptKernel, kernelState, evaluateExpressions, type LiveKernel } from './client';
```

In `src/extension/jupyter/manager.ts` (line 105), find:

```ts
  async run(
    server: KernelServerConfig,
```

replace with:

```ts
  /** - running and running nothing: no cell of this window runs on it and the server says idle */
  async isIdle(server: KernelServerConfig, kernelId: string): Promise<boolean> {
    if (this.running.has(kernelId)) return false;
    try {
      return (await kernelState(server, kernelId)) === 'idle';
    } catch {
      return false;
    }
  }

  async evaluate(
    server: KernelServerConfig,
    kernelId: string,
    expressions: Record<string, string>,
    ids: { msgId: string; session: string; date: string },
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> {
    return evaluateExpressions(server, kernelId, expressions, ids, timeoutMs);
  }

  async run(
    server: KernelServerConfig,
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

- [ ] **Step 7: Commit**

```bash
git add src/extension/jupyter/protocol.ts tests/jupyter-protocol.mjs src/extension/jupyter/client.ts src/extension/jupyter/manager.ts
git commit -m "feat(jupyter): silent user_expressions evaluation and a kernel's state"
```

---

### Task 9: The joined file

**Files:**
- Modify: `src/extension/ipcEndpoint.ts:52` (export `userTempDir`)
- Create: `src/extension/definition/joinedFile.ts`
- Test: `tests/joined-file.mjs`

The kind the spike chose (Task 1). The folder is the one the relay endpoint files already use (`ipcEndpoint.ts:24-29`, `ownDir` `:39-50`: `$XDG_RUNTIME_DIR/skena` when set, else `skena-<user>` in the OS temp dir, created owner-only, refused when it is another user's), with a `definition` folder under it. One file per canvas and text, `def-<hashPath(canvas)>-<sha1(text) 12 hex>.py`, written once: VS Code never holds an edited copy of it, so nothing asks to be saved and nothing goes to hot exit, and Pylance always reads the text the lookup was made for. The `-` in the name keeps it from being importable by another file. Past `KEEP` (4) files of one canvas, the oldest are deleted.

- [ ] **Step 1: Write the failing tests**

Create `tests/joined-file.mjs`:

```js
// - run: npx esbuild src/extension/definition/joinedFile.ts --bundle --platform=node --format=esm --outfile=tests/.build/joinedFile.mjs && node --test tests/joined-file.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { KEEP, joinedFileName, writeJoinedFile } from './.build/joinedFile.mjs';

test('1. one file per canvas and text, written owner-only in an owner-only folder; the same text reuses it', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skena-joined-'));
  const a = writeJoinedFile('/p/a.canvas', 'x = 1\n', tmp);
  assert.equal(basename(a), joinedFileName('/p/a.canvas', 'x = 1\n'));
  assert.match(basename(a), /^def-[0-9a-z]+-[0-9a-f]{12}\.py$/);
  assert.equal(readFileSync(a, 'utf8'), 'x = 1\n');
  assert.equal(statSync(a).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(a)).mode & 0o777, 0o700);
  assert.equal(writeJoinedFile('/p/a.canvas', 'x = 1\n', tmp), a);
  assert.notEqual(writeJoinedFile('/p/a.canvas', 'x = 2\n', tmp), a);
  assert.notEqual(joinedFileName('/p/b.canvas', 'x = 1\n'), basename(a));
});

test('2. past KEEP files of a canvas the oldest go; another canvas keeps its own', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skena-joined-'));
  const other = writeJoinedFile('/p/b.canvas', 'b\n', tmp);
  const base = Date.now() / 1000 - 100;
  const files = [];
  for (let i = 1; i <= KEEP + 2; i++) {
    const f = writeJoinedFile('/p/a.canvas', `v${i}\n`, tmp);
    utimesSync(f, base + i, base + i);
    files.push(basename(f));
  }
  const left = readdirSync(dirname(other)).sort();
  assert.deepEqual(left, [...files.slice(2), basename(other)].sort());
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/extension/definition/joinedFile.ts --bundle --platform=node --format=esm --outfile=tests/.build/joinedFile.mjs && node --test tests/joined-file.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/extension/definition/joinedFile.ts"`.

- [ ] **Step 3: Export the per-user folder**

In `src/extension/ipcEndpoint.ts` (line 52), find:

```ts
/** - `endpoint` is the relay's "port:token" */
```

replace with:

```ts
/**
 * - the per-user folder the endpoint files go in ($XDG_RUNTIME_DIR/skena, else skena-<user> in the
 *   OS temp dir), created owner-only; throws when it is not this user's alone. Go to definition keeps
 *   its joined files under it.
 */
export function userTempDir(tmp?: string): string {
  const dir = endpointDirs(tmp)[0];
  ownDir(dir);
  return dir;
}

/** - `endpoint` is the relay's "port:token" */
```

- [ ] **Step 4: Write the module**

Create `src/extension/definition/joinedFile.ts`:

```ts
/**
 * Where the joined document Pylance reads lives (go to definition): a .py file per canvas and text
 * under the per-user temporary folder (ipcEndpoint userTempDir), outside every project. A file is
 * named by a hash of the canvas path and a hash of its text and written once, so the document VS Code
 * opens from it is never edited (no save prompt, nothing for hot exit) and always has the text it was
 * written with. Past KEEP files of one canvas the oldest are deleted. No vscode import.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hashPath, userTempDir } from '../ipcEndpoint';

/** - joined files kept per canvas; a lookup only ever reads the newest */
export const KEEP = 4;

/** - the file name of `text` for `canvasPath`: def-<canvas hash>-<text hash>.py */
export function joinedFileName(canvasPath: string, text: string): string {
  const h = createHash('sha1').update(text).digest('hex').slice(0, 12);
  return `def-${hashPath(path.resolve(canvasPath))}-${h}.py`;
}

/**
 * The joined file of `text` for `canvasPath`, written when it is not there yet (owner-only); then all
 * but the KEEP newest of this canvas's files are deleted. `tmp` (tests) stands for the OS temp dir.
 */
export function writeJoinedFile(canvasPath: string, text: string, tmp?: string): string {
  const dir = path.join(userTempDir(tmp), 'definition');
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const name = joinedFileName(canvasPath, text);
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, text, { mode: 0o600 });
  else fs.utimesSync(file, new Date(), new Date());
  const prefix = name.slice(0, name.lastIndexOf('-') + 1);
  const own = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.py'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of own.slice(KEEP)) if (f !== name) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx esbuild src/extension/definition/joinedFile.ts --bundle --platform=node --format=esm --outfile=tests/.build/joinedFile.mjs && node --test tests/joined-file.mjs`
Expected: `# tests 2`, `# pass 2`, `# fail 0`.

Run: `npx esbuild src/extension/ipcEndpoint.ts --bundle --platform=node --format=esm --outfile=tests/.build/ipcEndpoint.mjs && node --test tests/ipc-endpoint.mjs`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/extension/ipcEndpoint.ts src/extension/definition/joinedFile.ts tests/joined-file.mjs
git commit -m "feat(definition): joined file per canvas and text in the per-user temp folder"
```

---

### Task 10: The host: Pylance, then the kernel; files beside the canvas; the quick pick

**Files:**
- Modify: `src/shared/types.ts:10`, `:391`, `:543`, `:561`, `:868`
- Create: `src/extension/definition/pylanceLocations.ts`
- Create: `src/extension/definition/goToDefinition.ts`
- Modify: `src/extension/editor-provider.ts:90`, `:694`

Messages (checked: completion uses `complete`/`completeResult` with a `reqId`, `types.ts:389`, `:559`, and `App.tsx:209-214` re-sends results as window events):
- `goToDefinition` (webview → host): `reqId`, the cell, its live code (the host's copy of the canvas can be up to 500 ms behind, `scheduleSave` in `CanvasView.tsx:874-879`), the cursor's 1-based line and column, and the dotted name or `null`.
- `definitionResult` (host → webview): the places, empty when none. The webview acts on it (Task 11), so that an answer arriving after the user has typed on is dropped there.
- `showDefinitions` (webview → host): one file to open, or several places for a quick pick.
- `definitionGoto` (host → webview): the quick pick chose a cell.

`findDefinitions`: the canvas's code cells in run order with the asking cell's live code, joined under `# type: ignore` (pyright's ignore for a whole file), written by `writeJoinedFile`, and Pylance asked at the cursor's place. Places from Pylance end the lookup. Otherwise, when there is a dotted name, the cell's kernel (`resolveCellKernel`: an edge-bound kernel, else the section's, the same as Run) is asked if it has a live id and `isIdle`; no kernel, a kernel not started, a busy kernel, no answer in 3 s or `ok: false` all give no places.

`pylanceLocations`: `openTextDocument` (never shown), then the command it is given at the position: `vscode.executeDefinitionProvider` here, `vscode.executeReferenceProvider` for find references (Task 13); a `Location` or a `LocationLink` (`targetSelectionRange`, else `targetRange`) becomes `{ uri, line, character, endLine, endCharacter }` (definitions use the start only). For a file not asked about before in this window an empty answer is asked again every `RETRY_MS` (250 ms) until `WAIT_MS` (600 ms) (Pylance may still be reading the new file); a file asked about before gets one call. Not installed: no places. The two times come from the spike: a fresh joined file's first answer took 164-249 ms, the window's first lookup 581 ms, and no call came back empty (Spike result). `canvasCells` is exported for Task 13.

`showDefinitions`: one file opens with `showTextDocument(doc, { viewColumn: ViewColumn.Beside, selection })`: the group to the right of the canvas's group, created if there is none; the canvas stays visible. Several places: `showQuickPick` with `pickEntry` labels and the target line's text (cells from the canvas, files read once each with `vscode.workspace.fs.readFile`); a picked file opens the same way, a picked cell goes back as `definitionGoto`.

- [ ] **Step 1: The messages**

In `src/shared/types.ts` (line 10), find:

```ts
import type { ChatAttachment } from './chatAttachments';
```

replace with:

```ts
import type { ChatAttachment } from './chatAttachments';
import type { DefinitionTarget } from './goToDefinition';
```

In `src/shared/types.ts` (line 391), find:

```ts
export interface MsgInspect { type: 'inspect'; reqId: string; cellNodeId: string; code: string; cursorPos: number; }
```

replace with:

```ts
export interface MsgInspect { type: 'inspect'; reqId: string; cellNodeId: string; code: string; cursorPos: number; }
// - leader g in a code cell: where is the name at line/col (1-based) of the live `code` defined. `name`
//   is the dotted name there, null when its chain holds a call or subscript (the kernel is not asked then)
export interface MsgGoToDefinition { type: 'goToDefinition'; reqId: string; cellNodeId: string; code: string; line: number; col: number; name: string | null; }
// - webview → host: open the one file target, or show the quick pick of several targets
export interface MsgShowDefinitions { type: 'showDefinitions'; targets: DefinitionTarget[]; }
```

In `src/shared/types.ts` (line 543), find:

```ts
  | MsgCompleteResult
  | MsgInspectResult
```

replace with:

```ts
  | MsgCompleteResult
  | MsgInspectResult
  | MsgDefinitionResult
  | MsgDefinitionGoto
```

In `src/shared/types.ts` (line 561), find:

```ts
export interface MsgInspectResult { type: 'inspectResult'; reqId: string; found: boolean; text: string; }
```

replace with:

```ts
export interface MsgInspectResult { type: 'inspectResult'; reqId: string; found: boolean; text: string; }
// - host → webview: where a goToDefinition request's name is defined; empty when nowhere
export interface MsgDefinitionResult { type: 'definitionResult'; reqId: string; cellNodeId: string; targets: DefinitionTarget[]; }
// - host → webview: the quick pick chose a cell; select it and open its editor at the line, as leader g does
export interface MsgDefinitionGoto { type: 'definitionGoto'; cellNodeId: string; line: number; col: number; }
```

In `src/shared/types.ts` (line 868), find:

```ts
  | MsgComplete
  | MsgInspect
```

replace with:

```ts
  | MsgComplete
  | MsgInspect
  | MsgGoToDefinition
  | MsgShowDefinitions
```

- [ ] **Step 2: Asking Pylance**

Create `src/extension/definition/pylanceLocations.ts`:

```ts
/**
 * Pylance's answer at a position of the joined file: where the name there is defined
 * (vscode.executeDefinitionProvider) or every reference of it (vscode.executeReferenceProvider).
 * Pylance may answer nothing while it starts or reads a file it has just been given, so for a file not
 * asked about before in this window an empty answer is asked again every RETRY_MS until WAIT_MS has
 * passed; a file asked about before gets one call. Without Pylance installed there is no answer.
 */
import * as vscode from 'vscode';
import type { DocPos } from '../../shared/goToDefinition';

/**
 * - from the spike (Task 1, 2026-10-07, factors window): a fresh joined file's first answer came in
 *   164-249 ms, the window's first lookup (an untitled document) in 581 ms, and no call came back empty
 */
export const RETRY_MS = 250;
export const WAIT_MS = 600;

export type PylanceCommand = 'vscode.executeDefinitionProvider' | 'vscode.executeReferenceProvider';

/** - one location of an answer: its document's URI string, 0-based start and end */
export interface PylanceLocation { uri: string; line: number; character: number; endLine: number; endCharacter: number }

const PYLANCE = 'ms-python.vscode-pylance';
// - the joined files asked about in this window
const asked = new Set<string>();

function toLocation(l: vscode.Location | vscode.LocationLink): PylanceLocation {
  const uri = l instanceof vscode.Location ? l.uri : l.targetUri;
  const r = l instanceof vscode.Location ? l.range : l.targetSelectionRange ?? l.targetRange;
  return { uri: uri.toString(), line: r.start.line, character: r.start.character, endLine: r.end.line, endCharacter: r.end.character };
}

/** - the file's URI string (to tell its own locations apart) and Pylance's answer to `command` at `pos` in it */
export async function pylanceLocations(command: PylanceCommand, file: string, pos: DocPos): Promise<{ uri: string; locs: PylanceLocation[] }> {
  const uri = vscode.Uri.file(file);
  if (!vscode.extensions.getExtension(PYLANCE)) return { uri: uri.toString(), locs: [] };
  const doc = await vscode.workspace.openTextDocument(uri);
  const at = new vscode.Position(pos.line, pos.character);
  const end = Date.now() + (asked.has(file) ? 0 : WAIT_MS);
  asked.add(file);
  for (;;) {
    const raw = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>(command, doc.uri, at);
    const locs = (raw ?? []).map(toLocation);
    if (locs.length > 0 || Date.now() >= end) return { uri: doc.uri.toString(), locs };
    await new Promise(resolve => setTimeout(resolve, RETRY_MS));
  }
}
```

- [ ] **Step 3: Finding and showing definitions**

Create `src/extension/definition/goToDefinition.ts`:

```ts
/**
 * Go to definition from a code cell, the host's half. findDefinitions asks Pylance about the canvas's
 * code cells joined in run order, then, when Pylance finds nothing, the cell's kernel if it is running
 * and idle. showDefinitions opens what the webview hands back: one file in the editor group beside
 * the canvas, or a quick pick of several places.
 */
import * as os from 'os';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { CanvasData, CodeNode, HostToWebview, MsgGoToDefinition } from '../../shared/types';
import {
  codeCellsInRunOrder, joinCells, pickEntry, targetsFromKernel, targetsFromLocations, toJoined,
  type DefinitionTarget, type JoinCell, type KernelDefinition,
} from '../../shared/goToDefinition';
import { cellKernelView, kernelById, resolveCellKernel } from '../../shared/kernelBinding';
import { DEFINITION_KEY, DEFINITION_TIMEOUT_MS, definitionExpression, parseDefinitionValue } from '../jupyter/definitionSnippet';
import type { KernelManager } from '../jupyter/manager';
import { writeJoinedFile } from './joinedFile';
import { pylanceLocations } from './pylanceLocations';

// - `# type: ignore` first: Pylance reports no problems for the joined file (pyright: a file-level ignore)
export const JOINED_HEADER = ['# type: ignore', '# - skena: the code cells of one canvas in run order, for go to definition and find references'];

/** - the canvas's Python code cells in run order, the asking cell with its live text */
export function canvasCells(canvas: CanvasData, cellId: string, liveCode: string): JoinCell[] {
  const nodes = canvas.nodes as (CodeNode & { type: string })[];
  const byId = new Map(nodes.map(n => [n.id, n]));
  return codeCellsInRunOrder(nodes, canvas.metadata?.sections ?? [])
    .map(id => ({ id, code: id === cellId ? liveCode : (byId.get(id)?.code ?? '') }));
}

// - the kernel's answer for `name`, or null: no kernel, not idle, no reply in time, no source
async function kernelDefinition(name: string, cellId: string, canvas: CanvasData, manager: KernelManager): Promise<KernelDefinition | null> {
  const kid = resolveCellKernel(cellId, cellKernelView(canvas));
  const kernel = kid ? kernelById(canvas, kid) : null;
  const server = kernel ? manager.serverByName(kernel.server) : undefined;
  if (!kernel?.kernelId || !server) return null;
  // - never queue behind a running cell
  if (!(await manager.isIdle(server, kernel.kernelId))) return null;
  const ids = { msgId: randomUUID(), session: randomUUID(), date: new Date().toISOString() };
  const ue = await manager.evaluate(server, kernel.kernelId, { [DEFINITION_KEY]: definitionExpression(name) }, ids, DEFINITION_TIMEOUT_MS);
  const answer = parseDefinitionValue(ue?.[DEFINITION_KEY]);
  return answer.ok ? answer.def : null;
}

/** - where the name at the request's cursor is defined: Pylance first, the kernel when Pylance finds nothing */
export async function findDefinitions(msg: MsgGoToDefinition, canvas: CanvasData, canvasPath: string, manager: KernelManager): Promise<DefinitionTarget[]> {
  const cells = canvasCells(canvas, msg.cellNodeId, msg.code);
  const joined = joinCells(cells, JOINED_HEADER);
  const cursor = toJoined(joined, msg.cellNodeId, msg.line, msg.col);
  if (cursor) {
    const { uri, locs } = await pylanceLocations('vscode.executeDefinitionProvider', writeJoinedFile(canvasPath, joined.text), cursor);
    const targets = targetsFromLocations(locs, uri, joined, cursor);
    if (targets.length > 0) return targets;
  }
  if (!msg.name) return [];
  const def = await kernelDefinition(msg.name, msg.cellNodeId, canvas, manager);
  return def ? targetsFromKernel(def, cells) : [];
}

/** - `t` in the editor group beside the canvas (created if none), cursor and view on its line and column */
async function openFileTarget(t: Extract<DefinitionTarget, { kind: 'file' }>): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(t.uri));
  const pos = new vscode.Position(t.line - 1, t.col - 1);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(pos, pos) });
}

// - the text of each target's line: a cell's from the canvas, a file's read once per file
async function lineTexts(targets: DefinitionTarget[], canvas: CanvasData): Promise<string[]> {
  const files = new Map<string, Promise<string[]>>();
  const fileLines = (uri: string) => {
    let p = files.get(uri);
    if (!p) {
      p = Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.parse(uri)))
        .then(b => new TextDecoder().decode(b).split(/\r\n|\r|\n/), () => []);
      files.set(uri, p);
    }
    return p;
  };
  return Promise.all(targets.map(async t => {
    if (t.kind === 'file') return (await fileLines(t.uri))[t.line - 1] ?? '';
    const cell = canvas.nodes.find(n => n.id === t.cellId) as CodeNode | undefined;
    return (cell?.code ?? '').split(/\r\n|\r|\n/)[t.line - 1] ?? '';
  }));
}

/** - one file target opens beside the canvas; several go to a quick pick, and a picked cell back to the webview */
export async function showDefinitions(targets: DefinitionTarget[], canvas: CanvasData, send: (m: HostToWebview) => void): Promise<void> {
  if (targets.length === 0) return;
  if (targets.length === 1 && targets[0].kind === 'file') { await openFileTarget(targets[0]); return; }
  const texts = await lineTexts(targets, canvas);
  const labelOf = (id: string) => canvas.nodes.find(n => n.id === id)?.nodeLabel ?? id;
  const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  const items = targets.map((t, i) => ({
    ...pickEntry(t, texts[i], labelOf, uri => vscode.Uri.parse(uri).fsPath, roots, os.homedir()),
    target: t,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Go to definition', matchOnDescription: true });
  if (!picked) return;
  const t = picked.target;
  if (t.kind === 'file') await openFileTarget(t);
  else send({ type: 'definitionGoto', cellNodeId: t.cellId, line: t.line, col: t.col });
}
```

- [ ] **Step 4: The two message cases**

In `src/extension/editor-provider.ts` (line 90), find:

```ts
import { youtubeId, YOUTUBE_NODE } from '../shared/youtube';
```

replace with:

```ts
import { youtubeId, YOUTUBE_NODE } from '../shared/youtube';
import { findDefinitions, showDefinitions } from './definition/goToDefinition';
```

In `src/extension/editor-provider.ts` (line 694), find:

```ts
        case 'inspect':  await this.handleInspect(msg, manager, document, send); break;
      }
```

replace with:

```ts
        case 'inspect':  await this.handleInspect(msg, manager, document, send); break;
        case 'goToDefinition': {
          // - the answer always goes back, empty on a failure, so the cell can show its note
          const targets = await findDefinitions(msg, document.canvas, document.uri.fsPath, manager)
            .catch(err => { console.warn('[skena] go to definition', err); return []; });
          send({ type: 'definitionResult', reqId: msg.reqId, cellNodeId: msg.cellNodeId, targets });
          break;
        }
        case 'showDefinitions': await showDefinitions(msg.targets, document.canvas, send); break;
      }
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

Run: `npm run build`
Expected: three `⚡ Done in …` lines, no `✘ [ERROR]`. Leave the rewritten `.vscode/skena-mcp.js` unstaged.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/extension/definition/pylanceLocations.ts src/extension/definition/goToDefinition.ts src/extension/editor-provider.ts
git commit -m "feat(definition): host asks Pylance, then the idle kernel; opens files and the quick pick"
```

---

### Task 11: The webview: leader g in code cells, the note, landing in a cell

**Files:**
- Modify: `src/webview/canvas/editorJumpLabels.ts:123`, `:219-230`, `:245`
- Create: `src/webview/canvas/nodes/cellDefinition.ts`
- Modify: `src/webview/canvas/nodes/CodeNode.tsx:27`, `:279`, `:357`, `:369-378`, `:439`, `:445`, `:470-474`, `:649-651`
- Modify: `src/webview/App.tsx:212-214`
- Modify: `src/webview/canvas/CanvasView.tsx:4265-4267`
- Modify: `src/webview/styles/canvas.css` (append after the last line, 381)

Checked at `771c94b`:
- Keys: `installJumpLabels` (`editorJumpLabels.ts:144`) reads keys at capture on the editor's container, before Monaco and monaco-vim; a module-level window listener at capture (`:31-34`) ends a held leader before later window listeners take the key; the leader counts only in vim normal mode with nothing typed (`idleNormal`, `:47-49`). CodeNode calls it in `onEditorMount` (`CodeNode.tsx:369`); TextNode and ChatInput call it too and are not changed, so leader `g` and leader `z` keep their meaning there.
- The jump's cursor move (`jump`, `:219-228`) also resets vim's remembered column (`lastHPos`) and last motion, so a `j` after it starts from the new column; it becomes `moveVimCursor`, used for the definition's cursor too.
- Opening a cell's editor: `skena:enterEdit` with the cell id (`CodeNode.tsx:470-477`; sent by Enter, `i` and new cells, `CanvasView.tsx:3116`, `:3911`). The editor restores the saved view state and the preview's scroll offset in `onEditorMount` (`:370-377`), then takes focus. A new monaco-vim editor starts in normal mode.
- Selecting a node as `h/j/k/l` do: `focusNodeById` (`CanvasView.tsx:1839-1845`): the `` ` `` register (`recordPreviousPosition`), `lastFocusedNodeId`, selection, `skena:focusNode`, and the smallest pan (`revealNode`). A node in a folded section is hidden and not rendered (`hiddenByFold`, `:915-922`); `goToSection` unfolds through `foldLaneRef.current(id)` (`:1937`), and a new cell gets `skena:enterEdit` 80 ms after it is added so that it has mounted (`:3907-3912`).
- No React Flow `onlyRenderVisibleElements`: every node that is not hidden is mounted.

The note: `no definition found for <name>` (the dotted name, else the word). With no name under the cursor (a blank, an operator, a number) nothing is asked and nothing is shown (user). The note sits over the editor's bottom right, above the vim status line, positioned absolutely so the cell keeps its size, and goes away on the next key in the cell and when the editor closes.

An answer is dropped when a key was pressed in the cell after the request, or the cell lost focus: otherwise keys typed while waiting (`dd`, say) would land in the other cell's editor once it opened. The key listener sits on the editor's container at capture, added before the jump labels' listener there: listeners on one element run in the order they were added, and `stopPropagation` does not stop the others, so it sees every key, a leader the jump labels stop included. A key counts only if its `timeStamp` is after the request was made, so the `g` that asks clears the previous note and drops the previous lookup, not its own.

Leader `z` is read in code cells from this task on (`onLookup`) and does nothing until Task 14.

- [ ] **Step 1: The cursor move, shared**

In `src/webview/canvas/editorJumpLabels.ts` (line 123), find:

```ts
function targetsFor(dir: JumpDir, lines: VisibleLine[], cursor: TextPos): TextPos[] {
```

replace with:

```ts
/**
 * Puts the cursor at `t` (1-based) as a vim motion would: vim keeps the column of the last vertical
 * move for the next j/k (moveByLines), so without resetting it a j right after would go back to that
 * old column.
 */
export function moveVimCursor(editor: MonacoEditor.IStandaloneCodeEditor, vim: VimAdapterInstance, t: TextPos): void {
  editor.setPosition({ lineNumber: t.line, column: t.col });
  const s = vimState(vim);
  if (s) {
    s.lastMotion = null;
    s.lastHPos = t.col - 1;
  }
}

function targetsFor(dir: JumpDir, lines: VisibleLine[], cursor: TextPos): TextPos[] {
```

In `src/webview/canvas/editorJumpLabels.ts` (lines 219-230), find:

```ts
  const jump = (t: TextPos) => {
    editor.setPosition({ lineNumber: t.line, column: t.col });
    // - vim keeps the column of the last vertical move for the next j/k (moveByLines); without this a
    //   j right after the jump would go back to that old column
    const s = vimState(vim);
    if (s) {
      s.lastMotion = null;
      s.lastHPos = t.col - 1;
    }
  };

  const readKey = (e: KeyboardEvent) => {
```

replace with:

```ts
  const readKey = (e: KeyboardEvent) => {
```

In `src/webview/canvas/editorJumpLabels.ts` (line 245), find:

```ts
      if (target) jump(target);
```

replace with:

```ts
      if (target) moveVimCursor(editor, vim, target);
```

- [ ] **Step 2: The webview's half of a lookup**

Create `src/webview/canvas/nodes/cellDefinition.ts`:

```ts
/**
 * Go to definition in a code cell (leader g), the webview's half. The dotted name under the cursor goes
 * to the host (goToDefinition); its answer (definitionResult) selects a cell here (skena:goToCell,
 * CanvasView), or goes back to the host to open a file or show a quick pick (showDefinitions). With no
 * name under the cursor nothing is asked and nothing shown (user). An answer that arrives after
 * another key in the cell or after the cell lost focus is dropped: the user has moved on, and keys
 * typed meanwhile must not land in another cell.
 */
import type { editor as MonacoEditor } from 'monaco-editor';
import { dottedNameAt } from '../../../shared/goToDefinition';
import type { MsgDefinitionResult } from '../../../shared/types';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - one lookup per cell at a time; `since` is performance.now() when it was asked
interface Pending { reqId: string; name: string; since: number; stale: boolean; note: (text: string) => void }
const pending = new Map<string, Pending>();
let counter = 0;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('skena:definitionResult', (e: Event) => {
    const r = (e as CustomEvent<MsgDefinitionResult>).detail;
    const p = pending.get(r.cellNodeId);
    if (!p || p.reqId !== r.reqId) return;
    pending.delete(r.cellNodeId);
    if (p.stale) return;
    if (r.targets.length === 0) { p.note(`no definition found for ${p.name}`); return; }
    const only = r.targets.length === 1 ? r.targets[0] : null;
    if (only?.kind === 'cell') {
      window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: only.cellId, line: only.line, col: only.col } }));
      return;
    }
    vscodePostMessage({ type: 'showDefinitions', targets: r.targets });
  });
}

/** - leader g in `cellId`'s editor: ask the host where the name under the cursor is defined; `note` shows a line in the cell */
export function requestDefinition(editor: MonacoEditor.IStandaloneCodeEditor, cellId: string, note: (text: string) => void): void {
  listen();
  const pos = editor.getPosition();
  const model = editor.getModel();
  if (!pos || !model) return;
  const at = dottedNameAt(model.getLineContent(pos.lineNumber), pos.column);
  if (!at) return;
  const reqId = `def-${++counter}`;
  pending.set(cellId, { reqId, name: at.dotted ?? at.word, since: performance.now(), stale: false, note });
  vscodePostMessage({ type: 'goToDefinition', reqId, cellNodeId: cellId, code: model.getValue(), line: pos.lineNumber, col: pos.column, name: at.dotted });
}

/** - a key in the cell, or the cell losing focus, at `when` (an event's timeStamp): a lookup asked before it is dropped */
export function dropLookup(cellId: string, when: number): void {
  const p = pending.get(cellId);
  if (p && when > p.since) p.stale = true;
}
```

- [ ] **Step 3: The code cell**

In `src/webview/canvas/nodes/CodeNode.tsx` (line 27), find:

```tsx
import { installJumpLabels } from '../editorJumpLabels';
```

replace with:

```tsx
import { installJumpLabels, moveVimCursor } from '../editorJumpLabels';
import { dropLookup, requestDefinition } from './cellDefinition';
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 279), find:

```tsx
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
```

replace with:

```tsx
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  // - the vim adapter of the open editor (moveVimCursor needs it)
  const vimRef = useRef<ReturnType<typeof initVimMode> | null>(null);
  // - where the next editor opens its cursor (go to definition); the saved view state otherwise
  const pendingCursorRef = useRef<{ line: number; col: number } | null>(null);
  // - leader g's note in the cell (no definition found …); gone on the next key
  const [note, setNote] = useState<string | null>(null);
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 357), find:

```tsx
    const vimMode = initVimMode(editorInstance, vimStatusRef.current ?? undefined);
```

replace with:

```tsx
    const vimMode = initVimMode(editorInstance, vimStatusRef.current ?? undefined);
    vimRef.current = vimMode;
```

In `src/webview/canvas/nodes/CodeNode.tsx` (lines 369-378), find:

```tsx
    installJumpLabels(editorInstance, vimMode);
    if (savedViewState.current) editorInstance.restoreViewState(savedViewState.current);
    // - the preview is still on screen over the editor; start at its scroll offset (it shares the
    // - editor's font and line height, so the offsets map 1:1) so nothing moves when it goes
    const previewEl = previewElRef.current;
    if (previewEl) {
      editorInstance.setScrollTop(previewEl.scrollTop);
      editorInstance.setScrollLeft(previewEl.scrollLeft);
    }
    editorInstance.focus();
```

replace with:

```tsx
    // - any key clears the note and drops a lookup still running. Added before the jump labels' listener
    //   on the same container at capture, so it runs first and sees a leader they stop
    const container = editorInstance.getContainerDomNode();
    const onAnyKey = (e: KeyboardEvent) => { setNote(null); dropLookup(id, e.timeStamp); };
    container.addEventListener('keydown', onAnyKey, { capture: true });
    editorInstance.onDidDispose(() => container.removeEventListener('keydown', onAnyKey, { capture: true }));
    // - leader z (find references) does nothing yet
    installJumpLabels(editorInstance, vimMode, { onLookup: what => { if (what === 'definition') requestDefinition(editorInstance, id, setNote); } });
    if (savedViewState.current) editorInstance.restoreViewState(savedViewState.current);
    // - the preview is still on screen over the editor; start at its scroll offset (it shares the
    // - editor's font and line height, so the offsets map 1:1) so nothing moves when it goes
    const previewEl = previewElRef.current;
    if (previewEl) {
      editorInstance.setScrollTop(previewEl.scrollTop);
      editorInstance.setScrollLeft(previewEl.scrollLeft);
    }
    // - opened by go to definition: the definition's line, scrolled into view, over the preview's offset
    const cursor = pendingCursorRef.current;
    pendingCursorRef.current = null;
    if (cursor) {
      moveVimCursor(editorInstance, vimMode, cursor);
      editorInstance.revealPositionInCenterIfOutsideViewport({ lineNumber: cursor.line, column: cursor.col });
    }
    editorInstance.focus();
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 439), find:

```tsx
      setEditing(false);
      setEditorShown(false);
    };
```

replace with:

```tsx
      setEditing(false);
      setEditorShown(false);
      setNote(null);
    };
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 445), find:

```tsx
    editorInstance.onDidBlurEditorText(() => {
      setTimeout(() => {
```

replace with:

```tsx
    editorInstance.onDidBlurEditorText(() => {
      dropLookup(id, performance.now());
      setTimeout(() => {
```

In `src/webview/canvas/nodes/CodeNode.tsx` (lines 470-474), find:

```tsx
  // - a freshly-created code cell (autoEdit) or Enter-on-selected fires skena:enterEdit → edit mode
  useEffect(() => {
    const onEnter = (e: Event) => {
      if ((e as CustomEvent).detail?.id === id) startEdit();
    };
```

replace with:

```tsx
  // - a freshly-created code cell (autoEdit) or Enter-on-selected fires skena:enterEdit → edit mode.
  //   Go to definition adds a cursor: the editor opens there, or an open one moves there.
  useEffect(() => {
    const onEnter = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; cursor?: { line: number; col: number } }>).detail;
      if (d?.id !== id) return;
      const ed = editorRef.current;
      if (d.cursor && ed?.getModel() && vimRef.current) {
        moveVimCursor(ed, vimRef.current, d.cursor);
        ed.revealPositionInCenterIfOutsideViewport({ lineNumber: d.cursor.line, column: d.cursor.col });
        ed.focus();
        return;
      }
      if (d.cursor) pendingCursorRef.current = d.cursor;
      startEdit();
    };
```

In `src/webview/canvas/nodes/CodeNode.tsx` (lines 649-651), find:

```tsx
              <div ref={vimStatusRef} className="skena-code-vim-status" style={{ fontSize: 10, opacity: 0.6, padding: '0 6px', fontFamily: 'var(--vscode-editor-font-family, monospace)', height: 14, lineHeight: '14px', flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap' }} />
            </div>
          )}
```

replace with:

```tsx
              <div ref={vimStatusRef} className="skena-code-vim-status" style={{ fontSize: 10, opacity: 0.6, padding: '0 6px', fontFamily: 'var(--vscode-editor-font-family, monospace)', height: 14, lineHeight: '14px', flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap' }} />
            </div>
          )}
          {/* - over the editor's bottom right, above the vim status line; absolute, so the cell keeps its size */}
          {editing && note && <div className="skena-code-def-note">{note}</div>}
```

Append to the end of `src/webview/styles/canvas.css`, after one blank line:

```css
/* - leader g's note in a code cell (CodeNode.tsx): over the editor's bottom right, above the 14px vim
   - status line; pointer-transparent, gone on the next key */
.skena-code-def-note {
  position: absolute;
  right: 8px;
  bottom: 16px;
  z-index: 2;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.4));
  background: var(--vscode-editorWidget-background, #252526);
  color: var(--vscode-editorWidget-foreground, inherit);
  font: 11px/16px var(--vscode-editor-font-family, monospace);
  white-space: nowrap;
  pointer-events: none;
}
```

- [ ] **Step 4: Routing the host's answers, landing in a cell**

In `src/webview/App.tsx` (lines 212-214), find:

```tsx
        case 'inspectResult':
          window.dispatchEvent(new CustomEvent('skena:inspectResult', { detail: msg }));
          break;
```

replace with:

```tsx
        case 'inspectResult':
          window.dispatchEvent(new CustomEvent('skena:inspectResult', { detail: msg }));
          break;
        case 'definitionResult':
          window.dispatchEvent(new CustomEvent('skena:definitionResult', { detail: msg }));
          break;
        case 'definitionGoto':
          window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: msg.cellNodeId, line: msg.line, col: msg.col } }));
          break;
```

In `src/webview/canvas/CanvasView.tsx` (lines 4265-4267), find:

```tsx
    window.addEventListener('skena:focusNodeRequest', handler);
    return () => window.removeEventListener('skena:focusNodeRequest', handler);
  }, [focusNodeById]);
```

replace with:

```tsx
    window.addEventListener('skena:focusNodeRequest', handler);
    return () => window.removeEventListener('skena:focusNodeRequest', handler);
  }, [focusNodeById]);

  // - go to definition landed in a code cell (cellDefinition.ts, or the host's quick pick): select it
  //   as h/j/k/l do (smallest pan, the `` ` `` register), then open its editor at the line. A cell in
  //   a folded section unfolds it first and waits for the cell to mount, as a new cell does.
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, line, col } = (e as CustomEvent<{ id: string; line: number; col: number }>).detail;
      const open = () => {
        focusNodeById(id);
        window.dispatchEvent(new CustomEvent('skena:enterEdit', { detail: { id, cursor: { line, col } } }));
      };
      const lane = derivedLanesRef.current.find(l => (l.folded ?? []).includes(id));
      if (!lane) { open(); return; }
      foldLaneRef.current(lane.id);   // - the same action unfolds
      setTimeout(open, 80);
    };
    window.addEventListener('skena:goToCell', handler);
    return () => window.removeEventListener('skena:goToCell', handler);
  }, [focusNodeById]);
```

- [ ] **Step 5: Typecheck, build, the existing key and canvas tests**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

Run: `npm run build`
Expected: three `⚡ Done in …` lines, no `✘ [ERROR]`.

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`
Expected: `# pass 24`, `# fail 0`.

Run: `npx esbuild src/webview/canvas/gChord.ts --bundle --format=esm --outfile=tests/.build/gChord.mjs && node --test tests/g-chord.mjs`
Expected: `# pass 5`, `# fail 0`.

Run: `npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=tests/.build/sectionLanes.mjs && node --test tests/section-lanes.mjs`
Expected: `# pass 49`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/webview/canvas/editorJumpLabels.ts src/webview/canvas/nodes/cellDefinition.ts src/webview/canvas/nodes/CodeNode.tsx src/webview/App.tsx src/webview/canvas/CanvasView.tsx src/webview/styles/canvas.css
git commit -m "feat(definition): leader g in code cells, the note, landing in a cell"
```

---

### Task 12: Find references, the pure part: places, the peek's models and order, the taller cell

**Files:**
- Create: `src/shared/findReferences.ts`
- Create: `tests/fixtures/monaco-references-model.js`
- Test: `tests/find-references.mjs`

The spec: leader `z` lists every reference of the name from Pylance over the same joined file (`vscode.executeReferenceProvider`), mapped back to cells and files, in Monaco's reference peek, grouped by cell or file.

`referencesFromLocations` maps Pylance's locations as `targetsFromLocations` does for definitions, with two differences: every reference is kept (there is no "the one before the cursor"), and a reference keeps its end, which the peek highlights. A reference in another file of the joined files' folder is dropped: Pylance searches the documents open in the window, and older joined texts of this or another canvas stay open for a while after `openTextDocument` (there is no API to close one), so a name imported from the workspace (`sharpe`) would otherwise come back once per older joined file.

What the peek is given (`peekPlan`). Monaco's peek groups references by model URI and sorts the groups by the URI string (`referencesModel.js:120`, `:237`); a group shows the last part of the URI's path and the rest of the path as its description (`referencesTree.js:113`); the peek starts on the reference whose URI shares the longest prefix with the editor's model URI, then the nearest by line and column (`referencesModel.js:189-216`). So:
- the asking cell's references stay on its editor's own model, whose URI is `canvas-cell://0/<label>` (Task 14 gives the editor that URI): its group comes first and the peek starts on the reference under the cursor;
- every other cell gets a copy model at `canvas-cell://1<run order, 5 digits>/<label>`: after the asking cell, in run order;
- a file keeps its `file://` URI: `canvas-cell` sorts before `file`, so files come last, by path.

Each group then reads `E12  /` for a cell (the description is the path's directory, `/`) and `metrics.py  /home/…/backtest` for a file (the standalone label service shows a `file` URI's full path, `standaloneServices.js:584-594`).

`openedTarget` turns a reference Monaco opens (its model URI and position) back into a cell or file target, which Task 14 hands to the same code as a definition.

`peekBoxHeight`: Monaco draws the peek inside the editor, after the cursor's line, clipped by the editor's own box (an overlay widget without `allowEditorOverflow`, `overlayWidgets.js:57`, `:73`; `view.js:177`). It asks for 18 lines (`referencesWidget.js:147`, `:259`) and gets `min(18, max(12, 0.8 × the editor's height in lines))` (`zoneWidget.js:248-249`, `:264`). So the editor needs `ceil(18 / 0.8) = 23` lines for the whole peek, and at least the peek, the cursor's line and the next (20). A cell whose editor is shorter is drawn taller by the difference; a taller one keeps its size.

The grouping test runs Monaco's own `ReferencesModel`, bundled for node from `node_modules/monaco-editor` (FACT: it bundles to 192 KB and runs in node 20 without a DOM; with a copy URI that leaves out the run order, test 2 fails).

- [ ] **Step 1: Write the failing tests**

Create `tests/fixtures/monaco-references-model.js`:

```js
// - Monaco's own grouping of references, for tests/find-references.mjs: the peek lists them as this model groups and sorts them
export { ReferencesModel } from 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/referencesModel.js';
export { URI } from 'monaco-editor/esm/vs/base/common/uri.js';
```

Create `tests/find-references.mjs`:

```js
// - run: npx esbuild src/shared/findReferences.ts --bundle --format=esm --outfile=tests/.build/findReferences.mjs && npx esbuild tests/fixtures/monaco-references-model.js --bundle --format=esm --platform=node --outfile=tests/.build/monacoReferencesModel.mjs && node --test tests/find-references.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openedTarget, peekBoxHeight, peekCellUri, peekPlan, referencesFromLocations } from './.build/findReferences.mjs';
import { ReferencesModel, URI } from './.build/monacoReferencesModel.mjs';

// - the joined text of three cells (header line 0): A on lines 1-2, B on 4-5, C on 7
const J = { text: '', spans: [{ id: 'A', first: 1, lines: 2 }, { id: 'B', first: 4, lines: 2 }, { id: 'C', first: 7, lines: 1 }] };
const DOC = 'file:///run/user/1000/skena/definition/def-abc-111111111111.py';
const DIR = 'file:///run/user/1000/skena/definition/';
const ref = (line, character, length = 4, uri = DOC) => ({ uri, line, character, endLine: line, endCharacter: character + length });

test('1. references: in the joined document to their cell with the range; between cells, another joined file and repeats dropped; files kept', () => {
  const lib = 'file:///home/u/proj/src/m.py';
  const old = 'file:///run/user/1000/skena/definition/def-abc-222222222222.py';
  assert.deepEqual(referencesFromLocations([ref(2, 4), ref(5, 0), ref(3, 0), ref(0, 2), ref(9, 4, 4, old), ref(11, 4, 6, lib), ref(5, 0)], DOC, DIR, J), [
    { kind: 'cell', cellId: 'A', line: 2, col: 5, endLine: 2, endCol: 9 },
    { kind: 'cell', cellId: 'B', line: 2, col: 1, endLine: 2, endCol: 5 },
    { kind: 'file', uri: lib, line: 12, col: 5, endLine: 12, endCol: 11 },
  ]);
});

// - E7 asks (its editor's model is EDITOR); E9 runs 3rd and E10 12th, the other way round from their labels' order; two files
const EDITOR = 'canvas-cell://0/E7';
const ANSWER = {
  targets: [
    { kind: 'file', uri: 'file:///home/u/proj/src/b.py', line: 3, col: 1, endLine: 3, endCol: 4 },
    { kind: 'cell', cellId: 'c9', line: 1, col: 1, endLine: 1, endCol: 4 },
    { kind: 'cell', cellId: 'c7', line: 2, col: 5, endLine: 2, endCol: 8 },
    { kind: 'cell', cellId: 'c10', line: 5, col: 1, endLine: 5, endCol: 4 },
    { kind: 'file', uri: 'file:///home/u/proj/src/a.py', line: 9, col: 1, endLine: 9, endCol: 4 },
    { kind: 'cell', cellId: 'c7', line: 1, col: 1, endLine: 1, endCol: 4 },
  ],
  cells: [
    { id: 'c7', label: 'E7', order: 7, code: 'abc = 1\nx = abc' },
    { id: 'c9', label: 'E9', order: 3, code: 'abc' },
    { id: 'c10', label: 'E10', order: 12, code: '\n\n\n\nabc' },
  ],
  files: [{ uri: 'file:///home/u/proj/src/a.py', text: 'a' }, { uri: 'file:///home/u/proj/src/b.py', text: 'b' }],
};

test('2. the peek lists the asking cell first, the other cells in run order, then the files, and starts on the reference under the cursor', () => {
  const plan = peekPlan(ANSWER, 'c7', EDITOR);
  assert.deepEqual(plan.models.map(m => m.uri), [peekCellUri(3, 'E9'), peekCellUri(12, 'E10'), 'file:///home/u/proj/src/a.py', 'file:///home/u/proj/src/b.py']);
  assert.deepEqual(plan.models.map(m => m.language), ['python', 'python', undefined, undefined]);
  const model = new ReferencesModel(plan.locations.map(l => ({ uri: URI.parse(l.uri), range: l.range })), 'References');
  assert.deepEqual(model.groups.map(g => [URI.parse(g.uri.toString()).path.split('/').pop(), g.children.length]), [['E7', 2], ['E9', 1], ['E10', 1], ['a.py', 1], ['b.py', 1]]);
  const start = model.nearestReference(URI.parse(EDITOR), { lineNumber: 2, column: 6 });
  assert.equal(start.uri.toString(), EDITOR);
  assert.equal(start.range.startLineNumber, 2);
});

test('3. a reference opened in the peek goes to its cell (the asking one included) or its file', () => {
  const plan = peekPlan(ANSWER, 'c7', EDITOR);
  assert.deepEqual(openedTarget(plan, EDITOR, 2, 5), { kind: 'cell', cellId: 'c7', line: 2, col: 5 });
  assert.deepEqual(openedTarget(plan, peekCellUri(12, 'E10'), 5, 1), { kind: 'cell', cellId: 'c10', line: 5, col: 1 });
  assert.deepEqual(openedTarget(plan, 'file:///home/u/proj/src/a.py', 9, 1), { kind: 'file', uri: 'file:///home/u/proj/src/a.py', line: 9, col: 1 });
  assert.equal(openedTarget(plan, 'canvas-cell://0/E8', 1, 1), null);
});

test('4. a file whose text did not come is listed and opened, with no model', () => {
  const plan = peekPlan({ ...ANSWER, files: [] }, 'c7', EDITOR);
  assert.equal(plan.models.length, 2);
  assert.equal(plan.locations.filter(l => l.uri.startsWith('file:')).length, 2);
  assert.deepEqual(openedTarget(plan, 'file:///home/u/proj/src/b.py', 3, 1), { kind: 'file', uri: 'file:///home/u/proj/src/b.py', line: 3, col: 1 });
});

test('5. a cell shorter than the peek needs is drawn taller by the difference; a tall one keeps its size', () => {
  // - 18 lines: the editor needs 23 lines of 19 px = 437 px
  assert.equal(peekBoxHeight(160, 114, 19), 160 + 437 - 114);
  assert.equal(peekBoxHeight(600, 437, 19), null);
  assert.equal(peekBoxHeight(600, 500, 19), null);
  // - a peek of 10 lines: 13 lines (ceil(10 / 0.8)) beat 12 (the peek, the cursor's line and the next)
  assert.equal(peekBoxHeight(100, 60, 20, 10), 100 + 260 - 60);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx esbuild src/shared/findReferences.ts --bundle --format=esm --outfile=tests/.build/findReferences.mjs && npx esbuild tests/fixtures/monaco-references-model.js --bundle --format=esm --platform=node --outfile=tests/.build/monacoReferencesModel.mjs && node --test tests/find-references.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/shared/findReferences.ts"`.

- [ ] **Step 3: Write the module**

Create `src/shared/findReferences.ts`:

```ts
/**
 * Find references from a code cell (leader z), the pure part: Pylance's references on the joined cells
 * as places in cells and files, what Monaco's reference peek is given for them (a model per cell and
 * file, a location per reference, whose URIs put the asking cell first, the other cells in run order,
 * then the files), the place a reference opened in the peek goes to, and how tall the cell is drawn
 * while the peek is open. Bundled into the host and the webview; no vscode or monaco import.
 */
import { fromJoined, type DefinitionTarget, type JoinedCells } from './goToDefinition';

/** - one reference from vscode.executeReferenceProvider: its document's URI string, 0-based start and end */
export interface RefLocation { uri: string; line: number; character: number; endLine: number; endCharacter: number }

/** - a reference: a cell's or a file's 1-based range, the end column exclusive (as Monaco's ranges) */
export type ReferenceTarget =
  | { kind: 'cell'; cellId: string; line: number; col: number; endLine: number; endCol: number }
  | { kind: 'file'; uri: string; line: number; col: number; endLine: number; endCol: number };

/**
 * Pylance's references as places. One in the joined document (`joinedUri`) goes to its cell; it is
 * dropped on a line between cells and when it ends outside the cell it starts in. One in another file
 * of the joined files' folder (`joinedDir`, a URI string ending in /: an older text of some canvas,
 * still open in the window) is dropped. Any other goes to its file. Repeats are dropped.
 */
export function referencesFromLocations(locs: readonly RefLocation[], joinedUri: string, joinedDir: string, j: JoinedCells): ReferenceTarget[] {
  const out: ReferenceTarget[] = [];
  const seen = new Set<string>();
  const add = (t: ReferenceTarget, key: string) => {
    if (!seen.has(key)) { seen.add(key); out.push(t); }
  };
  for (const l of locs) {
    if (l.uri === joinedUri) {
      const a = fromJoined(j, { line: l.line, character: l.character });
      const b = fromJoined(j, { line: l.endLine, character: l.endCharacter });
      if (!a || !b || a.cellId !== b.cellId) continue;
      add({ kind: 'cell', cellId: a.cellId, line: a.line, col: a.col, endLine: b.line, endCol: b.col }, `c ${a.cellId} ${a.line} ${a.col}`);
      continue;
    }
    if (l.uri.startsWith(joinedDir)) continue;
    add({ kind: 'file', uri: l.uri, line: l.line + 1, col: l.character + 1, endLine: l.endLine + 1, endCol: l.endCharacter + 1 }, `f ${l.uri} ${l.line} ${l.character}`);
  }
  return out;
}

/** - a cell that holds references: its label, its place in run order (0-based), its code as Pylance read it */
export interface PeekCell { id: string; label: string; order: number; code: string }
/** - a file that holds references, with its text */
export interface PeekFile { uri: string; text: string }
/** - the host's answer to a find references request */
export interface ReferencesAnswer { targets: ReferenceTarget[]; cells: PeekCell[]; files: PeekFile[] }

/** - the scheme of the code cells' model URIs */
export const CELL_SCHEME = 'canvas-cell';

/**
 * - the model URI of the open code cell's editor (CodeNode). Monaco's peek groups references by URI
 *   and sorts the groups by it (referencesModel.js), so authority 0 puts the cell's own group first;
 *   the scheme sorts before file:, so cells come before files. The group shows the path's last part.
 */
export function openCellUri(label: string): string {
  return `${CELL_SCHEME}://0/${encodeURIComponent(label)}`;
}

/** - the model URI of a copy of another cell for the peek: authority 1 and the run order, so after the open cell and in run order */
export function peekCellUri(order: number, label: string): string {
  return `${CELL_SCHEME}://1${String(order).padStart(5, '0')}/${encodeURIComponent(label)}`;
}

/** - a 1-based range, end column exclusive (Monaco's IRange) */
export interface PeekRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** - what Monaco's peek is given, and what each of its model URIs stands for */
export interface PeekPlan {
  /** - the models to create before the peek opens: a copy of each other cell, and each file */
  models:    { uri: string; text: string; language?: string }[];
  /** - every reference as Monaco takes it: a model URI and a range */
  locations: { uri: string; range: PeekRange }[];
  /** - model URI -> the cell or file it stands for */
  owners:    Record<string, { kind: 'cell'; cellId: string } | { kind: 'file'; uri: string }>;
}

/**
 * The peek for `answer`, asked in `cellId`, whose editor's model is `editorUri`: its references stay
 * on that model (the peek then starts on the reference under the cursor, referencesModel.js
 * nearestReference); every other cell gets a copy at peekCellUri; a file keeps its own URI, and its
 * text is its model (a file whose text did not come gets none: the peek shows no preview for it).
 */
export function peekPlan(answer: ReferencesAnswer, cellId: string, editorUri: string): PeekPlan {
  const plan: PeekPlan = { models: [], locations: [], owners: { [editorUri]: { kind: 'cell', cellId } } };
  const cellUri = new Map<string, string>([[cellId, editorUri]]);
  for (const c of answer.cells) {
    if (c.id === cellId) continue;
    const uri = peekCellUri(c.order, c.label);
    cellUri.set(c.id, uri);
    plan.models.push({ uri, text: c.code, language: 'python' });
    plan.owners[uri] = { kind: 'cell', cellId: c.id };
  }
  for (const f of answer.files) plan.models.push({ uri: f.uri, text: f.text });
  for (const t of answer.targets) {
    const uri = t.kind === 'file' ? t.uri : cellUri.get(t.cellId);
    if (uri === undefined) continue;
    if (t.kind === 'file') plan.owners[uri] = { kind: 'file', uri };
    plan.locations.push({ uri, range: { startLineNumber: t.line, startColumn: t.col, endLineNumber: t.endLine, endColumn: t.endCol } });
  }
  return plan;
}

/** - where a reference opened in the peek (a model URI and a 1-based position) goes; null for a URI the peek did not get from here */
export function openedTarget(plan: PeekPlan, uri: string, line: number, col: number): DefinitionTarget | null {
  const owner = plan.owners[uri];
  if (!owner) return null;
  return owner.kind === 'cell' ? { kind: 'cell', cellId: owner.cellId, line, col } : { kind: 'file', uri: owner.uri, line, col };
}

/** - the lines Monaco's reference peek asks for (referencesWidget.js LayoutData) */
export const PEEK_LINES = 18;

/**
 * How tall to draw a code cell while its reference peek is open, in canvas px; null when it is tall
 * enough. Monaco draws the peek inside the editor, after the cursor's line, and gives it
 * min(lines, max(12, 0.8 x the editor's height in lines)) (zoneWidget.js _getMaximumHeightInLines).
 * So the editor needs ceil(lines / 0.8) lines for the whole peek, and at least the peek, the cursor's
 * line and the next. `box` is the cell's height, `editor` the editor's.
 */
export function peekBoxHeight(box: number, editor: number, lineHeight: number, lines = PEEK_LINES): number | null {
  const need = lineHeight * Math.max(lines + 2, Math.ceil(lines / 0.8));
  return editor >= need ? null : box + need - editor;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/shared/findReferences.ts --bundle --format=esm --outfile=tests/.build/findReferences.mjs && npx esbuild tests/fixtures/monaco-references-model.js --bundle --format=esm --platform=node --outfile=tests/.build/monacoReferencesModel.mjs && node --test tests/find-references.mjs`
Expected: `# tests 5`, `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/findReferences.ts tests/fixtures/monaco-references-model.js tests/find-references.mjs
git commit -m "feat(references): references as places, the peek's models and order, the taller cell"
```

---

### Task 13: Find references, the host: Pylance's references with the text of each cell and file

**Files:**
- Modify: `src/shared/types.ts` (after Task 10's lines)
- Create: `src/extension/definition/findReferences.ts`
- Modify: `src/extension/editor-provider.ts` (after Task 10's cases)

Messages:
- `findReferences` (webview → host): `reqId`, the cell, its live code, the cursor's 1-based line and column.
- `referencesResult` (host → webview): the references, and for the peek's preview the code of each cell they are in (with its label and place in run order) and the text of each file. A file's text is the open document's when it is open (it may be unsaved), else read from disk; `openTextDocument` is not used for the others, because a document opened that way is open for Pylance, which then lists its problems.

`findReferences` uses the same joined file as go to definition (`writeJoinedFile`, same text, same file) and `pylanceLocations` with `vscode.executeReferenceProvider`. Pylance only: the kernel is not asked (spec). VS Code asks providers with `includeDeclaration: true` (FACT for Monaco's copy of the same command, `goToSymbol.js:58`, `:107`; INFERENCE that VS Code 1.141 does the same), so the definitions are in the list.

- [ ] **Step 1: The messages**

In `src/shared/types.ts`, find:

```ts
import type { DefinitionTarget } from './goToDefinition';
```

replace with:

```ts
import type { DefinitionTarget } from './goToDefinition';
import type { ReferencesAnswer } from './findReferences';
```

In `src/shared/types.ts`, find:

```ts
export interface MsgShowDefinitions { type: 'showDefinitions'; targets: DefinitionTarget[]; }
```

replace with:

```ts
export interface MsgShowDefinitions { type: 'showDefinitions'; targets: DefinitionTarget[]; }
// - leader z in a code cell: every reference of the name at line/col (1-based) of the live `code`
export interface MsgFindReferences { type: 'findReferences'; reqId: string; cellNodeId: string; code: string; line: number; col: number; }
```

In `src/shared/types.ts`, find:

```ts
  | MsgDefinitionResult
  | MsgDefinitionGoto
```

replace with:

```ts
  | MsgDefinitionResult
  | MsgDefinitionGoto
  | MsgReferencesResult
```

In `src/shared/types.ts`, find:

```ts
export interface MsgDefinitionGoto { type: 'definitionGoto'; cellNodeId: string; line: number; col: number; }
```

replace with:

```ts
export interface MsgDefinitionGoto { type: 'definitionGoto'; cellNodeId: string; line: number; col: number; }
// - host → webview: the references of a findReferences request, with the text of each cell and file they are in; no targets when none
export interface MsgReferencesResult extends ReferencesAnswer { type: 'referencesResult'; reqId: string; cellNodeId: string; }
```

In `src/shared/types.ts`, find:

```ts
  | MsgGoToDefinition
  | MsgShowDefinitions
```

replace with:

```ts
  | MsgGoToDefinition
  | MsgShowDefinitions
  | MsgFindReferences
```

- [ ] **Step 2: The host's half**

Create `src/extension/definition/findReferences.ts`:

```ts
/**
 * Find references from a code cell, the host's half: Pylance's references at the cursor's place in the
 * canvas's code cells joined in run order (the same joined file as go to definition), as places in
 * cells and files, with the text of each cell and file they are in for the webview's peek. Pylance
 * only; the kernel is not asked.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { CanvasData, MsgFindReferences } from '../../shared/types';
import { joinCells, toJoined } from '../../shared/goToDefinition';
import { referencesFromLocations, type PeekFile, type ReferencesAnswer } from '../../shared/findReferences';
import { JOINED_HEADER, canvasCells } from './goToDefinition';
import { writeJoinedFile } from './joinedFile';
import { pylanceLocations } from './pylanceLocations';

// - the text Pylance read: an open document's (it may be edited and unsaved), else the file's on disk.
//   openTextDocument is not used for the others: it would open them for Pylance, which then lists their
//   problems
async function documentText(uri: string): Promise<string | null> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
  } catch {
    return null;
  }
}

/** - every reference of the name at the request's cursor; none when Pylance has none */
export async function findReferences(msg: MsgFindReferences, canvas: CanvasData, canvasPath: string): Promise<ReferencesAnswer> {
  const cells = canvasCells(canvas, msg.cellNodeId, msg.code);
  const joined = joinCells(cells, JOINED_HEADER);
  const cursor = toJoined(joined, msg.cellNodeId, msg.line, msg.col);
  if (!cursor) return { targets: [], cells: [], files: [] };
  const file = writeJoinedFile(canvasPath, joined.text);
  const { uri, locs } = await pylanceLocations('vscode.executeReferenceProvider', file, cursor);
  const targets = referencesFromLocations(locs, uri, `${vscode.Uri.file(path.dirname(file)).toString()}/`, joined);
  const order = new Map(cells.map((c, i) => [c.id, i]));
  const labelOf = (id: string) => canvas.nodes.find(n => n.id === id)?.nodeLabel ?? id;
  const cellIds = [...new Set(targets.flatMap(t => (t.kind === 'cell' ? [t.cellId] : [])))];
  const fileUris = [...new Set(targets.flatMap(t => (t.kind === 'file' ? [t.uri] : [])))];
  const files = await Promise.all(fileUris.map(async u => ({ uri: u, text: await documentText(u) })));
  return {
    targets,
    cells: cellIds.flatMap(id => {
      const i = order.get(id);
      return i === undefined ? [] : [{ id, label: labelOf(id), order: i, code: cells[i].code }];
    }),
    files: files.filter((f): f is PeekFile => f.text !== null),
  };
}
```

- [ ] **Step 3: The message case**

In `src/extension/editor-provider.ts`, find:

```ts
import { findDefinitions, showDefinitions } from './definition/goToDefinition';
```

replace with:

```ts
import { findDefinitions, showDefinitions } from './definition/goToDefinition';
import { findReferences } from './definition/findReferences';
```

In `src/extension/editor-provider.ts`, find:

```ts
        case 'showDefinitions': await showDefinitions(msg.targets, document.canvas, send); break;
      }
```

replace with:

```ts
        case 'showDefinitions': await showDefinitions(msg.targets, document.canvas, send); break;
        case 'findReferences': {
          // - the answer always goes back, empty on a failure, so the cell can show its note
          const answer = await findReferences(msg, document.canvas, document.uri.fsPath)
            .catch(err => { console.warn('[skena] find references', err); return { targets: [], cells: [], files: [] }; });
          send({ type: 'referencesResult', reqId: msg.reqId, cellNodeId: msg.cellNodeId, ...answer });
          break;
        }
      }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/extension/definition/findReferences.ts src/extension/editor-provider.ts
git commit -m "feat(references): host asks Pylance for references, with the text of each cell and file"
```

---

### Task 14: Find references, the webview: Monaco's reference peek in the cell

**Files:**
- Modify: `src/webview/canvas/nodes/cellDefinition.ts`
- Create: `src/webview/canvas/nodes/referencePeek.ts`
- Modify: `src/webview/canvas/nodes/NodeBorder.tsx:1-31`
- Modify: `src/webview/canvas/nodes/CodeNode.tsx` (after Task 11's changes)
- Modify: `src/webview/App.tsx` (after Task 11's case)
- Modify: `src/webview/styles/canvas.css` (append after the last line)

The peek is Monaco's own, already in the bundle: `index.tsx:20` imports `python.contribution.js`, which imports `basic-languages/_.contribution.js`, which imports `goToCommands.js` (`:25`, the Peek References action) and `standaloneReferenceSearch.js` (`:71`, the references controller with the list's own keys on) (FACT: the built `dist/webview.js` at `b5d38ab` holds `editor.action.referenceSearch.trigger` and `editor.contrib.referencesController`). The Monaco facts each step relies on are listed with file and line under "Monaco API the peek relies on".

How the webview drives it (`referencePeek.ts`):
- **Its data.** For the time the peek is open: a model per other cell and per file (`monaco.editor.createModel`; the peek reads them through the standalone text model service, which only finds existing models, `standaloneServices.js:125-129`), and a reference provider for the python models of the `canvas-cell` scheme that returns the answer for this editor's model (`monaco.languages.registerReferenceProvider`). The provider exists only while the peek is open: whenever one exists, Monaco offers Go to References and Peek in the editor's context menu (the actions' precondition `hasReferenceProvider`, `goToCommands.js:577`), and the context key follows the registration at once (`codeEditorWidget.js:1676`, `:1726`). Then `editor.trigger('skena', 'editor.action.referenceSearch.trigger', null)`: `trigger` hands a command that is not an editor action to the command service (`codeEditorWidget.js:763-818`), and the action runs on the focused editor (`editorExtensions.js:274-293`), the cell's, which has the focus since leader `z`. With `openInPeek` it always opens the peek (`goToCommands.js:139`; `alternativeReferenceCommand` defaults to `''`, `editorOptions.js:796`, so a single reference under the cursor still shows the peek).
- **The taller cell.** Before the trigger CodeNode draws the cell at `peekBoxHeight` (Task 12) with `flushSync` and calls `editor.layout()`: Monaco sizes the peek from the editor's height when it opens (`zoneWidget.js:248-264`). Only the inner `.skena-node` box and `NodeBorder` grow; React Flow's node wrapper keeps the canvas's size (it has a fixed `style.height`, `CanvasView.tsx:153-163`), so nothing is measured, saved or laid out again, and the edges keep their ends. `reportHeight` (the layout engine's code height) is skipped while the peek is open. The wrapper is raised over every other node by a CSS rule on `:has(> .skena-code-peek)` with `!important`, which beats React Flow's inline `z-index` (a selected node is at 1000, `@xyflow/system` `SELECTED_NODE_Z`; skena's edge labels at 1000, `canvas.css:33`); the cell's handles are hidden meanwhile. On close the cell goes back to `height: 100%`.
- **Keys in the list.** monaco-vim reads keys through `editor.onKeyDown` (`monaco-vim/src/cm_adapter.ts:372`), which only the editor's own text input fires (`nativeEditContext.js:96-98`, `textAreaEditContext.js:211-212`); the jump labels and CodeNode's Esc read nothing either while the text has no focus (`editorJumpLabels.ts:248`). The list handles its own keys: arrows move the focus only, Enter selects (`listWidget.js:241-335`); a selection from the keyboard opens the reference in the preview only (`listService.js:465-474`, `referencesWidget.js:368-378`); Monaco has no `list.focusDown` command in 0.55.1 (grep finds none), so unlike VS Code the preview does not follow the arrows. A listener at capture on the editor's container, while the peek is open, maps `j`/`k` to an arrow then an Enter sent to the list (`KeyboardEvent` with `keyCode` set, which the list reads, `keyboardEvent.js:16`), so the preview follows, and a real Enter to Monaco's `openReference` command (`referencesController.js:374-380`: closes the peek, then opens the focused reference). Esc goes on to the peek, which closes on it (`referencesWidget.js:320-327` sends it to `closeReferenceSearch`, `referencesController.js:326-340`), and the editor gets the focus back (`closeWidget`, `:211-221`) in normal mode.
- **Going to a reference.** Enter, a double-click in the list (`listService.js:489-503` → `goto` → `_gotoReference`, `referencesController.js:223-254`) and a double-click in the preview (`open`) all open the reference through the code editor service with the cell's editor as source. `monaco.editor.registerEditorOpener` (`standaloneEditor.js:382-401`; openers registered later are asked first, `abstractCodeEditorService.js:111-123`) takes the ones this peek gave: it closes the peek (also when Monaco has only hidden it, as a double-click does before it opens), puts the cell back to its size, and goes there as a definition does: a cell through `skena:goToCell` (Task 11: selected as `h/j/k/l` do, its editor opened at the line in normal mode, the `` ` `` register), a file through `showDefinitions` (Task 10: beside the canvas).
- **The preview** is read-only: a copy of another cell or a file is saved nowhere.
- **However it closes** (Esc, a reference opened, the cell leaving edit mode), a `MutationObserver` on the editor's `.overlayWidgets` (the peek is one of its children while open, `zoneWidget.js:291`, `overlayWidgets.js:73`) or the editor's disposal ends it: the models and the provider are disposed and the cell gets its size back.
- **Focus.** The peek's list and preview are inside the editor's DOM, so focus going there is a text blur (`onDidBlurEditorText`) that must not leave edit mode, and focus leaving them later is a widget blur only (`onDidBlurEditorWidget`; widget focus is focus anywhere in the editor's DOM, `view.js:72`, `:686`). CodeNode leaves edit mode on either, when the focus is outside the editor's DOM. With the cursor back in the text and the peek still open, the first Esc closes the peek and the next one leaves the editor.

- [ ] **Step 1: The request**

In `src/webview/canvas/nodes/cellDefinition.ts`, find:

```ts
/**
 * Go to definition in a code cell (leader g), the webview's half. The dotted name under the cursor goes
 * to the host (goToDefinition); its answer (definitionResult) selects a cell here (skena:goToCell,
 * CanvasView), or goes back to the host to open a file or show a quick pick (showDefinitions). With no
 * name under the cursor nothing is asked and nothing shown (user). An answer that arrives after
 * another key in the cell or after the cell lost focus is dropped: the user has moved on, and keys
 * typed meanwhile must not land in another cell.
 */
import type { editor as MonacoEditor } from 'monaco-editor';
import { dottedNameAt } from '../../../shared/goToDefinition';
import type { MsgDefinitionResult } from '../../../shared/types';
```

replace with:

```ts
/**
 * Go to definition (leader g) and find references (leader z) in a code cell, the webview's half. The
 * name under the cursor goes to the host (goToDefinition, findReferences). A definition answer
 * (definitionResult) selects a cell here (skena:goToCell, CanvasView), or goes back to the host to
 * open a file or show a quick pick (showDefinitions); a references answer (referencesResult) opens
 * the cell's reference peek (referencePeek.ts). No answer: a note in the cell. With no name under the
 * cursor nothing is asked and nothing shown (user). An answer that arrives after another key in the
 * cell or after the cell lost focus is dropped: the user has moved on, and keys typed meanwhile must
 * not land in another cell.
 */
import type { editor as MonacoEditor } from 'monaco-editor';
import { dottedNameAt } from '../../../shared/goToDefinition';
import type { ReferencesAnswer } from '../../../shared/findReferences';
import type { MsgDefinitionResult, MsgReferencesResult } from '../../../shared/types';
```

In `src/webview/canvas/nodes/cellDefinition.ts`, find:

```ts
// - one lookup per cell at a time; `since` is performance.now() when it was asked
interface Pending { reqId: string; name: string; since: number; stale: boolean; note: (text: string) => void }
```

replace with:

```ts
// - one lookup per cell at a time; `since` is performance.now() when it was asked; `open` for references
interface Pending { reqId: string; name: string; since: number; stale: boolean; note: (text: string) => void; open?: (answer: ReferencesAnswer) => void }
```

In `src/webview/canvas/nodes/cellDefinition.ts`, find:

```ts
    vscodePostMessage({ type: 'showDefinitions', targets: r.targets });
  });
}
```

replace with:

```ts
    vscodePostMessage({ type: 'showDefinitions', targets: r.targets });
  });
  window.addEventListener('skena:referencesResult', (e: Event) => {
    const r = (e as CustomEvent<MsgReferencesResult>).detail;
    const p = pending.get(r.cellNodeId);
    if (!p || p.reqId !== r.reqId) return;
    pending.delete(r.cellNodeId);
    if (p.stale) return;
    if (r.targets.length === 0) { p.note(`no references found for ${p.name}`); return; }
    p.open?.(r);
  });
}
```

In `src/webview/canvas/nodes/cellDefinition.ts`, find:

```ts
/** - a key in the cell, or the cell losing focus, at `when` (an event's timeStamp): a lookup asked before it is dropped */
```

replace with:

```ts
/** - leader z in `cellId`'s editor: ask the host for every reference of the name under the cursor; `open` shows them */
export function requestReferences(editor: MonacoEditor.IStandaloneCodeEditor, cellId: string, note: (text: string) => void, open: (answer: ReferencesAnswer) => void): void {
  listen();
  const pos = editor.getPosition();
  const model = editor.getModel();
  if (!pos || !model) return;
  const at = dottedNameAt(model.getLineContent(pos.lineNumber), pos.column);
  if (!at) return;
  const reqId = `ref-${++counter}`;
  pending.set(cellId, { reqId, name: at.dotted ?? at.word, since: performance.now(), stale: false, note, open });
  vscodePostMessage({ type: 'findReferences', reqId, cellNodeId: cellId, code: model.getValue(), line: pos.lineNumber, col: pos.column });
}

/** - a key in the cell, or the cell losing focus, at `when` (an event's timeStamp): a lookup asked before it is dropped */
```

- [ ] **Step 2: The peek**

Create `src/webview/canvas/nodes/referencePeek.ts`:

```ts
/**
 * Find references in a code cell (leader z), shown as Monaco's own reference peek inside the cell's
 * editor. The bundle already holds the peek: basic-languages/_.contribution.js (imported through
 * python.contribution.js in index.tsx) imports goToCommands.js and standaloneReferenceSearch.js.
 *
 * The host's answer becomes, for the time the peek is open: a model per other cell and per file (the
 * peek previews and lists them through the text model service, which only finds existing models), a
 * reference provider for this editor's model that returns the answer, and the cell drawn taller
 * (setHeight). Then editor.action.referenceSearch.trigger opens the peek. In its list j/k move and
 * preview, Enter goes to the place, Esc closes it (Monaco's closeReferenceSearch). Going to a place
 * passes through the editor opener below, which goes there as go to definition does. However the peek
 * closes, finish() undoes the rest.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { editor as MonacoEditor } from 'monaco-editor';
import { openedTarget, peekPlan, type PeekPlan, type ReferencesAnswer } from '../../../shared/findReferences';
import type { DefinitionTarget } from '../../../shared/goToDefinition';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - ReferencesController (referencesController.js): its id, and closeWidget, a public method of the class
const CONTROLLER = 'editor.contrib.referencesController';
type ReferencesController = MonacoEditor.IEditorContribution & { closeWidget(focusEditor?: boolean): void };
// - the class of the peek's container (referencesWidget.js _fillBody) and of its list (div.ref-tree)
const PEEK = '.reference-zone-widget';
const LIST = `${PEEK} .ref-tree`;

interface Peek {
  plan:   PeekPlan;
  finish: (restore: boolean) => void;
}
const peeks = new Map<MonacoEditor.ICodeEditor, Peek>();

// - keys this module sends to the peek's list; its own key listener lets them through
const sent = new WeakSet<Event>();

// - a key as the list reads it: Monaco takes the key code from keyCode (keyboardEvent.js
//   extractKeyCode), which a KeyboardEvent cannot be constructed with
function press(target: EventTarget, key: 'ArrowDown' | 'ArrowUp' | 'Enter', keyCode: number): void {
  const e = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { get: () => keyCode });
  sent.add(e);
  target.dispatchEvent(e);
}

function goTo(t: DefinitionTarget): void {
  if (t.kind === 'cell') window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: t.cellId, line: t.line, col: t.col } }));
  else vscodePostMessage({ type: 'showDefinitions', targets: [t] });
}

let openerInstalled = false;

// - Monaco opens a reference (Enter, a double-click) through the code editor service, with the editor
//   the peek is in as source; openers registered later are asked first (abstractCodeEditorService.js)
function installOpener(): void {
  if (openerInstalled) return;
  openerInstalled = true;
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, at) {
      const peek = peeks.get(source);
      if (!peek) return false;
      const pos = at === undefined ? { lineNumber: 1, column: 1 } : 'startLineNumber' in at ? { lineNumber: at.startLineNumber, column: at.startColumn } : at;
      const target = openedTarget(peek.plan, resource.toString(), pos.lineNumber, pos.column);
      if (!target) return false;
      peek.finish(true);
      goTo(target);
      return true;
    },
  });
}

/** - this editor's peek is open */
export function referencePeekOpen(editor: MonacoEditor.ICodeEditor): boolean {
  return peeks.has(editor);
}

/** - closes this editor's peek; false when none is open */
export function closeReferencePeek(editor: MonacoEditor.ICodeEditor): boolean {
  const peek = peeks.get(editor);
  peek?.finish(true);
  return peek !== undefined;
}

/**
 * Opens Monaco's reference peek in `editor` (cell `cellId`) on the host's answer. `height` is the cell's
 * height while it is open (null: its own), and `setHeight` draws the cell at a height and returns once
 * the editor has the new size: Monaco sizes the peek from the editor's height when it opens.
 */
export function openReferencePeek(
  editor: MonacoEditor.IStandaloneCodeEditor,
  cellId: string,
  answer: ReferencesAnswer,
  height: number | null,
  setHeight: (px: number | null) => void,
): void {
  installOpener();
  closeReferencePeek(editor);
  const model = editor.getModel();
  const dom = editor.getDomNode();
  if (!model || !dom) return;
  const raw = peekPlan(answer, cellId, model.uri.toString());
  // - the URIs as Monaco writes them, so the opener finds the ones it is handed
  const norm = (u: string) => monaco.Uri.parse(u).toString();
  const plan: PeekPlan = {
    ...raw,
    owners: Object.fromEntries(Object.entries(raw.owners).map(([u, o]) => [norm(u), o])),
  };
  const models = plan.models.map(m => {
    const uri = monaco.Uri.parse(m.uri);
    monaco.editor.getModel(uri)?.dispose();
    return monaco.editor.createModel(m.text, m.language, uri);
  });
  const locations = plan.locations.map(l => ({ uri: monaco.Uri.parse(l.uri), range: l.range }));
  const own = model.uri.toString();
  // - only while the peek is open: whenever a provider exists Monaco offers Go to References and Peek in
  //   the editor's context menu (goToCommands.js)
  const provider = monaco.languages.registerReferenceProvider({ language: 'python', scheme: model.uri.scheme }, {
    provideReferences: m => (m.uri.toString() === own ? locations : []),
  });

  const container = editor.getContainerDomNode();
  // - in the peek's list: j/k move (an arrow, then Enter, which selects and so previews, as VS Code's
  //   list keys do with selectionNavigation) and Enter goes to the place. Esc goes on to the peek, which
  //   closes on it (referencesWidget.js, closeReferenceSearch). At capture on the editor's container, so
  //   the list never sees j, k or Enter.
  const onKey = (e: KeyboardEvent) => {
    if (sent.has(e) || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof Element) || !e.target.closest(LIST)) return;
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      e.stopPropagation();
      press(e.target, e.key === 'j' ? 'ArrowDown' : 'ArrowUp', e.key === 'j' ? 40 : 38);
      press(e.target, 'Enter', 13);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      // - referencesController.js openReference: closes the peek, then opens the focused reference
      editor.trigger('skena', 'openReference', null);
    }
  };
  container.addEventListener('keydown', onKey, { capture: true });

  const isOpen = () => dom.querySelector(PEEK) !== null;
  let seen = false;
  let done = false;
  const finish = (restore: boolean) => {
    if (done) return;
    done = true;
    peeks.delete(editor);
    observer.disconnect();
    disposed.dispose();
    container.removeEventListener('keydown', onKey, { capture: true });
    if (restore) {
      // - also when the peek is only hidden: a double-click hides it before it opens the reference, and
      //   shows it again afterwards if it is still there (referencesController.js _gotoReference)
      editor.getContribution<ReferencesController>(CONTROLLER)?.closeWidget(false);
      setHeight(null);
    }
    provider.dispose();
    models.forEach(m => m.dispose());
  };
  // - the peek is an overlay widget of the editor (zoneWidget.js addOverlayWidget): one child of
  //   .overlayWidgets while it is open
  const observer = new MutationObserver(() => {
    if (!isOpen()) { if (seen) finish(true); return; }
    if (seen) return;
    seen = true;
    // - the preview is an editor of its own; a copy of another cell or a file is not saved anywhere,
    //   so it is read-only
    for (const e of monaco.editor.getEditors()) if (e !== editor && dom.contains(e.getContainerDomNode())) e.updateOptions({ readOnly: true });
  });
  const overlays = dom.querySelector('.overlayWidgets');
  if (overlays) observer.observe(overlays, { childList: true });
  // - the editor goes (the cell left edit mode): the peek went with it, the cell keeps its own size
  const disposed = editor.onDidDispose(() => finish(false));
  peeks.set(editor, { plan, finish });

  if (height !== null) setHeight(height);
  editor.trigger('skena', 'editor.action.referenceSearch.trigger', null);
  // - Monaco opens the peek in promise callbacks of the trigger; when there is none by the next task, none is coming
  setTimeout(() => { if (!seen) finish(true); }, 0);
}
```

- [ ] **Step 3: NodeBorder follows the taller cell**

In `src/webview/canvas/nodes/NodeBorder.tsx`, find:

```tsx
 * inside the node is laid out again. pointer-events: none, so the node and its scrollbars take the
 * pointer as before.
 */
```

replace with:

```tsx
 * inside the node is laid out again. pointer-events: none, so the node and its scrollbars take the
 * pointer as before. `height` draws it that tall from the node's top instead of the node's height (a
 * code cell drawn taller while its reference peek is open).
 */
```

In `src/webview/canvas/nodes/NodeBorder.tsx`, find:

```tsx
export function NodeBorder({ base, color, borderStyle = 'solid', radius = 6, running = false }: {
  base: number;
  color: string;
  borderStyle?: 'solid' | 'dashed';
  radius?: number | string;
  running?: boolean;
}): JSX.Element {
```

replace with:

```tsx
export function NodeBorder({ base, color, borderStyle = 'solid', radius = 6, running = false, height }: {
  base: number;
  color: string;
  borderStyle?: 'solid' | 'dashed';
  radius?: number | string;
  running?: boolean;
  height?: number;
}): JSX.Element {
```

In `src/webview/canvas/nodes/NodeBorder.tsx`, find:

```tsx
      style={{ ...zoomVars, border: `${zoomInvariantWidth(base)} ${borderStyle} ${color}`, borderRadius: radius }}
```

replace with:

```tsx
      style={{ ...zoomVars, border: `${zoomInvariantWidth(base)} ${borderStyle} ${color}`, borderRadius: radius, ...(height !== undefined ? { bottom: 'auto', height } : {}) }}
```

- [ ] **Step 4: The code cell**

In `src/webview/canvas/nodes/CodeNode.tsx` (line 8), find:

```tsx
import { createPortal } from 'react-dom';
```

replace with:

```tsx
import { createPortal, flushSync } from 'react-dom';
```

In `src/webview/canvas/nodes/CodeNode.tsx`, find:

```tsx
import { dropLookup, requestDefinition } from './cellDefinition';
```

replace with:

```tsx
import { dropLookup, requestDefinition, requestReferences } from './cellDefinition';
import { closeReferencePeek, openReferencePeek, referencePeekOpen } from './referencePeek';
import { openCellUri, peekBoxHeight, type ReferencesAnswer } from '../../../shared/findReferences';
```

In `src/webview/canvas/nodes/CodeNode.tsx`, find:

```tsx
  // - leader g's note in the cell (no definition found …); gone on the next key
  const [note, setNote] = useState<string | null>(null);
```

replace with:

```tsx
  // - leader g's note in the cell (no definition found …); gone on the next key
  const [note, setNote] = useState<string | null>(null);
  // - the cell's height while its reference peek is open (leader z), drawn over what lies below; null: its own
  const [peekBox, setPeekBox] = useState<number | null>(null);
```

In `src/webview/canvas/nodes/CodeNode.tsx` (lines 289-291), find:

```tsx
  const reportHeight = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
```

replace with:

```tsx
  const reportHeight = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    // - the open peek's lines are the editor's content too, not the cell's text
    if (referencePeekOpen(ed)) return;
```

In `src/webview/canvas/nodes/CodeNode.tsx`, find:

```tsx
    // - leader z (find references) does nothing yet
    installJumpLabels(editorInstance, vimMode, { onLookup: what => { if (what === 'definition') requestDefinition(editorInstance, id, setNote); } });
```

replace with:

```tsx
    // - leader z: the peek opens in the editor, the cell drawn tall enough for it
    const openPeek = (answer: ReferencesAnswer) => {
      const box = nodeElRef.current?.offsetHeight ?? 0;
      const lineHeight = editorInstance.getOption(monacoInstance.editor.EditorOption.lineHeight);
      openReferencePeek(editorInstance, id, answer, peekBoxHeight(box, editorInstance.getLayoutInfo().height, lineHeight), px => {
        flushSync(() => setPeekBox(px));
        if (editorInstance.getModel()) editorInstance.layout();
      });
    };
    installJumpLabels(editorInstance, vimMode, {
      onLookup: what => (what === 'definition' ? requestDefinition(editorInstance, id, setNote) : requestReferences(editorInstance, id, setNote, openPeek)),
    });
```

In `src/webview/canvas/nodes/CodeNode.tsx`, find:

```tsx
      setEditing(false);
      setEditorShown(false);
      setNote(null);
    };
```

replace with:

```tsx
      setEditing(false);
      setEditorShown(false);
      setNote(null);
      setPeekBox(null);
    };
```

In `src/webview/canvas/nodes/CodeNode.tsx`, find:

```tsx
    editorInstance.onDidBlurEditorText(() => {
      dropLookup(id, performance.now());
      setTimeout(() => {
        if (!editorInstance.getModel()) return;
        if (vimStatusRef.current && vimStatusRef.current.contains(document.activeElement)) return;
        leaveEdit();
      }, 0);
    });
```

replace with:

```tsx
    // - The reference peek's list and preview are inside the editor's own DOM: focus going there is a
    //   text blur that stays, and focus leaving them is a widget blur only. Both blurs of one move run once.
    let blurQueued = false;
    const leaveIfFocusLeft = () => {
      if (blurQueued) return;
      blurQueued = true;
      setTimeout(() => {
        blurQueued = false;
        if (!editorInstance.getModel()) return;
        const active = document.activeElement;
        if (vimStatusRef.current && vimStatusRef.current.contains(active)) return;
        if (active && editorInstance.getDomNode()?.contains(active)) return;
        leaveEdit();
      }, 0);
    };
    editorInstance.onDidBlurEditorText(() => {
      dropLookup(id, performance.now());
      leaveIfFocusLeft();
    });
    editorInstance.onDidBlurEditorWidget(leaveIfFocusLeft);
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 466), find:

```tsx
      if (e.browserEvent.key === 'Escape' && !vimIsEditing) leaveEdit();
```

replace with:

```tsx
      // - with the reference peek open the first Esc closes it, the next one leaves the editor
      if (e.browserEvent.key === 'Escape' && !vimIsEditing && !closeReferencePeek(editorInstance)) leaveEdit();
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 556), find:

```tsx
        className={`skena-node ${ZOOM_WIDTH_CLASS} skena-node--code`}
```

replace with:

```tsx
        className={`skena-node ${ZOOM_WIDTH_CLASS} skena-node--code${peekBox !== null ? ' skena-code-peek' : ''}`}
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 562), find:

```tsx
          height:        '100%',
```

replace with:

```tsx
          height:        peekBox ?? '100%',
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 611), find:

```tsx
                defaultLanguage="python"
```

replace with:

```tsx
                defaultLanguage="python"
                // - the model URI the reference peek lists this cell's own references under (findReferences.ts)
                defaultPath={openCellUri(node.nodeLabel ?? id)}
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 702), find:

```tsx
      <NodeBorder base={1.5} color={borderColor} running={node.lastStatus === 'running'} />
```

replace with:

```tsx
      <NodeBorder base={1.5} color={borderColor} running={node.lastStatus === 'running'} height={peekBox ?? undefined} />
```

`defaultPath` sets the editor's model URI when it is created and only then (`@monaco-editor/react` 4.7.0 `dist/index.mjs`: the model is `getModel(Uri.parse(path || defaultPath)) || createModel(value, language, uri)`, and it is disposed when the editor goes, `keepCurrentModel` being false), so a label changed while the cell is open does not swap the model.

- [ ] **Step 5: Routing the answer; the taller cell over the others**

In `src/webview/App.tsx`, find:

```tsx
        case 'definitionGoto':
          window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: msg.cellNodeId, line: msg.line, col: msg.col } }));
          break;
```

replace with:

```tsx
        case 'definitionGoto':
          window.dispatchEvent(new CustomEvent('skena:goToCell', { detail: { id: msg.cellNodeId, line: msg.line, col: msg.col } }));
          break;
        case 'referencesResult':
          window.dispatchEvent(new CustomEvent('skena:referencesResult', { detail: msg }));
          break;
```

Append to the end of `src/webview/styles/canvas.css`, after one blank line:

```css
/* - a code cell drawn taller while its reference peek is open (CodeNode.tsx): over every other node
   - (a selected node is at 1000, edge labels at 1000), and without its connection handles, which stay
   - at the cell's own edges, inside the taller box */
.react-flow__node:has(> .skena-node.skena-code-peek) { z-index: 3000 !important; }
.react-flow__node:has(> .skena-node.skena-code-peek) .react-flow__handle { display: none; }
```

- [ ] **Step 6: Typecheck, build, the key and reference tests**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

Run: `npm run build`
Expected: three `⚡ Done in …` lines, no `✘ [ERROR]`.

Run: `grep -c "skena-code-peek" dist/webview.css`
Expected: `2`.

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`
Expected: `# pass 24`, `# fail 0`.

Run: `npx esbuild src/shared/findReferences.ts --bundle --format=esm --outfile=tests/.build/findReferences.mjs && npx esbuild tests/fixtures/monaco-references-model.js --bundle --format=esm --platform=node --outfile=tests/.build/monacoReferencesModel.mjs && node --test tests/find-references.mjs`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/webview/canvas/nodes/cellDefinition.ts src/webview/canvas/nodes/referencePeek.ts src/webview/canvas/nodes/NodeBorder.tsx src/webview/canvas/nodes/CodeNode.tsx src/webview/App.tsx src/webview/styles/canvas.css
git commit -m "feat(references): leader z opens Monaco's reference peek in the cell"
```

---

### Task 15: Manual checks (the user runs these)

**Files:** none. The implementer reports this task as not run.

Ctrl+F5 (launch config "Run Extension"; it builds and opens an Extension Development Host). In it, File > Open Folder… `/home/quant0/projects/factors` (one folder), `.venv/bin/python` as the interpreter. The checks add cells, so they run on a copy of the canvas, not on the canvas the user works in: `cp research/review/factors-essentials.canvas /tmp/skena-check.canvas`, then File > Open File… `/tmp/skena-check.canvas`. Settings at their defaults (leader `;`). A kernel bound to the canvas's sections and started (run E1 once). On 2026-10-07 the canvas has S1 to S5 folded (FACT, read from the file; E1 to E8 are in S1, E9 to E14 in S3, E15 to E27 in S5, E17 in S6): unfold S1, S3 and S5 first.

Pylance:
- [ ] Open E12 (`Enter`), `Esc` to normal mode, put the cursor on `REPO` in line 2, `;g`: E1 is selected, the view pans by the smallest move that shows it, E1's editor opens with the cursor on `REPO` at line 30, in normal mode (the status line is empty). `Esc` out of the editor, then `` ` ` ``: back to E12.
- [ ] In E26, cursor on `CACHE` in line 14, `;g`: E15 opens at line 28 (the later of its two assignments before E26).
- [ ] In E27, cursor on `sharpe` in `sharpe(p, 365)`, `;g`: `src/factors/backtest/metrics.py` opens in the group to the right of the canvas, cursor on `sharpe` at line 5; the canvas stays visible.
- [ ] In E17, cursor on `solve` of `np.linalg.solve`, `;g`: numpy's `linalg/_linalg.py` (or its stub, if Pylance prefers it) opens beside the canvas at `def solve`. Cursor on `linalg`: numpy's `linalg/__init__.py` (or its stub).
- [ ] In E3 (before E15 in run order), cursor on `CACHE` in line 6, `;g`: E1 opens at line 29.
- [ ] In a cell, write `aa = 1` on one line and `print(aa)` two lines below, `Esc`, cursor on the second `aa`, `;g`: the cursor moves up to the first `aa` in the same editor, which stays open in normal mode.
- [ ] A function defined in two cells (paste the same `def` into two cells, call it in a third): a quick pick titled "Go to definition" lists `E…:line  def …` entries if Pylance gives both; picking one selects that cell and opens it at the line. `Esc` in the quick pick does nothing.
- [ ] Cursor on a blank or on `=`: `;g` does nothing: no note, no lookup, the cursor stays.
- [ ] Cursor on a name defined nowhere (type `undefined_thing` in a cell): `;g` shows `no definition found for undefined_thing`; the next key removes it.

Kernel. With Pylance on, the kernel is asked only when Pylance has nothing; to check the kernel's answers, disable Pylance for the workspace (Extensions view, Pylance, Disable (Workspace)) and reload the window. Re-enable it at the end.
- [ ] In a new cell write `def helper_k(x):` / `    return x` and Run it. In another cell write `helper_k(1)`, `;g` on `helper_k`: the defining cell is selected and its editor opens on `helper_k` in the `def` line (the kernel's copy of the cell matched by its text).
- [ ] Add a comment line above the `def` in the defining cell without running it, then `;g` again: it still lands on the `def` line, now one line lower (matched by the function's lines).
- [ ] Run E1 (it imports `sharpe` at line 17), then `;g` on `sharpe` in E27 line 17: `src/factors/backtest/metrics.py` opens beside the canvas at line 5.
- [ ] `;g` on `len`: `no definition found for len`.
- [ ] Start a cell with `import time; time.sleep(20)` and during it `;g` on `helper_k`: the note appears at once (the busy kernel is not asked); when the sleep ends no output appears in any other cell.
- [ ] Shut the kernel down (kernel node menu): `;g` on `helper_k` gives the note.

References (Pylance on). Before them, `cp /tmp/skena-check.canvas /tmp/skena-check.before`.
- [ ] In E3 (11 lines, 250 px tall on 2026-10-07), cursor on `CACHE` in line 6, `;z`: E3 is drawn taller and Monaco's reference peek opens inside it under line 6, over the cells below; no other node moves and the view does not pan. The list starts on the reference in E3, line 6, with the preview on the left; the groups are E3 first, then the other cells that use `CACHE` in run order (E1, E5, E7, E9, E12, E15, E16, E26 on 2026-10-07), each with its count.
- [ ] `j` and `k` move in the list and the preview follows; the vim status line stays empty, the cursor in E3 does not move, the canvas does not move. A group other than E3's starts collapsed; `l` (or the right arrow, or a click) opens it, and `h` on an open group closes it (on a reference, `h` moves to its group).
- [ ] Enter on the reference in E12: the peek closes, E3 is back at its size, E12 is selected and its editor opens at that line in normal mode. `Esc` out of the editor, then `` ` ` ``: back to E3.
- [ ] `;z` again in E3 on `CACHE`, then Enter on the reference in E3 itself: the peek closes and the cursor is on that place in E3, in normal mode.
- [ ] `;z` in E3, then double-click a reference in E9 in the list: the same as Enter.
- [ ] `;z` in E3, then `Esc` in the list: the peek closes, E3 is back at its size, the cursor is where it was, in normal mode. Then `node -e 'const r=f=>JSON.parse(require("fs").readFileSync(f,"utf8")).nodes;const b=new Map(r("/tmp/skena-check.canvas").map(n=>[n.id,n]));for(const n of r("/tmp/skena-check.before")){const m=b.get(n.id);if(!m||["x","y","width","height"].some(k=>n[k]!==m[k]))console.log(n.id)}'` prints nothing (no node moved or changed size in the file).
- [ ] `;z` in E3, click back into E3's text (the peek stays open), `Esc`: the peek closes; a second `Esc` leaves the editor.
- [ ] `;z` in E3, then click on an empty part of the canvas: E3's editor closes and E3 is back at its size.
- [ ] In E26 (43 lines, 850 px tall), `;z` on `CACHE` in line 14: the peek opens with no change to E26's size.
- [ ] In E27, cursor on `sharpe` in `sharpe(p, 365)`, `;z`: the cell groups come first (E27, then E1, E11, E13, E14, E15), then file groups, among them `metrics.py`; Enter on its reference opens `src/factors/backtest/metrics.py` beside the canvas at line 5, and E27 is back at its size.
- [ ] Type into the peek's preview: nothing changes (Monaco says the editor is read-only).
- [ ] Right-click in a cell's text with no peek open: the menu has no "Go to References" and no "Peek".
- [ ] `;z` on a blank: nothing happens. `;z` on `undefined_thing`: either the note `no references found for undefined_thing` or a peek with that one place (what Pylance answers for an undefined name is not known).
- [ ] At canvas zoom about 0.5, `;z` in E3: the peek is drawn at the canvas's scale inside the taller E3, and E3's border follows the taller box.
- [ ] After the reference checks, View > Problems lists nothing from `$XDG_RUNTIME_DIR/skena/definition/` or from the files the references were in.

Keys and other editors:
- [ ] In a text note in normal mode, `fa`, then `;` then `g`: vim's `;` (repeat find) then `g` as before; no note, no lookup. The same with `;` then `z`, and the same in the chat input.
- [ ] In a code cell in insert mode, typing `;g` inserts `;g`, and `;z` inserts `;z`.
- [ ] `;;l` jump labels still work in a code cell.
- [ ] `;g` then immediately `j` before the answer arrives: the cursor moves down in the cell; no jump happens afterwards. The same with `;z`: no peek opens afterwards.
- [ ] Fold S1 (it holds E1), keep S3 open, then in E12 `;g` on `REPO`: S1 unfolds, E1 is selected and its editor opens at line 30.

Files and saving:
- [ ] After several lookups, `ls $XDG_RUNTIME_DIR/skena/definition/`: at most 4 `def-*.py` files per canvas. View > Problems lists nothing from them.
- [ ] Close the window: nothing asks to be saved.

If a check fails, write down the cell label, the keys pressed and what was seen.

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| Leader then `g` in a code cell's editor, vim normal mode; `;g` by default | `leaderStep` `definition` (Task 3, test 24); `installJumpLabels` `onLookup` (Task 3), passed by CodeNode (Task 11); normal mode through `idleNormal` |
| The name: identifier under the cursor with the dotted names before it | `dottedNameAt` (Task 4, tests 2-5) |
| Only code cells; text notes and chat unchanged; leader + anything else as today | `onLookup` passed only by CodeNode (Task 11); test 24 |
| Keys read the way jump labels read them | the same capture listener and `leaderStep` (Task 3 Step 5) |
| Pylance on the cells joined in run order, section by section | `codeCellsInRunOrder`, `joinCells` (Task 5, tests 6-8); joined file (Task 9); `findDefinitions` (Task 10) |
| `vscode.executeDefinitionProvider` at the cursor's place, result mapped back to a cell and line | `toJoined`, `pylanceLocations`, `targetsFromLocations` (Tasks 5, 6, 10; tests 8-10) |
| Imports through the workspace's interpreter | the spike: the venv's names resolved in the file kind (Spike result) |
| Several cells define a name: the latest earlier one in run order | `targetsFromLocations` keeps the last location at or before the cursor (test 9); the spike: Pylance returned both `CACHE` assignments (E1:29, E15:28) |
| Kernel only when Pylance returns nothing, only if running and idle, never queued | `findDefinitions` order; `isIdle` (Task 8); timeout 3 s |
| Identifiers and dots only; `getsourcefile`/`getsourcelines`; decorators unwrapped | `isDottedName` + `definitionExpression` throws (Task 7 test 8); the Python lookup (tests 1-5; real kernel) |
| A cell's temporary file matched to a cell by source text | `targetsFromKernel` (Task 6 tests 11-13) |
| Silent: no output, no execution count, no history | `buildSilentEvaluateRequest` (Task 8); FACT real kernel: iopub only busy/idle, count unchanged, `len(In)` unchanged |
| Cell target: selected as `h/j/k/l` (smallest pan, `` ` `` register), editor opens, cursor at line and column, normal mode | `skena:goToCell` → `focusNodeById` + `skena:enterEdit` with a cursor (Task 11) |
| File target: the group beside the canvas, created if none; cursor and reveal | `showTextDocument` with `ViewColumn.Beside` and `selection` (Task 10) |
| Several answers: quick pick `file:line` or `E7:line` with the line's text | `pickEntry` (test 15), `showDefinitions` (Task 10) |
| No answer: `no definition found for <name>`, gone on the next key | `cellDefinition.ts` + CodeNode note (Task 11) |
| No name under the cursor: nothing happens, no note (user) | `requestDefinition` and `requestReferences` return before asking (Tasks 11, 14); manual checks |
| An instance: go to its class (user) | the kernel lookup's `target` (Task 7, `sq` → `class Shape`, test 3 `fx.box`) |
| Leader then `z`: every reference of the name, Pylance only, same joined file, mapped to cells and files | `leaderStep` `references` (Task 3, test 24); `findReferences` with `vscode.executeReferenceProvider` (Task 13); `referencesFromLocations` (Task 12, test 1) |
| Shown as Monaco's own reference peek in the cell's editor: preview left, list grouped by cell or file right | `editor.action.referenceSearch.trigger` on the host's answer (Task 14); the grouping and order (Task 12, test 2, Monaco's `ReferencesModel`) |
| `j`/`k` move in the list, Enter goes to the place as a definition does, Esc closes the peek | `referencePeek.ts` keys and editor opener → `skena:goToCell` / `showDefinitions` (Task 14); `openedTarget` (Task 12, test 3); Esc is Monaco's |
| A cell shorter than the peek needs is drawn taller over what lies below; no node moves, layout unchanged; back to its size on close | `peekBoxHeight` (Task 12, test 5); the inner box, `NodeBorder` and a CSS z-index while open, `reportHeight` skipped (Task 14) |
| No references: `no references found for <name>` | `cellDefinition.ts` (Task 14) |
| Unknowns settled by a spike the user runs | Task 1, Spike result |
| Tests: dotted name, joining and mapping both ways (CRLF, empty cells), choosing among results, kernel temp file → cell, file → file, leader g, quick pick entries; the snippet against a real Python | `tests/go-to-definition.mjs` (15), `tests/jump-labels.mjs` (24), `tests/kernel-definition.mjs` (8), `tests/joined-file.mjs` (2), `tests/jupyter-protocol.mjs` (+2), `tests/find-references.mjs` (5) |
| Out of scope: `gd`, hover, text notes, markdown code blocks, other notebooks, other languages | none of these are implemented |

## Points the spec does not settle, or that differ from it

Each is in the code as described; the user may want another choice.
1. **A chain through a call or subscript** (`df.groupby(k).mean`): Pylance is still asked at the cursor; the kernel is not (it would have to evaluate the call). The note then names the word (`mean`).
2. **The last attribute is read without running it** (`inspect.getattr_static`), so `obj.prop` goes to the property's getter; the spec accepts running a property. Attributes before the last are read normally (`a.prop.x` runs `prop`).
3. **A kernel answer that matches no cell** (the function's lines were changed since it ran) gives the note; a function made by `exec` has no source for `inspect` and gives the note too. When the kernel names a real file on disk, that file opens.
4. **An answer that arrives after another key in the cell, or after the cell lost focus, is dropped** (definitions and references). Without this, keys typed while waiting would land in the other cell's editor.
5. **A cell in a folded section** is reached by unfolding its section first.
6. **Waiting for Pylance**: for a joined file not asked about before in this window, an empty answer is asked again every 250 ms for up to 600 ms; otherwise one call. The spike's slowest first answer was 581 ms and no call came back empty, so the retry itself is unmeasured. A name only the kernel knows waits up to 600 ms before the kernel is asked, once per new text. No timing was measured for references.
7. **Magic and shell lines** are commented out in the joined text; a cell under a non-Python cell magic is commented out whole. Names defined by them (`x = !ls`, `%time x = 1`) are not seen by Pylance.
8. **Multi-root windows** are not covered by the spike: pyright gives a file outside every folder its `<default>` workspace there, so imports may not resolve.
9. **No indicator while a lookup runs.**
10. **Order of the peek's groups**: the asking cell first, then the other cells in run order, then the files by path. Monaco sorts groups by URI, so the order comes from the URIs (Task 12); VS Code's own order would be by URI as well.
11. **A cell's group shows `/` after its label** (the URI path's directory, the standalone label service), and a file's group its full folder path, not one relative to the workspace.
12. **The preview is read-only**, also for the asking cell: a copy of another cell or a file is saved nowhere, so an edit there would be lost.
13. **`j`/`k` select as they move, so the preview follows** (as VS Code's list does); Monaco's own arrows in standalone only move the focus. Groups other than the starting one start collapsed (Monaco's tree default, `asyncDataTree.js:209`); `l` opens a closed group (or moves into an open one) and `h` closes an open group (or moves from a reference to its group), as the right and left arrows do (user decision); a click opens one too. Enter on a group row does nothing.
14. **The peek's height** is Monaco's default, 18 lines. Resizing the peek with its sash does not resize the cell.
15. **Only the height grows.** A narrow cell gives a narrow peek (Monaco's preview needs 200 px and the list 100 px, `referencesWidget.js` split view); the cell is not drawn wider.
16. **Edges and handles while the cell is taller**: edges keep their ends at the cell's own box; the cell's handles are hidden.
17. **Esc with the cursor in the text and the peek open** closes the peek; the next Esc leaves the editor (without this, Esc in normal mode would close the editor and the peek with it).
18. **References in older joined files are dropped** (Task 12); a reference in a file outside the workspace (numpy, say) is kept and shown with its full path.
19. **The text of every file with a reference is sent whole** to the webview; a name used in many large files sends them all. No limit is set.

## Monaco API the peek relies on (monaco-editor 0.55.1, `node_modules/monaco-editor/esm/vs/`)

Read in the shipped source on 2026-10-07. "editor/" below is `node_modules/monaco-editor/esm/vs/editor/`.

- **The peek is in the bundle already.** `basic-languages/python/python.contribution.js:1` imports `../_.contribution.js`, which imports `editor/contrib/gotoSymbol/browser/goToCommands.js` (`:25`) and `editor/standalone/browser/referenceSearch/standaloneReferenceSearch.js` (`:71`); `src/webview/index.tsx:20` imports the python contribution. The standalone controller is created with the list's own keys on (`standaloneReferenceSearch.js:23-36`, `super(true, …)`).
- **Showing the peek with our data.** `editor.action.referenceSearch.trigger` (`goToCommands.js:568-587`) asks the reference providers (`getReferencesAtPosition`, `goToSymbol.js:56-68`, with `includeDeclaration: true`) and, with `openInPeek`, always opens the peek (`goToCommands.js:139`, `:194-198` → `ReferencesController.toggleWidget`, `referencesController.js:66`). Its precondition is `hasReferenceProvider` (`goToCommands.js:577`), set at once when a provider is registered (`codeEditorWidget.js:1676`, `:1726`). A single reference under the cursor would run `alternativeReferenceCommand` instead, which defaults to `''` (`goToCommands.js:103-108`, `editorOptions.js:796`). `editor.trigger` hands a command that is not an editor action to the command service (`codeEditorWidget.js:763-818`); the action runs on the focused editor (`editorExtensions.js:274-293`). `editor.action.peekLocations` (`goToCommands.js:652-666`) takes the locations as arguments but needs several of them, which `trigger` cannot pass (one `payload`), so a provider is used.
- **Models.** The peek resolves every URI through the text model service (`referencesWidget.js:482`, `referencesModel.js` `FileReferences.resolve`), which in standalone only returns an existing model and rejects with `Model not found` otherwise (`standaloneServices.js:125-129`). Public: `monaco.editor.createModel`, `getModel`, `ITextModel.dispose` (`editor.api.d.ts:1029`, `:1066`).
- **Groups and labels.** `ReferencesModel` sorts by `extUri.compare` of the URIs, then by range, and groups by URI (`referencesModel.js:120`, `:237`); the start reference shares the longest URI prefix with the editor's model, then is the nearest (`referencesModel.js:189-216`); a group row shows `getUriBasenameLabel` and `getUriLabel(dirname)` (`referencesTree.js:113`), which in standalone are the path's last part and the path (`file:` the full path) (`standaloneServices.js:584-594`).
- **Opening a result.** The list opens on Enter-selection with `pinned: false` (preview only, `listService.js:465-474`) and on double-click with `pinned: true` (`listService.js:489-503`); the widget turns them into `show` and `goto` (`referencesWidget.js:368-378`); `goto` in peek mode runs `_gotoReference`, which hides the peek, opens the reference through `ICodeEditorService.openCodeEditor` with the peek's editor as source, and shows the peek again if that returns the same editor and the widget still exists (`referencesController.js:223-254`). The command `openReference` closes the peek, then opens the focused reference the same way (`referencesController.js:256-266`, `:374-380`). `monaco.editor.registerEditorOpener` (`editor.api.d.ts:1156-1175`, `standaloneEditor.js:382-401`) adds a handler that is asked before the standalone one (`abstractCodeEditorService.js:111-123`, `unshift`); without one, a URI of another model opens nothing (`standaloneCodeEditorService.js:52-88`). The controller's `closeWidget(focusEditor)` is a public method of the class (`referencesController.js:211-221`), reached with `editor.getContribution('editor.contrib.referencesController')` (`:41`, `editor.api.d.ts:6147`).
- **Keys in the list.** monaco-vim listens on `editor.onKeyDown` (`monaco-vim/src/cm_adapter.ts:372`), fired only from the editor's own text input (`editor/browser/controller/editContext/native/nativeEditContext.js:96-98`, `textArea/textAreaEditContext.js:211-212`). The list's keyboard controller exists when `keyboardSupport` is on (`base/browser/ui/list/listWidget.js:1145`): Enter selects the focus, the arrows move the focus, Escape clears a selection (`listWidget.js:241-335`); it reads `keyCode` (`base/browser/keyboardEvent.js:16`). Monaco 0.55.1 has no `list.focusDown` command. Esc in the list goes to the keybinding service from a capture listener on the list's container (`referencesWidget.js:320-327`) and `closeReferenceSearch` takes it (`referencesController.js:326-340`). The context key `referenceSearchVisible` (`referencesController.js:38`) has no public reader, so the webview watches the DOM.
- **Size and place.** The peek is a view zone plus an overlay widget after the cursor's line (`zoneWidget.js:291`); an overlay widget without `allowEditorOverflow` lives inside the editor's `overflow-guard` element (`_overflowGuardContainer`; `editor/browser/viewParts/overlayWidgets/overlayWidgets.js:57`, `:73`; `editor/browser/view.js:177`), so the editor's box clips it. It asks for 18 lines (`referencesWidget.js:147`, `:259`) and gets at most `max(12, 0.8 × editor height in lines)` (`zoneWidget.js:248-249`, `:264`), measured when it opens. Widget focus is focus anywhere in the editor's DOM or its overflow widget node (`view.js:72`, `:686`, `:697`).

## Spike result

User's second run, 2026-10-07 14:56 UTC (FACT, `/run/user/1000/skena/definition-spike/report.txt`): VS Code 1.141.0-insider over SSH, Pylance 2026.4.1, Python extension 2026.8.0, Jupyter extension 2025.9.1, one folder `/home/quant0/projects/factors`, interpreter `.venv/bin/python3`, `files.hotExit: off`; `factors-essentials.canvas` read from disk, 27 code cells. Names asked at their last place in run order: `sharpe` E27:17, `run_walkforward` E12:22, `REPO` E12:2, `CACHE` E26:14, `np.linalg.solve` E17:34.

- **file** (a `.py` in `/run/user/1000/skena/definition-spike`; chosen by the user): all five resolved, each in one call. `sharpe` → `src/factors/backtest/metrics.py:5`, `run_walkforward` → `src/factors/walkforward/runner.py:98`, `REPO` → E1:30, `CACHE` → E1:29 and E15:28 (two results), `np.linalg.solve` → `.venv/…/numpy/linalg/_linalg.py:364`. First answers 126-249 ms (v1, a fresh file: 164-249 ms; v2: 126-223 ms). The text shifted by 3 lines (v2) mapped to the same cells and lines for all five. Both files: dirty false, untitled false, 0 problems (first line `# type: ignore`). Opened in 229 ms (v1) and 114 ms (v2).
- **untitled**: the same five answers, same mapping in v2, first answers 100-581 ms (581 ms for `sharpe`, the window's first lookup). The document was dirty, listed 150 problems (first: "Statement ends with an unnecessary semicolon"), and the user saw an Untitled tab. Dropped for that.
- **notebook** (a file of the spike's own notebook type): the imported names resolved (79-175 ms), but `REPO` and `CACHE` came back under `joined-v1.skena-definition-spike.py` (an internal path that maps to no cell; v2 "same as v1: NO"), and `CACHE` gave one result instead of two. Dropped for that.

Choice (user): the kind "file", as Tasks 9 and 10 are written. Wait times set from these numbers: `RETRY_MS` 250, `WAIT_MS` 600 (Task 10).

## Appendix: the real-kernel check

The script behind the FACT lines of Task 7 (outputs there). It starts an ipykernel from the factors venv with `jupyter_client`, with `JUPYTER_RUNTIME_DIR`, `JUPYTER_DATA_DIR`, `IPYTHONDIR` and `JUPYTER_CONFIG_DIR` under its own folder; it installs nothing. `exprs.json` holds `{ "key": DEFINITION_KEY, "items": [[name, definitionExpression(name)], …] }`, written by a three-line node script from the `tests/.build/definitionSnippet.mjs` bundle. Run: `TMPDIR=$PWD/tmp /home/quant0/projects/factors/.venv/bin/python real_kernel.py`.

```python
# - a real ipykernel (factors venv), cells run as skena runs them, then silent execute_requests with the
#   definition expression as a user_expression; prints what came back and what the kernel published
import json, os, sys, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
for k, sub in [('JUPYTER_RUNTIME_DIR', 'rt'), ('JUPYTER_DATA_DIR', 'data'), ('IPYTHONDIR', 'ipy'), ('JUPYTER_CONFIG_DIR', 'cfg')]:
    os.environ[k] = os.path.join(HERE, 'jhome', sub)
    os.makedirs(os.environ[k], exist_ok=True)

from jupyter_client.manager import start_new_kernel

km, kc = start_new_kernel(kernel_name='python3')
print('kernel argv', km.kernel_spec.argv[:3] if km.kernel_spec else None)

def drain_iopub(msg_id, until_idle=True, timeout=10):
    seen = []
    end = time.time() + timeout
    while time.time() < end:
        try:
            m = kc.get_iopub_msg(timeout=0.5)
        except Exception:
            continue
        if m['parent_header'].get('msg_id') != msg_id:
            continue
        t = m['header']['msg_type']
        seen.append(t if t != 'status' else 'status:' + m['content']['execution_state'])
        if until_idle and t == 'status' and m['content']['execution_state'] == 'idle':
            break
    return seen

def run_cell(code):
    msg_id = kc.execute(code, silent=False, store_history=True)
    reply = kc.get_shell_msg(timeout=30)
    io = drain_iopub(msg_id)
    return reply['content'], io

def evaluate(expressions):
    msg_id = kc.execute('', silent=True, store_history=False, user_expressions=expressions, allow_stdin=False, stop_on_error=False)
    t0 = time.time()
    reply = kc.get_shell_msg(timeout=30)
    ms = (time.time() - t0) * 1000
    io = drain_iopub(msg_id)
    return reply['content'], io, ms

CELLS = [
    'import numpy as np\nimport pandas as pd\nimport functools\nfrom factors.backtest.metrics import sharpe\nfrom factors.walkforward.runner import WalkForwardConfig, run_walkforward',
    'def logged(f):\n    @functools.wraps(f)\n    def inner(*a, **k):\n        return f(*a, **k)\n    return inner\n\n@logged\ndef decorated(y):\n    return y\n\ndef in_cell(a):\n    return a + 1',
    'class Shape:\n    def area(self):\n        return 1\n\n    @property\n    def side(self):\n        raise RuntimeError("the property ran")\n\nsq = Shape()',
    '%time x = 1\ndef after_magic():\n    return 2',
    'import dataclasses\n\n@dataclasses.dataclass\nclass Pt:\n    x: int = 0',
]
for c in CELLS:
    content, io = run_cell(c)
    print('cell', content['status'], 'execution_count', content.get('execution_count'), io)

before_ns, _, _ = evaluate({'ns': 'sorted(k for k in globals() if not k.startswith("_"))', 'main': '__import__("sys").modules["__main__"].__dict__ is globals()', 'mainfile': 'repr(getattr(__import__("sys").modules["__main__"], "__file__", None))', 'nIn': 'len(In)'})
print('before', {k: v['data']['text/plain'] for k, v in before_ns['user_expressions'].items()})

d = json.load(open(os.path.join(HERE, 'exprs.json')))
for name, expr in d['items']:
    content, io, ms = evaluate({d['key']: expr})
    v = content['user_expressions'][d['key']]
    data = v.get('data', {})
    j = data.get('application/json')
    if j and 'cell' in j:
        j = {**j, 'cell': j['cell'][:60] + ('...' if len(j['cell']) > 60 else '')}
    print(json.dumps({'name': name, 'ms': round(ms), 'status': content['status'], 'execution_count': content.get('execution_count'),
                      'mimes': sorted(data), 'json': j, 'plain_is_json': data.get('text/plain') == json.dumps(data.get('application/json')) if 'application/json' in data else None,
                      'iopub': io, 'expr_status': v.get('status'), 'evalue': v.get('evalue')}))

after_ns, _, _ = evaluate({'ns': 'sorted(k for k in globals() if not k.startswith("_"))', 'nIn': 'len(In)'})
print('after', {k: v['data']['text/plain'] for k, v in after_ns['user_expressions'].items()})
content, io = run_cell('1 + 1')
print('next cell execution_count', content['execution_count'])

# - a request sent while a cell runs waits behind it
busy_id = kc.execute('import time; time.sleep(3)', silent=False, store_history=True)
time.sleep(0.2)
t0 = time.time()
msg_id = kc.execute('', silent=True, store_history=False, user_expressions={d['key']: d['items'][0][1]})
while True:
    r = kc.get_shell_msg(timeout=30)
    if r['parent_header']['msg_id'] == msg_id:
        print('busy: reply after', round((time.time() - t0) * 1000), 'ms', r['content']['status'])
        break

kc.stop_channels()
km.shutdown_kernel(now=True)
```
