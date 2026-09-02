import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_RGB } from './palette';
import type { DerivedLane } from '../../shared/sectionLanes';

// - rail geometry, all in screen px
const RAIL_X = 8;
const RAIL_W = 4;
const RAIL_GAP = 6;       // - space between adjacent segments, so boundaries read from the rail alone
const RAIL_MIN_H = 24;    // - a segment never shrinks below this, whatever the zoom

/**
 * SectionLaneMarks — the only always-on section chrome: a coloured stripe at a fixed screen x marking
 * each lane, plus a hairline at each lane's bottom. There is deliberately NO background fill.
 *
 * The stripe is anchored in screen space on both axes: fixed horizontally (panning never moves it off
 * screen) and clipped to the viewport vertically, with a minimum height, so a lane that is on screen
 * always shows its marker at any zoom.
 */
export function SectionLaneMarks({ lanes, height }: { lanes: DerivedLane[]; height: number }): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {lanes.map(l => {
        const rawTop = l.top * zoom + ty;
        // - a folded lane collapses to a stub; the min-height rule below keeps its marker visible
        const rawBottom = l.folded ? rawTop : l.bottom * zoom + ty;
        if (height <= 0 || rawBottom < 0 || rawTop > height) return null;  // - entirely off screen

        // - clip to the viewport, then enforce the minimum height about the segment's centre
        let top = Math.max(rawTop, 0) + RAIL_GAP / 2;
        let bottom = Math.min(rawBottom, height) - RAIL_GAP / 2;
        if (bottom - top < RAIL_MIN_H) {
          const mid = (top + bottom) / 2;
          bottom = Math.min(mid + RAIL_MIN_H / 2, height);
          top = Math.max(bottom - RAIL_MIN_H, 0);
        }

        const drawBorder = rawBottom > 0 && rawBottom < height && rawBottom - rawTop >= 2;
        return (
          <React.Fragment key={l.id}>
            <div
              style={{
                position: 'absolute',
                left: RAIL_X,
                top,
                width: RAIL_W,
                height: bottom - top,
                borderRadius: RAIL_W / 2,
                background: `rgb(${SECTION_RGB})`,
              }}
            />
            {drawBorder && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: rawBottom,
                  height: 0,
                  borderBottom: `1px solid rgba(${SECTION_RGB}, 0.3)`,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
