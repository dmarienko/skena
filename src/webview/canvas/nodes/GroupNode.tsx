/**
 * GroupNode — semi-transparent colored background container.
 * Visual only; no logical grouping in JSON Canvas spec.
 */

import React from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { GroupNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { useZoomInvariantBorderWidth } from './nodeShared';

export function GroupNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as GroupNode & { accentColor?: string };
  const bg = node.accentColor ? `${node.accentColor}18` : 'rgba(255,255,255,0.04)';
  const border = node.accentColor ?? 'rgba(255,255,255,0.12)';
  const bw = useZoomInvariantBorderWidth(1);

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} />
    <div style={{ width: '100%', height: '100%', border: `${bw}px dashed ${border}`, borderRadius: 8, background: bg, position: 'relative' }}>
      <NodeResizer
        minWidth={160} minHeight={120}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      {node.label && (
        <span style={{ position: 'absolute', top: 8, left: 10, fontWeight: 600, fontSize: 16, color: node.accentColor ?? 'var(--vscode-foreground)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {node.label}
        </span>
      )}
    </div>
    </>
  );
}
