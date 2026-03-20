/**
 * ChatNode — AI agent chat terminal embedded in the canvas (Phase 5 stub).
 */

import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { ChatNode } from '../../../shared/types';

export function ChatNodeComponent({ data }: NodeProps): JSX.Element {
  const node = data as unknown as ChatNode & { accentColor?: string };
  const borderColor = node.accentColor ?? '#a882ff';

  return (
    <div className="skena-node" style={{ border: `1.5px solid ${borderColor}`, height: '100%', borderRadius: 6, overflow: 'hidden', background: 'var(--vscode-editorWidget-background)', display: 'flex', flexDirection: 'column' }}>
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${borderColor}40`, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85 }}>
        <span>💬</span>
        <span>{node.title}</span>
        <span style={{ marginLeft: 'auto', opacity: 0.5, fontWeight: 400 }}>{node.agent} {node.model ? `· ${node.model}` : ''}</span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12 }}>
        AI chat — Phase 5
      </div>
    </div>
  );
}
