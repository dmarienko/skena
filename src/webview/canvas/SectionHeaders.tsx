import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_RGB } from './palette';

// - fixed screen height so the header never scales with zoom (spec: drawn in screen space)
export const HEADER_H = 26;

const MONO = 'var(--vscode-editor-font-family), "IBM Plex Mono", monospace';

/**
 * SectionHeaders — screen-space overlay drawing each section's zoom-steady header bar (fold · title ·
 * #S address · delete), styled after the redesign mockup: monospace, weight-600 title, teal #S, muted
 * controls. Sits directly above the section's content (never overlaps the nodes) and tracks the
 * section via the live React Flow transform, but never scales.
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
          // - anchor the header directly ABOVE the content (fixed height): never overlaps the nodes
          const top = s.position.y * zoom + ty - HEADER_H;
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
                gap: 9,
                padding: '0 12px',
                pointerEvents: 'auto',
                fontFamily: MONO,
              }}
            >
              <button
                title={d.folded ? 'unfold section' : 'fold section'}
                onClick={() => onFold(s.id)}
                style={{ ...ctl, width: 10, textAlign: 'center' }}
              >
                {d.folded ? '▸' : '⌄'}
              </button>
              <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--vscode-foreground)', whiteSpace: 'nowrap' }}>
                {d.title ?? 'Section'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: `rgba(${SECTION_RGB}, 0.9)` }}>
                {d.nodeLabel ? `#${d.nodeLabel}` : ''}
              </span>
              <button title="delete section and its nodes" onClick={() => onDelete(s.id)} style={{ ...ctl, marginLeft: 4 }}>
                ✕
              </button>
            </div>
          );
        })}
    </div>
  );
}

const ctl: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-descriptionForeground)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
};
