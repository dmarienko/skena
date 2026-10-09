/**
 * CellNode — standalone output cell (table, image, HTML).
 * Content stored inline in .canvas JSON.
 * Double-click puts its text in select mode (useSelectMode).
 */

import React, { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { CellNode } from '../../../shared/types';
import { capOutputHtml } from '../../../shared/outputCap';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { PlotlyRenderer } from '../../renderers/PlotlyRenderer';
import { ScrollableContent } from '../../components/ScrollableContent';
import { BAND_CLASS, HANDLE_STYLE, ZOOM_WIDTH_CLASS, bandHeldScroller, bandInsetPadding, baseBorderWidth, focusRingStyle, useBandVars, useZoomVars } from './nodeShared';
import { NodeBorder } from './NodeBorder';
import { nodeBorderColor } from '../palette';
import { charAt, keepSelectionIn, selectWord, TextChar } from './cellTextSelect';

// - the text in select mode: the mouse selects it instead of moving the node or panning the canvas
//   (canvas.css: .skena-cell-text)
const TEXT_CLASS = 'skena-cell-text nodrag nopan';

function onTextMouseDown(e: React.MouseEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  // - a press on selected text (the word the double-click selected) starts a new selection there, not a
  //   drag-and-drop of the selected text
  if (e.detail === 1 && !e.shiftKey) window.getSelection()?.removeAllRanges();
  keepSelectionIn(e.currentTarget, e.clientX, e.clientY);
}

/**
 * Select mode of an output cell's text. Off, the cell drags like any other node. A double-click turns it
 * on and selects the word under the pointer; then a drag selects text and Ctrl+C copies it. Esc, a press
 * outside the cell, the cell losing the selection, or a pan or zoom turn it off.
 */
function useSelectMode(
  cellRef: React.RefObject<HTMLDivElement>, textRef: React.RefObject<HTMLDivElement>, selected: boolean, hasText: boolean,
): boolean {
  const [on, setOn] = useState(false);
  const word = useRef<TextChar | null>(null);

  useEffect(() => {
    const cell = cellRef.current;
    if (!cell || !hasText || on) return;
    // - the word is the one under the first press: that click reveals a cell not fully in view, and the
    //   canvas moves under the pointer before the second
    let pressed: TextChar | null = null;
    const onDown = (e: MouseEvent): void => {
      if (e.button === 0 && e.detail === 1) pressed = textRef.current ? charAt(textRef.current, e.clientX, e.clientY) : null;
    };
    const onDoubleClick = (e: MouseEvent): void => {
      word.current = pressed?.node.isConnected ? pressed : textRef.current ? charAt(textRef.current, e.clientX, e.clientY) : null;
      setOn(true);
    };
    cell.addEventListener('mousedown', onDown);
    cell.addEventListener('dblclick', onDoubleClick);
    return () => {
      cell.removeEventListener('mousedown', onDown);
      cell.removeEventListener('dblclick', onDoubleClick);
    };
  }, [cellRef, textRef, hasText, on]);

  // - after the render that made the text selectable
  useLayoutEffect(() => {
    if (!on || !word.current) return;
    selectWord(word.current);
    word.current = null;
  }, [on]);

  useEffect(() => {
    if (!on) return;
    const node = cellRef.current?.closest('.react-flow__node') ?? cellRef.current;
    const off = (): void => setOn(false);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') off(); };
    const onDown = (e: PointerEvent): void => { if (!(e.target instanceof Node) || !node?.contains(e.target)) off(); };
    const root = document.documentElement;
    const moving = new MutationObserver(() => { if (root.getAttribute('data-skena-interacting') === '1') off(); });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    moving.observe(root, { attributes: true, attributeFilter: ['data-skena-interacting'] });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      moving.disconnect();
      // - the text is not selectable once the mode is off, so its selection goes too
      const sel = document.getSelection();
      if (sel?.anchorNode && node?.contains(sel.anchorNode)) sel.removeAllRanges();
    };
  }, [on, cellRef]);

  const wasSelected = useRef(selected);
  useEffect(() => {
    if (wasSelected.current && !selected) setOn(false);
    wasSelected.current = selected;
  }, [selected]);

  return on;
}

export function CellNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CellNode & { accentColor?: string };
  const selectedStyle = focusRingStyle(selected);
  const bw = baseBorderWidth(1.5);
  const zoomVars = useZoomVars();
  const bandVars = useBandVars();
  const borderColor = nodeBorderColor('cell', node.accentColor);

  // - cap oversized HTML (e.g. a huge dataframe) BEFORE it becomes DOM, so an existing giant cell
  //   from disk can't freeze the canvas on load. New runs are already capped host-side.
  const htmlContent = useMemo(
    () => (node.format === 'html' ? capOutputHtml(node.content) : node.content),
    [node.format, node.content],
  );

  // - auto-tail: when a live run grows the content, follow to the bottom so the latest output is
  //   visible — but only if the user is already near the bottom (don't yank them back if they
  //   scrolled up to read earlier output).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [node.content]);

  const cellRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const selecting = useSelectMode(cellRef, textRef, selected, node.format === 'html' || node.format === 'markdown');
  const textProps = selecting ? { onMouseDown: onTextMouseDown } : {};
  // - dashed, not solid: sets output cells apart from other node types at a glance; solid while its
  //   text is in select mode
  const borderStyle = selecting ? 'solid' : 'dashed';

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} />
    <div
      ref={cellRef}
      className={`skena-node skena-node--cell ${ZOOM_WIDTH_CLASS}`}
      style={{
        ...zoomVars,
        border:        `${bw} ${borderStyle} ${borderColor}`,
        padding:       bandInsetPadding(),
        height:        '100%',
        borderRadius:  6,
        overflow:      'hidden',
        background:    'var(--vscode-editorWidget-background)',
        display:       'flex',
        flexDirection: 'column',
        // - sci-fi focus ring
        ...selectedStyle,
      }}
    >
      <ScrollableContent ref={scrollRef} scrollKey={id} className={BAND_CLASS} style={{ ...bandVars, ...bandHeldScroller(6, 8, 6, 8) }}>
        {node.format === 'markdown' && <div ref={textRef} className={selecting ? TEXT_CLASS : undefined} {...textProps}><MarkdownRenderer content={node.content} /></div>}
        {node.format === 'image'    && <img src={node.content} alt="cell" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {node.format === 'html'     && <div ref={textRef} className={selecting ? `skena-cell-html ${TEXT_CLASS}` : 'skena-cell-html'} {...textProps} dangerouslySetInnerHTML={{ __html: htmlContent }} />}
        {node.format === 'plotly'   && <PlotlyRenderer json={node.content} />}
      </ScrollableContent>
    </div>
    <NodeBorder base={1.5} color={borderColor} borderStyle={borderStyle} />
    <NodeResizer
      minWidth={100} minHeight={60}
      isVisible={selected}
      onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
        detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
      }))}
    />
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
