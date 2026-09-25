import React from 'react';
import { useStore } from '@xyflow/react';
import type { CardContent } from './cardContent';
import { placeBadges, placeCards, type EdgeHint } from './hintPlacement';
import { PreviewCard } from './PreviewCard';
import type { Rect } from './spatialNav';

export type { EdgeHint } from './hintPlacement';

/**
 * What `g` puts on screen: one badge per connection of the focused node, the card of the node each
 * badge leads to (keyed by the badge's key), and the part of the pane the cards stay inside.
 */
export interface ShownHints { hints: EdgeHint[]; cards: ReadonlyMap<string, CardContent>; area: Rect }

const FONT = 'system-ui, -apple-system, sans-serif';

/**
 * The badges shown while the `g` chord is armed, one per connection of the focused node, on all four
 * borders, each with the card of the node its connection leads to. Same layer as the section
 * separators: a pointer-transparent overlay over the pane, with the flow coordinates projected
 * through React Flow's own transform. A badge the fan moved off its own exit point, or a card moved
 * off its badge, keeps a line back to it. The badges are drawn over the cards.
 */
export function EdgeFollowHints({ shown }: { shown: ShownHints | null }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (shown === null || shown.hints.length === 0) return null;
  const badges = placeBadges(shown.hints, tx, ty, zoom);
  const cards = placeCards(badges.filter(b => shown.cards.has(b.hint.key)), shown.area);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {badges.filter(b => b.lead).map(b => (
          <line key={`b:${b.hint.key}`} x1={b.ex} y1={b.ey} x2={b.cx} y2={b.cy}
            stroke="var(--sk-accent)" strokeWidth={1} opacity={0.55} />
        ))}
        {cards.filter(c => c.lead).map(c => (
          <line key={`c:${c.key}`} x1={c.bx} y1={c.by} x2={c.lx} y2={c.ly}
            stroke="var(--sk-accent)" strokeWidth={1} opacity={0.55} />
        ))}
      </svg>
      {cards.map(c => {
        const card = shown.cards.get(c.key);
        return card && (
          <div key={c.key} style={{ position: 'absolute', left: c.left, top: c.top }}>
            <PreviewCard card={card} />
          </div>
        );
      })}
      {badges.map(b => (
        <div
          key={b.hint.key}
          style={{
            position: 'absolute', left: b.cx, top: b.cy, transform: 'translate(-50%, -50%)',
            minWidth: 14, height: 14, padding: '0 3px', borderRadius: 3, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sk-bg2)', border: '1px solid var(--sk-accent)', color: 'var(--sk-accent)',
            fontFamily: FONT, fontWeight: 700, fontSize: 10.5, lineHeight: 1, userSelect: 'none',
          }}
        >
          {b.hint.label}
        </div>
      ))}
    </div>
  );
}
