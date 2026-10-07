/**
 * nodeShared — style constants shared by all canvas node components.
 */

import type React from 'react';
import { useEffect } from 'react';
import { useStoreApi } from '@xyflow/react';
import { HANDLE_RGB } from '../palette';

// - sci-fi style for connection handles: larger squares with cyan border + glow.
// - Applied via the `style` prop on every <Handle> component.
export const HANDLE_STYLE: React.CSSProperties = {
  width:        12,
  height:       12,
  borderRadius: 2,
  background:   `rgba(${HANDLE_RGB}, 0.06)`,
  border:       `1.5px solid rgba(${HANDLE_RGB}, 0.75)`,
  boxShadow:    `0 0 6px 2px rgba(${HANDLE_RGB}, 0.25)`,
};

// - global multiplier for on-screen node border width; bump to make all borders wider
const BORDER_WIDTH_SCALE = 1.8;

/**
 * The class of every element whose border, outline or stroke keeps a constant screen width as the
 * canvas zooms. Each one carries the zoom in its inline style as --skena-zoom, with the focus ring
 * sizes as --skena-ring-width and --skena-ring-offset: set from useZoomVars when it renders, and
 * rewritten by useZoomVar on every zoom change. canvas.css registers the three as not inherited, so a
 * zoom change restyles these elements and nothing inside them, and no component re-renders.
 */
export const ZOOM_WIDTH_CLASS = 'skena-zoom-width';

// - the focus ring in canvas px for a zoom: about 3.75 screen px wide, 7 screen px off the node edge
function focusRingAt(zoom: number): { width: string; offset: string } {
  const sc     = Math.max(0.15, zoom);
  const lineW  = Math.min(30, Math.max(2,   3.75 / sc));
  const offset = Math.min(40, Math.max(3,   7    / sc));
  return { width: `${lineW.toFixed(1)}px`, offset: `${offset.toFixed(1)}px` };
}

function zoomVarsAt(zoom: number): Record<string, string> {
  const ring = focusRingAt(zoom);
  return { '--skena-zoom': String(zoom), '--skena-ring-width': ring.width, '--skena-ring-offset': ring.offset };
}

/**
 * The inline custom properties of an element with ZOOM_WIDTH_CLASS, at the zoom of this render. The
 * zoom is read from the store, not subscribed to: useZoomVar keeps the element current afterwards.
 */
export function useZoomVars(): React.CSSProperties {
  return zoomVarsAt(useStoreApi().getState().transform[2]) as React.CSSProperties;
}

/**
 * Rewrites the custom properties of every ZOOM_WIDTH_CLASS element when the zoom changes, from a
 * store subscription, outside React. Inline on each element rather than in one shared stylesheet
 * rule: on a canvas of 46k elements a write to a rule cost about 25 ms of style work, the same write
 * inline on each element about 10 ms. Call once, inside the ReactFlowProvider.
 */
export function useZoomVar(): void {
  const store = useStoreApi();
  useEffect(() => {
    let last = store.getState().transform[2];
    return store.subscribe(st => {
      const zoom = st.transform[2];
      if (zoom === last) return;
      last = zoom;
      const vars = Object.entries(zoomVarsAt(zoom));
      const els = document.getElementsByClassName(ZOOM_WIDTH_CLASS);
      for (let i = 0; i < els.length; i++) {
        const style = (els[i] as HTMLElement | SVGElement).style;
        for (const [name, value] of vars) style.setProperty(name, value);
      }
    });
  }, [store]);
}

/**
 * A border width of `baseScreenPx` × BORDER_WIDTH_SCALE screen px, as a CSS length in canvas px: the
 * base divided by the zoom (floored at 0.15), never under the base and never over 8× it. React Flow
 * scales the whole viewport, so a fixed canvas-px border shrinks to near-invisible when zoomed out.
 * Only for an element with ZOOM_WIDTH_CLASS.
 */
export function zoomInvariantWidth(baseScreenPx: number): string {
  const base = baseScreenPx * BORDER_WIDTH_SCALE;
  return `clamp(${base}px, calc(${base}px / max(0.15, var(--skena-zoom))), ${base * 8}px)`;
}

/**
 * The inline style of a selected node: a plain outline just outside the node edge, at a constant
 * screen size whatever the zoom. Only for an element with ZOOM_WIDTH_CLASS.
 */
export function focusRingStyle(selected: boolean): React.CSSProperties {
  if (!selected) return {};
  return {
    outline:       'var(--skena-ring-width) solid var(--skena-focus-ring)',
    outlineOffset: 'var(--skena-ring-offset)',
    // - spread shadow as wide as the outline offset fills the band between the border and the outline;
    //   an inline box-shadow replaces the stylesheet's, so .skena-node's depth shadow is repeated here
    boxShadow:     '0 0 0 var(--skena-ring-offset) var(--skena-focus-fill), 0 2px 8px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06)',
  };
}
