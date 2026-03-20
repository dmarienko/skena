/**
 * PortalNode — links to another .canvas file.
 * Click opens linked canvas in new VS Code tab. (Phase 6 stub)
 */

import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { PortalNode } from '../../../shared/types';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

export function PortalNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as PortalNode & { accentColor?: string };
  const borderColor = node.accentColor ?? '#53dfdd';

  const open = () => vscodePostMessage({ type: 'openFile', uri: node.canvas });

  return (
    <div
      style={{ border: `2px dashed ${borderColor}`, height: '100%', borderRadius: 8, overflow: 'hidden', background: `${borderColor}0a`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 6 }}
      onClick={open}
    >
      <NodeResizer
        minWidth={100} minHeight={80}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      <span style={{ fontSize: 22, opacity: 0.7 }}>🔮</span>
      <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>{node.label ?? node.canvas}</span>
      <span style={{ fontSize: 10, opacity: 0.4 }}>click to open canvas</span>
    </div>
  );
}
