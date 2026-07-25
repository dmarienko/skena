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

export function useHostMarkdown(text: string): string | null {
  // - the theme attribute is stamped after nodes mount; recompute routing when it flips
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick(t => t + 1);
    window.addEventListener('skena:mdTheme', on);
    return () => window.removeEventListener('skena:mdTheme', on);
  }, []);

  const factors = typeof document !== 'undefined' && document.documentElement.dataset.mdTheme === 'factors';
  const needs = text.includes('%') || (factors && text.includes('```'));
  const [html, setHtml] = useState<string | null>(() => (needs ? cache.get(text) ?? null : null));
  const reqRef = useRef<string>('');

  useEffect(() => {
    if (!needs) { setHtml(null); return; }
    const cached = cache.get(text);
    if (cached !== undefined) { setHtml(cached); return; }
    const requestId = `md-${++seq}`;
    reqRef.current = requestId;
    let settled = false;   // - once the host replies, the fallback must NOT null a good result
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<{ requestId: string; html: string }>).detail;
      if (d.requestId !== requestId) return;
      settled = true;
      clearTimeout(t);
      cache.set(text, d.html);
      if (reqRef.current === requestId) setHtml(d.html);
    };
    window.addEventListener('skena:renderMarkdownResult', onResult);
    post({ type: 'renderMarkdown', requestId, text });
    // - fallback only if the host never answered; a delivered result clears this
    const t = setTimeout(() => { if (!settled && reqRef.current === requestId) setHtml(null); }, 2000);
    return () => { window.removeEventListener('skena:renderMarkdownResult', onResult); clearTimeout(t); };
  }, [text, needs]);

  return needs ? html : null;
}
