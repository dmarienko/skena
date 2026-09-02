import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_RGB } from './palette';
import { GRID } from '../../shared/grid';
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
          // - top strip above the content holds the header and gives a filled margin; it is at least
          //   HEADER_H tall (so the fixed-height header always fits) or one grid, whichever is larger.
          //   When folded, the band collapses to just that strip (members are hidden).
          const folded = (s.data as { folded?: boolean }).folded;
          const contentTop = s.position.y * zoom + ty;
          const topPad = Math.max(GRID * zoom, HEADER_H);
          const top = contentTop - topPad;
          const height = folded ? topPad : topPad + Number(s.height ?? s.style?.height ?? 0) * zoom;
          if (height <= 0) return null;
          return (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top,
                height,
                boxSizing: 'border-box',
                background: `rgba(${SECTION_RGB}, 0.025)`,
                borderBottom: `1px solid rgba(${SECTION_RGB}, 0.3)`,  // - separates stacked sections
              }}
            />
          );
        })}
    </div>
  );
}
