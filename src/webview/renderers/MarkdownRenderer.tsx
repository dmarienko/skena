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
 * A src with a scheme (http:, https:, data:, a knowledge server's crtx:) renders
 * as written.
 */

import React, { useMemo, memo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { useFileContent } from '../hooks/useFileContent';
import { useMarkdownConfig } from '../context/MarkdownConfigContext';
import { normalizeMathDelimiters } from '../../shared/mathDelims';

interface MarkdownRendererProps {
  content: string;
  /** - canvas URI of the .md file, used to resolve relative image paths */
  baseUri?: string;
}

// - an absolute uri of any scheme: http:, data:, and a knowledge server's own crtx:. None of them
//   is a path to resolve, so the img renders with the src as written
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

// - react-markdown's own defaultUrlTransform drops any src whose scheme is not http(s), ircs,
//   mailto or xmpp — a knowledge server's own scheme (crtx://…) comes back "", so the img element
//   never carries the uri knowledgeAssets.ts is waiting to resolve. An img src gets one relaxation:
//   a data:image/… url, or any other scheme:// that is not javascript:, vbscript: or data:text/html
//   (the ones defaultUrlTransform already exists to keep out) passes through unchanged. href stays
//   on the default transform, so a link to a dangerous scheme is still blocked.
const IMG_SRC_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const BLOCKED_IMG_SCHEME = new Set(['data', 'javascript', 'vbscript', 'http', 'https']);

const knowledgeUrlTransform: UrlTransform = (url, key, node) => {
  if (key === 'src' && node.tagName === 'img') {
    if (/^data:image\//i.test(url)) return url;
    const scheme = IMG_SRC_SCHEME.exec(url)?.[1]?.toLowerCase();
    if (scheme && !BLOCKED_IMG_SCHEME.has(scheme)) return url;
  }
  return defaultUrlTransform(url);
};

function resolveImageSrc(src: string, baseUri: string | undefined): string | null {
  if (!src || ABSOLUTE.test(src)) return null;
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
    img: ({ src, alt, title }: React.HTMLProps<HTMLImageElement>) => {
      const resolved = resolveImageSrc(src ?? '', baseUri);
      if (resolved === null) {
        // - title carries the reason an image the host could not read stays broken
        return <img src={src} alt={alt ?? ''} title={title} style={{ maxWidth: '100%', display: 'block' }} />;
      }
      return <InlineImage uri={resolved} alt={alt ?? ''} />;
    },
  }), [baseUri]);

  const fontStyle: React.CSSProperties = {};
  if (fontFamily) fontStyle.fontFamily = fontFamily;
  if (fontSize)   fontStyle.fontSize   = fontSize;

  // - rewrite \(…\) / \[…\] LaTeX delimiters to $ / $$ so remark-math renders them (papers exported
  //   without dollar signs)
  const mdContent = useMemo(() => normalizeMathDelimiters(content), [content]);

  return (
    <div className="skena-markdown" style={fontStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rehypePlugins={[rehypeRaw, [rehypeKatex, { output: 'html', throwOnError: false } as any]]}
        components={components}
        urlTransform={knowledgeUrlTransform}
      >
        {mdContent}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererInner);
