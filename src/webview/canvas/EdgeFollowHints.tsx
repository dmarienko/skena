import React from 'react';
import { useStore } from '@xyflow/react';
import type { Side } from '../../shared/edgeRouting';

/** One badge: the number to press after `g`, at the point its edge meets the border. */
export interface EdgeHint { key: string; n: number; x: number; y: number; side: Side }

const FONT = 'system-ui, -apple-system, sans-serif';
// - px the badge sits outside the border, so it does not cover the exit point it names
const OUT = 8;

/**
 * The numbers shown while the `g` chord is armed, one per edge on a border of the focused node that
 * carries more than one. Same layer as the section separators: a pointer-transparent overlay over
 * the pane, with the flow coordinates projected through React Flow's own transform.
 */
export function EdgeFollowHints({ hints }: { hints: EdgeHint[] }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (hints.length === 0) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {hints.map(h => (
        <div
          key={h.key}
          style={{
            position: 'absolute',
            left: h.x * zoom + tx + (h.side === 'right' ? OUT : h.side === 'left' ? -OUT : 0),
            top: h.y * zoom + ty + (h.side === 'bottom' ? OUT : h.side === 'top' ? -OUT : 0),
            transform: 'translate(-50%, -50%)',
            minWidth: 14, height: 14, padding: '0 3px', borderRadius: 3, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', color: 'var(--sk-accent)',
            fontFamily: FONT, fontWeight: 700, fontSize: 10.5, lineHeight: 1, userSelect: 'none',
          }}
        >
          {h.n}
        </div>
      ))}
    </div>
  );
}
