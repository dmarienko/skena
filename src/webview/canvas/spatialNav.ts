/**
 * Spatial navigation and the reveal pan. Pure: CanvasView maps its refs into these, so both are
 * testable without React Flow. `findNearestNode` picks the node a direction key lands on;
 * `revealPan` returns the smallest viewport move that shows a node (with its output when the pair
 * fits); `edgesOnSide` orders the edges of one border and `connectionLabels` gives every connection
 * of a node the key that follows it.
 */

import { GRID } from '../../shared/constants';
import { facingSide, sideOfHandle, type Point, type Side } from '../../shared/edgeRouting';
import { laneIndexForNode, pinnedLaneIndex, sortLanes, type SectionLane } from '../../shared/sectionLanes';

export type NavDir = 'left' | 'right' | 'up' | 'down';
export interface NavNode { id: string; x: number; y: number; w: number; h: number }
export interface NavEdge { id?: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
export interface NavContext { nodes: NavNode[]; edges: NavEdge[]; lanes: SectionLane[] }

// - the off-axis miss may be CONE × the gap, or one grid when the gap is smaller: a node right
//   beside the source qualifies on any overlap, a distant one only while it stays roughly aligned
const CONE = 0.6;
// - ranking: aligned beats near
const CROSS_WEIGHT = 2.5;
// - a target whose near edge sits at most half a grid behind the source's far edge still counts
const BEHIND_SLACK = GRID / 2;

/**
 * The three distances between the boxes along `dir`, in flow units. `gap` runs from `from`'s far
 * edge to `to`'s near edge, and is negative when the two overlap on the pressed axis. `overlap` is
 * the length the two spans share on the other axis — 0 when they only touch, negative when they
 * miss. `off` is that miss, 0 from a touch upwards.
 */
function boxDelta(from: NavNode, to: NavNode, dir: NavDir): { gap: number; off: number; overlap: number } {
  const horiz = dir === 'left' || dir === 'right';
  const gap =
    dir === 'right' ? to.x - (from.x + from.w) :
    dir === 'left'  ? from.x - (to.x + to.w) :
    dir === 'down'  ? to.y - (from.y + from.h) :
                      from.y - (to.y + to.h);
  const aNear = horiz ? from.y : from.x, aFar = aNear + (horiz ? from.h : from.w);
  const bNear = horiz ? to.y : to.x,     bFar = bNear + (horiz ? to.h : to.w);
  const overlap = Math.min(aFar, bFar) - Math.max(aNear, bNear);
  return { gap, off: Math.max(0, -overlap), overlap };
}

/**
 * How far `to` sits from `from` along `dir`: the gap between the two boxes on the pressed axis plus
 * their off-axis miss weighted up, so an aligned node beats one off to the side. Measured edge to
 * edge, never centre to centre — a tall node beside a short one has a far-off centre but no gap.
 * A candidate that does not share any of the source's span on the other axis pays one grid on top
 * of the miss, so a neighbour sharing the row beats one merely touching its corner. That penalty is
 * in the score only: `findNearestNode` cones on the raw miss, or a touching node one grid away
 * would fall out of its own cone.
 */
export function navScore(from: NavNode, to: NavNode, dir: NavDir): number {
  const { gap, off, overlap } = boxDelta(from, to, dir);
  return gap + CROSS_WEIGHT * (overlap > 0 ? 0 : GRID + off);
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
  const inDir = (gap: number) => gap >= -BEHIND_SLACK;
  const inCone = (gap: number, off: number) => off <= CONE * Math.max(gap, GRID);

  // - handles are named top/right/bottom/left; an edge carries the canvas fromSide/toSide
  const side = dir === 'up' ? 'top' : dir === 'down' ? 'bottom' : dir;
  const wired = new Set<string>();
  for (const e of ctx.edges) {
    if (e.source === from.id && e.sourceHandle === side) wired.add(e.target);
    else if (e.target === from.id && e.targetHandle === side) wired.add(e.source);
  }

  let best: string | null = null;
  let bestScore = Infinity;
  let bestOverlap = -Infinity;
  for (const n of ctx.nodes) {
    if (n.id === from.id || !reachable(n)) continue;
    const { gap, off, overlap } = boxDelta(from, n, dir);
    // - a wired node qualifies wherever it sits; every other candidate has to be in the cone
    if (!wired.has(n.id) && (!inDir(gap) || !inCone(gap, off))) continue;
    const s = navScore(from, n, dir);
    // - equal scores go to the wider overlap; failing that the first node in canvas order stays
    if (s < bestScore || (s === bestScore && overlap > bestOverlap)) { bestScore = s; bestOverlap = overlap; best = n.id; }
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

// - the follow keys read the routing pass, which orders the edges of one border and hands each end a
//   slot: 0 is the topmost (a left / right border) or leftmost (a top / bottom border) exit point
export interface NavRoute { variant: number; variantIn: number; points: Point[] }
export interface EdgeSideContext {
  /** - the nodes a follow may land on: the caller drops band nodes and folded members */
  nodes: NavNode[];
  edges: NavEdge[];
  routes: ReadonlyMap<string, NavRoute>;
}
export interface SideCandidate {
  /** - the node `g` lands on */
  nodeId: string;
  edgeId?: string;
  /** - where the edge meets the border, from the route; absent while the edge has no route */
  at?: Point;
}

/**
 * The candidates `g` can land on from `from` through `side`: the other end of every edge attached to
 * that border, ordered by the slot the routing pass gave that end — the order the exit points are
 * drawn in, topmost / leftmost first. An edge the pass did not route (its two ends sit in different
 * sections, or the canvas has no sections) has no slot: those go after the slotted ones, ordered by
 * the y of the node at the other end.
 * Two edges may join the same pair on one border; the node is one candidate, taking the first slot.
 */
export function edgesOnSide(from: NavNode, side: Side, ctx: EdgeSideContext): SideCandidate[] {
  const byId = new Map(ctx.nodes.map(n => [n.id, n]));
  interface Ranked extends SideCandidate { slot: number | null; y: number; x: number }
  const best = new Map<string, Ranked>();
  for (const e of ctx.edges) {
    const fromIsSource = e.source === from.id;
    const otherId = fromIsSource ? e.target : e.target === from.id ? e.source : null;
    if (otherId === null || otherId === from.id) continue;
    const other = byId.get(otherId);
    if (!other) continue;
    const handle = sideOfHandle(fromIsSource ? e.sourceHandle : e.targetHandle);
    if ((handle ?? facingSide(from, other)) !== side) continue;
    const route = e.id === undefined ? undefined : ctx.routes.get(e.id);
    const ends = route?.points ?? [];
    const cand: Ranked = {
      nodeId: otherId,
      edgeId: e.id,
      at: ends.length ? (fromIsSource ? ends[0] : ends[ends.length - 1]) : undefined,
      slot: route ? (fromIsSource ? route.variant : route.variantIn) : null,
      y: other.y, x: other.x,
    };
    const held = best.get(otherId);
    if (!held || rank(cand, held) < 0) best.set(otherId, cand);
  }
  return [...best.values()].sort(rank).map(({ nodeId, edgeId, at }) => ({ nodeId, edgeId, at }));
}

// - a slotted candidate always precedes an unslotted one; ties among the unslotted go by position
function rank(a: { slot: number | null; y: number; x: number }, b: { slot: number | null; y: number; x: number }): number {
  if (a.slot !== null && b.slot !== null) return a.slot - b.slot;
  if (a.slot !== null) return -1;
  if (b.slot !== null) return 1;
  return a.y - b.y || a.x - b.x;
}

// - the first connection of a border takes that border's vim key
const SIDE_KEY: Record<Side, string> = { left: 'h', top: 'k', right: 'l', bottom: 'j' };
// - and the borders are walked in that order, so the labels of a given node never move
const LABEL_SIDES: Side[] = ['left', 'top', 'right', 'bottom'];
// - one sequence for every connection past the first of its border, shared by all four borders.
//   g is out (it re-arms the chord) and so are h j k l (already a border's first label).
const OVERFLOW = '123456789abcdefimnopqrstuvwxyz';

export interface ConnectionLabel { label: string; side: Side; nodeId: string; edgeId?: string; at?: Point }

/**
 * The key to press for every connection of `from`, in and out, on all four borders. The first
 * connection of a border is its own vim key — left `h`, top `k`, right `l`, bottom `j` — and every
 * further one takes the next symbol of OVERFLOW, walked left, top, right, bottom, in the drawn
 * (exit-slot) order inside each border. So two connections left and three right read `h 1` and
 * `l 2 3`. A border with no connection contributes nothing, and a node with more connections than
 * the sequence has symbols leaves the last ones unlabelled.
 */
export function connectionLabels(from: NavNode, ctx: EdgeSideContext): ConnectionLabel[] {
  const out: ConnectionLabel[] = [];
  let next = 0;
  for (const side of LABEL_SIDES) {
    edgesOnSide(from, side, ctx).forEach((c, i) => {
      const label = i === 0 ? SIDE_KEY[side] : OVERFLOW[next++];
      if (label === undefined) return;
      out.push({ label, side, nodeId: c.nodeId, edgeId: c.edgeId, at: c.at });
    });
  }
  return out;
}
