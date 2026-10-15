import React from 'react';
import { useStore } from '@xyflow/react';
import type { DerivedLane } from '../../shared/sectionLanes';
import { laneColor, type RailKernel } from '../rail/SectionRail';
import { sectionTitleParts, kernelDisplayName } from '../rail/sectionTitle';
import { useKernelState, KERNEL_TEXT_COLOR } from '../hooks/useKernelState';

const FONT = 'system-ui, -apple-system, sans-serif';
// - screen px at every zoom; the line boxes are what a band must hold to show each line
const TITLE_PX = 12;
const TITLE_LINE = 15;
const META_PX = 10.5;
const META_LINE = 13;
const META_GAP = 3;
const OPEN_TOP = 4;   // - an open section's title sits this far under its band's top

/**
 * The 1px line at each section's bottom, and each section's title: at the top of an open section's
 * band, centred in a folded one's with its node count. Titles are drawn at a fixed screen size; one
 * whose band is too short for it at this zoom is not drawn. A band selected as the focus is framed
 * in the colour of a focused node's ring.
 */
export function SectionSeparators({ lanes, kernels, selectedBandId }: { lanes: DerivedLane[]; kernels: RailKernel[]; selectedBandId: string | null }): JSX.Element {
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
        const top = l.top * zoom + ty;
        const h = (l.bottom - l.top) * zoom;
        if (height <= 0 || top + h < 0 || top > height) return null;
        const { color, kernel } = laneColor(l, kernels);
        return <SectionTitle key={`${l.id}-band`} lane={l} top={top} h={h} color={color} kernel={kernel} selected={l.id === selectedBandId} />;
      })}
    </div>
  );
}

function SectionTitle({ lane, top, h, color, kernel, selected }: {
  lane: DerivedLane;
  top: number;
  h: number;
  color: string;
  kernel: RailKernel | null;
  selected: boolean;
}): JSX.Element | null {
  // - the hook is unconditional (rules of hooks); an unbound section passes a server no status ever matches
  const state = useKernelState(kernel?.server ?? '', kernel?.kernelId);
  const { head, kernel: kname } = sectionTitleParts(lane, kernelDisplayName(kernel));
  const line = (
    <div data-sk-title={lane.id} style={{ fontFamily: FONT, fontWeight: 600, fontSize: TITLE_PX, lineHeight: `${TITLE_LINE}px`, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: lane.folded ? '70%' : 'calc(100% - 20px)' }}>
      {head}
      {kname && <span data-sk-kernel-state={state} style={{ color: KERNEL_TEXT_COLOR[state], fontWeight: 400 }}> · {kname}</span>}
    </div>
  );
  if (!lane.folded) {
    if (h < OPEN_TOP + TITLE_LINE) return null;
    return <div style={{ position: 'absolute', left: 10, right: 0, top: top + OPEN_TOP }}>{line}</div>;
  }
  // - a folded lane hides its members, so the band is the only place they are accounted for
  return (
    <div data-sk-band={lane.id} data-selected={selected ? '1' : undefined}
      style={{ position: 'absolute', left: 0, right: 0, top, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: META_GAP, overflow: 'hidden',
        boxShadow: selected ? 'inset 0 0 0 3px var(--skena-focus-ring)' : undefined }}>
      {h >= TITLE_LINE && line}
      {h >= TITLE_LINE + META_GAP + META_LINE && (
        <div style={{ fontFamily: FONT, fontSize: META_PX, lineHeight: `${META_LINE}px`, color: 'var(--sk-text2)', whiteSpace: 'nowrap', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {`${lane.memberIds.length} nodes`}
        </div>
      )}
    </div>
  );
}
