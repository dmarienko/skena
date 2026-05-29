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
 *
 * Label editing:
 *   Double-click the edge path (or existing label) → enters inline edit mode.
 *   CanvasView fires `skena:editEdgeLabel` with { id } to trigger this.
 *   On commit (Enter / blur) the component fires `skena:edgeLabelSave` with { id, label }.
 *   Escape cancels without saving.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EdgeProps, BaseEdge, EdgeLabelRenderer, Position, useStore } from '@xyflow/react';
import { useHeatmap } from '../../context/HeatmapContext';

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
 * Adaptive bezier: control-point length scales with handle distance so nearby nodes
 * get gentle curves and distant nodes get proportional arcs. Eliminates the harsh
 * right-angle zigzag that fixed-offset SmoothStep produces for close nodes.
 *
 * cpLen = clamp(dist * 0.45, 30, 150)
 */
function adaptiveBezierPath(
  sx: number, sy: number, sPos: Position,
  tx: number, ty: number, tPos: Position,
): [string, number, number] {
  const dir: Record<Position, [number, number]> = {
    [Position.Left]:   [-1,  0],
    [Position.Right]:  [ 1,  0],
    [Position.Top]:    [ 0, -1],
    [Position.Bottom]: [ 0,  1],
  };
  const [sdx, sdy] = dir[sPos];
  const [tdx, tdy] = dir[tPos];
  const dist  = Math.hypot(tx - sx, ty - sy);
  const cpLen = Math.max(30, Math.min(dist * 0.45, 150));
  const cp1x  = sx + sdx * cpLen;
  const cp1y  = sy + sdy * cpLen;
  const cp2x  = tx + tdx * cpLen;
  const cp2y  = ty + tdy * cpLen;
  // - midpoint of cubic bezier at t=0.5 via De Casteljau
  const lx = (sx + 3 * cp1x + 3 * cp2x + tx) / 8;
  const ly = (sy + 3 * cp1y + 3 * cp2y + ty) / 8;
  return [`M ${sx},${sy} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${tx},${ty}`, lx, ly];
}

/**
 * Route an edge that is clearly "going backwards" — handle pointing away from target
 * with the target more than BACK_THRESH px in the wrong direction.
 *
 * For vertical backward (e.g. B.bottom → A.top with A above B):
 *   pick left or right side depending on which is closer to the pair midpoint.
 * For horizontal backward: pick top or bottom side by the same criterion.
 */
function buildBackwardPath(
  sx: number, sy: number, sPos: Position,
  tx: number, ty: number, tPos: Position,
  offset:     number,
  nodeLeft:   number,  // - min X of both node left edges
  nodeRight:  number,  // - max X of both node right edges
  nodeTop:    number,  // - min Y of both node top edges
  nodeBottom: number,  // - max Y of both node bottom edges
): [string, number, number] {

  const isVert =
    (sPos === Position.Top    || sPos === Position.Bottom) &&
    (tPos === Position.Top    || tPos === Position.Bottom);

  if (isVert) {
    const sExitY  = sPos === Position.Bottom ? sy + offset : sy - offset;
    const tEntryY = tPos === Position.Top    ? ty - offset : ty + offset;
    // - pick left or right: whichever side requires less horizontal travel
    const midX  = (sx + tx) / 2;
    const leftX = nodeLeft  - GAP;
    const rightX = nodeRight + GAP;
    const sideX  = Math.abs(midX - leftX) < Math.abs(midX - rightX) ? leftX : rightX;

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
      sideX,
      (sExitY + tEntryY) / 2,
    ];
  }

  // - horizontal backward: pick top or bottom side by the same criterion
  const sExitX  = sPos === Position.Right ? sx + offset : sx - offset;
  const tEntryX = tPos === Position.Left  ? tx - offset : tx + offset;
  const midY   = (sy + ty) / 2;
  const topY   = nodeTop    - GAP;
  const botY   = nodeBottom + GAP;
  const sideY  = Math.abs(midY - topY) < Math.abs(midY - botY) ? topY : botY;

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
    sideY,
  ];
}

// ─── component ────────────────────────────────────────────────────────────────

