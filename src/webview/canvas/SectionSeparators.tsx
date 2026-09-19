import React from 'react';
import { useStore } from '@xyflow/react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { laneColor, type RailKernel } from '../rail/SectionRail';
import { fmtDateTime } from '../rail/RailSegment';

const FONT = 'system-ui, -apple-system, sans-serif';

/** The 1px line at each section's bottom, and the title a folded section shows in its band. */
export function SectionSeparators({ lanes, kernels, focusableCounts }: { lanes: DerivedLane[]; kernels: RailKernel[]; focusableCounts: Map<string, number> }): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const height = useStore(s => s.height);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {lanes.map(l => {
        // - a bounded lane ends where the next begins; the last lane's bottom is its content bottom +
        //   LANE_BOTTOM_PAD (one grid when folded)
        const y = l.bottom * zoom + ty;
        if (height <= 0 || y < 0 || y > height) return null;
        // - centred on the boundary, like the rail's gap
        return <div key={l.id} style={{ position: 'absolute', left: 0, right: 0, top: y - 0.5, height: 0, borderBottom: '1px solid var(--sk-border)' }} />;
      })}
      {lanes.map(l => {
        // - a folded lane hides its members, so the band is the only place they are accounted for
        if (!l.folded) return null;
        const top = l.top * zoom + ty;
        const h = (l.bottom - l.top) * zoom;
        if (height <= 0 || top + h < 0 || top > height) return null;
        const { color, kernel } = laneColor(l, kernels);
        // - the kernel's own name, not the rail's status line: a record's display name is its label,
        //   a kernel node's is its name
        const kernelName = kernel ? (kernel.kind === 'record' ? kernel.label : kernel.name) : null;
        // - the count of nodes a pick can actually focus: memberIds also holds band (group) nodes
        const count = `${focusableCounts.get(l.id) ?? 0} nodes`;
        // - flow-space text: it scales with the canvas, so it keeps its place in the band at any zoom
        return (
          <div key={`${l.id}-band`}
            style={{ position: 'absolute', left: 0, right: 0, top, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 * zoom, overflow: 'hidden' }}>
            <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12 * zoom, color, whiteSpace: 'nowrap', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {l.title?.trim() || fmtDateTime(l.createdAt)}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 10.5 * zoom, color: 'var(--sk-text2)', whiteSpace: 'nowrap', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {kernelName ? `${count} · ${kernelName}` : count}
            </div>
          </div>
        );
      })}
    </div>
  );
}
