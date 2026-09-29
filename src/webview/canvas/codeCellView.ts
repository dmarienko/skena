/**
 * Pure helpers for the code cell's read-only preview, so it draws what the Monaco editor draws
 * when the cell is opened: bracket colours by nesting pair, relative line numbers, a line-number
 * column of the same width, and each line cut into styled runs.
 *
 * The editor always tokenizes a code cell as python (CodeNode passes language="python"), so the
 * bracket rules follow Monaco 0.55's python grammar (basic-languages/python/python.js) and its
 * bracket pair colorizer (common/model/bracketPairsTextModelPart).
 */

/** One bracket the editor colours. `line` and `col` are 0-based. */
export interface BracketMark {
  line:    number;
  col:     number;
  /** - nesting depth, 0 for a bracket not inside any other pair */
  level:   number;
  /** - a closing bracket with no opening one, or an opening bracket never closed: Monaco draws both red */
  invalid: boolean;
}

// - Monaco's default editorBracketHighlight.foreground1..3; foreground4..6 default to #00000000, which
// - Monaco drops as transparent, so levels cycle through these three. The skena-code theme sets none of them.
export const BRACKET_COLORS_DARK  = ['#ffd700', '#da70d6', '#179fff'];
export const BRACKET_COLORS_LIGHT = ['#0431fa', '#319331', '#7b3814'];
// - editorBracketHighlight.unexpectedBracket.foreground, the same in dark and light themes
export const BRACKET_INVALID_COLOR = 'rgba(255, 18, 18, 0.8)';

// - line-number colours of the skena-code Monaco theme (CodeNode beforeMount uses these too)
export const LINE_NUMBER_COLOR        = '#90be065c';
export const LINE_NUMBER_ACTIVE_COLOR = '#90c0a0';

export const LINE_NUMBERS_MIN_CHARS = 3;
export const LINE_DECORATIONS_WIDTH = 6;

/** The colour Monaco gives a bracket: its level picks from the pool as `level % 30 % pool.length`. */
export function bracketColor(mark: BracketMark, dark: boolean): string {
  if (mark.invalid) return BRACKET_INVALID_COLOR;
  const pool = dark ? BRACKET_COLORS_DARK : BRACKET_COLORS_LIGHT;
  return pool[(mark.level % 30) % pool.length];
}

/**
 * Line-number column of a Monaco editor with lineNumbersMinChars 3, lineDecorationsWidth 6, no glyph
 * margin and no folding: `lineNumbersWidth` is the box the numbers are aligned in, `contentLeft` the
 * x of the first code glyph. `maxDigitWidth` is Monaco's measured width of the widest digit.
 */
export function codeGutter(lineCount: number, maxDigitWidth: number): { lineNumbersWidth: number; contentLeft: number } {
  const digits = Math.max(String(Math.max(1, Math.floor(lineCount))).length, LINE_NUMBERS_MIN_CHARS);
  const lineNumbersWidth = Math.round(digits * maxDigitWidth);
  return { lineNumbersWidth, contentLeft: lineNumbersWidth + LINE_DECORATIONS_WIDTH };
}

/**
 * The numbers Monaco shows with `lineNumbers: 'relative'`: the cursor line shows its own number, every
 * other line its distance to the cursor line. `cursorLine` is 1-based and clamped to the text.
 */
export function relativeLineNumbers(lineCount: number, cursorLine: number): string[] {
  const n = Math.max(0, Math.floor(lineCount));
  const cur = Math.min(Math.max(1, Math.floor(cursorLine) || 1), Math.max(1, n));
  const out: string[] = [];
  for (let ln = 1; ln <= n; ln++) out.push(String(ln === cur ? cur : Math.abs(cur - ln)));
  return out;
}

