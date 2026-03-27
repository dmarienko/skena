/**
 * Markdown renderer using react-markdown + remark-gfm.
 * Supports: headings, tables, code blocks, bold/italic, lists, images.
 *
 * Images: relative src paths (./img.png, ../assets/logo.svg) are resolved
 * relative to baseUri (the markdown file's canvas URI), then fetched through
 * useFileContent to obtain a vscode-resource:// URI the webview sandbox allows.
 * External http/https/data: URIs render directly.
 */

import React, { useMemo } from 'react';
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

/**
 * Resolve a markdown image src against the base URI of the containing file.
 * Returns the resolved canvas URI (e.g. "docs/logo.png") to pass to useFileContent,
 * or null if the src is an external/data URL that can render directly.
 */
function resolveImageSrc(src: string, baseUri: string | undefined): string | null {
  if (
    !src ||
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:') ||
    src.startsWith('blob:')
  ) {
    return null; // - external/data URIs: render as-is, no fetch needed
  }
  if (!baseUri) return null;

  // - get the directory component of the base file's URI
  let dir = '';
  if (baseUri.startsWith('vault://')) {
    // - vault://name/path/to/file.md → dir = "vault://name/path/to/"
    const lastSlash = baseUri.lastIndexOf('/');
    dir = lastSlash > 'vault://x'.length ? baseUri.slice(0, lastSlash + 1) : baseUri + '/';
  } else {
    // - project-relative: "docs/readme.md" → dir = "docs/"
    const normalized = baseUri.startsWith('./') ? baseUri.slice(2) : baseUri;
    const lastSlash = normalized.lastIndexOf('/');
    dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  }

  // - strip leading ./ from src
  const cleanSrc = src.startsWith('./') ? src.slice(2) : src;

  // - handle one level of ../ traversal
  if (cleanSrc.startsWith('../')) {
    const parentDir = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    const lastSlash = parentDir.lastIndexOf('/');
    const upperDir = lastSlash >= 0 ? parentDir.slice(0, lastSlash + 1) : '';
    return upperDir + cleanSrc.slice(3);
  }

  return dir + cleanSrc;
}

/** - renders a single inline image by fetching it through useFileContent */
function InlineImage({ uri, alt }: { uri: string; alt: string }): JSX.Element {
  const { status, resourceUri, error } = useFileContent(uri);
  if (status === 'idle' || status === 'loading') {
    return <span style={{ opacity: 0.3, fontSize: '0.75em' }}>[…]</span>;
  }
  if (!resourceUri) {
    // - show status + error in tooltip to diagnose what went wrong
    const detail = status === 'error' ? `error: ${error}` : `loaded, no resourceUri`;
    return <span style={{ opacity: 0.4, fontSize: '0.75em' }} title={`${uri} — ${detail}`}>[img?]</span>;
  }
  return <img src={resourceUri} alt={alt} style={{ maxWidth: '100%', display: 'block' }} />;
}

export function MarkdownRenderer({ content, baseUri }: MarkdownRendererProps): JSX.Element {
  const { fontFamily, fontSize } = useMarkdownConfig();

  // - memoize components so React preserves InlineImage identity across re-renders:
  // - if components.img is a new function reference each render, React unmounts and
  // - remounts InlineImage, resetting its useFileContent state → persistent [img]
  const components = useMemo(() => ({
    // - open links in VS Code browser instead of webview navigation
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
    // - intercept images: resolve relative paths → fetch via useFileContent (data URI)
    img: ({ src, alt }: React.HTMLProps<HTMLImageElement>) => {
      const resolved = resolveImageSrc(src ?? '', baseUri);
      if (resolved === null) {
        // - external / data URI — render directly (CSP allows data: and https:)
        return <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', display: 'block' }} />;
      }
      return <InlineImage uri={resolved} alt={alt ?? ''} />;
    },
  }), [baseUri]);

  // - apply VS Code markdown.preview.* font settings when provided
  const fontStyle: React.CSSProperties = {};
  if (fontFamily) fontStyle.fontFamily = fontFamily;
  if (fontSize)   fontStyle.fontSize   = fontSize;

  return (
    <div className="skena-markdown" style={fontStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
