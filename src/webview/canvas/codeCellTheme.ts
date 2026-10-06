/**
 * The code cells' colours in the webview: the skena.code.theme setting applied to the code cell
 * editor (python's Monaco tokens provider, the skena-code theme) and to its preview, with the shiki
 * highlighter of the markdown code blocks.
 *
 * Monaco has one theme for the whole page: the last editor created sets it for every editor. The code
 * cell tokens are named by look (codeCellShiki.codeTokenName) and their rules go into every theme skena
 * defines, so a code cell keeps its colours whichever theme is applied; skena-code also carries the note
 * editors' rules, so markdown in a note or the chat input keeps its colours while skena-code is applied.
 */

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { editor } from 'monaco-editor';
import { language as pythonMonarch } from 'monaco-editor/esm/vs/basic-languages/python/python.js';
import { bundledThemes, type BundledTheme } from 'shiki';
import { highlighter } from '../lib/codeHighlight';
import { skenaCodeTheme } from './codeCellMonaco';
import {
  CODE_THEME_FACTORS, codeTokenizer, codeTokenRules, codeTokensProvider, resolveCodeTheme, shikiCodeTheme, tokenizeCodeLines,
  type CodeToken, type CodeTokenizer,
} from './codeCellShiki';

/** Fired on window when the code cells' colours change: a code theme has loaded, or the setting changed. */
export const CODE_THEME_EVENT = 'skena:codeTheme';

// - Monaco loads its python tokenizer on first request; tokenize() gives plain tokens until then
let pythonReady = false;
let pythonReadyPromise: Promise<void> | null = null;

/** Whether Monaco's python tokenizer has loaded. */
export function pythonTokenizerLoaded(): boolean {
  return pythonReady;
}

/** Resolves once Monaco's python tokenizer is loaded. */
export function whenPythonTokenizerReady(): Promise<void> {
  if (!pythonReadyPromise) {
    // - colorize awaits the tokenizer (TokenizationRegistry.getOrCreate) before it resolves
    pythonReadyPromise = monaco.editor.colorize('', 'python', {}).then(
      () => { pythonReady = true; },
      err => { pythonReady = true; console.warn('[skena] python tokenizer', err); },
    );
  }
  return pythonReadyPromise;
}

// - the theme the setting names, and the shiki tokenizer the cells use (null: Monaco's python tokenizer
// - and the factors palette, under `factors`, before the theme has loaded, or when it failed to)
let wanted: string | null = null;
let tokenizer: CodeTokenizer | null = null;
let applying: Promise<void> = Promise.resolve();

/** Applies the skena.code.theme setting (App, on the host's codeConfig message). */
export function setCodeTheme(value: unknown): void {
  const theme = resolveCodeTheme(value, Object.keys(bundledThemes));
  if (typeof value === 'string' && value !== theme) {
    console.warn(`[skena] skena.code.theme "${value}" is neither a shiki theme id nor factors; using ${theme}`);
  }
  if (theme === wanted) return;
  wanted = theme;
  applying = applyCodeTheme(theme);
}

async function applyCodeTheme(theme: string): Promise<void> {
  if (theme === CODE_THEME_FACTORS) {
    switchTokenizer(null);
    return;
  }
  try {
    // - Monaco's python tokenizer registers itself once loaded: load it first, so it cannot replace ours later
    await whenPythonTokenizerReady();
    const hl = await highlighter();
    if (!hl.getLoadedThemes().includes(theme)) await hl.loadTheme(theme as BundledTheme);
    if (wanted === theme) switchTokenizer(codeTokenizer(hl, theme));
  } catch (err) {
    console.warn(`[skena] code theme ${theme} did not load; code cells keep their colours from before skena.code.theme`, err);
    if (wanted === theme) switchTokenizer(null);
  }
}

/** Resolves once the code cell editor's tokenizer for the current setting is in place. */
export function whenCodeTokenizerReady(): Promise<void> {
  return applying.then(whenPythonTokenizerReady);
}

