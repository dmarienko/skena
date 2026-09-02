/**
 * Rail geometry, all in screen px. Pure: no React, no DOM — unit-tested like the shared modules.
 */

export const RAIL_W      = 44;
export const PLUS_H      = 28;   // - strip at the rail bottom reserved for the + button
export const SEG_GAP     = 6;     // - space between adjacent segments
export const SEG_MIN_H   = 28;    // - a segment never shrinks below this: room for S#
export const SEG_PAD_TOP = 8;
export const ITEM_GAP    = 7;
export const ITEM_H      = 14;    // - chevron / run icon / ✕ box
export const LABEL_H     = 12;    // - S# drawn horizontally
export const DOT_H       = 9;     // - kernel dot
export const TITLE_PX_PER_CHAR = 6.5;   // - 10.5px system font, rotated; average advance
export const TITLE_MIN_PX = 40;   // - below this the horizontal S# stays instead of a truncated title

export interface RailSegment {
  id: string;
  top: number;
  height: number;
  /** - the lane continues above the viewport (contents sit at the viewport top) */
  clippedTop: boolean;
}

/**
 * Project every lane that intersects the viewport to a screen segment. Lanes must be contiguous
 * and sorted — each lane's `bottom` is the next lane's `top`, as `deriveLanes` produces. Segments
 * never overlap; the 28px floor is honoured where the neighbours' projected ranges allow it.
 */
export function railSegments(
  lanes: { id: string; top: number; bottom: number }[],
  ty: number, zoom: number, viewportH: number,
): RailSegment[] {
  const out: RailSegment[] = [];
  if (viewportH <= 0) return out;
  const raw = lanes
    .map(l => ({ id: l.id, rawTop: l.top * zoom + ty, rawBottom: l.bottom * zoom + ty }))
    .filter(r => r.rawBottom > 0 && r.rawTop < viewportH);
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    // - the floor grows a segment only into free space: never into a neighbour's range
    const ceiling = i > 0 ? Math.max(0, raw[i - 1].rawBottom + SEG_GAP / 2) : 0;
    const floorLimit = i < raw.length - 1 ? Math.min(viewportH, raw[i + 1].rawTop - SEG_GAP / 2) : viewportH;
    let top = Math.max(r.rawTop, 0) + SEG_GAP / 2;
    let bottom = Math.min(r.rawBottom, viewportH) - SEG_GAP / 2;
    if (bottom - top < SEG_MIN_H) {
      const mid = (top + bottom) / 2;
      top = Math.max(mid - SEG_MIN_H / 2, ceiling);
      bottom = Math.min(top + SEG_MIN_H, floorLimit);
      top = Math.max(bottom - SEG_MIN_H, ceiling);
    }
    if (bottom - top < 1) continue;
    const t = Math.round(top);
    out.push({ id: r.id, top: t, height: Math.round(bottom) - t, clippedTop: r.rawTop < 0 });
  }
  return out;
}

export type RailItem = 'label' | 'fold' | 'title' | 'run' | 'kernel' | 'delete';

export interface RailLayout {
  items: RailItem[];
  /** - px available to the rotated title (0 when no title is shown); the renderer truncates to it */
  titleMaxPx: number;
}

/**
 * Which controls fit in a segment of `height` px, in display order. The fixed controls are taken in
 * priority order (S#, fold, run, kernel, delete) while they fit; the title is elastic: it replaces the
 * S# label and takes whatever is left, truncated, when that is at least TITLE_MIN_PX.
 */
export function railItems(height: number, titleChars: number): RailLayout {
  const titleH = titleChars > 0 ? Math.ceil(titleChars * TITLE_PX_PER_CHAR) : 0;
  const fixed: [RailItem, number][] = [
    ['label', LABEL_H], ['fold', ITEM_H], ['run', ITEM_H], ['kernel', DOT_H], ['delete', ITEM_H],
  ];
  let budget = height - SEG_PAD_TOP;
  const got = new Set<RailItem>();
  for (const [item, h] of fixed) {
    if (budget < h) break;
    got.add(item);
    budget -= h + ITEM_GAP;
  }
  let titleMaxPx = 0;
  if (titleH > 0 && got.has('label')) {
    const avail = budget + LABEL_H;   // - the label's own height comes back; its gap becomes the title's
    if (avail >= TITLE_MIN_PX) {
      got.delete('label');
      got.add('title');
      titleMaxPx = Math.min(titleH, avail);
    }
  }
  const order: RailItem[] = ['fold', 'title', 'label', 'run', 'kernel', 'delete'];   // - title and label are exclusive
  return { items: order.filter(i => got.has(i)), titleMaxPx };
}
