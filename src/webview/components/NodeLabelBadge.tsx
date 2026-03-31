/**
 * NodeLabelBadge — reference label in the top-right corner of every canvas node.
 *
 * Sized to match NodeHeader height (34 px square) so it aligns flush with the
 * header bar on FileNodes and looks like a natural corner tab on all others.
 *
 * Border-radius matches the node's own 6 px top-right corner; the inner
 * (bottom-left) corner is rounded to soften the cut into the content area.
 *
 * Rendered as a plain absolutely-positioned element (sibling of .skena-node
 * inside the React Flow node wrapper) — not clipped by .skena-node overflow.
 *
 * Example labels: N3, M12, J5, L2, R1 …
 */

import React from 'react';

interface Props {
  label: string | undefined;
}

export function NodeLabelBadge({ label }: Props): JSX.Element | null {
  if (!label) return null;
  return (
    <span
      style={{
        position:        'absolute',
        top:             0,
        right:           0,
        zIndex:          10,
        width:           34,
        height:          34,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        fontFamily:      'monospace',
        fontSize:        14,
        fontWeight:      800,
        letterSpacing:   '0.03em',
        color:           'rgba(0,255,0,0.92)',
        background:      'rgba(0, 0, 0, 0.55)',
        // - top-right matches node border-radius; bottom-left softens the inner cut
        borderRadius:    '0 6px 0 8px',
        pointerEvents:   'none',
        userSelect:      'none',
      }}
    >
      {label}
    </span>
  );
}
