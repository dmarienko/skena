import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@xyflow/react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { kernelColor } from '../canvas/palette';
import { railSegments, RAIL_W, PLUS_H } from './railGeometry';
import { RailSegment } from './RailSegment';
import { KernelPicker } from './KernelPicker';
import { TitleEditor } from './TitleEditor';
import { SegmentMenu } from './SegmentMenu';

/** What the rail needs to know about one kernel: a record in canvas metadata, or a kernel node. */
export interface RailKernel {
  id: string;
  label: string;        // - a node's K1 …; a record's displayName
  name: string;         // - a node's displayName; a record's server
  colorIndex: number;
  server: string;
  kernelId?: string;    // - live Jupyter id, for the LED
  kind: 'record' | 'node';
}

// - bound → the kernel's colour; unbound → the palette by stack order, so every section reads distinct
export function laneColor(lane: { kernelId?: string; index: number }, kernels: RailKernel[]): { color: string; kernel: RailKernel | null } {
  const k = lane.kernelId ? kernels.find(x => x.id === lane.kernelId) ?? null : null;
  return { color: kernelColor(k ? k.colorIndex : lane.index), kernel: k };
}

export function SectionRail({ lanes, kernels, selectedNodeId, onFold, onRun, onReflow, onDelete, onBindKernel, onRename, onNewSection, onNewKernel, onRemoveKernel, onKernelAction }: {
  lanes: DerivedLane[];
  kernels: RailKernel[];
  selectedNodeId: string | null;
  onFold: (id: string) => void;
  onRun: (id: string) => void;
  onReflow: (id: string) => void;
  onDelete: (id: string) => void;
  onBindKernel: (id: string, kernelId: string | null) => void;
  onRename: (id: string, title: string) => void;
  onNewSection: () => void;
  onNewKernel: (laneId: string) => void;
  onRemoveKernel: (kernelRef: string) => void;
  onKernelAction: (laneId: string, action: 'start' | 'interrupt' | 'restart' | 'shutdown') => void;
}): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  // - the flow container's height from the store: reactive and correct on the first paint
  const height = useStore(s => s.height);
  // - the + strip is not canvas: segments are laid out in the space above it
  const segs = railSegments(lanes, ty, zoom, Math.max(0, height - PLUS_H));
  const byId = new Map(lanes.map(l => [l.id, l]));
  const currentId = selectedNodeId ? lanes.find(l => l.memberIds.includes(selectedNodeId))?.id ?? null : null;

  // - one popover at a time, anchored to the control that opened it. The menu also keeps the
  //   segment's rect, so a picker opened from a menu row still lands beside the segment.
  const [pop, setPop] = useState<
    | { kind: 'kernel' | 'title'; laneId: string; anchor: DOMRect }
    | { kind: 'menu'; laneId: string; at: { x: number; y: number }; anchor: DOMRect }
    | null
  >(null);
  const closePop = useCallback(() => setPop(null), []);
  // - a second click on the same anchor closes the popover instead of reopening it
  const openKernel = useCallback((id: string, anchor: DOMRect) => setPop(p => (p?.kind === 'kernel' && p.laneId === id ? null : { kind: 'kernel', laneId: id, anchor })), []);
  const openTitle = useCallback((id: string, anchor: DOMRect) => setPop(p => (p?.kind === 'title' && p.laneId === id ? null : { kind: 'title', laneId: id, anchor })), []);
  // - a right-click always opens at the new point, so no toggle here
  const openMenu = useCallback((id: string, at: { x: number; y: number }, anchor: DOMRect) => setPop({ kind: 'menu', laneId: id, at, anchor }), []);
  const popLane = pop ? byId.get(pop.laneId) : undefined;
  // - the lane can go away under an open popover (deleted, or undone)
  useEffect(() => { if (pop && !byId.has(pop.laneId)) setPop(null); }, [pop, lanes]);

  return (
    <div style={{ width: RAIL_W, flex: '0 0 auto', position: 'relative', background: 'var(--sk-bg1)', borderRight: '1px solid var(--sk-border)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: PLUS_H, overflow: 'hidden' }}>
        {segs.map(seg => {
          const lane = byId.get(seg.id);
          if (!lane) return null;
          const { color, kernel } = laneColor(lane, kernels);
          // - a dangling kernelId is not runnable either: laneColor resolved it to null
          const runnable = kernel !== null;
          return (
            <RailSegment key={seg.id} lane={lane} seg={seg} color={color} kernel={kernel} runnable={runnable}
              current={lane.id === currentId} onFold={onFold} onRun={onRun} onDelete={onDelete} onKernel={openKernel} onTitle={openTitle} onMenu={openMenu} />
          );
        })}
      </div>
      {/* - paddingLeft 10 puts the + on the same axis as a segment's controls, which start right of the stripe */}
      <button title="new section" onClick={onNewSection}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: PLUS_H, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 10, background: 'var(--sk-bg1)', border: 'none', borderTop: '1px solid var(--sk-border)', cursor: 'pointer', color: 'var(--sk-text2)', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 16, lineHeight: 1 }}>
        +
      </button>
      {pop && popLane && pop.kind === 'kernel' && (
        <KernelPicker key={pop.laneId} anchor={pop.anchor} kernels={kernels} currentId={popLane.kernelId ?? null}
          onPick={kid => onBindKernel(popLane.id, kid)} onNew={() => onNewKernel(popLane.id)} onRemove={onRemoveKernel} onClose={closePop} />
      )}
      {pop && popLane && pop.kind === 'title' && (
        <TitleEditor key={pop.laneId} anchor={pop.anchor} initial={popLane.title ?? ''}
          onCommit={t => onRename(popLane.id, t)} onClose={closePop} />
      )}
      {pop && popLane && pop.kind === 'menu' && (
        // - bound only when the lane's kernelId still names a live kernel; a dangling id offers no-op actions
        <SegmentMenu key={pop.laneId} anchor={pop.at} folded={!!popLane.folded} kernelBound={kernels.some(k => k.id === popLane.kernelId)}
          onFold={() => onFold(popLane.id)} onRun={() => onRun(popLane.id)} onReflow={() => onReflow(popLane.id)}
          onKernel={() => setPop({ kind: 'kernel', laneId: popLane.id, anchor: pop.anchor })}
          onKernelAction={a => onKernelAction(popLane.id, a)}
          onRename={() => setPop({ kind: 'title', laneId: popLane.id, anchor: pop.anchor })}
          onDelete={() => onDelete(popLane.id)} onClose={closePop} />
      )}
    </div>
  );
}
