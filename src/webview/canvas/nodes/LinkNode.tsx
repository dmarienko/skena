/**
 * LinkNode — external URL node.
 * Shows favicon + URL. Click opens in VS Code HTML browser.
 */

import React from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { LinkNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?sz=32&domain=${u.hostname}`;
  } catch {
    return '';
  }
}

function getHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function LinkNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as LinkNode & { accentColor?: string };
  const borderColor = node.accentColor ?? '#454545';
  const favicon = getFaviconUrl(node.url);

  const open = () => vscodePostMessage({ type: 'openFile', uri: node.url });

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} />
    <div
      className="skena-node" style={{ border: `1.5px solid ${borderColor}`, height: '100%', borderRadius: 6, overflow: 'hidden', background: 'var(--vscode-editorWidget-background)', padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
      onClick={open}
    >
      <NodeResizer
        minWidth={100} minHeight={60}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {favicon && <img src={favicon} alt="" width={16} height={16} style={{ flexShrink: 0 }} />}
        <span style={{ fontSize: 11, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getHostname(node.url)}
        </span>
      </div>
      <div style={{ fontSize: 12, wordBreak: 'break-all', opacity: 0.85 }}>{node.url}</div>
    </div>
    </>
  );
}
