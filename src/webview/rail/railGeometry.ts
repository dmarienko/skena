/**
 * Rail geometry, all in screen px. Pure: no React, no DOM — unit-tested like the shared modules.
 */

export const RAIL_W      = 44;
export const SEG_GAP     = 6;     // - space between adjacent segments
export const SEG_MIN_H   = 28;    // - a segment never shrinks below this: room for S#
export const SEG_PAD_TOP = 8;
export const ITEM_GAP    = 7;
export const ITEM_H      = 14;    // - chevron / run icon / ✕ box
export const LABEL_H     = 12;    // - S# drawn horizontally
export const DOT_H       = 9;     // - kernel dot
export const TITLE_PX_PER_CHAR = 6.5;   // - 10.5px system font, rotated; average advance

export interface RailSegment {
  id: string;
  top: number;
  height: number;
  /** - the lane continues above the viewport (contents sit at the viewport top) */
  clippedTop: boolean;
}

/** Project every lane that intersects the viewport to a screen segment. */
export function railSegments(
  lanes: { id: string; top: number; bottom: number }[],
  ty: number, zoom: number, viewportH: number,
): RailSegment[] {
  const out: RailSegment[] = [];
  if (viewportH <= 0) return out;
  for (const l of lanes) {
    const rawTop = l.top * zoom + ty;
    const rawBottom = l.bottom * zoom + ty;
    if (rawBottom < 0 || rawTop > viewportH) continue;
    let top = Math.max(rawTop, 0) + SEG_GAP / 2;
    let bottom = Math.min(rawBottom, viewportH) - SEG_GAP / 2;
    if (bottom - top < SEG_MIN_H) {
      const mid = (top + bottom) / 2;
      top = Math.max(mid - SEG_MIN_H / 2, 0);
      bottom = Math.min(top + SEG_MIN_H, viewportH);
      top = Math.max(bottom - SEG_MIN_H, 0);
    }
    out.push({ id: l.id, top, height: bottom - top, clippedTop: rawTop < 0 });
  }
  return out;
}

export type RailItem = 'label' | 'fold' | 'title' | 'run' | 'kernel' | 'delete';

/**
 * Which controls fit in a segment of `height` px, in display order. Strict priority: the first item
 * that does not fit stops the list. `label` (S#, horizontal) is replaced by `title` when that fits.
 */
export function railItems(height: number, titleChars: number): RailItem[] {
  const titleH = Math.ceil(titleChars * TITLE_PX_PER_CHAR);
  const steps: [RailItem, number][] = [
    ['label', LABEL_H], ['fold', ITEM_H], ['title', titleH], ['run', ITEM_H], ['kernel', DOT_H], ['delete', ITEM_H],
  ];
  let budget = height - SEG_PAD_TOP;
  const got = new Set<RailItem>();
  for (const [item, h] of steps) {
    if (budget < h) break;
    got.add(item);
    budget -= h + ITEM_GAP;
  }
  if (got.has('title')) got.delete('label');
  const order: RailItem[] = ['fold', 'title', 'label', 'run', 'kernel', 'delete'];
  return order.filter(i => got.has(i));
}
