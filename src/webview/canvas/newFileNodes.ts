/**
 * Which file nodes are new to the canvas between two React Flow node lists, so their cached
 * content can be dropped before they render.
 */

export interface FlowNodeLike {
  id:   string;
  data: unknown;
}

/**
 * The file uris of the file nodes in `after` whose id is not in `before`: a node added, pasted,
 * dropped or brought back by undo. A node already in `before` (moved, resized, hidden by a fold)
 * gives nothing.
 */
export function newFileNodeUris(before: readonly FlowNodeLike[], after: readonly FlowNodeLike[]): string[] {
  const known = new Set(before.map(n => n.id));
  const out: string[] = [];
  for (const n of after) {
    if (known.has(n.id)) continue;
    const d = n.data as { type?: unknown; file?: unknown };
    if (d?.type === 'file' && typeof d.file === 'string') out.push(d.file);
  }
  return out;
}
