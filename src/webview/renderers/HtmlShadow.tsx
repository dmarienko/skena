import React, { useRef, useEffect } from 'react';

/**
 * Renders a full standalone HTML document (a dropped .html file) inside a shadow
 * root. A flat dangerouslySetInnerHTML would flatten the doc's <style> blocks into
 * the page and their global body/ * / :root rules leak into the whole webview —
 * shifting the canvas and forcing style recalc on every node. The shadow root scopes
 * those rules to this subtree. Scripts do not run: assigning innerHTML never executes
 * <script> (same as dangerouslySetInnerHTML).
 */
export function HtmlShadow({ html }: { html: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // - attachShadow throws if called twice; reuse the existing root
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;
  }, [html]);

  return <div ref={hostRef} className="skena-html" />;
}
