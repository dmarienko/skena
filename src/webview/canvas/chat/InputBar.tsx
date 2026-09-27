import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChatAttachment, attachmentKey, chipLabel } from '../../../shared/chatAttachments';
import { AttachMenu } from './AttachMenu';
import { ChatInput, type ChatInputHandle } from './ChatInput';

interface Props {
  inputRef:     RefObject<ChatInputHandle>;
  scrollTarget: RefObject<HTMLDivElement>;
  attachments:  ChatAttachment[];
  working:      boolean;
  model?:       string;
  effort?:      string;
  provider?:    string;
  sessionName?: string;
  onSend:       (text: string) => void;
  onStop:       () => void;
  onPickModel:  () => void;
  onPickFile:   () => void;
  onAttach:     (add: ChatAttachment[]) => void;
  onRemove:     (key: string) => void;
  onWarn:       (text: string) => void;
}

type Picked = { id: string; label: string };

function pickedNodes(): Picked[] {
  return (window as unknown as { __skenaGetPicked?: () => Picked[] }).__skenaGetPicked?.() ?? [];
}

export function InputBar(p: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [picked,   setPicked]   = useState<Picked[]>([]);
  const [empty,    setEmpty]    = useState(true);
  const plusRef = useRef<HTMLDivElement>(null);

  // - a mouse press outside the + button and its menu closes the menu
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!plusRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [menuOpen]);

  const toggleMenu = () => {
    if (!menuOpen) setPicked(pickedNodes());
    setMenuOpen(o => !o);
  };
  const closeMenu = () => {
    setMenuOpen(false);
    p.inputRef.current?.focus();
  };

  const imageCount = p.attachments.filter(a => a.kind === 'image').length;
  const modelTitle = `Change the model for this canvas${p.provider ? ` · provider: ${p.provider}` : ''}${p.sessionName ? ` · session: ${p.sessionName}` : ''}`;

  return (
    <div
      className="cc-bar"
      onKeyDown={e => { if (menuOpen && e.key === 'Escape') { e.preventDefault(); closeMenu(); } }}
    >
      <div className="cc-plus-wrap" ref={plusRef}>
        {menuOpen && (
          <AttachMenu
            pickedCount={picked.length}
            allowImage={p.provider === 'harness'}
            imageCount={imageCount}
            onPickNodes={() => { p.onAttach(picked.map((n): ChatAttachment => ({ kind: 'node', id: n.id, label: n.label }))); closeMenu(); }}
            onPickFile={() => { setMenuOpen(false); p.onPickFile(); }}
            onImage={img => { p.onAttach([{ kind: 'image', ...img }]); closeMenu(); }}
            onWarn={text => { p.onWarn(text); closeMenu(); }}
          />
        )}
        <button className="cc-plus" title="Attach nodes, a file or an image" onClick={toggleMenu}>+</button>
      </div>
      <div className="cc-field">
        {p.attachments.length > 0 && (
          <div className="cc-chips">
            {p.attachments.map(a => (
              <span key={attachmentKey(a)} className="cc-chip">
                {chipLabel(a)}
                <button title="Remove" onClick={() => p.onRemove(attachmentKey(a))}>×</button>
              </span>
            ))}
          </div>
        )}
        <ChatInput ref={p.inputRef} scrollTarget={p.scrollTarget} working={p.working} onSend={p.onSend} onEmptyChange={setEmpty} />
      </div>
      {p.working && <span className="cc-spin" />}
      <button className="cc-model" title={modelTitle} onClick={p.onPickModel}>
        {p.model || 'model'}{p.effort && <i>{p.effort}</i>} ▾
      </button>
      {p.working ? (
        // - soft abort: the UI stops showing this turn; the claude process finishes it in the background
        <button className="cc-stop" title="Stop — interrupt the current reply" onClick={p.onStop}><i /></button>
      ) : (
        <button className="cc-send" title="Send (Ctrl+Enter)" disabled={empty} onClick={() => p.inputRef.current?.submit()}>↑</button>
      )}
    </div>
  );
}
