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
 * is selected.
 *
 * Uses `outline` + `outlineOffset` (no blur, no glow) — a plain crisp border
 * drawn just outside the node edge.  Pixel values are scaled by 1/zoom so the
 * ring appears at a constant screen size regardless of canvas zoom level.
 *
 * Target screen sizes:
 *   line width  ≈ 2.5 screen px
 *   gap from node edge ≈ 4 screen px
 */
/**
 * Hook — node border width scaled by 1/zoom so the border keeps a roughly constant
 * SCREEN width as the canvas zooms. React Flow scales the whole viewport, so a fixed
 * canvas-px border shrinks to near-invisible when zoomed out (obvious with the heatmap
 * glow off). Floored at the base width (never thinner) and capped so it can't explode
 * at extreme zoom-out. Same 1/zoom approach as useSelectedStyle's focus ring.
 */
// - global multiplier for on-screen node border width; bump to make all borders wider
const BORDER_WIDTH_SCALE = 1.8;

export function useZoomInvariantBorderWidth(baseScreenPx: number): number {
  const zoom = useStore(st => st.transform[2]);
  const sc = Math.max(0.15, zoom);
  const base = baseScreenPx * BORDER_WIDTH_SCALE;
  return Math.min(base * 8, Math.max(base, base / sc));
}

export function useSelectedStyle(selected: boolean): React.CSSProperties {
  const zoom = useStore(st => st.transform[2]);
  if (!selected) return {};

  // - convert desired screen px → canvas px:  canvas = screen / zoom
  const sc     = Math.max(0.15, zoom);
  const lineW  = Math.min(30, Math.max(2,   3.75 / sc));
  const offset = Math.min(40, Math.max(3,   7    / sc));

  return {
    outline:       `${lineW.toFixed(1)}px solid rgba(0,220,255,0.8)`,
    outlineOffset: `${offset.toFixed(1)}px`,
  };
}
