import { laneIndexForNode, pinnedLaneIndex, sortLanes, type SectionLane } from './sectionLanes';
import type { CanvasData, KernelRecord } from './types';

export interface EdgeLike {
  fromNode: string;
  toNode:   string;
}

// - returns the id of a kernel node reachable from `codeNodeId` through edges
// - (either direction), or null when no kernel is reachable. BFS, so a chain of
// - cells sharing one kernel (cell2 → cell1 → kernel) makes cell2 runnable too.
// - Traversal stops at the first kernel (kernels are terminal, never walked through).
export function resolveBoundKernel(
  codeNodeId: string,
  edges: EdgeLike[],
  isKernel: (nodeId: string) => boolean,
): string | null {
  const seen = new Set<string>([codeNodeId]);
  const queue = [codeNodeId];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const e of edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || seen.has(nb)) continue;
      if (isKernel(nb)) return nb;      // - found a kernel on this path
      seen.add(nb);
      queue.push(nb);                   // - keep walking through non-kernel (cell) nodes
    }
  }
  return null;
}

// - ordered list of upstream code-cell ids feeding `targetId` (ancestors first, target excluded).
// - Edges are undirected here (users draw them either way), so "upstream" = closer to the bound
// - kernel: distance from the kernel gives the run order (E1=1, E2=2, E3=3 → run E1,E2,E3). Only
// - cells on a path from the target toward the kernel are included (sibling branches are ignored).
export function resolveUpstreamChain(
  targetId:   string,
  edges:      EdgeLike[],
  isKernel:   (id: string) => boolean,
  isCodeCell: (id: string) => boolean,
): string[] {
  const kernelId = resolveBoundKernel(targetId, edges, isKernel);
  if (kernelId === null) return [];

  // - BFS distance from the kernel through the whole graph (undirected)
  const dist = new Map<string, number>([[kernelId, 0]]);
  const q: string[] = [kernelId];
  while (q.length) {
    const cur = q.shift() as string;
    const d   = dist.get(cur) ?? 0;
    for (const e of edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || dist.has(nb)) continue;
      dist.set(nb, d + 1);
      q.push(nb);
    }
  }

  // - walk from the target toward the kernel via strictly-decreasing distance, collecting code cells
  const ancestors = new Set<string>();
  const walk: string[] = [targetId];
  const walked = new Set<string>([targetId]);
  while (walk.length) {
    const cur = walk.shift() as string;
    const d   = dist.get(cur);
    if (d === undefined) continue;
    for (const e of edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || walked.has(nb)) continue;
      const nd = dist.get(nb);
      if (nd === undefined || nd >= d) continue;   // - only move CLOSER to the kernel
      walked.add(nb);
      if (isCodeCell(nb)) { ancestors.add(nb); walk.push(nb); }   // - kernel (nd=0) is not a cell → stops here
    }
  }

  return [...ancestors].sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
}

/** The slice of a canvas the kernel rule needs. CanvasData satisfies it directly; a React Flow store needs a map to {id, type, y: position.y}. */
export interface CellKernelCanvas {
  nodes:    { id: string; type: string; y: number }[];
  edges:    EdgeLike[];
  sections: SectionLane[] | undefined;
  kernels?: { id: string }[];   // - kernel records: valid targets for a section's kernelId
}

export function cellKernelView(c: Pick<CanvasData, 'nodes' | 'edges' | 'metadata'>): CellKernelCanvas {
  return { nodes: c.nodes, edges: c.edges, sections: c.metadata?.sections, kernels: c.metadata?.kernels };
}

/**
 * Build the kernel rule once for a canvas snapshot: the node index and the sorted lanes are computed
 * here, and the returned function answers per cell. Use this wherever the rule is asked many times
 * on the same snapshot (the webview asks once per code node per store change).
 */
export function makeCellKernelResolver(c: CellKernelCanvas): (cellId: string) => string | null {
  const byId = new Map(c.nodes.map(n => [n.id, n]));
  // - answers are stable for one snapshot; the webview asks once per code node per store change
  const memo = new Map<string, string | null>();
  const isKernel = (id: string) => byId.get(id)?.type === 'kernel';
  const recordIds = new Set((c.kernels ?? []).map(k => k.id));
  const sorted = sortLanes(c.sections ?? []);
  const pinned = pinnedLaneIndex(sorted);
  return (cellId: string): string | null => {
    const hit = memo.get(cellId);
    if (hit !== undefined) return hit;
    // - an edge-bound kernel wins; else the kernel of the section owning the cell (pinned or by y); else null
    const viaEdge = resolveBoundKernel(cellId, c.edges, isKernel);
    const cell = byId.get(cellId);
    let out: string | null = null;
    if (viaEdge) {
      out = viaEdge;
    } else if (cell && sorted.length > 0) {
      const lane = sorted[laneIndexForNode(sorted, cell, pinned)];
      out = lane.kernelId && (recordIds.has(lane.kernelId) || isKernel(lane.kernelId)) ? lane.kernelId : null;
    }
    memo.set(cellId, out);
    return out;
  };
}

/** One-shot form of the rule, for call sites that ask once per event (host run / complete / inspect, MCP). */
export function resolveCellKernel(cellId: string, c: CellKernelCanvas): string | null {
  return makeCellKernelResolver(c)(cellId);
}

// - every code cell that resolves to `kernelId`. Used to clear run-flags when that kernel is
// - restarted or shut down (its namespace is gone, so every one of them is un-run).
export function resolveKernelCellsInCanvas(kernelId: string, c: CellKernelCanvas): string[] {
  const resolve = makeCellKernelResolver(c);
  return c.nodes.filter(n => n.type === 'code' && resolve(n.id) === kernelId).map(n => n.id);
}

/** What every kernel consumer reads: a KernelRecord or a KernelNode, by reference (mutations land). */
export interface KernelLike { id: string; server: string; kernelId?: string; spec?: string; displayName?: string; colorIndex?: number }

export function kernelById(c: { nodes: { id: string; type?: string }[]; metadata?: { kernels?: KernelRecord[] } }, id: string): KernelLike | null {
  const rec = c.metadata?.kernels?.find(k => k.id === id);
  if (rec) return rec;
  const node = c.nodes.find(n => n.id === id && n.type === 'kernel');
  return node ? (node as unknown as KernelLike) : null;
}
