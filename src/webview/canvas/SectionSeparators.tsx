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

/**
 * The 1px line at each section's bottom, and the title and node count a folded section shows in its
 * band. `lanes` are where the sections are drawn, so a band is at least 34 px tall (displayOffset.ts).
 * The text is drawn at a fixed screen size; a line the band is too short for at this zoom is not
 * drawn. A click on the title unfolds the section. A band selected as the focus is framed in the
 * colour of a focused node's ring.
 */
export function SectionSeparators({ lanes, kernels, selectedBandId, onUnfold }: { lanes: DerivedLane[]; kernels: RailKernel[]; selectedBandId: string | null; onUnfold: (id: string) => void }): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const height = useStore(s => s.height);
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        {lanes.map(l => {
          // - a bounded lane ends where the next begins; the last lane's bottom is its content bottom +
          //   LANE_BOTTOM_PAD (one grid when folded)
          const y = l.bottom * zoom + ty;
          if (height <= 0 || y < 0 || y > height) return null;
          // - centred on the boundary, like the rail's gap
          return <div key={l.id} style={{ position: 'absolute', left: 0, right: 0, top: y - 0.5, height: 0, borderBottom: '1px solid var(--sk-border)' }} />;
        })}
      </div>
      {/* - above React Flow's renderer (z-index 4, earlier in the DOM), so the title takes a click before the
          pane does; a folded band hides its members, so nothing of theirs is under it */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
        {lanes.map(l => {
          // - a folded lane hides its members, so the band is the only place they are accounted for
          if (!l.folded) return null;
          const top = l.top * zoom + ty;
          const h = (l.bottom - l.top) * zoom;
          if (height <= 0 || top + h < 0 || top > height) return null;
          const { color, kernel } = laneColor(l, kernels);
          return <FoldedBand key={`${l.id}-band`} lane={l} top={top} h={h} color={color} kernel={kernel} selected={l.id === selectedBandId} onUnfold={onUnfold} />;
        })}
      </div>
    </>
  );
}

function FoldedBand({ lane, top, h, color, kernel, selected, onUnfold }: {
  lane: DerivedLane;
  top: number;
  h: number;
  color: string;
  kernel: RailKernel | null;
  selected: boolean;
  onUnfold: (id: string) => void;
}): JSX.Element {
  // - the hook is unconditional (rules of hooks); an unbound section passes a server no status ever matches
  const state = useKernelState(kernel?.server ?? '', kernel?.kernelId);
  const { head, kernel: kname } = sectionTitleParts(lane, kernelDisplayName(kernel));
  return (
    <div data-sk-band={lane.id} data-selected={selected ? '1' : undefined}
      style={{ position: 'absolute', left: 0, right: 0, top, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: META_GAP, overflow: 'hidden',
        boxShadow: selected ? 'inset 0 0 0 3px var(--skena-focus-ring)' : undefined }}>
      {h >= TITLE_LINE && (
        // - the band itself lets the pane under it pan and select; only the title takes the click
        <div data-sk-title={lane.id} title="unfold section" onClick={() => onUnfold(lane.id)}
          style={{ fontFamily: FONT, fontWeight: 600, fontSize: TITLE_PX, lineHeight: `${TITLE_LINE}px`, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%', pointerEvents: 'auto', cursor: 'pointer' }}>
          {head}
          {kname && <span data-sk-kernel-state={state} style={{ color: KERNEL_TEXT_COLOR[state], fontWeight: 400 }}> · {kname}</span>}
        </div>
      )}
      {h >= TITLE_LINE + META_GAP + META_LINE && (
        <div style={{ fontFamily: FONT, fontSize: META_PX, lineHeight: `${META_LINE}px`, color: 'var(--sk-text2)', whiteSpace: 'nowrap', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {`${lane.memberIds.length} nodes`}
        </div>
      )}
    </div>
  );
}
