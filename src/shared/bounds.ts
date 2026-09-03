/**
 * Bounded-canvas geometry. The spatial-notebook canvas has a hard top-left origin and grows
 * right + down only. These pure helpers keep node coordinates out of negative space and park an
 * opened canvas's content near the origin. Shared by the host (load-time migration) and the
 * webview (drag / creation clamp). No Node.js APIs — this file is bundled into both contexts.
 */

import { GRID } from './constants';
import type { CanvasData } from './types';

// - one empty slot between the origin (0,0) and the top-left node
export const ORIGIN_GUTTER = GRID;

// - keep a coordinate from crossing above/left of the origin
export function clampToOrigin(x: number, y: number): { x: number; y: number } {
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

/**
 * Cap a viewport translate so a programmatic camera move (zoom, keyboard pan, nav, Home, restore)
 * cannot reveal MORE than one grid of margin above/left of the origin. React Flow only applies
 * translateExtent to interactive mouse panning, so setViewport/setCenter calls must be clamped
 * explicitly. The translate may not exceed ORIGIN_GUTTER*zoom on either axis, giving content parked
 * at the origin a one-grid breathing margin at the top-left while still hard-stopping beyond it.
 */
export function clampViewportToOrigin(x: number, y: number, zoom: number): { x: number; y: number } {
  const max = ORIGIN_GUTTER * zoom;
  return { x: Math.min(x, max), y: Math.min(y, max) };
}

/**
 * The one rule every camera write obeys: one grid of margin left of the origin, flush at the top.
 * Nothing above flow y = 0 is ever shown (the section rail lives outside the flow).
 */
export function clampCameraToOrigin(x: number, y: number, zoom: number): { x: number; y: number } {
  const c = clampViewportToOrigin(x, y, zoom);
  return { x: c.x, y: Math.min(c.y, 0) };
}

/**
 * Shift content out of negative space into the bounded field. Runs on every canvas open but only
 * acts when the content's bounding box actually extends left/above the origin (min x or y < 0) —
 * e.g. live-slippage authored near x = -5700. Each negative axis is parked flush at the origin (0);
 * an axis already at or past the origin is left untouched (so a node legitimately at x = 0 never
 * drags the whole canvas on the next load). Returns the same reference when nothing needs shifting
 * (no save). The saved viewport is shifted with the content so the reopened framing is unchanged,
 * and every section lane travels with the vertical lift (a lane has no x).
 */
export function normalizeCanvasToOrigin(canvas: CanvasData): CanvasData {
  if (canvas.nodes.length === 0) return canvas;
  let minX = Infinity;
  let minY = Infinity;
  for (const n of canvas.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  }
  const dx = minX < 0 ? -minX : 0;
  const dy = minY < 0 ? -minY : 0;
  if (dx === 0 && dy === 0) return canvas;
  const nodes = canvas.nodes.map(n => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const viewport = canvas.viewport
    ? {
        ...canvas.viewport,
        x: canvas.viewport.x - dx * canvas.viewport.zoom,
        y: canvas.viewport.y - dy * canvas.viewport.zoom,
      }
    : canvas.viewport;
  const sections = canvas.metadata?.sections;
  // - lanes are pure y, so only the vertical lift applies to them; without it a lifted canvas would
  //   land its content one lift below the lanes that own it
  const metadata = dy !== 0 && sections?.length
    ? { ...canvas.metadata, sections: sections.map(l => ({ ...l, y: l.y + dy })) }
    : canvas.metadata;
  return { ...canvas, nodes, viewport, metadata };
}
