/**
 * Cross-canvas reference: the string `<path>.canvas#<Label>`.
 * Browser-safe (no path/fs) so the webview and host share it.
 * `Label` is one or more uppercase letters then digits. `S` followed by digits is a section's label
 * (S1, S2 … in stack order, `deriveLanes`); any other label is a node's nodeLabel (N2, E10, K1, D3).
 * No node type is labelled with the prefix S, so a reference to S3 always means the section, even
 * when a node was given that label by hand.
 */

import type { CanvasNode } from './types';

export interface NodeRef {
  canvas: string;   // - path to the .canvas file, as written (resolution is the host's job)
  label:  string;   // - target node's nodeLabel, or a section's label
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

/** True when a reference label names a section: S followed by digits. */
export function isSectionLabel(label: string): boolean {
  return /^S\d+$/.test(label);
}

/** The shape of a canvas a reference is looked up in. */
export interface RefCanvas {
  nodes:     CanvasNode[];
  metadata?: { sections?: { y: number; title?: string }[] };
}

// - the section a label names, in stack order; S0, S01 and labels past the last section name none
function sectionOfLabel(canvas: RefCanvas, label: string): { title?: string } | undefined {
  const m = /^S([1-9]\d*)$/.exec(label);
  if (!m) return undefined;
  const sorted = [...(canvas.metadata?.sections ?? [])].sort((a, b) => a.y - b.y);
  return sorted[Number(m[1]) - 1];
}

// - the node carrying a label; a group is kept in the file but not shown, so a label names no group
function nodeOfLabel(canvas: RefCanvas, label: string): CanvasNode | undefined {
  return canvas.nodes.find(n => n.nodeLabel === label && n.type !== 'group');
}

/** What a reference label names in a canvas: a node by id, or a section by its label. Null when nothing. */
export function findRefTarget(canvas: RefCanvas, label: string): { kind: 'node'; id: string } | { kind: 'section'; label: string } | null {
  if (isSectionLabel(label)) return sectionOfLabel(canvas, label) ? { kind: 'section', label } : null;
  const node = nodeOfLabel(canvas, label);
  return node ? { kind: 'node', id: node.id } : null;
}

const TITLE_MAX = 80;
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const firstLine = (s: string) => s.split(/\r?\n/).map(l => l.trim()).find(l => l !== '');

// - one line that names a node: a note's first line without its heading marks, a code cell's first
//   line, a file's name, a URL, or the title or label the node carries
function nodeTitle(node: CanvasNode): string | undefined {
  switch (node.type) {
    case 'text':      return firstLine(node.text)?.replace(/^#{1,6}\s+/, '');
    case 'code':      return firstLine(node.code ?? '');
    case 'file':      return baseName(node.file);
    case 'link':      return node.url;
    case 'knowledge': return node.title;
    case 'portal':    return node.label ?? baseName(node.canvas);
    case 'kernel':    return node.displayName ?? node.server;
    case 'noderef':   return node.title;
    case 'chat':      return node.title;
    default:          return undefined;
  }
}

/**
 * The text a reference into `canvas` shows under its label: the section's title (none when the
 * section is untitled), or one line from the node. Undefined when the label names nothing there.
 */
export function refTitle(canvas: RefCanvas, label: string): string | undefined {
  let raw: string | undefined;
  if (isSectionLabel(label)) raw = sectionOfLabel(canvas, label)?.title;
  else {
    const node = nodeOfLabel(canvas, label);
    raw = node && nodeTitle(node);
  }
  const t = raw?.trim();
  return t ? t.slice(0, TITLE_MAX) : undefined;
}
