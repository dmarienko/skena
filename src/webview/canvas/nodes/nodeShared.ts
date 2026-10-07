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
 * canvas zooms. Each one carries in its inline style the zoom as --skena-zoom, the focus ring sizes as
 * --skena-ring-width and --skena-ring-offset, and as --skena-band-extra how much wider a node's drawn
 * border is than its zoom-1 width: set from useZoomVars when it renders, and rewritten by useZoomVar on
 * every zoom change. canvas.css registers the four as not inherited, so a zoom change restyles these
 * elements and nothing inside them, and no component re-renders.
 */
export const ZOOM_WIDTH_CLASS = 'skena-zoom-width';

/**
 * The class of an element that only needs --skena-band-extra (a scroller inside a node, bandHeldScroller):
 * set from useBandVars when it renders, and rewritten by useZoomVar only when that width changes, which
 * is a few times across a whole zoom from 0.3 to 1.
 */
export const BAND_CLASS = 'skena-band';

// - the focus ring in canvas px for a zoom: about 3.75 screen px wide, 7 screen px off the node edge
function focusRingAt(zoom: number): { width: string; offset: string } {
  const sc     = Math.max(0.15, zoom);
  const lineW  = Math.min(30, Math.max(2,   3.75 / sc));
  const offset = Math.min(40, Math.max(3,   7    / sc));
  return { width: `${lineW.toFixed(1)}px`, offset: `${offset.toFixed(1)}px` };
}

// - --skena-band-extra at the current zoom, in px; measured by useZoomVar, so a node that mounts later
//   starts from the value its neighbours have
let bandExtraPx = 0;

function zoomVarsAt(zoom: number): Record<string, string> {
  const ring = focusRingAt(zoom);
  return {
    '--skena-zoom': String(zoom),
    '--skena-ring-width': ring.width,
    '--skena-ring-offset': ring.offset,
    '--skena-band-extra': `${bandExtraPx}px`,
  };
}

/**
 * The inline custom properties of an element with ZOOM_WIDTH_CLASS, at the zoom of this render. The
 * zoom is read from the store, not subscribed to: useZoomVar keeps the element current afterwards.
 */
export function useZoomVars(): React.CSSProperties {
  return zoomVarsAt(useStoreApi().getState().transform[2]) as React.CSSProperties;
}

/** The inline custom property of an element with BAND_CLASS, at this render. */
export function useBandVars(): React.CSSProperties {
  return { '--skena-band-extra': `${bandExtraPx}px` } as React.CSSProperties;
}

function writeAll(className: string, vars: [string, string][]): void {
  const els = document.getElementsByClassName(className);
  for (let i = 0; i < els.length; i++) {
    const style = (els[i] as HTMLElement | SVGElement).style;
    for (const [name, value] of vars) style.setProperty(name, value);
  }
}

// - a hidden element with a left border of `width`, to read back the width the browser draws: it
//   rounds a border width down to whole pixels, and only that rounded width says where the drawn
//   border ends
function borderProbe(width: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;border-left:${width} solid`;
  document.body.appendChild(el);
  return el;
}

/**
 * Rewrites the custom properties of every ZOOM_WIDTH_CLASS element when the zoom changes, and of every
 * BAND_CLASS element when the drawn border's extra width does, from a store subscription, outside React. Inline on each element rather than in one shared stylesheet
 * rule: on a canvas of 46k elements a write to a rule cost about 25 ms of style work, the same write
 * inline on each element about 10 ms. Call once, inside the ReactFlowProvider.
 */
export function useZoomVar(): void {
  const store = useStoreApi();
  useEffect(() => {
    const wide = borderProbe(zoomInvariantWidth(1.5));
    const base = borderProbe(baseBorderWidth(1.5));
    let last = Number.NaN;
    const write = (zoom: number, force: boolean): void => {
      if (zoom === last && !force) return;
      last = zoom;
      wide.style.setProperty('--skena-zoom', String(zoom));
      const extra = Math.max(0, parseFloat(getComputedStyle(wide).borderLeftWidth) - parseFloat(getComputedStyle(base).borderLeftWidth));
      const bandChanged = extra !== bandExtraPx || force;
      bandExtraPx = extra;
      // - canvas.css: while this is on, NodeBorder draws the border and the node's own is transparent
      document.documentElement.toggleAttribute('data-skena-band', extra > 0);
      writeAll(ZOOM_WIDTH_CLASS, Object.entries(zoomVarsAt(zoom)));
      if (bandChanged) writeAll(BAND_CLASS, [['--skena-band-extra', `${extra}px`]]);
    };
    write(store.getState().transform[2], true);
    const unsubscribe = store.subscribe(st => write(st.transform[2], false));
    // - a move to a screen with another pixel ratio, or a window zoom, changes how widths round
    const onResize = (): void => write(store.getState().transform[2], true);
    window.addEventListener('resize', onResize);
    return () => {
      unsubscribe();
      window.removeEventListener('resize', onResize);
      wide.remove();
      base.remove();
      document.documentElement.removeAttribute('data-skena-band');
    };
  }, [store]);
}

/**
 * The width of a node border at zoom 1 and above, and the width of the border a node lays out with at
 * every zoom. Below zoom 1 NodeBorder draws the visible border over it, at zoomInvariantWidth.
 */
export function baseBorderWidth(baseScreenPx: number): string {
  return `${baseScreenPx * BORDER_WIDTH_SCALE}px`;
}

/**
 * Padding of `px` plus the extra width the drawn border has at this zoom: on a node with a base
 * border, its content then sits where it would inside a border of the full drawn width.
 */
export function bandInsetPadding(px = 0): string {
  return `calc(${px}px + var(--skena-band-extra))`;
}

/**
 * The style of a scroller inside a node with bandInsetPadding, given its zoom-1 padding. Its left edge
 * stays at the node's own border, under the drawn border, with its zoom-1 left padding; its right edge
 * moves in to the drawn border while its right padding gives that width back. So the content keeps its
 * zoom-1 width and its zoom-1 place inside the scroller, which lets the browser keep the content's
 * layout through a zoom, and the scrollbar stays clear of the drawn border. Holds while the extra width
 * is at most `right`; past that the content narrows by the difference.
 */
export function bandHeldScroller(top: number, right: number, bottom: number, left: number): React.CSSProperties {
  return {
    marginLeft: 'calc(-1 * var(--skena-band-extra))',
    padding:    `${top}px max(0px, calc(${right}px - var(--skena-band-extra))) ${bottom}px ${left}px`,
  };
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
