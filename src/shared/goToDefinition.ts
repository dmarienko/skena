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
