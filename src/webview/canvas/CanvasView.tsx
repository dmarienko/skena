/**
 * CanvasView — React Flow setup.
 * Converts CanvasData (JSON Canvas spec) to React Flow nodes + edges,
 * handles user interactions (drag, connect, delete) and saves back to host.
 */

import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
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

import { CanvasData, CanvasNode, CanvasEdge, CanvasViewport, KernelNode, KernelRecord, KnowledgeNode, MsgAddNodeResult, MsgKernelAdded, MsgKernelRemoved, MsgKnowledgeFetchResult, MsgKnowledgeRefresh, MsgKnowledgeRefreshed, MsgKnowledgeServersResult, MsgRunOutput, MsgSubCanvasCreated, MsgVerifyPathResult, NodeSide, CanvasMark, ViewportSnapshot } from '../../shared/types';
import type { KnowledgeHit, KnowledgeText } from '../../shared/knowledge/types';
import type { RefreshOutcome, RefreshTarget } from '../../shared/knowledge/refresh';
import { staleTargets } from '../../shared/knowledge/refresh';
import { classifyClipboard } from './paste-classify';
import { ContextMenu } from './ContextMenu';
import { CANVAS_COLORS, NODE_SIZE, NEW_NODE, OUTPUT_MAX_W, OUTPUT_MAX_H, READABLE_ZOOM, CAMERA_MS } from '../../shared/constants';
import { GRID, snapGrid } from '../../shared/grid';
import { ORIGIN_GUTTER, clampToOrigin, clampCameraToOrigin } from '../../shared/bounds';
import { ensureLabels, assignLabel } from './nodeLabels';
import { ZoomLevelProvider } from '../context/ZoomLevelContext';

import { nextKernelColorIndex } from './palette';
import { FileNodeComponent }  from './nodes/FileNode';
import { TextNodeComponent }  from './nodes/TextNode';
import { GroupNodeComponent } from './nodes/GroupNode';
import { LinkNodeComponent }  from './nodes/LinkNode';
import { CellNodeComponent }  from './nodes/CellNode';
import { ChatNodeComponent }  from './nodes/ChatNode';
import { PortalNodeComponent } from './nodes/PortalNode';
import { NoderefNodeComponent } from './nodes/NoderefNode';
import { KernelNodeComponent } from './nodes/KernelNode';
import { CodeNodeComponent }   from './nodes/CodeNode';
import { KnowledgeNodeComponent } from './nodes/KnowledgeNode';
import { LabeledEdgeComponent } from './edges/LabeledEdge';
import { HelperLines } from './HelperLines';
import { SectionSeparators } from './SectionSeparators';
import { EdgeFollowHints, type EdgeHint } from './EdgeFollowHints';
import { SectionRail, type RailKernel } from '../rail/SectionRail';
import { fmtDateTime } from '../rail/RailSegment';
import { allFolded, deriveLanes, fitLanes, groupIdsByLane, sortLanes, insertLaneAt, parkFirstLaneAtOrigin, pinOutputToLane, pruneFoldedIds, sectionTargetHeight, unfoldLane, type SectionLane, type LaneGrowth } from '../../shared/sectionLanes';
import { applyPatchesToCanvas, codeCellHeight, columnsOfDeleted as columnsOfDeletedIn, forkOf, insertAfter, layoutSection, reflowSection, ridersOf, sectionEngineNodes, sectionMembership, type EngineNode, type LayoutOpts, type Patches } from '../../shared/layoutEngine';
import { useLaneFit, flowGeom } from '../rail/useLaneFit';
import { connectionLabels, findNearestNode, focusAfterDelete, revealPan, type ConnectionLabel, type EdgeSideContext, type NavDir, type NavNode, type Rect } from './spatialNav';
import { CanvasSearch } from './CanvasSearch';
import { KnowledgeSearch } from './KnowledgeSearch';
import { MarksPanel, type SectionEntry } from './MarksPanel';
import { LanesContext } from './LanesContext';
import { KernelsContext } from './KernelsContext';
import { EdgeRoutesContext } from './EdgeRoutesContext';
import { borderPoint, LANE_STEP, routeSection, sideOfHandle, type RouteEdge, type RouteNode, type RoutedEdge, type Side } from '../../shared/edgeRouting';

const NODE_TYPES: NodeTypes = {
  file:   FileNodeComponent,
  text:   TextNodeComponent,
  group:  GroupNodeComponent,
  link:   LinkNodeComponent,
  cell:   CellNodeComponent,
  chat:   ChatNodeComponent,
  portal: PortalNodeComponent,
  noderef: NoderefNodeComponent,
  kernel: KernelNodeComponent,
  code:   CodeNodeComponent,
  knowledge: KnowledgeNodeComponent,
};

// - band-type nodes (group) are visual backdrops: skipped by snapping, nav, overlap checks
const isBandType = (t?: string): boolean => t === 'group';

// - the title is pinned outside the canvas area now, so no zoom is unsafe: back to the original floor
const MIN_ZOOM = 0.05;
// - no zooming in past the readable scale: node text already matches the editor at 1
const MAX_ZOOM = READABLE_ZOOM;

// - pan bounds: one grid left of the origin, flush at the top (the rail is outside the flow)
const TRANSLATE_EXTENT: [[number, number], [number, number]] = [[-ORIGIN_GUTTER, 0], [1e7, 1e7]];

// - the mount camera. React Flow applies defaultViewport verbatim, so a file saved above the origin
//   would paint one frame there before the load effect clamps it — clamp it here instead.
function initialViewport(viewport: CanvasViewport | undefined): CanvasViewport {
  if (!viewport) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.min(MAX_ZOOM, Math.max(viewport.zoom, MIN_ZOOM));
  const c    = clampCameraToOrigin(viewport.x, viewport.y, zoom);
  return { x: c.x, y: c.y, zoom };
}

const EDGE_TYPES: EdgeTypes = {
  labeled: LabeledEdgeComponent,
};

/**
 * The area a focused node has to land in, in PANE pixels: the React Flow pane, minus the AI chat
 * panel's strip when the panel is expanded enough to occlude AND docked to an edge (a collapsed,
 * small or mid-floating panel is ignored). The pane sits right of the rail, so it is narrower than
 * the window; the chat's viewport rect is shifted into pane coordinates before the dock test.
 * Takes the pane element: without it there are no pane coordinates, and the caller does not pan.
 */
function paneArea(el: HTMLElement): Rect {
  const pane = el.getBoundingClientRect();
  const w = pane.width, h = pane.height;
  const area: Rect = { left: 0, top: 0, right: w, bottom: h };
  const chatEl = document.querySelector('[data-skena-chat]') as HTMLElement | null;
  if (!chatEl) return area;
  const r = chatEl.getBoundingClientRect();
  if (r.width <= 40 || r.height <= 60) return area;
  const left = r.left - pane.left, right  = r.right  - pane.left;
  const top  = r.top  - pane.top,  bottom = r.bottom - pane.top;
  if      (right  >= w - 8 && left > w * 0.35) area.right  = left;
  else if (left   <= 8     && right < w * 0.65) area.left   = right;
  else if (bottom >= h - 8 && top  > h * 0.35) area.bottom = top;
  else if (top    <= 8     && bottom < h * 0.65) area.top    = bottom;
  return area;
}

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - one engine run per key press: a held keyboard move on a section the bump walk cannot clear
//   raises the capped notice on every repeat, so the same section is told once per this window
const CAPPED_NOTICE_MS = 5000;
let lastCappedNotice: { sectionId: string; at: number } | null = null;

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
    draggable:   !isBandType(cn.type),
    zIndex:      isBandType(cn.type) ? -1 : 0,
  };
}

// - how long a just-produced run output is protected from being reverted by a stale reload
const RECENT_OUTPUT_MS = 4000;

// - how long g waits for its second key
const G_CHORD_MS = 400;
// - the chord window once the labels are on screen: long enough to find one and type it
const G_HINT_MS = 1500;
// - the label map of a disarmed chord, so disarming allocates nothing
const EMPTY_LABELS: ReadonlyMap<string, string> = new Map();

// - default size + gap for a NEW node created by directional-add (Alt+X / Ctrl+Shift+hjkl), an edge
//   dropped on empty canvas, or `o` below a node
const NEW_NODE_W = NEW_NODE.w, NEW_NODE_H = NEW_NODE.h, NEW_NODE_GAP = NEW_NODE.gap;

// - reconcile a freshly-loaded node array against the current one so an output-write reload doesn't
// - re-render (flicker) the whole canvas. An UNCHANGED node returns its EXACT previous object — React
// - Flow memoizes node wrappers by reference, so an identical ref means zero re-render. Only genuinely
// - changed nodes get a new object (data ref reused when only the position moved). Selection preserved.
function reconcileFlowNodes(prev: Node[], next: Node[], pinned?: Set<string>): Node[] {
  const prevById = new Map(prev.map(n => [n.id, n]));
  return next.map(nn => {
    const pn = prevById.get(nn.id);
    if (!pn) return nn;   // - new node
    // - a just-produced run output: keep the webview's fresh copy so a momentarily-stale disk reload
    //   can't revert its content back to an older run
    if (pinned?.has(nn.id)) return pn;
    const dataSame = JSON.stringify(pn.data) === JSON.stringify(nn.data);
    const posSame  = pn.position.x === nn.position.x && pn.position.y === nn.position.y
      && pn.width === nn.width && pn.height === nn.height;
    if (dataSame && posSame) return pn;   // - fully unchanged → exact ref → RF skips the re-render
    return { ...nn, selected: pn.selected, data: dataSame ? pn.data : nn.data };
  });
}


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

// - canvas edge → React Flow edge. Without an explicit colour on the canvas edge neither the stroke
//   nor the arrow marker is set here: LabeledEdge then colours both from the route's kind and variant
//   (spec 2026-09-11-edges-design.md §3), which this function cannot see.
function toFlowEdge(ce: CanvasEdge): Edge {
  const stroke = resolveColor(ce.color);
  const arrow = ce.toEnd === 'arrow' || !ce.toEnd;
  return {
    id:           ce.id,
    source:       ce.fromNode,
    sourceHandle: ce.fromSide,
    target:       ce.toNode,
    targetHandle: ce.toSide,
    type:         'labeled',
    label:        ce.label,
    style:        stroke ? { stroke } : undefined,
    markerEnd:    arrow && stroke ? { type: MarkerType.ArrowClosed, color: stroke } : undefined,
    data:         { label: ce.label, arrow },
  };
}


const toRouteNode = (n: Node): RouteNode => {
  const g = flowGeom(n);
  return {
    id: g.id, type: n.type ?? '', x: g.x, y: g.y, w: g.width, h: g.height,
    outputNodeId: (n.data as { outputNodeId?: string } | undefined)?.outputNodeId,
  };
};

// - a code node's "input" is an edge FROM a code or kernel node INTO it (toNode === code).
function isBindingSourceType(t?: string): boolean {
  return t === 'code' || t === 'kernel';
}

// - a kernel edge is only allowed to a code cell or a .py file node
function kernelCanConnect(n: { type?: string; data?: unknown } | undefined): boolean {
  if (!n) return false;
  if (n.type === 'code') return true;
  if (n.type === 'file') return (((n.data as { file?: string } | undefined)?.file) ?? '').toLowerCase().endsWith('.py');
  return false;
}

// - edge ids on the path from every RUNNING code cell (lastStatus 'running') to its kernel.
// - Derived from node state (not transient messages) so it survives a canvas reopen.
function runningPathEdgeIds(nodes: Node[], edges: Edge[]): Set<string> {
  const result = new Set<string>();
  const dataOf = (n: Node | undefined) => n?.data as { lastStatus?: string; type?: string } | undefined;
  const running = nodes.filter(n => dataOf(n)?.lastStatus === 'running').map(n => n.id);
  if (!running.length) return result;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const isKernel = (id: string) => dataOf(byId.get(id))?.type === 'kernel' || byId.get(id)?.type === 'kernel';
  const adj = new Map<string, { edgeId: string; other: string }[]>();
  const link = (a: string, edgeId: string, b: string) => { const l = adj.get(a) ?? []; l.push({ edgeId, other: b }); adj.set(a, l); };
  for (const ed of edges) { link(ed.source, ed.id, ed.target); link(ed.target, ed.id, ed.source); }
  for (const start of running) {
    const prevEdge = new Map<string, string>();
    const prevNode = new Map<string, string>();
    const seen = new Set<string>([start]);
    const queue = [start];
    let found: string | null = null;
    while (queue.length && !found) {
      const cur = queue.shift() as string;
      for (const { edgeId, other } of adj.get(cur) ?? []) {
        if (seen.has(other)) continue;
        seen.add(other); prevEdge.set(other, edgeId); prevNode.set(other, cur);
        if (isKernel(other)) { found = other; break; }
        queue.push(other);
      }
    }
    if (found) {
      for (let n: string = found; n !== start && prevEdge.has(n); n = prevNode.get(n) as string) {
        result.add(prevEdge.get(n) as string);
      }
    }
  }
  return result;
}

// - React Flow node → updated canvas node (position/size changed)
function patchCanvasNode(original: CanvasNode, rfNode: Node, nodes: Node[]): CanvasNode {
  // - React Flow hands onNodeDragStop the RAW (pre-snap) drag position. customOnNodesChange snapped
  // - the DISPLAY (grid + alignment guides), so re-apply the identical snap here — otherwise the saved
  // - position is up to a full grid cell off the on-screen position and the node shifts on reopen.
  const change = { id: rfNode.id, type: 'position', position: rfNode.position } as NodePositionChange;
  const { snapX, snapY } = getHelperLines(change, nodes);
  const c = clampToOrigin(
    snapX !== undefined ? snapX : snapGrid(rfNode.position.x),
    snapY !== undefined ? snapY : snapGrid(rfNode.position.y),
  );
  return {
    ...original,
    x:      Math.round(c.x),
    y:      Math.round(c.y),
    width:  Math.round(Number(rfNode.style?.width ?? original.width)),
    height: Math.round(Number(rfNode.style?.height ?? original.height)),
  };
}

// ─── alignment guide helpers ──────────────────────────────────────────────────

// - publish the shared grid to CSS so .skena-markdown line-height matches it (one line == one cell)
if (typeof document !== 'undefined') {
  document.documentElement.style.setProperty('--skena-grid', `${GRID}px`);
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
    if (other.id === node.id || isBandType(other.type)) continue;

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
  // - one grid, the gap the engine keeps: a smaller one parks a node closer than the engine allows
  //   and the next call then "fixes" a placement the user never saw as wrong
  gap = GRID,
): { x: number; y: number } {
  if (pushX === 0 && pushY === 0) {
    const c = clampToOrigin(x, y);
    return { x: Math.round(c.x), y: Math.round(c.y) };
  }

  const startX = x;
  let free = false;
  for (let iter = 0; iter < 40; iter++) {
    const hit = existingNodes.find(n => {
      if (isBandType(n.type)) return false;
      const nw = Number(n.style?.width  ?? 200);
      const nh = Number(n.style?.height ?? 150);
      return x         < n.position.x + nw + gap &&
             x + newW  > n.position.x - gap      &&
             y         < n.position.y + nh + gap  &&
             y + newH  > n.position.y - gap;
    });
    if (!hit) { free = true; break; }

    // - jump past the hit node in the push direction
    const nw = Number(hit.style?.width  ?? 200);
    const nh = Number(hit.style?.height ?? 150);
    if (pushX > 0) x = hit.position.x + nw + gap;
    if (pushX < 0) x = hit.position.x - newW - gap;
    if (pushY > 0) y = hit.position.y + nh + gap;
    if (pushY < 0) y = hit.position.y - newH - gap;
  }

  // - still blocked after 40 pushes: a free slot below beats the overlapping one the search reached
  const c = free ? clampToOrigin(x, y) : clampToOrigin(startX, y + newH + gap);
  return { x: Math.round(c.x), y: Math.round(c.y) };
}

/**
 * Where a directional add lands when the anchor is in a section: the column slot beside (L / H) or
 * above (K) the anchor, snapped to the grid. The engine packs that column from there, so a slot
 * another node already holds is no reason to look elsewhere. Null when the slot falls outside the
 * canvas.
 */
function directionSlot(
  dir:    'H' | 'K' | 'L',
  anchor: { x: number; y: number; w: number },
  newW:   number,
  newH:   number,
): { x: number; y: number } | null {
  const x = dir === 'L' ? snapGrid(anchor.x + anchor.w + GRID)
          : dir === 'H' ? snapGrid(anchor.x - newW - GRID)
          :               snapGrid(anchor.x);
  const y = dir === 'K' ? snapGrid(anchor.y - newH - GRID) : snapGrid(anchor.y);
  // - refused, not clamped to 0: a clamp lands the node on a row that is not free and the pack then
  //   pushes the whole column down to open one — nodes the user never asked to move.
  return x < 0 || y < 0 ? null : { x, y };
}

// ─── per-canvas focus memory (survives canvas reloads within a session) ──────

/**
 * Remembers the last keyboard-focused node id for each canvas file path.
 * Module-level so it outlives component remounts triggered by external reloads.
 */
const lastFocusedNodeId = new Map<string, string>();

/**
 * The marks to persist: every named register, never `` ` ``. The previous-position register now
 * changes on every focus change, so saving it would write the bookmarks file on every h/j/k/l;
 * it is a within-session position, like vim's jump list.
 */
function persistedMarks(marks: Record<string, CanvasMark>): Record<string, CanvasMark> {
  const named: Record<string, CanvasMark> = {};
  for (const [register, mark] of Object.entries(marks)) if (register !== '`') named[register] = mark;
  return named;
}

// - module-level copy/paste clipboard (shared across canvas reloads)
let clipboard: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null = null;

// ─── props ────────────────────────────────────────────────────────────────────

interface CanvasViewProps {
  canvas:     CanvasData;
  canvasPath: string;
  /** - called when the keyboard-focused node changes; used by FloatingChat for context */
  onActiveNodeChange?: (nodeId: string | null, label: string | null) => void;
}

// ─── inner component (needs ReactFlowProvider context) ────────────────────────

