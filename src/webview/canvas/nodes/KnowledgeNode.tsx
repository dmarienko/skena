/**
 * KnowledgeNode — a result from a knowledge server, read-only.
 * The node keeps the fetched text, so it reads with the server down; the header names the
 * server, the source and how old the copy is. Refresh and open go back to the host.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { KnowledgeNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { useHighlightedHtml } from '../../lib/codeHighlight';
import { useHostMarkdownOf } from '../../hooks/useHostMarkdown';
import { ScrollableContent, getScrollPosition } from '../../components/ScrollableContent';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { nodeBorderColor } from '../palette';
import { sanitizeHtmlAttrs } from './knowledgeHtml';
import { useKnowledgeAssets } from '../knowledgeAssets';
import { chunkEnd, definitionsAfter } from '../textWindow';
import { normalizeMath } from '../../../shared/mathDelims';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - age of the cached copy in one unit; an unparseable timestamp reads as never fetched
function ago(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const mins = Math.floor(Math.max(0, Date.now() - t) / 60_000);
  if (mins < 1)  return 'now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// - ago() reads the clock at render time, and nothing else re-renders the header; tick once a
// - minute so "2h ago" does not stay at the value it had when the canvas opened. One interval for
// - every knowledge node on the canvas: it starts with the first node and stops with the last.
const tickers = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function useMinuteTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(n => n + 1);
    tickers.add(bump);
    tickTimer ??= setInterval(() => { for (const t of tickers) t(); }, 60_000);
    return () => {
      tickers.delete(bump);
      if (tickers.size === 0 && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    };
  }, []);
}

// - characters rendered at a time: four times what the node's box holds of prose (12px text on a
//   20px line, about 7px a character), never under 8 000
function stepChars(width: number, height: number): number {
  return Math.max(8_000, Math.round(4 * (width / 7) * (height / 20)));
}

const BUTTON_STYLE: React.CSSProperties = {
  cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit',
  fontSize: 12, padding: 0, lineHeight: 1, opacity: 0.7,
};

export function KnowledgeNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as KnowledgeNode & { accentColor?: string };
  useMinuteTick();
  const selectedStyle = useSelectedStyle(selected);
  const bw = useZoomInvariantBorderWidth(1.5);
  const borderColor = nodeBorderColor('knowledge', node.accentColor);
  // - a whole paper in the DOM is laid out and painted on every pan and zoom, so only the start of
  //   the text is rendered, cut at a block boundary, and it grows as the reader scrolls toward its
  //   end. The definitions after the cut go along so the footnote references in it still render.
  const step = stepChars(node.width, node.height);
  // - the cuts are read on the text the renderers parse: they normalize math the same way, and a
  //   second pass over normalized text changes nothing
  const text = useMemo(() => normalizeMath(node.text), [node.text]);
  const [win, setWin] = useState(() => ({ text, end: chunkEnd(text, 0, step) }));
  let end = win.end;
  if (win.text !== text) {
    // - a refresh brought new text: keep at least as much of it rendered, so the scroll offset holds
    end = chunkEnd(text, 0, Math.max(step, win.end));
    setWin({ text, end });
  }
  const whole = end >= text.length;
  const windowText = useMemo(
    () => (whole ? text : `${text.slice(0, end)}\n\n${definitionsAfter(text, end)}`),
    [text, end, whole],
  );
  // - routed by the whole text, so every window takes the renderer the whole text would
  const host      = useHostMarkdownOf(windowText, text);
  const hostHtml  = host.html;
  const shownHtml = useHighlightedHtml(hostHtml);
  // - the images the text refers to by the server's uri; the host fetches them, these two put the
  //   data urls in
  const { swapHtml, swapMarkdown } = useKnowledgeAssets(node.server);
  // - the text came from a knowledge server and the webview CSP allows inline script, so what goes
  //   in as html is stripped of anything that runs. The MarkdownRenderer path below builds React
  //   elements instead, where a string event handler is not a handler at all.
  const safeHtml = useMemo(
    () => (hostHtml === null ? null : swapHtml(sanitizeHtmlAttrs(shownHtml ?? hostHtml))),
    [hostHtml, shownHtml, swapHtml],
  );
  const shownText = useMemo(() => swapMarkdown(windowText), [windowText, swapMarkdown]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // - a saved scroll offset past the first window: the window grows until it reaches that far, and
  //   only then is ScrollableContent told the content is loaded, so it restores the offset
  const [restoreTo] = useState(() => getScrollPosition(id) ?? 0);
  const [reached, setReached] = useState(() => restoreTo === 0 || whole);
  // - what is on screen is the current window: the markdown path renders in the same pass, host html
  //   once it is the html of this very text
  const current = hostHtml === null || host.of === windowText;
  const growing = useRef(false);

  const grow = (): void => {
    const el = scrollRef.current;
    // - a box with no height is not laid out yet: nothing to measure against
    if (whole || !current || growing.current || !el || el.clientHeight === 0) return;
    const top = reached ? el.scrollTop : restoreTo;
    // - the box on screen and two more below it
    const need = top + 3 * el.clientHeight;
    if (el.scrollHeight >= need) return;
    // - characters per rendered pixel so far: a far target (a saved offset) is reached in one step
    const perPx = end / Math.max(1, el.scrollHeight);
    growing.current = true;
    setWin({ text, end: chunkEnd(text, end, Math.max(step, Math.ceil((need - el.scrollHeight) * perPx))) });
  };
  const growRef = useRef(grow);
  growRef.current = grow;

  useLayoutEffect(() => {
    growing.current = false;
    const el = scrollRef.current;
    if (!el || !current) return;
    if (!reached && (whole || el.scrollHeight >= restoreTo + el.clientHeight)) setReached(true);
    growRef.current();
  }, [safeHtml, shownText, current, reached, whole, restoreTo, node.width, node.height]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => growRef.current();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // - the share of the text rendered: CanvasView scales the chat context's "scrolled ~N% down" by it
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.dataset.shown = whole ? '1' : (end / text.length).toFixed(3);
  }, [end, whole, text.length]);

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} createdBy={(node as { createdBy?: string }).createdBy} />
    <div
      className="skena-node skena-node--knowledge"
      style={{
        border:        `${bw}px solid ${borderColor}`,
        height:        '100%',
        borderRadius:  6,
        overflow:      'hidden',
        display:       'flex',
        flexDirection: 'column',
        outline:       'none',
        ...selectedStyle,
      }}
      tabIndex={0}
    >
      {/* - padding clears the corner resize handle (left) and the 34px label badge (right) */}
      <div
        title={node.error ?? node.uri}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '3px 40px 3px 14px',
          fontSize: 12, whiteSpace: 'nowrap', borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <span style={{ opacity: 0.7, flexShrink: 0 }}>{node.server}</span>
        <span style={{ opacity: 0.4, flexShrink: 0 }}>›</span>
        {node.changed && <span style={{ color: borderColor, flexShrink: 0 }}>●</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.title}</span>
        <span style={{ opacity: 0.4, flexShrink: 0 }}>·</span>
        <span style={{ opacity: 0.6, flexShrink: 0 }}>{ago(node.fetchedAt)}</span>
        {node.error && <span style={{ opacity: 0.6, flexShrink: 0 }}>!</span>}
        <button
          onClick={e => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('skena:knowledgeRefresh', { detail: { id } })); }}
          title="Fetch this text from its server again"
          style={{ ...BUTTON_STYLE, marginLeft: 'auto' }}
        >↻</button>
        <button
          onClick={e => { e.stopPropagation(); vscodePostMessage({ type: 'knowledgeOpen', server: node.server, uri: node.uri }); }}
          title="Open the source in its reader"
          style={BUTTON_STYLE}
        >↗</button>
      </div>
      {/* - baseUri="." so relative image paths (./img.png) resolve against canvas dir */}
      {/* - skena-knowledge-partial hides the footnote list while only the start is rendered */}
      <ScrollableContent
        ref={scrollRef} scrollKey={id} contentLoaded={reached || whole}
        className={whole ? undefined : 'skena-knowledge-partial'}
        style={{ padding: '6px 8px 6px 12px' }}
      >
        {safeHtml !== null
          ? <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: safeHtml }} />
          : <MarkdownRenderer content={shownText} baseUri="." />}
      </ScrollableContent>
    </div>
    <NodeResizer
      minWidth={120} minHeight={80}
      isVisible={selected}
      onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
        detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
      }))}
    />
    {/* - .skena-node is contain: layout style paint (canvas.css) → clips absolutely-positioned
        children, so the handles sit here, after it, not inside the overflow:hidden wrapper above */}
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
