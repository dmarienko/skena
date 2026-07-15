/**
 * App root — subscribes to host messages, bootstraps canvas state,
 * renders CanvasView once canvas data is loaded, and mounts the
 * floating AI companion overlay.
 *
 * Handshake flow:
 *   1. React mounts, registers message listener
 *   2. Sends { type: 'webviewReady' } to host
 *   3. Host receives ready, sends { type: 'canvasLoaded', ... }
 *   4. App switches from loading screen to CanvasView + FloatingChat
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CanvasView } from './canvas/CanvasView';
import { FloatingChat } from './canvas/FloatingChat';
import { useCanvasData } from './hooks/useCanvasData';
import { HostToWebview, MarkdownConfig, ChatToolEvent, ChatTokenUsage } from '../shared/types';
import { MarkdownConfigContext, DEFAULT_MARKDOWN_CONFIG } from './context/MarkdownConfigContext';
import { warmCodeHighlighter } from './lib/codeHighlight';

type VsCodeApi = { postMessage: (msg: unknown) => void };

function getVsCodeApi(): VsCodeApi {
  return (window as unknown as Record<string, VsCodeApi>)['vscodeApi'];
}

function postMessage(msg: unknown) {
  getVsCodeApi().postMessage(msg);
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

// ─── simple event bus helpers for FloatingChat callbacks ─────────────────────

type Unsubscribe = () => void;
type Handler<T> = (arg: T) => void;

function makeEventTarget<T>(): {
  emit: (v: T) => void;
  subscribe: (h: Handler<T>) => Unsubscribe;
} {
  let handler: Handler<T> | null = null;
  return {
    emit: (v: T) => handler?.(v),
    subscribe: (h: Handler<T>) => {
      handler = h;
      return () => { if (handler === h) handler = null; };
    },
  };
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function App(): JSX.Element {
  const { canvas, canvasPath, dispatch } = useCanvasData();
  const [ready,    setReady]    = useState(false);
  const [mdConfig, setMdConfig] = useState<MarkdownConfig>(DEFAULT_MARKDOWN_CONFIG);
  const styleUrlsRef = useRef<string[]>([]);

  // - active node id exposed to FloatingChat (updated by CanvasView via callback)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  // - current AI model/provider shown in the chat title
  const [chatModel, setChatModel] = useState<{ model: string; provider: string } | null>(null);

  // - event buses for FloatingChat incoming messages
  const deltaEvt     = useRef(makeEventTarget<string>());
  const doneEvt      = useRef(makeEventTarget<{ costUsd?: number; deltaUsd?: number }>());
  const errorEvt     = useRef(makeEventTarget<string>());
  const resetDoneEvt = useRef(makeEventTarget<void>());
  const nodeAddedEvt    = useRef(makeEventTarget<string>());
  const toolEventEvt = useRef(makeEventTarget<ChatToolEvent>());
  const usageEvt     = useRef(makeEventTarget<ChatTokenUsage>());
  const historyRestoredEvt = useRef(makeEventTarget<{
    history:    unknown[];
    collapsed?: boolean;
    pos?:       { x: number; y: number };
    size?:      { w: number; h: number };
  }>());

  // ─── markdown link clicks (host-rendered HTML) ─────────────────────────
  // - host-rendered markdown (Typst/code text nodes, .md file nodes, chat) is injected as
  // - raw HTML, so its <a> links have no React handler. Delegate at the document (bubble
  // - phase): if a MarkdownRenderer link already handled it, defaultPrevented is set → skip.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!a || !a.closest('.skena-markdown')) return;
      const href = a.getAttribute('href');   // - raw href, not the browser-resolved URL
      if (!href) return;
      e.preventDefault();
      (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']
        ?.postMessage({ type: 'openFile', uri: href });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // ─── host message handler ─────────────────────────────────────────────

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebview>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'canvasLoaded':
          dispatch({ type: 'SET_CANVAS', canvas: msg.canvas, canvasPath: msg.canvasPath });
          setReady(true);
          break;
        case 'canvasChanged':
          setReady(false);
          break;
        case 'vaultIndex':
          dispatch({ type: 'SET_VAULT_INDEX', entries: msg.entries });
          break;
        case 'markdownConfig': {
          setMdConfig(msg.config);
          // - stamp the theme on the root so scoped CSS ([data-md-theme=…]) applies everywhere
          document.documentElement.dataset.mdTheme = msg.config.theme ?? 'vscode';
          // - nodes mount before this arrives; nudge the code highlighter to (re)run
          window.dispatchEvent(new CustomEvent('skena:mdTheme', { detail: msg.config.theme ?? 'vscode' }));
          // - warm shiki on idle so its WASM init doesn't hitch the first pan/interaction
          if (msg.config.theme === 'factors') warmCodeHighlighter();
          const urls = msg.config.styles.filter(s => s.startsWith('http'));
          syncMarkdownStyleLinks(urls);
          styleUrlsRef.current = urls;
          break;
        }
        case 'fileContent':
        case 'fileError':
          window.dispatchEvent(new CustomEvent('skena:fileResponse', { detail: msg }));
          break;
        case 'fileChanged':
          dispatch({ type: 'FILE_CHANGED', uri: msg.uri });
          window.dispatchEvent(new CustomEvent('skena:fileInvalidated', { detail: msg.uri }));
          break;
        case 'searchResults':
          window.dispatchEvent(new CustomEvent('skena:searchResults', { detail: msg }));
          break;
        case 'nodesFromDrop':
          window.dispatchEvent(new CustomEvent('skena:nodesFromDrop', { detail: { nodes: msg.nodes, connectTo: msg.connectTo } }));
          break;
        case 'addNodeResult':
          window.dispatchEvent(new CustomEvent('skena:addNodeResult', { detail: msg }));
          break;
        case 'verifyPathResult':
          window.dispatchEvent(new CustomEvent('skena:verifyPathResult', { detail: msg }));
          break;
        case 'addNodeTrigger':
          window.dispatchEvent(new CustomEvent('skena:addNodeTrigger'));
          break;
        case 'addTextNodeTrigger':
          window.dispatchEvent(new CustomEvent('skena:addTextNodeTrigger', { detail: { direction: msg.direction } }));
          break;
        case 'subCanvasCreated':
          window.dispatchEvent(new CustomEvent('skena:subCanvasCreated', { detail: msg }));
          break;
        case 'clipboardContent':
          window.dispatchEvent(new CustomEvent('skena:clipboardContent', { detail: msg.text }));
          break;
        case 'chatChunk':
        case 'agentNodeCreated':
          window.dispatchEvent(new CustomEvent('skena:chat', { detail: msg }));
          break;

        // ── Floating chat events ──
        case 'floatingChatDelta':
          deltaEvt.current.emit(msg.delta);
          break;
        case 'floatingChatToolEvent':
          toolEventEvt.current.emit(msg.event);
          break;
        case 'floatingChatUsage':
          usageEvt.current.emit(msg.usage);
          break;
        case 'floatingChatDone':
          doneEvt.current.emit({ costUsd: msg.costUsd, deltaUsd: msg.deltaUsd });
          break;
        case 'floatingChatError':
          errorEvt.current.emit(msg.message);
          break;
        case 'floatingChatResetDone':
          resetDoneEvt.current.emit();
          break;
        case 'floatingChatNodeAdded': {
          // - add node to canvas state so it appears immediately
          dispatch({ type: 'ADD_NODE', node: msg.node });
          if (msg.edge) dispatch({ type: 'ADD_EDGE', edge: msg.edge });
          // - notify FloatingChat so it can display a bubble
          const noteContent = msg.node.type === 'text'
            ? (msg.node as { text?: string }).text ?? ''
            : `[${msg.node.type} node added]`;
          nodeAddedEvt.current.emit(noteContent);
          break;
        }
        case 'floatingChatHistoryRestored':
          historyRestoredEvt.current.emit({
            history:   msg.history,
            collapsed: msg.collapsed,
            pos:       msg.pos,
            size:      msg.size,
          });
          break;
        case 'marksRestored':
          window.dispatchEvent(new CustomEvent('skena:marksRestored', { detail: msg.marks }));
          break;
        case 'panelActivated':
          window.dispatchEvent(new CustomEvent('skena:panelActivated'));
          break;
        case 'chatModelInfo':
          setChatModel({ model: msg.model, provider: msg.provider });
          break;
        case 'floatingChatCompacting':
          window.dispatchEvent(new CustomEvent('skena:compacting', { detail: msg.active }));
          break;
        case 'renderMarkdownResult':
          window.dispatchEvent(new CustomEvent('skena:renderMarkdownResult', { detail: { requestId: msg.requestId, html: msg.html } }));
          break;
      }
    };

    window.addEventListener('message', handler);
    getVsCodeApi().postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
  }, [dispatch]);

  // ─── active node callback from CanvasView ──────────────────────────────

  const handleActiveNodeChange = useCallback((nodeId: string | null, _label: string | null) => {
    setActiveNodeId(nodeId);
  }, []);

  // ─── render ───────────────────────────────────────────────────────────

  // - FloatingChat is always mounted (outside the ready guard) so its state
  // - survives canvas reloads (canvasChanged → canvasLoaded) without resetting.
  // - Unmounting it would reset useFloatingChat to collapsed:false every reload.
  return (
    <MarkdownConfigContext.Provider value={mdConfig}>
      {ready ? (
        <CanvasView
          canvas={canvas}
          canvasPath={canvasPath}
          onActiveNodeChange={handleActiveNodeChange}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--vscode-foreground)', opacity: 0.5 }}>
          Loading canvas...
        </div>
      )}
      <FloatingChat
        activeNodeId={activeNodeId}
        model={chatModel?.model}
        provider={chatModel?.provider}
        postMessage={postMessage}
        onDelta={deltaEvt.current.subscribe}
        onDone={doneEvt.current.subscribe}
        onError={errorEvt.current.subscribe}
        onResetDone={resetDoneEvt.current.subscribe}
        onNodeAdded={nodeAddedEvt.current.subscribe}
        onHistoryRestored={historyRestoredEvt.current.subscribe}
        onToolEvent={toolEventEvt.current.subscribe}
        onUsage={usageEvt.current.subscribe}
      />
    </MarkdownConfigContext.Provider>
  );
}
