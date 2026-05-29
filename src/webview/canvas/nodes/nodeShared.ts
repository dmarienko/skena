/**
 * nodeShared — style constants shared by all canvas node components.
 */

import type React from 'react';
import { useStore } from '@xyflow/react';

// - sci-fi style for connection handles: larger squares with cyan border + glow.
// - Applied via the `style` prop on every <Handle> component.
export const HANDLE_STYLE: React.CSSProperties = {
  width:        12,
  height:       12,
  borderRadius: 2,
  background:   'rgba(0, 229, 255, 0.06)',
  border:       '1.5px solid rgba(0, 229, 255, 0.75)',
  boxShadow:    '0 0 6px 2px rgba(0, 229, 255, 0.25)',
};

/**
 * Hook — returns additional inline styles for the node wrapper when the node
 * is selected.  All pixel values are scaled by 1/zoom so the ring appears at
 * a constant SCREEN size regardless of how far the canvas is zoomed out.
 *
 * Target screen sizes (approximate):
 *   solid ring  = 10 screen px
 *   inner glow  = 25 screen px blur
 *   outer halo  = 60 screen px blur
 */
export function useSelectedStyle(selected: boolean): React.CSSProperties {
  // - s = inverse zoom: canvas px needed to equal 1 screen px
  // - capped so values don't explode when zoom < 0.1
  const s = useStore(st => 1 / Math.max(0.1, st.transform[2]));

  if (!selected) return {};

  const ring  = Math.round(10 * s);
  const glow  = Math.round(25 * s);
  const halo  = Math.round(60 * s);
  const gSpread = Math.round(10 * s);
  const hSpread = Math.round(24 * s);

  return {
    borderColor: '#00ffff',
    borderWidth:  '2.5px',
    boxShadow: [
      `0 0 0 ${ring}px rgba(0,255,255,0.55)`,
      `0 0 ${glow}px ${gSpread}px rgba(0,229,255,0.55)`,
      `0 0 ${halo}px ${hSpread}px rgba(0,229,255,0.22)`,
    ].join(', '),
  };
}
