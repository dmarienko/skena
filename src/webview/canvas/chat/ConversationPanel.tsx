import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChatItem, ChatTokenUsage } from '../../../shared/types';
import { clockTime, groupTurns } from './chatTurns';
import { nextToggled, toggleTurn } from './turnFold';
import { TurnList } from './TurnList';

interface Props {
  scrollRef:    RefObject<HTMLDivElement>;
  history:      ChatItem[];
  streaming:    string;
  thinking:     boolean;
  working:      boolean;
  error:        string | null;
  compacting:   boolean;
  usage:        ChatTokenUsage | null;
  folded:       boolean;
  onToggleFold: () => void;
  onCompact:    () => void;
  onReset:      () => void;
  onCopy:       (text: string) => void;
  onAddNote:    (text: string) => void;
}

export function ConversationPanel(p: Props): JSX.Element | null {
  const { scrollRef } = p;
  const turns     = useMemo(() => groupTurns(p.history), [p.history]);
  const latest    = turns.length ? turns[turns.length - 1] : null;
  const latestKey = latest?.key ?? null;
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set<string>());
  const prevLatestRef = useRef<string | null>(latestKey);

  useEffect(() => {
    setToggled(t => nextToggled(t, prevLatestRef.current, latestKey));
    prevLatestRef.current = latestKey;
  }, [latestKey]);

  const busy    = p.working || p.compacting;
  const visible = turns.length > 0 || busy || p.error !== null;

  // - pin to the latest content on unfold, on restored history and while streaming; opening an
  // - earlier turn changes none of these, so it does not jump
  useEffect(() => {
    if (!visible || p.folded) return;
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [visible, p.folded, p.history, p.streaming, scrollRef]);

  // - a finer wheel step: the native one jumps too far to follow the text; ctrl+wheel is the host's zoom
  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const px = e.deltaMode === 1 ? e.deltaY * 18
               : e.deltaMode === 2 ? e.deltaY * el.clientHeight
               : e.deltaY;
      el.scrollBy({ top: px * 0.5 });
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [visible, scrollRef]);

  if (!visible) return null;
  const status = busy ? 'working' : latest ? clockTime(latest.time) : '';

  return (
    <div className="cc-out">
      <div className="cc-out-h">
        <span>Latest turn{status ? ` · ${status}` : ''}</span>
        <span className="grow" />
        {p.usage && <span className="cc-tokens">{p.usage.inputTokens + p.usage.cacheReadTokens}▸{p.usage.outputTokens} tok</span>}
        <button className="cc-hbtn" title="Compact session (summarise to shrink context)" onClick={p.onCompact}>⤵</button>
        <button className="cc-hbtn" title="Reset — new session, clear history" onClick={p.onReset}>⟲</button>
        <button className="cc-hbtn" title={p.folded ? 'Open the conversation (Alt+`)' : 'Fold the conversation (Alt+`)'} onClick={p.onToggleFold}>
          {p.folded ? '▸' : '▾'}
        </button>
      </div>
      {/* - hidden, not unmounted, when folded: reopening must not re-parse every answer's markdown and KaTeX */}
      <div ref={scrollRef} className="cc-out-b" style={{ display: p.folded ? 'none' : 'flex' }}>
        <TurnList
          turns={turns}
          toggled={toggled}
          streaming={p.streaming}
          thinking={p.thinking}
          working={p.working}
          onToggle={key => setToggled(t => toggleTurn(t, key))}
          onCopy={p.onCopy}
          onAddNote={p.onAddNote}
        />
        {p.compacting && <div className="cc-note">⏳ Compacting session… summarising the conversation to shrink context.</div>}
        {p.error && <div className="cc-error">Error: {p.error}</div>}
      </div>
    </div>
  );
}
