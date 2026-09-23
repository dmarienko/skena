/**
 * NoderefNode — a diamond that references a labelled node in another canvas.
 * Click (or Enter while focused — handled centrally in CanvasView) opens that canvas
 * and focuses the referenced node. The host resolves canvas#label.
 */

import React, { useCallback } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import { NoderefNode } from '../../../shared/types';
import { formatNodeRef } from '../../../shared/nodeRef';
import { HANDLE_STYLE } from './nodeShared';
import { nodeBorderColor } from '../palette';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - strip path noise: remove leading ./ or ../ segments, then drop the .canvas extension
function canvasBasename(p: string): string {
  const name = p.replace(/^(\.\.?\/)+/, '').split('/').pop() ?? p;
  return name.endsWith('.canvas') ? name.slice(0, -7) : name;
}

export function NoderefNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as NoderefNode & { accentColor?: string };
  const borderColor = nodeBorderColor('noderef', node.accentColor);
  const base = canvasBasename(node.canvas);

  const open = useCallback(() => {
    vscodePostMessage({ type: 'openFile', uri: formatNodeRef(node.canvas, node.label) });
  }, [node.canvas, node.label]);

  return (
    <>
      <div
        onClick={open}
        onDoubleClick={open}
        title={`Open ${node.canvas} → ${node.label}`}
        style={{ position: 'relative', width: '100%', height: '100%', cursor: 'pointer' }}
      >
        {/* - a diamond that fills the node box at any aspect ratio; non-scaling stroke keeps the
           - border an even width despite the non-uniform viewBox stretch */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible',
            // - glow the diamond outline when selected (a box-outline can't follow the diamond)
            filter: selected ? `drop-shadow(0 0 5px ${borderColor})` : 'none',
          }}
        >
          <polygon
            points="50,1 99,50 50,99 1,50"
            fill="var(--vscode-editorWidget-background, #202020)"
            stroke={borderColor}
            strokeWidth={selected ? 4.5 : 2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* - label sits at the vertical middle — the widest part of the diamond; horizontal
           - padding keeps it clear of the left/right points */}
        <div style={{
          position:       'absolute',
          inset:          0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          textAlign:      'center',
          padding:        '0 18px',
          pointerEvents:  'none',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{base} › {node.label}</div>
            {node.title && (
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</div>
            )}
          </div>
        </div>
      </div>
      <NodeResizer
        minWidth={120} minHeight={80}
        isVisible={selected}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
