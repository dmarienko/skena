import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { kernelColor } from '../canvas/palette';
import { DOT_PX } from './railGeometry';
import type { RailKernel } from './SectionRail';

const FONT = 'system-ui, -apple-system, sans-serif';
const ROW_PX = 26;   // - one row's height, for the on-screen clamp below

/** Popover listing the canvas's kernel nodes; portalled to body so the rail's overflow does not clip it. */
export function KernelPicker({ anchor, kernels, currentId, onPick, onClose }: {
  anchor: DOMRect;
  kernels: RailKernel[];
  currentId: string | null;
  onPick: (kernelId: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  // - the listener is attached in an effect, i.e. after the mousedown that opened the picker:
  //   the opening click cannot close it. A mousedown on an anchor is left alone so the anchor
  //   toggles the picker shut, instead of this closing it and the click reopening it.
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

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 12, color: 'var(--sk-text1)' };
  // - keep the box on screen: the kernels plus the separator and 'none', counted at most 8 rows deep
  const top = Math.max(4, Math.min(anchor.top - 4, window.innerHeight - 4 - Math.min(kernels.length + 2, 8) * ROW_PX));

  return createPortal(
    <div ref={ref} className="nodrag" style={{ position: 'fixed', left: anchor.right + 6, top, zIndex: 1000, minWidth: 180, maxHeight: '60vh', overflowY: 'auto', background: 'var(--sk-bg2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: '4px 0', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
      {kernels.length === 0 && (
        <div style={{ ...row, cursor: 'default', color: 'var(--sk-text2)' }}>no kernel nodes on this canvas — add one with “Skena: Add Kernel”</div>
      )}
      {kernels.map(k => (
        <div key={k.id} style={{ ...row, fontWeight: k.id === currentId ? 600 : 400 }} onClick={() => { onPick(k.id); onClose(); }}>
          <span style={{ width: DOT_PX, height: DOT_PX, borderRadius: '50%', background: kernelColor(k.colorIndex), flex: 'none' }} />
          <span style={{ color: 'var(--sk-text2)' }}>{k.label}</span>
          <span>{k.name}</span>
        </div>
      ))}
      <div style={{ height: 1, background: 'var(--sk-border)', margin: '4px 0' }} />
      <div style={{ ...row, color: 'var(--sk-text2)' }} onClick={() => { onPick(null); onClose(); }}>none</div>
    </div>,
    document.body,
  );
}
