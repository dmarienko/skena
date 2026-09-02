import React from 'react';
import { useStore } from '@xyflow/react';
import { LABEL_TEXT_COLOR, kernelColor } from './palette';
import { laneIndexForY, type DerivedLane } from '../../shared/sectionLanes';

/** - the bar's fixed height; the canvas area starts below it, so it can never cover a node */
export const STICKY_H = 28;

const MONO = 'var(--vscode-editor-font-family), "IBM Plex Mono", monospace';

// - 'YYYY-MM-DD HH:MM' in local time; shown when a lane has no title of its own
function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * SectionStickyHeader — the section title, pinned to the top of the panel.
 *
 * It is a strip ABOVE the canvas area, not an overlay on it, so no node can ever sit under it at any
 * zoom. Because it lives outside the canvas coordinate space entirely, the title needs no reserved
 * band in the canvas and imposes no zoom floor.
 *
 * It shows the lane owning the top edge of the viewport and swaps as you pan, the way a sticky list
 * header does. The per-lane colour rail still marks every other section in place.
 */
export function SectionStickyHeader({ lanes, onFold, onDelete }: {
  lanes: DerivedLane[];
  onFold: (id: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element | null {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (lanes.length === 0) return null;

  // - flow y at the top edge of the canvas area = the lane you are currently inside
  const current = lanes[laneIndexForY(lanes, -ty / zoom)];
  const hasTitle = !!current.title?.trim();
  const color = kernelColor(current.colorIndex ?? current.index);

  return (
    <div
      style={{
        height: STICKY_H,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '0 12px',
        fontFamily: MONO,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        background: 'var(--vscode-editor-background)',
        borderBottom: '1px solid var(--vscode-panel-border)',
        borderLeft: `4px solid ${color}`,   // - ties the bar to this lane's rail colour
        boxSizing: 'border-box',
      }}
    >
      <button
        title={current.folded ? 'unfold section' : 'fold section'}
        onClick={() => onFold(current.id)}
        style={{ ...ctl, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ display: 'block', transform: current.folded ? 'rotate(-90deg)' : 'none', transition: 'transform 130ms ease' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: LABEL_TEXT_COLOR }}>
        {current.label}:
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--vscode-foreground)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {hasTitle ? current.title : fmtDateTime(current.createdAt)}
      </span>
      {hasTitle && (
        <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
          {fmtDateTime(current.createdAt)}
        </span>
      )}
      {current.kernelId && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10,
          color: 'var(--vscode-descriptionForeground)',
          border: '1px solid var(--vscode-panel-border)', borderRadius: 999, padding: '2px 8px',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
          {current.kernelId}
        </span>
      )}
      {/* - count sits at the far right so the bar reads as "where am I, of how many" */}
      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
        {current.index + 1}/{lanes.length}
      </span>
      <button title="delete section and its nodes" onClick={() => onDelete(current.id)} style={{ ...ctl, fontSize: 11 }}>
        ✕
      </button>
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
