// - pure canvas-search matching (extracted from CanvasSearch for testability; no React/DOM).
// - Key concern: nodes store images as base64 data URIs and plotly figures as JSON blobs;
// - those must NEVER be searchable content or '/' matches garbage inside them.

import { CanvasNode } from '../../shared/types';

/** Split "vaultName:rest" from a raw query string. */
export function parseQuery(raw: string): { vault: string | null; text: string } {
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const prefix = raw.slice(0, colon).trim().toLowerCase();
    const rest   = raw.slice(colon + 1);
    // - only treat as a vault filter if the prefix looks like an identifier (no spaces)
    if (prefix && !/\s/.test(prefix)) {
      return { vault: prefix, text: rest.trimStart() };
    }
  }
  return { vault: null, text: raw };
}

/** Extract vault name from a node's file URI (vault://name/...). */
export function nodeVaultName(n: CanvasNode): string | null {
  if (n.type !== 'file') return null;
  const m = n.file.match(/^vault:\/\/([^/]+)\//);
  return m ? m[1].toLowerCase() : null;
}

// - drop embedded base64 data URIs (pasted images) so search never matches inside them
const DATA_URI = /data:[^;,\s)]*;base64,[A-Za-z0-9+/=]+/g;
function stripDataUris(s: string): string {
  return s.replace(DATA_URI, '');
}

/** The human-searchable text of a node — binary/figure blobs excluded. */
export function nodeContent(n: CanvasNode): string {
  switch (n.type) {
    case 'text':   return stripDataUris(n.text);
    case 'file':   return n.file;
    case 'link':   return n.url;
    case 'group':  return n.label ?? '';
    case 'cell':
      // - image cells are base64, plotly cells are figure JSON → no searchable text.
      // - markdown/html cells are real text (strip any inline pasted images).
      return (n.format === 'image' || n.format === 'plotly') ? '' : stripDataUris(n.content);
    case 'chat':   return `${n.agent} ${n.title}`;
    case 'portal': return n.canvas;
    default:       return '';
  }
}

/** Does node `n` match the vault filter + text query? */
export function matches(n: CanvasNode, vault: string | null, text: string): boolean {
  if (vault !== null) {
    if (nodeVaultName(n) !== vault) return false;
    if (!text) return true;   // - vault filter, no text → all nodes from that vault
  }

  const ql = text.toLowerCase();
  if (!ql) return false;

  // - label: exact or prefix (image/plotly cells stay findable by their label, e.g. C1)
  const label = n.nodeLabel?.toLowerCase() ?? '';
  if (label === ql || label.startsWith(ql)) return true;

  if (nodeContent(n).toLowerCase().includes(ql)) return true;

  const tags = (n as { tags?: string[] }).tags;
  if (tags?.some(t => t.toLowerCase().includes(ql))) return true;

  return false;
}
