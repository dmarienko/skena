/**
 * Spatial navigation and the reveal pan. Pure: CanvasView maps its refs into these, so both are
 * testable without React Flow. `findNearestNode` picks the node a direction key lands on;
 * `revealPan` returns the smallest viewport move that shows a node (with its output when the pair
 * fits).
 */

import { laneIndexForNode, pinnedLaneIndex, sortLanes, type SectionLane } from '../../shared/sectionLanes';

export type NavDir = 'left' | 'right' | 'up' | 'down';
export interface NavNode { id: string; x: number; y: number; w: number; h: number }
export interface NavEdge { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
export interface NavContext { nodes: NavNode[]; edges: NavEdge[]; lanes: SectionLane[] }

// - primary-axis displacement must be ≥ CONE × the perpendicular one (~59° half-cone)
const CONE = 0.6;
// - ranking inside the cone: aligned beats near
const CROSS_WEIGHT = 2.5;

const centre = (n: NavNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/**
 * How far `to` sits from `from` along `dir`: the displacement on the pressed axis plus the
 * off-axis one weighted up, so an aligned node beats a nearer one that is off to the side.
 * Shared with the g-chord follow, which ranks the edge targets on a border the same way.
 */
export function navScore(from: NavNode, to: NavNode, dir: NavDir): number {
  const a = centre(from), b = centre(to);
  const dx = b.x - a.x, dy = b.y - a.y;
  return dir === 'left' || dir === 'right'
    ? Math.abs(dx) + Math.abs(dy) * CROSS_WEIGHT
    : Math.abs(dy) + Math.abs(dx) * CROSS_WEIGHT;
}

/**
 * The node to focus when `dir` is pressed on `from`, or null when nothing qualifies.
 * Candidates are visible nodes (in no fold list). `left`/`right` stay in `from`'s section;
 * `up`/`down` may cross into any open section. A node wired to `from` on the pressed side is one
 * more candidate under those same exclusions, scored like the rest but without the cone test.
 */
export function findNearestNode(from: NavNode, dir: NavDir, ctx: NavContext): string | null {
  const horiz = dir === 'left' || dir === 'right';
  const sorted = sortLanes(ctx.lanes);
  const pinned = pinnedLaneIndex(sorted);
  const laneOf = (n: NavNode) => (sorted.length ? laneIndexForNode(sorted, { id: n.id, y: n.y }, pinned) : -1);
  const fromLane = laneOf(from);
  const reachable = (n: NavNode) => !pinned.has(n.id) && (!horiz || laneOf(n) === fromLane);
  const fc = centre(from);
  const inDir = (dx: number, dy: number) =>
    dir === 'left' ? dx < 0 : dir === 'right' ? dx > 0 : dir === 'up' ? dy < 0 : dy > 0;
  const inCone = (dx: number, dy: number) =>
    horiz ? Math.abs(dx) >= Math.abs(dy) * CONE : Math.abs(dy) >= Math.abs(dx) * CONE;

  // - handles are named top/right/bottom/left; an edge carries the canvas fromSide/toSide
  const side = dir === 'up' ? 'top' : dir === 'down' ? 'bottom' : dir;
  const wired = new Set<string>();
  for (const e of ctx.edges) {
    if (e.source === from.id && e.sourceHandle === side) wired.add(e.target);
    else if (e.target === from.id && e.targetHandle === side) wired.add(e.source);
  }

  let best: string | null = null;
  let bestScore = Infinity;
  for (const n of ctx.nodes) {
    if (n.id === from.id || !reachable(n)) continue;
    const c = centre(n);
    const dx = c.x - fc.x, dy = c.y - fc.y;
    // - a wired node qualifies wherever it sits; every other candidate has to be in the cone
    if (!wired.has(n.id) && (!inDir(dx, dy) || !inCone(dx, dy))) continue;
    const s = navScore(from, n, dir);
    // - strict <, so ties keep the first node in canvas order
    if (s < bestScore) { bestScore = s; best = n.id; }
  }
  return best;
}

export interface Box { x1: number; y1: number; x2: number; y2: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Viewport { x: number; y: number; zoom: number }

export const REVEAL_MARGIN = 24;

/**
 * The smallest pan that shows `node` — or `pair` (node + output) when that box fits inside `area`
 * at the current zoom — with `margin` px kept clear. Null when nothing has to move. Zoom is kept;
 * a box wider/taller than the area is aligned on the edge it overflows.
 * `node`/`pair` are flow coordinates; `area` and the result are pane pixels.
 */
export function revealPan(node: Box, pair: Box | null, area: Rect, vp: Viewport, margin = REVEAL_MARGIN): { x: number; y: number } | null {
  const usableW = area.right - area.left - 2 * margin;
  const usableH = area.bottom - area.top - 2 * margin;
  const fits = (b: Box) => (b.x2 - b.x1) * vp.zoom <= usableW && (b.y2 - b.y1) * vp.zoom <= usableH;
  const box = pair && fits(pair) ? pair : node;
  const sx1 = box.x1 * vp.zoom + vp.x, sy1 = box.y1 * vp.zoom + vp.y;
  const sx2 = box.x2 * vp.zoom + vp.x, sy2 = box.y2 * vp.zoom + vp.y;
  let dx = 0, dy = 0;
  if (sx1 < area.left + margin) dx = area.left + margin - sx1;
  else if (sx2 > area.right - margin) dx = area.right - margin - sx2;
  if (sy1 < area.top + margin) dy = area.top + margin - sy1;
  else if (sy2 > area.bottom - margin) dy = area.bottom - margin - sy2;
  if (dx === 0 && dy === 0) return null;
  return { x: vp.x + dx, y: vp.y + dy };
}
