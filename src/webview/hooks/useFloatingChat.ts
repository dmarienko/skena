/**
 * useFloatingChat — state, drag, resize, history and message dispatch
 * for the floating AI companion overlay.
 *
 * History and UI state (pos/size/collapsed) persist via workspaceState
 * through the extension host. Canvas nodes are the semantic memory.
 */

import { useState, useCallback, useEffect } from 'react';
import { ChatMessage } from '../../shared/types';

// ─── types ────────────────────────────────────────────────────────────────────

export interface FloatingChatPos  { x: number; y: number }
export interface FloatingChatSize { w: number; h: number }

const DEFAULT_SIZE: FloatingChatSize = { w: 620, h: 400 };

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
  const [collapsed, setCollapsed] = useState(false);
  const [history,   setHistory]   = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');       // - partial current assistant reply
  const [thinking,  setThinking]  = useState(false);   // - waiting for first token
  const [error,     setError]     = useState<string | null>(null);

  // ─── UI state persistence ─────────────────────────────────────────────────

  const saveUIState = useCallback((
    p: FloatingChatPos,
    s: FloatingChatSize,
    c: boolean,
  ) => {
    postMessage({ type: 'floatingChatSaveUIState', collapsed: c, pos: p, size: s });
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
      if (e.altKey && e.key === '`') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleCollapsed]);

  // ─── incoming streaming tokens ────────────────────────────────────────────

  const appendDelta = useCallback((delta: string) => {
    setThinking(false);
    setStreaming(s => s + delta);
  }, []);

  const completeDelta = useCallback(() => {
    setStreaming(partial => {
      if (partial) {
        setHistory(h => [
          ...h,
          { role: 'assistant', content: partial, timestamp: new Date().toISOString() },
        ]);
      }
      return '';
    });
    setThinking(false);
  }, []);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setThinking(false);
    setStreaming('');
  }, []);

  // ─── send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback((text: string, activeNodeId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      role:      'user',
      content:   trimmed,
      timestamp: new Date().toISOString(),
    };
    setHistory(h => {
      const next = [...h, userMsg];
      // - send full history with the message so the host can reconstruct context
      // - without reading any sidecar; history is session-only
      postMessage({ type: 'floatingChatSend', message: trimmed, activeNodeId, history: next });
      return next;
    });
    setError(null);
    setStreaming('');
    setThinking(true);
  }, [postMessage]);

  // ─── restore full state from workspaceState on canvas open ──────────────

  const restoreHistory = useCallback((payload: {
    history:   ChatMessage[];
    collapsed?: boolean;
    pos?:       FloatingChatPos;
    size?:      FloatingChatSize;
  }) => {
    setHistory(payload.history);
    if (payload.collapsed !== undefined) setCollapsed(payload.collapsed);
    if (payload.pos)  setPos(payload.pos);
    if (payload.size) setSize(payload.size);
  }, []);

  // ─── node added by AI ────────────────────────────────────────────────────

  const addNodeAdded = useCallback((note: string) => {
    // - add a small system notification into the chat history so the user sees it
    setHistory(h => [...h, {
      role:      'assistant',
      content:   `📌 *Added to canvas:*\n\n${note}`,
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  return {
    pos, size, collapsed,
    history, streaming, thinking, error,
    onHeaderMouseDown, onResizeMouseDown,
    toggleCollapsed,
    sendMessage,
    appendDelta, completeDelta, handleError, addNodeAdded,
    restoreHistory,
  };
}
