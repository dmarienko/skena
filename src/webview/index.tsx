/**
 * Webview entry point — mounts the React app into #root.
 * Acquires the VS Code API handle (single call, stored globally).
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/canvas.css';
import './styles/markdown.css';

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
