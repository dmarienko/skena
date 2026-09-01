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
 * Shift every node so the top-left corner of the content's bounding box sits at the origin
 * gutter. Runs once when a canvas is opened, to migrate canvases authored in negative space
 * (e.g. live-slippage near x = -5700) into the bounded field. Idempotent: a canvas already at
 * the gutter is returned by the same reference, so it triggers no save. The saved viewport is
 * shifted with the content so the reopened framing is unchanged.
 */
export function normalizeCanvasToOrigin(canvas: CanvasData): CanvasData {
  if (canvas.nodes.length === 0) return canvas;
  let minX = Infinity;
  let minY = Infinity;
  for (const n of canvas.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  }
  const dx = ORIGIN_GUTTER - minX;
  const dy = ORIGIN_GUTTER - minY;
  if (dx === 0 && dy === 0) return canvas;
  const nodes = canvas.nodes.map(n => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const viewport = canvas.viewport
    ? {
        ...canvas.viewport,
        x: canvas.viewport.x - dx * canvas.viewport.zoom,
        y: canvas.viewport.y - dy * canvas.viewport.zoom,
      }
    : canvas.viewport;
  return { ...canvas, nodes, viewport };
}
