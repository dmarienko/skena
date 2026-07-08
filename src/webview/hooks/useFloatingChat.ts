/**
 * useFloatingChat — state, drag, resize, history and message dispatch
 * for the floating AI companion overlay.
 *
 * History and UI state (pos/size/collapsed) persist via workspaceState
 * through the extension host. Canvas nodes are the semantic memory.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatItem, ChatToolEvent, ChatTokenUsage, ViewportSnapshot } from '../../shared/types';
import { applyToolEvent, flushPendingText, migrateHistory } from '../canvas/chat/chatTimeline';

// ─── types ────────────────────────────────────────────────────────────────────

export interface FloatingChatPos  { x: number; y: number }
export interface FloatingChatSize { w: number; h: number }

const DEFAULT_SIZE: FloatingChatSize = { w: 620, h: 400 };
const DEFAULT_INPUT_W = 240;   // - initial input-column width; user-adjustable via splitter

function defaultPos(): FloatingChatPos {
  return {
    x: Math.max(0, Math.round((window.innerWidth  - DEFAULT_SIZE.w) / 2)),
    y: Math.max(0, window.innerHeight - DEFAULT_SIZE.h - 20),
  };
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useFloatingChat(postMessage: (msg: unknown) => void) {
  const [pos,       setPos]       = useState<FloatingChatPos>(defaultPos);
  const [size,      setSize]      = useState<FloatingChatSize>(DEFAULT_SIZE);
  const [inputW,    setInputW]    = useState(DEFAULT_INPUT_W);
  const [collapsed, setCollapsed] = useState(false);
  const [history,   setHistory]   = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState('');       // - partial current assistant reply
  const [thinking,  setThinking]  = useState(false);   // - waiting for first token
  const [error,     setError]     = useState<string | null>(null);
  const [usage,     setUsage]     = useState<ChatTokenUsage | null>(null);   // - live token usage for running turn

  // - refs mirror history + streaming so completion handlers can build the next
  // - state without nested setState updaters (and persist it to the host)
  const historyRef   = useRef<ChatItem[]>([]);
  const streamingRef = useRef('');
  const usageRef     = useRef<ChatTokenUsage | null>(null);
  const inputWRef    = useRef(DEFAULT_INPUT_W);   // - mirror so saveUIState needn't depend on inputW

  const persistHistory = useCallback((h: ChatItem[]) => {
    postMessage({ type: 'floatingChatPersistHistory', history: h });
  }, [postMessage]);

  // ─── UI state persistence ─────────────────────────────────────────────────

  const saveUIState = useCallback((
    p: FloatingChatPos,
    s: FloatingChatSize,
    c: boolean,
  ) => {
    postMessage({ type: 'floatingChatSaveUIState', collapsed: c, pos: p, size: s, inputW: inputWRef.current });
  }, [postMessage]);

  // ─── drag ─────────────────────────────────────────────────────────────────

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;

    const onMove = (me: MouseEvent) => {
      setPos(prev => {
        const nx = Math.max(0, Math.min(window.innerWidth  - size.w,  me.clientX - startX));
        const ny = Math.max(0, Math.min(window.innerHeight - 40,      me.clientY - startY));
        return { x: nx, y: ny };
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      setPos(p => { saveUIState(p, size, collapsed); return p; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [pos.x, pos.y, size, collapsed, saveUIState]);

  // ─── resize ───────────────────────────────────────────────────────────────

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.w;
    const startH = size.h;

    const onMove = (me: MouseEvent) => {
      const nw = Math.max(280, startW + (me.clientX - startX));
      const nh = Math.max(200, startH + (me.clientY - startY));
      setSize({ w: nw, h: nh });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      setSize(s => { saveUIState(pos, s, collapsed); return s; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [size, pos, collapsed, saveUIState]);

  // ─── input/output splitter ────────────────────────────────────────────────

  const onSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = inputWRef.current;

    const onMove = (me: MouseEvent) => {
      // - clamp so both columns stay usable
      const nw = Math.max(140, Math.min(size.w - 180, startW + (me.clientX - startX)));
      inputWRef.current = nw;
      setInputW(nw);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      saveUIState(pos, size, collapsed);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [size, pos, collapsed, saveUIState]);

  // ─── collapse toggle ──────────────────────────────────────────────────────

  const toggleCollapsed = useCallback(() => {
    setCollapsed(c => {
      const next = !c;
      saveUIState(pos, size, next);
      return next;
    });
  }, [pos, size, saveUIState]);

  // ─── Ctrl+` global hotkey ─────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // - match key OR code: some layouts emit a dead-key for Alt+` so e.key isn't '`'
      if (e.altKey && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        e.stopPropagation();
        toggleCollapsed();
      }
    };
    // - capture phase: Monaco stopPropagation()s keydown when focused, so a
    // - bubble-phase listener never fires while the chat input has focus
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [toggleCollapsed]);

  // ─── incoming streaming tokens ────────────────────────────────────────────

  const appendDelta = useCallback((delta: string) => {
    setThinking(false);
    streamingRef.current += delta;
    setStreaming(s => s + delta);
  }, []);

  // - fold a display tool/thinking event into the timeline (flushes pending text first)
  const applyTool = useCallback((e: ChatToolEvent) => {
    setThinking(false);
    const r = applyToolEvent(historyRef.current, streamingRef.current, e, new Date().toISOString());
    streamingRef.current = r.pending;
    setStreaming(r.pending);
    historyRef.current = r.items;
    setHistory(r.items);
    persistHistory(r.items);
  }, [persistHistory]);

  const applyUsage = useCallback((u: ChatTokenUsage) => { usageRef.current = u; setUsage(u); }, []);

  const completeDelta = useCallback((cost?: { costUsd?: number; deltaUsd?: number }) => {
    const flushed = flushPendingText(historyRef.current, streamingRef.current, new Date().toISOString(), cost);
    streamingRef.current = '';
    setStreaming('');
    setThinking(false);
    setUsage(null); usageRef.current = null;
    // - any card still running at turn end (aborted mid-tool) → mark error
    const closed = flushed.map(it => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error' as const } : it));
    historyRef.current = closed;
    setHistory(closed);
    persistHistory(closed);
  }, [persistHistory]);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setThinking(false);
    streamingRef.current = '';
    setStreaming('');
  }, []);

  // - clear the visible conversation (Reset button; host clears persistence + process)
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    streamingRef.current = '';
    setHistory([]);
    setStreaming('');
    setThinking(false);
    setError(null);
    setUsage(null); usageRef.current = null;
  }, []);

  // ─── send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback((text: string, activeNodeId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatItem = {
      kind:      'text',
      role:      'user',
      content:   trimmed,
      timestamp: new Date().toISOString(),
    };
    const next = [...historyRef.current, userMsg];
    historyRef.current = next;
    setHistory(next);
    // - snapshot what the user currently sees (zoom, on-screen nodes, scroll)
    const viewport = (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport?.();
    // - send full history with the message so the host can reconstruct context
    // - without reading any sidecar; history is session-only
    postMessage({ type: 'floatingChatSend', message: trimmed, activeNodeId, history: next, viewport });
    setError(null);
    streamingRef.current = '';
    setStreaming('');
    setThinking(true);
  }, [postMessage]);

  // ─── restore full state from workspaceState on canvas open ──────────────

  const restoreHistory = useCallback((payload: {
    history:   unknown[];
    collapsed?: boolean;
    pos?:       FloatingChatPos;
    size?:      FloatingChatSize;
    inputW?:    number;
  }) => {
    const migrated = migrateHistory(payload.history);
    historyRef.current = migrated;
    setHistory(migrated);
    if (payload.collapsed !== undefined) setCollapsed(payload.collapsed);
    if (payload.pos)  setPos(payload.pos);
    if (payload.size) setSize(payload.size);
    if (payload.inputW) { inputWRef.current = payload.inputW; setInputW(payload.inputW); }
  }, []);

  // ─── node added by AI ────────────────────────────────────────────────────

  const addNodeAdded = useCallback((note: string) => {
    // - add a small system notification into the chat history so the user sees it
    const next: ChatItem[] = [...historyRef.current, {
      kind:      'text',
      role:      'assistant',
      content:   `📌 *Added to canvas:*\n\n${note}`,
      timestamp: new Date().toISOString(),
    }];
    historyRef.current = next;
    setHistory(next);
    persistHistory(next);
  }, [persistHistory]);

  return {
    pos, size, collapsed, inputW,
    history, streaming, thinking, error, usage,
    onHeaderMouseDown, onResizeMouseDown, onSplitMouseDown,
    toggleCollapsed,
    sendMessage,
    appendDelta, completeDelta, handleError, addNodeAdded,
    applyTool, applyUsage,
    restoreHistory, clearHistory,
  };
}
