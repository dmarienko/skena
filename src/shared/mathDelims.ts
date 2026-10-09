/**
Normalize LaTeX-style math delimiters to the `$` / `$$` form that remark-math understands, so KaTeX
renders math written as `\(…\)` (inline) and `\[…\]` (display) — common in exported papers. Fenced
```code``` blocks and `inline code` are masked first so literal brackets there are never mangled.
*/

const NUL = String.fromCharCode(0);   // - sentinel; cannot occur in markdown prose

export function normalizeMathDelimiters(md: string): string {
  if (!md.includes('\\(') && !md.includes('\\[')) return md;

  // - mask code spans so the delimiter rewrite can't touch literal brackets inside code
  const codeSpans: string[] = [];
  const mask = (m: string): string => `${NUL}${codeSpans.push(m) - 1}${NUL}`;
  const masked = md
    .replace(/```[\s\S]*?```/g, mask)   // - fenced code blocks
    .replace(/`[^`\n]*`/g, mask);       // - inline code

  const converted = masked
    // - display: put $$ on its OWN line. remark-math treats `$$…` at line start as BLOCK math whose
    //   rest-of-line is discarded meta and which only closes on a line that is just `$$`; a
    //   multi-line \[…\] (content on the same line as the fence) would otherwise never close and
    //   swallow the rest of the document.
    .replace(/\\\[/g, () => '\n$$\n')   // - display open  \[
    .replace(/\\\]/g, () => '\n$$\n')   // - display close \]
    .replace(/\\\(/g, () => '$')        // - inline open   \(  → $
    .replace(/\\\)/g, () => '$');       // - inline close  \)  → $

  return converted.replace(new RegExp(`${NUL}(\\d+)${NUL}`, 'g'), (_, i) => codeSpans[Number(i)]);
}

// - `s`: a line split from a CRLF text ends in \r, which `.` would not match
const FENCE_OPEN  = /^[ \t]*(`{3,}|~{3,})(.*)$/s;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})\s*$/;
// - remark-math opens a $$ block on a line of up to 3 spaces, a run of two or more `$` and a rest with
//   no `$` (the rest is dropped), and closes it only on a line that is a run at least as long
const MATH_OPEN   = /^( {0,3})(\${2,})([^$]*)$/;
const LEADING_RUN = /^( {0,3})(\$+)(.*)$/s;
const HEADING     = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const LIST_ITEM   = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const QUOTE       = /^ {0,3}>/;
const BREAK       = /^ {0,3}([-*_])(?:[ \t]*\1){2,}\s*$/;
const INDENTED    = /^(?: {4}|\t)/;
const SETEXT      = /^ {0,3}(?:=+|-+)\s*$/;

const isBlank = (line: string): boolean => line.trim() === '';

function fenceOpen(line: string): RegExpExecArray | null {
  const f = FENCE_OPEN.exec(line);
  // - a backtick fence's info string has no backtick: ```x``` on one line is inline code
  return f && !(f[1][0] === '`' && f[2].includes('`')) ? f : null;
}

const endsParagraph = (line: string): boolean =>
  isBlank(line) || MATH_OPEN.test(line) || fenceOpen(line) !== null || line.trim() === '%%' ||
  HEADING.test(line) || LIST_ITEM.test(line) || QUOTE.test(line) || BREAK.test(line);

// - the run of `$` that ends a line, trailing whitespace aside; a first `$` escaped by a backslash is
//   not part of it
function trailingRun(line: string): { before: string; run: string; after: string } | null {
  const m = /^(.*?)(\$+)(\s*)$/s.exec(line);
  if (!m) return null;
  let [, before, run] = m;
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(before)) { before += '$'; run = run.slice(1); }
  return run.length >= 2 ? { before, run, after: m[3] } : null;
}

// - whether the character at `k` follows a backslash that is not itself escaped
function escaped(t: string, k: number): boolean {
  let slashes = 0;
  while (t[k - 1 - slashes] === '\\') slashes++;
  return slashes % 2 === 1;
}

