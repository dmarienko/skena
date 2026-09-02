import React from 'react';
import { useStore } from '@xyflow/react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { kernelColor } from '../canvas/palette';
import { railSegments, RAIL_W } from './railGeometry';
import { RailSegment } from './RailSegment';

/** What the rail needs to know about a kernel node on this canvas. */
export interface RailKernel {
  id: string;
  label: string;        // - K1 …
  name: string;         // - displayName or 'kernel'
  colorIndex: number;
}

export function laneColor(lane: { kernelId?: string }, kernels: RailKernel[]): { color: string; kernel: RailKernel | null } {
  const k = lane.kernelId ? kernels.find(x => x.id === lane.kernelId) ?? null : null;
  return { color: k ? kernelColor(k.colorIndex) : 'var(--sk-text3)', kernel: k };
}

export function SectionRail({ lanes, kernels, selectedNodeId, onFold, onRun, onDelete, onKernel, onTitle, onNewSection }: {
  lanes: DerivedLane[];
  kernels: RailKernel[];
  selectedNodeId: string | null;
  onFold: (id: string) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onKernel: (id: string, anchor: DOMRect) => void;
  onTitle: (id: string, anchor: DOMRect) => void;
  onNewSection: () => void;
}): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  // - the flow container's height from the store: reactive and correct on the first paint
  const height = useStore(s => s.height);
  const segs = railSegments(lanes, ty, zoom, height);
  const byId = new Map(lanes.map(l => [l.id, l]));
  const currentId = selectedNodeId ? lanes.find(l => l.memberIds.includes(selectedNodeId))?.id ?? null : null;

  return (
    <div style={{ width: RAIL_W, flex: '0 0 auto', position: 'relative', background: 'var(--sk-bg1)', borderRight: '1px solid var(--sk-border)', overflow: 'hidden' }}>
      {segs.map(seg => {
        const lane = byId.get(seg.id);
        if (!lane) return null;
        const { color, kernel } = laneColor(lane, kernels);
        return (
          <RailSegment key={seg.id} lane={lane} seg={seg} color={color} kernelName={kernel ? `${kernel.label} · ${kernel.name}` : null}
            current={lane.id === currentId} onFold={onFold} onRun={onRun} onDelete={onDelete} onKernel={onKernel} onTitle={onTitle} />
        );
      })}
      <button title="new section" onClick={onNewSection}
        style={{ position: 'absolute', bottom: 6, left: 0, right: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sk-text2)', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 18, lineHeight: 1, padding: '4px 0 4px 8px' }}>
        +
      </button>
    </div>
  );
}
