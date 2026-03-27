/**
 * LabeledEdge — canvas edge with optional label at midpoint.
 *
 * Routing strategy:
 *   Normal connections  → getSmoothStepPath (orthogonal + rounded corners)
 *   Backward connections (handle points away from the target, e.g. B.bottom → A.top
 *   where A is above B) → explicit U-shaped path that routes outside both node bodies.
 *
 *   Root cause of the degeneration: getSmoothStepPath computes an x-offset of
 *   |sourceX − targetX| / 2, which collapses to zero when nodes are vertically stacked,
 *   drawing a straight line through both bodies.  We detect this case and replace the
 *   path with a 6-waypoint route that clears the actual node boundaries.
 */

import React from 'react';
import { EdgeProps, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, useStore } from '@xyflow/react';

// ─── backward-path builder ────────────────────────────────────────────────────

/**
 * Compute a rounded corner segment at `via` coming from `from` and continuing to `to`.
 * Returns SVG commands (L ... Q ... ) without the leading move.
 */
function roundedCorner(
  from: [number, number],
  via:  [number, number],
  to:   [number, number],
  r:    number,
): string {
  const d1x = from[0] - via[0], d1y = from[1] - via[1];
  const d1   = Math.sqrt(d1x * d1x + d1y * d1y);
  const d2x  = to[0]   - via[0], d2y = to[1]   - via[1];
  const d2   = Math.sqrt(d2x * d2x + d2y * d2y);
  if (d1 < 0.01 || d2 < 0.01) return `L ${via[0]},${via[1]}`;
  const r1  = Math.min(r, d1 / 2);
  const r2  = Math.min(r, d2 / 2);
  const b1x = via[0] + (d1x / d1) * r1,  b1y = via[1] + (d1y / d1) * r1;
  const b2x = via[0] + (d2x / d2) * r2,  b2y = via[1] + (d2y / d2) * r2;
  return `L ${b1x},${b1y} Q ${via[0]},${via[1]} ${b2x},${b2y}`;
}

/** - build a waypoint list → SVG path string with rounded corners */
function waypointPath(pts: [number, number][], r: number): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    d += ' ' + roundedCorner(pts[i - 1], pts[i], pts[i + 1], r);
  }
  d += ` L ${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
  return d;
}

const CORNER_R = 8;
const GAP      = 40; // - clearance beyond the actual node boundary before turning

/**
 * Route an edge that needs to "go backwards" — handle pointing away from target.
 *
 * @param nodeRight  - right boundary of the widest of the two nodes (flow coords)
 * @param nodeBottom - bottom boundary of the tallest of the two nodes (flow coords)
 *
 * For vertical backward edges (e.g. B.bottom → A.top with A above B):
 *   exits handle direction → sweeps right past nodeRight+GAP → travels up → enters target
 * For horizontal backward edges: same logic rotated 90°.
 */
function buildBackwardPath(
  sx: number, sy: number, sPos: Position,
  tx: number, ty: number, tPos: Position,
  offset: number,
  nodeRight:  number,
  nodeBottom: number,
): [string, number, number] {

  const isVert =
    (sPos === Position.Top    || sPos === Position.Bottom) &&
    (tPos === Position.Top    || tPos === Position.Bottom);

  if (isVert) {
    const sExitY  = sPos === Position.Bottom ? sy + offset : sy - offset;
    const tEntryY = tPos === Position.Top    ? ty - offset : ty + offset;
    // - route outside the rightmost boundary of both nodes
    const sideX   = nodeRight + GAP;

    const pts: [number, number][] = [
      [sx,    sy],
      [sx,    sExitY],
      [sideX, sExitY],
      [sideX, tEntryY],
      [tx,    tEntryY],
      [tx,    ty],
    ];
    return [
      waypointPath(pts, CORNER_R),
      sideX,              // - label on the vertical side segment
      (sExitY + tEntryY) / 2,
    ];
  }

  // - horizontal backward: route below the bottommost boundary of both nodes
  const sExitX  = sPos === Position.Right ? sx + offset : sx - offset;
  const tEntryX = tPos === Position.Left  ? tx - offset : tx + offset;
  const sideY   = nodeBottom + GAP;

  const pts: [number, number][] = [
    [sx,      sy],
    [sExitX,  sy],
    [sExitX,  sideY],
    [tEntryX, sideY],
    [tEntryX, ty],
    [tx,      ty],
  ];
  return [
    waypointPath(pts, CORNER_R),
    (sExitX + tEntryX) / 2,
    sideY,                // - label on the horizontal bottom segment
  ];
}

// ─── component ────────────────────────────────────────────────────────────────

export function LabeledEdgeComponent({
  id, source, target,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, label, markerEnd, selected,
}: EdgeProps): JSX.Element {

  // - look up actual node dimensions so routing clears the node bodies
  // - (handle positions are at node centers; using them as the boundary underestimates by width/2)
  const sNode = useStore(s => s.nodes.find(n => n.id === source));
  const tNode = useStore(s => s.nodes.find(n => n.id === target));

  const nodeRight = Math.max(
    sNode
      ? sNode.position.x + (sNode.measured?.width  ?? Number((sNode.style as React.CSSProperties | undefined)?.width  ?? 200))
      : sourceX + 100,
    tNode
      ? tNode.position.x + (tNode.measured?.width  ?? Number((tNode.style as React.CSSProperties | undefined)?.width  ?? 200))
      : targetX + 100,
  );
  const nodeBottom = Math.max(
    sNode
      ? sNode.position.y + (sNode.measured?.height ?? Number((sNode.style as React.CSSProperties | undefined)?.height ?? 150))
      : sourceY + 75,
    tNode
      ? tNode.position.y + (tNode.measured?.height ?? Number((tNode.style as React.CSSProperties | undefined)?.height ?? 150))
      : targetY + 75,
  );

  // - "backward": the source handle points away from the target node.
  // - getSmoothStepPath degenerates in this case (U-shape collapses to 0 width).
  const isBackward =
    (sourcePosition === Position.Bottom && targetY < sourceY) ||
    (sourcePosition === Position.Top    && targetY > sourceY) ||
    (sourcePosition === Position.Left   && targetX > sourceX) ||
    (sourcePosition === Position.Right  && targetX < sourceX);

  const [edgePath, labelX, labelY] = isBackward
    ? buildBackwardPath(
        sourceX, sourceY, sourcePosition,
        targetX, targetY, targetPosition,
        40, nodeRight, nodeBottom,
      )
    : getSmoothStepPath({
        sourceX, sourceY, sourcePosition,
        targetX, targetY, targetPosition,
        borderRadius: 8,
        offset: 40,
      });

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
              position:  'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize:  10,
              padding:   '2px 6px',
              borderRadius: 4,
              background: 'var(--vscode-editor-background)',
              border:     '1px solid var(--vscode-editorWidget-border)',
              color:      'var(--vscode-foreground)',
              opacity:    0.85,
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
