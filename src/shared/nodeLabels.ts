/**
 * nodeLabels — utilities for auto-assigning short reference labels to canvas nodes.
 *
 * Label scheme:
 *   N  — text notes (inline)
 *   M  — markdown files
 *   J  — Jupyter notebooks
 *   P  — Python files
 *   Y  — YAML files
 *   I  — image files
 *   L  — link / URL nodes
 *   C  — cell output nodes
 *   A  — AI chat / agent nodes
 *   R  — portal references to other canvases
 *   G  — group containers
 *   F  — other file types
 *
 * Labels are persisted in the .canvas JSON under `nodeLabel` on each node.
 * Obsidian ignores unknown node properties, so this is safe.
 */

import { CanvasNode, FileNode } from './types';

// - derive the single-letter prefix for a node's label
export function nodeLabelPrefix(node: CanvasNode): string {
  switch (node.type) {
    case 'text':   return 'N';
    case 'link':   return 'L';
    case 'group':  return 'G';
    case 'cell':   return 'C';
    case 'chat':   return 'A';
    case 'portal': return 'R';
    case 'file': {
      const f = (node as FileNode).file.toLowerCase();
      if (f.endsWith('.ipynb'))                          return 'J';
      if (f.endsWith('.md'))                             return 'M';
      if (f.endsWith('.py'))                             return 'P';
      if (f.endsWith('.yaml') || f.endsWith('.yml'))     return 'Y';
      if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(f))     return 'I';
      return 'F';
    }
    default: return 'X';
  }
}

// - return the set of all currently used labels across nodes
function usedLabels(nodes: CanvasNode[]): Set<string> {
  const s = new Set<string>();
  for (const n of nodes) if (n.nodeLabel) s.add(n.nodeLabel);
  return s;
}

// - next unused label for a given prefix
function nextLabel(prefix: string, used: Set<string>): string {
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/**
 * Ensure every node in `nodes` has a `nodeLabel`.
 * Nodes that already have one are left unchanged.
 * Returns a new array; the original is not mutated.
 * Returns the same array reference if nothing changed (no work needed).
 */
export function ensureLabels(nodes: CanvasNode[]): CanvasNode[] {
  const needsLabel = nodes.some(n => !n.nodeLabel);
  if (!needsLabel) return nodes; // - fast path — nothing to do

  const used = usedLabels(nodes);
  return nodes.map(n => {
    if (n.nodeLabel) return n;
    const label = nextLabel(nodeLabelPrefix(n), used);
    used.add(label);
    return { ...n, nodeLabel: label };
  });
}

/**
 * Assign a `nodeLabel` to a single new node, given all existing canvas nodes.
 * The new node must NOT yet be in `existingNodes`.
 */
export function assignLabel(node: CanvasNode, existingNodes: CanvasNode[]): CanvasNode {
  if (node.nodeLabel) return node; // - already labelled (e.g. from host)
  const used = usedLabels(existingNodes);
  const label = nextLabel(nodeLabelPrefix(node), used);
  return { ...node, nodeLabel: label };
}
