/**
 * Webview-side syntax highlighting for markdown code blocks (factors theme).
 *
 * Reuses shiki — already bundled for CodeRenderer — so this adds no host cost.
 * The host renders code as <pre><code class="language-x">…</code></pre>. We rewrite the
 * HTML STRING (targeted per code block, leaving the rest incl. Typst SVGs untouched) and
 * the caller injects the result. Highlighting the string rather than mutating the DOM
 * post-render means a remount (React Flow unmounts off-screen nodes) re-injects the
 * already-highlighted HTML from cache instead of losing the colors. Only runs under the
 * factors theme. Never throws.
 */

import { createHighlighter, type Highlighter } from 'shiki';
import { useEffect, useState } from 'react';

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

// - the host escapes code content; undo it to recover the source shiki will re-highlight
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');   // - last, so &amp;lt; → &lt;
}

// - matches a fenced code block emitted by the host markdown pipeline
const CODE_RE = /<pre><code class="[^"]*\blanguage-([\w+-]+)[^"]*">([\s\S]*?)<\/code><\/pre>/g;

const cache = new Map<string, string>();   // - rawHtml → highlighted html

async function highlightHtml(html: string): Promise<string> {
  const matches = [...html.matchAll(CODE_RE)];
  if (matches.length === 0) return html;
  let hl: Highlighter;
  try { hl = await highlighter(); } catch { return html; }
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
    out = out.slice(0, m.index) + shiki + out.slice(m.index! + m[0].length);
  }
  return out;
}

/**
 * Given host-rendered markdown HTML, returns it with code blocks syntax-highlighted
 * when the factors theme is active (else the input unchanged). Async — returns the raw
 * HTML first, then the highlighted version once shiki resolves; cached by input string
 * so remounts inject the highlighted HTML immediately.
 */
export function useHighlightedHtml(html: string | null | undefined): string | null {
  // - data-md-theme is stamped after nodes mount; bump on the event so `needs` recomputes
  const [, setThemeTick] = useState(0);
  useEffect(() => {
    const onTheme = () => setThemeTick(t => t + 1);
    window.addEventListener('skena:mdTheme', onTheme);
    return () => window.removeEventListener('skena:mdTheme', onTheme);
  }, []);

  const active = typeof document !== 'undefined' && document.documentElement.dataset.mdTheme === 'factors';
  const needs = active && !!html && html.includes('language-');
  const [out, setOut] = useState<string | null>(() =>
    !html ? null : needs ? (cache.get(html) ?? html) : html,
  );

  useEffect(() => {
    if (!html) { setOut(null); return; }
    if (!needs) { setOut(html); return; }
    const cached = cache.get(html);
    if (cached) { setOut(cached); return; }
    let cancelled = false;
    setOut(html);   // - show plain immediately; upgrade when ready
    void highlightHtml(html).then(h => { cache.set(html, h); if (!cancelled) setOut(h); });
    return () => { cancelled = true; };
  }, [html, needs]);

  return out;
}
