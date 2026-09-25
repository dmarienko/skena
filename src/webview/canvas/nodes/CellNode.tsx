/**
 * CellNode — standalone output cell (table, image, HTML).
 * Content stored inline in .canvas JSON.
 * Double-click to edit markdown/html cells.
 */

import React, { useRef, useEffect, useMemo } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { CellNode } from '../../../shared/types';
import { capOutputHtml } from '../../../shared/outputCap';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { PlotlyRenderer } from '../../renderers/PlotlyRenderer';
import { ScrollableContent } from '../../components/ScrollableContent';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { nodeBorderColor } from '../palette';

export function CellNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CellNode & { accentColor?: string };
  const selectedStyle = useSelectedStyle(selected);
  const bw = useZoomInvariantBorderWidth(1.5);
  const borderColor = nodeBorderColor('cell', node.accentColor);

  // - cap oversized HTML (e.g. a huge dataframe) BEFORE it becomes DOM, so an existing giant cell
  //   from disk can't freeze the canvas on load. New runs are already capped host-side.
  const htmlContent = useMemo(
    () => (node.format === 'html' ? capOutputHtml(node.content) : node.content),
    [node.format, node.content],
  );

  // - auto-tail: when a live run grows the content, follow to the bottom so the latest output is
  //   visible — but only if the user is already near the bottom (don't yank them back if they
  //   scrolled up to read earlier output).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [node.content]);

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} />
    <div
      className="skena-node skena-node--cell"
      style={{
        // - dashed, not solid: sets output cells apart from other node types at a glance
        border:        `${bw}px dashed ${borderColor}`,
        height:        '100%',
        borderRadius:  6,
        overflow:      'hidden',
        background:    'var(--vscode-editorWidget-background)',
        display:       'flex',
        flexDirection: 'column',
        // - sci-fi focus ring
        ...selectedStyle,
      }}
    >
      <ScrollableContent ref={scrollRef} scrollKey={id}>
        {node.format === 'markdown' && <MarkdownRenderer content={node.content} />}
        {node.format === 'image'    && <img src={node.content} alt="cell" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {node.format === 'html'     && <div className="skena-cell-html" dangerouslySetInnerHTML={{ __html: htmlContent }} />}
        {node.format === 'plotly'   && <PlotlyRenderer json={node.content} />}
      </ScrollableContent>
    </div>
    <NodeResizer
      minWidth={100} minHeight={60}
      isVisible={selected}
      onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
        detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
      }))}
    />
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
