/**
 * Orthogonal edge router — produces axis-aligned (PCB-style) polyline paths
 * that avoid rectangular obstacle bounding boxes.
 *
 * Strategy (line-probe / candidate enumeration):
 *   1. Exit source handle and approach target handle by MIN_EXIT px.
 *   2. Try L-shapes (1 bend): horizontal-first, vertical-first.
 *   3. Try Z-shapes (2 bends): via path midpoint.
 *   4. Scan Y / X offsets derived from obstacle boundaries for a clear channel.
 *   5. Fallback: Z-shape outside the combined bounding box of all obstacles.
 *   6. Ultimate fallback: unconstrained Z at midpoint (always visible).
 *
 * All intermediate segments are checked against padded obstacle bounding boxes.
 * Exit and entry segments (source→ep, np→target) are always clear by construction.
 */

import { Position } from '@xyflow/react';

export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Pt = [number, number];

export const ORTHOGONAL_CORNER_R = 8;

const MIN_EXIT = 28;
const PAD      = 24;   // - clearance around obstacle bounding boxes (visual breathing room)
const MARGIN   = PAD + 20; // - margin for boundary candidates (channels pass well clear of nodes)

// ─── geometry primitives ─────────────────────────────────────────────────────

/** Exit point: `len` px from handle in the handle direction (default MIN_EXIT). */
function exitPt(x: number, y: number, pos: Position, len: number = MIN_EXIT): Pt {
  const dx = pos === Position.Right ? 1 : pos === Position.Left  ? -1 : 0;
  const dy = pos === Position.Bottom ? 1 : pos === Position.Top   ? -1 : 0;
  return [x + dx * len, y + dy * len];
}

/** True if the horizontal segment at y from xa to xb is clear of all padded rects. */
function clearH(xa: number, xb: number, y: number, rects: NodeRect[]): boolean {
  const x1 = Math.min(xa, xb);
  const x2 = Math.max(xa, xb);
  for (const r of rects) {
    if (
      y  > r.y - PAD      && y  < r.y + r.h + PAD &&
      x2 > r.x - PAD      && x1 < r.x + r.w + PAD
    ) return false;
  }
  return true;
}

/** True if the vertical segment at x from ya to yb is clear of all padded rects. */
function clearV(x: number, ya: number, yb: number, rects: NodeRect[]): boolean {
  const y1 = Math.min(ya, yb);
  const y2 = Math.max(ya, yb);
  for (const r of rects) {
    if (
      x  > r.x - PAD      && x  < r.x + r.w + PAD &&
      y2 > r.y - PAD      && y1 < r.y + r.h + PAD
    ) return false;
  }
  return true;
}

// ─── candidate path shapes ───────────────────────────────────────────────────

/** L-shape horizontal-first: ep → (np[0], ep[1]) → np */
function tryLH(ep: Pt, np: Pt, rects: NodeRect[]): Pt[] | null {
  return (
    clearH(ep[0], np[0], ep[1], rects) &&
    clearV(np[0], ep[1], np[1], rects)
  ) ? [ep, [np[0], ep[1]], np] : null;
}

/** L-shape vertical-first: ep → (ep[0], np[1]) → np */
function tryLV(ep: Pt, np: Pt, rects: NodeRect[]): Pt[] | null {
  return (
    clearV(ep[0], ep[1], np[1], rects) &&
    clearH(ep[0], np[0], np[1], rects)
  ) ? [ep, [ep[0], np[1]], np] : null;
}

/** Z-shape via vertical column at x = cx: ep → (cx, ep[1]) → (cx, np[1]) → np */
function tryZV(ep: Pt, np: Pt, cx: number, rects: NodeRect[]): Pt[] | null {
  return (
    clearH(ep[0], cx,    ep[1], rects) &&
    clearV(cx,    ep[1], np[1], rects) &&
    clearH(cx,    np[0], np[1], rects)
  ) ? [ep, [cx, ep[1]], [cx, np[1]], np] : null;
}

