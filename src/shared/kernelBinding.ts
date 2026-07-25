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
