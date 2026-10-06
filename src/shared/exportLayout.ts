/**
 * Where everything sits on the exported HTML page: the canvas nodes at their own x/y/width/height,
 * every section unfolded with its members placed where an unfold puts them, and the page box
 * around all of it. Pure; the HTML export (src/extension/export) builds the page from this.
 */

import { deriveLanes, isGroup, migrateSections, sortLanes, unfoldLane, type DerivedLane, type SectionLane } from './sectionLanes';
import { ensureLabels } from './nodeLabels';
import type { CanvasData, CanvasEdge, CanvasNode } from './types';

/** - px of empty page around the content */
export const EXPORT_MARGIN = 40;

export interface ExportLayout {
  /** - every node but the groups, each with a label, folded members moved to where an unfold puts them */
  nodes: CanvasNode[];
  /** - the edges whose two ends are both in `nodes` */
  edges: CanvasEdge[];
  /** - every section, none folded; empty when the canvas has no sections */
  lanes: DerivedLane[];
  /** - ids of the sections that are folded on the canvas */
  foldedLaneIds: string[];
}

/** The page's top-left corner in canvas coordinates, and its size. */
export interface PageBox { left: number; top: number; width: number; height: number }

function hasSections(canvas: CanvasData): boolean {
  return (canvas.metadata?.sections?.length ?? 0) > 0 || canvas.nodes.some(n => (n as { type?: string }).type === 'section');
}

/**
 * The canvas as the export draws it. The file's data is not changed: labels, the section migration
 * and the unfolds are applied to copies. A canvas without sections gets none (the seed lane the
 * migration adds for the webview is dropped).
 */
export function exportLayout(canvas: CanvasData, now: number): ExportLayout {
  const migrated = migrateSections(canvas, now);
  let nodes = ensureLabels(migrated.nodes).filter(n => !isGroup(n));
  const ids = new Set(nodes.map(n => n.id));
  const edges = migrated.edges.filter(e => ids.has(e.fromNode) && ids.has(e.toNode));
  let lanes: SectionLane[] = hasSections(canvas) ? sortLanes(migrated.metadata?.sections ?? []) : [];
  const foldedLaneIds = lanes.filter(l => l.folded).map(l => l.id);
  for (const id of foldedLaneIds) {
    const r = unfoldLane(lanes, nodes, id);
    nodes = nodes.map(n => (r.nodeShifts[n.id] ? { ...n, y: n.y + r.nodeShifts[n.id] } : n));
    lanes = r.lanes;
  }
  return { nodes, edges, lanes: deriveLanes(nodes, lanes), foldedLaneIds };
}

/**
 * The page box: the nodes, the section ranges and `extra` points (edge routes, label anchors), with
 * `margin` on every side. Sections add their top and bottom only; their frames span the page width.
 */
export function pageBox(layout: Pick<ExportLayout, 'nodes' | 'lanes'>, extra: readonly [number, number][], margin = EXPORT_MARGIN): PageBox {
  const xs: number[] = [], ys: number[] = [];
  for (const n of layout.nodes) { xs.push(n.x, n.x + n.width); ys.push(n.y, n.y + n.height); }
  for (const l of layout.lanes) ys.push(l.top, l.bottom);
  for (const [x, y] of extra) { xs.push(x); ys.push(y); }
  if (xs.length === 0) xs.push(0);
  if (ys.length === 0) ys.push(0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { left: minX - margin, top: minY - margin, width: maxX - minX + 2 * margin, height: maxY - minY + 2 * margin };
}
