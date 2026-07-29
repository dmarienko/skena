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

// - all code cells transitively bound to `kernelId` (BFS through code-cell chains, not crossing into
// - another kernel). Used to reset run-flags when the kernel is restarted/shut down — its namespace
// - is wiped, so every bound cell is effectively un-run.
export function resolveKernelCells(
  kernelId:   string,
  edges:      EdgeLike[],
  isCodeCell: (id: string) => boolean,
  isKernel:   (id: string) => boolean,
): string[] {
  const seen  = new Set<string>([kernelId]);
  const queue = [kernelId];
  const cells: string[] = [];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const e of edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || seen.has(nb) || isKernel(nb)) continue;   // - stop at other kernels
      seen.add(nb);
      if (isCodeCell(nb)) { cells.push(nb); queue.push(nb); }      // - only walk through code cells
    }
  }
  return cells;
}
