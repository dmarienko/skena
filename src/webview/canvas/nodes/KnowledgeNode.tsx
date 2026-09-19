/**
 * KnowledgeNode — a result from a knowledge server, read-only.
 * The node keeps the fetched text, so it reads with the server down; the header names the
 * server, the source and how old the copy is. Refresh and open go back to the host.
 */

import React, { useEffect, useState } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { KnowledgeNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { useHighlightedHtml } from '../../lib/codeHighlight';
import { useHostMarkdown } from '../../hooks/useHostMarkdown';
import { ScrollableContent } from '../../components/ScrollableContent';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { nodeBorderColor } from '../palette';

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
// - minute so "2h ago" does not stay at the value it had when the canvas opened
function useMinuteTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
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
  const hostHtml  = useHostMarkdown(node.text);
  const shownHtml = useHighlightedHtml(hostHtml);

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
      <NodeResizer
        minWidth={120} minHeight={80}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
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
      <ScrollableContent scrollKey={id} style={{ padding: '6px 8px 6px 12px' }}>
        {hostHtml !== null
          ? <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: shownHtml ?? hostHtml }} />
          : <MarkdownRenderer content={node.text} baseUri="." />}
      </ScrollableContent>
    </div>
    {/* - handles outside overflow:hidden wrapper → not clipped, render above scrollable content */}
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
