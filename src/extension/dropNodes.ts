/**
 * Pure node-building for a single dropped (or pasted) path — no vscode import,
 * testable standalone. handleDropFiles (editor-provider.ts) resolves each raw URI to an
 * fsPath and a relPath (vault:// or workspace-relative) first, then calls this.
 */

import { CanvasNode } from '../shared/types';
import { NODE_SIZE } from '../shared/constants';

/**
 * fsPath decides the node type: a .canvas file becomes a portal (opens the linked canvas on
 * click), anything else becomes a file node. relPath is what the resulting node stores as its
 * canvas/file field.
 */
export function buildDroppedNode(id: string, fsPath: string, relPath: string, x: number, y: number): CanvasNode {
  if (fsPath.toLowerCase().endsWith('.canvas')) {
    return { id, type: 'portal', canvas: relPath, x, y, width: NODE_SIZE.portal.w, height: NODE_SIZE.portal.h };
  }
  return { id, type: 'file', file: relPath, x, y, width: NODE_SIZE.file.w, height: NODE_SIZE.file.h };
}
