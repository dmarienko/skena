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

  // - look up actual node dimensions so routing clears the node bodies
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

  // - match label border to the edge stroke color so it reads as part of the connection
  const edgeColor = (style?.stroke as string | undefined) ?? '#888888';

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
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={activeStyle} markerEnd={markerEnd} />
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
