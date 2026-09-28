import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatItem } from '../../../shared/types';
import { useHostMarkdown } from '../../hooks/useHostMarkdown';
import { useHighlightedHtml } from '../../lib/codeHighlight';
import { ChatTurn, clockTime, firstLine, noteAddedLabel, turnAnswer, turnCost } from './chatTurns';
import { isTurnOpen } from './turnFold';
import { toolCardView } from './toolCardView';

interface TurnListProps {
  turns:     ChatTurn[];
  toggled:   ReadonlySet<string>;
  streaming: string;
  thinking:  boolean;
  working:   boolean;
  onToggle:  (key: string) => void;
  onCopy:    (text: string) => void;
  onAddNote: (text: string, turnKey: string) => void;
}

export function TurnList({ turns, toggled, streaming, thinking, working, onToggle, onCopy, onAddNote }: TurnListProps): JSX.Element {
  const latestKey = turns.length ? turns[turns.length - 1].key : null;
  return (
    <>
      {turns.map(t => {
        const latest = t.key === latestKey;
        return isTurnOpen(toggled, t.key)
          ? (
            <OpenTurn
              key={t.key}
              turn={t}
              streaming={latest ? streaming : ''}
              thinking={latest && thinking}
              working={latest && working}
              onToggle={onToggle}
              onCopy={onCopy}
              onAddNote={onAddNote}
            />
          )
          : <FoldedTurn key={t.key} turn={t} onToggle={onToggle} />;
      })}
    </>
  );
}

function FoldedTurn({ turn, onToggle }: { turn: ChatTurn; onToggle: (key: string) => void }): JSX.Element {
  const prompt = turn.prompt === null ? '(no prompt)' : firstLine(turn.prompt);
  return (
    <div className="cc-fold-line" data-turn-head={turn.key} title={turn.prompt ?? undefined} onClick={() => onToggle(turn.key)}>
      {prompt} · {clockTime(turn.time)}
    </div>
  );
}

interface OpenTurnProps {
  turn:      ChatTurn;
  streaming: string;
  thinking:  boolean;
  working:   boolean;
  onToggle:  (key: string) => void;
  onCopy:    (text: string) => void;
  onAddNote: (text: string, turnKey: string) => void;
}

function OpenTurn({ turn, streaming, thinking, working, onToggle, onCopy, onAddNote }: OpenTurnProps): JSX.Element {
  const answer = working ? '' : turnAnswer(turn);
  const cost   = working ? null : turnCost(turn);
  return (
    <div className="cc-turn">
      {turn.prompt !== null && (
        <div className="cc-user" data-turn-head={turn.key} title={turn.prompt} onClick={() => onToggle(turn.key)}>{firstLine(turn.prompt)}</div>
      )}
      {turn.items.map((it, i) => <TurnItem key={it.kind === 'tool' ? it.id : `${it.kind}-${i}`} item={it} />)}
      {streaming !== '' && <AnswerText content={streaming} streaming />}
      {thinking && streaming === '' && <div className="cc-dots">● ● ●</div>}
      {answer !== '' && (
        <div className="cc-actions">
          <button className="cc-act" title="Copy the answer" onClick={() => onCopy(answer)}>⧉</button>
          <button className="cc-act" title="Add the answer to the canvas as a note" onClick={() => onAddNote(answer, turn.key)}>＋ canvas</button>
          {cost && (
            <span className="cc-cost">{`Δ $${cost.deltaUsd.toFixed(2)}${cost.costUsd !== undefined ? ` · Σ $${cost.costUsd.toFixed(2)}` : ''}`}</span>
          )}
        </div>
      )}
    </div>
  );
}

// - memoized: an item object is replaced only when it changes, so the other rows skip re-rendering
const TurnItem = memo(function TurnItem({ item }: { item: ChatItem }): JSX.Element | null {
  if (item.kind === 'text') {
    if (item.role === 'user') return <div className="cc-user">{firstLine(item.content)}</div>;
    // - the ＋ canvas line only, and only once it carries the node's id (older history has the text
    // - alone); anything else, including that same line without an id, renders as plain markdown as before
    const label = item.nodeRef ? noteAddedLabel(item.content) : null;
    return label ? <NoteAddedLine label={label} nodeId={item.nodeRef as string} /> : <AnswerText content={item.content} />;
  }
  if (item.kind === 'thinking') return <ThinkingStep content={item.content} />;
  return <ToolStep item={item} />;
});

// - "📌 added <label> to the canvas" with the label as a link; a mousedown preventDefault keeps the
// - click from taking focus off the canvas, the same way cc-root does it for the console's buttons
function NoteAddedLine({ label, nodeId }: { label: string; nodeId: string }): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <div className="cc-reply">
      {'📌 added '}
      <button
        onMouseDown={e => e.preventDefault()}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => window.dispatchEvent(new CustomEvent('skena:focusNodeRequest', { detail: { id: nodeId } }))}
        style={{
          all:            'unset',
          font:           'inherit',
          cursor:         'pointer',
          color:          'var(--cc-accent)',
          textDecoration: hover ? 'underline' : 'none',
        }}
      >
        {label}
      </button>
      {' to the canvas'}
    </div>
  );
}

function ToolStep({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const v = toolCardView(item.name, item.input);
  if (v.hidden) return null;
  const mark = item.status === 'running' ? <span className="run">●</span>
             : item.status === 'ok'      ? <span className="ok">✓</span>
             :                             <span className="err">✗</span>;
  const canOpen = v.kind !== 'todo';
  return (
    <div className="cc-step">
      <div className="cc-tool" style={canOpen ? undefined : { cursor: 'default' }} onClick={canOpen ? () => setOpen(o => !o) : undefined}>
        {mark}<span>{v.title}</span>
      </div>
      {v.kind === 'todo' && v.todos && (
        <div className="cc-tool-detail">
          {v.todos.map((t, j) => <div key={j}>{t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} {t.text}</div>)}
        </div>
      )}
      {open && canOpen && <pre className="cc-tool-detail">{JSON.stringify(item.input, null, 1)}</pre>}
      {open && v.showResult && item.resultPreview && <div className="cc-tool-detail">{item.resultPreview}</div>}
    </div>
  );
}

function ThinkingStep({ content }: { content: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="cc-step">
      <div className="cc-tool" onClick={() => setOpen(o => !o)}><span>∴</span><span>thinking {open ? '▾' : '▸'}</span></div>
      {open && <pre className="cc-tool-detail">{content}</pre>}
    </div>
  );
}

// - a finished reply with Typst (%…%) renders host-side; streaming and plain text use ReactMarkdown
const AnswerText = memo(function AnswerText({ content, streaming = false }: { content: string; streaming?: boolean }): JSX.Element {
  const hostHtml  = useHostMarkdown(streaming ? '' : content);
  const shownHtml = useHighlightedHtml(hostHtml);
  return (
    <div className="cc-reply">
      {hostHtml !== null ? (
        <div className="skena-markdown skena-chat-md" dangerouslySetInnerHTML={{ __html: shownHtml ?? hostHtml }} />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { output: 'mathml', throwOnError: false }]]}
        >
          {content}
        </ReactMarkdown>
      )}
      {streaming && <span className="cc-caret" />}
    </div>
  );
});
