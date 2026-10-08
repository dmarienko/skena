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
/** - the host's answer to a find references request; `error` when the lookup failed (failureReason) */
export interface ReferencesAnswer { targets: ReferenceTarget[]; cells: PeekCell[]; files: PeekFile[]; error?: string }

/** - a failed lookup as the cell's note gives it after `references failed: `: the first line of its message, at most 60 characters */
export function failureReason(err: unknown): string {
  const first = (err instanceof Error ? err.message : String(err)).trim().split('\n')[0].trim();
  if (first === '') return 'unknown error';
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

/**
 * - `answer` without the reference the cursor is on (cell `cellId`, 1-based `line`/`col` of the
 *   request): the place the lookup was asked from is not one to go to
 */
export function otherReferences(answer: ReferencesAnswer, cellId: string, line: number, col: number): ReferencesAnswer {
  const at = (t: ReferenceTarget) => t.kind === 'cell' && t.cellId === cellId && t.line === line && t.endLine === line && t.col <= col && col < t.endCol;
  return { ...answer, targets: answer.targets.filter(t => !at(t)) };
}

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
  /**
   * - model URI -> the cell or file it stands for; `cols`, for a file whose text did not come: the
   *   column of the reference on each line (its model shows a whole line there, from column 1)
   */
  owners:    Record<string, { kind: 'cell'; cellId: string } | { kind: 'file'; uri: string; cols?: Record<number, number> }>;
}

/** - the line a file's model shows at each reference when the file's text did not come (unreadable, gone) */
export function unreadLine(uri: string): string {
  return `(could not read ${uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri})`;
}

/**
 * The peek for `answer`, asked in `cellId`, whose editor's model is `editorUri`: its references stay
 * on that model (the peek then starts on the reference under the cursor, referencesModel.js
 * nearestReference); every other cell gets a copy at peekCellUri; a file keeps its own URI, and its
 * text is its model. A file whose text did not come gets a model that holds unreadLine on each line
 * with a reference and is empty elsewhere, each reference being that whole line: without a model the
 * peek's list shows the place one line and column off and its preview keeps the place shown before.
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
  const read = new Set(answer.files.map(f => f.uri));
  // - each file whose text did not come: line -> the column of its first reference there
  const unread = new Map<string, Map<number, number>>();
  for (const t of answer.targets) {
    if (t.kind !== 'file' || read.has(t.uri)) continue;
    const lines = unread.get(t.uri) ?? new Map<number, number>();
    if (!lines.has(t.line)) lines.set(t.line, t.col);
    unread.set(t.uri, lines);
  }
  for (const [uri, lines] of unread) {
    const text = unreadLine(uri);
    plan.models.push({ uri, text: Array.from({ length: Math.max(...lines.keys()) }, (_, i) => (lines.has(i + 1) ? text : '')).join('\n'), language: 'plaintext' });
    plan.owners[uri] = { kind: 'file', uri, cols: Object.fromEntries(lines) };
  }
  for (const t of answer.targets) {
    const uri = t.kind === 'file' ? t.uri : cellUri.get(t.cellId);
    if (uri === undefined) continue;
    if (t.kind === 'file' && unread.has(uri)) {
      plan.locations.push({ uri, range: { startLineNumber: t.line, startColumn: 1, endLineNumber: t.line, endColumn: unreadLine(uri).length + 1 } });
      continue;
    }
    if (t.kind === 'file') plan.owners[uri] = { kind: 'file', uri };
    plan.locations.push({ uri, range: { startLineNumber: t.line, startColumn: t.col, endLineNumber: t.endLine, endColumn: t.endCol } });
  }
  return plan;
}

/** - where a reference opened in the peek (a model URI and a 1-based position) goes; null for a URI the peek did not get from here */
export function openedTarget(plan: PeekPlan, uri: string, line: number, col: number): DefinitionTarget | null {
  const owner = plan.owners[uri];
  if (!owner) return null;
  return owner.kind === 'cell' ? { kind: 'cell', cellId: owner.cellId, line, col } : { kind: 'file', uri: owner.uri, line, col: owner.cols?.[line] ?? col };
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
