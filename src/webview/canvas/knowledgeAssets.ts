/**
 * The images a knowledge server's text refers to by a uri of its own scheme (crtx://…). Only the
 * host has the server's token, so it fetches them and sends back a data url; here the uri in the
 * rendered text is swapped for that data url. One request per uri for the life of the webview,
 * however many nodes show the same image; a failed one keeps the uri and carries the error in its
 * title.
 */

import { useCallback, useEffect, useState } from 'react';

type Entry = { dataUrl: string } | { error: string } | 'pending';

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let listening = false;

// - requests leave after the render that found them, not during it
const queued: { server: string; uri: string }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function post(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - an absolute uri the webview itself cannot load: the scheme belongs to a knowledge server and
//   the host is the only one that can read it
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\//i;
const WEBVIEW_OWN = /^(https?|data|blob|file|vscode-[a-z-]+):/i;

export function isKnowledgeUri(src: string): boolean {
  return ABSOLUTE.test(src) && !WEBVIEW_OWN.test(src);
}

function flush(): void {
  flushTimer = null;
  for (const q of queued.splice(0)) post({ type: 'knowledgeAsset', server: q.server, uri: q.uri });
}

function lookup(server: string, uri: string): Entry {
  const got = cache.get(uri);
  if (got) return got;
  cache.set(uri, 'pending');
  queued.push({ server, uri });
  flushTimer ??= setTimeout(flush, 0);
  return 'pending';
}

/** - one answer from the host: the image, or why it did not come */
export function receiveAsset(d: { uri: string; dataUrl?: string; error?: string }): void {
  cache.set(d.uri, d.dataUrl ? { dataUrl: d.dataUrl } : { error: d.error ?? 'no image' });
  for (const l of listeners) l();
}

function ensureListener(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('skena:knowledgeAssetResult', (e: Event) => {
    receiveAsset((e as CustomEvent<{ uri: string; dataUrl?: string; error?: string }>).detail);
  });
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const IMG_TAG  = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc=(?:"([^"]*)"|'([^']*)')/i;

/** - host-rendered html: the src of every image the server serves */
export function swapHtmlAssets(html: string, server: string): string {
  return html.replace(IMG_TAG, tag => {
    const m = SRC_ATTR.exec(tag);
    const src = m ? m[1] ?? m[2] ?? '' : '';
    if (!m || !isKnowledgeUri(src)) return tag;
    const got = lookup(server, src);
    if (got === 'pending') return tag;
    const attr = 'dataUrl' in got ? `src="${got.dataUrl}"` : `${m[0]} title="${escapeAttr(got.error)}"`;
    return tag.slice(0, m.index) + attr + tag.slice(m.index + m[0].length);
  });
}

const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** - markdown on its way to the MarkdownRenderer: the path of every image the server serves */
export function swapMarkdownAssets(text: string, server: string): string {
  return text.replace(MD_IMAGE, (whole, alt: string, src: string) => {
    if (!isKnowledgeUri(src)) return whole;
    const got = lookup(server, src);
    if (got === 'pending') return whole;
    // - the markdown title of an image becomes the img's title attribute
    return 'dataUrl' in got ? `![${alt}](${got.dataUrl})` : `![${alt}](${src} "${got.error.replace(/"/g, "'")}")`;
  });
}

/**
 * The two swaps, rebuilt whenever an image arrives so a caller's useMemo runs again.
 */
export function useKnowledgeAssets(server: string): { swapHtml: (html: string) => string; swapMarkdown: (text: string) => string } {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    ensureListener();
    const on = () => setVersion(v => v + 1);
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  // - `version` is in the dependencies on purpose: it changes the identity of these two, which is
  //   what makes a caller's useMemo run again once an image has arrived
  return {
    swapHtml:     useCallback((html: string) => swapHtmlAssets(html, server), [server, version]),
    swapMarkdown: useCallback((text: string) => swapMarkdownAssets(text, server), [server, version]),
  };
}
