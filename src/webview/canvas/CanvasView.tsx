/**
 * CanvasView — React Flow setup.
 * Converts CanvasData (JSON Canvas spec) to React Flow nodes + edges,
 * handles user interactions (drag, connect, delete) and saves back to host.
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Node,
  Edge,
  Connection,
  ConnectionMode,
  OnConnectEnd,
  NodeChange,
  NodePositionChange,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  NodeTypes,
  EdgeTypes,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { CanvasData, CanvasNode, CanvasEdge } from '../../shared/types';
import { CANVAS_COLORS } from '../../shared/constants';

import { FileNodeComponent }  from './nodes/FileNode';
import { TextNodeComponent }  from './nodes/TextNode';
import { GroupNodeComponent } from './nodes/GroupNode';
import { LinkNodeComponent }  from './nodes/LinkNode';
import { CellNodeComponent }  from './nodes/CellNode';
import { ChatNodeComponent }  from './nodes/ChatNode';
import { PortalNodeComponent } from './nodes/PortalNode';
import { LabeledEdgeComponent } from './edges/LabeledEdge';
import { HelperLines } from './HelperLines';

const NODE_TYPES: NodeTypes = {
  file:   FileNodeComponent,
  text:   TextNodeComponent,
  group:  GroupNodeComponent,
  link:   LinkNodeComponent,
  cell:   CellNodeComponent,
  chat:   ChatNodeComponent,
  portal: PortalNodeComponent,
};

const EDGE_TYPES: EdgeTypes = {
  labeled: LabeledEdgeComponent,
};

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - convert JSON Canvas color code to hex
function resolveColor(code?: string): string | undefined {
  if (!code) return undefined;
  return CANVAS_COLORS[code] ?? code;
}

// - canvas node → React Flow node
function toFlowNode(cn: CanvasNode): Node {
  return {
    id:       cn.id,
    type:     cn.type,
    position: { x: cn.x, y: cn.y },
    style:    { width: cn.width, height: cn.height },
    data:     { ...cn, accentColor: resolveColor(cn.color) },
    // - groups are non-interactive drag targets (they expand to contain nodes visually)
    draggable:   cn.type !== 'group',
    selectable:  true,
    deletable:   true,
    zIndex:      cn.type === 'group' ? -1 : 0,
  };
}

// - default edge color — visible on both dark and light VS Code themes
const DEFAULT_EDGE_COLOR = '#888888';

// - canvas edge → React Flow edge
function toFlowEdge(ce: CanvasEdge): Edge {
  const stroke = resolveColor(ce.color) ?? DEFAULT_EDGE_COLOR;
  return {
    id:           ce.id,
    source:       ce.fromNode,
    sourceHandle: ce.fromSide,
    target:       ce.toNode,
    targetHandle: ce.toSide,
    type:         'labeled',
    label:        ce.label,
    style:        { stroke, strokeWidth: 1.5 },
    markerEnd:    ce.toEnd === 'arrow' || !ce.toEnd
      ? { type: MarkerType.ArrowClosed, color: stroke }
      : undefined,
    data:         { label: ce.label },
  };
}

// - React Flow node → updated canvas node (position/size changed)
function patchCanvasNode(original: CanvasNode, rfNode: Node): CanvasNode {
  return {
    ...original,
    x:      Math.round(rfNode.position.x),
    y:      Math.round(rfNode.position.y),
    width:  Math.round(Number(rfNode.style?.width ?? original.width)),
    height: Math.round(Number(rfNode.style?.height ?? original.height)),
  };
}

// ─── alignment guide helpers ──────────────────────────────────────────────────

const GRID = 8; // - manual grid snap (replaces ReactFlow snapToGrid)

function snapGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

type HelperLinesState = { horizontal?: number; vertical?: number };

/**
 * For the node being dragged, compare its six anchors (top/center/bottom,
 * left/center/right) against the same anchors of every other node.
 * Returns the closest matching guide line and the snapped origin position.
 */
