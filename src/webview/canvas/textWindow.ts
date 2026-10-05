/**
 * Where a long markdown text can be cut so that its start, rendered alone, renders the way it does
 * inside the whole text. A cut is the start of a line that begins a new top-level block: the first
 * line after a blank line that is neither indented (a list item's or a footnote's continuation,
 * indented code) nor a list item, or an ATX heading line. No cut falls inside a fenced code block,
 * a $$ math block (remark-math's reading, `\[ … \]` included), a %% Typst block, an html comment
 * or an html element opened at the start of a line, or a table.
 *
 * Only the start of the text is ever rendered, so the state at a cut is always "nothing open" and a
 * scan can start there without reading what came before.
 */

const FENCE_OPEN  = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
// - remark-math: `$$` plus a rest with no `$` opens a block; only a line of `$$` (at least as many)
//   closes it, so `$$x` … `y$$` stays open past `y$$`. `$$x$$` on one line is inline math.
const MATH_OPEN   = /^[ \t]*(\${2,})([^$]*)$/;
const MATH_CLOSE  = /^[ \t]*(\${2,})[ \t]*$/;
const HEADING     = /^#{1,6}(?:[ \t]|$)/;
const LIST_ITEM   = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const HTML_OPEN   = /^[ \t]{0,3}<([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>]|$)/;
const COMMENT     = /^[ \t]{0,3}<!--/;
const VOID_TAGS   = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// - a footnote definition ([^1]: …), and a link reference definition ([x]: url "title")
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]\n]+\]:/;
const LINK_DEF     = /^ {0,3}\[[^\]\n^][^\]\n]*\]:[ \t]*(?:<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/;
const isDefinition = (line: string): boolean => FOOTNOTE_DEF.test(line) || LINK_DEF.test(line);

interface Open {
  fence:   { char: string; size: number } | null;
  math:    number;          // - length of the $$ run that opened a math block, 0 when none is open
  typst:   boolean;
  comment: boolean;
  html:    { tag: string; depth: number } | null;
}

const isBlank = (line: string): boolean => line.trim() === '';

const nothingOpen = (s: Open): boolean => !s.fence && !s.math && !s.typst && !s.comment && !s.html;

// - normalizeMathDelimiters turns every `\[` and `\]` outside inline code into a line of `$$`, so
//   for the math reading the line is split there
function mathLines(line: string): string[] {
  if (!line.includes('\\[') && !line.includes('\\]')) return [line];
  const out: string[] = [];
  let last = 0;
  for (const m of line.matchAll(/`[^`]*`|\\[[\]]/g)) {
    if (m[0][0] === '`') continue;
    out.push(line.slice(last, m.index), '$$');
    last = (m.index ?? 0) + 2;
  }
  out.push(line.slice(last));
  return out;
}

// - opening minus closing tags of this name on one line; a self-closing tag counts as neither
function tagBalance(line: string, tag: string): number {
  let depth = 0;
  for (const m of line.matchAll(new RegExp(`<(/?)${tag}(?=[\\s/>]|$)[^>]*?(/?)>`, 'gi'))) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
  }
  // - an opening tag whose `>` is on a later line
  if (new RegExp(`<${tag}(?=[\\s/]|$)[^>]*$`, 'i').test(line)) depth++;
  return depth;
}

