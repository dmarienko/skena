import React from 'react';
import { NodeProps } from '@xyflow/react';
import { SECTION_RGB } from '../palette';

/**
 * SectionNode — a passive kernel-tint-ready band that owns nodes (via their sectionId). Rendered
 * behind everything (zIndex set in toFlowNode); not draggable, selectable, or resizable — its
 * geometry is derived and all interaction lives in the zoom-steady header overlay (SectionHeaders).
 * Just a flat, very transparent tinted background — no gradient, no border, no accent stripe.
 */
export function SectionNodeComponent(_props: NodeProps): JSX.Element {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: `rgba(${SECTION_RGB}, 0.04)`,
        pointerEvents: 'none',
      }}
    />
  );
}