export function LabeledEdgeComponent({
  id, source, target,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, label, markerEnd, selected,
}: EdgeProps): JSX.Element {

  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(String(label ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  // - sync draft when label prop changes from outside (e.g. undo/redo)
  useEffect(() => { if (!editing) setDraft(String(label ?? '')); }, [label, editing]);

  // - CanvasView fires this when the user double-clicks the edge path
  useEffect(() => {
    const handler = (e: Event) => {
      const { id: targetId } = (e as CustomEvent<{ id: string }>).detail;
      if (targetId !== id) return;
      setDraft(String(label ?? ''));
      setEditing(true);
    };
    window.addEventListener('skena:editEdgeLabel', handler);
    return () => window.removeEventListener('skena:editEdgeLabel', handler);
  }, [id, label]);

  // - focus input as soon as edit mode activates
  useEffect(() => {
    if (editing) requestAnimationFrame(() => inputRef.current?.focus());
  }, [editing]);

  const commit = useCallback((value: string) => {
    setEditing(false);
    window.dispatchEvent(new CustomEvent('skena:edgeLabelSave', { detail: { id, label: value.trim() } }));
  }, [id]);

  const cancel = useCallback(() => setEditing(false), []);

  // - look up actual node dimensions so backward-path routing clears node bodies
  const sNode = useStore(s => s.nodes.find(n => n.id === source));
  const tNode = useStore(s => s.nodes.find(n => n.id === target));

  const nodeLeft = Math.min(
    sNode ? sNode.position.x : sourceX - 100,
    tNode ? tNode.position.x : targetX - 100,
  );
  const nodeRight = Math.max(
    sNode
      ? sNode.position.x + (sNode.measured?.width  ?? Number((sNode.style as React.CSSProperties | undefined)?.width  ?? 200))
      : sourceX + 100,
    tNode
      ? tNode.position.x + (tNode.measured?.width  ?? Number((tNode.style as React.CSSProperties | undefined)?.width  ?? 200))
      : targetX + 100,
  );
  const nodeTop = Math.min(
    sNode ? sNode.position.y : sourceY - 75,
    tNode ? tNode.position.y : targetY - 75,
  );
  const nodeBottom = Math.max(
    sNode
      ? sNode.position.y + (sNode.measured?.height ?? Number((sNode.style as React.CSSProperties | undefined)?.height ?? 150))
      : sourceY + 75,
    tNode
      ? tNode.position.y + (tNode.measured?.height ?? Number((tNode.style as React.CSSProperties | undefined)?.height ?? 150))
      : targetY + 75,
  );

  // - only use explicit U-routing for edges that are clearly going the wrong way (> 30 px).
  // - mild backward cases are handled naturally by adaptiveBezierPath.
  const BACK_THRESH = 30;
  const isBackward =
    (sourcePosition === Position.Bottom && targetY < sourceY - BACK_THRESH) ||
    (sourcePosition === Position.Top    && targetY > sourceY + BACK_THRESH) ||
    (sourcePosition === Position.Left   && targetX > sourceX + BACK_THRESH) ||
    (sourcePosition === Position.Right  && targetX < sourceX - BACK_THRESH);

  const [edgePath, labelX, labelY] = isBackward
    ? buildBackwardPath(
        sourceX, sourceY, sourcePosition,
        targetX, targetY, targetPosition,
        40, nodeLeft, nodeRight, nodeTop, nodeBottom,
      )
    : adaptiveBezierPath(
        sourceX, sourceY, sourcePosition,
        targetX, targetY, targetPosition,
      );

  const activeStyle = selected
    ? {
        ...style,
        strokeWidth: (Number(style?.strokeWidth) || 1.5) + 1,
        filter: `drop-shadow(0 0 4px ${style?.stroke ?? '#888888'})`,
      }
    : style;

  const { visible: hmVisible, edgeGlow } = useHeatmap();
  const hmEdge = hmVisible ? edgeGlow.get(id) : undefined;

  // - non-heatmap style (selection highlight or plain)
  const finalStyle: React.CSSProperties = hmEdge
    ? { ...activeStyle, stroke: hmEdge.stroke, strokeWidth: Number(activeStyle?.strokeWidth ?? 1.5) }
    : (activeStyle ?? {});

  // - match label border to cluster color when heatmap is active, or edge stroke otherwise
  const edgeColor = hmEdge ? `rgb(${hmEdge.color})` : ((finalStyle?.stroke ?? style?.stroke ?? '#888888') as string);

  const labelStyle: React.CSSProperties = {
    position:     'absolute',
    transform:    `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
    fontSize:     10,
    padding:      '2px 7px',
    borderRadius: 5,
    background:   'var(--vscode-editor-background)',
    border:       `1.5px solid ${edgeColor}`,
    color:        'var(--vscode-foreground)',
    pointerEvents: 'all',
    whiteSpace:   'nowrap',
    // - elevateEdgesOnSelect raises the SVG edge above the EdgeLabelRenderer portal;
    // - a positive zIndex keeps the label on top regardless of edge selection state
    zIndex:       10,
  };

  // - gradient direction: old-end (low intensity) → new-end (high intensity)
  // - if source is older, gradient runs source→target; otherwise target→source
  const gradId = `hm-eg-${id}`;
  const blurId = `hm-eb-${id}`;
  const srcIsOld = !hmEdge || hmEdge.sourceIntensity <= hmEdge.targetIntensity;
  const [oldX, oldY] = srcIsOld ? [sourceX, sourceY] : [targetX, targetY];
  const [newX, newY] = srcIsOld ? [targetX, targetY] : [sourceX, sourceY];

  return (
    <>
      {hmEdge && (
        <defs>
          {/* - gradient from transparent at old-end to the arrival node's intensity at new-end */}
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse"
            x1={oldX} y1={oldY} x2={newX} y2={newY}>
            <stop offset="0%"   stopColor={`rgb(${hmEdge.color})`} stopOpacity="0"                                        />
            <stop offset="35%"  stopColor={`rgb(${hmEdge.color})`} stopOpacity={(hmEdge.intensity * 0.18).toFixed(2)}     />
            <stop offset="70%"  stopColor={`rgb(${hmEdge.color})`} stopOpacity={(hmEdge.intensity * 0.60).toFixed(2)}     />
            <stop offset="100%" stopColor={`rgb(${hmEdge.color})`} stopOpacity={hmEdge.intensity.toFixed(2)}              />
          </linearGradient>
          {/* - blur for the outer bloom layer */}
          <filter id={blurId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation={hmEdge.glowBlur.toFixed(1)} />
          </filter>
        </defs>
      )}

      {hmEdge ? (
        <>
          {/* - wide soft bloom — gradient opacity makes it appear only near the new end */}
          <path d={edgePath} stroke={`url(#${gradId})`}
            strokeWidth={hmEdge.glowWidth} fill="none"
            filter={`url(#${blurId})`} />
          {/* - medium sharp glow — halo that grows toward new end; opacity cap = arrival intensity */}
          <path d={edgePath} stroke={`url(#${gradId})`}
            strokeWidth={(hmEdge.glowWidth * 0.35).toFixed(1)} fill="none"
            opacity={(hmEdge.intensity * 0.85).toFixed(2)} />
          {/* - thin core line — always visible, carries the arrowhead */}
          <path d={edgePath} className="react-flow__edge-path"
            stroke={`rgba(${hmEdge.color},${(hmEdge.intensity * 0.8).toFixed(2)})`} strokeWidth="1.5"
            fill="none" markerEnd={markerEnd} />
        </>
      ) : (
        <BaseEdge id={id} path={edgePath} style={finalStyle} markerEnd={markerEnd} />
      )}

      <EdgeLabelRenderer>
        {editing ? (
          <input
            ref={inputRef}
            className="nodrag nopan skena-edge-label-input"
            style={{ ...labelStyle, minWidth: 80, outline: 'none' }}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
          />
        ) : (
          // - always render a hit-area div so double-click works even with no label
          <div
            className="nodrag nopan"
            style={{
              ...labelStyle,
              opacity:   label ? 1 : 0,
              minWidth:  label ? undefined : 20,
              minHeight: label ? undefined : 12,
              cursor:    'text',
            }}
            onDoubleClick={e => {
              e.stopPropagation();
              setDraft(String(label ?? ''));
              setEditing(true);
            }}
          >
            {label ? String(label) : ''}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
