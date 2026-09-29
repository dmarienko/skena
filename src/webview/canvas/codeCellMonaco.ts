/**
 * The parts of the code cell editor's look that the preview takes from Monaco's own code (0.55, imported
 * by path): the `skena-code` theme and the colour Monaco gives each token type under it, the indentation
 * Monaco guesses for the cell's text, and the indentation guides Monaco draws for it. No DOM needed.
 */

import type { editor } from 'monaco-editor';
import { TokenTheme } from 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js';
import { TokenMetadata } from 'monaco-editor/esm/vs/editor/common/encodedTokenAttributes.js';
import { vs, vs_dark } from 'monaco-editor/esm/vs/editor/standalone/common/themes.js';
import { guessIndentation } from 'monaco-editor/esm/vs/editor/common/model/indentationGuesser.js';
import { GuidesTextModelPart } from 'monaco-editor/esm/vs/editor/common/model/guidesTextModelPart.js';
import { LINE_NUMBER_ACTIVE_COLOR, LINE_NUMBER_COLOR, type RunStyle } from './codeCellView';

/** The code cell editor's theme, `skena-code`: CodeNode defines it before each editor is created. */
export function skenaCodeTheme(dark: boolean, factors: boolean, background: string): editor.IStandaloneThemeData {
  // - match the markdown theme: when the factors theme is active, colour the editor tokens with the
  // - factors palette (teal keywords / amber strings / …). Otherwise a VS-Code-Dark+-ish default.
  const rules = factors
    ? [
        { token: 'comment',    foreground: '56635d', fontStyle: 'italic' },
        { token: 'keyword',    foreground: '4cc8a0' },
        { token: 'string',     foreground: 'd9a23f' },
        { token: 'number',     foreground: 'e5707a' },
        { token: 'type',       foreground: '4cc8a0' },
        { token: 'identifier', foreground: 'c7d1cc' },
        { token: 'operator',   foreground: '7c8a84' },
        { token: 'delimiter',  foreground: '7c8a84' },
      ]
    : [
        { token: 'keyword',    foreground: dark ? '569cd6' : '0070c1'                      },
        { token: 'comment',    foreground: dark ? '6a9955' : '008000', fontStyle: 'italic' },
        { token: 'string',     foreground: dark ? 'ce9178' : 'a31515'                      },
      ];
  return {
    base:    dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    // - VS Code doesn't inject editor colours as CSS vars into webviews, so bake the palette
    // - here. Not dynamic — edit these to retune the code cell editor look.
    colors: {
      'editor.background':                        background || (dark ? '#1e1e1e' : '#ffffff'),
      'editorCursor.foreground':                  '#f01010',
      'editor.lineHighlightBackground':           '#199ce809',
      'editor.lineHighlightBorder':               '#199ce805',
      'editor.selectionBackground':               '#212a66f0',
      'editor.selectionHighlightBackground':      '#ff402030',
      'editor.inactiveSelectionBackground':       '#29328080',
      'editor.wordHighlightBackground':           '#60020247',
      'editor.wordHighlightStrongBackground':     '#ffffff18',
      'editor.wordHighlightBorder':               '#f67e2220',
      'editor.wordHighlightStrongBorder':         '#c4854f50',
      'editorLineNumber.activeForeground':        LINE_NUMBER_ACTIVE_COLOR,
      'editorLineNumber.foreground':              LINE_NUMBER_COLOR,
      'editorWidget.border':                      '#000000',
      'editorBracketPairGuide.activeBackground1': '#00e7495e',
      'editorBracketPairGuide.activeBackground2': '#fac9285e',
      'editorBracketPairGuide.activeBackground3': '#057aff5e',
      'editorBracketPairGuide.activeBackground4': '#c122e95e',
      'editorBracketPairGuide.activeBackground5': '#f513845e',
      'editorBracketPairGuide.activeBackground6': '#19f9d85e',
    },
  };
}

function baseTheme(theme: editor.IStandaloneThemeData): editor.IStandaloneThemeData {
  return theme.base === 'vs' ? vs : vs_dark;
}

/** A theme colour as Monaco resolves it for an inheriting theme: the theme's own, else its base theme's. */
export function themeColor(theme: editor.IStandaloneThemeData, id: string): string | undefined {
  return theme.colors[id] ?? (theme.inherit ? baseTheme(theme).colors[id] : undefined);
}

