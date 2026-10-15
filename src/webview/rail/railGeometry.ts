/**
 * Rail geometry, all in screen px. Pure: no React, no DOM — unit-tested like the shared modules.
 */

export const RAIL_W      = 44;
export const PLUS_H      = 28;   // - strip at the rail bottom reserved for the + button
export const SEG_GAP     = 6;     // - space between adjacent segments
export const SEG_MIN_H   = 28;    // - a segment never shrinks below this: room for S#
export const SEG_PAD_TOP = 8;
export const ITEM_GAP    = 7;
export const ICON_PX     = 14;    // - svg size of the play icon
export const BTN_H       = 20;    // - box of the fold / run / delete buttons (what the column actually stacks)
export const DOT_BTN_H   = 14;    // - box of the kernel-dot button
export const DOT_PX      = 9;     // - kernel dot
export const LABEL_H     = 12;    // - S# drawn horizontally
export const COMPACT_FOLD_H = 16;  // - the chevron's box in a packed folded segment: the 16 px icon, no margin
export const TITLE_PX_PER_CHAR = 6.5;   // - 10.5px system font, rotated; average advance
export const TITLE_MIN_PX = 40;   // - below this the horizontal S# stays instead of a truncated title

export interface RailSegment {
  id: string;
  top: number;
  height: number;
}

/**
 * Project every lane that intersects the viewport to a screen segment. Lanes must be contiguous
 * and sorted — each lane's `bottom` is the next lane's `top`, as `deriveLanes` produces. Segments
 * never overlap; the 28px floor is honoured where the neighbours' projected ranges allow it. A lane
 * running off the top is cut at 0, so its controls sit at the viewport top.
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
    out.push({ id: r.id, top: t, height: Math.round(bottom) - t });
  }
  return out;
}

/** - the kernel controls of an open section, after ▶: stop the section run, interrupt, restart, shut down, select */
export type KernelButton = 'stop' | 'interrupt' | 'restart' | 'shutdown' | 'select';

export type RailItem = 'label' | 'fold' | 'title' | 'run' | KernelButton | 'kernel' | 'delete';

/**
 * Which kernel buttons an open section offers, in display order. ■ only while this section's run is
 * in progress (a section with no kernel of its own still runs the cells that have a kernel edge);
 * ❚❚ ↻ ⏻ only while the bound kernel is alive; ⇄ always. A folded section shows none of them.
 */
export function kernelButtons(s: { folded: boolean; bound: boolean; live: boolean; running: boolean }): KernelButton[] {
  if (s.folded) return [];
  const out: KernelButton[] = [];
  if (s.running) out.push('stop');
  if (s.bound && s.live) out.push('interrupt', 'restart', 'shutdown');
  out.push('select');
  return out;
}

export interface RailLayout {
  items: RailItem[];
  /** - px available to the rotated title (0 when no title is shown); the renderer truncates to it */
  titleMaxPx: number;
  /** - a folded segment too short for the usual column: the chevron (COMPACT_FOLD_H) and S# packed with no
   *    top padding and no gap, centred */
  compact?: true;
}

/**
 * Which controls fit in a segment of `height` px, in display order. The fixed controls are taken in
 * priority order (S#, fold, run, kernel dot, delete) while they fit; the title is elastic: it replaces
 * the S# label and takes whatever is left, truncated, when that is at least TITLE_MIN_PX. The kernel
 * buttons (■ ❚❚ ↻ ⏻ ⇄) only take the room the whole title leaves, in that order, so a shorter segment
 * loses them from the end first, before the title is cut; all of them are in the segment's menu.
 *
 * A folded section takes the chevron first: without it there is no way to unfold from the rail. Its
 * band is drawn at least 34 px tall (displayOffset.ts), so its segment is at least 28 px; below the
 * 47 px the usual column needs for the chevron and S#, the two are packed (`compact`). It never shows
 * the kernel buttons.
 *
 * The heights are the RENDERED boxes (BTN_H, DOT_BTN_H, LABEL_H), not the icons inside them — budget
 * an icon size here and the last control ends up clipped by the column's overflow instead of dropped.
 */
export function railItems(height: number, titleChars: number, folded = false, kernel: KernelButton[] = []): RailLayout {
  // - a band cut by the pane's edge can give a shorter segment: the chevron alone, from 16 px
  if (folded && height >= COMPACT_FOLD_H && height < SEG_PAD_TOP + BTN_H + ITEM_GAP + LABEL_H) {
    return { items: height >= COMPACT_FOLD_H + LABEL_H ? ['fold', 'label'] : ['fold'], titleMaxPx: 0, compact: true };
  }
  const titleH = titleChars > 0 ? Math.ceil(titleChars * TITLE_PX_PER_CHAR) : 0;
  const fixed: [RailItem, number][] = folded
    ? [['fold', BTN_H], ['label', LABEL_H], ['run', BTN_H], ['kernel', DOT_BTN_H], ['delete', BTN_H]]
    : [['label', LABEL_H], ['fold', BTN_H], ['run', BTN_H], ['kernel', DOT_BTN_H], ['delete', BTN_H]];
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
      budget = avail - titleMaxPx;
    }
  }
  // - only beside a whole title: a cut title (or S# in its place) means the buttons already went
  if (!folded && (titleH === 0 || titleMaxPx === titleH)) {
    for (const k of kernel) {
      if (budget < BTN_H) break;
      got.add(k);
      budget -= BTN_H + ITEM_GAP;
    }
  }
  // - title and label are exclusive
  const order: RailItem[] = ['fold', 'title', 'label', 'run', 'stop', 'interrupt', 'restart', 'shutdown', 'select', 'kernel', 'delete'];
  return { items: order.filter(i => got.has(i)), titleMaxPx };
}
