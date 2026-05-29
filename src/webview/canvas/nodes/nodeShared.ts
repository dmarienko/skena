/**
 * nodeShared — style constants shared by all canvas node components.
 */

import type React from 'react';

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
 * Returns additional inline styles for the node wrapper when the node is
 * selected (keyboard focus or click).  Box-shadow is used instead of outline
 * so it:
 *   • is not clipped by overflow:hidden on the wrapper
 *   • coexists visually with the heatmap drop-shadow filter
 *   • appears even when the canvas is zoomed out far
 */
export function selectedOverlayStyle(selected: boolean): React.CSSProperties {
  if (!selected) return {};
  return {
    borderColor: '#00e5ff',
    boxShadow:
      '0 0 0 2px rgba(0,229,255,0.22), ' +
      '0 0 10px 4px rgba(0,229,255,0.38), ' +
      '0 0 28px 8px rgba(0,229,255,0.14)',
  };
}
