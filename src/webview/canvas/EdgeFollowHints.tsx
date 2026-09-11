import React from 'react';
import { useStore } from '@xyflow/react';
import type { Side } from '../../shared/edgeRouting';

/** One badge: the number to press after `g`, at the point its edge meets the border. */
export interface EdgeHint { key: string; n: number; x: number; y: number; side: Side }

const FONT = 'system-ui, -apple-system, sans-serif';
// - px the badge sits outside the border, so it does not cover the exit point it names
const OUT = 8;
// - the badge is a 14 px box and does not scale, while the exit points are 10 flow px apart and do;
//   past zoom 1 they never fit, so the fan keeps at least this much between two badge centres
const MIN_GAP = 16;
// - under this the badge still covers its own exit point, so a line to it would only add clutter
const LEAD_MIN = 4;

interface Placed { hint: EdgeHint; left: number; top: number; ex: number; ey: number; lead: boolean }

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/**
 * Where each badge is drawn, in pane pixels. The badges of one border keep their slot order and are
 * pushed apart only where their exit points are closer together than one badge; the run is then slid
 * back so it stays centred on the points it names. Fanning happens on screen, not in flow
 * coordinates, because the badge is a fixed pixel size and the exit points are not.
 */
function place(hints: EdgeHint[], tx: number, ty: number, zoom: number): Placed[] {
  const bySide = new Map<Side, EdgeHint[]>();
  for (const h of hints) {
    const list = bySide.get(h.side);
    if (list) list.push(h); else bySide.set(h.side, [h]);
  }
  const out: Placed[] = [];
  for (const [side, list] of bySide) {
    // - `along` is the coordinate that runs along the border, the one the fan opens on
    const along = side === 'left' || side === 'right' ? 'y' : 'x';
    const pts = list.map(h => ({ x: h.x * zoom + tx, y: h.y * zoom + ty }));
    const axis = pts.map(p => p[along]);
    const fan: number[] = [];
    for (let i = 0; i < axis.length; i++) fan.push(i === 0 ? axis[i] : Math.max(axis[i], fan[i - 1] + MIN_GAP));
    const shift = mean(axis) - mean(fan);
    const outward = side === 'right' || side === 'bottom' ? OUT : -OUT;
    for (let i = 0; i < list.length; i++) {
      const a = fan[i] + shift;
      out.push({
        hint: list[i],
        left: along === 'y' ? pts[i].x + outward : a,
        top:  along === 'y' ? a : pts[i].y + outward,
        ex: pts[i].x, ey: pts[i].y,
        lead: Math.abs(a - axis[i]) > LEAD_MIN,
      });
    }
  }
  return out;
}

/**
 * The numbers shown while the `g` chord is armed, one per edge on a border of the focused node that
 * carries more than one. Same layer as the section separators: a pointer-transparent overlay over
 * the pane, with the flow coordinates projected through React Flow's own transform. A badge the fan
 * moved off its own exit point keeps a line back to it.
 */
export function EdgeFollowHints({ hints }: { hints: EdgeHint[] }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (hints.length === 0) return null;
  const placed = place(hints, tx, ty, zoom);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {placed.filter(p => p.lead).map(p => (
          <line key={p.hint.key} x1={p.ex} y1={p.ey} x2={p.left} y2={p.top}
            stroke="var(--sk-accent)" strokeWidth={1} opacity={0.55} />
        ))}
      </svg>
      {placed.map(p => (
        <div
          key={p.hint.key}
          style={{
            position: 'absolute', left: p.left, top: p.top, transform: 'translate(-50%, -50%)',
            minWidth: 14, height: 14, padding: '0 3px', borderRadius: 3, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', color: 'var(--sk-accent)',
            fontFamily: FONT, fontWeight: 700, fontSize: 10.5, lineHeight: 1, userSelect: 'none',
          }}
        >
          {p.hint.n}
        </div>
      ))}
    </div>
  );
}
