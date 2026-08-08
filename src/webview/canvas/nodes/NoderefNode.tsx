/**
 * NoderefNode — a diamond that references a labelled node in another canvas.
 * Click or Enter opens that canvas and focuses the node (host resolves canvas#label).
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { NoderefNode } from '../../../shared/types';
import { formatNodeRef } from '../../../shared/nodeRef';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - strip path noise: remove leading ./ or ../ segments, then drop the .canvas extension
function canvasBasename(p: string): string {
  const name = p.replace(/^(\.\.?\/)+/, '').split('/').pop() ?? p;
  return name.endsWith('.canvas') ? name.slice(0, -7) : name;
}

export function NoderefNodeComponent({ id, data, selected }: NodeProps): JSX.Element {
  const node = data as unknown as NoderefNode & { accentColor?: string };
  const borderColor = node.accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE.noderef;
  const base = canvasBasename(node.canvas);
  const ref = useRef<HTMLDivElement | null>(null);

  const open = useCallback(() => {
    vscodePostMessage({ type: 'openFile', uri: formatNodeRef(node.canvas, node.label) });
  }, [node.canvas, node.label]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); open(); } };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={node.createdBy} />
      <div
        ref={ref}
        tabIndex={0}
        onDoubleClick={open}
        onClick={open}
        title={`Open ${node.canvas} → ${node.label}`}
        style={{
          position:       'relative',
          width:          '100%',
          height:         '100%',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          outline:        'none',
          cursor:         'pointer',
        }}
      >
        <div style={{
          position:     'absolute',
          inset:        0,
          transform:    'rotate(45deg)',
          borderRadius: 8,
          border:       `2px solid ${borderColor}`,
          background:   'var(--vscode-editorWidget-background, #202020)',
          boxShadow:    selected ? `0 0 0 2px ${borderColor}` : '0 2px 8px rgba(0,0,0,0.45)',
        }} />
        <div style={{ position: 'relative', textAlign: 'center', padding: 6, pointerEvents: 'none' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{base} › {node.label}</div>
          {node.title && (
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
