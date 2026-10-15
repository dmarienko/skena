import React from 'react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { useKernelState, KERNEL_TEXT_COLOR } from '../hooks/useKernelState';
import { railItems, kernelButtons, ICON_PX, BTN_H, DOT_BTN_H, DOT_PX, COMPACT_FOLD_H, LABEL_H, type RailSegment as Seg } from './railGeometry';
import type { RailKernel } from './SectionRail';
import { fmtDateTime } from '../../shared/dateTime';
import { sectionTitleParts, kernelDisplayName } from './sectionTitle';

const FONT = 'system-ui, -apple-system, sans-serif';

export { fmtDateTime };

const Chevron = ({ folded }: { folded: boolean }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: folded ? 'rotate(-90deg)' : 'none', transition: 'transform 130ms' }}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

const Play = () => (
  <svg width={ICON_PX} height={ICON_PX} viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l8 5-8 5z" /></svg>
);

const Stop = () => (
  <svg width={ICON_PX} height={ICON_PX} viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
);

const Pause = () => (
  <svg width={ICON_PX} height={ICON_PX} viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="0.5" /><rect x="9" y="3" width="3" height="10" rx="0.5" /></svg>
);

// - the stroked icons draw like the chevron: round caps and joins, no fill
const Stroked = ({ d }: { d: string }) => (
  <svg width={ICON_PX} height={ICON_PX} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const Restart  = () => <Stroked d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.5h-2.5" />;
const Power    = () => <Stroked d="M8 2.5v5M4.8 4.6a5 5 0 1 0 6.4 0" />;
const Swap     = () => <Stroked d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />;

const btn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
  color: 'var(--sk-text2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: BTN_H, height: BTN_H, flex: 'none',
};

