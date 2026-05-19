/**
 * useFloatingChat — state, drag, resize, history and message dispatch
 * for the floating AI companion overlay.
 *
 * Persists panel position, size, collapsed state, and conversation history
 * to a sidecar file via the extension host.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
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

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── sidecar persistence ──────────────────────────────────────────────────

  const saveState = useCallback((
    p: FloatingChatPos,
    s: FloatingChatSize,
    c: boolean,
    h: ChatMessage[],
  ) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      postMessage({ type: 'floatingChatSaveState', position: p, size: s, collapsed: c, history: h });
    }, 800);
  }, [postMessage]);

  /** Restore state from sidecar (called by App on sidecarLoaded message). */
  const restoreState = useCallback((
    p?: FloatingChatPos,
    s?: FloatingChatSize,
    c?: boolean,
    h?: ChatMessage[],
  ) => {
    if (p) setPos(p);
    if (s) setSize(s);
    if (c !== undefined) setCollapsed(c);
    if (h) setHistory(h);
  }, []);

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
      setPos(p => { saveState(p, size, collapsed, history); return p; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [pos.x, pos.y, size, collapsed, history, saveState]);

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
      setSize(s => { saveState(pos, s, collapsed, history); return s; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [size, pos, collapsed, history, saveState]);

  // ─── collapse toggle ──────────────────────────────────────────────────────

  const toggleCollapsed = useCallback(() => {
    setCollapsed(c => {
      const next = !c;
      saveState(pos, size, next, history);
      return next;
    });
  }, [pos, size, history, saveState]);

  // ─── Ctrl+` global hotkey ─────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
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
        setHistory(h => {
          const next: ChatMessage[] = [
            ...h,
            { role: 'assistant', content: partial, timestamp: new Date().toISOString() },
          ];
          saveState(pos, size, collapsed, next);
          return next;
        });
      }
      return '';
    });
    setThinking(false);
  }, [pos, size, collapsed, saveState]);

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
      saveState(pos, size, collapsed, next);
      return next;
    });
    setError(null);
    setStreaming('');
    setThinking(true);

    postMessage({ type: 'floatingChatSend', message: trimmed, activeNodeId });
  }, [pos, size, collapsed, saveState, postMessage]);

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
    restoreState,
    sendMessage,
    appendDelta, completeDelta, handleError, addNodeAdded,
  };
}
