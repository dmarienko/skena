import React, { memo } from 'react';
import type { CardBody, CardContent, CardRow } from './cardContent';
import { CARD_BODY_H, CARD_BORDER, CARD_H, CARD_HEADER_H, CARD_W } from './hintPlacement';
import { MarkdownRenderer } from '../renderers/MarkdownRenderer';
import { useCodeTokens } from '../renderers/CodeRenderer';
import { useHostMarkdown } from '../hooks/useHostMarkdown';

const FONT = 'system-ui, -apple-system, sans-serif';
const MONO = 'var(--vscode-editor-font-family, monospace)';
const ONE_LINE: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

const ROW_STYLE: Record<CardRow['style'], React.CSSProperties> = {
  strong: { ...ONE_LINE, fontWeight: 700, fontSize: 12 },
  path:   { ...ONE_LINE, fontFamily: MONO, fontSize: 10.5, color: 'var(--sk-text2)' },
  plain:  ONE_LINE,
  mono:   { ...ONE_LINE, whiteSpace: 'pre', fontFamily: MONO, fontSize: 10.5 },
};

// - plain text until the highlighter has coloured the lines
function CodeBody({ lines, language }: { lines: string[]; language: string }): JSX.Element {
  const tokens = useCodeTokens(lines.join('\n'), language);
  return (
    <div style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: '15px' }}>
      {lines.map((line, i) => (
        <div key={i} style={{ ...ONE_LINE, whiteSpace: 'pre' }}>
          {tokens?.[i]
            ? tokens[i].map((t, j) => (
              <span key={j} style={{ color: t.color, fontStyle: t.italic ? 'italic' : undefined }}>{t.content}</span>
            ))
            : line}
        </div>
      ))}
    </div>
  );
}

// - the path a note takes: the host renders a text holding typst (`%`), the webview renders the rest
function MarkdownBody({ text }: { text: string }): JSX.Element {
  const hostHtml = useHostMarkdown(text);
  return hostHtml !== null
    ? <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: hostHtml }} />
    : <MarkdownRenderer content={text} baseUri="." />;
}

function Body({ body }: { body: CardBody }): JSX.Element {
  switch (body.kind) {
    case 'code':
      return <CodeBody lines={body.lines} language={body.language} />;
    case 'markdown':
      return <MarkdownBody text={body.text} />;
    case 'image':
      return <img src={body.src} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />;
    case 'rows':
      return <>{body.rows.map((r, i) => <div key={i} style={ROW_STYLE[r.style]}>{r.text}</div>)}</>;
  }
}

/**
 * The card of the node a `g` badge leads to: its label and type on top, then at most three lines of
 * what it holds. A fixed screen size: it does not scale with the canvas zoom.
 */
export const PreviewCard = memo(function PreviewCard({ card }: { card: CardContent }): JSX.Element {
  return (
    <div
      className="skena-preview-card"
      style={{
        width: CARD_W, height: CARD_H, boxSizing: 'border-box', overflow: 'hidden',
        border: `${CARD_BORDER}px solid ${card.border}`, borderRadius: 6,
        background: 'var(--sk-bg2)', color: 'var(--sk-text1)', boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
        fontFamily: FONT, fontSize: 11.5, lineHeight: 1.35,
      }}
    >
      <div style={{
        height: CARD_HEADER_H, boxSizing: 'border-box', padding: '0 7px', borderBottom: '1px solid var(--sk-border)',
        display: 'flex', alignItems: 'center', gap: 5, ...ONE_LINE,
      }}>
        {card.label && <span style={{ fontWeight: 700, fontSize: 11 }}>{card.label}</span>}
        {card.label && <span style={{ color: 'var(--sk-text2)' }}>·</span>}
        <span style={{ ...ONE_LINE, fontSize: 10.5, color: 'var(--sk-text2)' }}>{card.typeText}</span>
      </div>
      <div style={{ height: CARD_BODY_H, boxSizing: 'border-box', padding: '5px 8px 6px', overflow: 'hidden' }}>
        <Body body={card.body} />
      </div>
    </div>
  );
});