/** `hex` (#rrggbb or #rrggbbaa) with its alpha multiplied by `factor`, as Monaco's Color.transparent prints it. */
export function scaleAlpha(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  // - Monaco keeps 3 decimals of alpha, then prints 2
  const scaled = Math.round(Math.round(a * 1000) / 1000 * factor * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${+scaled.toFixed(2)})`;
}

// - true: the token is a string or a comment, whose brackets Monaco's bracket matcher skips
type Rule = [RegExp, boolean, string?];

function rule(re: RegExp, skip: boolean, next?: string): Rule {
  // - Monarch matches each rule against the rest of the line, anchored at the current position
  return [new RegExp('^(?:' + re.source + ')'), skip, next];
}

// - Monaco 0.55 basic-languages/python/python.js `tokenizer`, rule for rule and in the same order, with
// - its includes written out. Only whether a token is a string/comment and the state changes matter here.
const PYTHON_RULES: Record<string, Rule[]> = {
  root: [
    rule(/\s+/, false),
    rule(/(^#.*$)/, true),
    rule(/'''/, true, 'endDocString'),
    rule(/"""/, true, 'endDblDocString'),
    rule(/-?0x([abcdef]|[ABCDEF]|\d)+[lL]?/, false),
    rule(/-?(\d*\.)?\d+([eE][+\-]?\d+)?[jJ]?[lL]?/, false),
    rule(/'$/, true, '@popall'),
    rule(/f'{1,3}/, true, 'fStringBody'),
    rule(/'/, true, 'stringBody'),
    rule(/"$/, true, '@popall'),
    rule(/f"{1,3}/, true, 'fDblStringBody'),
    rule(/"/, true, 'dblStringBody'),
    rule(/[,:;]/, false),
    rule(/[{}\[\]()]/, false),
    rule(/@[a-zA-Z_]\w*/, false),
    rule(/[a-zA-Z_]\w*/, false),
  ],
  endDocString: [
    rule(/[^']+/, true),
    rule(/\\'/, true),
    rule(/'''/, true, '@popall'),
    rule(/'/, true),
  ],
  endDblDocString: [
    rule(/[^"]+/, true),
    rule(/\\"/, true),
    rule(/"""/, true, '@popall'),
    rule(/"/, true),
  ],
  fStringBody: [
    rule(/[^\\'\{\}]+$/, true, '@popall'),
    rule(/[^\\'\{\}]+/, true),
    rule(/\{[^\}':!=]+/, false, 'fStringDetail'),
    rule(/\\./, true),
    rule(/'/, true, '@popall'),
    rule(/\\$/, true),
  ],
  stringBody: [
    rule(/[^\\']+$/, true, '@popall'),
    rule(/[^\\']+/, true),
    rule(/\\./, true),
    rule(/'/, true, '@popall'),
    rule(/\\$/, true),
  ],
  fDblStringBody: [
    rule(/[^\\"\{\}]+$/, true, '@popall'),
    rule(/[^\\"\{\}]+/, true),
    rule(/\{[^\}':!=]+/, false, 'fStringDetail'),
    rule(/\\./, true),
    rule(/"/, true, '@popall'),
    rule(/\\$/, true),
  ],
  dblStringBody: [
    rule(/[^\\"]+$/, true, '@popall'),
    rule(/[^\\"]+/, true),
    rule(/\\./, true),
    rule(/"/, true, '@popall'),
    rule(/\\$/, true),
  ],
  fStringDetail: [
    rule(/[:][^}]+/, true),
    rule(/[!][ars]/, true),
    rule(/=/, true),
    rule(/\}/, false, '@pop'),
  ],
};

const OPENERS = '([{';
const CLOSERS = ')]}';

/**
 * Every bracket Monaco colours in `lines` (the cell text split at line breaks), with its nesting level.
 * Brackets inside strings and comments are left out. A closing bracket pairs with the nearest open
 * bracket of its kind; brackets opened after that one and still open are marked invalid (never closed).
 */
export function pythonBracketLevels(lines: readonly string[]): BracketMark[] {
  const found: { line: number; col: number; ch: string }[] = [];
  const stack: string[] = ['root'];
  for (let ln = 0; ln < lines.length; ln++) {
    const text = lines[ln];
    let pos = 0;
    while (pos < text.length) {
      const rest = text.slice(pos);
      let len = 1, skip = false, next: string | undefined;
      for (const [re, isSkip, nx] of PYTHON_RULES[stack[stack.length - 1]]) {
        const m = re.exec(rest);
        if (m && m[0].length > 0) { len = m[0].length; skip = isSkip; next = nx; break; }
      }
      // - no rule matched: Monarch takes one character as the grammar's default token (not a string)
      if (!skip) {
        for (let i = pos; i < pos + len; i++) {
          const ch = text[i];
          if (OPENERS.includes(ch) || CLOSERS.includes(ch)) found.push({ line: ln, col: i, ch });
        }
      }
      if (next === '@popall') stack.length = 1;
      else if (next === '@pop') { if (stack.length > 1) stack.pop(); }
      else if (next) stack.push(next);
      pos += len;
    }
  }

  const marks: BracketMark[] = [];
  const open: { kind: number; mark: number }[] = [];
  for (const b of found) {
    const opener = OPENERS.indexOf(b.ch);
    if (opener >= 0) {
      open.push({ kind: opener, mark: marks.length });
      marks.push({ line: b.line, col: b.col, level: open.length - 1, invalid: false });
      continue;
    }
    const kind = CLOSERS.indexOf(b.ch);
    let i = open.length - 1;
    while (i >= 0 && open[i].kind !== kind) i--;
    if (i < 0) {
      marks.push({ line: b.line, col: b.col, level: open.length, invalid: true });
      continue;
    }
    for (let j = i + 1; j < open.length; j++) marks[open[j].mark].invalid = true;
    marks.push({ line: b.line, col: b.col, level: i, invalid: false });
    open.length = i;
  }
  for (const o of open) marks[o.mark].invalid = true;
  return marks;
}

/** How the editor draws a run of text: its token's colour and font style. */
export interface RunStyle { color?: string; italic?: boolean; bold?: boolean; underline?: boolean; strikethrough?: boolean }

/** A piece of a line drawn with one style; `magic` marks CodeNode's IPython magic decoration. */
export interface Run { text: string; style: RunStyle; magic: boolean }

// - an IPython magic / shell line (%name, %%name, !cmd): CodeNode decorates the magic token in the editor
const MAGIC_RE = /^(\s*)(%{1,2}\s*[A-Za-z_]\w*|!)/;

/** [start, end) of the magic token on `line`, or null. */
export function magicRange(line: string): [number, number] | null {
  const m = line.match(MAGIC_RE);
  return m ? [m[1].length, m[1].length + m[2].length] : null;
}

/**
 * `line` cut into runs the way the editor draws it: each token (starting at `offset`) in its own style,
 * a bracket from `brackets` (column → colour) in its bracket colour over the token's, and the magic
 * range flagged. Neighbouring pieces with the same look are joined.
 */
export function splitRuns(
  line: string,
  tokens: readonly { offset: number; style: RunStyle }[],
  brackets?: ReadonlyMap<number, string>,
  magic?: readonly [number, number] | null,
): Run[] {
  if (line.length === 0) return [];
  const cuts = new Set<number>([0, line.length]);
  for (const t of tokens) if (t.offset > 0 && t.offset < line.length) cuts.add(t.offset);
  brackets?.forEach((_, col) => { cuts.add(col); cuts.add(col + 1); });
  if (magic) { cuts.add(magic[0]); cuts.add(magic[1]); }
  const points = [...cuts].filter(c => c >= 0 && c <= line.length).sort((a, b) => a - b);
  const runs: Run[] = [];
  let ti = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const start = points[k], end = points[k + 1];
    while (ti + 1 < tokens.length && tokens[ti + 1].offset <= start) ti++;
    const base = tokens.length > 0 && tokens[ti].offset <= start ? tokens[ti].style : {};
    const bracket = end - start === 1 ? brackets?.get(start) : undefined;
    const style = bracket ? { ...base, color: bracket } : base;
    const isMagic = !!magic && start >= magic[0] && end <= magic[1];
    const last = runs[runs.length - 1];
    if (last && last.magic === isMagic && sameStyle(last.style, style)) last.text += line.slice(start, end);
    else runs.push({ text: line.slice(start, end), style, magic: isMagic });
  }
  return runs;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return a.color === b.color && !!a.italic === !!b.italic && !!a.bold === !!b.bold
    && !!a.underline === !!b.underline && !!a.strikethrough === !!b.strikethrough;
}
