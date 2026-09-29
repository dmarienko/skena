/**
 * CodeRenderer — syntax highlighted code using Shiki.
 * Shiki runs at bundle time or lazily; here we use the async highlighter
 * with a single VS Code Dark+ theme to match the editor.
 *
 * NOTE: Shiki's highlighter is created once and cached module-level.
 */

import React, { useEffect, useState } from 'react';
import { createHighlighter, Highlighter, type BundledLanguage, type BundledTheme } from 'shiki';
import { FACTORS_THEME } from '../lib/codeHighlight';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      // - dark-plus for the default theme; factors palette when that theme is active
      themes: ['dark-plus', FACTORS_THEME],
      // - only languages we actually preview in canvas nodes
      langs:  ['python', 'yaml'],
    });
  }
  return highlighterPromise;
}

interface CodeRendererProps {
  content:  string;
  language: string;
}

export function CodeRenderer({ content, language }: CodeRendererProps): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  // - re-highlight when the markdown theme flips (data-md-theme set/changed after mount)
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const on = () => setThemeTick(t => t + 1);
    window.addEventListener('skena:mdTheme', on);
    return () => window.removeEventListener('skena:mdTheme', on);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const theme = document.documentElement.dataset.mdTheme === 'factors' ? 'factors' : 'dark-plus';
    getHighlighter().then(hl => {
      if (cancelled) return;
      const highlighted = hl.codeToHtml(content, { lang: language, theme });
      setHtml(highlighted);
    }).catch(() => setHtml(null));
    return () => { cancelled = true; };
  }, [content, language, themeTick]);

  if (html) {
    return (
      <div
        className="skena-code"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ fontSize: 11, lineHeight: 1.5, overflow: 'auto' }}
      />
    );
  }

  // - fallback while Shiki loads
  return (
    <pre style={{ fontSize: 11, lineHeight: 1.5, overflow: 'auto', color: 'var(--vscode-foreground)', opacity: 0.85 }}>
      {content}
    </pre>
  );
}

/** One coloured run of a highlighted line. */
export interface CodeToken { content: string; color?: string; italic: boolean; bold?: boolean; underline?: boolean }

/** `content` highlighted: one array of runs per line, and the theme's default text colour. */
export interface HighlightedCode { lines: CodeToken[][]; fg: string }

function currentCodeTheme(): 'factors' | 'dark-plus' {
  return document.documentElement.dataset.mdTheme === 'factors' ? 'factors' : 'dark-plus';
}

// - highlighted results by (theme, language, text), so a remounted preview of unchanged code draws
// - its colours in the first frame instead of after the async highlighter
const highlightCache = new Map<string, HighlightedCode>();
const HIGHLIGHT_CACHE_MAX = 400;

// - line breaks as the editor splits lines, so the editor's text and the preview's share one key
function normalizeBreaks(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function highlightKey(content: string, language: string): string {
  return `${currentCodeTheme()}\u0000${language}\u0000${normalizeBreaks(content)}`;
}

/** The highlighted `content` if it was highlighted before under the current theme, else undefined. */
export function cachedHighlight(content: string, language: string): HighlightedCode | undefined {
  return highlightCache.get(highlightKey(content, language));
}

/** Highlights `content` and keeps the result for cachedHighlight. Rejects when shiki does not know `language`. */
export function highlightCode(content: string, language: string): Promise<HighlightedCode> {
  const theme = currentCodeTheme();
  const key = highlightKey(content, language);
  const hit = highlightCache.get(key);
  if (hit) return Promise.resolve(hit);
  return getHighlighter().then(hl => {
    // - the typed options list shiki's bundled names only; `factors` is registered by object above
    const lines = hl.codeToTokensBase(normalizeBreaks(content), { lang: language as BundledLanguage, theme: theme as BundledTheme });
    const result: HighlightedCode = {
      // - fontStyle is a bit set (1 italic, 2 bold, 4 underline), and -1 when the theme sets none
      lines: lines.map(line => line.map(t => {
        const style = Number(t.fontStyle ?? 0);
        return { content: t.content, color: t.color, italic: style > 0 && (style & 1) === 1, bold: style > 0 && (style & 2) === 2, underline: style > 0 && (style & 4) === 4 };
      })),
      fg: hl.getTheme(theme).fg,
    };
    if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) highlightCache.delete(highlightCache.keys().next().value as string);
    highlightCache.set(key, result);
    return result;
  });
}

/**
 * `content` highlighted with the highlighter and theme the code preview uses, for a caller that draws
 * its own lines. Drawn from the cache in the first render when it was highlighted before; otherwise
 * null until the highlighter is ready, or for good when it does not know `language`.
 */
export function useHighlightedCode(content: string, language: string): HighlightedCode | null {
  const [themeTick, setThemeTick] = useState(0);
  const [, setDone] = useState(0);
  useEffect(() => {
    const on = () => setThemeTick(t => t + 1);
    window.addEventListener('skena:mdTheme', on);
    return () => window.removeEventListener('skena:mdTheme', on);
  }, []);

  const hit = cachedHighlight(content, language);
  useEffect(() => {
    if (hit) return;
    let cancelled = false;
    highlightCode(content, language).then(() => { if (!cancelled) setDone(n => n + 1); }).catch(() => {});
    return () => { cancelled = true; };
  }, [content, language, themeTick, hit]);

  return hit ?? null;
}

/** `content` split into lines of coloured runs (see useHighlightedCode). */
export function useCodeTokens(content: string, language: string): CodeToken[][] | null {
  return useHighlightedCode(content, language)?.lines ?? null;
}
