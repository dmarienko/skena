/**
 * The export's shiki highlighter on the host: the code cell theme the skena.code.theme setting names,
 * the factors palette of the markdown code blocks, dark-plus of the python and yaml file previews,
 * and the languages of all three. shiki/core with only these, so the extension bundle does not carry
 * every grammar.
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { bundledThemes } from 'shiki/themes';
import { FACTORS_THEME } from '../../shared/markdownCodeBlocks';
import { CODE_THEME_FACTORS, resolveCodeTheme } from '../../webview/canvas/codeCellShiki';

export interface ExportHighlighter {
  hl: HighlighterCore;
  /** - the theme code cells are drawn in: a bundled theme id, or `factors` for the factors palette */
  codeTheme: string;
}

/** - the setting as the webview resolves it; `factors` draws code cells in the factors shiki palette */
export async function exportHighlighter(setting: unknown): Promise<ExportHighlighter> {
  const codeTheme = resolveCodeTheme(setting, Object.keys(bundledThemes));
  const themes = [FACTORS_THEME, bundledThemes['dark-plus']];
  if (codeTheme !== CODE_THEME_FACTORS && codeTheme !== 'dark-plus') themes.push(bundledThemes[codeTheme as keyof typeof bundledThemes]);
  const hl = await createHighlighterCore({
    themes,
    langs: [
      import('shiki/langs/python.mjs'), import('shiki/langs/javascript.mjs'), import('shiki/langs/typescript.mjs'),
      import('shiki/langs/bash.mjs'), import('shiki/langs/json.mjs'), import('shiki/langs/yaml.mjs'),
      import('shiki/langs/sql.mjs'), import('shiki/langs/rust.mjs'), import('shiki/langs/go.mjs'),
      import('shiki/langs/markdown.mjs'),
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
  return { hl, codeTheme };
}
