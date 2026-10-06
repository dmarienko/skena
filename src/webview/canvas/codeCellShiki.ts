/**
 * Code cells coloured by a shiki theme (skena.code.theme): which theme the setting names, each line cut
 * into coloured tokens the way shiki's codeToTokens cuts it, the Monaco token names the editor gets for
 * them, and the Monaco rules that colour those names. The editor and the preview both draw from these,
 * so they show the same colours. No DOM, no Monaco runtime.
 */

import type { editor, languages } from 'monaco-editor';
import type { HighlighterCore } from 'shiki/core';
import { EncodedTokenMetadata, type StateStack } from 'shiki/textmate';
import type { RunStyle } from './codeCellView';

export const CODE_THEME_DEFAULT = 'ayu-dark';
/** - skena's own code palette and Monaco's python tokenizer, as before the setting existed */
export const CODE_THEME_FACTORS = 'factors';

/** The theme `value` (the skena.code.theme setting) names: a shiki theme id in `bundled`, `factors`, else the default. */
export function resolveCodeTheme(value: unknown, bundled: readonly string[]): string {
  if (value === CODE_THEME_FACTORS) return value;
  return typeof value === 'string' && bundled.includes(value) ? value : CODE_THEME_DEFAULT;
}

/** A token of a line: from `offset` to the next token's offset. */
export interface CodeToken {
  offset:    number;
  /** - #rrggbb or #rrggbbaa as the theme gives it, after its colour replacements */
  color:     string;
  /** - TextMate font style bits: 1 italic, 2 bold, 4 underline, 8 strikethrough */
  fontStyle: number;
  /** - TextMate standard token type: 0 other, 1 comment, 2 string, 3 regex */
  type:      number;
}

export interface CodeTokenizer {
  readonly theme:  string;
  /** - the theme's default text colour */
  readonly fg:     string;
  /** - every colour a token can have under the theme */
  readonly colors: readonly string[];
  /** - `state` null is the first line's */
  tokenizeLine(line: string, state: StateStack | null): { tokens: CodeToken[]; endState: StateStack | null };
}

type CodeHighlighter = Pick<HighlighterCore, 'setTheme' | 'getLanguage'>;

// - shiki's default for codeToTokens
const TOKENIZE_TIME_LIMIT = 500;

function hexDigits(color: string | undefined): string | null {
  const m = color?.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return h.length <= 4 ? h.split('').map(c => c + c).join('') : h;
}

/**
 * Tokenizes `lang` lines as shiki's codeToTokens does with `theme`: the same grammar call, an empty line
 * skipped with the state kept, zero-length tokens dropped, the theme's colour replacements applied.
 */
export function codeTokenizer(hl: CodeHighlighter, theme: string, lang = 'python'): CodeTokenizer {
  const { theme: resolved, colorMap } = hl.setTheme(theme);
  const grammar = hl.getLanguage(lang);
  const replacements = resolved.colorReplacements ?? {};
  const replace = (c: string | undefined) => (c && replacements[c.toLowerCase()]) || c;
  const fgDigits = hexDigits(replace(resolved.fg)) ?? 'd4d4d4';
  const fg = `#${fgDigits}`;
  const colorOf = (id: number) => {
    const digits = hexDigits(replace(colorMap[id]));
    return digits ? `#${digits}` : fg;
  };
  const colors = [...new Set([fg, ...Array.from(colorMap, (_, id) => colorOf(id))])];
  return {
    theme, fg, colors,
    tokenizeLine(line, state) {
      if (line === '') return { tokens: [], endState: state };
      // - the highlighter is shared and its registry has one theme at a time, which decides the colour
      // - ids in the metadata; setTheme is a no-op when the theme is already set
      hl.setTheme(theme);
      const r = grammar.tokenizeLine2(line, state, TOKENIZE_TIME_LIMIT);
      const n = r.tokens.length / 2;
      const tokens: CodeToken[] = [];
      for (let j = 0; j < n; j++) {
        const start = r.tokens[2 * j];
        const next = j + 1 < n ? r.tokens[2 * j + 2] : line.length;
        if (start === next) continue;
        const meta = r.tokens[2 * j + 1];
        tokens.push({
          offset:    start,
          color:     colorOf(EncodedTokenMetadata.getForeground(meta)),
          fontStyle: EncodedTokenMetadata.getFontStyle(meta),
          type:      EncodedTokenMetadata.getTokenType(meta),
        });
      }
      return { tokens, endState: r.ruleStack };
    },
  };
}