function CanvasViewInner({ canvas, canvasPath, onActiveNodeChange }: CanvasViewProps): JSX.Element {
  // - ensure every node has a reference label (N1, M3, J2 …); save if any were missing
  const initialNodes = ensureLabels(canvas.nodes);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes.map(toFlowNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(canvas.edges.map(toFlowEdge));
  const [showMinimap,  setShowMinimap]  = useState(false);
  const [helperLines,  setHelperLines]  = useState<HelperLinesState>({});
  const [contextMenu,  setContextMenu]  = useState<{ screenX: number; screenY: number } | null>(null);
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  // - flow coords at right-click time; stored in a ref so add-handlers don't go stale
  const contextMenuFlowPos = useRef<{ flowX: number; flowY: number }>({ flowX: 0, flowY: 0 });
  // - space-pinned node ids: Space toggles a node into/out of this set
  // - pinned nodes show an orange ring and move with hjkl instead of navigating
  const spaceSelectedRef = useRef<Set<string>>(new Set());
  // - timestamp of last bare `c` / `y` / `d` keypress; used to detect double-tap sequences
  const lastCPressRef = useRef<number>(0);
  const lastYPressRef = useRef<number>(0);
  const lastDPressRef = useRef<number>(0);
  const lastXPressRef = useRef<number>(0);
  // - OS clipboard text captured at last yy; discriminates internal vs content paste (no clipboard timestamps exist)
  const yySnapshotRef      = useRef<string | null>(null);
  const awaitingYYSnapshot = useRef(false);

  // ─── vim marks (m{x} to set, `{x} to jump, `` for previous position) ────────
  const marksRef       = useRef<Record<string, CanvasMark>>({});
  const pendingMarkRef = useRef<'set' | 'jump' | null>(null);
  const markTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // - node id a cross-canvas reference asked to focus; the reload effect honors it (force-center)
  // - so the just-opened canvas jumps to the target instead of restoring its last focus
  const pendingCrossFocusRef = useRef<string | null>(null);
  // - true only while a real user drag is in progress, so grid-snap applies to drags (and their
  // - drop) but never to programmatic position changes (which would move nodes on their own)
  const draggingRef = useRef(false);
  // - Alt+X add-node chord: armed until the next h/j/k/l (or 2s timeout)
  const chordRef       = useRef(false);
  const chordTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // - g chord: the moment g was pressed; the next key counts as its second within gWindowRef
  const lastGPressRef  = useRef<number>(0);
  // - G_CHORD_MS, or G_HINT_MS while the labels are on screen
  const gWindowRef     = useRef<number>(G_CHORD_MS);
  // - what each label key follows: the node at the other end of that connection
  const gLabelsRef     = useRef<ReadonlyMap<string, string>>(EMPTY_LABELS);
  const gHintTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // - the labels drawn over the focused node's borders; only while the chord is armed
  const [gHints, setGHints] = useState<EdgeHint[]>([]);
  const [marksOpen, setMarksOpen] = useState(false);
  // - mirrored so the stable document-level paste listener sees panel state without re-subscribing
  const panelOpenRef = useRef(false);
  // - same for the keydown handler, which hands the keyboard to the knowledge dialog while it is open
  const knowledgeOpenRef = useRef(false);
  useEffect(() => {
    panelOpenRef.current     = searchOpen || marksOpen || knowledgeOpen;
    knowledgeOpenRef.current = knowledgeOpen;
  });

  // - restore marks from workspaceState (sent by host on canvas open)
  useEffect(() => {
    const handler = (e: Event) => {
      // - named marks only: `` ` `` is this session's previous node, and a file written before it
      //   stopped being saved would otherwise hand back a node from another session
      marksRef.current = persistedMarks((e as CustomEvent<Record<string, CanvasMark>>).detail ?? {});
    };
    window.addEventListener('skena:marksRestored', handler);
    return () => window.removeEventListener('skena:marksRestored', handler);
  }, []);

  // - intercept onNodesChange to compute alignment guides + manual grid snap
  // - (snapToGrid is removed from <ReactFlow> so both can coexist cleanly)
  const customOnNodesChange = useCallback((changes: NodeChange[]) => {
    const posChanges = changes.filter(
      (c): c is NodePositionChange => c.type === 'position' && !!c.position
    );

    if (posChanges.length) {
      const primary  = posChanges[0];
      const dragging = posChanges.some(c => c.dragging);
      if (dragging || draggingRef.current) {
        // - dragging, or the drop that ends a drag: snap the WHOLE moved set. The primary aligns to
        //   guides + grid; the rest of a multi-selection snap to grid only — so every dragged node
        //   lands ON the grid on screen and none reverts on reload (all are persisted at drag-stop).
        const { horizontal, vertical, snapX, snapY } = getHelperLines(primary, nodesRef.current);
        setHelperLines(dragging ? { horizontal, vertical } : {});
        primary.position = clampToOrigin(
          snapX !== undefined ? snapX : snapGrid(primary.position!.x),
          snapY !== undefined ? snapY : snapGrid(primary.position!.y),
        );
        for (let i = 1; i < posChanges.length; i++) {
          posChanges[i].position = clampToOrigin(
            snapGrid(posChanges[i].position!.x),
            snapGrid(posChanges[i].position!.y),
          );
        }
        draggingRef.current = dragging;
      } else {
        // - a programmatic / measurement position change (e.g. a cell-run status update, or a node
        // - re-measure) — do NOT snap, or a node not aligned to the current grid would jump on its own.
        setHelperLines({});
      }
    } else if (!changes.some(c => c.type === 'position' && (c as NodePositionChange).dragging)) {
      setHelperLines({});
    }

    onNodesChange(changes);
  }, [onNodesChange]); // - nodesRef / lanesRef always current via their own useEffects

  // ─── active node tracking (for FloatingChat context) ─────────────────────────
  const activeNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    const selected = nodes.find(n => n.selected && !isBandType(n.type));
    const newId    = selected?.id ?? null;
    if (newId !== activeNodeIdRef.current) {
      activeNodeIdRef.current = newId;
      const label = newId
        ? (selected?.data as Record<string, unknown>)?.nodeLabel as string | null ?? null
        : null;
      onActiveNodeChange?.(newId, label);
    }
  // - intentionally depend on the selection pattern rather than the full nodes array
  // - to avoid firing on every drag position change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.map(n => n.selected ? n.id : '').join(','), onActiveNodeChange]);

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
  // - no `kernels`: the records are host-owned (it creates and removes them, and writes the file
  //   itself), so undo never touches them
  type HistoryEntry = { nodes: CanvasNode[]; edges: CanvasEdge[]; sections: SectionLane[] };
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  // - the next geometry render comes from a restored entry, not a user edit; the fit must not re-run
  const fromHistoryRef = useRef(false);

  // - which canvasPath the camera has been initialized for; a reload of the SAME path must not
  //   re-set the viewport (see the reload effect below)
  const loadedPathRef = useRef<string | null>(null);
  // - output-node id → time (ms) of its last run output. A reload within RECENT_OUTPUT_MS keeps the
  //   webview's fresh content for that node instead of reverting to a momentarily-stale disk snapshot.
  const recentOutputRef = useRef<Map<string, number>>(new Map());

  // - sync when canvas reloads from host; restore focus after fitView settles
  useEffect(() => {
    // - cancel any in-flight save: the freshly-loaded canvas IS the truth on disk;
    // - letting a stale timer fire would overwrite an MCP write with old state.
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    // - first load of THIS path → allow the camera to be set (restore/fit/focus). A RELOAD of the
    //   same path (agent MCP edit, cell-run output, another window's save) must NOT move the camera:
    //   editing node data never changes the viewpoint. The disk viewport is also stale on a reload —
    //   hotkey nav/zoom (hjkl/z/Z) moves the camera without persisting, so restoring it would snap back.
    const isInitialLoad = loadedPathRef.current !== canvasPath;
    // - DATA-LOSS GUARD: a reload with ZERO nodes while the webview currently HAS nodes is almost
    //   always a torn/partial read of the .canvas mid-write (the file is large and written often),
    //   NOT a real "everything deleted". Reconciling to it collapses canvasRef to just the kept output
    //   cells, and the next save then truncates the file on disk — permanent loss. Ignore it entirely:
    //   don't touch nodes/edges/canvasRef and don't reschedule a save. A genuine clear-all still works
    //   on the FIRST load (isInitialLoad) and via explicit deletes (which go through their own paths).
    if (!isInitialLoad && canvas.nodes.length === 0 && nodesRef.current.length > 0) {
      console.warn(`[skena reload] IGNORED empty reload (have ${nodesRef.current.length} nodes on screen) — treating as a torn read`);
      return;
    }
    loadedPathRef.current = canvasPath;
    const labeled = ensureLabels(canvas.nodes);
    // - TEMP INSTRUMENT (agent-run node-shift): log any node whose incoming DISK position differs from
    //   its current ON-SCREEN position on a reload. Remove once diagnosed.
    if (!isInitialLoad) {
      const screenById = new Map(nodesRef.current.map(n => [n.id, n.position]));
      const shifts = labeled
        .map(cn => {
          const s = screenById.get(cn.id);
          return s ? { id: cn.id, sx: s.x, sy: s.y, dx: cn.x, dy: cn.y } : null;
        })
        .filter((r): r is NonNullable<typeof r> => !!r && (Math.abs(r.dx - r.sx) > 0.5 || Math.abs(r.dy - r.sy) > 0.5));
      console.warn(
        `[skena reload] nodes=${labeled.length} shifted=${shifts.length}`,
        shifts.map(r => `${r.id}: screen(${Math.round(r.sx)},${Math.round(r.sy)})→disk(${r.dx},${r.dy}) Δ(${Math.round(r.dx - r.sx)},${Math.round(r.dy - r.sy)})`),
      );
    }
    // - TEMP INSTRUMENT (output identity): per code node, its outputNodeId + whether it resolves on
    //   disk; + list of output cells. Catches the "re-run doesn't replace previous output" desync.
    {
      const idset = new Set(labeled.map(n => n.id));
      const cells = labeled.filter(n => n.type === 'cell').map(n => n.id);
      const report = labeled
        .filter(n => n.type === 'code')
        .map(cn => {
          const oid = (cn as { outputNodeId?: string }).outputNodeId;
          const state = oid ? (idset.has(oid) ? 'ok' : 'MISSING') : 'none';
          return `${cn.id}→${oid ?? '∅'}[${state}]`;
        });
      console.warn(`[skena outputs] cells=${cells.length}(${cells.join(',')}) code: ${report.join(' | ')}`);
    }
    // - PROTECT run outputs: never let a (possibly stale) reload drop an output node that a code node
    //   still references. A save/reload race can produce a disk snapshot lacking a just-created output
    //   node + its edge; keep the webview's copy so it doesn't vanish or lose its connection.
    const diskIds = new Set(labeled.map(n => n.id));
    const referenced = new Set(
      nodesRef.current
        .map(n => (n.data as { outputNodeId?: string }).outputNodeId)
        .filter((oid): oid is string => !!oid),
    );
    const keepNodes = nodesRef.current.filter(n => referenced.has(n.id) && !diskIds.has(n.id));
    // - keep the edge to ANY referenced output the disk snapshot is missing the edge for — covers the
    //   "node present but link dropped" case, not just a fully-missing output node
    const keepEdges = edgesRef.current.filter(e => referenced.has(e.target) && !canvas.edges.some(x => x.id === e.id));
    const keepAsCanvas = keepNodes.map(n => {
      const { accentColor: _drop, ...rest } = n.data as Record<string, unknown>;
      return { ...rest, x: n.position.x, y: n.position.y } as unknown as CanvasNode;
    });
    const keepEdgesAsCanvas = keepEdges.map(e => ({ id: e.id, fromNode: e.source, toNode: e.target,
      fromSide: e.sourceHandle ?? undefined, toSide: e.targetHandle ?? undefined, toEnd: 'arrow' } as CanvasEdge));

    // - pin just-produced run outputs: a reload firing from a momentarily-stale writer must not revert
    //   their fresh content to an older run. Expire entries past RECENT_OUTPUT_MS.
    const nowMs = Date.now();
    const pinned = new Set<string>();
    for (const [oid, ts] of recentOutputRef.current) {
      if (nowMs - ts < RECENT_OUTPUT_MS) pinned.add(oid); else recentOutputRef.current.delete(oid);
    }
    // - keep the webview's fresh version of pinned outputs in canvasRef too, so a save can't write the
    //   stale disk content back either
    const prevById = new Map(nodesRef.current.map(n => [n.id, n]));
    const labeledForRef = labeled.map(cn => {
      const wv = pinned.has(cn.id) ? prevById.get(cn.id) : undefined;
      if (!wv) return cn;
      const { accentColor: _drop, ...rest } = wv.data as Record<string, unknown>;
      return { ...rest, x: wv.position.x, y: wv.position.y } as unknown as CanvasNode;
    });

    // - reconcile (not replace) so unchanged nodes keep their exact object ref → no flicker re-render
    setNodes(prev => [...reconcileFlowNodes(prev, labeled.map(toFlowNode), pinned), ...keepNodes]);
    setEdges([...canvas.edges.map(toFlowEdge), ...keepEdges]);
    canvasRef.current = { ...canvas, nodes: [...labeledForRef, ...keepAsCanvas], edges: [...canvas.edges, ...keepEdgesAsCanvas] };

    // - restore saved viewport ONLY on the first load of this path (defaultViewport only fires on
    //   mount). On a reload keep the user's current camera — never snap to the stale disk viewport.
    if (isInitialLoad && canvas.viewport) {
      const zoom = Math.min(MAX_ZOOM, Math.max(canvas.viewport.zoom, MIN_ZOOM));
      // - React Flow applies a restored viewport verbatim (translateExtent only bounds interactive
      //   panning), so it goes through clampCam like every other camera write
      const cRestore = clampCam(canvas.viewport.x, canvas.viewport.y, zoom);
      rfRef.current.setViewport({ x: cRestore.x, y: cRestore.y, zoom }, { duration: 0 });
    }

    // - fitView / focus: defer so the layout pass is done before we query positions
    const t = setTimeout(() => {
      if (isInitialLoad && !canvas.viewport) {
        // - first open, no saved viewport → fit so the canvas isn't off-screen
        void fitClamped();
      } else if (isInitialLoad && nodesRef.current.length > 0) {
        // - a saved viewport can point at empty space (content deleted or moved since it was written),
        //   which opens the canvas on a blank screen. If it frames no node at all, fit instead.
        const { x, y, zoom } = rfRef.current.getViewport();
        const w = wrapperRef.current?.clientWidth ?? 0;
        const h = wrapperRef.current?.clientHeight ?? 0;
        const anyVisible = nodesRef.current.some(n => {
          const sx = n.position.x * zoom + x;
          const sy = n.position.y * zoom + y;
          const sw = Number(n.width ?? n.style?.width ?? 0) * zoom;
          const sh = Number(n.height ?? n.style?.height ?? 0) * zoom;
          return sx + sw > 0 && sx < w && sy + sh > 0 && sy < h;
        });
        if (!anyVisible) void fitClamped();
      }
      // - a cross-canvas reference opened this canvas → jump to and center its target, overriding
      // - the usual last-focus restore (which would otherwise clobber the jump on first open)
      const cross = pendingCrossFocusRef.current;
      if (cross && nodesRef.current.some(n => n.id === cross)) {
        pendingCrossFocusRef.current = null;
        focusNodeById(cross, true);
        return;
      }
      const stored  = lastFocusedNodeId.get(canvasPath);
      const exists  = stored && nodesRef.current.some(n => n.id === stored);
      const focusId = exists ? stored : pickViewportNode();
      if (focusId) {
        // - on any RELOAD (or when a viewport is saved) reselect WITHOUT moving the camera, so an
        //   external reload (agent edit, cell-run output write) doesn't pan / steal focus. Skip when
        //   the target is ALREADY selected — else every output-write reload re-focuses it and the
        //   ring visibly blinks. Only the very first open with no saved viewport may pan to focus.
        if (canvas.viewport || !isInitialLoad) {
          const already = nodesRef.current.find(n => n.id === focusId)?.selected === true;
          if (!already) {
            setNodes(nds => nds.map(n => ({ ...n, selected: n.id === focusId })));
            window.dispatchEvent(new CustomEvent('skena:focusNode', { detail: { id: focusId } }));
          }
        } else {
          focusNodeById(focusId);
        }
      }
    }, 80);
    return () => clearTimeout(t);
  // - focusNodeById / pickViewportNode / fitClamped are stable useCallbacks; declared below
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

  // - lanes live in canvas metadata; the webview owns fold/create/delete and the host merges them back
  const [lanes, setLanes] = useState<SectionLane[]>(canvas.metadata?.sections ?? []);
  useEffect(() => { setLanes(canvas.metadata?.sections ?? []); }, [canvas]);
  const lanesRef = useRef<SectionLane[]>(lanes);
  useEffect(() => { lanesRef.current = lanes; }, [lanes]);

  // - kernels without a node, also in canvas metadata; created and removed by the host, mirrored here
  //   so the webview's own save carries them
  const [kernels, setKernels] = useState<KernelRecord[]>(canvas.metadata?.kernels ?? []);
  useEffect(() => { setKernels(canvas.metadata?.kernels ?? []); }, [canvas]);
  const kernelsRef = useRef<KernelRecord[]>(kernels);
  useEffect(() => { kernelsRef.current = kernels; }, [kernels]);

  // - snapshot current state BEFORE a mutation so it can be undone. The lanes come from the canvasRef
  //   mirror, which `commitLanes` writes in the same tick as the change; `lanesRef` only catches up on
  //   the next render, so a snapshot taken from it would carry a lane array missing that change.
  const pushHistory = useCallback(() => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges], sections: [...(canvasRef.current.metadata?.sections ?? [])] },
    ];
    redoStackRef.current = []; // - new action clears redo
  }, []); // - canvasRef is a ref, always current
  // - every viewport write goes through here; the rule itself lives in bounds.ts and is tested there
  const clampCam = useCallback((x: number, y: number, zoom: number) => clampCameraToOrigin(x, y, zoom), []);
  // - assigned once confirmDeleteViaHost exists (declared further down); see handleDeleteLane
  const confirmLaneDeleteRef = useRef<((ids: string[], reason: string) => Promise<boolean>) | null>(null);

  // - derived every render from the LIVE node array, so dragging a node moves its lane on the same
  //   frame. Nothing about a lane is stored except its y.
  const derivedLanes = useMemo(() => deriveLanes(nodes.map(flowGeom), lanes), [nodes, lanes]);

  // - fold is derived, never a one-shot mutation, so it survives a reload: the fold list IS the set
  //   of hidden ids, so a node dropped into a folded lane after the fold stays visible
  const hiddenByFold = useMemo(() => {
    const ids = new Set<string>();
    for (const l of lanes) for (const id of l.folded ?? []) ids.add(id);
    return ids;
  }, [lanes]);
  const rfNodes = useMemo(
    () => (hiddenByFold.size === 0 ? nodes : nodes.map(n => (hiddenByFold.has(n.id) ? { ...n, hidden: true } : n))),
    [nodes, hiddenByFold],
  );
  // - the keydown handler is registered once, so the section keys read both through a ref
  const derivedLanesRef = useRef(derivedLanes);
  useEffect(() => { derivedLanesRef.current = derivedLanes; });
  const hiddenByFoldRef = useRef(hiddenByFold);
  useEffect(() => { hiddenByFoldRef.current = hiddenByFold; });

  // - the last committed pass, so a drag can hand back the routes it is not recomputing
  const routesRef = useRef<Map<string, RoutedEdge>>(new Map());
  // - one routing pass per section, all of its edges together, so the lanes and the exit slots see
  //   every edge (spec §2). Folded members are left out: React Flow hides them and their edges, and a
  //   hidden node must not reserve a lane. An edge whose ends are in two different sections is not
  //   routed here at all — it stays out of the map and LabeledEdge falls back to the old router.
  const edgeRoutes = useMemo(() => {
    // - a drag moves nodes every frame; the pass is ~7 ms for 22 edges, far too much to pay per frame.
    //   The drop is a position change of its own, so the routes catch up one frame after the gesture.
    if (draggingRef.current) return routesRef.current;
    const next = new Map<string, RoutedEdge>();
    for (const lane of derivedLanes) {
      const member = new Set(lane.memberIds);
      // - a group box encloses the nodes it holds, so handing it to the router would block every edge
      //   drawn over it; the per-edge fallback router leaves group nodes out for the same reason
      const routeNodes = nodes.filter(n => member.has(n.id) && !hiddenByFold.has(n.id) && n.type !== 'group');
      if (routeNodes.length === 0) continue;
      const ids = new Set(routeNodes.map(n => n.id));
      const sectionEdges: RouteEdge[] = edges
        .filter(e => ids.has(e.source) && ids.has(e.target))
        .map(e => ({
          id: e.id, source: e.source, target: e.target,
          sourceSide: sideOfHandle(e.sourceHandle), targetSide: sideOfHandle(e.targetHandle),
        }));
      if (sectionEdges.length === 0) continue;
      for (const r of routeSection(routeNodes.map(toRouteNode), sectionEdges)) next.set(r.id, r);
    }
    return next;
  }, [nodes, edges, derivedLanes, hiddenByFold]);
  useEffect(() => { routesRef.current = edgeRoutes; });

  // - persist a lane edit: update local state, mirror into canvasRef, schedule the save
  const commitLanes = useCallback((next: SectionLane[]) => {
    const sorted = sortLanes(next);
    setLanes(sorted);
    canvasRef.current = {
      ...canvasRef.current,
      metadata: { ...canvasRef.current.metadata, sections: sorted },
    };
    scheduleSave();
  }, [scheduleSave]);

  // - persist a kernel-record edit: update local state, mirror into canvasRef, schedule the save
  const commitKernels = useCallback((next: KernelRecord[]) => {
    setKernels(next);
    canvasRef.current = {
      ...canvasRef.current,
      metadata: { ...canvasRef.current.metadata, kernels: next },
    };
    scheduleSave();
  }, [scheduleSave]);

  // - move nodes by a fit's shifts, in the flow and in the canvas mirror
  const shiftNodes = useCallback((nodeShifts: Record<string, number>) => {
    setNodes(nds => nds.map(n => (nodeShifts[n.id] ? { ...n, position: { x: n.position.x, y: n.position.y + nodeShifts[n.id] } } : n)));
    canvasRef.current = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.map(n => (nodeShifts[n.id] ? { ...n, y: n.y + nodeShifts[n.id] } : n)),
    };
  }, [setNodes]);

  // - fit every section to its content: the shifts may be up or down. No history entry of its own —
  //   the action that changed the geometry pushed one. The lanes come from the canvasRef mirror,
  //   which `commitLanes` writes in the same tick as the change; `lanesRef` only catches up on the
  //   next render, so rebuilding from it would write back a lane array missing that change (an
  //   output just pinned to a folded section would lose its pin).
  const applyFit = useCallback((g: LaneGrowth) => {
    shiftNodes(g.nodeShifts);
    commitLanes((canvasRef.current.metadata?.sections ?? []).map(l => (g.laneShifts[l.id] ? { ...l, y: l.y + g.laneShifts[l.id] } : l)));
  }, [shiftNodes, commitLanes]);
  useLaneFit(nodes, lanes, draggingRef, fromHistoryRef, applyFit);

  // - one section's nodes as the layout engine sees them, nodes AND lanes read from canvasRef and not
  //   from the React state: an action mirrors into canvasRef synchronously, while `nodes` / `lanes`
  //   only catch up on the next render, so a node just added or a lane just committed (the first-node
  //   seed, an output just pinned to a folded section) would be missing.
  const engineNodesOf = useCallback((anchor: { nodeId?: string; sectionId?: string }, extraIds?: string[]): EngineNode[] | null =>
    sectionEngineNodes(canvasRef.current.nodes, canvasRef.current.metadata?.sections ?? [], anchor, extraIds),
  []); // - canvasRef is a ref, always current

  // - move/resize nodes by an engine patch, in the flow and in the canvas mirror. No history entry of
  //   its own: the action that caused the layout pushed one (Reflow pushes through `beforeApply`).
  const applyPatches = useCallback((p: Patches) => {
    setNodes(nds => nds.map(n => {
      const q = p[n.id];
      // - a patch carries x/y only: no engine function emits a size (`Patch.w`/`.h` are reserved for
      //   content measurement), so there is no size to write here
      return q ? { ...n, position: { x: q.x, y: q.y } } : n;
    }));
    canvasRef.current = { ...canvasRef.current, nodes: applyPatchesToCanvas(canvasRef.current.nodes, p) };
  }, [setNodes]);

  /**
   * The single entry point to the layout engine: lay out the section holding `anchor.nodeId` (or the
   * section `anchor.sectionId`), apply what moved and save. `reflow` packs the whole section instead
   * of the touched column; `beforeApply` runs only when something actually moves.
   *
   * The fit runs here, with the section's membership as it stood before the pack: a cell the pack
   * pushed past the section's bottom edge grows that section and moves the ones below, instead of
   * dropping into the section below and overlapping what is there. `useLaneFit`'s own pass then
   * finds nothing left to move.
   *
   * `extraIds` are nodes the action just created from `anchor.nodeId`: they join its section and the
   * fit runs even when the engine moved nothing, which is what grows the section under a new node
   * placed past its bottom edge rather than leaving it to the section below.
   */
  const runEngine = useCallback((anchor: { nodeId?: string; sectionId?: string }, opts: LayoutOpts & { reflow?: boolean; beforeApply?: () => void; extraIds?: string[] } = {}) => {
    const engineNodes = engineNodesOf(anchor, opts.extraIds);
    if (!engineNodes) return;
    // - a section too dense for the bump walk to clear leaves overlaps behind: say so, as the MCP
    //   replies do, rather than leaving the user to find them
    const report: { capped?: boolean } = {};
    // - the cells a sequence edge holds on another cell's row (§3.5), read off the live edges
    const riders = ridersOf(engineNodes, canvasRef.current.edges);
    const patches = opts.reflow ? reflowSection(engineNodes, { riders }) : layoutSection(engineNodes, { ...opts, riders, report });
    if (report.capped) {
      const sectionId = anchor.sectionId ?? deriveLanes(canvasRef.current.nodes, canvasRef.current.metadata?.sections ?? [])
        .find(l => anchor.nodeId !== undefined && l.memberIds.includes(anchor.nodeId))?.id ?? '';
      const now = Date.now();
      if (lastCappedNotice?.sectionId !== sectionId || now - lastCappedNotice.at >= CAPPED_NOTICE_MS) {
        lastCappedNotice = { sectionId, at: now };
        vscodePostMessage({ type: 'notify', text: 'Some nodes could not be laid out without overlapping — use Reflow section' });
      }
    }
    const moved   = Object.keys(patches).length > 0;
    if (!moved && !opts.extraIds?.length) return;
    const own = sectionMembership(canvasRef.current.nodes, canvasRef.current.metadata?.sections ?? [], anchor, opts.extraIds);
    if (moved) { opts.beforeApply?.(); applyPatches(patches); }
    const fit = fitLanes(canvasRef.current.metadata?.sections ?? [], canvasRef.current.nodes, own);
    if (Object.keys(fit.laneShifts).length) applyFit(fit);
    scheduleSave();
  }, [engineNodesOf, applyPatches, applyFit, scheduleSave]);

  /**
   * The end of a node move — a mouse drop or a keyboard step. The moved nodes are the movers, and
   * the engine runs in the section their NEW y puts them in: a node moved into another section
   * changes section on purpose, so nothing pins it to the one it left.
   * A moved set spanning two sections runs the engine once per section, each with its own movers.
   * No history entry here: the drag start / the key press already pushed one for the whole move.
   */
  const runEngineAfterMove = useCallback((movedIds: Iterable<string>, grabbedId?: string) => {
    const lanes = deriveLanes(canvasRef.current.nodes, canvasRef.current.metadata?.sections ?? []);
    const groups = groupIdsByLane(lanes, movedIds);
    for (const moverIds of groups.values()) {
      // - the grabbed node names its own section; the other groups are named by any mover in them
      const grabbed = grabbedId !== undefined && moverIds.includes(grabbedId) ? grabbedId : moverIds[0];
      runEngine({ nodeId: grabbed }, { moverIds });
    }
  }, [runEngine]);

  /**
   * Which cells these edges hold on another cell's row (§3.5). Read it with the canvas as it stands
   * — BEFORE an edge or its source goes, since afterwards nothing says the cell was ever held there.
   */
  const anchoredBy = useCallback((changed: CanvasEdge[]): string[] => {
    const held = new Set<string>();
    for (const e of changed) {
      const around = engineNodesOf({ nodeId: e.toNode });
      if (around && ridersOf(around, [e]).has(e.toNode)) held.add(e.toNode);
    }
    return [...held];
  }, [engineNodesOf]);

  // - and the run that follows the edge change: each cell moves onto its source's row, or packs up
  //   the column the edge was holding it out of
  const runEngineForCells = useCallback((ids: string[]) => {
    for (const id of ids) runEngine({ nodeId: id }, { moverIds: [id] });
  }, [runEngine]);

  // - a delete leaves a hole nothing moved into: read, BEFORE the removal, which column of which
  //   section each doomed cell sat in so the engine can close it after
  const columnsOfDeleted = useCallback((deletedIds: Set<string>) =>
    columnsOfDeletedIn(canvasRef.current.nodes, canvasRef.current.metadata?.sections ?? [], deletedIds),
  []); // - canvasRef is a ref, always current

  // - node id → the section it sits in, read BEFORE the removal: afterwards the deleted node has no
  //   section of its own left to compare the survivors against
  const sectionOfNodes = useCallback((): Map<string, string> => {
    const byId = new Map<string, string>();
    for (const l of deriveLanes(canvasRef.current.nodes, canvasRef.current.metadata?.sections ?? [])) {
      for (const id of l.memberIds) byId.set(id, l.id);
    }
    return byId;
  }, []);

  // - who takes the focus once `deleted` is gone. Bands and kernel badges are not candidates, and
  //   a folded node is passed over: the focus must stay somewhere the user can see it.
  const nextFocusAfterDelete = useCallback((deleted: Node[], sectionOf: Map<string, string>): string | null => {
    const gone = deleted.filter(n => !isBandType(n.type));
    if (gone.length === 0) return null;
    const geom = (n: Node) => ({
      x: n.position.x, y: n.position.y,
      w: Number(n.style?.width ?? 200), h: Number(n.style?.height ?? 150),
    });
    // - a multi-select delete leaves one hole: the box around everything that went
    const boxes = gone.map(geom);
    const x1 = Math.min(...boxes.map(b => b.x));
    const y1 = Math.min(...boxes.map(b => b.y));
    const x2 = Math.max(...boxes.map(b => b.x + b.w));
    const y2 = Math.max(...boxes.map(b => b.y + b.h));
    const deletedIds = new Set(deleted.map(n => n.id));
    return focusAfterDelete(
      // - a multi-section delete picks the first deleted non-band node's section
      { x: x1, y: y1, w: x2 - x1, h: y2 - y1, sectionId: sectionOf.get(gone[0].id) },
      nodesRef.current
        // - kernel badges are excluded here (never a focus candidate) but not from `gone` above,
        //   so a deleted kernel badge still widens the box the next focus is picked near
        .filter(n => !deletedIds.has(n.id) && !isBandType(n.type) && n.type !== 'kernel')
        .map(n => ({ id: n.id, ...geom(n), hidden: hiddenByFoldRef.current.has(n.id), sectionId: sectionOf.get(n.id) })),
    );
  }, []); // - nodesRef / hiddenByFoldRef are refs, always current

  // - a deleted node must not stay in a fold list: it would pin a lane to an id that no longer exists
  const pruneFolded = useCallback((ids: Set<string>) => {
    const next = pruneFoldedIds(lanesRef.current, ids);
    if (next !== lanesRef.current) commitLanes(next);
  }, [commitLanes]);

  const handleFoldLane = useCallback((id: string) => {
    const target = derivedLanes.find(l => l.id === id);
    if (!target) return;
    if (target.folded) {
      // - unfold grows the range back in the SAME commit that drops the list: if the list were dropped
      //   first, the lane below would adopt the members sitting past its top edge
      const u = unfoldLane(lanes, nodes.map(flowGeom), id);
      pushHistory();
      shiftNodes(u.nodeShifts);
      commitLanes(u.lanes);
      return;
    }
    pushHistory();
    // - fold lists the members: they are hidden and pinned here, and the fit hook collapses the
    //   range, moving everything below up
    const newLanes = lanes.map(l => (l.id === id ? { ...l, folded: target.memberIds } : l));
    commitLanes(newLanes);
    // - a hidden node must not stay selected: keyboard nav would then start from a node nobody sees
    setNodes(nds => nds.map(n => (target.memberIds.includes(n.id) ? { ...n, selected: false } : n)));
    // - folding the last open section leaves every lane one grid tall at the top: pan so the canvas
    //   origin sits at the viewport's top-left, same zoom, instead of leaving the camera on empty space
    if (allFolded(newLanes) && rfRef.current) {
      const zoom = rfRef.current.getViewport().zoom;
      const c = clampCam(0, 0, zoom);
      rfRef.current.setViewport({ x: c.x, y: c.y, zoom }, { duration: CAMERA_MS });
    }
  }, [derivedLanes, lanes, nodes, commitLanes, pushHistory, shiftNodes, setNodes, clampCam]);
  // - Shift+( / Shift+) call the rail's own fold action; the ref keeps the keydown handler stable
  const foldLaneRef = useRef(handleFoldLane);
  useEffect(() => { foldLaneRef.current = handleFoldLane; });

  // - a new lane is APPENDED below the last one, past its content: sections are an append-only stack,
  //   so creating one is the next step in the notebook and never renumbers what already exists. The
  //   camera then pans to it, otherwise a lane created off-screen looks like nothing happened.
  useEffect(() => {
    const handler = () => {
      if (!rfRef.current) return;
      const last = derivedLanes[derivedLanes.length - 1];
      // - the new lane starts where the last one's fitted range ends (its content, or the minimum)
      const visible = last ? nodes.filter(n => last.memberIds.includes(n.id) && !(last.folded ?? []).includes(n.id)).map(flowGeom) : [];
      const flowY = last ? snapGrid(last.top + sectionTargetHeight(last, visible)) : 0;
      const now = Date.now();
      // - the shared insert snaps the y, refuses one a lane already sits on and keeps the id unique
      //   against a lane seeded in the same millisecond; same reference = nothing was added
      const next = insertLaneAt(lanesRef.current, flowY, now);
      if (next === lanesRef.current) return;
      pushHistory();
      commitLanes(next);
      const { x, zoom } = rfRef.current.getViewport();
      const c = clampCam(x, -flowY * zoom, zoom);
      rfRef.current.setViewport({ x: c.x, y: c.y, zoom }, { duration: CAMERA_MS });
    };
    window.addEventListener('skena:newSection', handler);
    return () => window.removeEventListener('skena:newSection', handler);
  }, [lanes, derivedLanes, nodes, commitLanes, pushHistory]);

  const handleDeleteLane = useCallback(async (id: string) => {
    const target = derivedLanes.find(l => l.id === id);
    if (!target) return;
    // - this also deletes every node in the lane, so never do it on a single unguarded click
    if (target.memberIds.length > 0) {
      const ok = await confirmLaneDeleteRef.current?.(
        target.memberIds,
        `Delete section ${target.label} and its ${target.memberIds.length} node(s)?`,
      );
      if (!ok) return;
    }
    pushHistory();
    const doomed = new Set(target.memberIds);
    // - a surviving cell an edge held on a deleted cell's row is released and packs up (§3.5)
    const released = anchoredBy(canvasRef.current.edges.filter(e => doomed.has(e.fromNode) || doomed.has(e.toNode)))
      .filter(id => !doomed.has(id));
    setNodes(nds => nds.filter(n => !doomed.has(n.id)));
    setEdges(eds => eds.filter(e => !doomed.has(e.source) && !doomed.has(e.target)));
    canvasRef.current = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.filter(n => !doomed.has(n.id)),
      edges: canvasRef.current.edges.filter(e => !doomed.has(e.fromNode) && !doomed.has(e.toNode)),
    };
    commitLanes(parkFirstLaneAtOrigin(pruneFoldedIds(lanes.filter(l => l.id !== id), doomed)));
    runEngineForCells(released);
  }, [derivedLanes, lanes, commitLanes, pushHistory, setNodes, setEdges, anchoredBy, runEngineForCells]);

  const handleRunLane = useCallback((id: string) => {
    vscodePostMessage({ type: 'runSection', sectionId: id });
  }, []);

  // - the only whole-section move: pack the columns and pairs tight and settle the notes. Its own
  //   history entry, pushed only if the pack actually moves something.
  const handleReflowLane = useCallback((id: string) => {
    runEngine({ sectionId: id }, { reflow: true, beforeApply: pushHistory });
  }, [runEngine, pushHistory]);

  const handleNewSectionClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('skena:newSection'));
  }, []);

  // - every kernel the rail can bind: the records in metadata first, then the kernel nodes on the canvas
  const railKernels = useMemo<RailKernel[]>(() => [
    ...kernels.map(k => ({
      id: k.id, label: k.displayName ?? 'kernel', name: k.server, colorIndex: k.colorIndex,
      server: k.server, kernelId: k.kernelId, kind: 'record' as const,
    })),
    ...nodes.filter(n => n.type === 'kernel').map(n => {
      const k = n.data as unknown as KernelNode;
      return {
        id: n.id, label: k.nodeLabel ?? 'K?', name: k.displayName ?? 'kernel', colorIndex: k.colorIndex ?? 0,
        server: k.server, kernelId: k.kernelId, kind: 'node' as const,
      };
    }),
  ], [nodes, kernels]);

  const selectedNodeId = useMemo(() => nodes.find(n => n.selected && !isBandType(n.type))?.id ?? null, [nodes]);

  const handleBindKernel = useCallback((id: string, kernelId: string | null) => {
    pushHistory();
    // - the explicit undefined key is dropped by JSON.stringify, so an unbound lane saves no field
    commitLanes(lanes.map(l => (l.id === id ? { ...l, kernelId: kernelId ?? undefined } : l)));
  }, [lanes, commitLanes, pushHistory]);

  const handleRenameLane = useCallback((id: string, title: string) => {
    const t = title.trim();
    pushHistory();
    commitLanes(lanes.map(l => (l.id === id ? { ...l, title: t || undefined } : l)));
  }, [lanes, commitLanes, pushHistory]);

  // - the host picks the server/spec, creates the record, binds the lane and writes the file; the
  //   webview learns the result from kernelAdded
  const handleNewKernel = useCallback((laneId: string) => {
    vscodePostMessage({ type: 'addKernel', forSection: laneId });
  }, []);

  const handleRemoveKernel = useCallback((kernelRef: string) => {
    vscodePostMessage({ type: 'removeKernel', kernelRef });
  }, []);

  const handleKernelActionForLane = useCallback((laneId: string, action: 'start' | 'interrupt' | 'restart' | 'shutdown') => {
    const l = lanesRef.current.find(x => x.id === laneId);
    if (l?.kernelId) vscodePostMessage({ type: 'kernelAction', action, kernelNodeId: l.kernelId });
  }, []);

  // - the host already created the record, bound the lane and wrote the file (self-save suppressed,
  //   so no reload arrives): mirror both here, or the next webview save would drop them. No history
  //   entry — a host write is not undoable from here.
  useEffect(() => {
    const handler = (e: Event) => {
      const { sectionId, kernel } = (e as CustomEvent<MsgKernelAdded>).detail;
      commitKernels([...kernelsRef.current, kernel]);
      commitLanes(lanesRef.current.map(l => (l.id === sectionId ? { ...l, kernelId: kernel.id } : l)));
    };
    window.addEventListener('skena:kernelAdded', handler);
    return () => window.removeEventListener('skena:kernelAdded', handler);
  }, [commitKernels, commitLanes]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { kernelRef, unranCells } = (e as CustomEvent<MsgKernelRemoved>).detail;
      commitKernels(kernelsRef.current.filter(k => k.id !== kernelRef));
      commitLanes(lanesRef.current.map(l => (l.kernelId === kernelRef ? (({ kernelId: _k, ...rest }) => rest)(l) : l)));
      // - the host cleared these under a suppressed write; mirror it or our next save writes 'ok' back
      const unran = new Set(unranCells);
      if (unran.size > 0) {
        setNodes(nds => nds.map(n => (unran.has(n.id) ? { ...n, data: { ...n.data, lastStatus: undefined } } : n)));
        canvasRef.current = {
          ...canvasRef.current,
          nodes: canvasRef.current.nodes.map(n => (unran.has(n.id) ? { ...n, lastStatus: undefined } as CanvasNode : n)),
        };
      }
    };
    window.addEventListener('skena:kernelRemoved', handler);
    return () => window.removeEventListener('skena:kernelRemoved', handler);
  }, [commitKernels, commitLanes, setNodes]);

  // - restore nodes/edges/sections from a history entry
  const applyHistoryState = useCallback((entry: HistoryEntry) => {
    fromHistoryRef.current = true;
    canvasRef.current = { ...canvasRef.current, nodes: entry.nodes, edges: entry.edges, metadata: { ...canvasRef.current.metadata, sections: entry.sections } };
    setLanes(entry.sections);
    setNodes(entry.nodes.map(toFlowNode));
    setEdges(entry.edges.map(toFlowEdge));
    scheduleSave();
  }, [setNodes, setEdges, scheduleSave]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    // - same-tick mirror, see pushHistory
    redoStackRef.current = [
      { nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges], sections: [...(canvasRef.current.metadata?.sections ?? [])] },
      ...redoStackRef.current.slice(0, MAX_HISTORY - 1),
    ];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    applyHistoryState(prev);
  }, [applyHistoryState]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current[0];
    // - same-tick mirror, see pushHistory
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: [...canvasRef.current.nodes], edges: [...canvasRef.current.edges], sections: [...(canvasRef.current.metadata?.sections ?? [])] },
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
    // - a multi-selection drag moves several nodes, but React Flow fires this ONCE with the grabbed
    //   node. Persist the grabbed node AND every other currently-selected node — else the unsaved
    //   ones keep their old disk position and revert on the next reload (e.g. an agent edit).
    //   patchCanvasNode re-applies the display snap (RF reports the RAW drag position for the grabbed
    //   node; the others read their already-snapped display position from nodesRef).
    const rfById = new Map(nodesRef.current.map(n => [n.id, n]));
    rfById.set(node.id, node);
    const moved = new Set<string>([node.id, ...nodesRef.current.filter(n => n.selected).map(n => n.id)]);
    const before = new Map(canvasRef.current.nodes.map(n => [n.id, n]));
    const patched = canvasRef.current.nodes.map(n => {
      const rf = moved.has(n.id) ? rfById.get(n.id) : undefined;
      return rf ? patchCanvasNode(n, rf, nodesRef.current) : n;
    });
    // - an output is part of the cell it belongs to: a dragged code cell carries it by the same
    //   delta, so a drag into another column does not leave the output behind. An output dragged in
    //   the same gesture keeps where the user put it.
    const followers = new Map<string, { x: number; y: number }>();
    for (const n of patched) {
      if (n.type !== 'code' || !n.outputNodeId || !moved.has(n.id) || moved.has(n.outputNodeId)) continue;
      const was = before.get(n.id);
      const out = before.get(n.outputNodeId);
      if (!was || !out) continue;
      const dx = n.x - was.x, dy = n.y - was.y;
      if (dx === 0 && dy === 0) continue;
      const c = clampToOrigin(out.x + dx, out.y + dy);
      followers.set(out.id, { x: Math.round(c.x), y: Math.round(c.y) });
    }
    const updated: CanvasData = {
      ...canvasRef.current,
      nodes: followers.size === 0 ? patched : patched.map(n => {
        const p = followers.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      }),
    };
    canvasRef.current = updated;
    if (followers.size > 0) {
      setNodes(nds => nds.map(n => {
        const p = followers.get(n.id);
        return p ? { ...n, position: p } : n;
      }));
    }
    scheduleSave();
    // - the drop may land on another node: the engine clears the overlap, in the section the drop
    //   position falls in
    runEngineAfterMove(followers.size === 0 ? moved : new Set([...moved, ...followers.keys()]), node.id);
  }, [scheduleSave, runEngineAfterMove, setNodes]);

  const onNodeDragStart = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  const rfInstance = useReactFlow();
  const { screenToFlowPosition } = rfInstance;
  // - keep a ref so the stable navigation useEffect can call setCenter / getViewport
  const rfRef = useRef(rfInstance);
  useEffect(() => { rfRef.current = rfInstance; });
  // - the React Flow pane element: its rect is the usable area for a reveal pan and the origin for
  //   cursor-centred wheel zoom
  const wrapperRef = useRef<HTMLDivElement>(null);

  // - React Flow's fitView bypasses translateExtent (d3 transform, no constrain), so clamp after it lands
  //   the public fitView promise resolves after fitViewport has landed the transform in the store
  //   (d3's transform is synchronous), so the continuation reads the final viewport
  const fitClamped = useCallback(async () => {
    if (rfRef.current.getNodes().length === 0) return;   // - fitView never resolves on an empty canvas; nothing to fit anyway
    await rfRef.current.fitView({ padding: 0.1 });
    const { x, y, zoom } = rfRef.current.getViewport();
    const c = clampCam(x, y, zoom);
    rfRef.current.setViewport({ x: c.x, y: c.y, zoom }, { duration: 0 });
  }, [clampCam]);

  // - #4: a kernel may only connect to a code cell or a .py file node (block the drag)
  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (c.source === c.target) return false;
    const nodes = rfRef.current.getNodes();
    const s = nodes.find(n => n.id === c.source);
    const t = nodes.find(n => n.id === c.target);
    if (s?.type === 'kernel' && !kernelCanConnect(t)) return false;
    if (t?.type === 'kernel' && !kernelCanConnect(s)) return false;
    return true;
  }, []);

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
    // - #3: a code node has at most ONE input (edge from a code/kernel into it). Adding a
    // - new one drops the previous input edge(s) — but keeps the chain (outgoing edges stay).
    const typeOf = (id: string) => rfRef.current.getNodes().find(n => n.id === id)?.type;
    let staleIds = new Set<string>();
    if (typeOf(newEdge.toNode) === 'code' && isBindingSourceType(typeOf(newEdge.fromNode))) {
      staleIds = new Set(
        canvasRef.current.edges
          .filter(e => e.toNode === newEdge.toNode && isBindingSourceType(typeOf(e.fromNode)))
          .map(e => e.id),
      );
    }
    // - a sequence edge right → left anchors its target on the source's row, and the input edge it
    //   replaces released one: read both while the old edges are still there (§3.5)
    const held = anchoredBy([...canvasRef.current.edges.filter(e => staleIds.has(e.id)), newEdge]);
    setEdges(eds => addEdge(toFlowEdge(newEdge), eds.filter(e => !staleIds.has(e.id))));
    canvasRef.current = {
      ...canvasRef.current,
      edges: [...canvasRef.current.edges.filter(e => !staleIds.has(e.id)), newEdge],
    };
    scheduleSave();
    runEngineForCells(held);
  }, [setEdges, scheduleSave, pushHistory, anchoredBy, runEngineForCells]);

  // - drop connection on node body (not on a specific handle) → connect to nearest side
  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    // - valid connections (dropped on a handle) are handled by onConnect above
    if (connectionState.isValid || !connectionState.fromNode) return;

    // - find the node element under the drop position
    const mouseEvent = 'clientX' in event ? event as MouseEvent : (event as TouchEvent).changedTouches[0];
    const el = document.elementFromPoint(mouseEvent.clientX, mouseEvent.clientY);
    const nodeEl = el?.closest<HTMLElement>('[data-id]');
    const targetNodeId = nodeEl?.dataset.id;

    // - dropped on empty canvas → create a new node there and connect to it.
    // - dragging from a kernel node makes a code cell (its natural target); else a text note.
    if (!targetNodeId) {
      const fromSide = (connectionState.fromHandle?.id ?? 'right') as NodeSide;
      const opposite: Record<NodeSide, NodeSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
      // - dragging off a kernel OR a code cell makes another code cell (its natural chain); else a text note
      const fromType = connectionState.fromNode.type;
      const makeCode = fromType === 'kernel' || fromType === 'code';
      const nw = makeCode ? NODE_SIZE.code.w : NEW_NODE_W;
      const nh = makeCode ? NODE_SIZE.code.h : NEW_NODE_H;
      const p = screenToFlowPosition({ x: mouseEvent.clientX, y: mouseEvent.clientY });
      const nodeId = `${makeCode ? 'code' : 'text'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const newNode: CanvasNode = makeCode
        ? { id: nodeId, type: 'code', code: '', language: 'python', x: Math.round(p.x), y: Math.round(p.y - nh / 2), width: nw, height: nh }
        : { id: nodeId, type: 'text', text: '', x: Math.round(p.x), y: Math.round(p.y - nh / 2), width: nw, height: nh };
      const newEdge: CanvasEdge = {
        id: `${connectionState.fromNode.id}-${nodeId}-${Date.now()}`,
        fromNode: connectionState.fromNode.id, fromSide,
        toNode: nodeId, toSide: opposite[fromSide], toEnd: 'arrow',
      };
      pushHistory();
      window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
        detail: { type: 'addNodeResult', node: newNode, edge: newEdge, autoEdit: true } satisfies MsgAddNodeResult,
      }));
      return;
    }

    if (targetNodeId === connectionState.fromNode.id) return;

    // - #4: block a kernel connecting to anything but a code cell or .py file (either direction)
    const allNodes = rfRef.current.getNodes();
    const srcNode  = allNodes.find(n => n.id === connectionState.fromNode!.id);
    const tgtNode  = allNodes.find(n => n.id === targetNodeId);
    if (srcNode?.type === 'kernel' && !kernelCanConnect(tgtNode)) return;
    if (tgtNode?.type === 'kernel' && !kernelCanConnect(srcNode)) return;

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
    // - #3: single input for a code target — drop the previous code/kernel → this-code edge
    const typeOf = (id: string) => allNodes.find(n => n.id === id)?.type;
    let staleIds = new Set<string>();
    if (typeOf(newEdge.toNode) === 'code' && isBindingSourceType(typeOf(newEdge.fromNode))) {
      staleIds = new Set(
        canvasRef.current.edges
          .filter(e => e.toNode === newEdge.toNode && isBindingSourceType(typeOf(e.fromNode)))
          .map(e => e.id),
      );
    }
    // - the same read as onConnect: this edge may anchor its target on the source's row, and the
    //   input edge it replaces may release one — both read while the old edges are still there (§3.5)
    const held = anchoredBy([...canvasRef.current.edges.filter(e => staleIds.has(e.id)), newEdge]);
    pushHistory();
    setEdges(eds => addEdge(toFlowEdge(newEdge), eds.filter(e => !staleIds.has(e.id))));
    canvasRef.current = {
      ...canvasRef.current,
      edges: [...canvasRef.current.edges.filter(e => !staleIds.has(e.id)), newEdge],
    };
    scheduleSave();
    runEngineForCells(held);
  }, [setEdges, scheduleSave, pushHistory, screenToFlowPosition, anchoredBy, runEngineForCells]);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    pushHistory();
    const deletedIds = new Set(deleted.map(n => n.id));
    // - purge deleted nodes from the space-pinned set
    for (const id of deletedIds) spaceSelectedRef.current.delete(id);
    const holes = columnsOfDeleted(deletedIds);
    const sectionOf = sectionOfNodes();
    // - a surviving cell an edge held on a deleted cell's row is released and packs up (§3.5)
    const released = anchoredBy(canvasRef.current.edges.filter(e => deletedIds.has(e.fromNode) || deletedIds.has(e.toNode)))
      .filter(id => !deletedIds.has(id));
    const updated: CanvasData = {
      ...canvasRef.current,                                                                       // - preserve viewport, metadata, etc.
      nodes: canvasRef.current.nodes.filter(n => !deletedIds.has(n.id)),
      edges: canvasRef.current.edges.filter(e => !deletedIds.has(e.fromNode) && !deletedIds.has(e.toNode)),
    };
    canvasRef.current = updated;
    pruneFolded(deletedIds);

    // - #2: deleting a code cell's OUTPUT node → focus its code node (not the nearest node),
    // - and clear the code node's outputNodeId so a re-run creates a fresh output.
    const ownerCode = nodesRef.current.find(n =>
      n.type === 'code' && !deletedIds.has(n.id) &&
      deletedIds.has((n.data as { outputNodeId?: string } | undefined)?.outputNodeId ?? ''));
    if (ownerCode) {
      const id = ownerCode.id;
      canvasRef.current = {
        ...canvasRef.current,
        nodes: canvasRef.current.nodes.map(n => n.id === id ? { ...n, outputNodeId: undefined } as CanvasNode : n),
      };
      setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, outputNodeId: undefined } } : n));
      scheduleSave();
      for (const h of holes) runEngine({ sectionId: h.sectionId }, { columnX: h.columnX });
      runEngineForCells(released);
      requestAnimationFrame(() => focusNodeById(id));
      return;
    }
    scheduleSave();
    // - the column closes the hole the delete left; nothing else moves
    for (const h of holes) runEngine({ sectionId: h.sectionId }, { columnX: h.columnX });
    runEngineForCells(released);

    // - auto-focus the nearest surviving node so spatial navigation resumes immediately
    const bestId = nextFocusAfterDelete(deleted, sectionOf);

    // - defer one frame so React Flow finishes removing the deleted nodes first
    if (bestId) {
      const id = bestId;
      requestAnimationFrame(() => focusNodeById(id));
    }
  // - focusNodeById is a stable useCallback declared below; nodesRef always current
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSave, pushHistory, pruneFolded, runEngine, columnsOfDeleted, sectionOfNodes, nextFocusAfterDelete, anchoredBy, runEngineForCells]);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    pushHistory();
    const deletedIds = new Set(deleted.map(e => e.id));
    // - a cell one of these edges held on its source's row is released and packs up (§3.5)
    const held = anchoredBy(canvasRef.current.edges.filter(e => deletedIds.has(e.id)));
    const updated: CanvasData = {
      ...canvasRef.current,
      edges: canvasRef.current.edges.filter(e => !deletedIds.has(e.id)),
    };
    canvasRef.current = updated;
    scheduleSave();
    runEngineForCells(held);
  }, [scheduleSave, pushHistory, anchoredBy, runEngineForCells]);

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
      const { nodes: incoming, connectTo } =
        (e as CustomEvent<{ nodes: CanvasNode[]; connectTo?: string }>).detail;
      // - assign labels to all dropped nodes, avoiding collisions with each other
      // - and with existing canvas nodes (same logic as addNodeResult path)
      const labelled: CanvasNode[] = [];
      incoming.forEach(cn => {
        const existing  = [...canvasRef.current.nodes, ...labelled];
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
      // - paste-to-node: arrow from source node to each new node (skip if source vanished)
      const sourceExists = connectTo && canvasRef.current.nodes.some(n => n.id === connectTo);
      const newEdges: CanvasEdge[] = sourceExists
        ? labelled.map((cn, i) => ({
            id:       `edge-paste-${Date.now()}-${i}`,
            fromNode: connectTo,
            fromSide: 'right' as NodeSide,
            toNode:   cn.id,
            toSide:   'left' as NodeSide,
            toEnd:    'arrow' as const,
          }))
        : [];
      if (newEdges.length > 0) {
        setEdges(eds => [...eds, ...newEdges.map(toFlowEdge)]);
        canvasRef.current = { ...canvasRef.current, edges: [...canvasRef.current.edges, ...newEdges] };
      }
      scheduleSave();
      // - these are right → left edges: one onto a code cell holds it on the source's row (§3.5)
      runEngineForCells(anchoredBy(newEdges));
    };
    window.addEventListener('skena:nodesFromDrop', handler);
    return () => window.removeEventListener('skena:nodesFromDrop', handler);
  }, [setNodes, setEdges, scheduleSave, pushHistory, anchoredBy, runEngineForCells]);

  // ─── keyboard navigation between nodes (hjkl / arrow keys) ──────────────────

  // - use a ref so the stable keydown handler always sees current nodes
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; });
  const edgesRef = useRef(edges);
  useEffect(() => { edgesRef.current = edges; });

  // ─── shared focus helpers ─────────────────────────────────────────────────

  /**
   * Pan so the node is visible, keeping the zoom: the smallest move that also brings its output cell
   * in when the node+output pair fits at the current zoom. `forceCenter` (a cross-canvas jump)
   * centres the pair instead and zooms out to fit it — the only path here that changes the zoom.
   */
  const revealNode = useCallback((id: string, forceCenter = false) => {
    // - a node added this tick is in the canvas mirror before it is in the RF array
    const lookup = (nid: string): Node | undefined => {
      const rf = nodesRef.current.find(n => n.id === nid);
      if (rf) return rf;
      const cn = canvasRef.current.nodes.find(n => n.id === nid);
      return cn ? toFlowNode(cn) : undefined;
    };
    const node = lookup(id);
    if (!node) return;
    const nw = (n: Node) => Number(n.style?.width  ?? 200);
    const nh = (n: Node) => Number(n.style?.height ?? 150);
    const box = (n: Node) => ({ x1: n.position.x, y1: n.position.y, x2: n.position.x + nw(n), y2: n.position.y + nh(n) });
    const nodeBox = box(node);
    const outId = (node.data as { outputNodeId?: string } | undefined)?.outputNodeId;
    const out = outId ? lookup(outId) : undefined;
    const outBox = out ? box(out) : null;
    const pairBox = outBox && {
      x1: Math.min(nodeBox.x1, outBox.x1), y1: Math.min(nodeBox.y1, outBox.y1),
      x2: Math.max(nodeBox.x2, outBox.x2), y2: Math.max(nodeBox.y2, outBox.y2),
    };

    if (!wrapperRef.current) return;   // - before the pane mounts there is nothing to pan into
    const area = paneArea(wrapperRef.current);
    const { x: vx, y: vy, zoom } = rfRef.current.getViewport();

    if (forceCenter) {
      const b = pairBox ?? nodeBox;
      const fit = pairBox
        ? Math.max(MIN_ZOOM, Math.min(zoom, Math.min((area.right - area.left) / (b.x2 - b.x1 + 160), (area.bottom - area.top) / (b.y2 - b.y1 + 160))))
        : zoom;
      const cForce = clampCam(
        (area.left + area.right) / 2 - ((b.x1 + b.x2) / 2) * fit,
        (area.top + area.bottom) / 2 - ((b.y1 + b.y2) / 2) * fit,
        fit,
      );
      rfRef.current.setViewport({ x: cForce.x, y: cForce.y, zoom: fit }, { duration: CAMERA_MS });
      return;
    }

    const p = revealPan(nodeBox, pairBox, area, { x: vx, y: vy, zoom });
    if (!p) return;
    const cMin = clampCam(p.x, p.y, zoom);
    rfRef.current.setViewport({ x: cMin.x, y: cMin.y, zoom }, { duration: CAMERA_MS });
  }, [clampCam]); // - nodesRef / rfRef / wrapperRef are always current

  /**
   * Stores the node focus is leaving in the `` ` `` register, so `` ` ` `` goes back to it.
   * Called by every focus change; re-focusing the same node is not one.
   */
  const recordPreviousPosition = useCallback((nextId: string) => {
    const previous = lastFocusedNodeId.get(canvasPath);
    if (!previous || previous === nextId) return;
    // - the viewport is the one we are leaving; only named marks restore a camera, `` ` ` `` reveals
    marksRef.current = { ...marksRef.current, '`': { nodeId: previous, viewport: rfRef.current.getViewport() } };
  }, [canvasPath]);

  /**
   * Select + DOM-focus a node by id, reveal it, and persist the id in lastFocusedNodeId for
   * restoration.
   */
  const focusNodeById = useCallback((id: string, forceCenter = false) => {
    recordPreviousPosition(id);
    lastFocusedNodeId.set(canvasPath, id);
    setNodes(nds => nds.map(n => ({ ...n, selected: n.id === id })));
    window.dispatchEvent(new CustomEvent('skena:focusNode', { detail: { id } }));
    revealNode(id, forceCenter);
  }, [setNodes, canvasPath, revealNode, recordPreviousPosition]);

  // - a plain click reveals the node it hit, the same pan the keyboard gets. Selection stays React
  //   Flow's, so a modifier click (add to selection) must not pan; React Flow does not fire this
  //   after a drag. An already-selected node does not pan either: a double-click to enter the editor
  //   delivers two clicks first, and the second would pan under the cursor.
  const onNodeClick = useCallback((e: React.MouseEvent, n: Node) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey || isBandType(n.type)) return;
    recordPreviousPosition(n.id);              // - a click is a jump too, so `` ` ` `` comes back from it
    lastFocusedNodeId.set(canvasPath, n.id);   // - a reload restores the node last clicked, not last keyed
    if (n.selected) return;
    revealNode(n.id);
  }, [revealNode, canvasPath, recordPreviousPosition]);

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
      if (isBandType(n.type)) continue;
      const cx   = n.position.x + Number(n.style?.width  ?? 200) / 2;
      const cy   = n.position.y + Number(n.style?.height ?? 150) / 2;
      const dist = Math.hypot(cx - vpCx, cy - vpCy);
      if (dist < bestDist) { bestDist = dist; bestId = n.id; }
    }
    return bestId;
  }, []); // - rfRef + nodesRef always current

  // - jump to a named mark: restore its viewport, then focus its node (which records `` ` ``)
  const jumpToMark = useCallback((register: string) => {
    const target = marksRef.current[register];
    if (!target) return;
    // - abort if the marked node was deleted since
    if (target.nodeId !== null && !nodesRef.current.some(n => n.id === target.nodeId)) return;
    const cMark = clampCam(target.viewport.x, target.viewport.y, target.viewport.zoom);
    rfRef.current.setViewport({ x: cMark.x, y: cMark.y, zoom: target.viewport.zoom }, { duration: CAMERA_MS });
    if (target.nodeId) {
      const id = target.nodeId;
      setTimeout(() => focusNodeById(id), 320);
    }
    setMarksOpen(false);
  }, [focusNodeById, clampCam]);

  /**
   * `` ` ` ``: back to the node focus came from. It only reveals that node — the minimal pan at the
   * current zoom — where a named mark also restores the camera it was set with. The jump is itself
   * a focus change, so the register then holds the node left behind and `` ` ` `` returns.
   */
  const jumpToPreviousNode = useCallback(() => {
    const previous = marksRef.current['`']?.nodeId;
    if (!previous || !nodesRef.current.some(n => n.id === previous)) return;
    focusNodeById(previous);
    setMarksOpen(false);
  }, [focusNodeById]);

  // - one entry point for `{x} and the marks panel: `` ` `` is the previous node, the rest are marks
  const jumpToRegister = useCallback((register: string) => {
    if (register === '`') jumpToPreviousNode();
    else jumpToMark(register);
  }, [jumpToPreviousNode, jumpToMark]);

  // - per-lane count of nodes handlePickSection can actually focus: memberIds includes band (group)
  //   nodes, which a pick skips, so the marks panel row and the folded band both read from here
  const laneFocusableCounts = useMemo(() => {
    const band = new Set(nodes.filter(n => isBandType(n.type)).map(n => n.id));
    return new Map(derivedLanes.map(l => [l.id, l.memberIds.filter(id => !band.has(id)).length]));
  }, [derivedLanes, nodes]);

  // - the section rows of the marks panel: stack order, the rail's title for an untitled one
  const marksSections = useMemo<SectionEntry[]>(() => derivedLanes.map(l => ({
    id: l.id, label: l.label, title: l.title?.trim() || fmtDateTime(l.createdAt),
    count: laneFocusableCounts.get(l.id) ?? 0, folded: !!l.folded,
  })), [derivedLanes, laneFocusableCounts]);

  /**
   * Go to a section from the marks panel: unfold it when folded, then focus its first node (by y,
   * then x). An empty section only unfolds, and the camera pans to its top instead. The focus waits
   * a frame because the unfold moves the nodes below in this tick.
   */
  const handlePickSection = useCallback((id: string) => {
    setMarksOpen(false);
    const lane = derivedLanes.find(l => l.id === id);
    if (!lane) return;
    if (lane.folded) foldLaneRef.current(id);   // - the same action unfolds
    const members = new Set(lane.memberIds);
    const first = nodes
      .filter(n => members.has(n.id) && !isBandType(n.type))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)[0];
    if (first) {
      requestAnimationFrame(() => focusNodeById(first.id));
      return;
    }
    if (!rfRef.current) return;
    const { x, zoom } = rfRef.current.getViewport();
    const c = clampCam(x, -lane.top * zoom, zoom);
    rfRef.current.setViewport({ x: c.x, y: c.y, zoom }, { duration: CAMERA_MS });
  }, [derivedLanes, nodes, focusNodeById, clampCam]);

  // ─── add text node in direction (shared by keyboard and VS Code command paths) ─

  /**
   * Creates an empty TextNode connected to the currently focused node,
   * placed in direction dir (H=left, J=down, K=up, L=right), collision-free.
   * Reuses the skena:addNodeResult handler for wiring (nodes, edges, save, focus, autoEdit).
   */
  const addTextNodeInDirection = useCallback((dir: 'H' | 'J' | 'K' | 'L') => {
    const current = nodesRef.current.find(n => n.selected && !isBandType(n.type));
    if (!current) return;

    const cw = Number(current.style?.width  ?? 400);
    const ch = Number(current.style?.height ?? 300);
    const nw = NEW_NODE_W, nh = NEW_NODE_H, GAP = NEW_NODE_GAP;

    const dirMap: Record<string, { dx: number; dy: number; pushX: -1|0|1; pushY: -1|0|1; fromSide: NodeSide; toSide: NodeSide }> = {
      L: { dx:  cw + GAP, dy: 0,         pushX:  1, pushY:  0, fromSide: 'right',  toSide: 'left'   },
      H: { dx: -nw - GAP, dy: 0,         pushX: -1, pushY:  0, fromSide: 'left',   toSide: 'right'  },
      J: { dx: 0,         dy:  ch + GAP, pushX:  0, pushY:  1, fromSide: 'bottom', toSide: 'top'    },
      K: { dx: 0,         dy: -nh - GAP, pushX:  0, pushY: -1, fromSide: 'top',    toSide: 'bottom' },
    };
    const { dx, dy, pushX, pushY, fromSide, toSide } = dirMap[dir];

    // - in a section the engine owns the spot: J is the next row of the anchor's own column, one gap
    //   under it (the same `o` a code cell gets); H / K / L take the column slot beside or above the
    //   anchor. A slot another node holds is no reason to look further out — the pack puts the new
    //   node under its occupant, and on an exact y tie the mover wins and the occupant moves down.
    //   No section: the free-slot search, as before.
    const section = engineNodesOf({ nodeId: current.id });
    const slot = section && (dir === 'J'
      ? insertAfter(section, current.id)
      : directionSlot(dir, { x: current.position.x, y: current.position.y, w: cw }, nw, nh));
    // - no column left of x 0, no row above y 0: nothing is added
    if (section && !slot) return;
    const rawX = current.position.x + dx;
    const rawY = current.position.y + dy;
    const { x, y } = slot ?? findFreePosition(nodesRef.current, rawX, rawY, nw, nh, pushX, pushY);

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
      detail: { type: 'addNodeResult', node: newTextNode, edge: newTextEdge, autoEdit: true, anchorId: current.id } satisfies MsgAddNodeResult,
    }));
  }, [engineNodesOf]); // - nodesRef is always current; engineNodesOf never changes identity

  // - VS Code command path for Ctrl+Shift+J / Ctrl+Shift+K (intercepted before webview)
  useEffect(() => {
    const handler = (e: Event) => {
      const { direction } = (e as CustomEvent<{ direction: 'H' | 'J' | 'K' | 'L' }>).detail;
      addTextNodeInDirection(direction);
    };
    window.addEventListener('skena:addTextNodeTrigger', handler);
    return () => window.removeEventListener('skena:addTextNodeTrigger', handler);
  }, [addTextNodeInDirection]);

  // - "Skena: Add Kernel" command → place the kernel at the CURRENT viewport centre (so it lands where
  //   you're looking, not off near the last node). App relays the command as this window event.
  useEffect(() => {
    const handler = () => {
      const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
      const cx = (window.innerWidth  / 2 - vx) / zoom;
      const cy = (window.innerHeight / 2 - vy) / zoom;
      vscodePostMessage({ type: 'addKernel', position: { x: Math.round(cx - 70), y: Math.round(cy - 80) } });
    };
    window.addEventListener('skena:addKernelRequest', handler);
    return () => window.removeEventListener('skena:addKernelRequest', handler);
  }, []); // - rfRef is always current

  // ─── context menu handlers ────────────────────────────────────────────────

  // - stable close handler — identity never changes, so ContextMenu never re-registers its effects
  const handleMenuClose = useCallback(() => setContextMenu(null), []);

  // - read flow position from ref — never goes stale regardless of contextMenu state
  const handleMenuAddText = useCallback(() => {
    const { flowX, flowY } = contextMenuFlowPos.current;
    const nodeId = `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newNode: CanvasNode = {
      id: nodeId, type: 'text', text: '',
      x: Math.round(flowX - NODE_SIZE.text.w / 2), y: Math.round(flowY - NODE_SIZE.text.h / 2),
      width: NODE_SIZE.text.w, height: NODE_SIZE.text.h,
    };
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node: newNode, autoEdit: true } satisfies MsgAddNodeResult,
    }));
  }, []); // - no deps: reads ref, not state

  const handleMenuAddCodeCell = useCallback(() => {
    const { flowX, flowY } = contextMenuFlowPos.current;
    const nodeId = `code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newNode: CanvasNode = {
      id: nodeId, type: 'code', code: '', language: 'python',
      x: Math.round(flowX - NODE_SIZE.code.w / 2), y: Math.round(flowY - NODE_SIZE.code.h / 2),
      width: NODE_SIZE.code.w, height: NODE_SIZE.code.h,
    };
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node: newNode, autoEdit: true } satisfies MsgAddNodeResult,
    }));
  }, []); // - no deps: reads ref, not state

  // - context menu → open the Add-Kernel QuickPick, placing the kernel centred on the right-click
  //   point (140×160). The host QuickPick runs, then sends addNodeResult back.
  const handleMenuAddKernel = useCallback(() => {
    const { flowX, flowY } = contextMenuFlowPos.current;
    vscodePostMessage({ type: 'addKernel', position: { x: Math.round(flowX - 70), y: Math.round(flowY - 80) } });
  }, []); // - reads ref, not state

  const handleMenuAddUrl = useCallback((url: string) => {
    const { flowX, flowY } = contextMenuFlowPos.current;
    const nodeId = `node-${Date.now()}`;
    const newNode: CanvasNode = {
      id: nodeId, type: 'link', url,
      x: Math.round(flowX - NODE_SIZE.link.w / 2), y: Math.round(flowY - NODE_SIZE.link.h / 2),
      width: NODE_SIZE.link.w, height: NODE_SIZE.link.h,
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
    const selectedNodes = nodesRef.current.filter(n => n.selected && !isBandType(n.type));
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map(n => n.id));
    clipboard = {
      nodes: canvasRef.current.nodes.filter(n => selectedIds.has(n.id)),
      edges: canvasRef.current.edges.filter(e => selectedIds.has(e.fromNode) && selectedIds.has(e.toNode)),
    };
    // - snapshot OS clipboard so Ctrl+V can tell "yy then paste" from "external copy then paste"
    awaitingYYSnapshot.current = true;
    vscodePostMessage({ type: 'requestClipboardRead' });
  }, []);

  // - copy a cross-canvas reference to the single selected node (same action as the c,c hotkey)
  const handleCopyNodeReference = useCallback(() => {
    const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
    const label = focused ? (focused.data as Record<string, unknown>).nodeLabel as string | undefined : undefined;
    if (focused && label) vscodePostMessage({ type: 'copyNodeReference', label });
  }, []);

  // - paste the internal node clipboard (filled by yy/copy); inline nodes+edges with fresh ids
  const pasteInternalClipboard = useCallback(() => {
    if (!clipboard) return;
    const idMap = new Map<string, string>();
    clipboard.nodes.forEach((n, i) => idMap.set(n.id, `node-paste-${Date.now()}-${i}`));

    // - the group moves as a block, so its top-left and size come from its bounding box
    const minX   = Math.min(...clipboard.nodes.map(n => n.x));
    const minY   = Math.min(...clipboard.nodes.map(n => n.y));
    const groupW = Math.max(...clipboard.nodes.map(n => n.x + n.width))  - minX;
    const groupH = Math.max(...clipboard.nodes.map(n => n.y + n.height)) - minY;

    // - the anchor is the focused node, not the copied one: the copy may sit far away or in
    // - another section, and the paste has to land where the user is looking
    const anchor = nodesRef.current.find(n => n.selected && !isBandType(n.type));
    let target: { x: number; y: number };
    if (anchor) {
      // - the slot one gap right of the anchor, the same one `Alt+X l` adds into. A node already
      // - sitting there is no reason to look further along the row: the engine below runs with the
      // - group as the mover and moves what it covers. Null only when the slot falls outside the
      // - canvas, which an 'L' slot right of a clamped anchor cannot.
      const anchorW = Number(anchor.style?.width ?? 200);
      const slot = directionSlot('L', { x: anchor.position.x, y: anchor.position.y, w: anchorW }, groupW, groupH);
      target = slot ?? findFreePosition(nodesRef.current, anchor.position.x + anchorW + GRID, anchor.position.y, groupW, groupH, 1, 0);
    } else {
      // - no focus: centre on the React Flow pane, which starts right of the rail
      if (!wrapperRef.current) return;   // - before the pane mounts there is nowhere to centre on
      const rect = wrapperRef.current.getBoundingClientRect();
      const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
      const cx = (rect.width  / 2 - vx) / zoom - groupW / 2;
      const cy = (rect.height / 2 - vy) / zoom - groupH / 2;
      target = clampToOrigin(snapGrid(cx), snapGrid(cy));
    }
    const dx = target.x - minX;
    const dy = target.y - minY;
    pushHistory();

    // - pasted nodes get new IDs and fresh labels (copies aren't the same node)
    const rawPasted: CanvasNode[] = clipboard.nodes.map(n => ({
      ...n, id: idMap.get(n.id)!, x: n.x + dx, y: n.y + dy,
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
      ...canvasRef.current,   // - keep metadata/viewport/counter: only nodes and edges changed
      nodes: [...canvasRef.current.nodes, ...newNodes],
      edges: [...canvasRef.current.edges, ...newEdges],
    };
    scheduleSave();
    // - clipboard order is arbitrary; the top-left node is the one the eye starts from
    const topLeft = newNodes.reduce<CanvasNode | undefined>((a, b) => !a || b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a, undefined);
    // - the whole paste is the mover: it stays where it landed and pushes what it covers. Pasted
    //   beside a focused node, the group joins THAT node's section whatever its y. Pane-centred, the
    //   group lands by y and can straddle a boundary, so the engine runs once per section it
    //   reached, as a move does — it lays out one section per call.
    if (topLeft) {
      const ids = newNodes.map(n => n.id);
      if (anchor) runEngine({ nodeId: anchor.id }, { moverIds: ids, extraIds: ids });
      else {
        const lanes = deriveLanes(canvasRef.current.nodes, canvasRef.current.metadata?.sections ?? []);
        for (const moverIds of groupIdsByLane(lanes, ids).values()) runEngine({ nodeId: moverIds[0] }, { moverIds });
      }
    }
    if (topLeft) requestAnimationFrame(() => revealNode(topLeft.id));
  }, [setNodes, setEdges, scheduleSave, pushHistory, revealNode, runEngine]);

  // - counts the knowledge nodes this canvas has added, so two within the same millisecond differ
  const knowledgeSeq = useRef(0);

  // - a knowledge hit lands where a paste would: the slot right of the focused node, or the pane
  //   centre with nothing focused. The height stays 300 — a knowledge node is not measured after
  //   render, only a code cell is.
  const placeKnowledgeNode = useCallback((hit: KnowledgeHit, text: KnowledgeText) => {
    const { w, h } = NODE_SIZE.knowledge;
    const anchor = nodesRef.current.find(n => n.selected && !isBandType(n.type));
    let target: { x: number; y: number };
    if (anchor) {
      const anchorW = Number(anchor.style?.width ?? 200);
      const slot = directionSlot('L', { x: anchor.position.x, y: anchor.position.y, w: anchorW }, w, h);
      target = slot ?? findFreePosition(nodesRef.current, anchor.position.x + anchorW + GRID, anchor.position.y, w, h, 1, 0);
    } else {
      if (!wrapperRef.current) return;   // - before the pane mounts there is nowhere to centre on
      const rect = wrapperRef.current.getBoundingClientRect();
      const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
      const cx = (rect.width  / 2 - vx) / zoom - w / 2;
      const cy = (rect.height / 2 - vy) / zoom - h / 2;
      target = clampToOrigin(snapGrid(cx), snapGrid(cy));
    }
    const cn: KnowledgeNode = {
      id: `knowledge-${Date.now()}-${knowledgeSeq.current++}`, type: 'knowledge',
      x: target.x, y: target.y, width: w, height: h,
      server: hit.server, uri: hit.uri, title: text.title || hit.title,
      text: text.text, fetchedAt: text.fetchedAt,
    };
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node: cn, anchorId: anchor?.id } satisfies MsgAddNodeResult,
    }));
  }, []); // - no deps: reads refs, not state

  // - one count of the picks this canvas has started; closing the dialog bumps it, so the fetch
  //   a closed dialog left in flight adds nothing when it lands
  const pickSeq = useRef(0);
  const closeKnowledge = useCallback(() => { pickSeq.current++; setKnowledgeOpen(false); }, []);

  // - Enter in the knowledge dialog. Without the text (the preview had not fetched it yet) the node
  //   would cache nothing, so fetch first and keep the dialog open until the text is in hand.
  const handleKnowledgePick = useCallback((hit: KnowledgeHit, text: KnowledgeText | null) => {
    if (text) { placeKnowledgeNode(hit, text); setKnowledgeOpen(false); return; }
    // - a timestamp id never equals the dialog's own counter, so it ignores this answer
    const requestId = Date.now();
    const seq = pickSeq.current;
    const onResult = (e: Event) => {
      const msg = (e as CustomEvent<MsgKnowledgeFetchResult>).detail;
      if (msg.requestId !== requestId) return;
      window.removeEventListener('skena:knowledgeFetchResult', onResult);
      if (seq !== pickSeq.current) return;   // - Esc came first: this pick was called off
      if (msg.error || !msg.text) {
        window.dispatchEvent(new CustomEvent('skena:knowledgePickError', { detail: { message: msg.error ?? 'no text' } }));
        return;
      }
      placeKnowledgeNode(hit, msg.text);
      setKnowledgeOpen(false);
    };
    window.addEventListener('skena:knowledgeFetchResult', onResult);
    vscodePostMessage({ type: 'knowledgeFetch', requestId, server: hit.server, uri: hit.uri });
  }, [placeKnowledgeNode]);

  // - the knowledge nodes of this canvas, as the refresh runner takes them
  const knowledgeTargets = useCallback((): RefreshTarget[] =>
    canvasRef.current.nodes
      .filter((n): n is KnowledgeNode => n.type === 'knowledge')
      .map(n => ({ id: n.id, server: n.server, uri: n.uri, text: n.text, fetchedAt: n.fetchedAt })),
  []); // - canvasRef is a ref, always current

  // - the host runs one refresh per canvas and a second request cancels the first, so a node's
  //   button pressed while the open-canvas refresh is still running waits its turn instead of
  //   cutting that run short. The host says when it is done; the waiting targets go then.
  const refreshRunning = useRef(false);
  const refreshQueued  = useRef<RefreshTarget[]>([]);

  const postKnowledgeRefresh = useCallback((targets: RefreshTarget[]) => {
    if (targets.length === 0) return;
    if (refreshRunning.current) { refreshQueued.current.push(...targets); return; }
    refreshRunning.current = true;
    vscodePostMessage({
      type: 'knowledgeRefresh',
      nodes: targets.map(({ id, server, uri, text }) => ({ id, server, uri, text })),
    } satisfies MsgKnowledgeRefresh);
  }, []);

  // - on open, after the canvas is painted: the host answers knowledgeServers with the hours a
  //   copy may keep, and the copies older than that go back to it to be fetched again
  useEffect(() => {
    const onServers = (e: Event) => {
      window.removeEventListener('skena:knowledgeServersResult', onServers);
      const { refreshAfterHours } = (e as CustomEvent<MsgKnowledgeServersResult>).detail;
      postKnowledgeRefresh(staleTargets(knowledgeTargets(), new Date(), refreshAfterHours));
    };
    const frame = requestAnimationFrame(() => {
      if (knowledgeTargets().length === 0) return;   // - no knowledge node: nothing to ask about
      window.addEventListener('skena:knowledgeServersResult', onServers);
      vscodePostMessage({ type: 'knowledgeServers' });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('skena:knowledgeServersResult', onServers);
    };
  }, [knowledgeTargets, postKnowledgeRefresh]);

  // - the node's own refresh button: that one node, however fresh its copy is
  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      const target = knowledgeTargets().find(t => t.id === id);
      if (target) postKnowledgeRefresh([target]);
    };
    window.addEventListener('skena:knowledgeRefresh', handler);
    return () => window.removeEventListener('skena:knowledgeRefresh', handler);
  }, [knowledgeTargets, postKnowledgeRefresh]);

  // - a batch of refresh outcomes. Only the fields the host sent move: a failed fetch keeps the
  //   cached text and shows its reason, a successful one clears a previous reason. No history
  //   entry — the user did nothing to undo.
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodes: batch, done: finished } = (e as CustomEvent<MsgKnowledgeRefreshed>).detail;
      if (finished) {
        refreshRunning.current = false;
        // - by id: the same node clicked twice while waiting is fetched once
        const queued = [...new Map(refreshQueued.current.map(t => [t.id, t])).values()];
        refreshQueued.current = [];
        if (queued.length > 0) postKnowledgeRefresh(queued);
      }
      const byId = new Map(batch.map(o => [o.id, o]));
      const fields = (o: RefreshOutcome) => ({
        ...(o.text      !== undefined ? { text:      o.text }      : {}),
        ...(o.title     !== undefined ? { title:     o.title }     : {}),
        ...(o.fetchedAt !== undefined ? { fetchedAt: o.fetchedAt } : {}),
        ...(o.changed   !== undefined ? { changed:   o.changed }   : {}),
        error: o.error,
      });
      let touched = false;
      const nextNodes = canvasRef.current.nodes.map(n => {
        const o = n.type === 'knowledge' ? byId.get(n.id) : undefined;
        if (!o) return n;
        touched = true;
        return { ...n, ...fields(o) };
      });
      if (!touched) return;
      canvasRef.current = { ...canvasRef.current, nodes: nextNodes };
      setNodes(nds => nds.map(n => {
        const o = n.type === 'knowledge' ? byId.get(n.id) : undefined;
        return o ? { ...n, data: { ...n.data, ...fields(o) } } : n;
      }));
      scheduleSave();
    };
    window.addEventListener('skena:knowledgeRefreshed', handler);
    return () => window.removeEventListener('skena:knowledgeRefreshed', handler);
  }, [setNodes, scheduleSave, postKnowledgeRefresh]);

  // - the dot means "the server's text moved since you last read this node"; selecting the node is
  //   that read, so it goes away
  useEffect(() => {
    const ids = new Set(
      nodesRef.current
        .filter(n => n.selected && n.type === 'knowledge' && (n.data as unknown as KnowledgeNode).changed)
        .map(n => n.id),
    );
    if (ids.size === 0) return;
    canvasRef.current = {
      ...canvasRef.current,
      nodes: canvasRef.current.nodes.map(n => (ids.has(n.id) && n.type === 'knowledge' ? { ...n, changed: false } : n)),
    };
    setNodes(nds => nds.map(n => (ids.has(n.id) ? { ...n, data: { ...n.data, changed: false } } : n)));
    scheduleSave();
  // - the selected ids and their marks, not the whole array: a drag must not re-run this, but a
  //   refresh landing on a node that is already selected must
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.map(n => n.selected ? `${n.id}:${(n.data as unknown as KnowledgeNode).changed ? 1 : 0}` : '').join(','), setNodes, scheduleSave]);

  const handleMoveToSubCanvas = useCallback(() => {
    const selectedNodes = nodesRef.current.filter(n => n.selected && !isBandType(n.type));
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

  // - delete all currently selected (non-group) nodes and their connected edges.
  // - mirrors onNodesDelete logic but triggered imperatively (e.g. dd shortcut).
  const performDelete = useCallback((toDelete: Node[]) => {
    if (toDelete.length === 0) return;

    pushHistory();
    const deletedIds = new Set(toDelete.map(n => n.id));
    for (const id of deletedIds) spaceSelectedRef.current.delete(id);
    const holes = columnsOfDeleted(deletedIds);
    const sectionOf = sectionOfNodes();

    // - a surviving cell an edge held on a deleted cell's row is released and packs up (§3.5)
    const released = anchoredBy(canvasRef.current.edges.filter(e => deletedIds.has(e.fromNode) || deletedIds.has(e.toNode)))
      .filter(id => !deletedIds.has(id));
    const updated: CanvasData = {
      ...canvasRef.current,                                                                       // - preserve viewport, metadata, etc.
      nodes: canvasRef.current.nodes.filter(n => !deletedIds.has(n.id)),
      edges: canvasRef.current.edges.filter(e => !deletedIds.has(e.fromNode) && !deletedIds.has(e.toNode)),
    };
    canvasRef.current = updated;
    pruneFolded(deletedIds);

    // - #2: deleting a code cell's OUTPUT node → focus its code node (same as onNodesDelete),
    // - clearing the code node's outputNodeId so a re-run creates a fresh output.
    const ownerCode = nodesRef.current.find(n =>
      n.type === 'code' && !deletedIds.has(n.id) &&
      deletedIds.has((n.data as { outputNodeId?: string } | undefined)?.outputNodeId ?? ''));
    if (ownerCode) {
      const id = ownerCode.id;
      canvasRef.current = {
        ...canvasRef.current,
        nodes: canvasRef.current.nodes.map(n => n.id === id ? { ...n, outputNodeId: undefined } as CanvasNode : n),
      };
      setNodes(nds => nds.filter(n => !deletedIds.has(n.id)).map(n => n.id === id ? { ...n, data: { ...n.data, outputNodeId: undefined } } : n));
      setEdges(eds => eds.filter(e => !deletedIds.has(e.source) && !deletedIds.has(e.target)));
      scheduleSave();
      for (const h of holes) runEngine({ sectionId: h.sectionId }, { columnX: h.columnX });
      runEngineForCells(released);
      requestAnimationFrame(() => focusNodeById(id));
      return;
    }
    setNodes(nds => nds.filter(n => !deletedIds.has(n.id)));
    setEdges(eds => eds.filter(e => !deletedIds.has(e.source) && !deletedIds.has(e.target)));
    scheduleSave();
    // - the column closes the hole the delete left; nothing else moves
    for (const h of holes) runEngine({ sectionId: h.sectionId }, { columnX: h.columnX });
    runEngineForCells(released);

    // - focus the nearest surviving node (same logic as onNodesDelete)
    const bestId = nextFocusAfterDelete(toDelete, sectionOf);
    if (bestId) { const id = bestId; requestAnimationFrame(() => focusNodeById(id)); }
  }, [setNodes, setEdges, pushHistory, scheduleSave, focusNodeById, pruneFolded, runEngine, columnsOfDeleted, sectionOfNodes, nextFocusAfterDelete, anchoredBy, runEngineForCells]);

  // - confirm a destructive delete via a host modal; resolves when doDelete arrives
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  // - published for handleDeleteLane, which is declared above this point
  const confirmDeleteViaHost = useCallback((nodeIds: string[], reason: string) => new Promise<boolean>(resolve => {
    confirmResolveRef.current?.(false);   // - abandon any prior pending confirm
    confirmResolveRef.current = resolve;
    vscodePostMessage({ type: 'confirmDelete', nodeIds, reason });
  }), []);
  useEffect(() => {
    const onDo = (e: Event) => {
      const confirmed = (e as CustomEvent<{ confirmed: boolean }>).detail?.confirmed ?? false;
      const r = confirmResolveRef.current;
      confirmResolveRef.current = null;
      r?.(confirmed);
    };
    window.addEventListener('skena:doDelete', onDo);
    return () => window.removeEventListener('skena:doDelete', onDo);
  }, []);

  const activeKernelReason = (nodes: Node[]): string | null => {
    const active = nodes.filter(n => n.type === 'kernel' && (n.data as { kernelId?: string } | undefined)?.kernelId);
    if (!active.length) return null;
    return active.length > 1
      ? `Delete ${active.length} active kernel nodes? Their kernels keep running on the server.`
      : 'Delete this active kernel node? The kernel keeps running on the server.';
  };

  const deleteSelectedNodes = useCallback(async () => {
    const toDelete = nodesRef.current.filter(n => n.selected && !isBandType(n.type));
    if (toDelete.length === 0) return;
    const reason = activeKernelReason(toDelete);
    if (reason && !(await confirmDeleteViaHost(toDelete.map(n => n.id), reason))) return;
    performDelete(toDelete);
  }, [performDelete, confirmDeleteViaHost]);

  // - React Flow's native delete (Delete key) routes through here. Protect the code→output
  // - edge (#1) and confirm active-kernel deletion (prev round). Return false to cancel,
  // - or a filtered {nodes, edges} to delete a subset.
  const onBeforeDelete = useCallback(async ({ nodes: dn, edges: de }: { nodes: Node[]; edges: Edge[] }) => {
    const all = rfRef.current.getNodes();
    const delNodeIds = new Set(dn.map(n => n.id));
    // - code→output edges (both directions) whose endpoints both survive → protected
    const outputPairs = new Set<string>();
    for (const n of all) {
      const oid = (n.data as { outputNodeId?: string } | undefined)?.outputNodeId;
      if (n.type === 'code' && oid) { outputPairs.add(`${n.id}|${oid}`); outputPairs.add(`${oid}|${n.id}`); }
    }
    const allowedEdges = de.filter(e => {
      if (!outputPairs.has(`${e.source}|${e.target}`)) return true;
      return delNodeIds.has(e.source) || delNodeIds.has(e.target);  // - allow if an endpoint is going too
    });
    const reason = activeKernelReason(dn);
    if (reason && !(await confirmDeleteViaHost(dn.map(n => n.id), reason))) return false;
    return allowedEdges.length === de.length ? true : { nodes: dn, edges: allowedEdges };
  }, [confirmDeleteViaHost]);
  useEffect(() => { confirmLaneDeleteRef.current = confirmDeleteViaHost; }, [confirmDeleteViaHost]);

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

    // - band nodes are backdrops, never nav targets; the rest map into the pure finder, which
    //   derives the folded (hidden) ids from the lanes itself
    const toNav = (n: Node): NavNode => ({
      id: n.id, x: n.position.x, y: n.position.y,
      w: Number(n.style?.width ?? 200), h: Number(n.style?.height ?? 150),
    });

    const focusedNode = () => nodesRef.current.find(n => n.selected && !isBandType(n.type));

    // - what the follow reads: every visible node, every edge, and the routes of the last pass. A band
    //   node is a backdrop and a folded member is hidden, so neither is a landing place.
    const sideContext = (): EdgeSideContext => ({
      nodes: nodesRef.current.filter(n => !isBandType(n.type) && !hiddenByFoldRef.current.has(n.id)).map(toNav),
      edges: edgesRef.current,
      routes: routesRef.current,
    });

    /**
     * What `g` puts on screen and what the next key means: one badge per connection of the focused
     * node, on all four borders, carrying the key that follows it (see `connectionLabels`). A
     * connection the routing pass did not route has no exit point of its own; its badge is spread
     * along the border the way the router spreads the ones it does route.
     */
    const connectionBadges = (): { hints: EdgeHint[]; byLabel: Map<string, string> } => {
      const from = focusedNode();
      if (!from) return { hints: [], byLabel: new Map() };
      const geom = toNav(from);
      const labels = connectionLabels(geom, sideContext());
      const bySide = new Map<Side, ConnectionLabel[]>();
      for (const c of labels) {
        const list = bySide.get(c.side);
        if (list) list.push(c); else bySide.set(c.side, [c]);
      }
      const hints: EdgeHint[] = [];
      for (const [side, list] of bySide) list.forEach((c, i) => {
        const at = c.at ?? borderPoint(geom, side, (i - (list.length - 1) / 2) * LANE_STEP);
        hints.push({ key: `${side}:${c.edgeId ?? c.nodeId}`, label: c.label, x: at[0], y: at[1], side });
      });
      return { hints, byLabel: new Map(labels.map(c => [c.label, c.nodeId])) };
    };

    // - arm the g chord and show the labels. Reading one and typing it takes longer than the second
    //   key of a plain chord, so the window only stretches to G_HINT_MS when there is something to
    //   read; a node with no connection keeps the old 400 ms.
    const armG = () => {
      const { hints, byLabel } = connectionBadges();
      lastGPressRef.current = Date.now();
      gWindowRef.current = hints.length > 0 ? G_HINT_MS : G_CHORD_MS;
      gLabelsRef.current = byLabel;
      if (gHintTimerRef.current) clearTimeout(gHintTimerRef.current);
      gHintTimerRef.current = null;
      setGHints(h => (hints.length === 0 && h.length === 0 ? h : hints));
      if (hints.length > 0) gHintTimerRef.current = setTimeout(() => { lastGPressRef.current = 0; setGHints([]); }, G_HINT_MS);
    };

    const disarmG = () => {
      lastGPressRef.current = 0;
      gLabelsRef.current = EMPTY_LABELS;
      if (gHintTimerRef.current) { clearTimeout(gHintTimerRef.current); gHintTimerRef.current = null; }
      setGHints(h => (h.length === 0 ? h : []));
    };

    // - the section the keys act on: the focused node's, or — after a fold dropped the selection —
    //   the one holding the node focused last
    const currentLane = () => {
      const id = focusedNode()?.id ?? lastFocusedNodeId.get(canvasPath);
      if (!id) return undefined;
      return derivedLanesRef.current.find(l => l.memberIds.includes(id));
    };

    // - gg / G: the first / last member of the current section, read in canvas order (y, then x). No
    //   focused node is not a reason to stop: currentLane falls back to the node focused last, as
    //   ( and ) do, so the keys still work after a fold dropped the selection.
    const jumpInSection = (which: 'first' | 'last') => {
      const current = focusedNode();
      const lane = currentLane();
      if (!lane) return;
      const ids = new Set(lane.memberIds);
      const members = nodesRef.current
        .filter(n => ids.has(n.id) && !isBandType(n.type) && !hiddenByFoldRef.current.has(n.id))
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
      const target = which === 'first' ? members[0] : members[members.length - 1];
      if (target && target.id !== current?.id) focusNodeById(target.id);
    };

    // - add a node off the focused node in the given direction (Alt+X chord target)
    const requestAddNodeInDirection = (key: 'H' | 'J' | 'K' | 'L') => {
      const current = nodesRef.current.find(n => n.selected && !isBandType(n.type));
      if (!current) return;
      const cw = Number(current.style?.width  ?? 400);
      const ch = Number(current.style?.height ?? 300);
      const nw = NEW_NODE_W, nh = NEW_NODE_H, GAP = NEW_NODE_GAP;
      type PD = -1 | 0 | 1;
      const dirMap: Record<string, { dx: number; dy: number; pushX: PD; pushY: PD; fromSide: NodeSide; toSide: NodeSide }> = {
        L: { dx:  cw + GAP, dy: 0,         pushX:  1, pushY:  0, fromSide: 'right',  toSide: 'left'   },
        H: { dx: -nw - GAP, dy: 0,         pushX: -1, pushY:  0, fromSide: 'left',   toSide: 'right'  },
        J: { dx: 0,         dy:  ch + GAP, pushX:  0, pushY:  1, fromSide: 'bottom', toSide: 'top'    },
        K: { dx: 0,         dy: -nh - GAP, pushX:  0, pushY: -1, fromSide: 'top',    toSide: 'bottom' },
      };
      const { dx, dy, pushX, pushY, fromSide, toSide } = dirMap[key];
      // - in a section the engine owns the spot: J is the next member of the anchor's own column,
      //   whatever the anchor is; L / H off a code cell open a new column pair right / left of its
      //   pair. Everything else takes the column slot beside or above the anchor and lets the pack
      //   sort it out — a slot another node holds puts the new node under that occupant, and on an
      //   exact y tie the mover wins and the occupant moves down. No room before the origin (a left
      //   fork, H off the first column, K off the first row) is refused: nothing is added.
      //   No section: the free-slot search, as before.
      const section = engineNodesOf({ nodeId: current.id });
      let slot: { x: number; y: number } | null = null;
      if (section) {
        slot = (key === 'L' || key === 'H') && current.type === 'code'
          ? forkOf(section, current.id, key === 'L' ? 'right' : 'left', NODE_SIZE.code.w)
          : key === 'J'
            ? insertAfter(section, current.id)
            : directionSlot(key, { x: current.position.x, y: current.position.y, w: cw }, nw, nh);
        if (!slot) return;
      }
      const { x, y } = slot ?? findFreePosition(nodesRef.current, current.position.x + dx, current.position.y + dy, nw, nh, pushX, pushY);
      const w = slot ? NODE_SIZE.code.w : nw;
      const h = slot ? NODE_SIZE.code.h : nh;
      // - go through the host so the "New text note / New URL / vault / workspace" picker opens (choose
      //   what to add); pass width/height so the chosen node gets the directional-add size.
      vscodePostMessage({ type: 'addNodeRequest', position: { x, y }, width: w, height: h, fromNodeId: current.id, fromSide, toSide });
    };

    // - scroll the focused node's content (Shift+hjkl); returns false if nothing scrollable
    const scrollFocusedNode = (key: 'H' | 'J' | 'K' | 'L'): boolean => {
      const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
      if (!focused) return false;
      const nodeEl   = document.querySelector(`.react-flow__node[data-id="${focused.id}"]`);
      const scrollEl = nodeEl?.querySelector('.skena-scrollable') as HTMLElement | null;
      if (!scrollEl) return false;
      const vScrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 1;
      const hScrollable = scrollEl.scrollWidth  > scrollEl.clientWidth  + 1;
      const vStep = scrollEl.clientHeight / 4;
      const hStep = scrollEl.clientWidth  / 4;
      switch (key) {
        case 'J': if (vScrollable) { scrollEl.scrollBy({ top:  vStep, behavior: 'smooth' }); return true; } break;
        case 'K': if (vScrollable) { scrollEl.scrollBy({ top: -vStep, behavior: 'smooth' }); return true; } break;
        case 'L': if (hScrollable) { scrollEl.scrollBy({ left:  hStep, behavior: 'smooth' }); return true; } break;
        case 'H': if (hScrollable) { scrollEl.scrollBy({ left: -hStep, behavior: 'smooth' }); return true; } break;
      }
      return false;
    };

    const handler = (e: KeyboardEvent) => {
      // - typing target: while focused in Monaco / an input, the editor owns its keys
      const active = document.activeElement;
      const inField =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        !!active?.closest('.monaco-editor');

      // - the knowledge dialog owns the keyboard while it is open: Esc closes it, Ctrl+F puts the
      // - focus back in its input, Ctrl+J/K move the highlight from wherever the focus sits in the
      // - dialog, and every other key stops here rather than reaching the canvas
      // - (a click on a result row or the preview leaves no input focused, so inField is false)
      if (knowledgeOpenRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); closeKnowledge(); return; }
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'f') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('skena:knowledgeFocus'));
        }
        // - when the input has focus, its own onKeyDown already moved the highlight and called
        // - preventDefault; only dispatch here for the case where focus sits elsewhere in the
        // - dialog (a result row, the preview), or this doubles the move
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'k') && !e.defaultPrevented) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('skena:knowledgeMove', { detail: { by: e.key === 'j' ? 1 : -1 } }));
        }
        return;
      }

      // - Ctrl+F: search the knowledge servers. NOT while editing — an editor needs its own find.
      if (!inField && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'f') {
        e.preventDefault();
        setKnowledgeOpen(true);
        return;
      }

      // - /: open the find-in-canvas bar. But NOT while editing — an editor needs its own `/`
      // - (vim search), else `/` blurs the cell and exits edit mode.
      if (!inField && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      // - don't intercept while user is typing in Monaco, an input, or textarea
      if (inField) return;

      // ── vim marks: consume second key of m{x} / `{x} sequence ──────────────
      if (pendingMarkRef.current !== null) {
        // - modifier + key is not a register (e.g. Ctrl+M opens panel, not register 'm')
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Escape')) {
          e.preventDefault();
          if (markTimerRef.current) { clearTimeout(markTimerRef.current); markTimerRef.current = null; }

          if (e.key !== 'Escape') {
            const reg = e.key;
            if (pendingMarkRef.current === 'set') {
              // - m{x}: store current node + viewport under register x
              const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
              if (focused) {
                marksRef.current = { ...marksRef.current, [reg]: { nodeId: focused.id, viewport: rfRef.current.getViewport() } };
                vscodePostMessage({ type: 'saveMarks', marks: persistedMarks(marksRef.current) });
              }
            } else {
              // - `{x}: a named mark animates the camera and focuses; `` ` ` `` goes to the previous node
              jumpToRegister(reg);
            }
          }
          pendingMarkRef.current = null;
        }
        return;
      }

      // ── Alt+X chord: consume second key (h/j/k/l → add node in that direction) ──
      if (chordRef.current) {
        if (chordTimerRef.current) { clearTimeout(chordTimerRef.current); chordTimerRef.current = null; }
        chordRef.current = false;
        e.preventDefault();
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && ['h', 'j', 'k', 'l'].includes(e.key)) {
          requestAddNodeInDirection(e.key.toUpperCase() as 'H' | 'J' | 'K' | 'L');
        }
        // - any other key silently cancels the chord (swallowed, no action)
        return;
      }

      // ── g chord: consume the second key (a connection label follows it, g jumps to the section top) ──
      if (lastGPressRef.current !== 0 && Date.now() - lastGPressRef.current < gWindowRef.current) {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.key === 'g') { disarmG(); e.preventDefault(); jumpInSection('first'); return; }
          // - h/k/l/j are labels too, so while the chord is armed they follow the first connection of
          //   their border rather than navigating; a border with none leaves the key unclaimed
          const target = e.key.length === 1 ? gLabelsRef.current.get(e.key) : undefined;
          if (target !== undefined) { disarmG(); e.preventDefault(); focusNodeById(target); return; }
        }
        // - any other key cancels the chord and is then handled normally, so plain h still
        //   navigates left; falling through is the whole point
        disarmG();
      }

      // - g: arm the chord. Nothing happens on its own, so a stray g is harmless.
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'g') {
        armG();
        return;
      }

      // - G: the last member of the current section (gg is the first)
      if (!e.ctrlKey && !e.metaKey && e.shiftKey && !e.altKey && e.key === 'G') {
        e.preventDefault();
        jumpInSection('last');
        return;
      }

      // - Shift+( / Shift+) : fold / unfold the current section — the rail chevron's own action, so
      //   both paths share the history entry
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '(' || e.key === ')')) {
        const lane = currentLane();
        if (lane && !!lane.folded === (e.key === ')')) {
          e.preventDefault();
          foldLaneRef.current(lane.id);
        }
        return;
      }

      // - Alt+X: arm the add-node chord (next h/j/k/l adds a node off the focused node)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        chordRef.current = true;
        if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
        chordTimerRef.current = setTimeout(() => { chordRef.current = false; }, 2000);
        return;
      }

      // - Ctrl+M: open bookmarks panel
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'm') {
        e.preventDefault();
        setMarksOpen(true);
        return;
      }

      // - Ctrl+U / Ctrl+D: scroll focused node content up / down (vim half-page)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'u' || e.key === 'd')) {
        const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
        if (focused) {
          const nodeEl  = document.querySelector(`.react-flow__node[data-id="${focused.id}"]`);
          const scrollEl = nodeEl?.querySelector('.skena-scrollable') as HTMLElement | null;
          if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 1) {
            e.preventDefault();
            scrollEl.scrollBy({ top: scrollEl.clientHeight / 4 * (e.key === 'u' ? -1 : 1), behavior: 'smooth' });
            return;
          }
        }
      }

      // - z / Z: zoom in / out centred on viewport centre
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        const STEP = 0.15;
        const { x: tx, y: ty, zoom } = rfRef.current.getViewport();
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 + STEP)));
        const scale   = newZoom / zoom;
        const cx = window.innerWidth  / 2;
        const cy = window.innerHeight / 2;
        let newTx = cx - (cx - tx) * scale;
        let newTy = cy - (cy - ty) * scale;

        // - keep the WHOLE focused node in view after zoom-in when it fits (pan just enough); if
        //   it's larger than the viewport on an axis, leave that axis alone (can't fit it)
        const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
        if (focused) {
          const nw = Number(focused.style?.width  ?? 200);
          const nh = Number(focused.style?.height ?? 150);
          const M  = 40; // - px margin from the viewport edge
          const W  = window.innerWidth, H = window.innerHeight;
          const nx1 = focused.position.x * newZoom + newTx;
          const ny1 = focused.position.y * newZoom + newTy;
          const nx2 = (focused.position.x + nw) * newZoom + newTx;
          const ny2 = (focused.position.y + nh) * newZoom + newTy;
          if (nx2 - nx1 <= W - 2 * M) {
            if (nx1 < M)          newTx += M - nx1;
            else if (nx2 > W - M) newTx -= nx2 - (W - M);
          }
          if (ny2 - ny1 <= H - 2 * M) {
            if (ny1 < M)          newTy += M - ny1;
            else if (ny2 > H - M) newTy -= ny2 - (H - M);
          }
        }

        const cZoomIn = clampCam(newTx, newTy, newZoom);
        rfRef.current.setViewport({ x: cZoomIn.x, y: cZoomIn.y, zoom: newZoom });
        return;
      }
      if (!e.ctrlKey && !e.metaKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        const STEP = 0.15;
        const { x: tx, y: ty, zoom } = rfRef.current.getViewport();
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom / (1 + STEP)));
        const scale   = newZoom / zoom;
        const cx = window.innerWidth  / 2;
        const cy = window.innerHeight / 2;
        const zx = cx - (cx - tx) * scale;
        const zy = cy - (cy - ty) * scale;
        const c  = clampCam(zx, zy, newZoom);
        rfRef.current.setViewport({ x: c.x, y: c.y, zoom: newZoom });
        return;
      }
      // - Home: pan to the content's top-left, keeping the current zoom (pan-only invariant), with a
      //   one-grid breathing margin at the left.
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'Home') {
        e.preventDefault();
        const { zoom } = rfRef.current.getViewport();
        const framed = nodesRef.current.filter(n => !isBandType(n.type));
        if (!framed.length) return;
        const minX = Math.min(...framed.map(n => n.position.x));
        const minY = Math.min(...framed.map(n => n.position.y));
        const c = clampCam((ORIGIN_GUTTER - minX) * zoom, (ORIGIN_GUTTER - minY) * zoom, zoom);
        rfRef.current.setViewport({ x: c.x, y: c.y, zoom }, { duration: CAMERA_MS });
        return;
      }

      // - Alt+Shift+C: centre the focused node on the pane at READABLE_ZOOM — a code cell's text is
      // - sized in --vscode-editor-font-size, so zoom 1 reads exactly like the VS Code editor.
      if (!e.ctrlKey && !e.metaKey && e.shiftKey && e.altKey && e.key === 'C') {
        const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
        if (focused) {
          e.preventDefault();
          if (!wrapperRef.current) return;   // - the pane sits right of the rail; without it there is no centre
          const rect = wrapperRef.current.getBoundingClientRect();
          const nw   = focused.measured?.width  ?? Number(focused.style?.width  ?? 200);
          const nh   = focused.measured?.height ?? Number(focused.style?.height ?? 150);
          const zoom = READABLE_ZOOM;
          const cAltShiftC = clampCam(
            rect.width  / 2 - (focused.position.x + nw / 2) * zoom,
            rect.height / 2 - (focused.position.y + nh / 2) * zoom,
            zoom,
          );
          rfRef.current.setViewport({ x: cAltShiftC.x, y: cAltShiftC.y, zoom }, { duration: CAMERA_MS });
        }
        return;
      }

      // - Shift+C: pan viewport to centre on the focused node (zoom unchanged)
      if (!e.ctrlKey && !e.metaKey && e.shiftKey && !e.altKey && e.key === 'C') {
        const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
        if (focused) {
          e.preventDefault();
          if (!wrapperRef.current) return;
          const rect = wrapperRef.current.getBoundingClientRect();
          const nw  = Number(focused.style?.width  ?? 200);
          const nh  = Number(focused.style?.height ?? 150);
          const { zoom } = rfRef.current.getViewport();
          const cShiftC = clampCam(
            rect.width  / 2 - (focused.position.x + nw / 2) * zoom,
            rect.height / 2 - (focused.position.y + nh / 2) * zoom,
            zoom,
          );
          rfRef.current.setViewport({ x: cShiftC.x, y: cShiftC.y, zoom }, { duration: CAMERA_MS });
        }
        return;
      }

      // - Ctrl+Shift+{H,L}: add empty text node left/right via keydown.
      // - J and K are NOT handled here — VS Code fires the command (skena.addTextNodeDown/Up)
      // - AND delivers the keydown to the webview, which would cause double node creation.
      // - J/K arrive exclusively through the skena:addTextNodeTrigger event handler below.
      if (e.ctrlKey && e.shiftKey && ['H', 'L'].includes(e.key)) {
        if (!nodesRef.current.some(n => n.selected && !isBandType(n.type))) return;
        e.preventDefault();
        addTextNodeInDirection(e.key as 'H' | 'L');
        return;
      }

      // - Shift+Alt+{h,j,k,l} (viewport pan) is handled by the capture-phase
      // - panCapture listener below — no branch here (double-delivery rule)

      // - Shift+{H,J,K,L}: move pinned nodes if any are pinned, otherwise scroll inside
      // - the focused node's content (add-node moved to the Alt+X chord)
      if (e.shiftKey && !e.altKey && ['H', 'J', 'K', 'L'].includes(e.key)) {
        // - if any nodes are space-pinned, shift+hjkl moves them by one grid step
        if (spaceSelectedRef.current.size > 0) {
          e.preventDefault();
          pushHistory();
          const dirMap: Record<string, { x: number; y: number }> = {
            H: { x: -GRID, y: 0 }, L: { x: GRID, y: 0 },
            J: { x: 0, y: GRID },  K: { x: 0, y: -GRID },
          };
          const delta = dirMap[e.key];
          // - clamp each pinned node to the origin so a keyboard move can't push it into negative
          //   space, mirroring the drag/creation clamp (the bounded-canvas invariant)
          const pinnedIds = new Set(spaceSelectedRef.current);
          const at = new Map<string, { x: number; y: number }>();
          for (const cn of canvasRef.current.nodes) {
            if (pinnedIds.has(cn.id)) at.set(cn.id, clampToOrigin(cn.x + delta.x, cn.y + delta.y));
          }
          // - an output steps with the code cell it belongs to, same as on a drag, by the cell's
          //   POST-clamp delta: at the origin wall the cell moves less than a grid (or not at all),
          //   and an output clamped on its own would creep toward it, one step per key press. An
          //   output pinned itself is stepping already.
          for (const cn of canvasRef.current.nodes) {
            if (cn.type !== 'code' || !cn.outputNodeId || !pinnedIds.has(cn.id) || pinnedIds.has(cn.outputNodeId)) continue;
            const out = canvasRef.current.nodes.find(o => o.id === cn.outputNodeId);
            const p = at.get(cn.id);
            if (!out || !p) continue;
            const dx = p.x - cn.x, dy = p.y - cn.y;
            if (dx === 0 && dy === 0) continue;
            at.set(out.id, clampToOrigin(out.x + dx, out.y + dy));
          }
          setNodes(nds => nds.map(n => {
            const p = at.get(n.id);
            return p ? { ...n, position: p } : n;
          }));
          canvasRef.current = {
            ...canvasRef.current,
            nodes: canvasRef.current.nodes.map(cn => {
              const p = at.get(cn.id);
              return p ? { ...cn, x: p.x, y: p.y } : cn;
            }),
          };
          scheduleSave();
          // - same as a mouse drop: the step may land on another node, and the engine clears it
          runEngineAfterMove(new Set(at.keys()));
          return;
        }

        // - nothing pinned → scroll the focused node's content in that direction
        e.preventDefault();
        scrollFocusedNode(e.key as 'H' | 'J' | 'K' | 'L');
        return;
      }

      // - Enter / Ctrl+Enter: open non-text selected node in VS Code editor
      // - Ctrl+Enter → modal (maximize editor group); Enter → beside preview
      if (e.key === 'Enter') {
        const current = nodesRef.current.find(n => n.selected && !isBandType(n.type));
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
        } else if (current.type === 'noderef') {
          const c = (d.canvas as string) ?? '', l = (d.label as string) ?? '';
          if (c && l) vscodePostMessage({ type: 'openFile', uri: `${c}#${l}` });
        }
        return;
      }

      // - i: same as pressing Enter on the focused node — edit text/code nodes, open file / portal /
      //   link / noderef nodes in the VS Code editor. Guarded by !inField so a plain 'i' typed inside
      //   an editor stays a normal keystroke.
      if (!inField && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'i') {
        const current = nodesRef.current.find(n => n.selected && !isBandType(n.type));
        if (!current) return;
        e.preventDefault();
        const d = current.data as Record<string, unknown>;
        if (current.type === 'text' || current.type === 'code') {
          window.dispatchEvent(new CustomEvent('skena:enterEdit', { detail: { id: current.id } }));
        } else if (current.type === 'file') {
          vscodePostMessage({ type: 'openFile', uri: (d.file as string) ?? '', modal: false });
        } else if (current.type === 'portal') {
          vscodePostMessage({ type: 'openFile', uri: (d.canvas as string) ?? '', modal: false });
        } else if (current.type === 'link') {
          const url = (d.url as string) ?? '';
          if (url) vscodePostMessage({ type: 'openFile', uri: url, modal: false });
        } else if (current.type === 'noderef') {
          const c = (d.canvas as string) ?? '', l = (d.label as string) ?? '';
          if (c && l) vscodePostMessage({ type: 'openFile', uri: `${c}#${l}` });
        }
        return;
      }

      // - o: add an empty text node below the focused node (mirrors `o` on a code node). Code nodes
      //   handle their own `o` (chained code cell) via CodeNode, so skip them here.
      if (!inField && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'o') {
        const current = nodesRef.current.find(n => n.selected && !isBandType(n.type));
        if (current && current.type !== 'code') {
          e.preventDefault();
          addTextNodeInDirection('J');
          return;
        }
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

      // - w / W and e / E resize the focused node by ONE grid cell, the left / top edge fixed, and go
      //   out through the same event the mouse resizer fires: that handler owns the history entry, the
      //   snap, the output clamp and the engine run, so the keyboard cannot bypass any of them.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'w' || e.key === 'W' || e.key === 'e' || e.key === 'E')) {
        const cur = nodesRef.current.find(nd => nd.selected && !isBandType(nd.type));
        if (!cur) return;
        e.preventDefault();
        const wide = e.key === 'w' || e.key === 'W';
        const dir = e.key === 'w' || e.key === 'e' ? 1 : -1;
        const oldW = Number(cur.style?.width  ?? cur.width  ?? NODE_SIZE.text.w);
        const oldH = Number(cur.style?.height ?? cur.height ?? NODE_SIZE.text.h);
        const width  = wide ? Math.max(GRID, snapGrid(oldW) + dir * GRID) : oldW;
        const height = wide ? oldH : Math.max(GRID, snapGrid(oldH) + dir * GRID);
        window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id: cur.id, x: cur.position.x, y: cur.position.y, width, height },
        }));
        return;
      }

      // - Alt+P: trigger pin on the currently hovered notebook output (if any)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'p') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('skena:altPin'));
        return;
      }

      // - m: start set-mark sequence (requires a focused node)
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'm') {
        if (nodesRef.current.some(n => n.selected && !isBandType(n.type))) {
          e.preventDefault();
          pendingMarkRef.current = 'set';
          if (markTimerRef.current) clearTimeout(markTimerRef.current);
          markTimerRef.current = setTimeout(() => { pendingMarkRef.current = null; }, 2000);
        }
        return;
      }

      // - `` ` ``: start jump-mark sequence
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === '`') {
        e.preventDefault();
        pendingMarkRef.current = 'jump';
        if (markTimerRef.current) clearTimeout(markTimerRef.current);
        markTimerRef.current = setTimeout(() => { pendingMarkRef.current = null; }, 2000);
        return;
      }

      // - yy (double-tap y within 400 ms): copy selected nodes to canvas clipboard
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'y') {
        const now = Date.now();
        if (now - lastYPressRef.current < 400) {
          lastYPressRef.current = 0;
          e.preventDefault();
          handleCopy();
        } else {
          lastYPressRef.current = now;
        }
        return;
      }

      // - dd (double-tap d within 400 ms): delete selected nodes
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'd') {
        const now = Date.now();
        if (now - lastDPressRef.current < 400) {
          lastDPressRef.current = 0;
          e.preventDefault();
          deleteSelectedNodes();
        } else {
          lastDPressRef.current = now;
        }
        return;
      }

      // - xx (double-tap x within 400 ms): remove the focused CODE node's attached output cell (if any).
      //   performDelete clears the code node's outputNodeId + edge and refocuses it, so a re-run makes
      //   a fresh output.
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'x') {
        const now = Date.now();
        if (now - lastXPressRef.current < 400) {
          lastXPressRef.current = 0;
          const code   = nodesRef.current.find(n => n.selected && n.type === 'code');
          const outId  = (code?.data as { outputNodeId?: string } | undefined)?.outputNodeId;
          const outNode = outId ? nodesRef.current.find(n => n.id === outId) : undefined;
          if (outNode) { e.preventDefault(); performDelete([outNode]); }
        } else {
          lastXPressRef.current = now;
        }
        return;
      }

      // - p: paste canvas clipboard (nodes copied with yy)
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'p') {
        e.preventDefault();
        pasteInternalClipboard();
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
        const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
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

      // - c,c (double-tap within 400 ms): copy a cross-canvas reference to the focused node
      // - (`<workspace-relative-path>.canvas#<label>`) — works for any node, not just files
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'c') {
        const now = Date.now();
        if (now - lastCPressRef.current < 400) {
          // - double-c detected: copy a reference to the focused node
          lastCPressRef.current = 0; // - reset so a third c doesn't re-trigger
          const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
          const label = focused ? (focused.data as Record<string, unknown>).nodeLabel as string | undefined : undefined;
          if (focused && label) {
            e.preventDefault();
            vscodePostMessage({ type: 'copyNodeReference', label });
          }
          return;
        }
        lastCPressRef.current = now;
      }

      // - c: toggle edge between the space-pinned node and the keyboard-focused node.
      // - if edges already exist in either direction → remove them (disconnect).
      // - if no edges exist → add a new edge (connect), sides chosen by direction vector.
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === 'c') {
        const pinned = [...spaceSelectedRef.current];
        if (pinned.length !== 1) return;
        const pinnedId  = pinned[0];
        const pinnedNode = nodesRef.current.find(n => n.id === pinnedId);
        const targetNode = nodesRef.current.find(n => n.selected && !isBandType(n.type) && !spaceSelectedRef.current.has(n.id));
        if (!pinnedNode || !targetNode) return;
        e.preventDefault();
        const targetId = targetNode.id;
        const existing = canvasRef.current.edges.filter(ce =>
          (ce.fromNode === pinnedId && ce.toNode === targetId) ||
          (ce.fromNode === targetId && ce.toNode === pinnedId)
        );
        pushHistory();
        if (existing.length > 0) {
          // - disconnect: remove all edges between the two nodes
          const toRemove = new Set(existing.map(ce => ce.id));
          const held = anchoredBy(existing);
          setEdges(eds => eds.filter(fe => !toRemove.has(fe.id)));
          canvasRef.current = { ...canvasRef.current, edges: canvasRef.current.edges.filter(ce => !toRemove.has(ce.id)) };
          scheduleSave();
          runEngineForCells(held);
          return;
        } else {
          // - connect: add edge with sides chosen by direction vector between centres
          const pw = Number(pinnedNode.style?.width  ?? 400), ph = Number(pinnedNode.style?.height ?? 300);
          const tw = Number(targetNode.style?.width  ?? 400), th = Number(targetNode.style?.height ?? 300);
          const dx = (targetNode.position.x + tw / 2) - (pinnedNode.position.x + pw / 2);
          const dy = (targetNode.position.y + th / 2) - (pinnedNode.position.y + ph / 2);
          const fromSide: CanvasEdge['fromSide'] = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
          const toSide:   CanvasEdge['fromSide'] = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'left'  : 'right') : (dy >= 0 ? 'top'    : 'bottom');
          const newEdge: CanvasEdge = {
            id:       `${pinnedId}-${targetId}-${Date.now()}`,
            fromNode: pinnedId,
            fromSide,
            toNode:   targetId,
            toSide,
            toEnd:    'arrow',
          };
          const held = anchoredBy([newEdge]);
          setEdges(eds => addEdge(toFlowEdge(newEdge), eds));
          canvasRef.current = { ...canvasRef.current, edges: [...canvasRef.current.edges, newEdge] };
          scheduleSave();
          runEngineForCells(held);
          return;
        }
      }

      const dir = keyToDir(e.key);
      if (!dir) return;

      // - modifier + direction = VS Code / OS shortcut (Alt+Left = navigate back,
      // - Ctrl+Left = word jump, Meta+Left = line start, etc.).
      // - e.key sees only 'h' / 'ArrowLeft', so the modifier is invisible to
      // - keyToDir and navigation fires anyway — silently ignoring the modifier.
      // - Bail out and let VS Code handle the combo.
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      let current = nodesRef.current.find(n => n.selected && !isBandType(n.type));

      // - no focused node: establish focus on the viewport-nearest node first;
      // - the user can press the key again to navigate from there
      if (!current) {
        e.preventDefault();
        const id = pickViewportNode();
        if (id) focusNodeById(id);
        return;
      }

      const targetId = findNearestNode(toNav(current), dir, {
        nodes: nodesRef.current.filter(n => !isBandType(n.type)).map(toNav),
        edges: edgesRef.current,
        lanes: lanesRef.current,
      });
      if (!targetId) return;

      e.preventDefault();
      focusNodeById(targetId);
    };

    // - Shift+Alt+{hjkl} viewport pan runs at CAPTURE phase with stopPropagation:
    // - VS Code's webview key-forwarder is a bubble-phase window listener registered
    // - before ours, so it forwards every keydown to the host regardless of
    // - preventDefault — user keybindings like shift+alt+h → navigateBack would
    // - fire on the same press (double delivery). Capture fires first and kills it.
    const panCapture = (e: KeyboardEvent) => {
      if (!(e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey)) return;
      const k = e.key.toUpperCase();
      if (!['H', 'J', 'K', 'L'].includes(k)) return;
      // - never steal keystrokes from Monaco / inputs (capture fires before them)
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.closest('.monaco-editor')
      ) return;
      // - the knowledge dialog owns the keyboard while it is open, and a click on a result row
      //   leaves no input focused, so the check above does not cover it
      if (knowledgeOpenRef.current) return;
      // - mid mark/chord sequence → let the bubble handler consume it as before
      if (pendingMarkRef.current !== null || chordRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const PAN = 160;   // - screen px per keypress
      const { x, y, zoom } = rfRef.current.getViewport();
      // - vim scroll semantics: j reveals content below (view moves down), l reveals right
      const d: Record<string, { dx: number; dy: number }> = {
        H: { dx:  PAN, dy: 0 }, L: { dx: -PAN, dy: 0 },
        K: { dx: 0, dy:  PAN }, J: { dx: 0, dy: -PAN },
      };
      const { dx, dy } = d[k];
      const c = clampCam(x + dx, y + dy, zoom);
      rfRef.current.setViewport({ x: c.x, y: c.y, zoom }, { duration: CAMERA_MS });
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', panCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', panCapture, { capture: true });
      // - a canvas switch re-runs this effect: drop the armed chord and its badges with it
      if (gHintTimerRef.current) { clearTimeout(gHintTimerRef.current); gHintTimerRef.current = null; }
      lastGPressRef.current = 0;
      gLabelsRef.current = EMPTY_LABELS;
      setGHints([]);
    };
  }, [setNodes, setEdges, focusNodeById, pickViewportNode, addTextNodeInDirection, undo, redo, scheduleSave, setSearchOpen, setMarksOpen, closeKnowledge, pushHistory, handleCopy, pasteInternalClipboard, deleteSelectedNodes, performDelete, jumpToRegister, engineNodesOf, runEngineAfterMove, anchoredBy, runEngineForCells, canvasPath]); // - nodesRef + spaceSelectedRef carry live state

  // - expose a viewport snapshot for the AI companion (what the user actually sees:
  // - zoom, on-screen node labels, scroll position within the focused node)
  useEffect(() => {
    const getViewport = (): ViewportSnapshot => {
      const vp = rfRef.current.getViewport();
      const W = window.innerWidth, H = window.innerHeight;
      const visibleNodes: string[] = [];
      for (const cn of canvasRef.current.nodes) {
        if (isBandType(cn.type)) continue;
        const sx = cn.x * vp.zoom + vp.x;
        const sy = cn.y * vp.zoom + vp.y;
        const sw = cn.width * vp.zoom, sh = cn.height * vp.zoom;
        if (sx + sw > 0 && sx < W && sy + sh > 0 && sy < H) {
          visibleNodes.push(cn.nodeLabel ?? cn.id.slice(0, 6));
        }
      }
      let focusedScrollPct: number | undefined;
      let focusedVisibleText: string | undefined;
      const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
      if (focused) {
        const el = document.querySelector(`.react-flow__node[data-id="${focused.id}"] .skena-scrollable`) as HTMLElement | null;
        if (el && el.scrollHeight > el.clientHeight + 1) {
          focusedScrollPct = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
        }
        if (el) {
          // - the literal on-screen text: rendered blocks whose rect intersects the
          // - node's visible scroll window (avoids the unreliable %→source mapping)
          const scRect = el.getBoundingClientRect();
          const md     = el.querySelector('.skena-markdown');
          const blocks = md ? Array.from(md.children) : Array.from(el.children);
          const parts: string[] = [];
          for (const c of blocks) {
            const r = c.getBoundingClientRect();
            if (r.bottom > scRect.top + 2 && r.top < scRect.bottom - 2) {
              const t = (c as HTMLElement).innerText?.trim();
              if (t) parts.push(t);
            }
          }
          const joined = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
          if (joined) focusedVisibleText = joined.slice(0, 2000);
        }
      }
      return { zoom: Math.round(vp.zoom * 100) / 100, visibleNodes, focusedScrollPct, focusedVisibleText };
    };
    (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport = getViewport;
    return () => { delete (window as unknown as { __skenaGetViewport?: () => ViewportSnapshot }).__skenaGetViewport; };
  }, []);

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
      const d = (e as CustomEvent<{ id: string; x: number; y: number; width: number; height: number }>).detail;
      // - snap the resized box to the grid so width/height land on whole cells (vertical = whole lines)
      const id = d.id;
      const x = snapGrid(d.x), y = snapGrid(d.y);
      // - an output cell's column is the pair's, so an oversized one would overlap the pair to its right
      const isOutput = canvasRef.current.nodes.some(o => o.type === 'code' && o.outputNodeId === id);
      const width  = isOutput ? Math.min(snapGrid(d.width),  OUTPUT_MAX_W) : snapGrid(d.width);
      const height = isOutput ? Math.min(snapGrid(d.height), OUTPUT_MAX_H) : snapGrid(d.height);
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
      // - a taller code cell pushes its column down, a wider output pushes the pairs right of it; a
      //   resized free node pushes only what it now covers
      // - a code cell resized by hand keeps the height set here until its text changes again: the
      //   next edit reports what it needs and skena:codeHeight sizes it from that.
      runEngine({ nodeId: id }, { moverIds: [id] });
    };
    window.addEventListener('skena:nodeResize', handler);
    return () => window.removeEventListener('skena:nodeResize', handler);
  }, [setNodes, scheduleSave, pushHistory, runEngine]);

  // ─── custom wheel zoom (smaller step, cursor-centred) ────────────────────────

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
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 + STEP * dir)));
      const scale   = newZoom / zoom;

      // - keep the flow point under the cursor stationary:
      // - localX/Y are cursor coords relative to the ReactFlow container
      const rect = el.getBoundingClientRect();
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      // - clamp so cursor-centred wheel zoom can't reveal space above/left of the origin
      const c = clampCam(lx - (lx - tx) * scale, ly - (ly - ty) * scale, newZoom);
      rfRef.current.setViewport({ x: c.x, y: c.y, zoom: newZoom });
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

  // - listen for code edits committed by CodeNodeComponent's Monaco editor
  useEffect(() => {
    const handler = (e: Event) => {
      pushHistory();
      const { id, code } = (e as CustomEvent<{ id: string; code: string }>).detail;
      const original = canvasRef.current.nodes.find(n => n.id === id);
      if (!original || original.type !== 'code') return;
      // - clear the run-flag on edit: an edited cell is "stale" so run-with-upstream re-runs it
      const updatedNode = { ...original, code, lastStatus: undefined };
      const updated: CanvasData = {
        ...canvasRef.current,
        nodes: canvasRef.current.nodes.map(n => n.id === id ? updatedNode : n),
      };
      canvasRef.current = updated;
      setNodes(nds => nds.map(n =>
        n.id === id ? { ...n, data: { ...n.data, code, lastStatus: undefined } } : n
      ));
      scheduleSave();
    };
    window.addEventListener('skena:nodeCodeEdit', handler);
    return () => window.removeEventListener('skena:nodeCodeEdit', handler);
  }, [setNodes, scheduleSave, pushHistory]);

  // - a code cell is as tall as its content needs: the cell reports the px its text no longer fits
  // - in, the engine steps that to a height, and the column closes up or opens under it. Shrinks
  // - the same way. No history entry of its own — the keystroke that changed the content went
  // - through skena:nodeCodeEdit above, which pushed one for the same edit.
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, height: needPx } = (e as CustomEvent<{ id: string; height: number }>).detail;
      const cur = canvasRef.current.nodes.find(n => n.id === id);
      if (!cur || cur.type !== 'code') return;
      const height = codeCellHeight(needPx);
      if (height === cur.height) return;
      canvasRef.current = {
        ...canvasRef.current,
        nodes: canvasRef.current.nodes.map(n => n.id === id ? { ...n, height } : n),
      };
      setNodes(nds => nds.map(n => n.id === id ? { ...n, style: { ...n.style, height }, height } : n));
      runEngine({ nodeId: id }, { moverIds: [id] });
      scheduleSave();
    };
    window.addEventListener('skena:codeHeight', handler);
    return () => window.removeEventListener('skena:codeHeight', handler);
  }, [setNodes, scheduleSave, runEngine]);

  // - transient run status from the host: drive the code node's status glyph and
  // - animate the code↔kernel edge while running. This is UI-only — it must NOT
  // - touch canvasRef or schedule a save (the persisted lastStatus arrives via the
  // - soft reload after the host writes the run output to disk).
  useEffect(() => {
    const handler = (e: Event) => {
      const { cellNodeId, state } =
        (e as CustomEvent<{ cellNodeId: string; kernelNodeId: string | null; state: 'running' | 'ok' | 'error' }>).detail;
      // - keep the run cell as the focus target so the output-write reload re-selects IT
      lastFocusedNodeId.set(canvasPath, cellNodeId);
      // - just set the cell's status; the running border + edge animation are DERIVED from
      // - lastStatus (below), so they also light up correctly on a canvas reopen.
      setNodes(nds => nds.map(n =>
        n.id === cellNodeId ? { ...n, data: { ...n.data, lastStatus: state } } : n
      ));
    };
    window.addEventListener('skena:runStatus', handler);
    return () => window.removeEventListener('skena:runStatus', handler);
  }, [setNodes]);

  // - vim `o` in a code cell → a new code cell one gap below it in its column; the cells under it
  // - are pushed down by the engine once the node is in (the addNodeResult funnel). Edit-ready.
  useEffect(() => {
    const handler = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string }>).detail;
      const src = nodesRef.current.find(n => n.id === sourceId);
      if (!src) return;
      const sh = Number(src.style?.height ?? NODE_SIZE.code.h);
      const section = engineNodesOf({ nodeId: sourceId });
      const slot = section && insertAfter(section, sourceId);
      // - no section: the old free-slot search, gap = the shared NEW_NODE gap. Either way the slot is
      //   snapped, so the new cell lands on its column and not half a grid off.
      const at = slot ?? findFreePosition(nodesRef.current, src.position.x, src.position.y + sh + NEW_NODE_GAP, NODE_SIZE.code.w, NODE_SIZE.code.h, 0, 1);
      const x = snapGrid(at.x), y = snapGrid(at.y);
      const newId = `code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const newNode: CanvasNode = { id: newId, type: 'code', code: '', language: 'python', x, y, width: NODE_SIZE.code.w, height: NODE_SIZE.code.h };
      const newEdge: CanvasEdge = { id: `${sourceId}-${newId}-${Date.now()}`, fromNode: sourceId, fromSide: 'bottom', toNode: newId, toSide: 'top', toEnd: 'arrow' };
      window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
        detail: { type: 'addNodeResult', node: newNode, edge: newEdge, autoEdit: true, anchorId: sourceId } satisfies MsgAddNodeResult,
      }));
    };
    window.addEventListener('skena:addCodeBelow', handler);
    return () => window.removeEventListener('skena:addCodeBelow', handler);
  }, [engineNodesOf]);

  // - animate the edges from each running cell to its kernel, derived from lastStatus so it
  // - survives reopen. Cheap when nothing runs (early-return + same-ref no-op).
  useEffect(() => {
    const want = runningPathEdgeIds(nodes, edges);
    setEdges(eds => {
      let changed = false;
      const next = eds.map(ed => {
        const a = want.has(ed.id);
        if (!!ed.animated === a) return ed;
        changed = true;
        return { ...ed, animated: a };
      });
      return changed ? next : eds;
    });
  }, [nodes, edges, setEdges]);

  // - apply a run's output WITHOUT a full canvas reload: upsert the output cell node,
  // - update the code node's status + the kernel's id, in place. The host already wrote
  // - to disk (self-save suppressed), so we mirror into canvasRef too — otherwise a later
  // - webview save would drop the host-written output node.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<MsgRunOutput>).detail;
      const out = d.outputNode;
      // - TEMP INSTRUMENT (output desync): the exact moment a run's output id is compared to the code
      //   node's EXISTING outputNodeId. A re-run of a cell that already has output must keep the id.
      {
        const cnPrev = nodesRef.current.find(n => n.id === d.codeNodeId);
        const prevOid = (cnPrev?.data as { outputNodeId?: string } | undefined)?.outputNodeId;
        const flag = out && prevOid && prevOid !== out.id ? '  ← NEW ID (desync!)'
          : out && !prevOid ? '  ← no prevOid'
          : '';
        console.warn(`[skena runOutput] src=${d.source ?? '?'} code=${d.codeNodeId} status=${d.lastStatus} out=${out?.id ?? '∅'} prevOid=${prevOid ?? '∅'}${flag}`);
      }
      // - remember this run just now, so a stale reload can't revert the output cell's content NOR the
      //   code node's outputNodeId link (see the reload effect's `pinned` set)
      if (out) {
        const t = Date.now();
        recentOutputRef.current.set(out.id, t);
        recentOutputRef.current.set(d.codeNodeId, t);
      }
      // - one answer for this delta: the output cell is new to the canvas, not a re-run updating it
      const isNewOutput = !!out && !canvasRef.current?.nodes.some(n => n.id === out.id);
      setNodes(nds => {
        let next = nds.map(n => {
          if (n.id === d.codeNodeId) return { ...n, data: { ...n.data, lastStatus: d.lastStatus, ...(out ? { outputNodeId: out.id } : {}) } };
          if (d.kernelId && n.id === d.kernelNodeId) return { ...n, data: { ...n.data, kernelId: d.kernelId } };
          // - update content only, NEVER position: an output node being live-updated must stay where
          //   the user dragged it (new nodes are centered on create via toFlowNode below)
          if (out && n.id === out.id) return { ...n, data: { ...n.data, format: out.format, content: out.content, ...(out.nodeLabel ? { nodeLabel: out.nodeLabel } : {}) } };
          return n;
        });
        if (out && !nds.some(n => n.id === out.id)) next = [...next, { ...toFlowNode(out), selected: false }];
        return next;
      });
      if (d.edge) setEdges(eds => eds.some(x => x.id === d.edge!.id) ? eds : [...eds, toFlowEdge(d.edge!)]);
      // - mirror EVERY delta (incl. 'running') into canvasRef so the output node + its edge + the
      // - code node's outputNodeId are durable: a concurrent scheduleSave() then keeps them, and the
      // - host also persists the node once on first output. This is what lets a close+reopen mid-run
      // - restore the output node. (Reload flicker from the resulting writes is absorbed by reconcile.)
      const cr = canvasRef.current;
      if (cr) {
        let nodes = cr.nodes.map(n => {
          if (n.id === d.codeNodeId) return { ...n, lastStatus: d.lastStatus, ...(out ? { outputNodeId: out.id } : {}) } as CanvasNode;
          if (d.kernelId && n.id === d.kernelNodeId) return { ...n, kernelId: d.kernelId } as CanvasNode;
          if (out && n.id === out.id) return { ...n, format: out.format, content: out.content, ...(out.nodeLabel ? { nodeLabel: out.nodeLabel } : {}) } as CanvasNode;
          return n;
        });
        if (out && isNewOutput) nodes = [...nodes, out];
        const edges = d.edge && !cr.edges.some(x => x.id === d.edge!.id) ? [...cr.edges, d.edge] : cr.edges;
        canvasRef.current = { ...cr, nodes, edges };
      }
      // - the host pinned this output to the folded section under a suppressed write; mirror it, or the
      //   fit counts the new node as visible content and expands the fold
      if (out && isNewOutput) {
        const sections = canvasRef.current.metadata?.sections ?? [];   // - same-tick mirror, see pushHistory
        const pinned = pinOutputToLane(sections, d.codeNodeId, out.id);
        if (pinned !== sections) commitLanes(pinned);
        // - a first output is a new box in the section: the engine puts it in its pair's output column
        //   and pushes the neighbours out of its way. A re-run only rewrites content, so nothing moves
        //   then. The pushes are part of the run, so they ride on the run's own history entry.
        pushHistory();
        runEngine({ nodeId: d.codeNodeId }, { moverIds: [out.id], extraIds: [out.id] });
      }
      // - the patches above only reach kernel NODES; when the run went to a record, its live id is
      //   what the host just started or restarted
      const liveId = d.kernelId;
      if (liveId) {
        const rec = kernelsRef.current.find(k => k.id === d.kernelNodeId);
        if (rec && rec.kernelId !== liveId) {
          commitKernels(kernelsRef.current.map(k => (k.id === d.kernelNodeId ? { ...k, kernelId: liveId } : k)));
        }
      }
    };
    window.addEventListener('skena:runOutput', handler);
    return () => window.removeEventListener('skena:runOutput', handler);
  }, [setNodes, setEdges, commitKernels, commitLanes, pushHistory, runEngine]);

  // - receive add-node result from QuickPick (Ctrl+N / Shift+hjkl)
  useEffect(() => {
    const handler = (e: Event) => {
      pushHistory();
      const { node: rawNode, edge: ce, autoEdit, anchorId } = (e as CustomEvent<MsgAddNodeResult>).detail;
      // - the node the creation started from (`o`, Alt+X, a directional add, a paste beside the
      //   focused node): the new node joins ITS section, not the one its y falls in
      const anchor = anchorId && canvasRef.current.nodes.some(n => n.id === anchorId) ? anchorId : undefined;

      // - kernel nodes get a palette color by creation order — count here so the
      //   index is correct against the live node set before this one is added
      let seed = rawNode;
      if (rawNode.type === 'kernel' && rawNode.colorIndex === undefined) {
        const kernelCount = canvasRef.current.nodes.filter(n => n.type === 'kernel').length;
        seed = { ...rawNode, colorIndex: nextKernelColorIndex(kernelCount + kernelsRef.current.length) };
      }

      // - never off the canvas: the add path centres on the click point, which can sit in the origin margin
      const c = clampToOrigin(seed.x, seed.y);
      seed = { ...seed, x: c.x, y: c.y };

      // - assign a reference label (N1, M3 …) if the node doesn't have one yet
      const cn: CanvasNode = assignLabel(seed, canvasRef.current.nodes);

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
      // - the first node seeds the first section
      if (lanesRef.current.length === 0) {
        const now = Date.now();
        commitLanes([{ id: `sec-${now.toString(36)}`, y: 0, createdAt: now }]);
      }
      // - created off a cell hidden by a fold: the new node is hidden with it, like a run's output,
      //   rather than showing up as the only visible member of a folded section
      if (anchor) {
        const lanes0 = canvasRef.current.metadata?.sections ?? [];
        const pinnedLanes = pinOutputToLane(lanes0, anchor, cn.id);
        if (pinnedLanes !== lanes0) commitLanes(pinnedLanes);
      }

      // - add connecting edge if present (Shift+hjkl case)
      if (ce) {
        setEdges(eds => addEdge(toFlowEdge(ce), eds));
        canvasRef.current = {
          ...canvasRef.current,
          edges: [...canvasRef.current.edges, ce],
        };
      }

      scheduleSave();

      // - every creation path ends here (`o`, Alt+X, context menu, edge drop, host QuickPick, kernel
      //   node), so this is the one place the layout engine has to see a new node
      runEngine({ nodeId: anchor ?? cn.id }, { moverIds: [cn.id], ...(anchor ? { extraIds: [cn.id] } : {}) });

      // - select, then the minimal pan of §8.2 (centring on every new node broke the flow of working
      //   down a column); revealNode reads the mirror, so the node added this tick is found
      focusNodeById(cn.id);
      revealNode(cn.id);

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
  }, [setNodes, setEdges, scheduleSave, focusNodeById, revealNode, pushHistory, commitLanes, runEngine]);

  // ─── helper: place a new CellNode at viewport centre ─────────────────────────

  const addCellNode = useCallback((
    content: string,
    format: 'html' | 'markdown' | 'image' | 'plotly',
    sourceNodeId?: string,
  ) => {
    const W = 480, H = 320;

    // - if pinned from a notebook node, place to the right of it; else viewport centre
    let x: number, y: number;
    const src = sourceNodeId ? canvasRef.current.nodes.find(n => n.id === sourceNodeId) : undefined;
    if (src) {
      x = Math.round(src.x + src.width + GRID);
      // - centred on the source, but never above its row: a taller cell would start a column above
      //   the node it was pinned from and the engine would push the whole row down to clear it
      const centred = Math.round(src.y + (src.height - H) / 2);
      y = Math.max(centred, src.y);
    } else {
      const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
      const cx = (-vx + window.innerWidth  / 2) / zoom;
      const cy = (-vy + window.innerHeight / 2) / zoom;
      x = Math.round(cx - W / 2);
      y = Math.round(cy - H / 2);
    }

    const id = `cell-${Date.now()}`;
    const node = { id, type: 'cell', x, y, width: W, height: H, content, format } as CanvasNode;

    // - create connecting edge from the source notebook node if available
    const edge: CanvasEdge | undefined = src
      ? {
          id:       `edge-pin-${Date.now()}`,
          fromNode: src.id,
          fromSide: 'right',
          toNode:   id,
          toSide:   'left',
          toEnd:    'arrow',
          label:    nowLabel(),
        }
      : undefined;

    // - reuse the addNodeResult event handler: handles labels/history/save/focus, and puts the new
    //   cell in the source's section rather than the one its y falls in
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node, edge, ...(src ? { anchorId: src.id } : {}) } satisfies MsgAddNodeResult,
    }));
  }, []); // - no deps: reads refs, not state

  // - insert a pasted node right of the focused node (edge) or at viewport centre (no edge).
  // - offsetIndex spreads same-tick batch inserts vertically (nodesRef can't see siblings yet)
  const insertPastedNode = useCallback((partial: { type: 'text'; text: string } | { type: 'link'; url: string } | { type: 'file'; file: string } | { type: 'noderef'; canvas: string; label: string; title?: string }, offsetIndex = 0) => {
    const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
    // - link nodes are compact (matches editor-provider link node size); noderef is a small diamond
    const [nw, nh] = partial.type === 'link' ? [320, 80] : partial.type === 'noderef' ? [200, 120] : [400, 300];
    let x: number, y: number;
    if (focused) {
      const cw = Number(focused.style?.width ?? 400);
      const rawY = focused.position.y + offsetIndex * (nh + GRID);
      // - in a section the engine owns the spot: the column slot right of the anchor, packed from
      //   there — a slot another node holds puts the pasted node under that occupant, and on an
      //   exact y tie the mover wins and the occupant moves down. No section: the free-slot search.
      const section = engineNodesOf({ nodeId: focused.id });
      const slot = section && directionSlot('L', { x: focused.position.x, y: rawY, w: cw }, nw, nh);
      const pos = slot ?? findFreePosition(nodesRef.current, focused.position.x + cw + GRID, rawY, nw, nh, 1, 0);
      x = pos.x; y = pos.y;
    } else {
      const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
      x = Math.round((-vx + window.innerWidth / 2) / zoom - nw / 2);
      y = Math.round((-vy + window.innerHeight / 2) / zoom - nh / 2) + offsetIndex * (nh + GRID);
    }
    const id = `paste-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const node: CanvasNode = { ...partial, id, x, y, width: nw, height: nh };
    const edge: CanvasEdge | undefined = focused
      ? { id: `${focused.id}-${id}-${Date.now()}`, fromNode: focused.id, fromSide: 'right', toNode: id, toSide: 'left', toEnd: 'arrow' }
      : undefined;
    // - reuse the addNodeResult event handler: handles labels/history/save/focus
    window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
      detail: { type: 'addNodeResult', node, edge, ...(focused ? { anchorId: focused.id } : {}) } satisfies MsgAddNodeResult,
    }));
  }, [engineNodesOf]); // - reads refs otherwise; engineNodesOf never changes identity

  // ─── pin notebook cell output → new CellNode ─────────────────────────────────
  // - fired by NotebookRenderer's 📌 button

  useEffect(() => {
    const handler = (e: Event) => {
      const { content, format, sourceNodeId } = (e as CustomEvent<{
        content:      string;
        format:       'html' | 'markdown' | 'image' | 'plotly';
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

  // - record the OS clipboard text that was current when yy happened; the read round-trip
  // - is async, so for a few ms after yy the snapshot may lag the actual clipboard
  useEffect(() => {
    const onClip = (e: Event) => {
      if (!awaitingYYSnapshot.current) return;
      awaitingYYSnapshot.current = false;
      yySnapshotRef.current = (e as CustomEvent<string>).detail;
    };
    window.addEventListener('skena:clipboardContent', onClip);
    return () => window.removeEventListener('skena:clipboardContent', onClip);
  }, []);

  // - paste-to-node: DOM paste is the only channel that carries images/files (vscode clipboard API is text-only)
  useEffect(() => {
    const pendingVerify = new Map<string, string>();   // - requestId → raw text (text-node fallback)
    const verifyTimeouts = new Set<ReturnType<typeof setTimeout>>();   // - cleared on unmount (canvas switch)

    const onVerifyResult = (e: Event) => {
      const msg = (e as CustomEvent<MsgVerifyPathResult>).detail;
      const raw = pendingVerify.get(msg.requestId);
      if (raw === undefined) return;
      pendingVerify.delete(msg.requestId);
      if (msg.exists && msg.resolvedPath) insertPastedNode({ type: 'file', file: msg.resolvedPath });
      else insertPastedNode({ type: 'text', text: raw });
    };

    const onPaste = (e: ClipboardEvent) => {
      // - inert while search/marks panel is open (spec); marks panel has no input,
      // - so the activeElement guard below doesn't cover it
      if (panelOpenRef.current) return;
      // - inert while any editor/input owns the keyboard (Monaco node edit, chat input, search, marks)
      const ae = document.activeElement as HTMLElement | null;
      if (ae?.closest('.monaco-editor, input, textarea, [contenteditable="true"]')) return;
      const cd = e.clipboardData;
      if (!cd) return;

      const imageItem = Array.from(cd.items).find(it => it.kind === 'file' && it.type.startsWith('image/'));
      const action = classifyClipboard({
        hasImage:   !!imageItem,
        html:       cd.getData('text/html'),
        uriList:    cd.getData('text/uri-list'),
        text:       cd.getData('text/plain'),
        yySnapshot: yySnapshotRef.current,
      });
      if (action.kind === 'none') { if (clipboard) { e.preventDefault(); pasteInternalClipboard(); } return; }
      e.preventDefault();

      const focused = nodesRef.current.find(n => n.selected && !isBandType(n.type));
      switch (action.kind) {
        case 'cell-image': {
          const file = imageItem!.getAsFile();
          if (!file) {
            vscodePostMessage({ type: 'showWarning', text: 'Skena: could not read pasted image.' });
            return;
          }
          const reader = new FileReader();
          reader.onerror = () => vscodePostMessage({ type: 'showWarning', text: 'Skena: failed to read pasted image.' });
          reader.onload = () => {
            const dataUri = reader.result as string;
            if (dataUri.length > 5 * 1024 * 1024) {
              vscodePostMessage({ type: 'showWarning', text: 'Skena: pasted image exceeds 5 MB — canvas file will grow accordingly.' });
            }
            addCellNode(dataUri, 'image', focused?.id);
          };
          reader.readAsDataURL(file);
          return;
        }
        case 'cell-html':
          addCellNode(action.html, 'html', focused?.id);
          return;
        case 'cell-plotly':
          addCellNode(action.json, 'plotly', focused?.id);
          return;
        case 'figure-repr': {
          // - lossy widget repr can't render; prepend an actionable note (text nodes render markdown)
          const hint = '> ⚠️ Truncated Plotly **FigureWidget** repr — array data is abbreviated (`...`), so it can’t be rendered as a chart. In the notebook run `print(fig.to_json())` and paste that output for an interactive chart.\n\n';
          insertPastedNode({ type: 'text', text: hint + '```\n' + action.text + '\n```' });
          return;
        }
        case 'files': {
          // - text/uri-list can carry http links; only file-ish URIs go to the host resolver, web links become link nodes
          const webUris  = action.uris.filter(u => /^https?:\/\//.test(u));
          const fileUris = action.uris.filter(u => !/^https?:\/\//.test(u));
          webUris.forEach((u, i) => insertPastedNode({ type: 'link', url: u }, i));
          if (fileUris.length > 0) {
            const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
            const position = focused
              ? { x: focused.position.x + Number(focused.style?.width ?? 400) + 40, y: focused.position.y }
              : { x: (-vx + window.innerWidth / 2) / zoom, y: (-vy + window.innerHeight / 2) / zoom };
            vscodePostMessage({ type: 'dropFiles', uris: fileUris, position, connectTo: focused?.id });
          }
          return;
        }
        case 'internal':
          pasteInternalClipboard();
          return;
        case 'noderef':
          // - title is a display hint only (label drives activation) — resolving it needs a
          // - host round trip to read the target canvas; skip it rather than block the paste
          insertPastedNode({ type: 'noderef', canvas: action.canvas, label: action.label });
          return;
        case 'link':
          insertPastedNode({ type: 'link', url: action.url });
          return;
        case 'verify-path': {
          const requestId = `vp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          pendingVerify.set(requestId, action.raw);
          // - 2s timeout → treat as non-existent (spec error handling)
          const tid = setTimeout(() => {
            verifyTimeouts.delete(tid);
            if (!pendingVerify.has(requestId)) return;
            pendingVerify.delete(requestId);
            insertPastedNode({ type: 'text', text: action.raw });
          }, 2000);
          verifyTimeouts.add(tid);
          vscodePostMessage({ type: 'verifyPath', requestId, path: action.raw });
          return;
        }
        case 'text':
          insertPastedNode({ type: 'text', text: action.text });
          return;
      }
    };

    // - verifyPathResult is dispatched on window (App.tsx); paste attaches to document —
    // - it bubbles there from any focused element, editable or not, in the Chromium webview
    window.addEventListener('skena:verifyPathResult', onVerifyResult);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('skena:verifyPathResult', onVerifyResult);
      document.removeEventListener('paste', onPaste);
      verifyTimeouts.forEach(clearTimeout);
    };
  }, [insertPastedNode, pasteInternalClipboard, addCellNode]);

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
        ...canvasRef.current,   // - keep metadata/viewport/counter: only nodes and edges changed
        nodes: [...canvasRef.current.nodes.filter(n => !removedIds.has(n.id)), portalNode],
        edges: canvasRef.current.edges.filter(e => !removedIds.has(e.fromNode) && !removedIds.has(e.toNode)),
      };
      pruneFolded(removedIds);
      scheduleSave();
      focusNodeById(portalNode.id);
    };
    window.addEventListener('skena:subCanvasCreated', handler);
    return () => window.removeEventListener('skena:subCanvasCreated', handler);
  }, [setNodes, setEdges, scheduleSave, focusNodeById, pushHistory, pruneFolded]);

  // ─── Alt+I from FloatingChat: restore canvas keyboard focus ───────────────
  //
  // When the user presses Alt+I while the chat input is active, FloatingChat
  // dispatches skena:restoreCanvasFocus.  We focus the last keyboard-focused
  // node, or the node nearest the viewport centre if no history exists.

  useEffect(() => {
    const handler = () => {
      const id = lastFocusedNodeId.get(canvasPath) ?? pickViewportNode();
      if (id) focusNodeById(id);
    };
    window.addEventListener('skena:restoreCanvasFocus', handler);
    return () => window.removeEventListener('skena:restoreCanvasFocus', handler);
  }, [canvasPath, focusNodeById, pickViewportNode]);

  // ─── host-driven jump: cross-canvas node reference opened this canvas ─────
  //
  // App.tsx relays the host's { type: 'focusNode', id } as skena:focusNodeRequest
  // once canvasLoaded has landed. Select + center the referenced node.

  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      // - mark it pending so the reload effect force-centers it once nodes land (first open),
      // - and try centering now for the already-open case; clear the mark after it can't apply
      pendingCrossFocusRef.current = id;
      focusNodeById(id, true);
      window.setTimeout(() => { if (pendingCrossFocusRef.current === id) pendingCrossFocusRef.current = null; }, 1500);
    };
    window.addEventListener('skena:focusNodeRequest', handler);
    return () => window.removeEventListener('skena:focusNodeRequest', handler);
  }, [focusNodeById]);

  return (
    <ZoomLevelProvider>
    <LanesContext.Provider value={lanes}>
    <KernelsContext.Provider value={kernels}>
    <EdgeRoutesContext.Provider value={edgeRoutes}>
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row' }}>
    <SectionRail lanes={derivedLanes} kernels={railKernels} selectedNodeId={selectedNodeId}
      onFold={handleFoldLane} onRun={handleRunLane} onReflow={handleReflowLane} onDelete={handleDeleteLane}
      onBindKernel={handleBindKernel} onRename={handleRenameLane} onNewSection={handleNewSectionClick}
      onNewKernel={handleNewKernel} onRemoveKernel={handleRemoveKernel} onKernelAction={handleKernelActionForLane} />
    <div ref={wrapperRef} style={{ flex: '1 1 auto', minWidth: 0, position: 'relative' }} onContextMenu={handleContextMenu}>
      <ReactFlow
        proOptions={{ hideAttribution: true }}
        nodes={rfNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={customOnNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeDragStart={onNodeDragStart}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onBeforeDelete={onBeforeDelete}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={35}
        disableKeyboardA11y={true}
        onDragOver={onDragOver}
        onDrop={onDrop}
        // - viewport persistence: restore saved position/zoom. No fitView prop: the load effect fits
        //   through fitClamped on the same condition, and React Flow's own fit is unbounded.
        defaultViewport={initialViewport(canvas.viewport)}
        // - save viewport to canvas JSON whenever the user stops panning/zooming
        onMoveStart={() => {
          // - promote nodes to GPU layers only while panning/zooming (see canvas.css);
          // - at rest they render crisp at the real scale instead of a scaled cached texture
          document.documentElement.setAttribute('data-skena-interacting', '1');
        }}
        onMoveEnd={(_e, viewport) => {
          document.documentElement.removeAttribute('data-skena-interacting');
          canvasRef.current = { ...canvasRef.current, viewport };
          scheduleSave();
        }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        translateExtent={TRANSLATE_EXTENT}
        deleteKeyCode="Delete"
        multiSelectionKeyCode="Shift"
        elevateEdgesOnSelect
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} color="var(--vscode-editorIndentGuide-background)" />
        <SectionSeparators lanes={derivedLanes} kernels={railKernels} focusableCounts={laneFocusableCounts} />
        <EdgeFollowHints hints={gHints} />
        <HelperLines horizontal={helperLines.horizontal} vertical={helperLines.vertical} />
        <Controls showInteractive={false} showFitView={false}>
          {/* - our own fit button: React Flow's fires an unbounded fitView */}
          <ControlButton onClick={() => { void fitClamped(); }} title="Fit view">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
            </svg>
          </ControlButton>
          {/* - minimap toggle button */}
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
      {knowledgeOpen && (
        <KnowledgeSearch
          onPick={handleKnowledgePick}
          onClose={closeKnowledge}
        />
      )}
      {marksOpen && (
        <MarksPanel
          marks={marksRef.current}
          nodes={nodes}
          sections={marksSections}
          onJump={jumpToRegister}
          onPickSection={handlePickSection}
          onClose={() => setMarksOpen(false)}
        />
      )}
      {contextMenu && (
        <ContextMenu
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          selectedCount={nodes.filter(n => n.selected && !isBandType(n.type)).length}
          hasClipboard={clipboard !== null}
          onClose={handleMenuClose}
          onAddText={handleMenuAddText}
          onAddCodeCell={handleMenuAddCodeCell}
          onAddKernel={handleMenuAddKernel}
          onAddUrl={handleMenuAddUrl}
          onSearch={handleMenuSearch}
          onCopy={handleCopy}
          onPaste={pasteInternalClipboard}
          onCopyNodeReference={handleCopyNodeReference}
          onMoveToSubCanvas={handleMoveToSubCanvas}
        />
      )}
    </div>
    </div>
    </EdgeRoutesContext.Provider>
    </KernelsContext.Provider>
    </LanesContext.Provider>
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
