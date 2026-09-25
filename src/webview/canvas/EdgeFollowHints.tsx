import React from 'react';
import { useStore } from '@xyflow/react';
import { placeBadges, type EdgeHint } from './hintPlacement';

export type { EdgeHint } from './hintPlacement';

const FONT = 'system-ui, -apple-system, sans-serif';

/**
 * The labels shown while the `g` chord is armed, one per connection of the focused node, on all four
 * borders. Same layer as the section separators: a pointer-transparent overlay over the pane, with
 * the flow coordinates projected through React Flow's own transform. A badge the fan moved off its
 * own exit point keeps a line back to it.
 */
export function EdgeFollowHints({ hints }: { hints: EdgeHint[] }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (hints.length === 0) return null;
  const placed = placeBadges(hints, tx, ty, zoom);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {placed.filter(p => p.lead).map(p => (
          <line key={p.hint.key} x1={p.ex} y1={p.ey} x2={p.cx} y2={p.cy}
            stroke="var(--sk-accent)" strokeWidth={1} opacity={0.55} />
        ))}
      </svg>
      {placed.map(p => (
        <div
          key={p.hint.key}
          style={{
            position: 'absolute', left: p.cx, top: p.cy, transform: 'translate(-50%, -50%)',
            minWidth: 14, height: 14, padding: '0 3px', borderRadius: 3, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', color: 'var(--sk-accent)',
            fontFamily: FONT, fontWeight: 700, fontSize: 10.5, lineHeight: 1, userSelect: 'none',
          }}
        >
          {p.hint.label}
        </div>
      ))}
    </div>
  );
}
