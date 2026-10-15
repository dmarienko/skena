/**
 * Where a folded section's band and the sections below it are DRAWN, as opposed to where they are
 * stored. A folded band is drawn at least BAND_MIN_PX tall on screen at any zoom: below the zoom at
 * which its stored height reaches that, the band is drawn taller by `extra` flow units, added above its
 * stored range, and everything below it is drawn lower by the same amount. Stored positions never
 * change; only what React Flow, the rail and the overlays are given does.
 *
 * The extra is a whole number of grids, so it changes only at a few zooms (`bandStep`), and every node
 * below a band stays on the background's dot grid. Pure.
 */

import { SECTION_FOLDED_H } from '../../shared/constants';

// - the rail draws a segment SEG_GAP (6 px) shorter than its band; 28 px is what a folded segment needs
//   for its chevron and S#
export const BAND_MIN_PX = 34;
// - the zoom at which a one-grid band is BAND_MIN_PX tall; at and above it nothing is drawn elsewhere
export const BAND_FULL_ZOOM = BAND_MIN_PX / SECTION_FOLDED_H;

/** 0 at and above BAND_FULL_ZOOM, else how many grids a one-grid band must be drawn taller by. */
export function bandStep(zoom: number): number {
  if (zoom >= BAND_FULL_ZOOM) return 0;
  // - the epsilon keeps a zoom that lands exactly on a boundary in the lower step
  return Math.max(1, Math.ceil(BAND_MIN_PX / (zoom * SECTION_FOLDED_H) - 1 - 1e-9));
}

export interface LaneDisplay {
  /** - flow units this lane's members are drawn below their stored y: the extras of every folded lane
   *    above it, and its own */
  shift: number;
  /** - flow units a folded lane's band is drawn taller than its stored range, above that range; 0 for an
   *    open lane */
  extra: number;
}

/** Shift and extra of every lane, in stack order, for a step. Lanes sorted, as deriveLanes returns them. */
export function laneDisplay(lanes: { top: number; bottom: number; folded?: string[] }[], step: number): LaneDisplay[] {
  // - the flow height that is BAND_MIN_PX on screen at the lowest zoom of the step
  const minFlow = step === 0 ? 0 : (step + 1) * SECTION_FOLDED_H;
  let acc = 0;
  return lanes.map(l => {
    const short = l.folded ? minFlow - (l.bottom - l.top) : 0;
    const extra = short > 0 ? Math.ceil(short / SECTION_FOLDED_H - 1e-9) * SECTION_FOLDED_H : 0;
    acc += extra;
    return { shift: acc, extra };
  });
}

/** The lanes with `top` and `bottom` where they are drawn. Same object for a lane drawn where it is stored. */
export function drawnLanes<L extends { top: number; bottom: number }>(lanes: L[], disp: LaneDisplay[]): L[] {
  return lanes.map((l, i) => {
    const d = disp[i];
    return !d || d.shift === 0 ? l : { ...l, top: l.top + d.shift - d.extra, bottom: l.bottom + d.shift };
  });
}

/** The drawn y of stored y: moved by the lane whose stored range holds it. */
export function toDisplayY(lanes: { top: number }[], disp: LaneDisplay[], y: number): number {
  let idx = -1;
  for (let i = 0; i < lanes.length; i++) if (lanes[i].top <= y) idx = i;
  // - above the first lane: the first lane owns it (laneIndexForY clamps the same way)
  return y + (disp[Math.max(0, idx)]?.shift ?? 0);
}

/**
 * The stored y drawn at drawn y. A point in the part a band is drawn taller by maps to the top of that
 * band, so a node dropped there joins that section, as one dropped on the band itself does.
 */
export function toStoredY(lanes: { top: number }[], disp: LaneDisplay[], y: number): number {
  if (lanes.length === 0) return y;
  let idx = 0;
  for (let i = 0; i < lanes.length; i++) if (lanes[i].top + disp[i].shift - disp[i].extra <= y) idx = i;
  const d = disp[idx];
  const s = y - d.shift;
  return s < lanes[idx].top && y >= lanes[idx].top + d.shift - d.extra ? lanes[idx].top : s;
}
