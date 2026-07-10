/**
 * LabeledEdge — canvas edge with optional label at midpoint.
 *
 * Routing strategy:
 *   All connections use the orthogonal router (routing/orthogonal.ts) which produces
 *   PCB-style axis-aligned polylines that avoid all node bounding boxes.  The router
 *   tries L-shapes first, then Z-shapes, then scans obstacle boundaries for a clear
 *   channel.  Corners are drawn with small quadratic-bezier rounds (8 px radius).
 *
 * Label editing:
 *   Double-click the edge path (or existing label) → enters inline edit mode.
 *   CanvasView fires `skena:editEdgeLabel` with { id } to trigger this.
 *   On commit (Enter / blur) the component fires `skena:edgeLabelSave` with { id, label }.
 *   Escape cancels without saving.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EdgeProps, BaseEdge, EdgeLabelRenderer, Position, useStore } from '@xyflow/react';
import { routeOrthogonal, ORTHOGONAL_CORNER_R, NodeRect } from '../routing/orthogonal';
import { useHeatmap } from '../../context/HeatmapContext';
import { useZoomInvariantBorderWidth } from '../nodes/nodeShared';
import { EDGE_FALLBACK_COLOR } from '../palette';

// ─── SVG path builder ────────────────────────────────────────────────────────

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

function waypointPath(pts: [number, number][], r: number): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    d += ' ' + roundedCorner(pts[i - 1], pts[i], pts[i + 1], r);
  }
  d += ` L ${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
  return d;
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

  // - build obstacle list from all non-group nodes for orthogonal routing
  const allNodes = useStore(s => s.nodes);
  const rects: NodeRect[] = allNodes
    .filter(n => n.type !== 'group')
    .map(n => ({
      x: n.position.x,
      y: n.position.y,
      w: n.measured?.width  ?? Number((n.style as React.CSSProperties | undefined)?.width  ?? 200),
      h: n.measured?.height ?? Number((n.style as React.CSSProperties | undefined)?.height ?? 150),
    }));

  // - orthogonal route (obstacle-avoiding, PCB-style)
  const pts = routeOrthogonal(
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    rects,
  );
  const edgePath = waypointPath(pts, ORTHOGONAL_CORNER_R);
  // - label at midpoint of the middle segment
  const mi     = Math.max(1, Math.floor(pts.length / 2));
  const labelX = (pts[mi - 1][0] + pts[mi][0]) / 2;
  const labelY = (pts[mi - 1][1] + pts[mi][1]) / 2;

  // - zoom-invariant edge width (shared scaler with node borders) so connectors stay
  // - visible when zoomed out; wider than the old fixed 1.5px
  const sw = useZoomInvariantBorderWidth(1.5);
  const activeStyle = selected
    ? {
        ...style,
        strokeWidth: sw * 1.6,
        filter: `drop-shadow(0 0 4px ${style?.stroke ?? EDGE_FALLBACK_COLOR})`,
      }
    : { ...style, strokeWidth: sw };

  const { visible: hmVisible, edgeGlow } = useHeatmap();
  const hmEdge = hmVisible ? edgeGlow.get(id) : undefined;

  // - non-heatmap style (selection highlight or plain)
  const finalStyle: React.CSSProperties = hmEdge
    ? { ...activeStyle, stroke: hmEdge.stroke, strokeWidth: Number(activeStyle?.strokeWidth ?? 1.5) }
    : (activeStyle ?? {});

  // - match label border to cluster color when heatmap is active, or edge stroke otherwise
  const edgeColor = hmEdge ? `rgb(${hmEdge.color})` : ((finalStyle?.stroke ?? style?.stroke ?? EDGE_FALLBACK_COLOR) as string);

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
            stroke={`rgba(${hmEdge.color},${(hmEdge.intensity * 0.8).toFixed(2)})`} strokeWidth={sw}
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
