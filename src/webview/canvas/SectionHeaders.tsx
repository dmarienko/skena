import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_RGB } from './palette';
import { GRID } from '../../shared/grid';

// - fixed screen height so the header never scales with zoom (spec: drawn in screen space)
const HEADER_H = 26;

/**
 * SectionHeaders — screen-space overlay drawing each section's zoom-steady header bar (fold · title ·
 * #S address · delete) in the filled top strip above the section's content. Positioned by the live
 * React Flow transform (like SectionBands / HelperLines) so it tracks the section but never scales.
 */
export function SectionHeaders({ onFold, onDelete }: {
  onFold: (id: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const nodes = useStore(s => s.nodes);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {nodes
        .filter(n => n.type === 'section')
        .map(s => {
          const d = s.data as { title?: string; nodeLabel?: string; folded?: boolean };
          // - the band fills one grid above the content; the header sits in that top strip
          const top = (s.position.y - GRID) * zoom + ty;
          const left = Math.max(s.position.x * zoom + tx, 0);
          return (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                left,
                top,
                height: HEADER_H,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 10px',
                pointerEvents: 'auto',
                color: 'var(--vscode-foreground)',
                fontFamily: 'var(--vscode-font-family)',
                fontSize: 12,
              }}
            >
              <button title={d.folded ? 'unfold section' : 'fold section'} onClick={() => onFold(s.id)} style={btn}>
                {d.folded ? '▸' : '▾'}
              </button>
              <span style={{ fontWeight: 600, opacity: 0.85, whiteSpace: 'nowrap' }}>{d.title ?? 'Section'}</span>
              <span style={{ opacity: 0.5, fontFamily: 'var(--vscode-editor-font-family)' }}>
                {d.nodeLabel ? `#${d.nodeLabel}` : ''}
              </span>
              <button title="delete section and its nodes" onClick={() => onDelete(s.id)} style={{ ...btn, opacity: 0.55 }}>
                ✕
              </button>
            </div>
          );
        })}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: `rgba(${SECTION_RGB}, 0.9)`,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: 2,
};
