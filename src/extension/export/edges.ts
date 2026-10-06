/**
 * The edges of the exported page, routed as the canvas routes them: every edge inside one section
 * by that section's routing pass (shared/edgeRouting.ts, as CanvasView runs it), any other edge by
 * the per-edge router LabeledEdge falls back to. Colours, dashes and arrows follow LabeledEdge at
 * zoom 1. Pure.
 */

import { borderPoint, facingSide, routeSection, sideOfHandle, type EdgeKind, type Point, type RoutedEdge, type RouteNode, type Side } from '../../shared/edgeRouting';
import { ORTHOGONAL_CORNER_R, routeOrthogonal } from '../../shared/orthogonalRoute';
import { edgeLabelPoint, waypointPath } from '../../shared/edgePath';
import { CANVAS_COLORS } from '../../shared/constants';
import type { ExportLayout } from '../../shared/exportLayout';
import type { CanvasNode } from '../../shared/types';
import { nodeBorderColor } from '../../webview/canvas/palette';

/** - LabeledEdge's 1 px line through the node border scaler at zoom 1 (BORDER_WIDTH_SCALE 1.8) */
export const EDGE_WIDTH = 1.8;
export const EDGE_OPACITY = 0.6;
// - an edge whose source type has no border colour (THEME.dark.edgeContext in palette.ts)
const FALLBACK_COLOR = '#9a8fc4';

export interface ExportEdge {
  id: string;
  points: Point[];
  /** - SVG path data, corners rounded as on the canvas */
  d: string;
  label?: string;
  labelAt: Point;
  color: string;
  /** - the code → output link is dotted */
  dashed: boolean;
  arrow: boolean;
}

// - a css colour and nothing else (a hex, a name, rgb()/hsl() of numbers): the value goes into style and stroke attributes
const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?)\([\d\s.,%/+-]*\))$/i;

/** - a JSON Canvas colour ('1'…'6' or a hex) as the hex the canvas draws; undefined when the file's value is not a colour */
export function canvasColor(code?: string): string | undefined {
  const c = code ? (CANVAS_COLORS[code] ?? code).trim() : '';
  return CSS_COLOR.test(c) ? c : undefined;
}

const toRouteNode = (n: CanvasNode): RouteNode => ({
  id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height,
  outputNodeId: (n as { outputNodeId?: string }).outputNodeId,
});

export function exportEdges(layout: Pick<ExportLayout, 'nodes' | 'edges' | 'lanes'>): ExportEdge[] {
  const byId = new Map(layout.nodes.map(n => [n.id, n] as const));
  const routes = new Map<string, RoutedEdge>();
  for (const lane of layout.lanes) {
    const member = new Set(lane.memberIds);
    const nodes = layout.nodes.filter(n => member.has(n.id));
    const edges = layout.edges
      .filter(e => member.has(e.fromNode) && member.has(e.toNode))
      .map(e => ({ id: e.id, source: e.fromNode, target: e.toNode, sourceSide: sideOfHandle(e.fromSide), targetSide: sideOfHandle(e.toSide) }));
    if (edges.length === 0) continue;
    for (const r of routeSection(nodes.map(toRouteNode), edges)) routes.set(r.id, r);
  }
  const rects = layout.nodes.map(n => ({ x: n.x, y: n.y, w: n.width, h: n.height }));
  return layout.edges.map(e => {
    const s = byId.get(e.fromNode) as CanvasNode;
    const t = byId.get(e.toNode) as CanvasNode;
    const route = routes.get(e.id);
    let points: Point[];
    if (route && !route.fallback && route.points.length >= 2) points = route.points;
    else {
      const sb = { x: s.x, y: s.y, w: s.width, h: s.height };
      const tb = { x: t.x, y: t.y, w: t.width, h: t.height };
      const ss: Side = sideOfHandle(e.fromSide) ?? facingSide(sb, tb);
      const ts: Side = sideOfHandle(e.toSide) ?? facingSide(tb, sb);
      const [sx, sy] = borderPoint(sb, ss, 0);
      const [tx, ty] = borderPoint(tb, ts, 0);
      points = routeOrthogonal(sx, sy, ss, tx, ty, ts, rects);
    }
    const kind: EdgeKind = route?.kind ?? 'context';
    return {
      id: e.id,
      points,
      d: waypointPath(points, ORTHOGONAL_CORNER_R),
      label: e.label || undefined,
      labelAt: edgeLabelPoint(points),
      color: canvasColor(e.color) ?? nodeBorderColor(s.type, canvasColor(s.color)) ?? FALLBACK_COLOR,
      dashed: kind === 'output',
      arrow: e.toEnd === 'arrow' || !e.toEnd,
    };
  });
}
