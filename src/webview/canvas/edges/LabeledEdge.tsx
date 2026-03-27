/**
 * LabeledEdge — canvas edge with optional label at midpoint.
 */

import React from 'react';
import { EdgeProps, BaseEdge, EdgeLabelRenderer, getStraightPath, getBezierPath } from '@xyflow/react';

export function LabeledEdgeComponent({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, label, markerEnd, selected,
}: EdgeProps): JSX.Element {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const activeStyle = selected
    ? {
        ...style,
        strokeWidth: (Number(style?.strokeWidth) || 1.5) + 1,
        filter: `drop-shadow(0 0 4px ${style?.stroke ?? '#888888'})`,
      }
    : style;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={activeStyle} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--vscode-editor-background)',
              border: '1px solid var(--vscode-editorWidget-border)',
              color: 'var(--vscode-foreground)',
              opacity: 0.85,
              pointerEvents: 'none',
            }}
            className="nodrag nopan"
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
