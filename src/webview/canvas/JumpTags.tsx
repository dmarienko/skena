import React from 'react';
import { useStore } from '@xyflow/react';

/** - one tag: the node it leads to, its label, and the node's top-left corner in flow coordinates */
export interface JumpTag { id: string; label: string; x: number; y: number }
/** - the tags leader leader h/j/k/l put on screen, and the keys typed so far */
export interface ShownTags { tags: JumpTag[]; typed: string }

/**
 * The tags shown after leader leader h/j/k/l on the canvas: a pointer-transparent layer over the pane,
 * like EdgeFollowHints, with the flow coordinates projected through React Flow's transform. Each tag
 * sits on its node's top-left corner, moved inside the pane when that corner is off screen. Once a
 * first character is typed only the tags that start with it stay.
 */
export function JumpTags({ shown }: { shown: ShownTags | null }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (shown === null) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6, overflow: 'hidden' }}>
      {shown.tags.filter(t => t.label.startsWith(shown.typed)).map(t => (
        <div
          key={t.id}
          className="skena-jump-tag"
          style={{ left: Math.max(0, t.x * zoom + tx), top: Math.max(0, t.y * zoom + ty) }}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
