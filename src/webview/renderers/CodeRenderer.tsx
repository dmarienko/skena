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
export interface CodeToken { content: string; color?: string; italic: boolean }

/**
 * `content` split into lines of coloured runs, with the highlighter and theme the code preview uses,
 * for a caller that draws its own lines. Null until the highlighter is ready, or when it does not
 * know `language`.
 */
export function useCodeTokens(content: string, language: string): CodeToken[][] | null {
  const [tokens, setTokens] = useState<CodeToken[][] | null>(null);
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
      // - the typed options list shiki's bundled names only; `factors` is registered by object above
      const lines = hl.codeToTokensBase(content, { lang: language as BundledLanguage, theme: theme as BundledTheme });
      // - fontStyle is a bit set, and -1 when the theme sets none
      setTokens(lines.map(line => line.map(t => {
        const style = Number(t.fontStyle ?? 0);
        return { content: t.content, color: t.color, italic: style > 0 && (style & 1) === 1 };
      })));
    }).catch(() => { if (!cancelled) setTokens(null); });
    return () => { cancelled = true; };
  }, [content, language, themeTick]);

  return tokens;
}
