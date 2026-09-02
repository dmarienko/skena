import React from 'react';
import { useStore } from '@xyflow/react';
import { LABEL_TEXT_COLOR, kernelColor } from './palette';
import type { DerivedLane } from '../../shared/sectionLanes';

/** - the header's fixed screen height; it NEVER scales with zoom */
export const HEADER_H = 26;
/** - gap kept between the header's bottom edge and the lane's topmost node */
export const HEADER_PAD = 8;
/** - fixed screen x, just right of the rail stripe: the lane spans the full width, so its header
 *    belongs at the lane's left edge — not wherever the leftmost node happens to sit. Fixed in screen
 *    space, so panning sideways never carries the title off screen. */
export const HEADER_LEFT = 22;

/**
 * Screen y of a lane's header. It sits at the lane's TOP BOUNDARY — the header labels the lane, so it
 * belongs to the boundary, not to whichever node happens to be topmost. The second term is a floor:
 * when zooming out shrinks the gap between the boundary and the first node below the header's own
 * height, the header lifts above the content instead of landing on it. So it reads as a section
 * heading at working zooms and still never covers a node at bird's-eye.
 */
export function laneHeaderTop(l: DerivedLane, ty: number, zoom: number): number {
  return Math.min(l.top * zoom + ty, l.contentTop * zoom + ty - HEADER_H - HEADER_PAD);
}

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
 * It sits at the lane's top boundary (see laneHeaderTop), which also floors it above the content, so
 * "fixed size", "always visible" and "never overlaps a node" all hold at once.
 */
export function SectionLaneHeaders({ lanes, onFold, onDelete }: {
  lanes: DerivedLane[];
  onFold: (id: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {lanes.map(l => {
        const top = laneHeaderTop(l, ty, zoom);
        const hasTitle = !!l.title?.trim();
        return (
          <div
            key={l.id}
            style={{
              position: 'absolute',
              left: HEADER_LEFT,
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
                <span style={{ width: 8, height: 8, borderRadius: 4, background: kernelColor(l.colorIndex ?? l.index) }} />
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
