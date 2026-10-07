# Go to Definition from Code Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-10-07-go-to-definition-design.md` (`b4914f8`). In a code cell's editor, in vim normal mode, leader then `g` (`;g` by default) goes to where the dotted name under the cursor is defined: Pylance first, on the canvas's code cells joined in run order; the canvas's kernel when Pylance finds nothing and the kernel is idle. A definition in a cell selects that cell as `h/j/k/l` do and opens its editor at the line; one in a file opens beside the canvas; several go to a quick pick; none leaves a short note in the cell.

**Architecture:** Task 1 is a temporary command the user runs in a live window to choose the kind of document Pylance is asked about. The tasks after it are written for the kind "file": the joined cells are written to a `.py` file in the per-user temporary folder (`$XDG_RUNTIME_DIR/skena/definition`, else `<tmpdir>/skena-<user>/definition`), one file per canvas and text, opened with `openTextDocument` and never shown, and `vscode.executeDefinitionProvider` is asked at the cursor's place in it. The pure parts (`src/shared/goToDefinition.ts`) find the dotted name, join the cells, map positions both ways and turn answers into places to go; they are tested in node. The kernel part sends one silent `execute_request` with a `user_expressions` entry that looks the name up with `inspect` and answers JSON; it was run against a real ipykernel. In the webview, the existing jump-label key reader in each Monaco editor (`installJumpLabels`) takes leader `g` in code cells only; landing in a cell reuses `focusNodeById` and the `skena:enterEdit` event with a cursor.

**Tech Stack:** TypeScript 5, React 18, React Flow 12, Monaco 0.55.1 + monaco-vim 0.4.4, the VS Code extension API (`vscode.executeDefinitionProvider`, `showTextDocument`, `showQuickPick`), Pylance (`ms-python.vscode-pylance`), the Jupyter messaging protocol 5.3 over the Jupyter server's websocket (`ws`), Python 3 (`inspect`, `linecache`), esbuild bundles + `node --test` (each test file's line 1 holds its run command).

---

## Task 1 is a spike. Tasks 2 to 12 start only after the user reports its result.

Pylance cannot run outside a VS Code window here, so Task 1 builds a temporary command the user runs in an Extension Development Host. Its report settles what the spec leaves open: which kind of document Pylance resolves the workspace's imports in, whether a name defined in another cell comes back inside the joined document, whether closing the window asks to save anything, and how long the answers take. **Do not start Task 2 before the user has reported the result and chosen the kind.** The tasks are written for the kind "file"; "If the user chooses another kind" below says what changes.

## Before you start

- Work on branch `feature/spatial-notebook`. Stage files by name; commit only the files each task names. No attribution lines of any kind in commit messages.
- `.vscode/skena-mcp.js` and the untracked `.vscode/numbered-bookmarks.json` are not yours. Never stage them. `npm run build` rewrites `.vscode/skena-mcp.js`; leave it unstaged. If `git status` shows uncommitted changes in a file this plan edits and you did not make them, stop and ask.
- If `git commit` fails on `index.lock`, wait a few seconds and run it again. Never delete the lock file.
- Line numbers in this plan are those of `771c94b`. Find each edit by the quoted text; the numbers may have moved.
- Typecheck baseline at `771c94b` (FACT, run on a copy): `npx tsc --noEmit` reports 3 errors, all `Property 'fsPath' does not exist on type 'ResolvedUri'` in `src/extension/editor-provider.ts`. They are old. The typecheck command in this plan filters exactly those out:

  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"
  ```

  Expected output: nothing.
- `tests/jupyter-protocol.mjs` test 4 (`collectOutputs marks error status on error reply`) already fails at `771c94b` (FACT, run on a copy: it expects `ValueError: bad`, `collectOutputs` returns the traceback `x`). It is not this plan's; Task 8 expects it to keep failing.
- `tests/kernel-definition.mjs` (Task 7) runs `python3` from `PATH` (set `PYTHON=` to use another). It installs nothing. FACT (my runs): its 8 tests pass with Python 3.10.12, 3.11.9, 3.12.12 (the factors venv) and 3.14.2.
- Verification done for this plan (FACT): the code of Tasks 1 to 11 was applied to a copy of `771c94b` from this file by a script, task by task, running the commands written here; each test step failed and then passed as stated, the typecheck command printed nothing wherever a task runs it, `npm run build` succeeded in Tasks 1, 10 and 11, and after each commit `git status` showed only `.vscode/skena-mcp.js`. The manual checks (Task 1 Step 6, Task 12) have not been run.

## What is known before the spike

From a web and source search (sources in brackets; "code" means read in the source, Pylance 2026.4.1 is closed source and its shipped bundle was searched):

- Pylance takes `file` and `untitled` Python documents, notebook cells (`vscode-notebook-cell`), and a few other schemes; not any other scheme unless the experimental setting `python.analysis.supportAllPythonDocuments` is on [code: Pylance 2026.4.1 `dist/extension.bundle.js` document selector].
- A document is analysed when it is opened with `openTextDocument`; it does not need to be shown [code: vscode-languageclient sends `didOpen` for every open document that matches, `client/src/common/textSynchronization.ts`, https://github.com/microsoft/vscode-languageserver-node].
- Which workspace (interpreter, settings) a file outside every folder gets: pyright's `_getBestWorkspaceForFile` gives it the only workspace when the window has one folder, and a `<default>` workspace when there are several [code: https://github.com/microsoft/pyright/blob/main/packages/pyright-internal/src/workspaceFactory.ts]. Untitled documents follow the same rule. So in a single-folder window the joined file uses the folder's interpreter (INFERENCE: Pylance is built on pyright; the spike checks it).
- An untitled document created with content through the API is dirty from the start and is not released while dirty [code: `mainThreadDocuments.ts` "mark as dirty", `untitledTextEditorModel.ts`, https://github.com/microsoft/vscode]. There is no API to close a document [maintainer, https://github.com/microsoft/vscode/issues/187008]. INFERENCE (untested): on close, either a save prompt or a hot-exit backup that reopens as an "Untitled-N" tab next time.
- `workspace.openNotebookDocument(type, data)` makes an untitled notebook, also dirty [code: `mainThreadNotebookDocuments.ts` "untitled notebooks with content are dirty by default"]. Pylance's notebook support (LSP 3.17 notebook sync) takes notebooks with `file` or `untitled` URIs and Python cells, of any notebook type [code: Pylance `dist/server.bundle.js` `notebookSelector`]. So a notebook of skena's own type saved as a file is a candidate that is not dirty (INFERENCE).
- An empty answer right after Pylance starts was reported, with a sleep as the workaround [user report, https://github.com/microsoft/vscode/issues/133952]. No published latency figures were found.
- Go to definition prefers `.py` sources over `.pyi` stubs and falls back to stubs when there is no source [release note, https://github.com/microsoft/pylance-release/releases/tag/2021.2.1; code: pyright `DefinitionFilter.PreferSource`].

What the kernel part was checked against (FACT, the script in the Appendix, factors venv: Python 3.12.12, ipykernel 6.31.0, IPython 9.12.0, jupyter_client 8.8.0): after five cells ran (execution count 5), 19 silent requests each published only `status: busy` and `status: idle` on iopub, answered in 8 to 21 ms, left the execution count at 5 (the next cell got 6), left `len(In)` at 6 and the user namespace unchanged. A request sent while a 3-second cell ran was answered after 2822 ms. The outputs per name are in Task 7.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/extension/definitionLookupTest.ts` | create in Task 1, delete in Task 2 | The spike's command. |
| `src/shared/goToDefinition.ts` | create | Pure. `isDottedName`, `dottedNameAt`, `codeCellsInRunOrder`, `joinCells`, `toJoined`, `fromJoined`, `targetsFromLocations`, `targetsFromKernel`, `fileUri`, `pickEntry`, the types. |
| `tests/go-to-definition.mjs` | create | node:test for `goToDefinition.ts` (15 tests). |
| `src/webview/canvas/jumpLabels.ts` | modify | `leaderStep` takes leader `g` where go to definition is on. |
| `tests/jump-labels.mjs` | modify | Test 24. |
| `src/extension/jupyter/definitionSnippet.ts` | create | The Python lookup as a `user_expressions` expression; `parseDefinitionValue`. |
| `tests/kernel-definition.mjs`, `tests/fixtures/definition_fixture.py`, `tests/fixtures/definition_driver.py` | create | Runs the expression in a real Python (8 tests). |
| `src/extension/jupyter/protocol.ts` | modify | `buildSilentEvaluateRequest`, `parseEvaluateReply`. |
| `tests/jupyter-protocol.mjs` | modify | 2 tests. |
| `src/extension/jupyter/client.ts`, `src/extension/jupyter/manager.ts` | modify | `kernelState`, `evaluateExpressions`; `isIdle`, `evaluate`. |
| `src/extension/ipcEndpoint.ts` | modify | Export `userTempDir`. |
| `src/extension/definition/joinedFile.ts` | create | Writes the joined file per canvas and text; deletes old ones. |
| `tests/joined-file.mjs` | create | 2 tests. |
| `src/extension/definition/pylanceDefinitions.ts` | create | Asks `vscode.executeDefinitionProvider`, asks again while a new file gives nothing. |
| `src/extension/definition/goToDefinition.ts` | create | `findDefinitions` (Pylance, then the kernel), `showDefinitions` (open beside, quick pick). |
| `src/shared/types.ts` | modify | `MsgGoToDefinition`, `MsgShowDefinitions`, `MsgDefinitionResult`, `MsgDefinitionGoto`. |
| `src/extension/editor-provider.ts` | modify | Two message cases. |
| `src/webview/canvas/editorJumpLabels.ts` | modify | `onDefinition` option; `moveVimCursor` exported. |
| `src/webview/canvas/nodes/cellDefinition.ts` | create | The webview's half: send the request, act on the answer, drop an answer that comes after another key. |
| `src/webview/canvas/nodes/CodeNode.tsx` | modify | Leader `g`, the note, opening the editor at a cursor. |
| `src/webview/App.tsx` | modify | Route `definitionResult` and `definitionGoto`. |
| `src/webview/canvas/CanvasView.tsx` | modify | `skena:goToCell`: select the cell, unfold its section if folded, open its editor at the line. |
| `src/webview/styles/canvas.css` | modify | `.skena-code-def-note`. |

