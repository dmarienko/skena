import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { kernelColor } from '../canvas/palette';
import { useKernelState, LED_COLOR } from '../hooks/useKernelState';
import { DOT_PX } from './railGeometry';
import type { RailKernel } from './SectionRail';

const FONT = 'system-ui, -apple-system, sans-serif';
const ROW_PX = 26;   // - one row's height, for the on-screen clamp below
const ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 12, color: 'var(--sk-text1)' };

/** Popover listing this canvas's kernels — records first, then kernel nodes; portalled to body so the rail's overflow does not clip it. */
export function KernelPicker({ anchor, kernels, currentId, onPick, onNew, onRemove, onClose }: {
  anchor: DOMRect;
  kernels: RailKernel[];
  currentId: string | null;
  onPick: (kernelId: string | null) => void;
  onNew: () => void;
  onRemove: (kernelRef: string) => void;
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

  const records = kernels.filter(k => k.kind === 'record');
  const nodes = kernels.filter(k => k.kind === 'node');
  // - keep the box on screen: the kernels plus the separators, 'New kernel…' and 'none', at most 8 rows deep
  const top = Math.max(4, Math.min(anchor.top - 4, window.innerHeight - 4 - Math.min(kernels.length + 3, 8) * ROW_PX));

  return createPortal(
    <div ref={ref} className="nodrag" style={{ position: 'fixed', left: anchor.right + 6, top, zIndex: 1000, minWidth: 180, maxHeight: '60vh', overflowY: 'auto', background: 'var(--sk-bg2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: '4px 0', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
      {kernels.length === 0 && (
        <div style={{ ...ROW_STYLE, cursor: 'default', color: 'var(--sk-text2)' }}>no kernels yet</div>
      )}
      {records.map(k => (
        <KernelRow key={k.id} k={k} current={k.id === currentId} onPick={onPick} onRemove={onRemove} onClose={onClose} />
      ))}
      {records.length > 0 && nodes.length > 0 && <div style={{ height: 1, background: 'var(--sk-border)', margin: '4px 0' }} />}
      {nodes.map(k => (
        <KernelRow key={k.id} k={k} current={k.id === currentId} onPick={onPick} onRemove={onRemove} onClose={onClose} />
      ))}
      <div style={{ height: 1, background: 'var(--sk-border)', margin: '4px 0' }} />
      <div style={{ ...ROW_STYLE, color: 'var(--sk-text1)' }} onClick={() => { onNew(); onClose(); }}>New kernel…</div>
      <div style={{ ...ROW_STYLE, color: 'var(--sk-text2)' }} onClick={() => { onPick(null); onClose(); }}>none</div>
    </div>,
    document.body,
  );
}

// - one kernel. A record also shows its live LED and a ✕ that removes it from the canvas; a kernel
//   node is removed by deleting the node, so it gets neither.
function KernelRow({ k, current, onPick, onRemove, onClose }: {
  k: RailKernel;
  current: boolean;
  onPick: (kernelId: string | null) => void;
  onRemove: (kernelRef: string) => void;
  onClose: () => void;
}): JSX.Element {
  const state = useKernelState(k.server, k.kernelId);
  return (
    <div style={{ ...ROW_STYLE, fontWeight: current ? 600 : 400 }} onClick={() => { onPick(k.id); onClose(); }}>
      {k.kind === 'record' && (
        <span title={state} style={{ width: 7, height: 7, borderRadius: '50%', background: LED_COLOR[state], flex: 'none' }} />
      )}
      <span style={{ width: DOT_PX, height: DOT_PX, borderRadius: '50%', background: kernelColor(k.colorIndex), flex: 'none' }} />
      <span style={{ color: 'var(--sk-text2)' }}>{k.label}</span>
      <span>{k.name}</span>
      {k.kind === 'record' && (
        <span title="remove kernel" style={{ marginLeft: 'auto', color: 'var(--sk-text3)', fontSize: 11 }}
          onClick={e => { e.stopPropagation(); onRemove(k.id); }}>✕</span>
      )}
    </div>
  );
}
