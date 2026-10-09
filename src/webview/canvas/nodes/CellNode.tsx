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
import { BAND_CLASS, HANDLE_STYLE, ZOOM_WIDTH_CLASS, bandHeldScroller, bandInsetPadding, baseBorderWidth, focusRingStyle, useBandVars, useZoomVars } from './nodeShared';
import { NodeBorder } from './NodeBorder';
import { nodeBorderColor } from '../palette';
import { keepSelectionIn } from './cellTextSelect';

// - text the mouse selects instead of moving the node or panning the canvas (canvas.css: .skena-cell-text).
//   The node still moves by the padding around it and the space under it.
const TEXT_CLASS = 'skena-cell-text nodrag nopan';

function onTextMouseDown(e: React.MouseEvent<HTMLElement>): void {
  if (e.button === 0) keepSelectionIn(e.currentTarget, e.clientX, e.clientY);
}

// - the mouseup that ends a drag selection also clicks the node: React Flow would select it and
//   CanvasView reveal it, a pan under the selection
function onTextClick(e: React.MouseEvent<HTMLElement>): void {
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) e.stopPropagation();
}

export function CellNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CellNode & { accentColor?: string };
  const selectedStyle = focusRingStyle(selected);
  const bw = baseBorderWidth(1.5);
  const zoomVars = useZoomVars();
  const bandVars = useBandVars();
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
      className={`skena-node skena-node--cell ${ZOOM_WIDTH_CLASS}`}
      style={{
        ...zoomVars,
        // - dashed, not solid: sets output cells apart from other node types at a glance
        border:        `${bw} dashed ${borderColor}`,
        padding:       bandInsetPadding(),
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
      <ScrollableContent ref={scrollRef} scrollKey={id} className={BAND_CLASS} style={{ ...bandVars, ...bandHeldScroller(6, 8, 6, 8) }}>
        {node.format === 'markdown' && <div className={TEXT_CLASS} onMouseDown={onTextMouseDown} onClick={onTextClick}><MarkdownRenderer content={node.content} /></div>}
        {node.format === 'image'    && <img src={node.content} alt="cell" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {node.format === 'html'     && <div className={`skena-cell-html ${TEXT_CLASS}`} onMouseDown={onTextMouseDown} onClick={onTextClick} dangerouslySetInnerHTML={{ __html: htmlContent }} />}
        {node.format === 'plotly'   && <PlotlyRenderer json={node.content} />}
      </ScrollableContent>
    </div>
    <NodeBorder base={1.5} color={borderColor} borderStyle="dashed" />
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
