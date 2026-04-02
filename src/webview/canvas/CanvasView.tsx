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

import { CanvasData, CanvasNode, CanvasEdge, MsgAddNodeResult, MsgSubCanvasCreated, NodeSide } from '../../shared/types';
import { ContextMenu } from './ContextMenu';
import { CANVAS_COLORS } from '../../shared/constants';
import { ensureLabels, assignLabel } from './nodeLabels';
import { ZoomLevelProvider } from '../context/ZoomLevelContext';

import { FileNodeComponent }  from './nodes/FileNode';
import { TextNodeComponent }  from './nodes/TextNode';
import { GroupNodeComponent } from './nodes/GroupNode';
import { LinkNodeComponent }  from './nodes/LinkNode';
import { CellNodeComponent }  from './nodes/CellNode';
import { ChatNodeComponent }  from './nodes/ChatNode';
import { PortalNodeComponent } from './nodes/PortalNode';
import { LabeledEdgeComponent } from './edges/LabeledEdge';
import { HelperLines } from './HelperLines';
import { CanvasSearch } from './CanvasSearch';

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
    // - RF v12: set both style AND direct width/height so measured values are
    // - pre-seeded without waiting for a DOM measurement pass after reload
    style:    { width: cn.width, height: cn.height },
    width:    cn.width,
    height:   cn.height,
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

