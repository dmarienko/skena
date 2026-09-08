import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FONT = 'system-ui, -apple-system, sans-serif';
const ROW_PX = 26;   // - one row's height, as in KernelPicker

/**
 * Right-click menu for one rail segment: every segment control in one list, so a segment squeezed
 * down to its 28px floor still reaches the controls its column had to drop.
 */
export function SegmentMenu({ anchor, folded, kernelBound, onFold, onRun, onReflow, onKernel, onKernelAction, onRename, onDelete, onClose }: {
  anchor: { x: number; y: number };   // - screen point of the right-click
  folded: boolean;
  kernelBound: boolean;
  onFold: () => void;
  onRun: () => void;
  onReflow: () => void;
  onKernel: () => void;
  onKernelAction: (action: 'start' | 'interrupt' | 'restart' | 'shutdown') => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  // - attached in an effect, i.e. after the mousedown that opened the menu, so the opening click
  //   cannot close it. A mousedown on an anchor is left alone, as in KernelPicker.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.('[data-sk-popover-anchor]')) return;
      onClose();
    };
    // - stop it here: the canvas has its own window Escape handler
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', height: ROW_PX, padding: '0 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 12, color: 'var(--sk-text1)', userSelect: 'none' };
  // - keep the box on screen: the rows plus the separator; a bound section adds the four kernel actions
  const rows = kernelBound ? 11 : 7;
  const top = Math.max(4, Math.min(anchor.y + 4, window.innerHeight - rows * ROW_PX - 8));

  return createPortal(
    <div ref={ref} className="nodrag" onContextMenu={e => e.preventDefault()}
      style={{ position: 'fixed', left: anchor.x + 4, top, zIndex: 1000, minWidth: 160, background: 'var(--sk-bg2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: '4px 0', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
      <div style={row} onClick={() => { onFold(); onClose(); }}>{folded ? 'Unfold' : 'Fold'}</div>
      <div style={row} onClick={() => { onRun(); onClose(); }}>Run section</div>
      <div style={row} onClick={() => { onReflow(); onClose(); }}>Reflow section</div>
      {/* - Kernel… and Rename… hand over to another popover: closing here would take that popover down with the menu */}
      <div style={row} onClick={onKernel}>Kernel…</div>
      {kernelBound && (['start', 'interrupt', 'restart', 'shutdown'] as const).map(a => (
        <div key={a} style={row} onClick={() => { onKernelAction(a); onClose(); }}>{`${a[0].toUpperCase()}${a.slice(1)} kernel`}</div>
      ))}
      <div style={row} onClick={onRename}>Rename…</div>
      <div style={{ height: 1, background: 'var(--sk-border)', margin: '4px 0' }} />
      <div style={row} onClick={() => { onDelete(); onClose(); }}>Delete section</div>
    </div>,
    document.body,
  );
}
