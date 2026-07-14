// - returns host-rendered HTML for `text` ONLY when it contains a `%` (Typst delimiter);
// - otherwise null so the caller renders with its usual in-webview markdown (zero cost).
// - Caches by text so reopen/scroll/re-render don't re-request; the host also caches.
import { useEffect, useRef, useState } from 'react';

const cache = new Map<string, string>();   // - text → html
let seq = 0;

function post(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function useHostMarkdown(text: string): string | null {
  const needs = text.includes('%');
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
