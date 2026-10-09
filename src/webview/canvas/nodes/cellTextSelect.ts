/**
 * A mouse selection in an output cell's text (CellNode.tsx).
 */

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * The point nearest (x, y) inside both boxes, 1px in from their edges; null when they do not overlap.
 */
export function pointInside(x: number, y: number, a: Box, b: Box): { x: number; y: number } | null {
  const left = Math.max(a.left, b.left) + 1;
  const right = Math.min(a.right, b.right) - 1;
  const top = Math.max(a.top, b.top) + 1;
  const bottom = Math.min(a.bottom, b.bottom) - 1;
  if (left > right || top > bottom) return null;
  return { x: Math.min(right, Math.max(left, x)), y: Math.min(bottom, Math.max(top, y)) };
}

/**
 * Keep the end of a drag selection that starts in `text` inside it, until the mouse button is released.
 * The pointer leaves the cell to make a long output scroll; Chromium then puts the end at the first
 * selectable text on the canvas, since the pane under the pointer has no text of its own. Each time the
 * selection changes, an end outside `text` goes back to the visible text nearest the pointer.
 */
export function keepSelectionIn(text: HTMLElement, x: number, y: number): void {
  const scroller = text.closest('.skena-scrollable') ?? text;
  let px = x;
  let py = y;
  const onMove = (e: MouseEvent): void => { px = e.clientX; py = e.clientY; };
  const onChange = (): void => {
    const sel = document.getSelection();
    if (!sel?.focusNode || text.contains(sel.focusNode) || !text.contains(sel.anchorNode)) return;
    const p = pointInside(px, py, text.getBoundingClientRect(), scroller.getBoundingClientRect());
    const r = p && document.caretRangeFromPoint(p.x, p.y);
    if (r && text.contains(r.startContainer)) sel.extend(r.startContainer, r.startOffset);
  };
  const onUp = (): void => {
    // - selectionchange is queued: the last move's may not have arrived yet
    onChange();
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('selectionchange', onChange);
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  document.addEventListener('selectionchange', onChange);
}