function switchTokenizer(next: CodeTokenizer | null): void {
  const had = tokenizer;
  tokenizer = next;
  previewTokens.clear();
  // - rules first, so the names the new tokenizer gives already have their colours
  defineThemes();
  if (next) monaco.languages.setTokensProvider('python', codeTokensProvider(next));
  else if (had) monaco.languages.setMonarchTokensProvider('python', pythonMonarch);
  window.dispatchEvent(new CustomEvent(CODE_THEME_EVENT));
}

/** The background the code cell editor paints (skena-code's editor.background). */
export function codeCellBackground(dark: boolean): string {
  const bg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
  return bg || (dark ? '#1e1e1e' : '#ffffff');
}

// - the note editors' themes as TextNode / ChatInput define them, and the code cell's arguments
const editorThemes = new Map<string, editor.IStandaloneThemeData>();
let codeCell: { dark: boolean; bg: string } | null = null;
// - the code cell token rules for a tokenizer and background, and what each note editor theme was last defined with
let codeRules: { tokenizer: CodeTokenizer | null; bg: string; rules: editor.ITokenThemeRule[] } | null = null;
const definedWith = new Map<string, { data: editor.IStandaloneThemeData; rules: editor.ITokenThemeRule[] }>();

function currentCodeRules(bg: string): editor.ITokenThemeRule[] {
  if (!codeRules || codeRules.tokenizer !== tokenizer || codeRules.bg !== bg) {
    codeRules = { tokenizer, bg, rules: tokenizer ? codeTokenRules(tokenizer.colors, bg) : [] };
  }
  return codeRules.rules;
}

function defineThemes(): void {
  const dark = codeCell?.dark ?? (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'));
  const rules = currentCodeRules(codeCell?.bg ?? codeCellBackground(dark));
  for (const [name, data] of editorThemes) {
    // - redefining the theme Monaco applies makes every editor tokenize again: only when something changed
    const last = definedWith.get(name);
    if (last && last.data === data && last.rules === rules) continue;
    definedWith.set(name, { data, rules });
    monaco.editor.defineTheme(name, { ...data, rules: [...data.rules, ...rules] });
  }
  if (!codeCell) return;
  const ui = skenaCodeTheme(codeCell.dark, document.documentElement.dataset.mdTheme === 'factors', codeCell.bg);
  const notes = editorThemes.get('skena-editor')?.rules ?? [];
  monaco.editor.defineTheme('skena-code', tokenizer ? shikiCodeTheme(ui, [...notes, ...rules]) : ui);
}

/** Defines a note editor's theme (skena-editor, TextNode / ChatInput): `data` plus the code cell token rules. */
export function defineEditorTheme(name: string, data: editor.IStandaloneThemeData): void {
  editorThemes.set(name, data);
  defineThemes();
}

/** Defines skena-code, the code cell editor's theme (CodeNode beforeMount). */
export function defineCodeCellTheme(dark: boolean): void {
  codeCell = { dark, bg: codeCellBackground(dark) };
  defineThemes();
}

// - the code theme's tokens by cell text, so a remounted preview of unchanged code draws them at once
const previewTokens = new Map<string, CodeToken[][]>();
const PREVIEW_TOKENS_MAX = 400;

/**
 * The code theme's tokens of `lines` (`text` is them joined by line breaks), as the editor gets them;
 * null while the cells use Monaco's python tokenizer.
 */
export function codeCellTokens(lines: readonly string[], text: string): CodeToken[][] | null {
  if (!tokenizer) return null;
  let hit = previewTokens.get(text);
  if (!hit) {
    try {
      hit = tokenizeCodeLines(tokenizer, lines);
    } catch (err) {
      console.warn('[skena] code cell tokens', err);
      return null;
    }
    if (previewTokens.size >= PREVIEW_TOKENS_MAX) previewTokens.delete(previewTokens.keys().next().value as string);
    previewTokens.set(text, hit);
  }
  return hit;
}

/** The code theme's default text colour, or null while the cells use Monaco's python tokenizer. */
export function codeCellForeground(): string | null {
  return tokenizer?.fg ?? null;
}
