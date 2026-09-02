import React from 'react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { railItems, ITEM_H, type RailSegment as Seg } from './railGeometry';

const FONT = 'system-ui, -apple-system, sans-serif';

// - 'YYYY-MM-DD HH:MM' local time; the title of an untitled section
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const Chevron = ({ folded }: { folded: boolean }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: folded ? 'rotate(-90deg)' : 'none', transition: 'transform 130ms' }}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

const Play = () => (
  <svg width={ITEM_H} height={ITEM_H} viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l8 5-8 5z" /></svg>
);

const btn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
  color: 'var(--sk-text2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, flex: 'none',
};

export function RailSegment({ lane, seg, color, kernelName, current, onFold, onRun, onDelete, onKernel, onTitle }: {
  lane: DerivedLane;
  seg: Seg;
  color: string;
  kernelName: string | null;
  current: boolean;
  onFold: (id: string) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onKernel: (id: string, anchor: DOMRect) => void;
  onTitle: (id: string, anchor: DOMRect) => void;
}): JSX.Element {
  const title = lane.title?.trim() || fmtDateTime(lane.createdAt);
  const full = `${lane.label}: ${title}`;
  const { items, titleMaxPx } = railItems(seg.height, full.length);
  const tooltip = `${full} · ${fmtDateTime(lane.createdAt)} · ${kernelName ?? 'no kernel'}${lane.folded ? ' · folded' : ''}`;
  const anchor = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect();

  return (
    <div title={tooltip} style={{ position: 'absolute', left: 0, right: 0, top: seg.top, height: seg.height, opacity: lane.folded ? 0.55 : 1 }}>
      <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 4, borderRadius: 2, background: color }} />
      <div style={{ position: 'absolute', left: 10, right: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, paddingTop: 8, overflow: 'hidden', boxSizing: 'border-box' }}>
        {items.map(item => {
          switch (item) {
            case 'fold':
              return <button key={item} style={btn} title={lane.folded ? 'unfold section' : 'fold section'} onClick={() => onFold(lane.id)}><Chevron folded={!!lane.folded} /></button>;
            case 'title':
              return (
                // - vertical-rl puts the text run on the element's HEIGHT, so maxHeight truncates along
                //   the text; display:block is what makes overflow/text-overflow apply to a span at all
                <span key={item} onDoubleClick={e => onTitle(lane.id, anchor(e))} title="double-click to rename"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontFamily: FONT, fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap', cursor: 'default', color: current ? 'var(--sk-text1)' : 'var(--sk-text2)', userSelect: 'none', display: 'block', maxHeight: titleMaxPx, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color }}>{lane.label}:</span> {title}
                </span>
              );
            case 'label':
              return <span key={item} onDoubleClick={e => onTitle(lane.id, anchor(e))} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 10, color, userSelect: 'none' }}>{lane.label}</span>;
            case 'run':
              return <button key={item} style={btn} title="run section" onClick={() => onRun(lane.id)}><Play /></button>;
            case 'kernel':
              return (
                <button key={item} style={{ ...btn, height: 14 }} title={kernelName ? `kernel: ${kernelName}` : 'bind a kernel'} onClick={e => onKernel(lane.id, anchor(e))}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: kernelName ? color : 'transparent', border: kernelName ? 'none' : '1.5px solid var(--sk-text3)', display: 'block' }} />
                </button>
              );
            case 'delete':
              return <button key={item} style={{ ...btn, color: 'var(--sk-text3)', fontFamily: FONT, fontSize: 12 }} title="delete section and its nodes" onClick={() => onDelete(lane.id)}>✕</button>;
          }
        })}
      </div>
    </div>
  );
}
