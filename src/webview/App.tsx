/**
 * App root — subscribes to host messages, bootstraps canvas state,
 * renders CanvasView once canvas data is loaded.
 *
 * Handshake flow:
 *   1. React mounts, registers message listener
 *   2. Sends { type: 'webviewReady' } to host
 *   3. Host receives ready, sends { type: 'canvasLoaded', ... }
 *   4. App switches from loading screen to CanvasView
 */

import React, { useEffect, useState, useRef } from 'react';
import { CanvasView } from './canvas/CanvasView';
import { useCanvasData } from './hooks/useCanvasData';
import { HostToWebview, MarkdownConfig } from '../shared/types';
import { MarkdownConfigContext, DEFAULT_MARKDOWN_CONFIG } from './context/MarkdownConfigContext';

type VsCodeApi = { postMessage: (msg: unknown) => void };

function getVsCodeApi(): VsCodeApi {
  return (window as unknown as Record<string, VsCodeApi>)['vscodeApi'];
}

/** - inject / update <link> tags for user-configured markdown.styles CSS URLs */
function syncMarkdownStyleLinks(urls: string[]): void {
  const ATTR = 'data-skena-md-style';

  // - remove links that are no longer in the list
  document.head.querySelectorAll<HTMLLinkElement>(`link[${ATTR}]`).forEach(el => {
    if (!urls.includes(el.href)) el.remove();
  });

  // - add new links for URLs not yet present
  const existing = new Set(
    Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[${ATTR}]`)).map(el => el.href)
  );
  for (const url of urls) {
    if (!existing.has(url)) {
      const link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = url;
      link.setAttribute(ATTR, '');
      document.head.appendChild(link);
    }
  }
}

export function App(): JSX.Element {
  const { canvas, canvasPath, dispatch } = useCanvasData();
  const [ready, setReady] = useState(false);
  const [mdConfig, setMdConfig] = useState<MarkdownConfig>(DEFAULT_MARKDOWN_CONFIG);
  // - track injected style URLs so we can clean up on config change
  const styleUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebview>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'canvasLoaded':
          dispatch({ type: 'SET_CANVAS', canvas: msg.canvas, canvasPath: msg.canvasPath });
          setReady(true);
          break;
        case 'canvasChanged':
          // - host will follow up with canvasLoaded after reload
          setReady(false);
          break;
        case 'vaultIndex':
          dispatch({ type: 'SET_VAULT_INDEX', entries: msg.entries });
          break;
        case 'markdownConfig': {
          setMdConfig(msg.config);
          // - inject / remove <link> tags for external CSS URLs
          const urls = msg.config.styles.filter(s => s.startsWith('http'));
          syncMarkdownStyleLinks(urls);
          styleUrlsRef.current = urls;
          break;
        }
        case 'fileContent':
        case 'fileError':
          // - forwarded to useFileContent hooks via a custom event
          window.dispatchEvent(new CustomEvent('skena:fileResponse', { detail: msg }));
          break;
        case 'fileChanged':
          console.log('[Skena webview] fileChanged received, uri:', msg.uri);
          dispatch({ type: 'FILE_CHANGED', uri: msg.uri });
          window.dispatchEvent(new CustomEvent('skena:fileInvalidated', { detail: msg.uri }));
          break;
        case 'searchResults':
          window.dispatchEvent(new CustomEvent('skena:searchResults', { detail: msg }));
          break;
        case 'nodesFromDrop':
          window.dispatchEvent(new CustomEvent('skena:nodesFromDrop', { detail: msg.nodes }));
          break;
        case 'chatChunk':
        case 'agentNodeCreated':
          window.dispatchEvent(new CustomEvent('skena:chat', { detail: msg }));
          break;
      }
    };

    window.addEventListener('message', handler);

    // - signal host that we are mounted and ready to receive canvas data
    getVsCodeApi().postMessage({ type: 'webviewReady' });

    return () => window.removeEventListener('message', handler);
  }, [dispatch]);

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--vscode-foreground)', opacity: 0.5 }}>
        Loading canvas...
      </div>
    );
  }

  return (
    <MarkdownConfigContext.Provider value={mdConfig}>
      <CanvasView canvas={canvas} canvasPath={canvasPath} />
    </MarkdownConfigContext.Provider>
  );
}
