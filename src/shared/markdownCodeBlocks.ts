/**
 * Fenced code blocks in host-rendered markdown, coloured by shiki in the factors palette. The webview
 * runs this on a node's html under the factors markdown theme (webview/lib/codeHighlight.ts), and the
 * HTML export runs it on the host. Pure, given a highlighter that has the factors theme and the
 * languages loaded.
 */

import type { HighlighterCore } from 'shiki/core';

export const FACTORS_THEME = {
  name: 'factors',
  type: 'dark' as const,
  // - shiki derives the <pre> bg/fg from these top-level fields; without them it falls
  // - back to a red error colour (#ff161d / #ff0000). Keep in sync with colors[] below.
  bg: '#0f161d',
  fg: '#c7d1cc',
  colors: { 'editor.background': '#0f161d', 'editor.foreground': '#c7d1cc' },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#56635d', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control'], settings: { foreground: '#4cc8a0' } },
    { scope: ['string', 'string.quoted', 'constant.character'], settings: { foreground: '#d9a23f' } },
    { scope: ['constant.numeric', 'constant.language', 'constant.language.boolean'], settings: { foreground: '#e5707a' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: '#e8efeb' } },
    { scope: ['entity.name.class', 'support.type', 'support.class', 'entity.name.type'], settings: { foreground: '#4cc8a0' } },
    { scope: ['keyword.operator'], settings: { foreground: '#7c8a84' } },
    { scope: ['variable.parameter', 'variable.other'], settings: { foreground: '#c7d1cc' } },
  ],
};

/** - the languages a fenced block is coloured in; any other block stays plain */
export const MARKDOWN_CODE_LANGS = ['python', 'javascript', 'typescript', 'bash', 'json', 'yaml', 'sql', 'rust', 'go', 'markdown'];
const ALIAS: Record<string, string> = { sh: 'bash', zsh: 'bash', shell: 'bash', py: 'python', ts: 'typescript', js: 'javascript', yml: 'yaml', md: 'markdown', rs: 'rust', golang: 'go' };

// - the host escapes code content; undo it to recover the source shiki will re-highlight
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');   // - last, so &amp;lt; → &lt;
}

// - matches a fenced code block emitted by the host markdown pipeline
const CODE_RE = /<pre><code class="[^"]*\blanguage-([\w+-]+)[^"]*">([\s\S]*?)<\/code><\/pre>/g;

/** - true when `html` has a fenced block with a language */
export function hasCodeBlocks(html: string): boolean {
  return html.includes('language-');
}

/** `html` with every fenced block in a loaded language replaced by shiki's factors-coloured html. */
export function highlightCodeBlocks(html: string, hl: Pick<HighlighterCore, 'codeToHtml' | 'getLoadedLanguages'>): string {
  const matches = [...html.matchAll(CODE_RE)];
  if (matches.length === 0) return html;
  const loaded = new Set(hl.getLoadedLanguages());
  let out = html;
  // - splice from last match to first so earlier match indices stay valid
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const lang = ALIAS[m[1].toLowerCase()] ?? m[1].toLowerCase();
    if (!loaded.has(lang)) continue;
    let shiki: string;
    try { shiki = hl.codeToHtml(decodeEntities(m[2]), { lang, theme: 'factors' }); }
    catch { continue; }
    out = out.slice(0, m.index) + shiki + out.slice((m.index as number) + m[0].length);
  }
  return out;
}