export function RailSegment({ lane, seg, color, kernel, current, selected, runnable, running, onFold, onRun, onStop, onKernelAction, onDelete, onKernel, onTitle, onMenu }: {
  lane: DerivedLane;
  seg: Seg;
  color: string;
  kernel: RailKernel | null;
  current: boolean;
  /** - the section's band is the focus: framed in the colour of a focused node's ring */
  selected: boolean;
  /** - the section's kernelId names a kernel that exists; ▶ is dimmed and says so when it does not */
  runnable: boolean;
  /** - this section's run is in progress: ■ is shown */
  running: boolean;
  onFold: (id: string) => void;
  onRun: (id: string) => void;
  onStop: (id: string) => void;
  onKernelAction: (id: string, action: 'interrupt' | 'restart' | 'shutdown') => void;
  onDelete: (id: string) => void;
  onKernel: (id: string, anchor: DOMRect) => void;
  onTitle: (id: string, anchor: DOMRect) => void;
  onMenu: (id: string, at: { x: number; y: number }, anchor: DOMRect) => void;
}): JSX.Element {
  // - the hook is unconditional (rules of hooks); an unbound section passes a server no status ever matches
  const state = useKernelState(kernel?.server ?? '', kernel?.kernelId);
  const { title, head, kernel: kname, text } = sectionTitleParts(lane, kernelDisplayName(kernel));
  // - a kernel with an id the last poll did not call dead: one that can be interrupted, restarted, shut down
  const live = !!kernel?.kernelId && state !== 'dead';
  const buttons = kernelButtons({ folded: !!lane.folded, bound: !!kernel, live, running });
  const { items, titleMaxPx, compact } = railItems(seg.height, text.length, !!lane.folded, buttons);
  // - a record's live state is worth showing; a kernel node already shows its own LED on the canvas
  const kernelName = kernel ? (kernel.kind === 'record' ? `${kernel.label} · ${kernel.server} · ${state}` : `${kernel.label} · ${kernel.name}`) : null;
  // - an untitled section already shows its datetime as the title: do not print it twice
  const tooltip = `${head}${lane.title?.trim() ? ` · ${fmtDateTime(lane.createdAt)}` : ''} · ${kernelName ?? 'no kernel'}${lane.folded ? ' · folded' : ''} · right-click for the menu`;
  const anchor = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect();

  return (
    <div title={tooltip} data-sk-lane={lane.id} data-selected={selected ? '1' : undefined}
      onContextMenu={e => { e.preventDefault(); onMenu(lane.id, { x: e.clientX, y: e.clientY }, anchor(e)); }}
      style={{ position: 'absolute', left: 0, right: 0, top: seg.top, height: seg.height, opacity: lane.folded && !selected ? 0.55 : 1,
        borderRadius: 3, boxShadow: selected ? 'inset 0 0 0 2px var(--skena-focus-ring)' : undefined }}>
      <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 4, borderRadius: 2, background: color }} />
      <div style={{ position: 'absolute', left: 10, right: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden', boxSizing: 'border-box',
        ...(compact ? { justifyContent: 'center', gap: 0, paddingTop: 0 } : { gap: 7, paddingTop: 8 }) }}>
        {items.map(item => {
          switch (item) {
            case 'fold':
              return <button key={item} style={compact ? { ...btn, height: COMPACT_FOLD_H } : btn} title={lane.folded ? 'unfold section' : 'fold section'} onClick={() => onFold(lane.id)}><Chevron folded={!!lane.folded} /></button>;
            case 'title':
              return (
                // - vertical-rl puts the text run on the element's height, so maxHeight + overflow hidden
                //   truncate along the title; the span is a flex item, already a block container
                <span key={item} data-sk-popover-anchor="" data-sk-rail-title="" onDoubleClick={e => onTitle(lane.id, anchor(e))}
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontFamily: FONT, fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap', cursor: 'default', color: current ? 'var(--sk-text1)' : 'var(--sk-text2)', userSelect: 'none', maxHeight: titleMaxPx, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color }}>{lane.label}:</span> {title}
                  {kname && <span data-sk-kernel-state={state} style={{ color: KERNEL_TEXT_COLOR[state], fontWeight: 400 }}> · {kname}</span>}
                </span>
              );
            case 'label':
              return <span key={item} data-sk-popover-anchor="" data-sk-rail-label="" onDoubleClick={e => onTitle(lane.id, anchor(e))} style={{ fontFamily: FONT, fontWeight: 700, fontSize: 10, lineHeight: compact ? `${LABEL_H}px` : undefined, color, userSelect: 'none' }}>{lane.label}</span>;
            case 'run':
              return (
                <button key={item} style={{ ...btn, color: runnable ? 'var(--sk-text1)' : 'var(--sk-text3)' }}
                  title={runnable ? 'run section' : 'no section kernel — bind one from the dot; cells with a kernel edge still run'}
                  onClick={() => onRun(lane.id)}><Play /></button>
              );
            case 'stop':
              return <button key={item} style={{ ...btn, color: 'var(--sk-text1)' }} title="stop the section run: queued cells are not run, the running one is interrupted" onClick={() => onStop(lane.id)}><Stop /></button>;
            case 'interrupt':
              // - always there while the kernel is alive, so the buttons under it do not move; dimmed while idle
              return (
                <button key={item} style={{ ...btn, color: state === 'busy' ? 'var(--sk-text1)' : 'var(--sk-text3)' }}
                  title={state === 'busy' ? 'interrupt the kernel' : 'interrupt the kernel (it is idle)'} onClick={() => onKernelAction(lane.id, 'interrupt')}><Pause /></button>
              );
            case 'restart':
              return <button key={item} style={{ ...btn, color: 'var(--sk-text1)' }} title="restart the kernel (its variables are lost)" onClick={() => onKernelAction(lane.id, 'restart')}><Restart /></button>;
            case 'shutdown':
              return <button key={item} style={{ ...btn, color: 'var(--sk-text1)' }} title="shut the kernel down" onClick={() => onKernelAction(lane.id, 'shutdown')}><Power /></button>;
            case 'select':
              return <button key={item} data-sk-popover-anchor="" style={{ ...btn, color: 'var(--sk-text1)' }} title="select kernel" onClick={e => onKernel(lane.id, anchor(e))}><Swap /></button>;
            case 'kernel':
              return (
                <button key={item} data-sk-popover-anchor="" style={{ ...btn, height: DOT_BTN_H }} title={kernelName ? `kernel: ${kernelName}` : 'bind a kernel'} onClick={e => onKernel(lane.id, anchor(e))}>
                  {/* - unbound stays a hollow ring, but in the section's colour: "no kernel yet" without breaking the stripe */}
                  <span style={{ width: DOT_PX, height: DOT_PX, borderRadius: '50%', background: kernel ? color : 'transparent', border: kernel ? 'none' : `1.5px solid ${color}`, display: 'block' }} />
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
