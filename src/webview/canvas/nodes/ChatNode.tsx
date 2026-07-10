/**
 * ChatNode — AI agent chat terminal embedded in the canvas (Phase 5 stub).
 */

import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { ChatNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { useHeatmap } from '../../context/HeatmapContext';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';

export function ChatNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as ChatNode & { accentColor?: string };
  const { visible: hmVisible, nodeGlow } = useHeatmap();
  const hmNode = hmVisible ? nodeGlow.get(data.id as string) : undefined;
  const selectedStyle = useSelectedStyle(selected);
  const bw = useZoomInvariantBorderWidth(1.5);
  const borderColor = node.accentColor ?? '#a882ff';

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
    <div
      className="skena-node"
      style={{
        border:        `${bw}px solid ${borderColor}`,
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
        minWidth={160} minHeight={100}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />

      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${borderColor}40`, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85 }}>
        <span>💬</span>
        <span>{node.title}</span>
        <span style={{ marginLeft: 'auto', opacity: 0.5, fontWeight: 400 }}>{node.agent} {node.model ? `· ${node.model}` : ''}</span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12 }}>
        AI chat — Phase 5
      </div>
    </div>
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
