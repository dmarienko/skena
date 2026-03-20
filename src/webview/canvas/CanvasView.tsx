/**
 * CanvasView — React Flow setup.
 * Converts CanvasData (JSON Canvas spec) to React Flow nodes + edges,
 * handles user interactions (drag, connect, delete) and saves back to host.
 */

import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Connection,
  ConnectionMode,
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

// ─── props ────────────────────────────────────────────────────────────────────

interface CanvasViewProps {
  canvas:     CanvasData;
  canvasPath: string;
}

// ─── inner component (needs ReactFlowProvider context) ────────────────────────

function CanvasViewInner({ canvas, canvasPath }: CanvasViewProps): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState(canvas.nodes.map(toFlowNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(canvas.edges.map(toFlowEdge));

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
    const updated: CanvasData = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.map(n => n.id === node.id ? patchCanvasNode(n, node) : n),
    };
    canvasRef.current = updated;
    scheduleSave(updated);
  }, [scheduleSave]);

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

  const { screenToFlowPosition } = useReactFlow();

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
      const dir = keyToDir(e.key);
      if (!dir) return;

      // - don't intercept while user is typing in Monaco, an input, or textarea
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.closest('.monaco-editor')
      ) return;

      const current = nodesRef.current.find(n => n.selected && n.type !== 'group');
      if (!current) return;

      const targetId = findNearest(current, dir);
      if (!targetId) return;

      e.preventDefault();
      setNodes(nds => nds.map(n => ({ ...n, selected: n.id === targetId })));
      // - focus the target node's DOM element so Enter-to-edit works immediately
      window.dispatchEvent(new CustomEvent('skena:focusNode', { detail: { id: targetId } }));
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setNodes]); // - setNodes is stable; nodesRef carries live state

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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onNodesDelete={onNodesDelete}
      onEdgesDelete={onEdgesDelete}
      onNodeDoubleClick={onNodeDoubleClick}
      connectionMode={ConnectionMode.Loose}
      disableKeyboardA11y={true}
      onDragOver={onDragOver}
      onDrop={onDrop}
      fitView
      snapToGrid
      snapGrid={[8, 8]}
      minZoom={0.05}
      maxZoom={3}
      deleteKeyCode="Delete"
      multiSelectionKeyCode="Shift"
      elevateEdgesOnSelect
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--vscode-editorIndentGuide-background)" />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={n => (n.data as { accentColor?: string }).accentColor ?? '#888'}
        maskColor="rgba(0,0,0,0.3)"
        style={{ background: 'var(--vscode-sideBar-background)' }}
      />
    </ReactFlow>
  );
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasViewInner {...props} />
    </ReactFlowProvider>
  );
}
