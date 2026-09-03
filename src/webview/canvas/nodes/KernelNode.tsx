/**
 * KernelNode — circular live-status widget for a Jupyter kernel.
 * Inner circle is the status LED (idle green / busy blink / dead grey / error red).
 * The ring between the circles is the drag-to-connect zone (React Flow source handle).
 * Right-click opens a kernel-only menu: restart / shutdown / add a bound code cell.
 */

import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { KernelNode } from '../../../shared/types';
import type { CanvasNode, CanvasEdge, MsgAddNodeResult } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE } from './nodeShared';
import { kernelColor } from '../palette';
import { useKernelState, LED_COLOR } from '../../hooks/useKernelState';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

function KernelNodeInner({ id, data }: NodeProps): JSX.Element {
  const node = data as unknown as KernelNode;
  const accent = kernelColor(node.colorIndex ?? 0);
  const state = useKernelState(node.server, node.kernelId);
  const led = LED_COLOR[state];
  const title = `${node.displayName ?? 'kernel'} :: ${node.kernelId ? node.kernelId.slice(0, 10) : '—'}`;

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    if (!menu) return;
    // - close on an outside mousedown only; clicks inside the menu must reach their onClick
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('mousedown', onDown, { capture: true });
    return () => window.removeEventListener('mousedown', onDown, { capture: true });
  }, [menu]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();   // - suppress the generic canvas context menu
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const start     = () => { vscodePostMessage({ type: 'kernelAction', action: 'start',     kernelNodeId: id }); closeMenu(); };
  const restart   = () => { vscodePostMessage({ type: 'kernelAction', action: 'restart',   kernelNodeId: id }); closeMenu(); };
  const interrupt = () => { vscodePostMessage({ type: 'kernelAction', action: 'interrupt', kernelNodeId: id }); closeMenu(); };
  const shutdown  = () => { vscodePostMessage({ type: 'kernelAction', action: 'shutdown',  kernelNodeId: id }); closeMenu(); };
  const addCodeCell = () => {
    const codeId = `code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newNode: CanvasNode = {
      id: codeId, type: 'code', code: '', language: 'python',
      x: Math.round(node.x + node.width + 60), y: Math.round(node.y), width: 360, height: 200,
    };
    const newEdge: CanvasEdge = {
      id: `${id}-${codeId}-${Date.now()}`,
      fromNode: id, fromSide: 'right', toNode: codeId, toSide: 'left', toEnd: 'arrow',
    };
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node: newNode, edge: newEdge, autoEdit: true } satisfies MsgAddNodeResult,
    }));
    closeMenu();
  };

  return (
    <>
      {/* - kernel label lives INSIDE the circle (below), not as the generic corner badge;
         - keep NodeLabelBadge only for the createdBy pill (label omitted) */}
      <NodeLabelBadge label={undefined} createdBy={(node as { createdBy?: string }).createdBy} />
      <div
        onContextMenu={onContextMenu}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', justifyContent: 'center', gap: 8 }}
      >
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
          {node.nodeLabel && (
            <div
              style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'monospace', fontSize: 20, fontWeight: 800, color: '#fff',
                textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none', userSelect: 'none',
              }}
            >{node.nodeLabel}</div>
          )}
        </div>
      </div>
      {menu && createPortal(
        /* - portal to body: React Flow's viewport transform would otherwise make
           position:fixed relative to the zoomed pane, offsetting the menu from the cursor */
        <div
          ref={menuRef}
          className="nodrag"
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000,
            background: 'var(--vscode-menu-background, #252526)',
            color: 'var(--vscode-menu-foreground, #ccc)',
            border: '1px solid var(--vscode-menu-border, rgba(255,255,255,0.15))',
            borderRadius: 6, padding: '4px 0', minWidth: 160, fontSize: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <KernelMenuItem label="Start kernel"     disabled={!!node.kernelId} onClick={start} />
          <KernelMenuItem label="Interrupt kernel" disabled={!node.kernelId} onClick={interrupt} />
          <KernelMenuItem label="Restart kernel"   disabled={!node.kernelId} onClick={restart} />
          <KernelMenuItem label="Shutdown kernel"  disabled={!node.kernelId} onClick={shutdown} />
          <div style={{ height: 1, background: 'var(--vscode-menu-separatorBackground, rgba(255,255,255,0.1))', margin: '4px 0' }} />
          <KernelMenuItem label="Add code cell" onClick={addCodeCell} />
        </div>,
        document.body,
      )}
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    </>
  );
}

function KernelMenuItem({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (!disabled) onClick(); }}
      style={{
        padding: '4px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: hover && !disabled ? 'var(--vscode-menu-selectionBackground, rgba(255,255,255,0.1))' : 'transparent',
      }}
    >{label}</div>
  );
}

export const KernelNodeComponent = memo(KernelNodeInner);
