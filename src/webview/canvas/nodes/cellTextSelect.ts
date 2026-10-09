/**
 * A mouse selection in an output cell's text (CellNode.tsx).
 */

export interface Box { left: number; top: number; right: number; bottom: number }

// - Intl.Segmenter is in Chromium and Node, not in this project's ES2020 lib types
interface WordSegments { containing(index: number): { segment: string; index: number } | undefined }
type SegmenterCtor = new (locale: undefined, options: { granularity: 'word' }) => { segment(text: string): WordSegments };
const words = new (Intl as unknown as { Segmenter: SegmenterCtor }).Segmenter(undefined, { granularity: 'word' });

/**
 * The [start, end) offsets a double-click on character `i` of `text` selects: its word, a number or a
 * file name whole, or the run of spaces or the punctuation mark it is (Unicode word boundaries, as
 * Chromium's own double-click).
 */
export function wordAt(text: string, i: number): [number, number] {
  const s = words.segment(text).containing(i);
  return s ? [s.index, s.index + s.segment.length] : [i, i];
}

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

/** A character in an output cell's text: its text node and its offset there. */
export interface TextChar { node: Text; i: number }

/**
 * The character of `text` under (x, y); null when none is there.
 */
export function charAt(text: HTMLElement, x: number, y: number): TextChar | null {
  const caret = document.caretRangeFromPoint(x, y);
  const node = caret?.startContainer;
  if (!caret || !(node instanceof Text) || !text.contains(node)) return null;
  const under = (i: number): boolean => {
    if (i < 0 || i >= node.data.length) return false;
    const r = document.createRange();
    r.setStart(node, i);
    r.setEnd(node, i + 1);
    return Array.from(r.getClientRects()).some(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
  };
  // - the caret is before or after the character under the pointer, by which half of it was hit
  const i = under(caret.startOffset) ? caret.startOffset : caret.startOffset - 1;
  return under(i) ? { node, i } : null;
}

/**
 * Select the word character `c` is in, as a double-click does.
 */
export function selectWord(c: TextChar): void {
  const [a, b] = wordAt(c.node.data, c.i);
  document.getSelection()?.setBaseAndExtent(c.node, a, c.node, b);
}

// - inside the padding: the node's resize strips and connection handles lie over its outer 5-7px, and a
//   point there is no position in the text
function contentBox(el: Element): Box {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    left: r.left + parseFloat(cs.paddingLeft), top: r.top + parseFloat(cs.paddingTop),
    right: r.right - parseFloat(cs.paddingRight), bottom: r.bottom - parseFloat(cs.paddingBottom),
  };
}

/**
 * Keep the end of a drag selection that starts in `text` at the visible text nearest the pointer, until
 * the mouse button is released. The pointer leaves the cell to make a long output scroll; Chromium then
 * puts the end at the first selectable text on the canvas (this cell's first line, or another cell's),
 * since the pane under the pointer has no text of its own.
 */
export function keepSelectionIn(text: HTMLElement, x: number, y: number): void {
  const scroller = text.closest('.skena-scrollable') ?? text;
  let px = x;
  let py = y;
  const onMove = (e: MouseEvent): void => { px = e.clientX; py = e.clientY; };
  const onChange = (): void => {
    const sel = document.getSelection();
    if (!sel?.focusNode || !text.contains(sel.anchorNode)) return;
    const p = pointInside(px, py, text.getBoundingClientRect(), contentBox(scroller));
    // - a pointer over the visible text: Chromium's own end is right
    if (!p || (p.x === px && p.y === py)) return;
    const r = document.caretRangeFromPoint(p.x, p.y);
    if (!r || !text.contains(r.startContainer)) return;
    if (sel.focusNode !== r.startContainer || sel.focusOffset !== r.startOffset) sel.extend(r.startContainer, r.startOffset);
  };
  const onUp = (): void => {
    // - selectionchange is queued: the last move's may not have arrived yet
    onChange();
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('selectionchange', onChange);
    // - the click that ends a drag selection is not a click on the canvas: React Flow would select a node
    //   or, released outside the cell, clear the selection (which ends select mode), and CanvasView would
    //   reveal the node, a pan. It comes right after this mouseup, before the timeout.
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !text.contains(sel.anchorNode)) return;
    const stop = (e: MouseEvent): void => e.stopPropagation();
    window.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  document.addEventListener('selectionchange', onChange);
}