// - timestamp label for pin edges: yy-mm-dd hh:mm
function nowLabel(): string {
  const d   = new Date();
  const yy  = String(d.getFullYear()).slice(2);
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const dd  = String(d.getDate()).padStart(2, '0');
  const hh  = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd} ${hh}:${min}`;
}

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

// ─── layout helpers ───────────────────────────────────────────────────────────

/**
 * Starting from (x, y), move in the push direction until the proposed
 * newW × newH bounding-box doesn't overlap any existing node.
 *
 * pushX / pushY is the movement direction: -1, 0, or +1.
 * When both are 0 (no preferred direction) the function returns immediately
 * because there is nowhere to push.
 */
function findFreePosition(
  existingNodes: Node[],
  x:     number,
  y:     number,
  newW:  number,
  newH:  number,
  pushX: -1 | 0 | 1,
  pushY: -1 | 0 | 1,
  gap = 48,
): { x: number; y: number } {
  if (pushX === 0 && pushY === 0) return { x: Math.round(x), y: Math.round(y) };

  for (let iter = 0; iter < 40; iter++) {
    const hit = existingNodes.find(n => {
      if (n.type === 'group') return false;
      const nw = Number(n.style?.width  ?? 200);
      const nh = Number(n.style?.height ?? 150);
      return x         < n.position.x + nw + gap &&
             x + newW  > n.position.x - gap      &&
             y         < n.position.y + nh + gap  &&
             y + newH  > n.position.y - gap;
    });
    if (!hit) break;

    // - jump past the hit node in the push direction
    const nw = Number(hit.style?.width  ?? 200);
    const nh = Number(hit.style?.height ?? 150);
    if (pushX > 0) x = hit.position.x + nw + gap;
    if (pushX < 0) x = hit.position.x - newW - gap;
    if (pushY > 0) y = hit.position.y + nh + gap;
    if (pushY < 0) y = hit.position.y - newH - gap;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

// ─── per-canvas focus memory (survives canvas reloads within a session) ──────

/**
 * Remembers the last keyboard-focused node id for each canvas file path.
 * Module-level so it outlives component remounts triggered by external reloads.
 */
const lastFocusedNodeId = new Map<string, string>();

// - module-level copy/paste clipboard (shared across canvas reloads)
let clipboard: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null = null;

// ─── props ────────────────────────────────────────────────────────────────────

interface CanvasViewProps {
  canvas:     CanvasData;
  canvasPath: string;
}

// ─── inner component (needs ReactFlowProvider context) ────────────────────────

function CanvasViewInner({ canvas, canvasPath }: CanvasViewProps): JSX.Element {
  // - ensure every node has a reference label (N1, M3, J2 …); save if any were missing
  const initialNodes = ensureLabels(canvas.nodes);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes.map(toFlowNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(canvas.edges.map(toFlowEdge));
  const [showMinimap,  setShowMinimap]  = useState(false);
  const [helperLines,  setHelperLines]  = useState<HelperLinesState>({});
  const [contextMenu,  setContextMenu]  = useState<{ screenX: number; screenY: number } | null>(null);
  const [searchOpen,   setSearchOpen]   = useState(false);
  // - flow coords at right-click time; stored in a ref so add-handlers don't go stale
  const contextMenuFlowPos = useRef<{ flowX: number; flowY: number }>({ flowX: 0, flowY: 0 });
  // - space-pinned node ids: Space toggles a node into/out of this set
  // - pinned nodes show an orange ring and move with hjkl instead of navigating
  const spaceSelectedRef = useRef<Set<string>>(new Set());

  // - intercept onNodesChange to compute alignment guides + manual grid snap
  // - (snapToGrid is removed from <ReactFlow> so both can coexist cleanly)
  const customOnNodesChange = useCallback((changes: NodeChange[]) => {
    const posChange = changes.find(
      (c): c is NodePositionChange => c.type === 'position' && !!c.position
    );

    if (posChange?.position) {
      const { horizontal, vertical, snapX, snapY } = getHelperLines(posChange, nodesRef.current);
      // - show guide lines only while actively dragging; clear them on drop
      if (posChange.dragging) {
        setHelperLines({ horizontal, vertical });
      } else {
        setHelperLines({});
      }
      // - snap to alignment guide if within threshold, otherwise snap to grid;
      // - applies on every position change including the final dragging:false event
      // - so React state never reverts to the raw mouse-up position
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
  // - initialNodes already has labels assigned; if any were missing, they need a save
  const canvasRef = useRef<CanvasData>({ ...canvas, nodes: initialNodes });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // - cancel any in-flight debounced save when the component unmounts.
  // - without this, a pending save queued BEFORE an external canvas change (e.g. MCP
  // - writing a new node) fires AFTER the reload, posting the stale pre-change canvas
  // - back to the extension and overwriting the external edit on disk.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []); // - cleanup only, runs on unmount

  // ─── undo / redo ──────────────────────────────────────────────────────────────
  const MAX_HISTORY = 50;
  type HistoryEntry = { nodes: CanvasNode[]; edges: CanvasEdge[] };
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);

  // - sync when canvas reloads from host; restore focus after fitView settles
  useEffect(() => {
    // - cancel any in-flight save: the freshly-loaded canvas IS the truth on disk;
    // - letting a stale timer fire would overwrite an MCP write with old state.
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const labeled = ensureLabels(canvas.nodes);
    setNodes(labeled.map(toFlowNode));
    setEdges(canvas.edges.map(toFlowEdge));
    canvasRef.current = { ...canvas, nodes: labeled };

    // - restore saved viewport immediately (external reload; defaultViewport only fires on mount)
    if (canvas.viewport) {
      rfRef.current.setViewport(canvas.viewport, { duration: 0 });
    }

    // - fitView / focus: defer so the layout pass is done before we query positions
    const t = setTimeout(() => {
      if (!canvas.viewport) {
        // - no saved viewport → fitView so the canvas isn't off-screen
        rfRef.current.fitView({ padding: 0.1 });
      }
      const stored  = lastFocusedNodeId.get(canvasPath);
      const exists  = stored && nodesRef.current.some(n => n.id === stored);
      const focusId = exists ? stored : pickViewportNode();
      if (focusId) focusNodeById(focusId);
    }, 80);
    return () => clearTimeout(t);
  // - focusNodeById / pickViewportNode are stable useCallbacks; declared below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, canvasPath, setNodes, setEdges]);

  // - debounced save — reads canvasRef.current at fire time so it always sends
  // - the latest state even if an external write (MCP) updated canvasRef between
  // - the scheduleSave() call and the 500 ms timer expiry.
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      vscodePostMessage({ type: 'saveCanvas', canvas: canvasRef.current });
    }, 500);
  }, []); // - canvasRef is a ref — stable, no closure dependency

  // - snapshot current state BEFORE a mutation so it can be undone
  const pushHistory = useCallback(() => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges] },
    ];
    redoStackRef.current = []; // - new action clears redo
  }, []); // - canvasRef is a ref, always current

  // - restore nodes/edges from a history entry
  const applyHistoryState = useCallback((entry: HistoryEntry) => {
    canvasRef.current = { ...canvasRef.current, nodes: entry.nodes, edges: entry.edges };
    setNodes(entry.nodes.map(toFlowNode));
    setEdges(entry.edges.map(toFlowEdge));
    scheduleSave();
  }, [setNodes, setEdges, scheduleSave]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    redoStackRef.current = [
      { nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges] },
      ...redoStackRef.current.slice(0, MAX_HISTORY - 1),
    ];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    applyHistoryState(prev);
  }, [applyHistoryState]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current[0];
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges] },
    ];
    redoStackRef.current = redoStackRef.current.slice(1);
    applyHistoryState(next);
  }, [applyHistoryState]);

  // - if labels were missing on load, persist them immediately
  useEffect(() => {
    if (initialNodes !== canvas.nodes) {
      scheduleSave();
    }
  // - run once on mount only; scheduleSave is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    const original = canvasRef.current.nodes.find(n => n.id === node.id);
    if (!original) return;

    // - node.position here is the last snapped position from the final drag frame;
    // - no second snap needed — customOnNodesChange already handles alignment for
    // - every position change including the dragging:false event React Flow fires next
    const updated: CanvasData = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.map(n =>
        n.id === node.id ? patchCanvasNode(n, node) : n
      ),
    };
    canvasRef.current = updated;
    scheduleSave();
  }, [scheduleSave]);

  const onNodeDragStart = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  const onConnect = useCallback((connection: Connection) => {
    pushHistory();
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
    scheduleSave();
  }, [setEdges, scheduleSave, pushHistory]);

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
    pushHistory();
    setEdges(eds => addEdge(toFlowEdge(newEdge), eds));
    const updated: CanvasData = {
      ...canvasRef.current,
      edges: [...canvasRef.current.edges, newEdge],
    };
    canvasRef.current = updated;
    scheduleSave();
  }, [setEdges, scheduleSave, pushHistory]);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    pushHistory();
    const deletedIds = new Set(deleted.map(n => n.id));
    // - purge deleted nodes from the space-pinned set
    for (const id of deletedIds) spaceSelectedRef.current.delete(id);
    const updated: CanvasData = {
      nodes: canvasRef.current.nodes.filter(n => !deletedIds.has(n.id)),
      edges: canvasRef.current.edges.filter(e => !deletedIds.has(e.fromNode) && !deletedIds.has(e.toNode)),
    };
    canvasRef.current = updated;
    scheduleSave();

    // - auto-focus nearest surviving node so spatial navigation resumes immediately
    const nonGroupDeleted = deleted.filter(n => n.type !== 'group');
    if (nonGroupDeleted.length === 0) return;

    // - centroid of deleted nodes used as reference point
    const cx = nonGroupDeleted.reduce((s, n) => s + n.position.x + Number(n.style?.width  ?? 200) / 2, 0) / nonGroupDeleted.length;
    const cy = nonGroupDeleted.reduce((s, n) => s + n.position.y + Number(n.style?.height ?? 150) / 2, 0) / nonGroupDeleted.length;

    // - nearest non-deleted, non-group node to that centroid
    let bestId:   string | null = null;
    let bestDist  = Infinity;
    for (const n of nodesRef.current) {
      if (deletedIds.has(n.id) || n.type === 'group') continue;
      const nx = n.position.x + Number(n.style?.width  ?? 200) / 2;
      const ny = n.position.y + Number(n.style?.height ?? 150) / 2;
      const d  = Math.hypot(nx - cx, ny - cy);
      if (d < bestDist) { bestDist = d; bestId = n.id; }
    }

    // - defer one frame so React Flow finishes removing the deleted nodes first
    if (bestId) {
      const id = bestId;
      requestAnimationFrame(() => focusNodeById(id));
    }
  // - focusNodeById is a stable useCallback declared below; nodesRef always current
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSave, pushHistory]);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    pushHistory();
    const deletedIds = new Set(deleted.map(e => e.id));
    const updated: CanvasData = {
      ...canvasRef.current,
      edges: canvasRef.current.edges.filter(e => !deletedIds.has(e.id)),
    };
    canvasRef.current = updated;
    scheduleSave();
  }, [scheduleSave, pushHistory]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    // - open file in VS Code editor on Cmd+click is handled inside FileNode itself
    // - double-click on text nodes → handled by TextNode component internally
    if (node.type === 'portal') {
      vscodePostMessage({ type: 'openFile', uri: (node.data as { canvas?: string }).canvas ?? '' });
    }
  }, []);

  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    window.dispatchEvent(new CustomEvent('skena:editEdgeLabel', { detail: { id: edge.id } }));
  }, []);

  // ─── edge label save ─────────────────────────────────────────────────────────
  // - fired by LabeledEdge when the user commits an inline label edit (Enter / blur)

  useEffect(() => {
    const handler = (e: Event) => {
      const { id: edgeId, label } = (e as CustomEvent<{ id: string; label: string }>).detail;
      pushHistory();
      const updated: CanvasData = {
        ...canvasRef.current,
        edges: canvasRef.current.edges.map(ce =>
          ce.id === edgeId ? { ...ce, label: label || undefined } : ce
        ),
      };
      canvasRef.current = updated;
      setEdges(eds => eds.map(fe =>
        fe.id === edgeId ? { ...fe, label: label || undefined, data: { ...fe.data, label: label || undefined } } : fe
      ));
      scheduleSave();
    };
    window.addEventListener('skena:edgeLabelSave', handler);
    return () => window.removeEventListener('skena:edgeLabelSave', handler);
  }, [setEdges, scheduleSave, pushHistory]);

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
      const incoming = (e as CustomEvent<CanvasNode[]>).detail;
      // - assign labels to all dropped nodes, avoiding collisions with each other
      // - and with existing canvas nodes (same logic as addNodeResult path)
      const labelled: CanvasNode[] = [];
      incoming.forEach(cn => {
        const existing = [...canvasRef.current.nodes, ...labelled];
        labelled.push(assignLabel(cn, existing));
      });
      pushHistory();
      labelled.forEach(cn => {
        setNodes(nds => [...nds, toFlowNode(cn)]);
        canvasRef.current = {
          ...canvasRef.current,
          nodes: [...canvasRef.current.nodes, cn],
        };
      });
      scheduleSave();
    };
    window.addEventListener('skena:nodesFromDrop', handler);
    return () => window.removeEventListener('skena:nodesFromDrop', handler);
  }, [setNodes, scheduleSave, pushHistory]);

  // ─── keyboard navigation between nodes (hjkl / arrow keys) ──────────────────

  // - use a ref so the stable keydown handler always sees current nodes
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; });

  // ─── shared focus helpers ─────────────────────────────────────────────────

  /**
   * Select + DOM-focus a node by id and pan the viewport to it if it is
   * off-screen. Also persists the id in lastFocusedNodeId for restoration.
   */
  const focusNodeById = useCallback((id: string) => {
    lastFocusedNodeId.set(canvasPath, id);
    setNodes(nds => nds.map(n => ({ ...n, selected: n.id === id })));
    window.dispatchEvent(new CustomEvent('skena:focusNode', { detail: { id } }));
    const node = nodesRef.current.find(n => n.id === id);
    if (!node) return;
    const nc = {
      x: node.position.x + Number(node.style?.width  ?? 200) / 2,
      y: node.position.y + Number(node.style?.height ?? 150) / 2,
    };
    const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
    const margin = 80 / zoom;
    const left   = -vx / zoom + margin;
    const top    = -vy / zoom + margin;
    const right  = left + window.innerWidth  / zoom - margin * 2;
    const bottom = top  + window.innerHeight / zoom - margin * 2;
    if (nc.x <= left || nc.x >= right || nc.y <= top || nc.y >= bottom) {
      rfRef.current.setCenter(nc.x, nc.y, { duration: 250, zoom });
    }
  }, [setNodes, canvasPath]); // - nodesRef + rfRef are always current

  /**
   * Returns the id of the non-group node whose center is closest to the
   * current viewport center. Returns null if no eligible nodes exist.
   */
  const pickViewportNode = useCallback((): string | null => {
    const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
    const vpCx = (window.innerWidth  / 2 - vx) / zoom;
    const vpCy = (window.innerHeight / 2 - vy) / zoom;
    let bestId:   string | null = null;
    let bestDist  = Infinity;
    for (const n of nodesRef.current) {
      if (n.type === 'group') continue;
      const cx   = n.position.x + Number(n.style?.width  ?? 200) / 2;
      const cy   = n.position.y + Number(n.style?.height ?? 150) / 2;
      const dist = Math.hypot(cx - vpCx, cy - vpCy);
      if (dist < bestDist) { bestDist = dist; bestId = n.id; }
    }
    return bestId;
  }, []); // - rfRef + nodesRef always current

  // ─── add text node in direction (shared by keyboard and VS Code command paths) ─

  /**
   * Creates an empty TextNode connected to the currently focused node,
   * placed in direction dir (H=left, J=down, K=up, L=right), collision-free.
   * Reuses the skena:addNodeResult handler for wiring (nodes, edges, save, focus, autoEdit).
   */
  const addTextNodeInDirection = useCallback((dir: 'H' | 'J' | 'K' | 'L') => {
    const current = nodesRef.current.find(n => n.selected && n.type !== 'group');
    if (!current) return;

    const cw = Number(current.style?.width  ?? 400);
    const ch = Number(current.style?.height ?? 300);
    const nw = 400, nh = 300, GAP = 40;

    const dirMap: Record<string, { dx: number; dy: number; pushX: -1|0|1; pushY: -1|0|1; fromSide: NodeSide; toSide: NodeSide }> = {
      L: { dx:  cw + GAP, dy: 0,         pushX:  1, pushY:  0, fromSide: 'right',  toSide: 'left'   },
      H: { dx: -nw - GAP, dy: 0,         pushX: -1, pushY:  0, fromSide: 'left',   toSide: 'right'  },
      J: { dx: 0,         dy:  ch + GAP, pushX:  0, pushY:  1, fromSide: 'bottom', toSide: 'top'    },
      K: { dx: 0,         dy: -nh - GAP, pushX:  0, pushY: -1, fromSide: 'top',    toSide: 'bottom' },
    };
    const { dx, dy, pushX, pushY, fromSide, toSide } = dirMap[dir];

    const rawX = current.position.x + dx;
    const rawY = current.position.y + dy;
    const { x, y } = findFreePosition(nodesRef.current, rawX, rawY, nw, nh, pushX, pushY);

    const nodeId = `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newTextNode: CanvasNode = { id: nodeId, type: 'text', text: '', x, y, width: nw, height: nh };
    const newTextEdge: CanvasEdge = {
      id:       `${current.id}-${nodeId}-${Date.now()}`,
      fromNode: current.id,
      fromSide,
      toNode:   nodeId,
      toSide,
      toEnd:    'arrow',
    };

    // - reuse the addNodeResult event handler: handles nodes/edges/save/focus/autoEdit
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node: newTextNode, edge: newTextEdge, autoEdit: true } satisfies MsgAddNodeResult,
    }));
  }, []); // - only uses nodesRef (always current)

  // - VS Code command path for Ctrl+Shift+J / Ctrl+Shift+K (intercepted before webview)
  useEffect(() => {
    const handler = (e: Event) => {
      const { direction } = (e as CustomEvent<{ direction: 'H' | 'J' | 'K' | 'L' }>).detail;
      addTextNodeInDirection(direction);
    };
    window.addEventListener('skena:addTextNodeTrigger', handler);
    return () => window.removeEventListener('skena:addTextNodeTrigger', handler);
  }, [addTextNodeInDirection]);

  // ─── context menu handlers ────────────────────────────────────────────────

  // - stable close handler — identity never changes, so ContextMenu never re-registers its effects
  const handleMenuClose = useCallback(() => setContextMenu(null), []);

  // - read flow position from ref — never goes stale regardless of contextMenu state
  const handleMenuAddText = useCallback(() => {
    const { flowX, flowY } = contextMenuFlowPos.current;
    const nodeId = `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newNode: CanvasNode = {
      id: nodeId, type: 'text', text: '',
      x: Math.round(flowX - 200), y: Math.round(flowY - 150),
      width: 400, height: 300,
    };
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node: newNode, autoEdit: true } satisfies MsgAddNodeResult,
    }));
  }, []); // - no deps: reads ref, not state

  const handleMenuAddUrl = useCallback((url: string) => {
    const { flowX, flowY } = contextMenuFlowPos.current;
    const nodeId = `node-${Date.now()}`;
    const newNode: CanvasNode = {
      id: nodeId, type: 'link', url,
      x: Math.round(flowX - 160), y: Math.round(flowY - 40),
      width: 320, height: 80,
    };
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node: newNode } satisfies MsgAddNodeResult,
    }));
  }, []); // - no deps: reads ref, not state

  const handleMenuSearch = useCallback(() => {
    const { flowX, flowY } = contextMenuFlowPos.current;
    vscodePostMessage({
      type:     'addNodeRequest',
      position: { x: Math.round(flowX - 200), y: Math.round(flowY - 150) },
    });
  }, []); // - no deps: reads ref, not state

  const handleCopy = useCallback(() => {
    const selectedNodes = nodesRef.current.filter(n => n.selected && n.type !== 'group');
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map(n => n.id));
    clipboard = {
      nodes: canvasRef.current.nodes.filter(n => selectedIds.has(n.id)),
      edges: canvasRef.current.edges.filter(e => selectedIds.has(e.fromNode) && selectedIds.has(e.toNode)),
    };
  }, []);

  const handlePaste = useCallback(() => {
    pushHistory();
    if (!clipboard) return;
    const OFFSET = 40;
    const idMap = new Map<string, string>();
    clipboard.nodes.forEach((n, i) => idMap.set(n.id, `node-paste-${Date.now()}-${i}`));

    // - pasted nodes get new IDs and fresh labels (copies aren't the same node)
    const rawPasted: CanvasNode[] = clipboard.nodes.map(n => ({
      ...n, id: idMap.get(n.id)!, x: n.x + OFFSET, y: n.y + OFFSET,
      nodeLabel: undefined, // - strip old label so assignLabel gives a new one
    }));
    const allAfterPaste = [...canvasRef.current.nodes, ...rawPasted];
    const newNodes: CanvasNode[] = ensureLabels(allAfterPaste).slice(canvasRef.current.nodes.length);

    const newEdges: CanvasEdge[] = clipboard.edges.map((e, i) => ({
      ...e,
      id:       `edge-paste-${Date.now()}-${i}`,
      fromNode: idMap.get(e.fromNode) ?? e.fromNode,
      toNode:   idMap.get(e.toNode)   ?? e.toNode,
    }));

    setNodes(nds => [
      ...nds.map(n => ({ ...n, selected: false })),
      ...newNodes.map(n => ({ ...toFlowNode(n), selected: true })),
    ]);
    setEdges(eds => [...eds, ...newEdges.map(toFlowEdge)]);
    canvasRef.current = {
      nodes: [...canvasRef.current.nodes, ...newNodes],
      edges: [...canvasRef.current.edges, ...newEdges],
    };
    scheduleSave();
  }, [setNodes, setEdges, scheduleSave, pushHistory]);

  const handleMoveToSubCanvas = useCallback(() => {
    const selectedNodes = nodesRef.current.filter(n => n.selected && n.type !== 'group');
    if (selectedNodes.length < 2) return;
    const selectedIds = new Set(selectedNodes.map(n => n.id));
    const cx = selectedNodes.reduce((s, n) => s + n.position.x + Number(n.style?.width  ?? 200) / 2, 0) / selectedNodes.length;
    const cy = selectedNodes.reduce((s, n) => s + n.position.y + Number(n.style?.height ?? 150) / 2, 0) / selectedNodes.length;
    vscodePostMessage({
      type:     'moveToSubCanvas',
      nodes:    canvasRef.current.nodes.filter(n => selectedIds.has(n.id)),
      edges:    canvasRef.current.edges.filter(e => selectedIds.has(e.fromNode) && selectedIds.has(e.toNode)),
      position: { x: Math.round(cx - 100), y: Math.round(cy - 100) },
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const fp = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    contextMenuFlowPos.current = { flowX: fp.x, flowY: fp.y }; // - write to ref first
    setContextMenu({ screenX: e.clientX, screenY: e.clientY }); // - state only for re-render
  }, []);

  // ─── keyboard navigation ──────────────────────────────────────────────────

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
      // - Ctrl+F or /: open canvas search bar (intercept before input / Monaco checks)
      if (
        ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'f') ||
        (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === '/')
      ) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      // - don't intercept while user is typing in Monaco, an input, or textarea
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.closest('.monaco-editor')
      ) return;

      // - z / Z: zoom in / out centred on viewport centre
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        const STEP = 0.15;
        const { x: tx, y: ty, zoom } = rfRef.current.getViewport();
        const newZoom = Math.max(0.05, Math.min(3, zoom * (1 + STEP)));
        const scale   = newZoom / zoom;
        const cx = window.innerWidth  / 2;
        const cy = window.innerHeight / 2;
        rfRef.current.setViewport({ x: cx - (cx - tx) * scale, y: cy - (cy - ty) * scale, zoom: newZoom });
        return;
      }
      if (!e.ctrlKey && !e.metaKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        const STEP = 0.15;
        const { x: tx, y: ty, zoom } = rfRef.current.getViewport();
        const newZoom = Math.max(0.05, Math.min(3, zoom / (1 + STEP)));
        const scale   = newZoom / zoom;
        const cx = window.innerWidth  / 2;
        const cy = window.innerHeight / 2;
        rfRef.current.setViewport({ x: cx - (cx - tx) * scale, y: cy - (cy - ty) * scale, zoom: newZoom });
        return;
      }

      // - Ctrl+Shift+{H,L}: add empty text node left/right via keydown.
      // - J and K are NOT handled here — VS Code fires the command (skena.addTextNodeDown/Up)
      // - AND delivers the keydown to the webview, which would cause double node creation.
      // - J/K arrive exclusively through the skena:addTextNodeTrigger event handler below.
      if (e.ctrlKey && e.shiftKey && ['H', 'L'].includes(e.key)) {
        if (!nodesRef.current.some(n => n.selected && n.type !== 'group')) return;
        e.preventDefault();
        addTextNodeInDirection(e.key as 'H' | 'L');
        return;
      }

      // - Shift+{H,J,K,L}: move pinned nodes if any are pinned, otherwise add a new node
      if (e.shiftKey && ['H', 'J', 'K', 'L'].includes(e.key)) {
        // - if any nodes are space-pinned, shift+hjkl moves them by one grid step
        if (spaceSelectedRef.current.size > 0) {
          e.preventDefault();
          const dirMap: Record<string, { x: number; y: number }> = {
            H: { x: -GRID, y: 0 }, L: { x: GRID, y: 0 },
            J: { x: 0, y: GRID },  K: { x: 0, y: -GRID },
          };
          const delta = dirMap[e.key];
          setNodes(nds => nds.map(n => {
            if (!spaceSelectedRef.current.has(n.id)) return n;
            return { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } };
          }));
          canvasRef.current = {
            ...canvasRef.current,
            nodes: canvasRef.current.nodes.map(cn =>
              spaceSelectedRef.current.has(cn.id)
                ? { ...cn, x: cn.x + delta.x, y: cn.y + delta.y }
                : cn
            ),
          };
          scheduleSave();
          return;
        }

        const current = nodesRef.current.find(n => n.selected && n.type !== 'group');
        if (!current) return;
        e.preventDefault();

        const cw = Number(current.style?.width  ?? 400);
        const ch = Number(current.style?.height ?? 300);
        const nw = 400, nh = 300, GAP = 40;

        type PD = -1 | 0 | 1;
        const dirMap: Record<string, { dx: number; dy: number; pushX: PD; pushY: PD; fromSide: NodeSide; toSide: NodeSide }> = {
          L: { dx:  cw + GAP, dy: 0,        pushX:  1, pushY:  0, fromSide: 'right',  toSide: 'left'   },
          H: { dx: -nw - GAP, dy: 0,        pushX: -1, pushY:  0, fromSide: 'left',   toSide: 'right'  },
          J: { dx: 0,         dy:  ch + GAP, pushX:  0, pushY:  1, fromSide: 'bottom', toSide: 'top'    },
          K: { dx: 0,         dy: -nh - GAP, pushX:  0, pushY: -1, fromSide: 'top',    toSide: 'bottom' },
        };
        const { dx, dy, pushX, pushY, fromSide, toSide } = dirMap[e.key];

        // - find the first collision-free position in the placement direction
        const rawX = current.position.x + dx;
        const rawY = current.position.y + dy;
        const { x, y } = findFreePosition(nodesRef.current, rawX, rawY, nw, nh, pushX, pushY);

        vscodePostMessage({
          type:       'addNodeRequest',
          position:   { x, y },
          fromNodeId: current.id,
          fromSide,
          toSide,
        });
        return;
      }

      // - Enter / Ctrl+Enter: open non-text selected node in VS Code editor
      // - Ctrl+Enter → modal (maximize editor group); Enter → beside preview
      if (e.key === 'Enter') {
        const current = nodesRef.current.find(n => n.selected && n.type !== 'group');
        // - text nodes handle Enter themselves via their own onKeyDown
        if (!current || current.type === 'text') return;
        e.preventDefault();
        const modal = e.ctrlKey || e.metaKey;
        const d = current.data as Record<string, unknown>;
        if (current.type === 'file') {
          vscodePostMessage({ type: 'openFile', uri: (d.file as string) ?? '', modal });
        } else if (current.type === 'portal') {
          vscodePostMessage({ type: 'openFile', uri: (d.canvas as string) ?? '', modal });
        } else if (current.type === 'link') {
          const url = (d.url as string) ?? '';
          if (url) vscodePostMessage({ type: 'openFile', uri: url, modal });
        }
        return;
      }

      // - u / r: undo / redo canvas structure (vim-style, no modifier)
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'u') {
        e.preventDefault();
        undo();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'r') {
        e.preventDefault();
        redo();
        return;
      }

      // - w / Shift+W: widen / narrow the focused node by 10%, both edges move 5% (centre fixed)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'w' || e.key === 'W')) {
        const cur = nodesRef.current.find(nd => nd.selected && nd.type !== 'group');
        if (!cur) return;
        e.preventDefault();
        const factor = e.key === 'w' ? 1.1 : 1 / 1.1;
        const oldW   = Number(cur.style?.width  ?? cur.width  ?? 400);
        const newW   = Math.round(oldW * factor);
        // - both edges move equally: shift x left by half the delta so centre is fixed
        const newX   = cur.position.x - (newW - oldW) / 2;
        setNodes(nds => nds.map(nd =>
          nd.id !== cur.id ? nd
            : { ...nd, position: { ...nd.position, x: newX }, style: { ...nd.style, width: newW }, width: newW },
        ));
        canvasRef.current = {
          ...canvasRef.current,
          nodes: canvasRef.current.nodes.map(cn =>
            cn.id !== cur.id ? cn : { ...cn, x: newX, width: newW },
          ),
        };
        scheduleSave();
        return;
      }

      // - e / Shift+E: expand / shrink the focused node height by 10%, top edge stays fixed
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        const cur = nodesRef.current.find(nd => nd.selected && nd.type !== 'group');
        if (!cur) return;
        e.preventDefault();
        const factor = e.key === 'e' ? 1.1 : 1 / 1.1;
        const oldH   = Number(cur.style?.height ?? cur.height ?? 300);
        const newH   = Math.round(oldH * factor);
        // - top edge (y) stays fixed; only bottom edge moves
        setNodes(nds => nds.map(nd =>
          nd.id !== cur.id ? nd
            : { ...nd, style: { ...nd.style, height: newH }, height: newH },
        ));
        canvasRef.current = {
          ...canvasRef.current,
          nodes: canvasRef.current.nodes.map(cn =>
            cn.id !== cur.id ? cn : { ...cn, height: newH },
          ),
        };
        scheduleSave();
        return;
      }

      // - Alt+P: trigger pin on the currently hovered notebook output (if any)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'p') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('skena:altPin'));
        return;
      }

      // - Escape: clear space-pinned selection
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Escape') {
        if (spaceSelectedRef.current.size > 0) {
          e.preventDefault();
          spaceSelectedRef.current = new Set();
          setNodes(nds => nds.map(n =>
            n.className === 'skena-pinned' ? { ...n, className: '' } : n
          ));
        }
        return;
      }

      // - Space: toggle space-pinned selection on the keyboard-focused node
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === ' ') {
        const focused = nodesRef.current.find(n => n.selected && n.type !== 'group');
        if (!focused) return;
        e.preventDefault();
        const next = new Set(spaceSelectedRef.current);
        if (next.has(focused.id)) {
          next.delete(focused.id);
        } else {
          next.add(focused.id);
        }
        spaceSelectedRef.current = next;
        setNodes(nds => nds.map(n => ({
          ...n,
          className: next.has(n.id) ? 'skena-pinned' : (n.className === 'skena-pinned' ? '' : n.className),
        })));
        return;
      }

      // - c: add edge from the one space-pinned node to the keyboard-focused node
      // - sides chosen by the direction vector between the two node centres
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'c') {
        const pinned = [...spaceSelectedRef.current];
        if (pinned.length !== 1) return;
        const pinnedNode = nodesRef.current.find(n => n.id === pinned[0]);
        const targetNode = nodesRef.current.find(n => n.selected && n.type !== 'group' && !spaceSelectedRef.current.has(n.id));
        if (!pinnedNode || !targetNode) return;
        e.preventDefault();
        // - compute direction vector between centres to pick nearest sides
        const pw = Number(pinnedNode.style?.width  ?? 400), ph = Number(pinnedNode.style?.height ?? 300);
        const tw = Number(targetNode.style?.width  ?? 400), th = Number(targetNode.style?.height ?? 300);
        const dx = (targetNode.position.x + tw / 2) - (pinnedNode.position.x + pw / 2);
        const dy = (targetNode.position.y + th / 2) - (pinnedNode.position.y + ph / 2);
        const fromSide: CanvasEdge['fromSide'] = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
        const toSide:   CanvasEdge['fromSide'] = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'left'  : 'right') : (dy >= 0 ? 'top'    : 'bottom');
        const newEdge: CanvasEdge = {
          id:       `${pinnedNode.id}-${targetNode.id}-${Date.now()}`,
          fromNode: pinnedNode.id,
          fromSide,
          toNode:   targetNode.id,
          toSide,
          toEnd:    'arrow',
        };
        pushHistory();
        setEdges(eds => addEdge(toFlowEdge(newEdge), eds));
        canvasRef.current = { ...canvasRef.current, edges: [...canvasRef.current.edges, newEdge] };
        scheduleSave();
        return;
      }

      // - Shift+C: remove all edges between the pinned node and the focused node
      if (!e.ctrlKey && !e.metaKey && e.shiftKey && !e.altKey && e.key === 'C') {
        const pinned = [...spaceSelectedRef.current];
        if (pinned.length !== 1) return;
        const pinnedId = pinned[0];
        const targetNode = nodesRef.current.find(n => n.selected && n.type !== 'group' && !spaceSelectedRef.current.has(n.id));
        if (!targetNode) return;
        const targetId = targetNode.id;
        // - collect edge ids that connect the two nodes in either direction
        const toRemove = new Set(
          canvasRef.current.edges
            .filter(ce =>
              (ce.fromNode === pinnedId && ce.toNode === targetId) ||
              (ce.fromNode === targetId && ce.toNode === pinnedId)
            )
            .map(ce => ce.id)
        );
        if (toRemove.size === 0) return;
        e.preventDefault();
        pushHistory();
        setEdges(eds => eds.filter(fe => !toRemove.has(fe.id)));
        canvasRef.current = {
          ...canvasRef.current,
          edges: canvasRef.current.edges.filter(ce => !toRemove.has(ce.id)),
        };
        scheduleSave();
        return;
      }

      const dir = keyToDir(e.key);
      if (!dir) return;

      // - modifier + direction = VS Code / OS shortcut (Alt+Left = navigate back,
      // - Ctrl+Left = word jump, Meta+Left = line start, etc.).
      // - e.key sees only 'h' / 'ArrowLeft', so the modifier is invisible to
      // - keyToDir and navigation fires anyway — silently ignoring the modifier.
      // - Bail out and let VS Code handle the combo.
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      let current = nodesRef.current.find(n => n.selected && n.type !== 'group');

      // - no focused node: establish focus on the viewport-nearest node first;
      // - the user can press the key again to navigate from there
      if (!current) {
        e.preventDefault();
        const id = pickViewportNode();
        if (id) focusNodeById(id);
        return;
      }

      const targetId = findNearest(current, dir);
      if (!targetId) return;

      e.preventDefault();
      focusNodeById(targetId);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setNodes, setEdges, focusNodeById, pickViewportNode, addTextNodeInDirection, undo, redo, scheduleSave, setSearchOpen, pushHistory]); // - nodesRef + spaceSelectedRef carry live state

  // - handle skena:addNodeTrigger from VS Code ctrl+n command override
  // - compute viewport centre in flow coords, avoid overlaps, send addNodeRequest
  useEffect(() => {
    const handler = () => {
      const { x: tx, y: ty, zoom } = rfRef.current.getViewport();
      const rawX = (window.innerWidth  / 2 - tx) / zoom - 200;
      const rawY = (window.innerHeight / 2 - ty) / zoom - 150;
      // - push right if viewport centre is occupied
      const { x, y } = findFreePosition(nodesRef.current, rawX, rawY, 400, 300, 1, 0);
      vscodePostMessage({ type: 'addNodeRequest', position: { x, y } });
    };
    window.addEventListener('skena:addNodeTrigger', handler);
    return () => window.removeEventListener('skena:addNodeTrigger', handler);
  }, []); // - rfRef + nodesRef always current

  // - listen for node resize-end events dispatched by NodeResizer inside each node component
  // - params include x/y because top-left resize moves the node origin as well as changing size
  useEffect(() => {
    const handler = (e: Event) => {
      pushHistory();
      const { id, x, y, width, height } = (e as CustomEvent<{ id: string; x: number; y: number; width: number; height: number }>).detail;
      // - sync RF node state so in-memory dimensions match the resized size
      // - (RF's NodeResizer updates its own internal store, but we must also
      // -  update width/height on the node object for focusNodeById calculations)
      setNodes(nds => nds.map(n => n.id === id
        ? { ...n, position: { x, y }, style: { ...n.style, width, height }, width, height }
        : n
      ));
      const updated: CanvasData = {
        ...canvasRef.current,
        nodes: canvasRef.current.nodes.map(n => n.id === id ? { ...n, x, y, width, height } : n),
      };
      canvasRef.current = updated;
      scheduleSave();
    };
    window.addEventListener('skena:nodeResize', handler);
    return () => window.removeEventListener('skena:nodeResize', handler);
  }, [setNodes, scheduleSave, pushHistory]);

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
      pushHistory();
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
      scheduleSave();
    };
    window.addEventListener('skena:nodeTextEdit', handler);
    return () => window.removeEventListener('skena:nodeTextEdit', handler);
  }, [setNodes, scheduleSave, pushHistory]);

  // - receive add-node result from QuickPick (Ctrl+N / Shift+hjkl)
  useEffect(() => {
    const handler = (e: Event) => {
      pushHistory();
      const { node: rawNode, edge: ce, autoEdit } = (e as CustomEvent<MsgAddNodeResult>).detail;

      // - assign a reference label (N1, M3 …) if the node doesn't have one yet
      const cn = assignLabel(rawNode, canvasRef.current.nodes);

      // - deselect everything, then add the new node as selected
      setNodes(nds => [
        ...nds.map(n => ({ ...n, selected: false })),
        { ...toFlowNode(cn), selected: true },
      ]);

      // - persist node to canvas JSON
      canvasRef.current = {
        ...canvasRef.current,
        nodes: [...canvasRef.current.nodes, cn],
      };

      // - add connecting edge if present (Shift+hjkl case)
      if (ce) {
        setEdges(eds => addEdge(toFlowEdge(ce), eds));
        canvasRef.current = {
          ...canvasRef.current,
          edges: [...canvasRef.current.edges, ce],
        };
      }

      scheduleSave();

      // - focus DOM + pan viewport to the new node
      focusNodeById(cn.id);
      const { zoom } = rfRef.current.getViewport();
      rfRef.current.setCenter(cn.x + cn.width / 2, cn.y + cn.height / 2, { duration: 250, zoom });

      // - for new text notes: open Monaco immediately so the user can start typing
      if (autoEdit) {
        // - short delay to let the TextNodeComponent mount and attach its listener
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skena:enterEdit', { detail: { id: cn.id } }));
        }, 80);
      }
    };

    window.addEventListener('skena:addNodeResult', handler);
    return () => window.removeEventListener('skena:addNodeResult', handler);
  }, [setNodes, setEdges, scheduleSave, focusNodeById, pushHistory]);

  // ─── helper: place a new CellNode at viewport centre ─────────────────────────

  const addCellNode = useCallback((
    content: string,
    format: 'html' | 'markdown' | 'image',
    sourceNodeId?: string,
  ) => {
    pushHistory();
    const W = 480, H = 320, GAP = 60;

    // - if pinned from a notebook node, place to the right of it; else viewport centre
    let x: number, y: number;
    const src = sourceNodeId ? canvasRef.current.nodes.find(n => n.id === sourceNodeId) : undefined;
    if (src) {
      x = Math.round(src.x + src.width + GAP);
      y = Math.round(src.y + (src.height - H) / 2);
    } else {
      const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
      const cx = (-vx + window.innerWidth  / 2) / zoom;
      const cy = (-vy + window.innerHeight / 2) / zoom;
      x = Math.round(cx - W / 2);
      y = Math.round(cy - H / 2);
    }

    const id      = `cell-${Date.now()}`;
    const newNode = assignLabel(
      { id, type: 'cell', x, y, width: W, height: H, content, format } as CanvasNode,
      canvasRef.current.nodes,
    );

    // - create connecting edge from the source notebook node if available
    const newEdges: CanvasEdge[] = [];
    if (src) {
      newEdges.push({
        id:       `edge-pin-${Date.now()}`,
        fromNode: src.id,
        fromSide: 'right',
        toNode:   id,
        toSide:   'left',
        toEnd:    'arrow',
        label:    nowLabel(),
      });
    }

    setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), { ...toFlowNode(newNode), selected: true }]);
    if (newEdges.length > 0) setEdges(eds => [...eds, ...newEdges.map(toFlowEdge)]);
    canvasRef.current = {
      ...canvasRef.current,
      nodes: [...canvasRef.current.nodes, newNode],
      edges: [...canvasRef.current.edges, ...newEdges],
    };
    scheduleSave();
    requestAnimationFrame(() => focusNodeById(id));
  }, [pushHistory, scheduleSave, focusNodeById, setEdges]);

  // ─── pin notebook cell output → new CellNode ─────────────────────────────────
  // - fired by NotebookRenderer's 📌 button

  useEffect(() => {
    const handler = (e: Event) => {
      const { content, format, sourceNodeId } = (e as CustomEvent<{
        content:      string;
        format:       'html' | 'markdown' | 'image';
        sourceNodeId: string;
      }>).detail;
      addCellNode(content, format, sourceNodeId);
    };
    window.addEventListener('skena:pinCellOutput', handler);
    return () => window.removeEventListener('skena:pinCellOutput', handler);
  }, [addCellNode]);

  // ─── Ctrl+Shift+V — paste clipboard as CellNode ───────────────────────────────
  // - requests the clipboard text from extension host; when it arrives, creates a
  // - CellNode: HTML format if the text looks like HTML, markdown otherwise

  useEffect(() => {
    let pending = false;

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        pending = true;
        vscodePostMessage({ type: 'requestClipboardRead' });
      }
    };

    const onClip = (e: Event) => {
      if (!pending) return;
      pending = false;
      const text = (e as CustomEvent<string>).detail ?? '';
      if (!text) return;
      // - treat as HTML if it contains an opening tag, otherwise markdown
      const format: 'html' | 'markdown' = /<[a-zA-Z]/.test(text) ? 'html' : 'markdown';
      addCellNode(text, format);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('skena:clipboardContent', onClip);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('skena:clipboardContent', onClip);
    };
  }, [addCellNode]);

  // - handle sub-canvas extraction result from host
  useEffect(() => {
    const handler = (e: Event) => {
      pushHistory();
      const { portalNode, movedNodeIds } = (e as CustomEvent<MsgSubCanvasCreated>).detail;
      const removedIds = new Set(movedNodeIds);
      setNodes(nds => [
        ...nds.filter(n => !removedIds.has(n.id)),
        { ...toFlowNode(portalNode), selected: true },
      ]);
      setEdges(eds => eds.filter(e => !removedIds.has(e.source) && !removedIds.has(e.target)));
      canvasRef.current = {
        nodes: [...canvasRef.current.nodes.filter(n => !removedIds.has(n.id)), portalNode],
        edges: canvasRef.current.edges.filter(e => !removedIds.has(e.fromNode) && !removedIds.has(e.toNode)),
      };
      scheduleSave();
      focusNodeById(portalNode.id);
    };
    window.addEventListener('skena:subCanvasCreated', handler);
    return () => window.removeEventListener('skena:subCanvasCreated', handler);
  }, [setNodes, setEdges, scheduleSave, focusNodeById, pushHistory]);

  return (
    <ZoomLevelProvider>
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }} onContextMenu={handleContextMenu}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={customOnNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeDragStart={onNodeDragStart}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={35}
        disableKeyboardA11y={true}
        onDragOver={onDragOver}
        onDrop={onDrop}
        // - viewport persistence: restore saved position/zoom; fitView only when no saved viewport
        defaultViewport={canvas.viewport ?? { x: 0, y: 0, zoom: 1 }}
        fitView={!canvas.viewport}
        // - save viewport to canvas JSON whenever the user stops panning/zooming
        onMoveEnd={(_e, viewport) => {
          canvasRef.current = { ...canvasRef.current, viewport };
          scheduleSave();
        }}
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
      {searchOpen && (
        <CanvasSearch
          nodes={canvasRef.current.nodes}
          onFocus={focusNodeById}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {contextMenu && (
        <ContextMenu
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          selectedCount={nodes.filter(n => n.selected && n.type !== 'group').length}
          hasClipboard={clipboard !== null}
          onClose={handleMenuClose}
          onAddText={handleMenuAddText}
          onAddUrl={handleMenuAddUrl}
          onSearch={handleMenuSearch}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onMoveToSubCanvas={handleMoveToSubCanvas}
        />
      )}
    </div>
    </ZoomLevelProvider>
  );
}

export function CanvasView(props: CanvasViewProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasViewInner {...props} />
    </ReactFlowProvider>
  );
}