/** Z-shape via horizontal row at y = cy: ep → (ep[0], cy) → (np[0], cy) → np */
function tryZH(ep: Pt, np: Pt, cy: number, rects: NodeRect[]): Pt[] | null {
  return (
    clearV(ep[0], ep[1], cy, rects) &&
    clearH(ep[0], np[0], cy, rects) &&
    clearV(np[0], cy,    np[1], rects)
  ) ? [ep, [ep[0], cy], [np[0], cy], np] : null;
}

// ─── main router ─────────────────────────────────────────────────────────────

/**
 * Route an orthogonal path from (sx,sy,sPos) to (tx,ty,tPos) avoiding rects.
 * Returns an array of waypoints: [[sx,sy], ..., [tx,ty]].
 * Use waypointPath(pts, ORTHOGONAL_CORNER_R) in LabeledEdge to render.
 */
export function routeOrthogonal(
  sx: number, sy: number, sPos: Position,
  tx: number, ty: number, tPos: Position,
  rects: NodeRect[],
): Pt[] {
  const dist    = Math.hypot(tx - sx, ty - sy);
  // - exitLen is capped at 60 px (not at dist*fraction) so every edge from the
  // - same source exits the same distance → fan-out edges share one branch column.
  // - For very close nodes (< 133 px) we scale down to avoid overshooting np.
  const exitLen = Math.min(60, dist * 0.45);
  const ep = exitPt(sx, sy, sPos, exitLen);
  const np = exitPt(tx, ty, tPos);

  const mx = (ep[0] + np[0]) / 2;
  const my = (ep[1] + np[1]) / 2;

  // ── 1. Z at midpoint (always first: gives shared branch col for fan-outs) ──
  let mid: Pt[] | null = tryZV(ep, np, mx, rects) ?? tryZH(ep, np, my, rects);
  if (mid) return [[sx, sy], ...mid, [tx, ty]];

  // ── 2. L-shapes (fallback when midpoint channel is blocked) ─────────────────
  mid = tryLH(ep, np, rects) ?? tryLV(ep, np, rects);
  if (mid) return [[sx, sy], ...mid, [tx, ty]];

  // ── 3. Scan obstacle boundaries for a clear channel ───────────────────────
  // - collect candidate X/Y values from every obstacle boundary + midpoints
  const yCands = new Set<number>([ep[1], np[1], my]);
  const xCands = new Set<number>([ep[0], np[0], mx]);

  for (const r of rects) {
    yCands.add(r.y            - MARGIN);
    yCands.add(r.y + r.h      + MARGIN);
    xCands.add(r.x            - MARGIN);
    xCands.add(r.x + r.w      + MARGIN);
  }

  for (const cy of yCands) {
    mid = tryZH(ep, np, cy, rects);
    if (mid) return [[sx, sy], ...mid, [tx, ty]];
  }
  for (const cx of xCands) {
    mid = tryZV(ep, np, cx, rects);
    if (mid) return [[sx, sy], ...mid, [tx, ty]];
  }

  // ── 4. Route outside the combined bounding box of all content ────────────
  let bx1 = Math.min(ep[0], np[0]);
  let bx2 = Math.max(ep[0], np[0]);
  let by1 = Math.min(ep[1], np[1]);
  let by2 = Math.max(ep[1], np[1]);
  for (const r of rects) {
    bx1 = Math.min(bx1, r.x - MARGIN);
    bx2 = Math.max(bx2, r.x + r.w + MARGIN);
    by1 = Math.min(by1, r.y - MARGIN);
    by2 = Math.max(by2, r.y + r.h + MARGIN);
  }

  for (const cx of [bx2 + MARGIN, bx1 - MARGIN]) {
    mid = tryZV(ep, np, cx, rects);
    if (mid) return [[sx, sy], ...mid, [tx, ty]];
  }
  for (const cy of [by2 + MARGIN, by1 - MARGIN]) {
    mid = tryZH(ep, np, cy, rects);
    if (mid) return [[sx, sy], ...mid, [tx, ty]];
  }

  // ── 5. Ultimate fallback: Z at midpoint, no obstacle check ───────────────
  return [[sx, sy], ep, [mx, ep[1]], [mx, np[1]], np, [tx, ty]];
}
