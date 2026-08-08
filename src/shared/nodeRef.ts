/**
 * Cross-canvas node reference: the string `<path>.canvas#<Label>`.
 * Browser-safe (no path/fs) so the webview and host share it.
 * `Label` is a node's nodeLabel — one or more uppercase letters then digits (N2, E10, K1, D3).
 */

export interface NodeRef {
  canvas: string;   // - path to the .canvas file, as written (resolution is the host's job)
  label:  string;   // - target node's nodeLabel
}

// - <path ending in .canvas> # <LETTERS><DIGITS>. Rejects #<digits-only> (line anchors) and non-.canvas.
const REF_RE = /^(.+\.canvas)#([A-Z]+\d+)$/;

export function parseNodeRef(s: string): NodeRef | null {
  const m = REF_RE.exec(s.trim());
  return m ? { canvas: m[1], label: m[2] } : null;
}

export function formatNodeRef(canvasPath: string, label: string): string {
  return `${canvasPath}#${label}`;
}

export function isNodeRef(s: string): boolean {
  return parseNodeRef(s) !== null;
}
