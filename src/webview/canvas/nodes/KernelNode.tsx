/**
 * KernelNode — circular live-status widget for a Jupyter kernel.
 * Inner circle is the status LED (idle green / busy blink / dead grey / error red).
 * The ring between the circles is the drag-to-connect zone (React Flow source handle).
 */

import React, { useEffect, useState, memo } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { KernelNode } from '../../../shared/types';
import type { KernelStatusEntry } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE } from './nodeShared';
import { kernelColor } from '../palette';

type LedState = KernelStatusEntry['state'];

function useKernelState(server: string, kernelId?: string): LedState {
  const [state, setState] = useState<LedState>('dead');
  useEffect(() => {
    const onStatus = (e: Event) => {
      const kernels = (e as CustomEvent).detail as KernelStatusEntry[];
      const hit = kernels.find(k => k.server === server && (kernelId ? k.kernelId === kernelId : true));
      setState(hit ? hit.state : 'dead');
    };
    window.addEventListener('skena:kernelStatus', onStatus);
    return () => window.removeEventListener('skena:kernelStatus', onStatus);
  }, [server, kernelId]);
  return state;
}

const LED_COLOR: Record<LedState, string> = {
  idle:  '#3fbf6f',
  busy:  '#3fbf6f',
  dead:  '#6b7280',
  error: '#e5484d',
};

function KernelNodeInner({ data }: NodeProps): JSX.Element {
  const node = data as unknown as KernelNode;
  const accent = kernelColor(node.colorIndex ?? 0);
  const state = useKernelState(node.server, node.kernelId);
  const led = LED_COLOR[state];
  const title = `${node.displayName ?? 'kernel'} :: ${node.kernelId ? node.kernelId.slice(0, 10) : '—'}`;

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', justifyContent: 'center', gap: 8 }}>
        <div style={{ color: accent, fontSize: 12, fontFamily: 'var(--vscode-editor-font-family)', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ position: 'relative', width: 72, height: 72 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${accent}` }} />
          <div
            className={state === 'busy' ? 'skena-kernel-busy' : undefined}
            style={{
              position: 'absolute', inset: 22, borderRadius: '50%',
              background: led,
              boxShadow: state === 'error' ? `0 0 6px ${led}` : 'none',
            }}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    </>
  );
}

export const KernelNodeComponent = memo(KernelNodeInner);
