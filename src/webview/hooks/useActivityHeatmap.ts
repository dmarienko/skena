/**
 * useActivityHeatmap — computes cluster colors and intensity glow values
 * for the activity heatmap overlay.
 *
 * Algorithm:
 *   1. BFS on undirected edge graph → connected components (clusters).
 *   2. Nodes with no edges are isolated (clusterId = null, shown gray).
 *   3. Within each cluster, rank nodes by creationIndex ascending.
 *   4. Map rank to intensity in [0.18, 0.95].
 *   5. Pre-compute CSS filter strings for quick application in node components.
 */

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { HeatmapNode, EdgeGlow } from '../../shared/types';

// ─── constants ────────────────────────────────────────────────────────────────

const PALETTE = [
  '56,189,248',    // - cyan
  '251,146,60',    // - orange
  '167,139,250',   // - purple
  '52,211,153',    // - green
  '244,114,182',   // - pink
  '250,204,21',    // - yellow
] as const;

const GRAY          = '140,140,140';
const INTENSITY_MIN = 0.18;
const INTENSITY_MAX = 0.95;

// ─── pure computation ─────────────────────────────────────────────────────────

/**
 * Pure function — no React dependencies. Exported for testing.
 * Accepts ReactFlow Node/Edge shapes but only uses id, data, source, target.
 */
export function computeHeatmapData(
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
  edges: Array<{ id: string; source: string; target: string }>,
): { nodeGlow: Map<string, HeatmapNode>; edgeGlow: Map<string, EdgeGlow> } {

  // - build undirected adjacency list
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }

  // - BFS: assign cluster id to each node; isolated nodes get null
  const clusterOf = new Map<string, number | null>();
  let   clusterCount = 0;
  const visited = new Set<string>();

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const hasEdge = (adj.get(n.id)?.length ?? 0) > 0;
    if (!hasEdge) {
      clusterOf.set(n.id, null);
      visited.add(n.id);
      continue;
    }
    const cid   = clusterCount++;
    const queue = [n.id];
    visited.add(n.id);
    while (queue.length) {
      const cur = queue.shift()!;
      clusterOf.set(cur, cid);
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
  }

  // - group nodes by cluster and rank by creationIndex
  const clusterMembers = new Map<number | null, Array<{ id: string; idx: number }>>();
  for (const n of nodes) {
    const cid = clusterOf.get(n.id) ?? null;
    if (!clusterMembers.has(cid)) clusterMembers.set(cid, []);
    clusterMembers.get(cid)!.push({
      id:  n.id,
      idx: (n.data.creationIndex as number | undefined) ?? 0,
    });
  }

  // - compute per-node glow
  const nodeGlow = new Map<string, HeatmapNode>();
  for (const [cid, members] of clusterMembers) {
    const sorted  = [...members].sort((a, b) => a.idx - b.idx);
    const maxRank = sorted.length - 1;
    const isIso   = cid === null;
    const color   = isIso ? GRAY : PALETTE[(cid as number) % PALETTE.length];

    sorted.forEach((m, rank) => {
      const intensity = maxRank === 0
        ? INTENSITY_MAX
        : INTENSITY_MIN + (rank / maxRank) * (INTENSITY_MAX - INTENSITY_MIN);

      const glowFilter = isIso
        ? `drop-shadow(0 0 2px rgba(${color},0.25))`
        : `drop-shadow(0 0 ${(intensity * 9).toFixed(1)}px rgba(${color},${intensity.toFixed(2)})) ` +
          `drop-shadow(0 0 ${(intensity * 18).toFixed(1)}px rgba(${color},${(intensity * 0.45).toFixed(2)}))`;

      nodeGlow.set(m.id, {
        color,
        intensity,
        clusterId:   cid,
        glowFilter,
        borderColor: `rgba(${color},${isIso ? 0.18 : (intensity * 0.65).toFixed(2)})`,
        opacity:     isIso ? 0.45 : 1.0,
      });
    });
  }

  // - compute per-edge glow
  const edgeGlow = new Map<string, EdgeGlow>();
  for (const e of edges) {
    const sg = nodeGlow.get(e.source);
    const tg = nodeGlow.get(e.target);
    if (!sg || !tg) continue;
    const intensity = Math.max(sg.intensity, tg.intensity);
    const color     = sg.color;
    edgeGlow.set(e.id, {
      color,
      intensity,
      stroke:     `rgba(${color},${intensity.toFixed(2)})`,
      glowFilter: `drop-shadow(0 0 ${(intensity * 6).toFixed(1)}px rgba(${color},${(intensity * 0.6).toFixed(2)}))`,
    });
  }

  return { nodeGlow, edgeGlow };
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Memoized hook — re-runs BFS only when the nodes or edges arrays change identity.
 * Call inside CanvasViewInner (or HeatmapProvider) where nodes/edges are available.
 */
export function useActivityHeatmap(
  nodes: Node[],
  edges: Edge[],
): { nodeGlow: Map<string, HeatmapNode>; edgeGlow: Map<string, EdgeGlow> } {
  return useMemo(
    () => computeHeatmapData(nodes, edges),
    [nodes, edges],
  );
}