function getHelperLines(
  change: NodePositionChange,
  nodes:  Node[],
  threshold = 16,
): { horizontal?: number; vertical?: number; snapX?: number; snapY?: number } {
  const node = nodes.find(n => n.id === change.id);
  if (!node || !change.position) return {};

  const w = node.measured?.width  ?? Number(node.style?.width  ?? 200);
  const h = node.measured?.height ?? Number(node.style?.height ?? 150);
  const { x, y } = change.position;

  let horizontal: number | undefined;
  let vertical:   number | undefined;
  let snapX:      number | undefined;
  let snapY:      number | undefined;

  for (const other of nodes) {
    if (other.id === node.id || other.type === 'group') continue;

    const ow = other.measured?.width  ?? Number(other.style?.width  ?? 200);
    const oh = other.measured?.height ?? Number(other.style?.height ?? 150);
    const ox = other.position.x;
    const oy = other.position.y;

    // - [dragged anchor, static guide line, resulting snap origin y]
    const hCandidates: [number, number, number][] = [
      [y,         oy,          oy],               // - top  ↔ top
      [y + h,     oy + oh,     oy + oh - h],      // - btm  ↔ btm
      [y + h / 2, oy + oh / 2, oy + oh / 2 - h / 2], // - mid  ↔ mid
      [y,         oy + oh,     oy + oh],          // - top  ↔ other btm
      [y + h,     oy,          oy - h],           // - btm  ↔ other top
    ];
    for (const [anchor, guide, snapped] of hCandidates) {
      if (Math.abs(anchor - guide) < threshold) {
        if (horizontal === undefined || Math.abs(anchor - guide) < Math.abs(anchor - horizontal)) {
          horizontal = guide;
          snapY = snapped;
        }
      }
    }

    // - [dragged anchor, static guide line, resulting snap origin x]
    const vCandidates: [number, number, number][] = [
      [x,         ox,          ox],               // - left  ↔ left
      [x + w,     ox + ow,     ox + ow - w],      // - right ↔ right
      [x + w / 2, ox + ow / 2, ox + ow / 2 - w / 2], // - mid   ↔ mid
      [x,         ox + ow,     ox + ow],          // - left  ↔ other right
      [x + w,     ox,          ox - w],           // - right ↔ other left
    ];
    for (const [anchor, guide, snapped] of vCandidates) {
      if (Math.abs(anchor - guide) < threshold) {
        if (vertical === undefined || Math.abs(anchor - guide) < Math.abs(anchor - vertical)) {
          vertical = guide;
          snapX = snapped;
        }
      }
    }
  }

  return { horizontal, vertical, snapX, snapY };
}

// ─── props ────────────────────────────────────────────────────────────────────

interface CanvasViewProps {
  canvas:     CanvasData;
  canvasPath: string;
}

// ─── inner component (needs ReactFlowProvider context) ────────────────────────

