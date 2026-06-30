/**
 * Builds the system-prompt context for the floating AI companion.
 *
 * Gathers:
 *   - The currently focused node's full content (reads file from disk for file nodes)
 *   - One-hop connected nodes (summary + short content preview)
 *   - A title-only list of every node on the canvas
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import {
  CanvasData,
  CanvasNode,
  CanvasNodeBase,
  FileNode,
  TextNode,
  CellNode,
  ChatNode,
  PortalNode,
  LinkNode,
} from '../shared/types';

const MAX_ACTIVE_CONTENT   = 3000;   // - chars shown for the focused node
const MAX_CONNECTED_CONTENT = 600;   // - chars shown per connected node
const MAX_CONNECTED_NODES   = 8;     // - max connected nodes to include

// ─── public API ───────────────────────────────────────────────────────────────

export interface SystemPromptOptions {
  /**
   * - how to surface `file` node bodies:
   * - 'content' inlines file text (default — for adapters with no file tools),
   * - 'path' emits the resolved absolute path instead (for the harness agent,
   * -   which has a Read tool and handles notebooks/binary natively).
   */
  fileNodeMode?: 'content' | 'path';
  /** - resolve a node uri (vault://, relative, absolute) to an absolute fs path */
  resolveFsPath?: (uri: string) => string | null;
}

/**
 * - static role intro. For the persistent harness this is the --system-prompt
 * - set once at spawn; the (changing) canvas snapshot rides in each user message.
 */
export function buildStaticSystemPrompt(canvasName: string): string {
  return `You are an AI research assistant embedded in the Skena visual canvas inside VS Code.
You help the user with their research, analysis, and thinking.
Canvas: ${canvasName}`;
}

/**
 * - the dynamic canvas snapshot: focused node + 1-hop connections + node list.
 * - Changes as the user works, so it is rebuilt per turn.
 */
export async function buildCanvasContext(
  canvasPath: string,
  canvas: CanvasData,
  activeNodeId: string | null,
  opts: SystemPromptOptions = {},
): Promise<string> {
  const canvasDir = path.dirname(canvasPath);
  const allNodes  = canvas.nodes.filter(n => n.type !== 'group');

  // - canvas node summary (title only, one per line)
  const nodeSummaryList = allNodes
    .map(n => `  [${n.nodeLabel ?? n.id.slice(0, 6)}] (${n.type}) ${nodeTitle(n)}`)
    .join('\n');

  // - active node section
  let activePart = 'No node currently focused.';
  const activeNode = activeNodeId ? canvas.nodes.find(n => n.id === activeNodeId) : null;
  if (activeNode) {
    const content = await nodeContent(activeNode, canvasDir, MAX_ACTIVE_CONTENT, opts);
    const label   = activeNode.nodeLabel ?? activeNode.id.slice(0, 6);
    activePart    = `[${label}] (${activeNode.type}) ${nodeTitle(activeNode)}\n\n${content}`;
  }

  // - connected nodes section
  let connectedPart = '';
  if (activeNodeId) {
    const connectedIds = new Set<string>();
    for (const edge of canvas.edges) {
      if (edge.fromNode === activeNodeId) connectedIds.add(edge.toNode);
      if (edge.toNode   === activeNodeId) connectedIds.add(edge.fromNode);
    }
    const connectedNodes = canvas.nodes
      .filter(n => connectedIds.has(n.id) && n.type !== 'group')
      .slice(0, MAX_CONNECTED_NODES);

    if (connectedNodes.length > 0) {
      const parts = await Promise.all(connectedNodes.map(async n => {
        const preview = await nodeContent(n, canvasDir, MAX_CONNECTED_CONTENT, opts);
        const label   = n.nodeLabel ?? n.id.slice(0, 6);
        return `### [${label}] (${n.type}) ${nodeTitle(n)}\n${preview}`;
      }));
      connectedPart = `CONNECTED NODES (${connectedNodes.length}):\n${parts.join('\n\n')}\n\n`;
    }
  }

  return `CURRENTLY FOCUSED NODE:
${activePart}

${connectedPart}ALL CANVAS NODES:
${nodeSummaryList}`.trim();
}

export async function buildSystemPrompt(
  canvasPath: string,
  canvas: CanvasData,
  activeNodeId: string | null,
  opts: SystemPromptOptions = {},
): Promise<string> {
  const canvasName = path.basename(canvasPath, '.canvas');
  const context    = await buildCanvasContext(canvasPath, canvas, activeNodeId, opts);

  return `${buildStaticSystemPrompt(canvasName)}

${context}

When you produce findings, insights, or conclusions worth preserving, use the add_note tool to add them directly to the canvas. The note will be placed and connected to the currently focused node. Be concise and specific — these notes become permanent research artefacts.

You can use read_node to fetch the full content of any node by its label (e.g. N3, M12).`.trim();
}

// ─── helpers ──────────────────────────────────────────────────────────────────

export function nodeTitle(node: CanvasNode): string {
  switch (node.type) {
    case 'file':   return (node as FileNode).file.split('/').pop() ?? (node as FileNode).file;
    case 'text':   return (node as TextNode).text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);
    case 'group':  return node.label ?? 'group';
    case 'link':   return (node as LinkNode).url.slice(0, 60);
    case 'cell':   return `[cell:${(node as CellNode).format}]`;
    case 'chat':   return (node as ChatNode).title;
    case 'portal': return (node as PortalNode).canvas;
    default:       return (node as CanvasNodeBase).id.slice(0, 8);
  }
}

export async function nodeContent(
  node: CanvasNode,
  canvasDir: string,
  maxChars: number,
  opts: SystemPromptOptions = {},
): Promise<string> {
  let raw = '';

  switch (node.type) {
    case 'text':
      raw = (node as TextNode).text;
      break;
    case 'cell':
      raw = (node as CellNode).content;
      break;
    case 'file': {
      const uri = (node as FileNode).file;
      if (uri.startsWith('http')) {
        raw = `[external URL: ${uri}]`;
        break;
      }
      // - resolve to an absolute path (vault:// via resolver, else relative to canvas)
      const absPath = uri.startsWith('vault://')
        ? opts.resolveFsPath?.(uri) ?? null
        : (path.isAbsolute(uri) ? uri : path.resolve(canvasDir, uri));

      // - path mode: hand the agent the file path (it reads via its own tools);
      // - avoids inlining large/binary files like .ipynb notebooks
      if (opts.fileNodeMode === 'path') {
        raw = absPath
          ? `[file on disk — read it yourself if needed: ${absPath}]`
          : `[unresolved file: ${uri}]`;
        break;
      }
      // - content mode (default): inline the file text
      if (!absPath) { raw = `[external: ${uri}]`; break; }
      try {
        raw = await fs.readFile(absPath, 'utf-8');
      } catch {
        raw = '[file not found]';
      }
      break;
    }
    default:
      raw = '';
  }

  if (raw.length > maxChars) {
    return raw.slice(0, maxChars) + '\n…[truncated]';
  }
  return raw;
}