/** `lines` tokenized from the first line on, as the editor tokenizes them one after another. */
export function tokenizeCodeLines(tok: CodeTokenizer, lines: readonly string[]): CodeToken[][] {
  let state: StateStack | null = null;
  return lines.map(line => {
    const r = tok.tokenizeLine(line, state);
    state = r.endState;
    return r.tokens;
  });
}

/**
 * `color` as it shows over the opaque `bg`, as #rrggbb. Monaco drops the alpha of a token colour, so a
 * colour with alpha is mixed with the background first; the editor and the preview both draw the result.
 */
export function opaqueColor(color: string, bg: string): string {
  const c = hexDigits(color) ?? 'd4d4d4';
  if (c.length === 6) return `#${c}`;
  const b = (hexDigits(bg) ?? '000000').slice(0, 6);
  const a = parseInt(c.slice(6, 8), 16) / 255;
  let out = '#';
  for (let i = 0; i < 6; i += 2) {
    const v = Math.round(parseInt(c.slice(i, i + 2), 16) * a + parseInt(b.slice(i, i + 2), 16) * (1 - a));
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

/** How the preview draws `t` over the editor background `bg`. */
export function codeRunStyle(t: CodeToken, bg: string): RunStyle {
  return {
    color:         opaqueColor(t.color, bg),
    italic:        (t.fontStyle & 1) !== 0,
    bold:          (t.fontStyle & 2) !== 0,
    underline:     (t.fontStyle & 4) !== 0,
    strikethrough: (t.fontStyle & 8) !== 0,
  };
}

// - Monaco reads a token's standard type from a comment / string / regex word in its name
const TYPE_SUFFIX = ['', '.comment', '.string', '.regex'];

/**
 * The Monaco token name of `t`: `shk.<colour>.<font style>`, plus the token type. Named by look, not by
 * TextMate scope, so no markdown token of the note editors (keyword.md, string.md, …) matches these rules.
 */
export function codeTokenName(t: CodeToken): string {
  return `shk.${hexDigits(t.color) ?? 'd4d4d4'}.${t.fontStyle}${TYPE_SUFFIX[t.type] ?? ''}`;
}

function fontStyleName(bits: number): string {
  return [bits & 1 && 'italic', bits & 2 && 'bold', bits & 4 && 'underline', bits & 8 && 'strikethrough'].filter(Boolean).join(' ');
}

/** Monaco rules for every name codeTokenName can give a token of these colours, each colour made opaque over `bg`. */
export function codeTokenRules(colors: readonly string[], bg: string): editor.ITokenThemeRule[] {
  const rules: editor.ITokenThemeRule[] = [];
  for (const color of colors) {
    const digits = hexDigits(color);
    if (!digits) continue;
    const foreground = opaqueColor(color, bg).slice(1);
    for (let bits = 0; bits < 16; bits++) rules.push({ token: `shk.${digits}.${bits}`, foreground, fontStyle: fontStyleName(bits) });
  }
  return rules;
}

/** skena-code under a code theme: skena's editor colours and base from `ui`, token colours from `rules` only. */
export function shikiCodeTheme(ui: editor.IStandaloneThemeData, rules: editor.ITokenThemeRule[]): editor.IStandaloneThemeData {
  return { base: ui.base, inherit: ui.inherit, colors: ui.colors, rules };
}

class CodeLineState implements languages.IState {
  constructor(readonly stack: StateStack | null) {}
  clone(): CodeLineState {
    return new CodeLineState(this.stack);
  }
  equals(other: languages.IState): boolean {
    if (!(other instanceof CodeLineState)) return false;
    if (other.stack === this.stack) return true;
    return !!this.stack && !!other.stack && this.stack.equals(other.stack);
  }
}

/** The Monaco tokens provider of a code cell: `tok`'s tokens, named by codeTokenName. */
export function codeTokensProvider(tok: CodeTokenizer): languages.TokensProvider {
  const plain = codeTokenName({ offset: 0, color: tok.fg, fontStyle: 0, type: 0 });
  return {
    getInitialState: () => new CodeLineState(null),
    tokenize(line, state) {
      const prev = state as CodeLineState;
      const r = tok.tokenizeLine(line, prev.stack);
      return {
        tokens:   r.tokens.length ? r.tokens.map(t => ({ startIndex: t.offset, scopes: codeTokenName(t) })) : [{ startIndex: 0, scopes: plain }],
        endState: r.endState === prev.stack ? prev : new CodeLineState(r.endState),
      };
    },
  };
}
