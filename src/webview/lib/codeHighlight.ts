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
import { FACTORS_THEME, MARKDOWN_CODE_LANGS, hasCodeBlocks, highlightCodeBlocks } from '../../shared/markdownCodeBlocks';

export { FACTORS_THEME };

let _hl: Promise<Highlighter> | null = null;
/** The one shiki highlighter of the markdown code blocks, shared with the code cells (codeCellTheme). */
export function highlighter(): Promise<Highlighter> {
  if (!_hl) _hl = createHighlighter({ themes: [FACTORS_THEME], langs: MARKDOWN_CODE_LANGS });
  return _hl;
}

/**
 * Kick off shiki's (WASM) init during idle so the first code node doesn't pay it
 * mid-interaction. Safe to call repeatedly; no-op once warm. Call under factors theme.
 */
export function warmCodeHighlighter(): void {
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
    ?? ((cb: () => void) => setTimeout(cb, 200));
  idle(() => { void highlighter(); });
}

const cache = new Map<string, string>();   // - rawHtml → highlighted html

async function highlightHtml(html: string): Promise<string> {
  if (!hasCodeBlocks(html)) return html;
  let hl: Highlighter;
  try { hl = await highlighter(); } catch { return html; }
  return highlightCodeBlocks(html, hl);
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
  const [, setHighlighted] = useState(0);

  useEffect(() => {
    if (!html || !needs || cache.has(html)) return;
    let cancelled = false;
    void highlightHtml(html).then(h => { cache.set(html, h); if (!cancelled) setHighlighted(n => n + 1); });
    return () => { cancelled = true; };
  }, [html, needs]);

  // - derived in the render, not held in state, so a new html is what the caller gets in the same
  //   render (plain until its highlighted copy is cached), never the previous html for one render
  if (!html) return null;
  return needs ? cache.get(html) ?? html : html;
}
