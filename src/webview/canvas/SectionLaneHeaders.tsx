import React from 'react';
import { useStore } from '@xyflow/react';
import { LABEL_TEXT_COLOR, SECTION_RGB } from './palette';
import type { DerivedLane } from '../../shared/sectionLanes';

/** - the header's fixed screen height; it NEVER scales with zoom */
export const HEADER_H = 26;
/** - gap between the header's bottom edge and the lane's topmost node */
export const HEADER_PAD = 8;

const MONO = 'var(--vscode-editor-font-family), "IBM Plex Mono", monospace';

// - 'YYYY-MM-DD HH:MM' in local time; the header's label when a lane has no title
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * SectionLaneHeaders — one fixed-size header per lane: fold · `S1:` · title · time · kernel · delete.
 *
 * The header is drawn in screen space at a constant size, so it neither scales nor hides at any zoom.
 * Its BOTTOM edge is anchored HEADER_PAD above the lane's topmost node, so it cannot cover that node
 * however far you zoom out — it is bounded by nothing, which is what makes all three of "fixed size",
 * "always visible" and "never overlaps a node" hold at once.
 */
export function SectionLaneHeaders({ lanes, onFold, onDelete }: {
  lanes: DerivedLane[];
  onFold: (id: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {lanes.map(l => {
        const top = l.contentTop * zoom + ty - HEADER_H - HEADER_PAD;
        const left = Math.max(l.contentLeft * zoom + tx, 0);
        const hasTitle = !!l.title?.trim();
        return (
          <div
            key={l.id}
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
              whiteSpace: 'nowrap',
            }}
          >
            <button
              title={l.folded ? 'unfold section' : 'fold section'}
              onClick={() => onFold(l.id)}
              style={{ ...ctl, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {/* - a real 16px icon at full foreground contrast, not a text glyph */}
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ display: 'block', transform: l.folded ? 'rotate(-90deg)' : 'none', transition: 'transform 130ms ease' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: LABEL_TEXT_COLOR }}>
              {l.label}:
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--vscode-foreground)' }}>
              {hasTitle ? l.title : fmtDateTime(l.createdAt)}
            </span>
            {hasTitle && (
              <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                {fmtDateTime(l.createdAt)}
              </span>
            )}
            {l.kernelId && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10,
                color: 'var(--vscode-descriptionForeground)',
                border: '1px solid var(--vscode-panel-border)', borderRadius: 999, padding: '2px 8px',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: `rgb(${SECTION_RGB})` }} />
                {l.kernelId}
              </span>
            )}
            <button title="delete section and its nodes" onClick={() => onDelete(l.id)} style={{ ...ctl, fontSize: 11 }}>
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
  color: 'var(--vscode-foreground)',
  cursor: 'pointer',
  lineHeight: 1,
  padding: 0,
};
