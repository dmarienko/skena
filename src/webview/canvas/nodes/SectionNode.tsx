import React from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { SectionNode } from '../../../shared/types';
import { useZoomInvariantBorderWidth } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';

/**
 * SectionNode — a large kernel-tint-ready band that owns nodes (via their sectionId). Visual band
 * only; the interactive header (title / fold / delete) is a separate screen-space overlay
 * (SectionHeaders) so it never scales with zoom. Renders behind everything (zIndex set in toFlowNode).
 */
export function SectionNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as SectionNode;
  const accent = node.accentColor ?? undefined;
  const border = accent ?? DEFAULT_NODE_BORDER_BY_TYPE.section;
  const bg = accent ? `${accent}14` : 'rgba(83,223,221,0.05)';
  const bw = useZoomInvariantBorderWidth(1);
  return (
    <div style={{ width: '100%', height: '100%', border: `${bw}px solid ${border}`, borderRadius: 10, background: bg }}>
      <NodeResizer
        minWidth={240} minHeight={120}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
    </div>
  );
}
