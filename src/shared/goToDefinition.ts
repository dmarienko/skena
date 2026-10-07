/**
 * Go to definition from a code cell, the pure part: the dotted name under the cursor, the canvas's
 * code cells joined into one Python document in run order with positions mapped both ways, the
 * answers of Pylance and of the kernel as places to go, and their quick pick entries. Bundled into
 * the host and the webview; no vscode import.
 */
import { memberCodeCellsInRunOrder, sortLanes, type LaneNodeGeom, type SectionLane } from './sectionLanes';

// - one part of a Python name: a letter or _, then letters, digits, marks and connectors
const PART = String.raw`[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*`;
const DOTTED = new RegExp(`^${PART}(?:\\.${PART})*$`, 'u');
const NAME_CHAR = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]/u;
// - Python 3.12's keyword.kwlist; the soft keywords (match, case, type, _) are names
const KEYWORDS: ReadonlySet<string> = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/** - names and dots only, no part a keyword: the one kind of text the kernel is ever asked to evaluate */
export function isDottedName(s: string): boolean {
  return DOTTED.test(s) && !s.split('.').some(p => KEYWORDS.has(p));
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

/**
 * - where Python's tokenizer stands at the end of a line: the closers of the open brackets (innermost
 *   last), the quotes of the string it is in, and whether a backslash outside a string carries the
 *   line on
 */
interface LexState { closers: string[]; quote: string | null; joined: boolean }
const CLEAN: LexState = { closers: [], quote: null, joined: false };
const CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * - the state after `line`. A string prefix (r, b, f, u, t and their pairs) changes nothing here: in
 *   every kind a backslash keeps the next character, quote or line end, inside the string. An f-string's
 *   braces are not looked into. A one-line string still open at the line's end ends there, as the
 *   tokenizer ends it, unless a backslash carries it on; a closer with nothing open is passed over.
 */
function lexLine(line: string, from: LexState): LexState {
  const closers = [...from.closers];
  let quote = from.quote;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === '\\') { i += 2; continue; }
      if (line.startsWith(quote, i)) { i += quote.length; quote = null; continue; }
      i++;
      continue;
    }
    if (ch === '#') break;
    if (ch === '\\' && i === line.length - 1) return { closers, quote, joined: true };
    if (ch === '"' || ch === "'") {
      quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      i += quote.length;
      continue;
    }
    if (ch in CLOSER) closers.push(CLOSER[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') closers.pop();
    i++;
  }
  // - i past the end: the line's last character was a backslash inside the string
  if (quote !== null && quote.length === 1 && i === line.length) quote = null;
  return { closers, quote, joined: false };
}

// - the cell's lines as the join writes them, and the line that closes what the last one leaves open
function cellLines(code: string): { lines: string[]; closers: string } {
  const lines = code.split(/\r\n|\r|\n/);
  const first = lines.find(l => l.trim() !== '');
  const magic = first !== undefined ? CELL_MAGIC.exec(first) : null;
  if (magic && !PYTHON_CELL_MAGICS.has(magic[1])) return { lines: lines.map(commentOut), closers: '' };
  let st = CLEAN;
  const out = lines.map(l => {
    // - a magic only where a statement starts: `% name` inside brackets is the modulo of a name
    const atStart = st.closers.length === 0 && st.quote === null && !st.joined;
    const line = atStart && MAGIC.test(l) ? commentOut(l) : l;
    st = lexLine(line, st);
    return line;
  });
  return { lines: out, closers: (st.quote ?? '') + [...st.closers].reverse().join('') };
}

/**
 * The cells as one Python document: the `header` lines, then each cell's lines (split at CRLF, CR or
 * LF; magic and shell lines that start a statement commented out, a whole cell under a non-Python cell
 * magic too) followed by one line that closes the string and the brackets the cell leaves open (empty
 * when it leaves none), so a half-written cell does not swallow the cells after it; joined with LF. An
 * empty cell is one empty line.
 */
export function joinCells(cells: readonly JoinCell[], header: readonly string[] = []): JoinedCells {
  const lines: string[] = [...header];
  const spans: JoinedCells['spans'] = [];
  for (const c of cells) {
    const own = cellLines(c.code);
    spans.push({ id: c.id, first: lines.length, lines: own.lines.length });
    lines.push(...own.lines, own.closers);
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
 * document only one is kept, the definition a run in order reaches: the last one on a line before the
 * cursor's; when there is none, the last one on the cursor's line at or before it (in `df = df.copy()`
 * the right-hand df reaches an earlier df when there is one, else this line). When none starts before
 * the cursor, all are kept. Repeats are dropped.
 */
export function targetsFromLocations(locs: readonly DefLocation[], joinedUri: string, j: JoinedCells, cursor: DocPos): DefinitionTarget[] {
  const inDoc = locs.filter(l => l.uri === joinedUri);
  const earlier = inDoc.filter(l => l.line < cursor.line);
  const reaching = earlier.length > 0 ? earlier : inDoc.filter(l => atOrBefore(l, cursor));
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
 * innermost workspace folder that holds it, else with ~ for the home folder, else in full. `text` is
 * the target line's text.
 */
export function pickEntry(t: DefinitionTarget, text: string, labelOf: (cellId: string) => string, filePath: (uri: string) => string, roots: readonly string[], home: string): PickEntry {
  const description = text.trim();
  if (t.kind === 'cell') return { label: `${labelOf(t.cellId)}:${t.line}`, description };
  const path = filePath(t.uri);
  const root = roots
    .filter(r => path.startsWith(r.endsWith('/') ? r : `${r}/`))
    .reduce<string | undefined>((a, r) => (a === undefined || r.replace(/\/+$/, '').length > a.replace(/\/+$/, '').length ? r : a), undefined);
  const shown = root !== undefined
    ? path.slice(root.length).replace(/^\/+/, '')
    : home !== '' && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
  return { label: `${shown}:${t.line}`, description };
}
