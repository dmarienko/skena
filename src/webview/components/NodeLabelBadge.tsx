/**
 * NodeLabelBadge — small reference label shown on every canvas node.
 * Uses React Flow's NodeToolbar so it renders outside the node bounds
 * (no clipping, always visible, moves with the node when dragged).
 *
 * Example labels: N3, M12, J5, L2, R1 …
 */

import React from 'react';
import { NodeToolbar, Position } from '@xyflow/react';

interface Props {
  label: string | undefined;
}

export function NodeLabelBadge({ label }: Props): JSX.Element | null {
  if (!label) return null;
  return (
    <NodeToolbar isVisible position={Position.TopLeft} offset={2} style={{ padding: 0, lineHeight: 1 }}>
      <span
        style={{
          fontFamily:    'monospace',
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.04em',
          color:         'rgba(255,255,255,0.75)',
          background:    'rgba(0,0,0,0.52)',
          borderRadius:  3,
          padding:       '1px 5px',
          pointerEvents: 'none',
          userSelect:    'none',
        }}
      >
        {label}
      </span>
    </NodeToolbar>
  );
}
