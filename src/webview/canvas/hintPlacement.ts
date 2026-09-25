import type { Side } from '../../shared/edgeRouting';
import type { Rect } from './spatialNav';

/** One badge: the key to press after `g`, at the point its connection meets the border. */
export interface EdgeHint { key: string; label: string; x: number; y: number; side: Side }

// - px the badge centre sits outside the border, so it does not cover the exit point it names
const OUT = 8;
// - the badge is a 14 px box and does not scale, while the exit points are 10 flow px apart and do;
//   below zoom 1 they never fit, so the fan keeps at least this much between two badge centres
const MIN_GAP = 16;
// - under this the badge still covers its own exit point, so a line to it would only add clutter
const LEAD_MIN = 4;
// - half the 14 px badge box
export const BADGE_HALF = 7;

export const CARD_W = 228;
export const CARD_HEADER_H = 20;
export const CARD_BODY_H = 58;
export const CARD_BORDER = 1.5;
export const CARD_H = CARD_HEADER_H + CARD_BODY_H + 2 * CARD_BORDER;
// - between a badge and its card, and between two cards of one border
export const CARD_GAP = 6;
// - the closest a card comes to the edge of the pane
export const PANE_MARGIN = 8;

/** A badge on screen, in pane pixels: its centre, the exit point it names, and whether a line joins them. */
export interface PlacedBadge { hint: EdgeHint; cx: number; cy: number; ex: number; ey: number; lead: boolean }

/**
 * A card on screen, in pane pixels: its top-left corner, and the line from its badge's centre
 * (bx, by) to the nearest point of the card (lx, ly), drawn when `lead` is set.
 */
export interface PlacedCard { key: string; left: number; top: number; lead: boolean; bx: number; by: number; lx: number; ly: number }

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

function groupBySide<T>(items: T[], sideOf: (t: T) => Side): Map<Side, T[]> {
  const m = new Map<Side, T[]>();
  for (const t of items) {
    const list = m.get(sideOf(t));
    if (list) list.push(t); else m.set(sideOf(t), [t]);
  }
  return m;
}

// - positions along one border in their given order, each at least `step` after the one before,
//   then all moved by one amount so their mean is the mean of the input
function fan(axis: number[], step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < axis.length; i++) out.push(i === 0 ? axis[i] : Math.max(axis[i], out[i - 1] + step));
  const shift = mean(axis) - mean(out);
  return out.map(a => a + shift);
}

/**
 * Where each badge is drawn, in pane pixels. The badges of one border keep their slot order and are
 * pushed apart only where their exit points are closer together than one badge; the run is then slid
 * back so it stays centred on the points it names. Fanning happens on screen, not in flow
 * coordinates, because the badge is a fixed pixel size and the exit points are not.
 */
export function placeBadges(hints: EdgeHint[], tx: number, ty: number, zoom: number): PlacedBadge[] {
  const out: PlacedBadge[] = [];
  for (const [side, list] of groupBySide(hints, h => h.side)) {
    // - `along` is the coordinate that runs along the border, the one the fan opens on
    const along = side === 'left' || side === 'right' ? 'y' : 'x';
    const pts = list.map(h => ({ x: h.x * zoom + tx, y: h.y * zoom + ty }));
    const axis = pts.map(p => p[along]);
    const at = fan(axis, MIN_GAP);
    const outward = side === 'right' || side === 'bottom' ? OUT : -OUT;
    list.forEach((hint, i) => out.push({
      hint,
      cx: along === 'y' ? pts[i].x + outward : at[i],
      cy: along === 'y' ? at[i] : pts[i].y + outward,
      ex: pts[i].x, ey: pts[i].y,
      lead: Math.abs(at[i] - axis[i]) > LEAD_MIN,
    }));
  }
  return out;
}

/**
 * Where each card is drawn, in pane pixels: just outside its badge, on the side away from the
 * focused node. The cards of one border keep the badges' order, are pushed apart until they do not
 * overlap and are slid back to stay centred on their badges: the badges' fan with the card's size.
 * The run is then moved inside `area`, and each card pushed in across the border; where a run is
 * longer than the area its start stays in. A card whose badge is no longer beside it is marked for a
 * line back to the badge.
 */
export function placeCards(badges: PlacedBadge[], area: Rect): PlacedCard[] {
  const out: PlacedCard[] = [];
  const off = BADGE_HALF + CARD_GAP;
  for (const [side, list] of groupBySide(badges, b => b.hint.side)) {
    const vertical = side === 'left' || side === 'right';
    const size = vertical ? CARD_H : CARD_W;
    const lo = (vertical ? area.top : area.left) + PANE_MARGIN;
    const hi = (vertical ? area.bottom : area.right) - PANE_MARGIN;
    const at = fan(list.map(b => (vertical ? b.cy : b.cx)), size + CARD_GAP);
    let shift = 0;
    const end = at[at.length - 1] + size / 2;
    if (end > hi) shift = hi - end;
    const start = at[0] + shift - size / 2;
    if (start < lo) shift += lo - start;
    list.forEach((b, i) => {
      const a = at[i] + shift - size / 2;
      const left = vertical
        ? clamp(side === 'right' ? b.cx + off : b.cx - off - CARD_W, area.left + PANE_MARGIN, area.right - PANE_MARGIN - CARD_W)
        : a;
      const top = vertical
        ? a
        : clamp(side === 'bottom' ? b.cy + off : b.cy - off - CARD_H, area.top + PANE_MARGIN, area.bottom - PANE_MARGIN - CARD_H);
      const lx = clamp(b.cx, left, left + CARD_W);
      const ly = clamp(b.cy, top, top + CARD_H);
      out.push({ key: b.hint.key, left, top, bx: b.cx, by: b.cy, lx, ly, lead: Math.hypot(b.cx - lx, b.cy - ly) > off + LEAD_MIN });
    });
  }
  return out;
}
