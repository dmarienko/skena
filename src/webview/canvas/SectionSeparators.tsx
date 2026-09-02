import React from 'react';
import { useStore } from '@xyflow/react';
import type { DerivedLane } from '../../shared/sectionLanes';

/** The 1px line at each section's bottom — the only section drawing left inside the flow. */
export function SectionSeparators({ lanes }: { lanes: DerivedLane[] }): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const height = useStore(s => s.height);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {lanes.map((l, i) => {
        if (i === lanes.length - 1) return null;   // - the last lane is unbounded: no line below it
        const y = l.bottom * zoom + ty;
        if (height <= 0 || y < 0 || y > height) return null;
        // - centred on the boundary, like the rail's gap
        return <div key={l.id} style={{ position: 'absolute', left: 0, right: 0, top: y - 0.5, height: 0, borderBottom: '1px solid var(--sk-border)' }} />;
      })}
    </div>
  );
}
