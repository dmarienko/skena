export interface EdgeLike {
  fromNode: string;
  toNode:   string;
}

// - returns the id of the kernel node adjacent to `codeNodeId` (either edge direction),
// - or null when the cell is unbound. First match wins.
export function resolveBoundKernel(
  codeNodeId: string,
  edges: EdgeLike[],
  isKernel: (nodeId: string) => boolean,
): string | null {
  for (const e of edges) {
    if (e.fromNode === codeNodeId && isKernel(e.toNode)) return e.toNode;
    if (e.toNode === codeNodeId && isKernel(e.fromNode)) return e.fromNode;
  }
  return null;
}
