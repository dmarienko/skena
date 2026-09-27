// - state and host messages for the docked chat console. History, width and folded state persist
// - per canvas through the host's workspaceState.
import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatItem, ChatToolEvent, ChatTokenUsage, ViewportSnapshot } from '../../shared/types';
import { ChatAttachment, mergeAttachments, removeAttachment as withoutAttachment } from '../../shared/chatAttachments';
import { applyToolEvent, flushPendingText, migrateHistory } from '../canvas/chat/chatTimeline';
import { NODE_ADDED_PREFIX } from '../canvas/chat/chatTurns';
import { DEFAULT_CONSOLE_WIDTH } from '../canvas/chat/consoleLayout';

export interface RestoredChat {
  history: unknown[];
  width:   number | null;
  folded:  boolean;
}

export function useFloatingChat(postMessage: (msg: unknown) => void) {
  const [width,       setWidthState]       = useState(DEFAULT_CONSOLE_WIDTH);
  const [folded,      setFolded]           = useState(false);
  const [history,     setHistory]          = useState<ChatItem[]>([]);
  const [streaming,   setStreaming]        = useState('');
  // - waiting for the first token or tool event of a reply
  const [thinking,    setThinking]         = useState(false);
  // - a turn is running: from send until done, error or reset
  const [working,     setWorking]          = useState(false);
  const [error,       setError]            = useState<string | null>(null);
  const [usage,       setUsage]            = useState<ChatTokenUsage | null>(null);
  const [attachments, setAttachmentsState] = useState<ChatAttachment[]>([]);

  // - refs mirror state so handlers build the next state without nested setState updaters
  const historyRef     = useRef<ChatItem[]>([]);
  const streamingRef   = useRef('');
  const widthRef       = useRef(DEFAULT_CONSOLE_WIDTH);
  const foldedRef      = useRef(false);
  const attachmentsRef = useRef<ChatAttachment[]>([]);

  const persistHistory = useCallback((h: ChatItem[]) => {
    postMessage({ type: 'floatingChatPersistHistory', history: h });
  }, [postMessage]);

  const saveUIState = useCallback(() => {
    postMessage({ type: 'floatingChatSaveUIState', width: widthRef.current, folded: foldedRef.current });
  }, [postMessage]);

  // - runs on every mousemove of an edge drag; the caller saves once on mouseup
  const setWidth = useCallback((w: number) => {
    widthRef.current = w;
    setWidthState(w);
  }, []);

  const toggleFolded = useCallback(() => {
    foldedRef.current = !foldedRef.current;
    setFolded(foldedRef.current);
    saveUIState();
  }, [saveUIState]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // - key or code: some layouts send a dead key for Alt+`
      if (e.altKey && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        e.stopPropagation();
        toggleFolded();
      }
    };
    // - capture phase: Monaco stops keydown propagation while it has focus
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [toggleFolded]);

  const setAttachments = useCallback((next: ChatAttachment[]) => {
    attachmentsRef.current = next;
    setAttachmentsState(next);
  }, []);

  const addAttachments = useCallback((add: ChatAttachment[]) => {
    setAttachments(mergeAttachments(attachmentsRef.current, add));
  }, [setAttachments]);

  const removeAttachment = useCallback((key: string) => {
    setAttachments(withoutAttachment(attachmentsRef.current, key));
  }, [setAttachments]);

  const appendDelta = useCallback((delta: string) => {
    setThinking(false);
    streamingRef.current += delta;
    setStreaming(s => s + delta);
  }, []);

  const applyTool = useCallback((e: ChatToolEvent) => {
    setThinking(false);
    const r = applyToolEvent(historyRef.current, streamingRef.current, e, new Date().toISOString());
    streamingRef.current = r.pending;
    setStreaming(r.pending);
    historyRef.current = r.items;
    setHistory(r.items);
    // - no persist mid-turn: a running card would restore as spinning forever; completeDelta persists
  }, []);

  const applyUsage = useCallback((u: ChatTokenUsage) => setUsage(u), []);

  const completeDelta = useCallback((cost?: { costUsd?: number; deltaUsd?: number }) => {
    const flushed = flushPendingText(historyRef.current, streamingRef.current, new Date().toISOString(), cost);
    streamingRef.current = '';
    setStreaming('');
    setThinking(false);
    setWorking(false);
    setUsage(null);
    // - a card still running at the end of the turn was cut off by Stop
    const closed = flushed.map(it => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error' as const } : it));
    historyRef.current = closed;
    setHistory(closed);
    persistHistory(closed);
  }, [persistHistory]);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setThinking(false);
    setWorking(false);
    streamingRef.current = '';
    setStreaming('');
    setUsage(null);
  }, []);

  // - Reset: the host cleared its copy and the claude process
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    streamingRef.current = '';
    setHistory([]);
    setStreaming('');
    setThinking(false);
    setWorking(false);
    setError(null);
    setUsage(null);
  }, []);

  const sendMessage = useCallback((text: string, activeNodeId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: ChatItem = { kind: 'text', role: 'user', content: trimmed, timestamp: new Date().toISOString() };
    const next = [...historyRef.current, userMsg];
    historyRef.current = next;
    setHistory(next);
    // - what the user sees now: zoom, on-screen nodes, the focused node's visible text
    const viewport = (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport?.();
    postMessage({ type: 'floatingChatSend', message: trimmed, activeNodeId, history: next, viewport, attachments: attachmentsRef.current });
    setAttachments([]);
    setError(null);
    streamingRef.current = '';
    setStreaming('');
    setThinking(true);
    setWorking(true);
  }, [postMessage, setAttachments]);

  const restoreHistory = useCallback((payload: RestoredChat) => {
    const migrated = migrateHistory(payload.history);
    historyRef.current = migrated;
    setHistory(migrated);
    foldedRef.current = payload.folded;
    setFolded(payload.folded);
    if (payload.width !== null) {
      widthRef.current = payload.width;
      setWidthState(payload.width);
    }
  }, []);

  const addNodeAdded = useCallback((note: string) => {
    const next: ChatItem[] = [...historyRef.current, {
      kind:      'text',
      role:      'assistant',
      content:   `${NODE_ADDED_PREFIX}\n\n${note}`,
      timestamp: new Date().toISOString(),
    }];
    historyRef.current = next;
    setHistory(next);
    persistHistory(next);
  }, [persistHistory]);

  return {
    width, folded, history, streaming, thinking, working, error, usage, attachments,
    setWidth, saveUIState, toggleFolded,
    addAttachments, removeAttachment,
    sendMessage,
    appendDelta, completeDelta, handleError, addNodeAdded,
    applyTool, applyUsage,
    restoreHistory, clearHistory,
  };
}
