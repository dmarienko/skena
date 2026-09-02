import React from 'react';
import { useStore } from '@xyflow/react';
import { SECTION_RGB } from './palette';
import { SECTION_HEADER_LANE } from '../../shared/sections';

// - the header content's own height; the strip it sits in is at least this tall (see the row height)
export const HEADER_H = 26;

const MONO = 'var(--vscode-editor-font-family), "IBM Plex Mono", monospace';

// - 'YYYY-MM-DD HH:MM' in local time; the default section label when there is no explicit title
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * SectionHeaders — screen-space overlay drawing each section's header bar (fold · title · #S address ·
 * delete), styled after the redesign mockup: monospace, weight-600 title, teal #S, muted controls. It
 * sits at the top of the section's reserved header lane and stays anchored to that canvas position
 * (scrolls with the content, not sticky), tracking the section via the live React Flow transform but
 * never scaling.
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
          const d = s.data as { title?: string; nodeLabel?: string; folded?: boolean; createdAt?: number };
          // - anchored to the section's header row; scrolls with the canvas. Row height matches the
          //   filled strip so the content sits centered in it (never thinner than the header itself).
          const top = s.position.y * zoom + ty;
          const rowH = Math.max(SECTION_HEADER_LANE * zoom, HEADER_H);
          const left = Math.max(s.position.x * zoom + tx, 0);
          const label = d.title?.trim()
            ? d.title
            : typeof d.createdAt === 'number'
              ? fmtDateTime(d.createdAt)
              : 'Section';
          return (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                left,
                top,
                height: rowH,
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
                {label}
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