function CanvasViewInner({ canvas, canvasPath }: CanvasViewProps): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState(canvas.nodes.map(toFlowNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(canvas.edges.map(toFlowEdge));
  const [showMinimap,  setShowMinimap]  = useState(false);
  const [helperLines,  setHelperLines]  = useState<HelperLinesState>({});

  // - intercept onNodesChange to compute alignment guides + manual grid snap
  // - (snapToGrid is removed from <ReactFlow> so both can coexist cleanly)
  const customOnNodesChange = useCallback((changes: NodeChange[]) => {
    const posChange = changes.find(
      (c): c is NodePositionChange => c.type === 'position' && !!c.dragging && !!c.position
    );

    if (posChange?.position) {
      const { horizontal, vertical, snapX, snapY } = getHelperLines(posChange, nodesRef.current);
      setHelperLines({ horizontal, vertical });
      // - snap to alignment guide if within threshold, otherwise snap to grid
      posChange.position = {
        x: snapX !== undefined ? snapX : snapGrid(posChange.position.x),
        y: snapY !== undefined ? snapY : snapGrid(posChange.position.y),
      };
    } else if (!changes.some(c => c.type === 'position' && (c as NodePositionChange).dragging)) {
      setHelperLines({});
    }

    onNodesChange(changes);
  }, [onNodesChange]); // - nodesRef always current via its own useEffect

  // - track current canvas data for save (avoid stale closures)
  const canvasRef = useRef<CanvasData>(canvas);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // - sync when canvas reloads from host
  useEffect(() => {
    setNodes(canvas.nodes.map(toFlowNode));
    setEdges(canvas.edges.map(toFlowEdge));
    canvasRef.current = canvas;
  }, [canvas, setNodes, setEdges]);

  // - debounced save
  const scheduleSave = useCallback((updatedCanvas: CanvasData) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      vscodePostMessage({ type: 'saveCanvas', canvas: updatedCanvas });
    }, 500);
  }, []);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    const original = canvasRef.current.nodes.find(n => n.id === node.id);
    if (!original) return;

    // - final snap: wider threshold (20px) so a near-miss still lands on the line
    const { snapX, snapY } = getHelperLines(
      { type: 'position', id: node.id, position: node.position, dragging: false },
      nodesRef.current,
      40,
    );
    const finalPosition = {
      x: snapX !== undefined ? snapX : node.position.x,
      y: snapY !== undefined ? snapY : node.position.y,
    };
    if (snapX !== undefined || snapY !== undefined) {
      setNodes(nds => nds.map(n => n.id === node.id ? { ...n, position: finalPosition } : n));
    }

    const updated: CanvasData = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.map(n =>
        n.id === node.id ? patchCanvasNode(n, { ...node, position: finalPosition }) : n
      ),
    };
    canvasRef.current = updated;
    scheduleSave(updated);
  }, [setNodes, scheduleSave]);

  const onConnect = useCallback((connection: Connection) => {
    const newEdge: CanvasEdge = {
      id:       `${connection.source ?? ''}-${connection.target ?? ''}-${Date.now()}`,
      fromNode: connection.source!,
      fromSide: (connection.sourceHandle ?? undefined) as CanvasEdge['fromSide'],
      toNode:   connection.target!,
      toSide:   (connection.targetHandle ?? undefined) as CanvasEdge['toSide'],
      toEnd:    'arrow',
    };
    setEdges(eds => addEdge(toFlowEdge(newEdge), eds));
    const updated: CanvasData = {
      ...canvasRef.current,
      edges: [...canvasRef.current.edges, newEdge],
    };
    canvasRef.current = updated;
    scheduleSave(updated);
  }, [setEdges, scheduleSave]);

  // - drop connection on node body (not on a specific handle) → connect to nearest side
  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    // - valid connections (dropped on a handle) are handled by onConnect above
    if (connectionState.isValid || !connectionState.fromNode) return;

    // - find the node element under the drop position
    const mouseEvent = 'clientX' in event ? event as MouseEvent : (event as TouchEvent).changedTouches[0];
    const el = document.elementFromPoint(mouseEvent.clientX, mouseEvent.clientY);
    const nodeEl = el?.closest<HTMLElement>('[data-id]');
    const targetNodeId = nodeEl?.dataset.id;
    if (!targetNodeId || targetNodeId === connectionState.fromNode.id) return;

    // - infer nearest side from drop point relative to node bounding box
    const rect = nodeEl!.getBoundingClientRect();
    const dx = mouseEvent.clientX - (rect.left + rect.width  / 2);
    const dy = mouseEvent.clientY - (rect.top  + rect.height / 2);
    const toSide: CanvasEdge['fromSide'] = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'bottom' : 'top');

    const fromSide = (connectionState.fromHandle?.id ?? 'right') as CanvasEdge['fromSide'];

    const newEdge: CanvasEdge = {
      id:       `${connectionState.fromNode.id}-${targetNodeId}-${Date.now()}`,
      fromNode: connectionState.fromNode.id,
      fromSide,
      toNode:   targetNodeId,
      toSide,
      toEnd:    'arrow',
    };
    setEdges(eds => addEdge(toFlowEdge(newEdge), eds));
    const updated: CanvasData = {
      ...canvasRef.current,
      edges: [...canvasRef.current.edges, newEdge],
    };
    canvasRef.current = updated;
    scheduleSave(updated);
  }, [setEdges, scheduleSave]);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    const deletedIds = new Set(deleted.map(n => n.id));
    const updated: CanvasData = {
      nodes: canvasRef.current.nodes.filter(n => !deletedIds.has(n.id)),
      edges: canvasRef.current.edges.filter(e => !deletedIds.has(e.fromNode) && !deletedIds.has(e.toNode)),
    };
    canvasRef.current = updated;
    scheduleSave(updated);
  }, [scheduleSave]);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const deletedIds = new Set(deleted.map(e => e.id));
    const updated: CanvasData = {
      ...canvasRef.current,
      edges: canvasRef.current.edges.filter(e => !deletedIds.has(e.id)),
    };
    canvasRef.current = updated;
    scheduleSave(updated);
  }, [scheduleSave]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    // - open file in VS Code editor on Cmd+click is handled inside FileNode itself
    // - double-click on text nodes → handled by TextNode component internally
    if (node.type === 'portal') {
      vscodePostMessage({ type: 'openFile', uri: (node.data as { canvas?: string }).canvas ?? '' });
    }
  }, []);

  // ─── file drop from VS Code Explorer ────────────────────────────────────────

  const rfInstance = useReactFlow();
  const { screenToFlowPosition } = rfInstance;
  // - keep a ref so the stable navigation useEffect can call setCenter / getViewport
  const rfRef = useRef(rfInstance);
  useEffect(() => { rfRef.current = rfInstance; });

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    // - VS Code Explorer drops files as text/uri-list
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (!uriList?.trim()) return;

    const uris = uriList
      .split(/\r?\n/)
      .map(u => u.trim())
      .filter(u => u && !u.startsWith('#'));

    if (uris.length === 0) return;

    // - convert screen coords to flow canvas coords
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    vscodePostMessage({ type: 'dropFiles', uris, position });
  }, [screenToFlowPosition]);

  // - listen for resolved nodes coming back from host after drop
  useEffect(() => {
    const handler = (e: Event) => {
      const nodes = (e as CustomEvent<CanvasNode[]>).detail;
      nodes.forEach(cn => {
        setNodes(nds => [...nds, toFlowNode(cn)]);
        canvasRef.current = {
          ...canvasRef.current,
          nodes: [...canvasRef.current.nodes, cn],
        };
      });
      scheduleSave(canvasRef.current);
    };
    window.addEventListener('skena:nodesFromDrop', handler);
    return () => window.removeEventListener('skena:nodesFromDrop', handler);
  }, [setNodes, scheduleSave]);

  // ─── keyboard navigation between nodes (hjkl / arrow keys) ──────────────────

  // - use a ref so the stable keydown handler always sees current nodes
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; });

  useEffect(() => {
    const keyToDir = (key: string): 'left' | 'right' | 'up' | 'down' | null => {
      switch (key) {
        case 'h': case 'ArrowLeft':  return 'left';
        case 'l': case 'ArrowRight': return 'right';
        case 'k': case 'ArrowUp':    return 'up';
        case 'j': case 'ArrowDown':  return 'down';
        default: return null;
      }
    };

    const centerOf = (n: Node) => ({
      x: n.position.x + Number(n.style?.width  ?? 200) / 2,
      y: n.position.y + Number(n.style?.height ?? 150) / 2,
    });

    // - find closest node in direction using weighted distance:
    // - primary-axis dist + 2.5× perpendicular dist so off-axis nodes are deprioritised
    const findNearest = (from: Node, dir: 'left' | 'right' | 'up' | 'down'): string | null => {
      const fc = centerOf(from);
      let bestId: string | null = null;
      let bestScore = Infinity;
      for (const node of nodesRef.current) {
        if (node.id === from.id || node.type === 'group') continue;
        const nc = centerOf(node);
        const dx = nc.x - fc.x;
        const dy = nc.y - fc.y;
        const inDir = dir === 'left'  ? dx < 0 :
                      dir === 'right' ? dx > 0 :
                      dir === 'up'    ? dy < 0 : dy > 0;
        if (!inDir) continue;
        const score = (dir === 'left' || dir === 'right')
          ? Math.abs(dx) + Math.abs(dy) * 2.5
          : Math.abs(dy) + Math.abs(dx) * 2.5;
        if (score < bestScore) { bestScore = score; bestId = node.id; }
      }
      return bestId;
    };

    const handler = (e: KeyboardEvent) => {
      // - don't intercept while user is typing in Monaco, an input, or textarea
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.closest('.monaco-editor')
      ) return;

      // - Enter: open non-text selected node in VS Code editor
      if (e.key === 'Enter') {
        const current = nodesRef.current.find(n => n.selected && n.type !== 'group');
        // - text nodes handle Enter themselves via their own onKeyDown
        if (!current || current.type === 'text') return;
        e.preventDefault();
        const d = current.data as Record<string, unknown>;
        if (current.type === 'file') {
          vscodePostMessage({ type: 'openFile', uri: (d.file as string) ?? '' });
        } else if (current.type === 'portal') {
          vscodePostMessage({ type: 'openFile', uri: (d.canvas as string) ?? '' });
        } else if (current.type === 'link') {
          const url = (d.url as string) ?? '';
          if (url) vscodePostMessage({ type: 'openFile', uri: url });
        }
        return;
      }

      const dir = keyToDir(e.key);
      if (!dir) return;

      const current = nodesRef.current.find(n => n.selected && n.type !== 'group');
      if (!current) return;

      const targetId = findNearest(current, dir);
      if (!targetId) return;

      e.preventDefault();
      setNodes(nds => nds.map(n => ({ ...n, selected: n.id === targetId })));
      // - focus the target node's DOM element so Enter-to-edit works immediately
      window.dispatchEvent(new CustomEvent('skena:focusNode', { detail: { id: targetId } }));

      // - pan viewport to keep the target node visible
      const target = nodesRef.current.find(n => n.id === targetId);
      if (target) {
        const nodeCenter = {
          x: target.position.x + Number(target.style?.width  ?? 200) / 2,
          y: target.position.y + Number(target.style?.height ?? 150) / 2,
        };
        const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
        const margin = 80 / zoom;                         // - 80px screen-space margin
        const left   = -vx / zoom + margin;
        const top    = -vy / zoom + margin;
        const right  = left + window.innerWidth  / zoom - margin * 2;
        const bottom = top  + window.innerHeight / zoom - margin * 2;
        const inView = nodeCenter.x > left && nodeCenter.x < right &&
                       nodeCenter.y > top  && nodeCenter.y < bottom;
        if (!inView) {
          rfRef.current.setCenter(nodeCenter.x, nodeCenter.y, { duration: 250, zoom });
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setNodes]); // - setNodes is stable; nodesRef carries live state

  // - listen for node resize-end events dispatched by NodeResizer inside each node component
  // - params include x/y because top-left resize moves the node origin as well as changing size
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, x, y, width, height } = (e as CustomEvent<{ id: string; x: number; y: number; width: number; height: number }>).detail;
      const updated: CanvasData = {
        ...canvasRef.current,
        nodes: canvasRef.current.nodes.map(n => n.id === id ? { ...n, x, y, width, height } : n),
      };
      canvasRef.current = updated;
      scheduleSave(updated);
    };
    window.addEventListener('skena:nodeResize', handler);
    return () => window.removeEventListener('skena:nodeResize', handler);
  }, [scheduleSave]);

  // ─── custom wheel zoom (smaller step, cursor-centred) ────────────────────────

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      // - if the event originates inside a scrollable node content area,
      // - let ScrollableContent's own handler deal with it
      if ((e.target as HTMLElement).closest('.skena-scrollable')) return;

      // - intercept before D3 sees it and apply a finer zoom step
      e.stopPropagation();
      e.preventDefault();

      const STEP = 0.06; // - 6% per scroll notch (D3 default ≈ 15%)
      const { x: tx, y: ty, zoom } = rfRef.current.getViewport();
      const dir     = e.deltaY > 0 ? -1 : 1;
      const newZoom = Math.max(0.05, Math.min(3, zoom * (1 + STEP * dir)));
      const scale   = newZoom / zoom;

      // - keep the flow point under the cursor stationary:
      // - localX/Y are cursor coords relative to the ReactFlow container
      const rect = el.getBoundingClientRect();
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      rfRef.current.setViewport({
        x:    lx - (lx - tx) * scale,
        y:    ly - (ly - ty) * scale,
        zoom: newZoom,
      });
    };

    // - capture: fires before D3's bubble-phase listener on the inner pane
    // - passive: false so we can call preventDefault (prevents browser scroll-zoom)
    el.addEventListener('wheel', handler, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', handler, { capture: true });
  }, []); // - rfRef always current; wrapperRef is stable

  // - listen for text edits committed by TextNodeComponent's Monaco editor
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, text } = (e as CustomEvent<{ id: string; text: string }>).detail;
      const original = canvasRef.current.nodes.find(n => n.id === id);
      if (!original || original.type !== 'text') return;
      const updatedNode = { ...original, text };
      const updated: CanvasData = {
        ...canvasRef.current,
        nodes: canvasRef.current.nodes.map(n => n.id === id ? updatedNode : n),
      };
      canvasRef.current = updated;
      // - update React Flow node data so markdown re-renders immediately
      setNodes(nds => nds.map(n =>
        n.id === id ? { ...n, data: { ...n.data, text } } : n
      ));
      scheduleSave(updated);
    };
    window.addEventListener('skena:nodeTextEdit', handler);
    return () => window.removeEventListener('skena:nodeTextEdit', handler);
  }, [setNodes, scheduleSave]);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={customOnNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      onNodesDelete={onNodesDelete}
      onEdgesDelete={onEdgesDelete}
      onNodeDoubleClick={onNodeDoubleClick}
      connectionMode={ConnectionMode.Loose}
      connectionRadius={35}
      disableKeyboardA11y={true}
      onDragOver={onDragOver}
      onDrop={onDrop}
      fitView
      minZoom={0.05}
      maxZoom={3}
      deleteKeyCode="Delete"
      multiSelectionKeyCode="Shift"
      elevateEdgesOnSelect
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--vscode-editorIndentGuide-background)" />
      <HelperLines horizontal={helperLines.horizontal} vertical={helperLines.vertical} />
      <Controls showInteractive={false}>
        {/* - minimap toggle button — appended after the built-in zoom/fit buttons */}
        <ControlButton
          onClick={() => setShowMinimap(v => !v)}
          title={showMinimap ? 'Hide minimap' : 'Show minimap'}
          style={{ opacity: showMinimap ? 1 : 0.45 }}
        >
          {/* - simple map icon: outer rect + inner viewport rect */}
          <svg viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="4" y="4" width="5" height="4" rx="0.5" />
          </svg>
        </ControlButton>
      </Controls>
      {showMinimap && (
        <MiniMap
          nodeColor={n => (n.data as { accentColor?: string }).accentColor ?? '#888'}
          maskColor="rgba(0,0,0,0.3)"
          style={{ background: 'var(--vscode-sideBar-background)' }}
        />
      )}
    </ReactFlow>
    </div>
  );
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasViewInner {...props} />
    </ReactFlowProvider>
  );
}
