// - returns host-rendered HTML for `text` when it contains a `%` (Typst delimiter), OR
// - when the factors theme is active AND it has a fenced code block (so shiki can color
// - it — the in-webview MarkdownRenderer path can't be highlighted). Otherwise null so the
// - caller uses its usual in-webview markdown. Caches by text; the host also caches.
import { useEffect, useRef, useState } from 'react';

const cache = new Map<string, string>();   // - text → html
let seq = 0;

function post(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

type HostHtml = { html: string; of: string };
const NONE = { html: null, of: null } as const;

/**
 * The host-rendered html and the text it was rendered from. While a new text is being rendered the
 * previous html is kept, so `of` tells the caller whether the html is for the text it asked for.
 * `routeBy` is the text whose content picks host or webview rendering; a caller that renders the
 * start of a document passes the whole document, so the start takes the path the whole would.
 */
export function useHostMarkdownOf(text: string, routeBy: string = text): { html: string | null; of: string | null } {
  // - the theme attribute is stamped after nodes mount; recompute routing when it flips
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick(t => t + 1);
    window.addEventListener('skena:mdTheme', on);
    return () => window.removeEventListener('skena:mdTheme', on);
  }, []);

  const factors = typeof document !== 'undefined' && document.documentElement.dataset.mdTheme === 'factors';
  const needs = routeBy.includes('%') || (factors && routeBy.includes('```'));
  const [got, setGot] = useState<HostHtml | null>(() => {
    const cached = needs ? cache.get(text) : undefined;
    return cached === undefined ? null : { html: cached, of: text };
  });
  const reqRef = useRef<string>('');

  useEffect(() => {
    if (!needs) { setGot(null); return; }
    const cached = cache.get(text);
    if (cached !== undefined) {
      setGot(g => (g?.of === text && g.html === cached ? g : { html: cached, of: text }));
      return;
    }
    const requestId = `md-${++seq}`;
    reqRef.current = requestId;
    let settled = false;   // - once the host replies, the fallback must NOT null a good result
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<{ requestId: string; html: string }>).detail;
      if (d.requestId !== requestId) return;
      settled = true;
      clearTimeout(t);
      cache.set(text, d.html);
      if (reqRef.current === requestId) setGot({ html: d.html, of: text });
    };
    window.addEventListener('skena:renderMarkdownResult', onResult);
    post({ type: 'renderMarkdown', requestId, text });
    // - fallback only if the host never answered; a delivered result clears this
    const t = setTimeout(() => { if (!settled && reqRef.current === requestId) setGot(null); }, 2000);
    return () => { window.removeEventListener('skena:renderMarkdownResult', onResult); clearTimeout(t); };
  }, [text, needs]);

  return needs && got ? got : NONE;
}

export function useHostMarkdown(text: string): string | null {
  return useHostMarkdownOf(text).html;
}
