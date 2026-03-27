/**
 * HelperLines — alignment guides shown while dragging nodes.
 * Renders two SVG lines (horizontal + vertical) in screen space,
 * converting flow coordinates using the current viewport transform.
 */

import React from 'react';
import { useStore } from '@xyflow/react';

interface HelperLinesProps {
  horizontal?: number;  // - flow y-coordinate of horizontal guide
  vertical?:   number;  // - flow x-coordinate of vertical guide
}

export function HelperLines({ horizontal, vertical }: HelperLinesProps): JSX.Element | null {
  // - transform: [translateX, translateY, zoom]
  const [tx, ty, zoom] = useStore(s => s.transform);

  if (horizontal === undefined && vertical === undefined) return null;

  return (
    <svg
      style={{
        position:      'absolute',
        left:          0,
        top:           0,
        width:         '100%',
        height:        '100%',
        pointerEvents: 'none',
        zIndex:        10,
      }}
    >
      {horizontal !== undefined && (
        <line
          x1={0}
          y1={horizontal * zoom + ty}
          x2="100%"
          y2={horizontal * zoom + ty}
          stroke="var(--vscode-focusBorder, #007acc)"
          strokeWidth={1}
          strokeDasharray="5 3"
          opacity={0.8}
        />
      )}
      {vertical !== undefined && (
        <line
          x1={vertical * zoom + tx}
          y1={0}
          x2={vertical * zoom + tx}
          y2="100%"
          stroke="var(--vscode-focusBorder, #007acc)"
          strokeWidth={1}
          strokeDasharray="5 3"
          opacity={0.8}
        />
      )}
    </svg>
  );
}
