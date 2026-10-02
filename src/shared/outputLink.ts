// - which output cell a code cell may write into, and how a copy of a code cell keeps that link

export interface OutputLinkNode { id: string; type: string; outputNodeId?: string }
export interface OutputLinkEdge { fromNode: string; toNode: string }

/**
 * The output cell `cell` reuses on a run, or undefined when the run has to create one. The id in
 * `outputNodeId` counts when it names a cell node and either no other code cell names it, or an
 * edge runs from this cell to it. A copy made by an older paste can name the original's output, and
 * writing into it would overwrite the original's result.
 */
export function ownedOutputId(
  nodes: readonly OutputLinkNode[],
  edges: readonly OutputLinkEdge[],
  cell:  { id: string; outputNodeId?: string },
): string | undefined {
  const id = cell.outputNodeId;
  if (!id || !nodes.some(n => n.id === id && n.type === 'cell')) return undefined;
  if (edges.some(e => e.fromNode === cell.id && e.toNode === id)) return id;
  return nodes.some(n => n.type === 'code' && n.id !== cell.id && n.outputNodeId === id) ? undefined : id;
}

/**
 * `n` copied under the id `idMap` gives it (old id → new id; a node missing from it keeps its id).
 * A code cell's output link follows the copy of its output when that output was copied too, and is
 * dropped otherwise. Its run status is dropped either way: the copy has never run, and a cell marked
 * 'ok' is skipped when a cell below it runs with its upstream.
 */
export function copyNode<T extends { id: string; type: string }>(n: T, idMap: ReadonlyMap<string, string>): T {
  const copy = { ...n, id: idMap.get(n.id) ?? n.id } as T & { outputNodeId?: string; lastStatus?: unknown; lastRun?: unknown };
  if (n.type !== 'code') return copy;
  delete copy.lastStatus;
  delete copy.lastRun;
  const out = copy.outputNodeId !== undefined ? idMap.get(copy.outputNodeId) : undefined;
  if (out) copy.outputNodeId = out;
  else delete copy.outputNodeId;
  return copy;
}
