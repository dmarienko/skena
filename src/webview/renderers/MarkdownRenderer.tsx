/**
 * Markdown renderer using react-markdown + remark-gfm.
 * Used for: TextNode inline content, CellNode markdown cells.
 *
 * FileNode markdown is pre-rendered to HTML by the extension host
 * (see markdown-html.ts) and injected via dangerouslySetInnerHTML,
 * so this component is NOT used for file-based markdown content.
 *
 * Images: relative src paths (./img.png, ../assets/logo.svg) are resolved
 * relative to baseUri (the markdown file's canvas URI), then fetched through
 * useFileContent to obtain a vscode-resource:// URI the webview sandbox allows.
 * External http/https/data: URIs render directly.
 */

import React, { useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useFileContent } from '../hooks/useFileContent';
import { useMarkdownConfig } from '../context/MarkdownConfigContext';

interface MarkdownRendererProps {
  content: string;
  /** - canvas URI of the .md file, used to resolve relative image paths */
  baseUri?: string;
}

function resolveImageSrc(src: string, baseUri: string | undefined): string | null {
  if (
    !src ||
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:') ||
    src.startsWith('blob:')
  ) {
    return null;
  }
  if (!baseUri) return null;

  let dir = '';
  if (baseUri.startsWith('vault://')) {
    const lastSlash = baseUri.lastIndexOf('/');
    dir = lastSlash > 'vault://x'.length ? baseUri.slice(0, lastSlash + 1) : baseUri + '/';
  } else {
    const normalized = baseUri.startsWith('./') ? baseUri.slice(2) : baseUri;
    const lastSlash = normalized.lastIndexOf('/');
    dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  }

  const cleanSrc = src.startsWith('./') ? src.slice(2) : src;

  if (cleanSrc.startsWith('../')) {
    const parentDir = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    const lastSlash = parentDir.lastIndexOf('/');
    const upperDir = lastSlash >= 0 ? parentDir.slice(0, lastSlash + 1) : '';
    return upperDir + cleanSrc.slice(3);
  }

  return dir + cleanSrc;
}

function InlineImage({ uri, alt }: { uri: string; alt: string }): JSX.Element {
  const { status, resourceUri, error } = useFileContent(uri);
  if (status === 'idle' || status === 'loading') {
    return <span style={{ opacity: 0.3, fontSize: '0.75em' }}>[…]</span>;
  }
  if (!resourceUri) {
    const detail = status === 'error' ? `error: ${error}` : `loaded, no resourceUri`;
    return <span style={{ opacity: 0.4, fontSize: '0.75em' }} title={`${uri} — ${detail}`}>[img?]</span>;
  }
  return <img src={resourceUri} alt={alt} style={{ maxWidth: '100%', display: 'block' }} />;
}

function MarkdownRendererInner({ content, baseUri }: MarkdownRendererProps): JSX.Element {
  const { fontFamily, fontSize } = useMarkdownConfig();

  const components = useMemo(() => ({
    a: ({ href, children }: React.HTMLProps<HTMLAnchorElement>) => (
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
    img: ({ src, alt }: React.HTMLProps<HTMLImageElement>) => {
      const resolved = resolveImageSrc(src ?? '', baseUri);
      if (resolved === null) {
        return <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', display: 'block' }} />;
      }
      return <InlineImage uri={resolved} alt={alt ?? ''} />;
    },
  }), [baseUri]);

  const fontStyle: React.CSSProperties = {};
  if (fontFamily) fontStyle.fontFamily = fontFamily;
  if (fontSize)   fontStyle.fontSize   = fontSize;

  return (
    <div className="skena-markdown" style={fontStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rehypePlugins={[[rehypeKatex, { output: 'mathml', throwOnError: false } as any]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);
