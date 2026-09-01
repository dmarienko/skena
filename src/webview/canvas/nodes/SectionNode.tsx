import React from 'react';
import { NodeProps } from '@xyflow/react';
import { SECTION_RGB } from '../palette';

/**
 * SectionNode — a passive kernel-tint-ready band that owns nodes (via their sectionId). Rendered
 * behind everything (zIndex set in toFlowNode); not draggable, selectable, or resizable — its
 * geometry is derived (migration now, packing later) and all interaction lives in the zoom-steady
 * header overlay (SectionHeaders). Open on the right: the tint fades out rightward, with a light
 * left accent marking the lane. No box border, so it reads as a band, not a box around the nodes.
 */
export function SectionNodeComponent(_props: NodeProps): JSX.Element {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: `linear-gradient(to right, rgba(${SECTION_RGB}, 0.10), rgba(${SECTION_RGB}, 0.03) 55%, rgba(${SECTION_RGB}, 0))`,
        borderLeft: `3px solid rgba(${SECTION_RGB}, 0.4)`,
        pointerEvents: 'none',
      }}
    />
  );
}
