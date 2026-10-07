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
