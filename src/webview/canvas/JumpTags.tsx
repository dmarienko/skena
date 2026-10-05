import React from 'react';
import { useStore } from '@xyflow/react';

/** - one tag: the node it leads to, its label, and the node's top-left corner in flow coordinates */
export interface JumpTag { id: string; label: string; x: number; y: number }
/** - the tags leader leader h/j/k/l put on screen, and the keys typed so far */
export interface ShownTags { tags: JumpTag[]; typed: string }

/**
 * The tags shown after leader leader h/j/k/l on the canvas: a pointer-transparent layer over the pane,
 * like EdgeFollowHints, with the flow coordinates projected through React Flow's transform. Each tag
 * sits on its node's top-left corner, moved just inside the pane when it would cross the pane's edge.
 * Once a first character is typed only the tags that start with it stay.
 */
export function JumpTags({ shown }: { shown: ShownTags | null }): JSX.Element | null {
  return shown === null ? null : <JumpTagLayer shown={shown} />;
}

/** - the layer itself; mounted only while tags are shown, so a pan re-renders nothing otherwise */
function JumpTagLayer({ shown }: { shown: ShownTags }): JSX.Element {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6, overflow: 'hidden' }}>
      {shown.tags.filter(t => t.label.startsWith(shown.typed)).map(t => (
        <div
          key={t.id}
          className="skena-jump-tag"
          style={{
            // - a tag is label.length characters of a monospace font plus 8px of padding wide and
            //   16px high (.skena-jump-tag in canvas.css); ch resolves against the tag's own font
            left: `clamp(0px, ${t.x * zoom + tx}px, calc(100% - ${t.label.length}ch - 8px))`,
            top: `clamp(0px, ${t.y * zoom + ty}px, calc(100% - 16px))`,
          }}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
