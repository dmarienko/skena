import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_RGB } from './palette';
import { SECTION_HEADER_LANE } from '../../shared/sections';
import { HEADER_H } from './SectionHeaders';

/**
 * SectionBands — screen-space overlay that draws each section as a full-viewport-width horizontal
 * lane at its flow y-range. It always spans the whole view horizontally (open on the right by
 * construction) and tracks its section vertically via the live React Flow transform (same technique
 * as HelperLines). Very transparent; no pointer events. The section flow node renders nothing.
 */
export function SectionBands(): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const nodes = useStore(s => s.nodes);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {nodes
        .filter(n => n.type === 'section')
        .map(s => {
          // - two bands per section: a faint body over the whole section, and a distinctly-filled
          //   header strip over the reserved top lane. The strip height is EXACTLY the lane in screen
          //   space, so the topmost node (at section.y + lane) sits precisely at the strip's bottom edge
          //   — never under it, at any zoom. Folded → just the strip.
          const folded = (s.data as { folded?: boolean }).folded;
          const top = s.position.y * zoom + ty;
          const fullH = Number(s.height ?? s.style?.height ?? 0) * zoom;
          const stripH = SECTION_HEADER_LANE * zoom;
          // - at bird's-eye the strip is thinner than the header (title is hidden then): drop the filled
          //   header strip and ALL divider lines so no stray line cuts across the tiny nodes. Just the
          //   faint band remains, marking the section without clutter.
          const birdsEye = stripH < HEADER_H;
          const bodyH = folded ? stripH : fullH;
          if (bodyH <= 0) return null;
          return (
            <React.Fragment key={s.id}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top,
                  height: bodyH,
                  boxSizing: 'border-box',
                  background: `rgba(${SECTION_RGB}, 0.025)`,
                  borderBottom: birdsEye ? 'none' : `1px solid rgba(${SECTION_RGB}, 0.3)`, // - separates stacked sections
                }}
              />
              {!birdsEye && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top,
                    height: stripH,
                    boxSizing: 'border-box',
                    background: `rgba(${SECTION_RGB}, 0.08)`,             // - filled header lane
                    borderBottom: `1px solid rgba(${SECTION_RGB}, 0.35)`, // - divider under the header
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
    </div>
  );
}
