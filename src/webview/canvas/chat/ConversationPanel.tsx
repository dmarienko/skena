import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChatItem, ChatTokenUsage } from '../../../shared/types';
import { clockTime, groupTurns } from './chatTurns';
import { clearFolds, isTurnOpen, toggleTurn, turnScroll, type TurnClick } from './turnFold';
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
  onAddNote:    (text: string, turnKey: string) => void;
}

export function ConversationPanel(p: Props): JSX.Element | null {
  const { scrollRef } = p;
  const turns    = useMemo(() => groupTurns(p.history), [p.history]);
  const latest   = turns.length ? turns[turns.length - 1] : null;
  const hasTurns = turns.length > 0;
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set<string>());
  const hadTurnsRef = useRef(hasTurns);

  // - a new prompt leaves every turn's fold as it was; only clearing the whole history (Reset)
  // - drops the folds, so a new session's turn-0 does not inherit the last session's fold
  useEffect(() => {
    setToggled(t => clearFolds(t, hadTurnsRef.current, hasTurns));
    hadTurnsRef.current = hasTurns;
  }, [hasTurns]);

  const busy    = p.working || p.compacting;
  const visible = turns.length > 0 || busy || p.error !== null;

  // - new content is the panel reopened, restored history, a new last item or streamed text; a turn opened
  // - or folded by a click changes none of these and is reported through clickRef instead
  const lastItem   = p.history.length ? p.history[p.history.length - 1] : null;
  const clickRef   = useRef<TurnClick | null>(null);
  const contentRef = useRef<unknown[] | null>(null);
  useLayoutEffect(() => {
    const content = [visible, p.folded, lastItem, p.streaming];
    const prev    = contentRef.current;
    contentRef.current = content;
    const click = clickRef.current;
    clickRef.current = null;
    const el = scrollRef.current;
    if (!visible || p.folded || !el) return;
    const move = turnScroll(click, prev === null || content.some((v, i) => v !== prev[i]));
    if (move.to === 'latest') {
      const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
      return () => cancelAnimationFrame(id);
    }
    if (move.to === 'turn') {
      const head = turnHead(el, move.key);
      if (head) el.scrollTop += lineOffset(el, head) - move.offset;
    }
  }, [visible, p.folded, lastItem, p.streaming, toggled, scrollRef]);

  const onToggle = (key: string) => {
    const el   = scrollRef.current;
    const head = el ? turnHead(el, key) : null;
    clickRef.current = { key, opened: !isTurnOpen(toggled, key), offset: el && head ? lineOffset(el, head) : 0 };
    setToggled(t => toggleTurn(t, key));
  };

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
          onToggle={onToggle}
          onCopy={p.onCopy}
          onAddNote={p.onAddNote}
        />
        {p.compacting && <div className="cc-note">⏳ Compacting session… summarising the conversation to shrink context.</div>}
        {p.error && <div className="cc-error">Error: {p.error}</div>}
      </div>
    </div>
  );
}

// - a turn's ▸ or ▾ line, marked by TurnList
function turnHead(el: HTMLElement, key: string): HTMLElement | null {
  return el.querySelector<HTMLElement>(`[data-turn-head="${key}"]`);
}

// - how far a line sits below the top of the scroll area, in pixels
function lineOffset(el: HTMLElement, line: HTMLElement): number {
  return line.getBoundingClientRect().top - el.getBoundingClientRect().top;
}
