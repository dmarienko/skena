/**
 * Moving between sections, pure: the section Ctrl+D / Ctrl+U land on, the node a section is entered
 * on, whether the view shows anything at all, and where the focus goes when a fold hides it. Lanes
 * are `deriveLanes` output (sorted, contiguous); `hidden` holds the ids the folds hide.
 */

import type { DerivedLane } from './sectionLanes';

export interface NavBox { id: string; x: number; y: number; w: number; h: number }
export type NavLane = Pick<DerivedLane, 'id' | 'top' | 'bottom' | 'folded' | 'memberIds'>;
export interface FlowRect { left: number; top: number; right: number; bottom: number }

/** A focus target: a node, or the band of a folded section. */
export type SectionTarget = { kind: 'node'; laneId: string; nodeId: string } | { kind: 'band'; laneId: string };

// - wider than any canvas: a band runs the full width of the pane at every pan
const BAND_W = 1e9;

/** Index of the section whose range holds flow `y`; above the first → 0, past the last → the last; -1 without sections. */
export function sectionIndexAtY(lanes: NavLane[], y: number): number {
  if (lanes.length === 0) return -1;
  for (let i = 0; i < lanes.length; i++) if (y < lanes[i].bottom) return i;
  return lanes.length - 1;
}

/** The node a section is entered on: its first visible member by y, then x — the node `gg` goes to. */
export function firstVisibleMember(lane: NavLane, nodes: NavBox[], hidden: ReadonlySet<string>): string | null {
  const members = new Set(lane.memberIds);
  let best: NavBox | null = null;
  for (const n of nodes) {
    if (!members.has(n.id) || hidden.has(n.id)) continue;
    if (!best || n.y < best.y || (n.y === best.y && n.x < best.x)) best = n;
  }
  return best?.id ?? null;
}

// - what entering section i gives: a folded one its band, an open one its first node, an open one
//   with nothing visible nothing at all
function entryOf(lanes: NavLane[], i: number, nodes: NavBox[], hidden: ReadonlySet<string>): SectionTarget | null {
  const lane = lanes[i];
  if (lane.folded) return { kind: 'band', laneId: lane.id };
  const nodeId = firstVisibleMember(lane, nodes, hidden);
  return nodeId === null ? null : { kind: 'node', laneId: lane.id, nodeId };
}

/**
 * Ctrl+D (`down`) / Ctrl+U (`up`) from section `from`: the next section in that direction. A folded
 * one stops on its band; an open one gives its first node; an open one with no visible node is passed
 * over. Null when nothing qualifies before the end of the stack (no wrap).
 */
export function stepSection(lanes: NavLane[], from: number, dir: 'up' | 'down', nodes: NavBox[], hidden: ReadonlySet<string>): SectionTarget | null {
  const step = dir === 'down' ? 1 : -1;
  for (let i = from + step; i >= 0 && i < lanes.length; i += step) {
    const t = entryOf(lanes, i, nodes, hidden);
    if (t) return t;
  }
  return null;
}

/**
 * True when nothing is drawn inside `view` (flow coordinates): no visible node overlaps it and no
 * folded section's band does. A band spans the pane's full width, so only its y range counts.
 */
export function viewIsEmpty(view: FlowRect, lanes: NavLane[], nodes: NavBox[], hidden: ReadonlySet<string>): boolean {
  for (const n of nodes) {
    if (hidden.has(n.id)) continue;
    if (n.x < view.right && n.x + n.w > view.left && n.y < view.bottom && n.y + n.h > view.top) return false;
  }
  return !lanes.some(l => l.folded && l.top < view.bottom && l.bottom > view.top);
}

/**
 * Where the focus goes once the fold of `foldedId` has hidden it: the first node of the nearest open
 * section below that has a visible node, else of the nearest one above, else the folded section's
 * own band.
 */
export function focusAfterFold(lanes: NavLane[], foldedId: string, nodes: NavBox[], hidden: ReadonlySet<string>): SectionTarget {
  const at = lanes.findIndex(l => l.id === foldedId);
  const open = (i: number): SectionTarget | null => (lanes[i].folded ? null : entryOf(lanes, i, nodes, hidden));
  for (let i = at + 1; at >= 0 && i < lanes.length; i++) { const t = open(i); if (t) return t; }
  for (let i = at - 1; i >= 0; i--) { const t = open(i); if (t) return t; }
  return { kind: 'band', laneId: foldedId };
}

/** A folded section's band as the box h/j/k/l start from: its y range across the whole canvas width. */
export function bandNavBox(lane: NavLane): NavBox {
  return { id: `band:${lane.id}`, x: 0, y: lane.top, w: BAND_W, h: lane.bottom - lane.top };
}

/** The visible node whose centre is closest to `p`; null when none is visible. */
export function nearestVisibleNode(nodes: NavBox[], hidden: ReadonlySet<string>, p: { x: number; y: number }): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (hidden.has(n.id)) continue;
    const d = Math.hypot(n.x + n.w / 2 - p.x, n.y + n.h / 2 - p.y);
    if (d < bestDist) { bestDist = d; best = n.id; }
  }
  return best;
}

/** The folded section whose band's middle is closest to flow `y`; null when none is folded. */
export function nearestBand(lanes: NavLane[], y: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const l of lanes) {
    if (!l.folded) continue;
    const d = Math.abs((l.top + l.bottom) / 2 - y);
    if (d < bestDist) { bestDist = d; best = l.id; }
  }
  return best;
}
