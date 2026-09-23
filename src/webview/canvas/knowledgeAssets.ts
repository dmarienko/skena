/**
 * The images a knowledge server's text refers to by a uri of its own scheme (crtx://…). Only the
 * host has the server's token, so it fetches them and sends back a data url; here the uri in the
 * rendered text is swapped for that data url. One request per (server, uri) for the life of the
 * webview, however many nodes show the same image; a failed one keeps the uri and carries the
 * error in its title.
 *
 * A swap runs a regex over the whole text, so a node with several images pays for that on every
 * arrival — and every useKnowledgeAssets caller used to be told about every arrival, anywhere on
 * the canvas. Two things keep that from adding up on a canvas with many knowledge nodes: a
 * subscriber (one per useKnowledgeAssets call) is only told about a uri it has actually looked up,
 * and the swapped string is memoised per (input text, the resolved state of the uris it found)
 * so an unrelated re-render of the same node does not re-run the regex for nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = { dataUrl: string } | { error: string } | 'pending';

/** - one useKnowledgeAssets call: the uris it has asked lookup() for, and how to redraw it */
interface Subscriber { bump: () => void; uris: Set<string> }

// - cache and subscriber uris are keyed by server + uri: two configured servers can otherwise
//   answer the same uri text with two different images
const keyOf = (server: string, uri: string): string => `${server}\u0000${uri}`;

const cache = new Map<string, Entry>();
const subscribers = new Set<Subscriber>();
let listening = false;

// - the data urls held in `cache`, oldest first; the largest single image kept elsewhere (the
//   extension host's own 50 MB) is served here too, but a webview does not keep a second full
//   copy of everything it has ever shown
const WEBVIEW_CACHE_BYTES = 20 * 1024 * 1024;
let cacheBytes = 0;

function sizeOf(e: Entry | undefined): number {
  return e && typeof e === 'object' && 'dataUrl' in e ? e.dataUrl.length : 0;
}

function setCache(key: string, entry: Entry): void {
  cacheBytes += sizeOf(entry) - sizeOf(cache.get(key));
  cache.set(key, entry);
  for (const [oldestKey, oldestEntry] of cache) {
    if (cacheBytes <= WEBVIEW_CACHE_BYTES || cache.size <= 1) break;
    if (oldestKey === key) continue;
    cache.delete(oldestKey);
    cacheBytes -= sizeOf(oldestEntry);
  }
}

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

// - a subscriber that has looked up at least one uri is registered for receiveAsset's bump loop
//   right here, not in useKnowledgeAssets's effect: the first render's lookups happen before that
//   effect has run, and an asset can only arrive after a round trip to the host, so this is always
//   in time regardless
function noteInterest(sub: Subscriber | undefined, key: string): void {
  if (!sub) return;
  sub.uris.add(key);
  subscribers.add(sub);
}

function lookup(server: string, uri: string, sub?: Subscriber): Entry {
  const key = keyOf(server, uri);
  noteInterest(sub, key);
  const got = cache.get(key);
  if (got) return got;
  setCache(key, 'pending');
  queued.push({ server, uri });
  flushTimer ??= setTimeout(flush, 0);
  return 'pending';
}

/** - one answer from the host: the image, or why it did not come */
export function receiveAsset(d: { server: string; uri: string; dataUrl?: string; error?: string }): void {
  const key = keyOf(d.server, d.uri);
  setCache(key, d.dataUrl ? { dataUrl: d.dataUrl } : { error: d.error ?? 'no image' });
  for (const sub of subscribers) if (sub.uris.has(key)) sub.bump();
}