/**
 * The style Monaco gives a token type (e.g. `identifier.python`) under `theme`. The rule list is built
 * the way StandaloneTheme.tokenTheme builds it: the base theme's rules, a default rule from the
 * theme's editor.foreground / editor.background, then the theme's own rules.
 */
export function tokenStyler(theme: editor.IStandaloneThemeData): (type: string) => RunStyle {
  // - copied: Monaco's own theme service appends to the base theme's rule array
  const rules: editor.ITokenThemeRule[] = theme.inherit ? [...baseTheme(theme).rules] : [];
  const fg = theme.colors['editor.foreground'];
  const bg = theme.colors['editor.background'];
  if (fg || bg) rules.push({ token: '', ...(fg ? { foreground: fg } : {}), ...(bg ? { background: bg } : {}) });
  const tokenTheme = TokenTheme.createFromRawTokenTheme(rules.concat(theme.rules), theme.encodedTokensColors ?? []);
  const colorMap = tokenTheme.getColorMap();
  const cache = new Map<string, RunStyle>();
  return (type: string) => {
    let style = cache.get(type);
    if (!style) {
      const metadata = tokenTheme._match(type).metadata;
      const fontStyle = TokenMetadata.getFontStyle(metadata);
      style = {
        color:         colorMap[TokenMetadata.getForeground(metadata)]?.toString(),
        italic:        (fontStyle & 1) !== 0,
        bold:          (fontStyle & 2) !== 0,
        underline:     (fontStyle & 4) !== 0,
        strikethrough: (fontStyle & 8) !== 0,
      };
      cache.set(type, style);
    }
    return style;
  };
}

export interface CodeIndentation { tabSize: number; indentSize: number }

/**
 * The tab and indent size the editor's model ends up with for `lines`: Monaco creates it with
 * detectIndentation on and tab size 4, and guesses both from the text.
 */
export function codeIndentation(lines: readonly string[]): CodeIndentation {
  const guess = guessIndentation({
    getLineCount:    () => lines.length,
    getLineLength:   n => lines[n - 1].length,
    getLineContent:  n => lines[n - 1],
    getLineCharCode: (n, i) => lines[n - 1].charCodeAt(i),
  }, 4, true);
  return { tabSize: guess.tabSize, indentSize: guess.tabSize };
}

/** One indentation guide: drawn at `column` (1-based visible column), in the active colour or not. */
export interface IndentGuide { column: number; active: boolean }

/**
 * The indentation guides Monaco draws on each line (guides.indentation on, bracket pair guides off).
 * `cursorLine` is the editor's cursor line once the editor has seen a cursor move, else null (Monaco
 * then draws no active guide). Python's language configuration has offSide folding, which decides
 * the level of blank lines.
 */
export function indentGuides(lines: readonly string[], indentation: CodeIndentation, cursorLine: number | null): IndentGuide[][] {
  if (lines.length === 0) return [];
  const part = new GuidesTextModelPart(
    {
      getLineCount:   () => lines.length,
      getLineContent: n => lines[n - 1],
      getOptions:     () => indentation,
      getLanguageId:  () => 'python',
    },
    { getLanguageConfiguration: () => ({ foldingRules: { offSide: true } }) },
  );
  const levels = part.getLinesIndentGuides(1, lines.length);
  const active = cursorLine === null
    ? null
    : part.getActiveIndentGuide(Math.min(Math.max(1, cursorLine), lines.length), 1, lines.length);
  return levels.map((count, i) => {
    const guides: IndentGuide[] = [];
    for (let level = 1; level <= count; level++) {
      guides.push({
        column: (level - 1) * indentation.indentSize + 1,
        active: !!active && active.startLineNumber <= i + 1 && i + 1 <= active.endLineNumber && level === active.indent,
      });
    }
    return guides;
  });
}

/** Colours of the indentation guides under `theme` (editorIndentGuide.background1 / activeBackground1). */
export function indentGuideColors(theme: editor.IStandaloneThemeData): { normal: string; active: string } {
  // - Monaco's registry default for both when no theme sets them: editorWhitespace.foreground
  const fallback = theme.base === 'vs' ? '#33333333' : '#e3e4e229';
  return {
    normal: themeColor(theme, 'editorIndentGuide.background1') ?? fallback,
    active: themeColor(theme, 'editorIndentGuide.activeBackground1') ?? fallback,
  };
}