// - the runs of `$` in `t`; a `$` escaped by a backslash is no part of one
function dollarRuns(t: string): { at: number; size: number }[] {
  const runs: { at: number; size: number }[] = [];
  for (let k = 0; k < t.length; k++) {
    if (t[k] !== '$' || escaped(t, k)) continue;
    let e = k;
    while (t[e] === '$') e++;
    runs.push({ at: k, size: e - k });
    k = e - 1;
  }
  return runs;
}

// - a line that is one `$$body$$` and nothing more, after up to 3 spaces; remark-math reads it as
//   inline math that the first later run of exactly two `$` closes. A body that starts or ends with
//   `$$` would close a $$ block on its own line, so it is not taken.
function oneLineMath(line: string): { indent: string; body: string; after: string } | null {
  const m = /^( {0,3})\$\$(?!\$)(.*?)(\s*)$/s.exec(line);
  if (!m) return null;
  const [, indent, rest, after] = m;
  const close = dollarRuns(rest).find(r => r.size === 2);
  if (!close || close.at + 2 !== rest.length) return null;
  const body = rest.slice(0, close.at).trim();
  return body && !/^\$\$|\$\$$/.test(body) ? { indent, body, after } : null;
}

// - code spans blanked out, newlines and length kept
const maskCode = (text: string): string =>
  text.replace(/(`+)[\s\S]*?[^`]\1(?!`)/g, m => m.replace(/[^\n]/g, '_'));

// - the `$` runs of a paragraph as remark-math reads them: a run pairs with the next run of the same
//   length and the runs between are inside that math; a run with no such partner is plain text. An
//   escaped `$` and code are no run, so `masked` is the text with its code masked.
function pairRuns(masked: string): { math: { from: number; to: number }[]; unpaired: { at: number; size: number }[] } {
  const runs = dollarRuns(masked);
  const math: { from: number; to: number }[] = [];
  const unpaired: typeof runs = [];
  for (let r = 0; r < runs.length; r++) {
    let c = r + 1;
    while (c < runs.length && runs[c].size !== runs[r].size) c++;
    if (c === runs.length) { unpaired.push(runs[r]); continue; }
    math.push({ from: runs[r].at + runs[r].size, to: runs[c].at });
    r = c;
  }
  return { math, unpaired };
}

const unpairedRuns = (text: string): { at: number; size: number }[] => pairRuns(maskCode(text)).unpaired;

// - the first line after the paragraph starting at line `from`; a heading is a paragraph of one line
function paragraphEnd(lines: string[], from: number): number {
  let end = from + 1;
  if (!HEADING.test(lines[from])) while (end < lines.length && !endsParagraph(lines[end])) end++;
  return end;
}

// - the paragraph starting at line `from`: the first line after it, and the line whose last `$` run
//   opens a $$ block, -1 when none does. That is a run of two or more `$` that remark-math leaves
//   unpaired, the only such run in the paragraph, ending a line after some text, when the line after
//   the paragraph is a run at least as long. remark-math reads that line as opening a block, so every
//   later $$ pairs with the wrong one.
function paragraphAt(lines: string[], from: number): { end: number; opensAt: number } {
  const first = lines[from];
  const end = paragraphEnd(lines, from);
  const none = { end, opensAt: -1 };
  const close = end < lines.length ? MATH_OPEN.exec(lines[end]) : null;
  // - a quote's closing line would carry a `>`; an indented first line is code or a list item's text
  if (!close || HEADING.test(first) || QUOTE.test(first) || INDENTED.test(first)) return none;
  const text = lines.slice(from, end).join('\n');
  const runs = unpairedRuns(text).filter(r => r.size >= 2);
  if (runs.length !== 1 || runs[0].size > close[2].length) return none;
  const { at, size } = runs[0];
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const lineEnd = text.indexOf('\n', at) === -1 ? text.length : text.indexOf('\n', at);
  if (!isBlank(text.slice(at + size, lineEnd)) || isBlank(text.slice(lineStart, at))) return none;
  return { end, opensAt: from + text.slice(0, at).split('\n').length - 1 };
}

/**
 * Put a `$$` that opens or closes a display block on a line of its own when text is glued to it, so
 * remark-math pairs every `$$` as written: `text$$` opening a block, and `text$$` or `$$text`
 * closing one, become `text` and `$$` on two lines; `$$text` opening a block (remark-math drops the
 * text) becomes `$$` and `text`. A paragraph that is one line `$$a$$`, which remark-math reads as
 * inline math, becomes `$$`, `a` and `$$` on three lines. A `$$a$$` in a sentence or in a longer
 * paragraph, `$` math, `\$`, code and %% Typst blocks are left as they are. Applying it twice gives
 * what applying it once does.
 */
export function normalizeDisplayMath(md: string): string {
  if (!md.includes('$$')) return md;
  const lines = md.split('\n');
  // - a %% line opens a Typst block only when a later %% line closes it (markdown-html.ts)
  let lastTypst = -1;
  for (let k = lines.length - 1; k >= 0 && lastTypst < 0; k--) if (lines[k].trim() === '%%') lastTypst = k;
  const out: string[] = [];
  let fence: { char: string; size: number } | null = null;
  let typst = false;
  let math = 0;          // - length of the run that opened the $$ block being read, 0 outside one
  let mathIndent = '';
  let paraEnd = -1;      // - the first line after the paragraph being read
  let opensAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      out.push(line);
      const m = FENCE_CLOSE.exec(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.size) fence = null;
      continue;
    }
    if (typst) {
      out.push(line);
      if (line.trim() === '%%') typst = false;
      continue;
    }
    if (math) {
      const lead = LEADING_RUN.exec(line);
      if (lead && lead[2].length >= math) {
        math = 0;
        if (isBlank(lead[3])) { out.push(line); continue; }
        // - the text after the closing run is read again as the line after the block
        out.push(lead[1] + lead[2]);
        lines[i--] = lead[1] + lead[3].trimStart();
        continue;
      }
      const t = trailingRun(line);
      if (t && t.run.length >= math && !isBlank(t.before)) {
        out.push(t.before.trimEnd(), mathIndent + t.run + t.after);
        math = 0;
        continue;
      }
      out.push(line);
      continue;
    }
    if (isBlank(line)) { out.push(line); paraEnd = -1; continue; }
    const f = fenceOpen(line);
    if (f) { fence = { char: f[1][0], size: f[1].length }; out.push(line); paraEnd = -1; continue; }
    if (line.trim() === '%%' && i < lastTypst) { typst = true; out.push(line); paraEnd = -1; continue; }
    const open = MATH_OPEN.exec(line);
    if (open) {
      math = open[2].length;
      mathIndent = open[1];
      if (isBlank(open[3])) out.push(line);
      else out.push(open[1] + open[2], open[1] + open[3].trimStart());
      paraEnd = -1;
      continue;
    }
    const starts = i >= paraEnd;
    if (starts) ({ end: paraEnd, opensAt } = paragraphAt(lines, i));
    // - a paragraph that is one `$$…$$` line is display math, as Obsidian and GitHub read it; a
    //   line under it of `=` or `-` would make it a heading
    const one = starts && paraEnd === i + 1 ? oneLineMath(line) : null;
    if (one && !(paraEnd < lines.length && SETEXT.test(lines[paraEnd]))) {
      const eol = one.after.endsWith('\r') ? '\r' : '';
      out.push(one.indent + '$$' + eol, one.indent + one.body + eol, one.indent + '$$' + one.after);
      continue;
    }
    if (i === opensAt) {
      const t = trailingRun(line)!;
      mathIndent = MATH_OPEN.exec(lines[paraEnd])![1];
      out.push(t.before.trimEnd(), mathIndent + t.run + t.after);
      math = t.run.length;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// - KaTeX draws it as it draws `\$`, and it holds no `$` for remark-math to end a formula at. The
//   braces end the number `\char` reads and keep it one argument after `^` or `\frac`.
const MATH_DOLLAR = '{\\char"24}';

// - a GFM table's delimiter row; the line above it is the table's header row
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?\s*$/;

// - `text` with each escaped `$` inside the ranges written as MATH_DOLLAR; `masked` is `text` with
//   its code masked, so a `\$` in code stays
function writeDollars(text: string, masked: string, ranges: { from: number; to: number }[]): string {
  let out = '';
  let done = 0;
  for (const { from, to } of ranges) {
    for (let k = from; k < to; k++) {
      if (masked[k] !== '$' || !escaped(masked, k)) continue;
      out += text.slice(done, k - 1) + MATH_DOLLAR;
      done = k + 1;
    }
  }
  return out + text.slice(done);
}

// - one paragraph or table cell, which remark-math reads on its own
function inlineDollars(text: string): string {
  const masked = maskCode(text);
  return writeDollars(text, masked, pairRuns(masked).math);
}

// - the lines of one paragraph; a table's rows are read cell by cell
function paragraphDollars(para: string[]): string[] {
  // - indented code, unless it is a list item
  if (INDENTED.test(para[0]) && !LIST_ITEM.test(para[0].trimStart())) return para;
  const header = para.findIndex((l, k) => k > 0 && l.includes('|') && para[k - 1].includes('|') && TABLE_DELIMITER.test(l)) - 1;
  const prose = header < 0 ? para : para.slice(0, header);
  const rows = header < 0 ? [] : para.slice(header);
  const written = [
    ...(prose.length ? inlineDollars(prose.join('\n')).split('\n') : []),
    ...rows.map(row => row.split(/(?<!\\)\|/).map(inlineDollars).join('|')),
  ];
  // - a line the rewrite would make the opening of a $$ block keeps its `\$`
  return written.map((l, k) => (MATH_OPEN.test(l) ? para[k] : l));
}

/**
 * Write each `\$` inside math as `{\char"24}`, which KaTeX renders as the same dollar sign. remark-math
 * reads no escape inside math, so the `$` of `\$` in `$\$5$` closes the formula: KaTeX gets `\` alone
 * and the rest of the formula is printed as text. Math is found as remark-math pairs its `$` runs, a
 * `\$` being no run: the formulas of each paragraph and table cell, and $$ blocks. A `\$` outside math
 * is markdown's escaped dollar and stays, as does one in code, a fence, a %% Typst block or indented
 * code. Applying it twice gives what applying it once does.
 */
function normalizeMathDollars(md: string): string {
  if (!md.includes('\\$')) return md;
  const lines = md.split('\n');
  let lastTypst = -1;
  for (let k = lines.length - 1; k >= 0 && lastTypst < 0; k--) if (lines[k].trim() === '%%') lastTypst = k;
  const out: string[] = [];
  let fence: { char: string; size: number } | null = null;
  let typst = false;
  let math = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      out.push(line);
      const m = FENCE_CLOSE.exec(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.size) fence = null;
      continue;
    }
    if (typst) {
      out.push(line);
      if (line.trim() === '%%') typst = false;
      continue;
    }
    if (math) {
      const lead = LEADING_RUN.exec(line);
      if (lead && lead[2].length >= math && isBlank(lead[3])) math = 0;
      out.push(math ? writeDollars(line, line, [{ from: 0, to: line.length }]) : line);
      continue;
    }
    if (isBlank(line)) { out.push(line); continue; }
    const f = fenceOpen(line);
    if (f) { fence = { char: f[1][0], size: f[1].length }; out.push(line); continue; }
    if (line.trim() === '%%' && i < lastTypst) { typst = true; out.push(line); continue; }
    const open = MATH_OPEN.exec(line);
    if (open) { math = open[2].length; out.push(line); continue; }
    const end = paragraphEnd(lines, i);
    out.push(...paragraphDollars(lines.slice(i, end)));
    i = end - 1;
  }
  return out.join('\n');
}

/**
 * The math preparation every markdown renderer applies before remark-math: LaTeX delimiters to `$`,
 * then display `$$` on lines of their own, then `\$` inside math as a dollar sign with no `$`.
 * Applying it twice gives what applying it once does.
 */
export function normalizeMath(md: string): string {
  return normalizeMathDollars(normalizeDisplayMath(normalizeMathDelimiters(md)));
}
