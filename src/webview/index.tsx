/**
 * Webview entry point — mounts the React app into #root.
 * Acquires the VS Code API handle (single call, stored globally).
 *
 * Monaco setup (must happen before any @monaco-editor/react import):
 *  1. MonacoEnvironment.getWorker — returns a fake worker so Monaco doesn't try
 *     to spawn real web workers (not needed for basic markdown/text editing and
 *     avoids requiring worker-src in the webview CSP).
 *  2. loader.config({ monaco }) — use the locally bundled Monaco instead of the
 *     default CDN (CDN is blocked by the webview Content Security Policy).
 */

// - step 1: suppress Monaco workers before Monaco initialises
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
(self as unknown as Record<string, unknown>)['MonacoEnvironment'] = {
  // - return a stub Worker; Monaco falls back to synchronous mode for language
  // - features — syntax highlighting still works (runs in the main thread)
  getWorker: (): Worker => ({
    postMessage:         () => {},
    terminate:           () => {},
    addEventListener:    () => {},
    removeEventListener: () => {},
    dispatchEvent:       () => false,
    onmessage:           null,
    onmessageerror:      null,
    onerror:             null,
  } as unknown as Worker),
};

// - step 2: tell @monaco-editor/react to use our bundled Monaco, not the CDN
import { loader } from '@monaco-editor/react';
loader.config({ monaco });

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/canvas.css';
import './styles/markdown.css';
import 'katex/dist/katex.min.css';

// - VS Code API is injected by the webview host at runtime
declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

// - acquire once and expose globally so hooks can post messages
const vscodeApi = acquireVsCodeApi();
(window as unknown as Record<string, unknown>)['vscodeApi'] = vscodeApi;

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
