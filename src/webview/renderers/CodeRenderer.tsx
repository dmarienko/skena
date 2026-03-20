/**
 * CodeRenderer — syntax highlighted code using Shiki.
 * Shiki runs at bundle time or lazily; here we use the async highlighter
 * with a single VS Code Dark+ theme to match the editor.
 *
 * NOTE: Shiki's highlighter is created once and cached module-level.
 */

import React, { useEffect, useState } from 'react';
import { createHighlighter, Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['dark-plus'],
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

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then(hl => {
      if (cancelled) return;
      const highlighted = hl.codeToHtml(content, { lang: language, theme: 'dark-plus' });
      setHtml(highlighted);
    }).catch(() => setHtml(null));
    return () => { cancelled = true; };
  }, [content, language]);

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
