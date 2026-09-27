// - the chat console, docked at the bottom centre: the conversation panel above the input bar
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChatAttachment } from '../../shared/chatAttachments';
import { ChatToolEvent, ChatTokenUsage } from '../../shared/types';
import { useFloatingChat, type RestoredChat } from '../hooks/useFloatingChat';
import { ConversationPanel } from './chat/ConversationPanel';
import { InputBar } from './chat/InputBar';
import type { ChatInputHandle } from './chat/ChatInput';
import { clampConsoleWidth, dragWidth } from './chat/consoleLayout';

interface Props {
  activeNodeId: string | null;
  model?:       string;
  effort?:      string;
  provider?:    string;
  sessionName?: string;
  postMessage:  (msg: unknown) => void;

  onDelta:           (handler: (delta: string) => void) => () => void;
  onDone:            (handler: (usage: { costUsd?: number; deltaUsd?: number }) => void) => () => void;
  onError:           (handler: (msg: string) => void) => () => void;
  onResetDone:       (handler: () => void) => () => void;
  onNodeAdded:       (handler: (note: string) => void) => () => void;
  onHistoryRestored: (handler: (payload: RestoredChat) => void) => () => void;
  onToolEvent?:      (cb: (e: ChatToolEvent) => void) => () => void;
  onUsage?:          (cb: (u: ChatTokenUsage) => void) => () => void;
}

export function FloatingChat({
  activeNodeId, model, effort, provider, sessionName, postMessage,
  onDelta, onDone, onError, onResetDone, onNodeAdded, onHistoryRestored, onToolEvent, onUsage,
}: Props): JSX.Element {
  const chat      = useFloatingChat(postMessage);
  const inputRef  = useRef<ChatInputHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [compacting, setCompacting] = useState(false);
  const [viewportW,  setViewportW]  = useState(() => window.innerWidth);

  // - read at send time, so a send never uses a stale focused node
  const activeNodeIdRef = useRef(activeNodeId);
  activeNodeIdRef.current = activeNodeId;

  useEffect(() => onDelta(chat.appendDelta),               [onDelta, chat.appendDelta]);
  useEffect(() => onDone(chat.completeDelta),              [onDone, chat.completeDelta]);
  useEffect(() => onError(chat.handleError),               [onError, chat.handleError]);
  useEffect(() => onResetDone(chat.clearHistory),          [onResetDone, chat.clearHistory]);
  useEffect(() => onNodeAdded(chat.addNodeAdded),          [onNodeAdded, chat.addNodeAdded]);
  useEffect(() => onHistoryRestored(chat.restoreHistory),  [onHistoryRestored, chat.restoreHistory]);
  useEffect(() => onToolEvent?.(chat.applyTool),           [onToolEvent, chat.applyTool]);
  useEffect(() => onUsage?.(chat.applyUsage),              [onUsage, chat.applyUsage]);

  useEffect(() => {
    const on = (e: Event) => setCompacting((e as CustomEvent<boolean>).detail);
    window.addEventListener('skena:compacting', on);
    return () => window.removeEventListener('skena:compacting', on);
  }, []);

  useEffect(() => {
    const on = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const { addAttachments } = chat;
  useEffect(() => {
    const on = (e: Event) => {
      const files = (e as CustomEvent<{ path: string; name: string }[]>).detail ?? [];
      addAttachments(files.map((f): ChatAttachment => ({ kind: 'file', path: f.path, name: f.name })));
    };
    window.addEventListener('skena:chatFilesPicked', on);
    return () => window.removeEventListener('skena:chatFilesPicked', on);
  }, [addAttachments]);

  const width = clampConsoleWidth(chat.width, viewportW);

  const onEdgeDown = (edge: 'left' | 'right') => (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (me: MouseEvent) => chat.setWidth(clampConsoleWidth(dragWidth(startW, me.clientX - startX, edge), window.innerWidth));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      chat.saveUIState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const { sendMessage } = chat;
  const send = useCallback((text: string) => sendMessage(text, activeNodeIdRef.current), [sendMessage]);

  // - keys stop here so CanvasView's handlers (Space, hjkl) never see typing. Alt combos must reach the
  // - window, where VS Code's keybinding forwarder listens; skena's own Alt keys are taken in capture phase.
  return (
    <div
      className="cc-root"
      data-skena-chat="1"
      style={{ width }}
      onKeyDown={e => { if (!e.altKey) e.stopPropagation(); }}
      onKeyUp={e => { if (!e.altKey) e.stopPropagation(); }}
    >
      <div className="cc-edge cc-edge-left" title="Drag to change the width" onMouseDown={onEdgeDown('left')} />
      <div className="cc-edge cc-edge-right" title="Drag to change the width" onMouseDown={onEdgeDown('right')} />
      <ConversationPanel
        scrollRef={scrollRef}
        history={chat.history}
        streaming={chat.streaming}
        thinking={chat.thinking}
        working={chat.working}
        error={chat.error}
        compacting={compacting}
        usage={chat.usage}
        folded={chat.folded}
        onToggleFold={chat.toggleFolded}
        onCompact={() => postMessage({ type: 'floatingChatCompact' })}
        onReset={() => postMessage({ type: 'floatingChatReset' })}
        onCopy={text => postMessage({ type: 'writeClipboard', text })}
        onAddNote={text => postMessage({ type: 'floatingChatAddNote', content: text, activeNodeId: activeNodeIdRef.current })}
      />
      <InputBar
        inputRef={inputRef}
        scrollTarget={scrollRef}
        attachments={chat.attachments}
        working={chat.working}
        model={model}
        effort={effort}
        provider={provider}
        sessionName={sessionName}
        onSend={send}
        onStop={() => postMessage({ type: 'floatingChatAbort' })}
        onPickModel={() => postMessage({ type: 'pickModel' })}
        onPickFile={() => postMessage({ type: 'floatingChatPickFiles' })}
        onAttach={chat.addAttachments}
        onRemove={chat.removeAttachment}
        onWarn={text => postMessage({ type: 'showWarning', text })}
      />
    </div>
  );
}