function feed(s: Open, line: string): void {
  if (s.fence) {
    const m = FENCE_CLOSE.exec(line);
    if (m && m[1][0] === s.fence.char && m[1].length >= s.fence.size) s.fence = null;
    return;
  }
  if (s.typst)   { if (line.trim() === '%%') s.typst = false; return; }
  if (s.comment) { if (line.includes('-->')) s.comment = false; return; }
  if (s.html) {
    s.html.depth += tagBalance(line, s.html.tag);
    if (s.html.depth <= 0) s.html = null;
    return;
  }
  if (!s.math) {
    const f = FENCE_OPEN.exec(line);
    // - a backtick fence's info string has no backtick: ```x``` on one line is inline code
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) { s.fence = { char: f[1][0], size: f[1].length }; return; }
    if (line.trim() === '%%') { s.typst = true; return; }
    if (COMMENT.test(line)) {
      if (!line.slice(line.indexOf('<!--') + 4).includes('-->')) s.comment = true;
      return;
    }
    const h = HTML_OPEN.exec(line);
    if (h && !VOID_TAGS.has(h[1].toLowerCase())) {
      const depth = tagBalance(line, h[1]);
      if (depth > 0) s.html = { tag: h[1], depth };
      return;
    }
  }
  for (const v of mathLines(line)) {
    if (s.math) {
      const m = MATH_CLOSE.exec(v);
      if (m && m[1].length >= s.math) s.math = 0;
    } else {
      const m = MATH_OPEN.exec(v);
      if (m) s.math = m[1].length;
    }
  }
}

// - can a cut go right before `line`, given the line before it? (nothing open at this point)
function startsBlock(line: string, prev: string): boolean {
  if (isBlank(line)) return false;
  // - a heading ends a paragraph or a list without a blank line; after a table row it is left alone
  if (HEADING.test(line)) return !prev.includes('|');
  if (!isBlank(prev)) return false;
  return !/^[ \t]/.test(line) && !LIST_ITEM.test(line);
}

// - calls `visit` for each line from `from` on with the line's start offset and whether nothing is
//   open before it; stops when `visit` returns true
function scanLines(text: string, from: number, visit: (start: number, line: string, open: boolean) => boolean): void {
  const s: Open = { fence: null, math: 0, typst: false, comment: false, html: null };
  let pos = from;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd);
    if (visit(pos, line, nothingOpen(s))) return;
    feed(s, line);
    pos = lineEnd + 1;
  }
}

/**
 * The end of the part of `text` that starts at `from` (0, or an end this function returned): the
 * first cut at or past `from + budget` characters, or the end of the text when there is none.
 */
export function chunkEnd(text: string, from: number, budget: number): number {
  const target = from + Math.max(1, budget);
  if (target >= text.length) return text.length;
  let end = text.length;
  let prev: string | null = null;
  scanLines(text, from, (start, line, open) => {
    if (start >= target && open && prev !== null && startsBlock(line, prev)) { end = start; return true; }
    prev = line;
    return false;
  });
  return end;
}

/**
 * The footnote and link reference definitions in `text` after `from` (a cut), each with its
 * continuation lines, separated by blank lines; '' when there are none. Appended to the rendered
 * start of a text, they let the references in it render as they do in the whole text.
 */
export function definitionsAfter(text: string, from: number): string {
  if (from >= text.length) return '';
  const probe = /^ {0,3}\[[^\]\n]+\]:/gm;
  probe.lastIndex = from;
  if (!probe.test(text)) return '';
  const defs: string[][] = [];
  let current: string[] | null = null;   // - the footnote definition whose continuation lines may follow
  let blanks = 0;                         // - blank lines since its last line
  scanLines(text, from, (_start, line, open) => {
    if (current) {
      if (isBlank(line)) { blanks++; return false; }
      const indented = /^(?: {4}|\t)/.test(line);
      // - a non-indented line straight after the definition's text continues its paragraph
      const lazy = blanks === 0 && !isDefinition(line) && !HEADING.test(line) && !FENCE_OPEN.test(line) && !MATH_OPEN.test(line);
      if (indented || lazy) {
        for (; blanks > 0; blanks--) current.push('');
        current.push(line);
        return false;
      }
      current = null;
      blanks = 0;
    }
    if (open && isDefinition(line)) {
      const def = [line];
      defs.push(def);
      if (FOOTNOTE_DEF.test(line)) current = def;
    }
    return false;
  });
  return defs.map(d => d.join('\n')).join('\n\n');
}
