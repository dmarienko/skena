/**
 * PortalNode — links to another .canvas file.
 * Click opens linked canvas in new VS Code tab. (Phase 6 stub)
 */

import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { PortalNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - strip path noise: remove leading ./ or ../ segments, then drop the .canvas extension
function canvasBasename(p: string): string {
  const name = p.replace(/^(\.\.?\/)+/, '').split('/').pop() ?? p;
  return name.endsWith('.canvas') ? name.slice(0, -7) : name;
}

export function PortalNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as PortalNode & { accentColor?: string };
  const borderColor = node.accentColor ?? '#53dfdd';

  const open = () => vscodePostMessage({ type: 'openFile', uri: node.canvas });

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
    <div
      style={{
        border:         `2px solid ${borderColor}`,
        height:         '100%',
        borderRadius:   '50%',              // - circle shape
        overflow:       'hidden',           // - clip content to circle
        background:     `${borderColor}12`,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        cursor:         'pointer',
        gap:            4,
        padding:        '12%',             // - keep text clear of the curved edges
      }}
      onClick={open}
    >
      <NodeResizer
        minWidth={80} minHeight={80}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      <span style={{ fontSize: 18, fontWeight: 600, opacity: 0.85, textAlign: 'center', wordBreak: 'break-word', lineHeight: 1.2 }}>
        {node.label ?? canvasBasename(node.canvas)}
      </span>
      <span style={{ fontSize: 11, opacity: 0.4, textAlign: 'center' }}>canvas</span>
    </div>
    </>
  );
}