function ensureListener(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('skena:knowledgeAssetResult', (e: Event) => {
    receiveAsset((e as CustomEvent<{ server: string; uri: string; dataUrl?: string; error?: string }>).detail);
  });
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// - text dropped into a generated markdown image title: a bare '"' would end the title early, so
//   it becomes a plain quote; a ')' is escaped too, defensively, in case this string is ever read
//   back as markdown a second time
const escapeMdTitle = (s: string) => s.replace(/"/g, "'").replace(/\)/g, '\\)');

// - a swap is memoised per (server, input string), and invalidated the moment any uri it used no
//   longer maps to the same cache entry. Only the last input matters in practice — the same node
//   re-swaps the same text over and over — so one slot per server+text is plenty; still capped so
//   a canvas where every node has different text does not grow this forever
interface Memo { result: string; refs: [string, Entry][] }
const MEMO_LIMIT = 200;

function remember(store: Map<string, Memo>, key: string, memo: Memo): void {
  store.set(key, memo);
  if (store.size > MEMO_LIMIT) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

function recall(store: Map<string, Memo>, key: string, sub: Subscriber | undefined): string | null {
  const memo = store.get(key);
  if (!memo) return null;
  for (const [k, entry] of memo.refs) if (cache.get(k) !== entry) return null;
  for (const [k] of memo.refs) noteInterest(sub, k);
  return memo.result;
}

const IMG_TAG    = /<img\b[^>]*>/gi;
const SRC_ATTR   = /\bsrc=(?:"([^"]*)"|'([^']*)')/i;
const TITLE_ATTR = /\s*\btitle=(?:"[^"]*"|'[^']*')/i;

// - replace whatever title the tag already carries (there is at most one, malformed input aside)
//   and put the new one right after src, so a repeated swap never leaves two title attributes
function withErrorTitle(tag: string, error: string): string {
  const stripped = tag.replace(TITLE_ATTR, '');
  const mm = SRC_ATTR.exec(stripped);
  if (!mm) return stripped;
  return stripped.slice(0, mm.index) + `${mm[0]} title="${escapeAttr(error)}"` + stripped.slice(mm.index + mm[0].length);
}

const htmlMemo = new Map<string, Memo>();

/** - host-rendered html: the src of every image the server serves */
export function swapHtmlAssets(html: string, server: string, sub?: Subscriber): string {
  const memoKey = keyOf(server, html);
  const hit = recall(htmlMemo, memoKey, sub);
  if (hit !== null) return hit;

  const refs: [string, Entry][] = [];
  const result = html.replace(IMG_TAG, tag => {
    const m = SRC_ATTR.exec(tag);
    const src = m ? m[1] ?? m[2] ?? '' : '';
    if (!m || !isKnowledgeUri(src)) return tag;
    const got = lookup(server, src, sub);
    refs.push([keyOf(server, src), got]);
    if (got === 'pending') return tag;
    if ('dataUrl' in got) return tag.slice(0, m.index) + `src="${escapeAttr(got.dataUrl)}"` + tag.slice(m.index + m[0].length);
    return withErrorTitle(tag, got.error);
  });
  remember(htmlMemo, memoKey, { result, refs });
  return result;
}

// - a markdown image: ![alt](path), with an optional "title" or 'title' after the path
const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)"|\s+'([^']*)')?\s*\)/g;

const mdMemo = new Map<string, Memo>();

/** - markdown on its way to the MarkdownRenderer: the path of every image the server serves */
export function swapMarkdownAssets(text: string, server: string, sub?: Subscriber): string {
  const memoKey = keyOf(server, text);
  const hit = recall(mdMemo, memoKey, sub);
  if (hit !== null) return hit;

  const refs: [string, Entry][] = [];
  const result = text.replace(MD_IMAGE, (whole, alt: string, src: string, dq: string | undefined, sq: string | undefined) => {
    if (!isKnowledgeUri(src)) return whole;
    const got = lookup(server, src, sub);
    refs.push([keyOf(server, src), got]);
    if (got === 'pending') return whole;
    const title = dq ?? sq;
    if ('dataUrl' in got) return `![${alt}](${got.dataUrl}${title !== undefined ? ` "${escapeMdTitle(title)}"` : ''})`;
    return `![${alt}](${src} "${escapeMdTitle(got.error)}")`;
  });
  remember(mdMemo, memoKey, { result, refs });
  return result;
}

/**
 * The two swaps, rebuilt whenever an image this subscriber asked for arrives.
 */
export function useKnowledgeAssets(server: string): { swapHtml: (html: string) => string; swapMarkdown: (text: string) => string } {
  const [tick, setTick] = useState(0);
  const subRef = useRef<Subscriber>();
  // - built on first render, not in the effect below: swapHtml/swapMarkdown run during render, and
  //   uris found there must land in this set before the effect has had a chance to run
  subRef.current ??= { bump: () => setTick(t => t + 1), uris: new Set() };

  useEffect(() => {
    ensureListener();
    const sub = subRef.current!;
    return () => { subscribers.delete(sub); };
  }, []);

  // - `tick` is in the dependencies on purpose: it changes the identity of these two, which is
  //   what makes a caller's useMemo run again, and only fires for a uri this subscriber looked up
  return {
    swapHtml:     useCallback((html: string) => swapHtmlAssets(html, server, subRef.current), [server, tick]),
    swapMarkdown: useCallback((text: string) => swapMarkdownAssets(text, server, subRef.current), [server, tick]),
  };
}