## If the user chooses another kind

- **untitled** (only if Task 1 showed no save dialog and no restored "Untitled-N" tab): Task 9 is dropped. `pylanceDefinitions` keeps one untitled document per canvas in a `Map` (created with `openTextDocument({ language: 'python', content })`) and replaces its whole text with a `WorkspaceEdit` before each request; `asked` is keyed by the text instead of the file. `findDefinitions` passes the text instead of `writeJoinedFile(...)`. Everything else stays.
- **notebook**: Task 9 writes `def-<canvas hash>-<text hash>.skena-definition` files holding one cell per code cell (`{ cells: [{ id, code }] }`), and `package.json` declares the notebook type `skena-definition` with a serializer registered at activation (the spike's `SpikeSerializer` and `contributes.notebooks` entry, kept). `pylanceDefinitions` opens it with `openNotebookDocument(uri)` and asks at the cursor's cell document (`notebook.cellAt(i).document.uri`), position = the cell's own line and column. `targetsFromLocations` gets a sibling that maps a `vscode-notebook-cell:` URI to a canvas cell through the cell's metadata `id`; `joinCells`, `toJoined` and `fromJoined` are no longer used by the host (keep or drop them with their tests 7 and 8), and magic lines need no commenting (Pylance's notebook mode reads IPython syntax). The kernel part, the keys, the webview and the quick pick stay.
- **file, but imports do not resolve** (for example a multi-root window, where pyright gives a file outside every folder its `<default>` workspace): no change to the code here; the kernel still answers for names it has. Pointing Pylance at an interpreter for files outside the folder would need a folder for them, which the spec rules out.

---

### Task 1: Definition lookup test (spike; the user runs it)

**Files:**
- Create: `src/extension/definitionLookupTest.ts`
- Modify: `src/extension/extension.ts:16` (import), `src/extension/extension.ts:143` (register)
- Modify: `package.json:112-116` (command, `menus`, `notebooks`)

The command exists only when the extension runs in an Extension Development Host (`context.extensionMode === vscode.ExtensionMode.Development`); the context key `skena.devBuild` hides it from the command palette otherwise. It reads the focused canvas from disk (`readCanvas`; edits reach the file within 500 ms), joins its code cells much as Task 5's `joinCells` will (header lines, each cell then an empty line, lines starting with `%` or `!` commented out), and for each kind ticked asks `vscode.executeDefinitionProvider` at the last place each typed name occurs in the cells, asking again every 250 ms for up to 10 s while the answer is empty. Each kind runs twice: on the canvas's text (v1) and on a second text (v2) that moves every cell 3 lines down (untitled, file) or one cell down (notebook); the answers mapped back to cells must be the same both times. It prints the VS Code, Pylance, Python and Jupyter extension versions, the workspace folders, the interpreter the Python extension has for the first folder, `files.hotExit`, each document's dirty and untitled state, and the number of problems VS Code holds for each document 3 s after the lookups.

- [ ] **Step 1: Write the command**

Create `src/extension/definitionLookupTest.ts`:

```ts
/**
 * TEMPORARY, go to definition plan Task 1 (removed in Task 2). "Skena: Definition lookup test (dev)"
 * exists only in an Extension Development Host. It joins the focused canvas's code cells in run order,
 * asks vscode.executeDefinitionProvider about the names the user types, for each kind of document
 * picked, and writes what came back, with timings, to the output channel "Skena definition lookup
 * test" and to report.txt in its folder. Kinds:
 * - untitled: openTextDocument({ language: 'python', content }), changed in place for the second text
 * - file:     a .py file per text in the per-user temporary folder, opened with openTextDocument
 * - notebook: a file per text of the notebook type skena-definition-spike (registered here), one cell
 *             per code cell; Pylance gets it through LSP notebook sync
 * Each kind runs the names on the canvas's text, then on a second text with 3 empty lines after the
 * header (untitled, file) or an empty first cell (notebook); a target that moves to another cell or
 * line between the two is a mapping error.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readCanvas } from './canvas-io';
import { SkenaEditorProvider } from './editor-provider';
import { memberCodeCellsInRunOrder, sortLanes } from '../shared/sectionLanes';
import type { CodeNode } from '../shared/types';

export const SPIKE_NOTEBOOK = 'skena-definition-spike';
const HEADER = ['# type: ignore', '# - skena: definition lookup test'];

interface Cell { id: string; label: string; lines: string[] }
interface Occurrence { name: string; cell: number; line: number; character: number }
interface Loc { uri: vscode.Uri; line: number; character: number }

class SpikeSerializer implements vscode.NotebookSerializer {
  deserializeNotebook(content: Uint8Array): vscode.NotebookData {
    const raw = new TextDecoder().decode(content);
    const cells = (raw.trim() ? JSON.parse(raw).cells : []) as { id: string; label: string; code: string }[];
    return new vscode.NotebookData(cells.map(c => {
      const d = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, c.code, 'python');
      d.metadata = { id: c.id, label: c.label };
      return d;
    }));
  }
  serializeNotebook(data: vscode.NotebookData): Uint8Array {
    const cells = data.cells.map(c => ({ id: c.metadata?.id ?? '', label: c.metadata?.label ?? '', code: c.value }));
    return new TextEncoder().encode(JSON.stringify({ cells }));
  }
}

export function registerDefinitionLookupTest(context: vscode.ExtensionContext): void {
  void vscode.commands.executeCommand('setContext', 'skena.devBuild', true);
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(SPIKE_NOTEBOOK, new SpikeSerializer()),
    vscode.commands.registerCommand('skena.definitionLookupTest', () => run()),
  );
}

function spikeDir(): string {
  const user = (() => { try { return os.userInfo().username; } catch { return 'user'; } })();
  const base = process.env.XDG_RUNTIME_DIR ? path.join(process.env.XDG_RUNTIME_DIR, 'skena') : path.join(os.tmpdir(), `skena-${user}`);
  const dir = path.join(base, 'definition-spike');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// - the canvas's code cells in run order (sections top to bottom, then y, then x); magic and shell
//   lines commented out, as the plan's joinCells does
async function canvasCells(canvasPath: string): Promise<Cell[]> {
  const canvas = await readCanvas(canvasPath);
  const nodes = canvas.nodes as (CodeNode & { type: string })[];
  const lanes = canvas.metadata?.sections ?? [];
  const ids = lanes.length === 0
    ? nodes.filter(n => n.type === 'code').sort((a, b) => a.y - b.y || a.x - b.x).map(n => n.id)
    : sortLanes(lanes).flatMap(l => memberCodeCellsInRunOrder(nodes, lanes, l.id));
  return ids.map(id => {
    const n = nodes.find(x => x.id === id) as CodeNode;
    const lines = (n.code ?? '').split(/\r\n|\r|\n/).map(l => (/^\s*(%|!)/.test(l) ? l.replace(/\S/, '#') : l));
    return { id, label: n.nodeLabel ?? id, lines };
  });
}

// - the last place `name` is written in the cells (not after a dot or a name character), at its last part
function lastOccurrence(cells: Cell[], name: string): Occurrence | null {
  const re = new RegExp(`(?<![\\w.])${name.replace(/\./g, '\\.')}(?!\\w)`, 'g');
  let found: Occurrence | null = null;
  cells.forEach((c, ci) => c.lines.forEach((text, li) => {
    for (const m of text.matchAll(re)) found = { name, cell: ci, line: li, character: (m.index ?? 0) + name.lastIndexOf('.') + 1 };
  }));
  return found;
}

// - the joined text: header, `pad` empty lines, each cell then one empty line; and each cell's first line
function joined(cells: Cell[], pad: number): { text: string; first: number[] } {
  const lines = [...HEADER, ...Array(pad).fill('')];
  const first: number[] = [];
  for (const c of cells) { first.push(lines.length); lines.push(...c.lines, ''); }
  return { text: lines.join('\n'), first };
}

async function ask(uri: vscode.Uri, pos: vscode.Position): Promise<{ firstMs: number; totalMs: number; attempts: number; locs: Loc[] }> {
  const t0 = Date.now();
  let firstMs = -1;
  for (let attempts = 1; ; attempts++) {
    const raw = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>('vscode.executeDefinitionProvider', uri, pos);
    if (firstMs < 0) firstMs = Date.now() - t0;
    const locs = (raw ?? []).map(l => l instanceof vscode.Location
      ? { uri: l.uri, line: l.range.start.line, character: l.range.start.character }
      : { uri: l.targetUri, line: (l.targetSelectionRange ?? l.targetRange).start.line, character: (l.targetSelectionRange ?? l.targetRange).start.character });
    if (locs.length > 0 || Date.now() - t0 > 10000) return { firstMs, totalMs: Date.now() - t0, attempts, locs };
    await new Promise(r => setTimeout(r, 250));
  }
}

async function fileLine(uri: vscode.Uri, line: number): Promise<string> {
  try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).split(/\r\n|\r|\n/)[line] ?? ''; } catch { return '?'; }
}

type Opened = {
  uri: (o: Occurrence) => vscode.Uri;
  pos: (o: Occurrence) => vscode.Position;
  // - a location as `E7:12  text`, or null when it is not in the canvas's cells
  cellOf: (l: Loc) => string | null;
  docs: () => { uri: vscode.Uri; dirty: boolean; untitled: boolean }[];
};

async function openKind(kind: string, cells: Cell[], version: 1 | 2, dir: string, previous: Opened | null): Promise<Opened> {
  if (kind === 'notebook') {
    const nbCells = [...(version === 2 ? [{ id: '', label: '(empty)', code: '' }] : []), ...cells.map(c => ({ id: c.id, label: c.label, code: c.lines.join('\n') }))];
    const file = path.join(dir, `joined-v${version}.${SPIKE_NOTEBOOK}`);
    fs.writeFileSync(file, JSON.stringify({ cells: nbCells }), { mode: 0o600 });
    const nb = await vscode.workspace.openNotebookDocument(vscode.Uri.file(file));
    const shift = version === 2 ? 1 : 0;
    return {
      uri: o => nb.cellAt(o.cell + shift).document.uri,
      pos: o => new vscode.Position(o.line, o.character),
      cellOf: l => {
        const c = nb.getCells().find(x => x.document.uri.toString() === l.uri.toString());
        if (!c) return null;
        return `${c.metadata?.label ?? '?'}:${l.line + 1}  ${c.document.lineAt(Math.min(l.line, c.document.lineCount - 1)).text.trim()}`;
      },
      docs: () => [{ uri: nb.uri, dirty: nb.isDirty, untitled: nb.isUntitled }, ...nb.getCells().map(c => ({ uri: c.document.uri, dirty: c.document.isDirty, untitled: c.document.isUntitled }))],
    };
  }
  const j = joined(cells, version === 2 ? 3 : 0);
  let doc: vscode.TextDocument;
  if (kind === 'untitled') {
    if (version === 1) {
      doc = await vscode.workspace.openTextDocument({ language: 'python', content: j.text });
    } else {
      doc = await vscode.workspace.openTextDocument(previous!.uri({ name: '', cell: 0, line: 0, character: 0 }));
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, new vscode.Position(HEADER.length, 0), '\n\n\n');
      await vscode.workspace.applyEdit(edit);
    }
  } else {
    const file = path.join(dir, `joined-v${version}.py`);
    fs.writeFileSync(file, j.text, { mode: 0o600 });
    doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  }
  const cellAtLine = (line: number) => {
    for (let i = cells.length - 1; i >= 0; i--) if (line >= j.first[i] && line < j.first[i] + cells[i].lines.length) return i;
    return -1;
  };
  return {
    uri: () => doc.uri,
    pos: o => new vscode.Position(j.first[o.cell] + o.line, o.character),
    cellOf: l => {
      if (l.uri.toString() !== doc.uri.toString()) return null;
      const i = cellAtLine(l.line);
      return i < 0 ? `(joined line ${l.line + 1}, between cells)` : `${cells[i].label}:${l.line - j.first[i] + 1}  ${doc.lineAt(l.line).text.trim()}`;
    },
    docs: () => [{ uri: doc.uri, dirty: doc.isDirty, untitled: doc.isUntitled }],
  };
}

async function run(): Promise<void> {
  const canvasPath = SkenaEditorProvider.activeCanvasPath();
  if (!canvasPath) { void vscode.window.showWarningMessage('Definition lookup test: focus a canvas tab first.'); return; }
  const input = await vscode.window.showInputBox({
    title: 'Definition lookup test',
    prompt: 'Names to look up, comma-separated; each is asked at its last place in the code cells (run order)',
    placeHolder: 'sharpe, run_walkforward, panel, np.linalg.norm',
  });
  if (!input) return;
  const picked = await vscode.window.showQuickPick(
    [{ label: 'untitled', picked: true }, { label: 'file', picked: true }, { label: 'notebook', picked: true }],
    { canPickMany: true, title: 'Document kinds to test' },
  );
  if (!picked || picked.length === 0) return;
  const out = vscode.window.createOutputChannel('Skena definition lookup test');
  const lines: string[] = [];
  const log = (s: string) => { lines.push(s); out.appendLine(s); };
  out.show(true);
  const dir = spikeDir();
  const cells = await canvasCells(canvasPath);
  const names = input.split(',').map(s => s.trim()).filter(Boolean);
  const ext = (id: string) => vscode.extensions.getExtension(id)?.packageJSON?.version ?? 'not installed';
  let interpreter = '?';
  try {
    const py = await vscode.extensions.getExtension('ms-python.python')?.activate();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    interpreter = py?.environments?.getActiveEnvironmentPath(folder)?.path ?? '?';
  } catch (e) { interpreter = `error ${String(e)}`; }
  log(`date ${new Date().toISOString()}  vscode ${vscode.version}  remote ${vscode.env.remoteName ?? 'none'}`);
  log(`pylance ${ext('ms-python.vscode-pylance')}  python ext ${ext('ms-python.python')}  jupyter ext ${ext('ms-toolsai.jupyter')}`);
  log(`workspace folders: ${(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath).join(', ') || 'none'}`);
  log(`interpreter (folder 1): ${interpreter}`);
  log(`files.hotExit: ${vscode.workspace.getConfiguration('files').get('hotExit')}`);
  log(`canvas ${canvasPath}: ${cells.length} code cells; folder ${dir}`);
  const occ = names.map(n => lastOccurrence(cells, n) ?? n);
  for (const o of occ) {
    if (typeof o === 'string') log(`  ${o}: not in the code cells`);
    else log(`  ${o.name}: asked at ${cells[o.cell].label}:${o.line + 1}:${o.character + 1}  ${cells[o.cell].lines[o.line].trim()}`);
  }
  for (const { label: kind } of picked) {
    log('');
    log(`== ${kind}`);
    let previous: Opened | null = null;
    const results: Record<string, string[]> = {};
    for (const version of [1, 2] as const) {
      let opened: Opened;
      const t0 = Date.now();
      try {
        opened = await openKind(kind, cells, version, dir, previous);
      } catch (e) { log(`  v${version}: could not open: ${String(e)}`); break; }
      log(`  v${version}: opened in ${Date.now() - t0} ms: ${opened.docs()[0].uri.toString()}`);
      for (const o of occ) {
        if (typeof o === 'string') continue;
        try {
          const r = await ask(opened.uri(o), opened.pos(o));
          const where = await Promise.all(r.locs.map(async l => opened.cellOf(l) ?? `${l.uri.scheme === 'file' ? l.uri.fsPath : l.uri.toString()}:${l.line + 1}:${l.character + 1}  ${(await fileLine(l.uri, l.line)).trim()}`));
          log(`    ${o.name}: first answer ${r.firstMs} ms, ${r.locs.length} result(s) after ${r.totalMs} ms in ${r.attempts} call(s)`);
          for (const w of where) log(`      -> ${w}`);
          if (version === 1) results[o.name] = where;
          else log(`      same as v1: ${JSON.stringify(where) === JSON.stringify(results[o.name]) ? 'yes' : 'NO'}`);
        } catch (e) { log(`    ${o.name}: error ${String(e)}`); }
      }
      previous = opened;
      await new Promise(r => setTimeout(r, 3000));
      for (const d of opened.docs()) {
        const diags = vscode.languages.getDiagnostics(d.uri);
        log(`    ${d.uri.toString()}  dirty ${d.dirty}  untitled ${d.untitled}  problems ${diags.length}${diags.length ? ` (first: ${diags[0].message})` : ''}`);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'report.txt'), lines.join('\n') + '\n', { mode: 0o600 });
  log('');
  log(`written to ${path.join(dir, 'report.txt')}`);
}
```

- [ ] **Step 2: Register it in development builds only**

In `src/extension/extension.ts` (line 16), find:

```ts
import { runIpc } from './run-ipc';
```

replace with:

```ts
import { runIpc } from './run-ipc';
import { registerDefinitionLookupTest } from './definitionLookupTest';
```

In `src/extension/extension.ts` (line 143), find:

```ts
  // - the relay's /export: the MCP tool canvas_export_html renders through this extension
```

replace with:

```ts
  // - TEMPORARY (go to definition plan, Task 1): the definition lookup test, in an Extension Development Host only
  if (context.extensionMode === vscode.ExtensionMode.Development) registerDefinitionLookupTest(context);

  // - the relay's /export: the MCP tool canvas_export_html renders through this extension
```

- [ ] **Step 3: Declare the command and the notebook type**

In `package.json` (lines 112-116), find:

```json
      {
        "command": "skena.exportHtml",
        "title": "Skena: Export canvas to HTML"
      }
    ],
```

replace with:

```json
      {
        "command": "skena.exportHtml",
        "title": "Skena: Export canvas to HTML"
      },
      {
        "command": "skena.definitionLookupTest",
        "title": "Skena: Definition lookup test (dev)"
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "skena.definitionLookupTest",
          "when": "skena.devBuild"
        }
      ]
    },
    "notebooks": [
      {
        "type": "skena-definition-spike",
        "displayName": "Skena definition lookup test",
        "selector": [
          {
            "filenamePattern": "*.skena-definition-spike"
          }
        ],
        "priority": "option"
      }
    ],
```

- [ ] **Step 4: Typecheck, parse package.json, build**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json parses')"`
Expected: `package.json parses`.

Run: `npm run build`
Expected: three `⚡ Done in …` lines, no `✘ [ERROR]`.

- [ ] **Step 5: Commit**

```bash
git add src/extension/definitionLookupTest.ts src/extension/extension.ts package.json
git commit -m "chore(dev): definition lookup test for the go to definition spike"
```

Write down the commit hash; Task 2 reverts it.

- [ ] **Step 6: The user runs the test**

The implementer stops here and hands these steps to the user. Expected answers are not given: they are what the test is for.

1. In VS Code on this repository, press Ctrl+F5 (launch config "Run Extension"; it builds and opens an Extension Development Host on `test/`).
2. In the Extension Development Host: File > Open Folder… `/home/quant0/projects/factors` (one folder). Wait until the status bar shows the Python interpreter; if it is not `.venv/bin/python`, run "Python: Select Interpreter" and pick `./.venv/bin/python`.
3. Open `research/review/factors-essentials.canvas` and click on the canvas so its tab has focus.
4. Ctrl+Shift+P, "Skena: Definition lookup test (dev)". Names: `sharpe, run_walkforward, REPO, CACHE, np.linalg.solve`. Kinds: leave all three ticked. On this canvas (FACT, read from the file on 2026-10-07, run order as Task 5 computes it) the test asks `sharpe` at E27:17 (imported from `factors.backtest.metrics`), `run_walkforward` at E12:22 (from `factors.walkforward.runner`), `REPO` at E12:2 (assigned only at E1:30), `CACHE` at E26:14 (assigned at E1:29 and again at E15:28) and `np.linalg.solve` at E17:34. (`qhs_weights` and `factors.score.ic_blends` are not in factors' source any more: `grep -rn "def qhs_weights" src` finds nothing.)
5. Wait for `written to …/report.txt` at the end of the output channel "Skena definition lookup test".
6. Look at View > Problems: does it list entries for `joined-v1.py`, `joined-v2.py`, `Untitled-1` or the notebook cells?
7. Close the Extension Development Host window. Did a dialog ask to save anything? Which name?
8. Press Ctrl+F5 again, File > Open Recent > factors. Is there an "Untitled-N" tab holding joined code?
9. Close any such tab without saving. Run the command again with only `file` and `notebook` ticked, then close the window. Did a dialog ask to save anything?

Report back: the content of `report.txt` from both runs (the path is printed at the end), and the answers to 6, 7, 8 and 9.

What the report allows the user to decide, per kind: whether the names from the venv (`sharpe`, `run_walkforward`, `np.linalg.solve`) come back as files; whether `REPO` comes back as `E1:30`; what `CACHE` gives (E1:29, E15:28, or both: the spec wants E15:28, and `targetsFromLocations` keeps the last one before the cursor whatever Pylance returns); whether v2 says `same as v1: yes` everywhere; the problem counts; save dialogs and restored tabs; and the timings (first answer, total until an answer). The user chooses the kind. Tasks 9 and 10 are written for "file".

---

### Task 2: Remove the spike

**Files:**
- Delete: `src/extension/definitionLookupTest.ts`
- Modify: `src/extension/extension.ts`, `package.json` (back to `771c94b`)

- [ ] **Step 1: Revert the Task 1 commit**

Run: `git revert --no-commit <Task 1 commit hash>`
Then: `git status --short`
Expected: `D  src/extension/definitionLookupTest.ts`, `M  src/extension/extension.ts`, `M  package.json` (plus the unstaged `.vscode` files).

If the user chose "notebook", keep the serializer: see "If the user chooses another kind" before committing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

- [ ] **Step 3: Write the result into the plan and commit**

Put the user's answers and the chosen kind under "Spike result" at the end of this file (replace the line `Not run yet.`), and set `RETRY_MS` and `WAIT_MS` in Task 10 Step 2 from the measured times: `WAIT_MS` a little above the longest "N result(s) after … ms" of a fresh file, `RETRY_MS` 250 unless the report shows a reason for another value.

The revert has already staged the three files; add the plan and commit:

```bash
git add docs/superpowers/plans/2026-10-07-go-to-definition.md
git commit -m "chore(dev): remove the definition lookup test; record its result"
```

---

### Task 3: Leader g: the key step and the editor key reader

**Files:**
- Modify: `src/webview/canvas/jumpLabels.ts:16-27`, `src/webview/canvas/jumpLabels.ts:97-104`
- Modify: `tests/jump-labels.mjs` (append at the end)
- Modify: `src/webview/canvas/editorJumpLabels.ts:141-145`, `:155`, `:251`, `:260-262`

`leaderStep` (`jumpLabels.ts:98`) reads one key of leader leader `h/j/k/l` for every Monaco editor and the canvas. It gets a fourth argument, `definition`: where it is true (code cells, Task 11), the leader then a plain `g` is `{ do: 'definition' }`. Where it is false (text notes, the chat input, the canvas), leader `g` is a `release` as today, so vim runs `;` and then `g`.

`installJumpLabels` (`editorJumpLabels.ts:144`) reads the keys at capture on the editor's container, before Monaco and monaco-vim, and its module-level window listener (`:31-34`) ends a held leader before later window listeners take the key; both call `leaderStep`. It gets an `onDefinition` option: when given, leader `g` stops the key and calls it. Nothing passes it until Task 11, so no editor changes behaviour in this task.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/jump-labels.mjs`, after one blank line:

```js
test('24. leader g is go to definition only where it is on (code cells), and only after one leader', () => {
  assert.deepEqual(leaderStep(1, key('g'), ';', true), { do: 'definition' });
  assert.deepEqual(leaderStep(1, key('g'), ';'), { do: 'release', held: 1 });
  assert.deepEqual(leaderStep(1, key('g'), ';', false), { do: 'release', held: 1 });
  assert.deepEqual(leaderStep(2, key('g'), ';', true), { do: 'release', held: 2 });
  assert.deepEqual(leaderStep(0, key('g'), ';', true), { do: 'none' });
  assert.deepEqual(leaderStep(1, key('G'), ';', true), { do: 'release', held: 1 });
  assert.deepEqual(leaderStep(1, key('g', { ctrl: true }), ';', true), { do: 'release', held: 1 });
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
 * - `definition`: leader + g where go to definition is on (code cells); stop the key and look it up
 */
export type LeaderStep =
  | { do: 'none' }
  | { do: 'hold'; next: 1 | 2 }
  | { do: 'show'; dir: JumpDir }
  | { do: 'release'; held: 1 | 2 }
  | { do: 'definition' };
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
 *   With `definition` (code cells) leader g is go to definition.
 */
export function leaderStep(state: LeaderState, k: JumpKey, leader: string, definition = false): LeaderStep {
  if (MODIFIER_KEYS.has(k.key)) return { do: 'none' };
  const plain = !k.ctrl && !k.meta && !k.alt;
  if (state === 0) return plain && k.key === leader ? { do: 'hold', next: 1 } : { do: 'none' };
  if (state === 1) {
    if (plain && k.key === leader) return { do: 'hold', next: 2 };
    return plain && definition && k.key === 'g' ? { do: 'definition' } : { do: 'release', held: 1 };
  }
  return plain && DIRS.has(k.key) ? { do: 'show', dir: k.key as JumpDir } : { do: 'release', held: 2 };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`
Expected: `# tests 24`, `# pass 24`, `# fail 0`.

- [ ] **Step 5: The editor key reader takes leader g when asked to**

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
 * before the host has sent them. With `onDefinition` (code cells) leader g calls it instead of
 * handing the leader to vim.
 */
export function installJumpLabels(editor: MonacoEditor.IStandaloneCodeEditor, vim: VimAdapterInstance, opts: { onDefinition?: () => void } = {}): void {
  const definition = opts.onDefinition !== undefined;
  const decorations = editor.createDecorationsCollection();
```

In `src/webview/canvas/editorJumpLabels.ts` (line 155), find:

```ts
      const step = leaderStep(held, keyOf(e), vimSettings().leader);
```

replace with:

```ts
      const step = leaderStep(held, keyOf(e), vimSettings().leader, definition);
```

In `src/webview/canvas/editorJumpLabels.ts` (line 251), find:

```ts
    const step = leaderStep(held, k, leader);
```

replace with:

```ts
    const step = leaderStep(held, k, leader, definition);
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
    if (step.do === 'definition') { opts.onDefinition?.(); return; }
    show(step.dir);
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Property 'fsPath' does not exist on type 'ResolvedUri'"`
Expected: nothing.

- [ ] **Step 7: Commit**

```bash
git add src/webview/canvas/jumpLabels.ts tests/jump-labels.mjs src/webview/canvas/editorJumpLabels.ts
git commit -m "feat(definition): leader g key step for code cells"
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

The joined text: header lines (Task 10 passes `# type: ignore` first, pyright's comment for ignoring a whole file; the spike reports whether problems still show), then each cell's lines followed by one empty line. Lines are split at CRLF, CR or LF, so a cell saved with CRLF maps line for line. An IPython magic or shell line (`%name`, `%%name`, `!cmd`, the rule of `magicRange` in `src/webview/canvas/codeCellView.ts:251`) is commented out by turning its first non-blank character into `#`, so no column moves; a cell under a cell magic whose body is not Python (`%%bash`, `%%html`, `%%writefile` …; Python bodies: `time`, `timeit`, `capture`, `prun`) is commented out whole. An empty cell is one empty line. Lines between cells and header lines map to no cell.

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

`targetsFromLocations`: a location inside the joined file goes to its cell, any other to its document. The spec says a name defined in several cells resolves to the latest earlier one in run order; Pylance on one joined file may return assignments after the cursor too (the spike shows what it returns), so of several locations inside the joined file only the last one at or before the cursor is kept; when none is before it, all are kept (a function defined in a later cell).

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

Written for the kind "file" (Task 1). The folder is the one the relay endpoint files already use (`ipcEndpoint.ts:24-29`, `ownDir` `:39-50`: `$XDG_RUNTIME_DIR/skena` when set, else `skena-<user>` in the OS temp dir, created owner-only, refused when it is another user's), with a `definition` folder under it. One file per canvas and text, `def-<hashPath(canvas)>-<sha1(text) 12 hex>.py`, written once: VS Code never holds an edited copy of it, so nothing asks to be saved and nothing goes to hot exit, and Pylance always reads the text the lookup was made for. The `-` in the name keeps it from being importable by another file. Past `KEEP` (4) files of one canvas, the oldest are deleted.

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
- Create: `src/extension/definition/pylanceDefinitions.ts`
- Create: `src/extension/definition/goToDefinition.ts`
- Modify: `src/extension/editor-provider.ts:90`, `:694`

Messages (checked: completion uses `complete`/`completeResult` with a `reqId`, `types.ts:389`, `:559`, and `App.tsx:209-214` re-sends results as window events):
- `goToDefinition` (webview → host): `reqId`, the cell, its live code (the host's copy of the canvas can be up to 500 ms behind, `scheduleSave` in `CanvasView.tsx:874-879`), the cursor's 1-based line and column, and the dotted name or `null`.
- `definitionResult` (host → webview): the places, empty when none. The webview acts on it (Task 11), so that an answer arriving after the user has typed on is dropped there.
- `showDefinitions` (webview → host): one file to open, or several places for a quick pick.
- `definitionGoto` (host → webview): the quick pick chose a cell.

`findDefinitions`: the canvas's code cells in run order with the asking cell's live code, joined under `# type: ignore` (pyright's ignore for a whole file), written by `writeJoinedFile`, and Pylance asked at the cursor's place. Places from Pylance end the lookup. Otherwise, when there is a dotted name, the cell's kernel (`resolveCellKernel`: an edge-bound kernel, else the section's, the same as Run) is asked if it has a live id and `isIdle`; no kernel, a kernel not started, a busy kernel, no answer in 3 s or `ok: false` all give no places.

`pylanceDefinitions`: `openTextDocument` (never shown), then `vscode.executeDefinitionProvider` at the position; a `Location` or a `LocationLink` (`targetSelectionRange`, else `targetRange`) becomes `{ uri, line, character }`. For a file not asked about before in this window an empty answer is asked again every `RETRY_MS` until `WAIT_MS` (Pylance may still be reading the new file); a file asked about before gets one call. Not installed: no places.

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

Create `src/extension/definition/pylanceDefinitions.ts` (set `RETRY_MS` and `WAIT_MS` from the spike's report, Task 2 Step 3):

```ts
/**
 * Pylance's definitions at a position of the joined file (vscode.executeDefinitionProvider). Pylance
 * may answer nothing while it starts or reads a file it has just been given, so for a file not asked
 * about before in this window an empty answer is asked again every RETRY_MS until WAIT_MS has passed;
 * a file asked about before gets one call. Without Pylance installed there is no answer.
 */
import * as vscode from 'vscode';
import type { DefLocation, DocPos } from '../../shared/goToDefinition';

/** - set from the spike's timings (Task 1) */
export const RETRY_MS = 250;
export const WAIT_MS = 2000;

const PYLANCE = 'ms-python.vscode-pylance';
// - the joined files asked about in this window
const asked = new Set<string>();

function toDefLocation(l: vscode.Location | vscode.LocationLink): DefLocation {
  if (l instanceof vscode.Location) return { uri: l.uri.toString(), line: l.range.start.line, character: l.range.start.character };
  const r = l.targetSelectionRange ?? l.targetRange;
  return { uri: l.targetUri.toString(), line: r.start.line, character: r.start.character };
}

/** - the file's URI string (to tell its own locations apart) and Pylance's locations for `pos` in it */
export async function pylanceDefinitions(file: string, pos: DocPos): Promise<{ uri: string; locs: DefLocation[] }> {
  const uri = vscode.Uri.file(file);
  if (!vscode.extensions.getExtension(PYLANCE)) return { uri: uri.toString(), locs: [] };
  const doc = await vscode.workspace.openTextDocument(uri);
  const at = new vscode.Position(pos.line, pos.character);
  const end = Date.now() + (asked.has(file) ? 0 : WAIT_MS);
  asked.add(file);
  for (;;) {
    const raw = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>('vscode.executeDefinitionProvider', doc.uri, at);
    const locs = (raw ?? []).map(toDefLocation);
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
import { pylanceDefinitions } from './pylanceDefinitions';

// - `# type: ignore` first: Pylance reports no problems for the joined file (pyright: a file-level ignore)
export const JOINED_HEADER = ['# type: ignore', '# - skena: the code cells of one canvas in run order, for go to definition'];

// - the canvas's Python code cells in run order, the asking cell with its live text
function canvasCells(canvas: CanvasData, cellId: string, liveCode: string): JoinCell[] {
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
    const { uri, locs } = await pylanceDefinitions(writeJoinedFile(canvasPath, joined.text), cursor);
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
git add src/shared/types.ts src/extension/definition/pylanceDefinitions.ts src/extension/definition/goToDefinition.ts src/extension/editor-provider.ts
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
- Keys: `installJumpLabels` (`editorJumpLabels.ts:144`) reads keys at capture on the editor's container, before Monaco and monaco-vim; a module-level window listener at capture (`:31-34`) ends a held leader before later window listeners take the key; the leader counts only in vim normal mode with nothing typed (`idleNormal`, `:47-49`). CodeNode calls it in `onEditorMount` (`CodeNode.tsx:369`); TextNode and ChatInput call it too and are not changed, so leader `g` keeps its meaning there.
- The jump's cursor move (`jump`, `:219-228`) also resets vim's remembered column (`lastHPos`) and last motion, so a `j` after it starts from the new column; it becomes `moveVimCursor`, used for the definition's cursor too.
- Opening a cell's editor: `skena:enterEdit` with the cell id (`CodeNode.tsx:470-477`; sent by Enter, `i` and new cells, `CanvasView.tsx:3116`, `:3911`). The editor restores the saved view state and the preview's scroll offset in `onEditorMount` (`:370-377`), then takes focus. A new monaco-vim editor starts in normal mode.
- Selecting a node as `h/j/k/l` do: `focusNodeById` (`CanvasView.tsx:1839-1845`): the `` ` `` register (`recordPreviousPosition`), `lastFocusedNodeId`, selection, `skena:focusNode`, and the smallest pan (`revealNode`). A node in a folded section is hidden and not rendered (`hiddenByFold`, `:915-922`); `goToSection` unfolds through `foldLaneRef.current(id)` (`:1937`), and a new cell gets `skena:enterEdit` 80 ms after it is added so that it has mounted (`:3907-3912`).
- No React Flow `onlyRenderVisibleElements`: every node that is not hidden is mounted.

The note: `no definition found for <name>` (the dotted name, else the word), or `no name under the cursor` when the cursor is on no name (then nothing is asked). It sits over the editor's bottom right, above the vim status line, positioned absolutely so the cell keeps its size, and goes away on the next key in the cell and when the editor closes.

An answer is dropped when a key was pressed in the cell after the request, or the cell lost focus: otherwise keys typed while waiting (`dd`, say) would land in the other cell's editor once it opened. The key listener sits on the editor's container at capture, added before the jump labels' listener there: listeners on one element run in the order they were added, and `stopPropagation` does not stop the others, so it sees every key, a leader the jump labels stop included, and it runs before leader `g` can show a note. A key counts only if its `timeStamp` is after the request was made.

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
 * CanvasView), or goes back to the host to open a file or show a quick pick (showDefinitions). An
 * answer that arrives after another key in the cell or after the cell lost focus is dropped: the user
 * has moved on, and keys typed meanwhile must not land in another cell.
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
  if (!at) { note('no name under the cursor'); return; }
  const reqId = `def-${++counter}`;
  pending.set(cellId, { reqId, name: at.dotted ?? at.word, since: performance.now(), stale: false, note });
  vscodePostMessage({ type: 'goToDefinition', reqId, cellNodeId: cellId, code: model.getValue(), line: pos.lineNumber, col: pos.column, name: at.dotted });
}

/** - a key in the cell, or the cell losing focus, at `when` (an event's timeStamp): a lookup asked before it is dropped */
export function dropDefinition(cellId: string, when: number): void {
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
import { dropDefinition, requestDefinition } from './cellDefinition';
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
    //   on the same container at capture, so it runs first: a leader they stop still counts, and the
    //   note leader g shows at once (no name under the cursor) is not cleared by that same key
    const container = editorInstance.getContainerDomNode();
    const onAnyKey = (e: KeyboardEvent) => { setNote(null); dropDefinition(id, e.timeStamp); };
    container.addEventListener('keydown', onAnyKey, { capture: true });
    editorInstance.onDidDispose(() => container.removeEventListener('keydown', onAnyKey, { capture: true }));
    installJumpLabels(editorInstance, vimMode, { onDefinition: () => requestDefinition(editorInstance, id, setNote) });
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
      dropDefinition(id, performance.now());
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

### Task 12: Manual checks (the user runs these)

**Files:** none. The implementer reports this task as not run.

Ctrl+F5, open the factors folder in the Extension Development Host (as in Task 1), `.venv` interpreter, open `research/review/factors-essentials.canvas`. Settings at their defaults (leader `;`). A kernel bound to the canvas's sections and started (run E1 once). On 2026-10-07 the file has S1 to S5 folded (FACT, read from the file; E1 to E8 are in S1, E9 to E14 in S3, E15 to E27 in S5, E17 in S6): unfold S1, S3 and S5 first.

Pylance:
- [ ] Open E12 (`Enter`), `Esc` to normal mode, put the cursor on `REPO` in line 2, `;g`: E1 is selected, the view pans by the smallest move that shows it, E1's editor opens with the cursor on `REPO` at line 30, in normal mode (the status line is empty). `Esc` out of the editor, then `` ` ` ``: back to E12.
- [ ] In E26, cursor on `CACHE` in line 14, `;g`: E15 opens at line 28 (the later of its two assignments before E26).
- [ ] In E27, cursor on `sharpe` in `sharpe(p, 365)`, `;g`: `src/factors/backtest/metrics.py` opens in the group to the right of the canvas, cursor on `sharpe` at line 5; the canvas stays visible.
- [ ] In E17, cursor on `solve` of `np.linalg.solve`, `;g`: numpy's `linalg/_linalg.py` (or its stub, if Pylance prefers it) opens beside the canvas at `def solve`. Cursor on `linalg`: numpy's `linalg/__init__.py` (or its stub).
- [ ] In E3 (before E15 in run order), cursor on `CACHE` in line 6, `;g`: E1 opens at line 29.
- [ ] In a cell, write `aa = 1` on one line and `print(aa)` two lines below, `Esc`, cursor on the second `aa`, `;g`: the cursor moves up to the first `aa` in the same editor, which stays open in normal mode.
- [ ] A function defined in two cells (paste the same `def` into two cells, call it in a third): a quick pick titled "Go to definition" lists `E…:line  def …` entries if Pylance gives both; picking one selects that cell and opens it at the line. `Esc` in the quick pick does nothing.
- [ ] Cursor on a blank or on `=`: `;g` shows `no name under the cursor` at the editor's bottom right; the next key removes it.
- [ ] Cursor on a name defined nowhere (type `undefined_thing` in a cell): `;g` shows `no definition found for undefined_thing`; the next key removes it.

Kernel. With Pylance on, the kernel is asked only when Pylance has nothing; to check the kernel's answers, disable Pylance for the workspace (Extensions view, Pylance, Disable (Workspace)) and reload the window. Re-enable it at the end.
- [ ] In a new cell write `def helper_k(x):` / `    return x` and Run it. In another cell write `helper_k(1)`, `;g` on `helper_k`: the defining cell is selected and its editor opens on `helper_k` in the `def` line (the kernel's copy of the cell matched by its text).
- [ ] Add a comment line above the `def` in the defining cell without running it, then `;g` again: it still lands on the `def` line, now one line lower (matched by the function's lines).
- [ ] Run E1 (it imports `sharpe` at line 17), then `;g` on `sharpe` in E27 line 17: `src/factors/backtest/metrics.py` opens beside the canvas at line 5.
- [ ] `;g` on `len`: `no definition found for len`.
- [ ] Start a cell with `import time; time.sleep(20)` and during it `;g` on `helper_k`: the note appears at once (the busy kernel is not asked); when the sleep ends no output appears in any other cell.
- [ ] Shut the kernel down (kernel node menu): `;g` on `helper_k` gives the note.

Keys and other editors:
- [ ] In a text note in normal mode, `fa`, then `;` then `g`: vim's `;` (repeat find) then `g` as before; no note, no lookup. The same in the chat input.
- [ ] In a code cell in insert mode, typing `;g` inserts `;g`.
- [ ] `;;l` jump labels still work in a code cell.
- [ ] `;g` then immediately `j` before the answer arrives: the cursor moves down in the cell; no jump happens afterwards.
- [ ] Fold S1 (it holds E1), keep S3 open, then in E12 `;g` on `REPO`: S1 unfolds, E1 is selected and its editor opens at line 30.

Files and saving:
- [ ] After several lookups, `ls $XDG_RUNTIME_DIR/skena/definition/`: at most 4 `def-*.py` files per canvas. View > Problems lists nothing from them.
- [ ] Close the window: nothing asks to be saved.

If a check fails, write down the cell label, the keys pressed and what was seen.

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| Leader then `g` in a code cell's editor, vim normal mode; `;g` by default | `leaderStep` `definition` (Task 3, test 24); `installJumpLabels` `onDefinition` (Task 3), passed by CodeNode (Task 11); normal mode through `idleNormal` |
| The name: identifier under the cursor with the dotted names before it | `dottedNameAt` (Task 4, tests 2-5) |
| Only code cells; text notes and chat unchanged; leader + anything else as today | `definition` passed only by CodeNode (Task 11); test 24 lines 2-3 |
| Keys read the way jump labels read them | the same capture listener and `leaderStep` (Task 3 Step 5) |
| Pylance on the cells joined in run order, section by section | `codeCellsInRunOrder`, `joinCells` (Task 5, tests 6-8); joined file (Task 9); `findDefinitions` (Task 10) |
| `vscode.executeDefinitionProvider` at the cursor's place, result mapped back to a cell and line | `toJoined`, `pylanceDefinitions`, `targetsFromLocations` (Tasks 5, 6, 10; tests 8-10) |
| Imports through the workspace's interpreter | the spike (Task 1) checks it for the chosen kind; see "If the user chooses another kind" |
| Several cells define a name: the latest earlier one in run order | `targetsFromLocations` keeps the last location at or before the cursor (test 9) |
| Kernel only when Pylance returns nothing, only if running and idle, never queued | `findDefinitions` order; `isIdle` (Task 8); timeout 3 s |
| Identifiers and dots only; `getsourcefile`/`getsourcelines`; decorators unwrapped | `isDottedName` + `definitionExpression` throws (Task 7 test 8); the Python lookup (tests 1-5; real kernel) |
| A cell's temporary file matched to a cell by source text | `targetsFromKernel` (Task 6 tests 11-13) |
| Silent: no output, no execution count, no history | `buildSilentEvaluateRequest` (Task 8); FACT real kernel: iopub only busy/idle, count unchanged, `len(In)` unchanged |
| Cell target: selected as `h/j/k/l` (smallest pan, `` ` `` register), editor opens, cursor at line and column, normal mode | `skena:goToCell` → `focusNodeById` + `skena:enterEdit` with a cursor (Task 11) |
| File target: the group beside the canvas, created if none; cursor and reveal | `showTextDocument` with `ViewColumn.Beside` and `selection` (Task 10) |
| Several answers: quick pick `file:line` or `E7:line` with the line's text | `pickEntry` (test 15), `showDefinitions` (Task 10) |
| No answer: `no definition found for <name>`, gone on the next key | `cellDefinition.ts` + CodeNode note (Task 11) |
| Unknowns settled by a spike the user runs | Task 1 |
| Tests: dotted name, joining and mapping both ways (CRLF, empty cells), choosing among results, kernel temp file → cell, file → file, leader g, quick pick entries; the snippet against a real Python | `tests/go-to-definition.mjs` (15), `tests/jump-labels.mjs` (24), `tests/kernel-definition.mjs` (8), `tests/joined-file.mjs` (2), `tests/jupyter-protocol.mjs` (+2) |
| Out of scope: `gd`, peek, references, hover, text notes, markdown code blocks, other notebooks, other languages | none of these are implemented |

## Points the spec does not settle, or that differ from it

Each is in the code as described; the user may want another choice.
1. **Which document kind** Pylance is asked about: the spike (Task 1) decides; the tasks are written for a file per canvas and text in the per-user temporary folder.
2. **No name under the cursor** (a blank, an operator, a number): the note says `no name under the cursor` and nothing is asked. The spec only names the `no definition found` note.
3. **A chain through a call or subscript** (`df.groupby(k).mean`): Pylance is still asked at the cursor; the kernel is not (it would have to evaluate the call). The note then names the word (`mean`).
4. **A value stands for its class** in the kernel lookup (`sq = Shape()`, `sq` goes to `class Shape`). The spec does not say what an instance resolves to; without this, `sq` would give the note.
5. **The last attribute is read without running it** (`inspect.getattr_static`), so `obj.prop` goes to the property's getter; the spec accepts running a property. Attributes before the last are read normally (`a.prop.x` runs `prop`).
6. **A kernel answer that matches no cell** (the function's lines were changed since it ran) gives the note; a function made by `exec` has no source for `inspect` and gives the note too. When the kernel names a real file on disk, that file opens.
7. **An answer that arrives after another key in the cell, or after the cell lost focus, is dropped.** Without this, keys typed while waiting would land in the other cell's editor.
8. **A cell in a folded section** is reached by unfolding its section first.
9. **Waiting for Pylance**: for a joined file not asked about before in this window, an empty answer is asked again every `RETRY_MS` for up to `WAIT_MS` (values from the spike); otherwise one call. A name only the kernel knows therefore waits up to `WAIT_MS` before the kernel is asked, once per new text.
10. **Magic and shell lines** are commented out in the joined text; a cell under a non-Python cell magic is commented out whole. Names defined by them (`x = !ls`, `%time x = 1`) are not seen by Pylance.
11. **The joined file shows no problems** because its first line is `# type: ignore`; the spike reports whether that holds.
12. **Multi-root windows** are not covered by the spike: pyright gives a file outside every folder its `<default>` workspace there, so imports may not resolve.
13. **No indicator while a lookup runs.**

## Spike result

Not run yet.

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
