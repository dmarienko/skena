/**
 * Webview-side syntax highlighting for markdown code blocks (factors theme).
 *
 * Reuses shiki — already bundled for CodeRenderer — so this adds no host cost.
 * The host renders code as <pre><code class="language-x">…</code></pre>; after that
 * HTML is injected we swap each block for shiki output in the factors palette.
 * Only runs when the factors markdown theme is active. Never throws.
 */

import { createHighlighter, type Highlighter } from 'shiki';
import { useEffect, useRef } from 'react';

const FACTORS_THEME = {
  name: 'factors',
  type: 'dark' as const,
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

const LANGS = ['python', 'javascript', 'typescript', 'bash', 'json', 'yaml', 'sql', 'rust', 'go', 'markdown'];
const ALIAS: Record<string, string> = { sh: 'bash', zsh: 'bash', shell: 'bash', py: 'python', ts: 'typescript', js: 'javascript', yml: 'yaml', md: 'markdown', rs: 'rust', golang: 'go' };

let _hl: Promise<Highlighter> | null = null;
function highlighter(): Promise<Highlighter> {
  if (!_hl) _hl = createHighlighter({ themes: [FACTORS_THEME], langs: LANGS });
  return _hl;
}

async function highlightContainer(el: HTMLElement): Promise<void> {
  const blocks = Array.from(el.querySelectorAll<HTMLElement>('pre > code[class*="language-"]'));
  if (blocks.length === 0) return;
  let hl: Highlighter;
  try { hl = await highlighter(); } catch { return; }
  const loaded = new Set(hl.getLoadedLanguages());
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) continue;
    const raw = (/language-([\w+-]+)/.exec(code.className)?.[1] ?? '').toLowerCase();
    const lang = ALIAS[raw] ?? raw;
    if (!loaded.has(lang)) continue;   // - unknown language → leave the themed-but-plain block
    try {
      pre.outerHTML = hl.codeToHtml(code.textContent ?? '', { lang, theme: 'factors' });
    } catch { /* - keep plain block */ }
  }
}

/**
 * Ref for a container holding host-rendered markdown. When `html` changes and the
 * factors theme is active, highlights its code blocks in place. No-op otherwise.
 */
export function useCodeHighlight(html: string | null | undefined): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.documentElement.dataset.mdTheme !== 'factors') return;
    if (!html || !html.includes('language-')) return;
    void highlightContainer(el);
  }, [html]);
  return ref;
}
