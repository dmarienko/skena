/**
 * Markdown renderer using react-markdown + remark-gfm.
 * Supports: headings, tables, code blocks, bold/italic, lists, images.
 * Images: resolved relative paths are blocked in webview — only data: URIs render.
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): JSX.Element {
  return (
    <div className="skena-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // - open links in VS Code browser instead of webview navigation
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={e => {
                e.preventDefault();
                if (href) {
                  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage({ type: 'openFile', uri: href });
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
