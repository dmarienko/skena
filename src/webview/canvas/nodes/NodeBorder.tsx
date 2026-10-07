/**
 * NodeBorder — the visible border of a node below zoom 1, drawn over the node's box by a sibling
 * element.
 *
 * The node itself lays out with a border of baseBorderWidth and a padding of bandInsetPadding, so the
 * box its content lays out in is the same at every zoom. Below zoom 1, where the drawn border is
 * wider than that, the node's own border is transparent and this element, over the node's box and
 * after it in the DOM, draws the border at zoomInvariantWidth with the style, colour and corner radius
 * the node's own border has (canvas.css, data-skena-band). A zoom restyles and repaints it; nothing
 * inside the node is laid out again. pointer-events: none, so the node and its scrollbars take the
 * pointer as before.
 */

import React from 'react';
import { ZOOM_WIDTH_CLASS, useZoomVars, zoomInvariantWidth } from './nodeShared';

export function NodeBorder({ base, color, borderStyle = 'solid', radius = 6, running = false }: {
  base: number;
  color: string;
  borderStyle?: 'solid' | 'dashed';
  radius?: number | string;
  running?: boolean;
}): JSX.Element {
  const zoomVars = useZoomVars();
  return (
    <div
      className={`skena-node-border ${ZOOM_WIDTH_CLASS}${running ? ' skena-node-border--running' : ''}`}
      style={{ ...zoomVars, border: `${zoomInvariantWidth(base)} ${borderStyle} ${color}`, borderRadius: radius }}
    />
  );
}
