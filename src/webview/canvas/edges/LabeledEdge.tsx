/**
 * LabeledEdge — canvas edge with optional label at midpoint.
 *
 * Routing strategy:
 *   An edge inside a section is routed with the whole section in one pass by CanvasView
 *   (src/shared/edgeRouting.ts); this component only draws the polyline it finds in
 *   EdgeRoutesContext.  An edge with no entry there — the two ends in different sections,
 *   or a canvas with no sections — falls back to the per-edge orthogonal router
 *   (routing/orthogonal.ts), which produces PCB-style axis-aligned polylines that avoid all
 *   node bounding boxes.  Corners are drawn with small quadratic-bezier rounds (8 px radius).
 *
 * Colour:
 *   The colour set on the canvas edge wins.  Without one the edge takes its kind's colour,
 *   turned by its variant (palette.edgeKindColor), so the edges leaving one border differ.
 *   While the edge is animated — the run path from a running cell to its kernel — it draws
 *   lightened and wider.  The arrowhead follows the stroke: React Flow builds its marker defs
 *   from the edge object, which cannot know the computed colour, so an edge colouring itself
 *   renders its own marker.
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
import { useZoomInvariantBorderWidth } from '../nodes/nodeShared';
import { edgeKindColor, lighten } from '../palette';
import { useEdgeRoute } from '../EdgeRoutesContext';
import { useThemeTick } from '../../theme';

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

// - what the fallback router needs of a React Flow node, taken structurally so this file does not
//   depend on the store's internal node type
interface ObstacleNode {
  type?: string;
  position: { x: number; y: number };
  measured?: { width?: number | null; height?: number | null };
  style?: unknown;
}

// - how much brighter and wider a running edge draws than the same edge at rest
const RUNNING_LIGHTEN = 0.25;
const RUNNING_WIDTH = 1.3;

/**
 * A marker id for one edge. Sanitising alone is not injective — two ids differing only in a stripped
 * character would collide, and `url(#…)` takes the first match — so a hash of the raw id follows it.
 */
function markerKey(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return `${id.replace(/[^\w-]/g, '_')}-${(h >>> 0).toString(36)}`;
}

// - every non-group node as a box the per-edge fallback router must stay out of
function obstacles(nodes: readonly ObstacleNode[]): NodeRect[] {
  return nodes
    .filter(n => n.type !== 'group')
    .map(n => ({
      x: n.position.x,
      y: n.position.y,
      w: n.measured?.width  ?? Number((n.style as React.CSSProperties | undefined)?.width  ?? 200),
      h: n.measured?.height ?? Number((n.style as React.CSSProperties | undefined)?.height ?? 150),
    }));
}

// ─── component ────────────────────────────────────────────────────────────────

export function LabeledEdgeComponent({
  id, source, target,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, label, markerEnd, selected, animated, data,
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

  const allNodes = useStore(s => s.nodes);
  const route = useEdgeRoute(id);

  // - the section pass drew this one; otherwise route it alone against every non-group node as before
  const pts = route && !route.fallback && route.points.length >= 2
    ? route.points
    : routeOrthogonal(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, obstacles(allNodes));
  const edgePath = waypointPath(pts, ORTHOGONAL_CORNER_R);
  // - label at midpoint of the middle segment
  const mi     = Math.max(1, Math.floor(pts.length / 2));
  const labelX = (pts[mi - 1][0] + pts[mi][0]) / 2;
  const labelY = (pts[mi - 1][1] + pts[mi][1]) / 2;

  // - zoom-invariant edge width (shared scaler with node borders) so connectors stay
  // - visible when zoomed out; wider than the old fixed 1.5px
  const sw = useZoomInvariantBorderWidth(1.5);
  // - edgeKindColor reads the VS Code theme kind once, at this render; the tick re-renders on a swap
  useThemeTick();
  // - a colour set on the canvas edge is in style.stroke and wins; without one the kind decides, and
  //   an edge with no route at all is a context edge until the section pass says otherwise
  const baseColor = ((style as React.CSSProperties | undefined)?.stroke as string | undefined)
    ?? edgeKindColor(route?.kind ?? 'context', route?.variant ?? 0);
  // - running: this edge is on the path from a running cell to its kernel (spec §3)
  const edgeColor = animated ? lighten(baseColor, RUNNING_LIGHTEN) : baseColor;
  const width = animated ? sw * RUNNING_WIDTH : sw;
  const activeStyle: React.CSSProperties = selected
    ? { ...style, stroke: edgeColor, strokeWidth: width * 1.6, filter: `drop-shadow(0 0 4px ${edgeColor})` }
    : { ...style, stroke: edgeColor, strokeWidth: width };

  // - React Flow resolves an edge's markerEnd object into a url() before this component sees it, so an
  //   arrow whose colour was decided here needs a marker of its own
  const ownArrow = !markerEnd && ((data as { arrow?: boolean } | undefined)?.arrow ?? false);
  const arrowId = `sk-arrow-${markerKey(id)}`;

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

  return (
    <>
      {ownArrow && (
        <defs>
          <marker
            id={arrowId} className="react-flow__arrowhead" markerWidth="12.5" markerHeight="12.5"
            viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0"
          >
            <polyline
              className="arrowclosed" points="-5,-4 0,0 -5,4 -5,-4" strokeWidth="1"
              strokeLinecap="round" strokeLinejoin="round" stroke={edgeColor} fill={edgeColor}
            />
          </marker>
        </defs>
      )}
      <BaseEdge id={id} path={edgePath} style={activeStyle} markerEnd={ownArrow ? `url(#${arrowId})` : markerEnd} />

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
