/**
 * CellNode — standalone output cell (table, image, HTML).
 * Content stored inline in .canvas JSON.
 * Double-click to edit markdown/html cells.
 */

import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { CellNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { PlotlyRenderer } from '../../renderers/PlotlyRenderer';
import { ScrollableContent } from '../../components/ScrollableContent';
import { useHeatmap } from '../../context/HeatmapContext';
import { HANDLE_STYLE, useSelectedStyle } from './nodeShared';

export function CellNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CellNode & { accentColor?: string };
  const { visible: hmVisible, nodeGlow } = useHeatmap();
  const hmNode = hmVisible ? nodeGlow.get(data.id as string) : undefined;
  const selectedStyle = useSelectedStyle(selected);
  const borderColor = node.accentColor ?? '#454545';

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
    <div
      className="skena-node"
      style={{
        border:        `1.5px solid ${borderColor}`,
        height:        '100%',
        borderRadius:  6,
        overflow:      'hidden',
        background:    'var(--vscode-editorWidget-background)',
        display:       'flex',
        flexDirection: 'column',
        // - heatmap glow overrides: filter (drop-shadow), borderColor, opacity
        ...(hmNode ? {
          filter:      hmNode.glowFilter,
          borderColor: hmNode.borderColor,
          opacity:     hmNode.opacity,
        } : {}),
        // - sci-fi focus ring
        ...selectedStyle,
      }}
    >
      <NodeResizer
        minWidth={100} minHeight={60}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />

      <ScrollableContent scrollKey={id}>
        {node.format === 'markdown' && <MarkdownRenderer content={node.content} />}
        {node.format === 'image'    && <img src={node.content} alt="cell" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {node.format === 'html'     && <div className="skena-cell-html" dangerouslySetInnerHTML={{ __html: node.content }} />}
        {node.format === 'plotly'   && <PlotlyRenderer json={node.content} />}
      </ScrollableContent>
    </div>
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
