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

import React, { useEffect, useState } from 'react';
import { CanvasView } from './canvas/CanvasView';
import { useCanvasData } from './hooks/useCanvasData';
import { HostToWebview } from '../shared/types';

type VsCodeApi = { postMessage: (msg: unknown) => void };

function getVsCodeApi(): VsCodeApi {
  return (window as unknown as Record<string, VsCodeApi>)['vscodeApi'];
}

export function App(): JSX.Element {
  const { canvas, canvasPath, dispatch } = useCanvasData();
  const [ready, setReady] = useState(false);

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

  return <CanvasView canvas={canvas} canvasPath={canvasPath} />;
}
