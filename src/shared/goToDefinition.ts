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
