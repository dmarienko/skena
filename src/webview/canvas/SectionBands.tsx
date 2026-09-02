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
          // - the band spans the whole section (flow y=0 down); its own empty top strip holds the
          //   header, so nothing overhangs above the origin. When folded, it collapses to just that
          //   strip (members are hidden).
          const folded = (s.data as { folded?: boolean }).folded;
          const top = s.position.y * zoom + ty;
          const fullH = Number(s.height ?? s.style?.height ?? 0) * zoom;
          const height = folded ? Math.max(GRID * zoom, HEADER_H) : fullH;
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
