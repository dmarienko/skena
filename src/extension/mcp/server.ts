/**
 * Skena MCP Server — exposes canvas read/write tools to Claude Code.
 *
 * Bundled as a standalone CJS script (dist/mcp-server.js, no external deps).
 * Deployed to .vscode/skena-mcp.js in each workspace by the extension.
 *
 * Protocol: MCP stdio transport (JSON-RPC 2.0, newline-delimited).
 *
 * Tools:
 *   canvas_list         list all nodes + edges on a canvas
 *   canvas_read         full content of a node by label or id
 *   canvas_search       text search across all nodes
 *   canvas_edges        connections for a specific node
 *   canvas_follow       resolve file/portal node to a filesystem path
 *   canvas_add_node     create a new node (marked createdBy:'ai')
 *   canvas_update_node  edit content/tags/color of an existing node
 *   canvas_remove_node  delete one or more nodes (and their edges)
 *   canvas_add_edge     connect two nodes
 *   canvas_pin_output   create a CellNode linked back to a source node
 */

import * as fs       from 'fs/promises';
import * as path     from 'path';
import * as os       from 'os';
import * as readline from 'readline';
import * as crypto   from 'crypto';

import { CanvasData, CanvasNode, CanvasEdge, CanvasNodeBase } from '../../shared/types';
import { assignLabel, ensureLabels } from '../../shared/nodeLabels';

// ─── path helpers ─────────────────────────────────────────────────────────────

function resolvePath(raw: string): string {
  const expanded = raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw;
  return path.resolve(expanded);
}

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

// ─── vault config (read from .vscode/settings.json near the canvas file) ──────

interface VaultConfig { name: string; path: string; directories?: string[] }

// - cache: workspace root → vault list (avoid re-reading settings for every call)
const vaultCache = new Map<string, VaultConfig[]>();

/** Strip JS-style comments so JSON.parse handles VS Code's relaxed JSON. */
function stripComments(raw: string): string {
  return raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Read a settings file and return its parsed content, or null on failure. */
async function readSettingsFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(stripComments(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Walk up from `startDir` looking for `.vscode/settings.json`.
 * If `.vscode/settings.local.json` exists alongside it, its `skena.vaults`
 * value overrides the base file (local wins).
 * Results are cached per resolved settings directory path.
 */
async function loadVaults(startDir: string): Promise<VaultConfig[]> {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const settingsPath = path.join(dir, '.vscode', 'settings.json');
    const base = await readSettingsFile(settingsPath);
    if (base !== null) {
      const cacheKey = settingsPath;
      const cached   = vaultCache.get(cacheKey);
      if (cached) return cached;

      // - check for local override — skena.vaults in local file wins entirely
      const localPath = path.join(dir, '.vscode', 'settings.local.json');
      const local     = await readSettingsFile(localPath);
      const vaults    = (
        (local?.['skena.vaults'] ?? base['skena.vaults'] ?? [])
      ) as VaultConfig[];

      vaultCache.set(cacheKey, vaults);
      return vaults;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

/**
 * Resolve a `vault://name/rel/path` URI to an absolute filesystem path.
 * Returns null if the vault is not configured or the URI is not a vault URI.
 */
async function resolveVaultUri(uri: string, canvasPath: string): Promise<string | null> {
  if (!uri.startsWith('vault://')) return null;
  const rest   = uri.slice(8);                      // - "name/rel/path.md"
  const slash  = rest.indexOf('/');
  const name   = slash === -1 ? rest : rest.slice(0, slash);
  const rel    = slash === -1 ? ''   : rest.slice(slash + 1);
  const vaults = await loadVaults(path.dirname(canvasPath));
  const vault  = vaults.find(v => v.name === name);
  if (!vault) return null;
  return path.join(expandHome(vault.path), rel);
}

// ─── canvas I/O ───────────────────────────────────────────────────────────────

async function readCanvas(fsPath: string): Promise<CanvasData> {
  const raw    = await fs.readFile(fsPath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<CanvasData>;
  const data: CanvasData = {
    nodes:    parsed.nodes    ?? [],
    edges:    parsed.edges    ?? [],
    viewport: parsed.viewport,
  };
  // - ensure every node has a label (idempotent)
  data.nodes = ensureLabels(data.nodes);
  return data;
}

async function writeCanvas(fsPath: string, data: CanvasData): Promise<void> {
  // - direct write (no atomic rename) so VS Code's createFileSystemWatcher fires
  // - onDidChange via inotify IN_CLOSE_WRITE, which triggers the webview reload.
  // - Atomic rename emits IN_MOVED_TO instead, which VS Code does not always map
  // - to onDidChange on the target path, leaving the open canvas stale.
  await fs.writeFile(fsPath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── node helpers ─────────────────────────────────────────────────────────────

function findNode(data: CanvasData, ref: string): CanvasNode | undefined {
  // - match by nodeLabel first, then by id
  return data.nodes.find(n => n.nodeLabel === ref) ?? data.nodes.find(n => n.id === ref);
}

function nodeSnippet(node: CanvasNode): string {
  switch (node.type) {
    case 'text':    return truncate(node.text.replace(/\n/g, ' '), 80);
    case 'file':    return node.file;
    case 'link':    return node.url;
    case 'group':   return node.label ? `"${node.label}"` : '(unnamed group)';
    case 'cell':    return `${node.format} (${node.content.length} chars)`;
    case 'chat':    return `${node.agent}: ${node.title}`;
    case 'portal':  return `→ ${node.canvas}`;
    default:        return '(unknown)';
  }
}

function typeLabel(node: CanvasNode): string {
  if (node.type === 'file') {
    const f = node.file.toLowerCase();
    if (f.endsWith('.ipynb')) return 'notebook';
    if (f.endsWith('.md'))    return 'markdown';
    if (f.endsWith('.py'))    return 'python';
    if (f.endsWith('.yaml') || f.endsWith('.yml')) return 'yaml';
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(f))  return 'image';
    return 'file';
  }
  return node.type;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function nowLabel(): string {
  const d   = new Date();
  const yy  = String(d.getFullYear()).slice(2);
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const dd  = String(d.getDate()).padStart(2, '0');
  const hh  = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd} ${hh}:${min}`;
}

function uid(): string {
  return `ai-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

// - compute placement for a new node: right of all existing nodes, vertically centred
function autoPlace(nodes: CanvasNode[], w: number, h: number): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };
  const GAP      = 60;
  const rightmost = Math.max(...nodes.map(n => n.x + n.width));
  const midY      = (Math.min(...nodes.map(n => n.y)) + Math.max(...nodes.map(n => n.y + n.height))) / 2;
  return { x: Math.round(rightmost + GAP), y: Math.round(midY - h / 2) };
}

// - default dimensions per node type
function defaultDims(type: string): { w: number; h: number } {
  const map: Record<string, { w: number; h: number }> = {
    text:   { w: 400, h: 300 },
    cell:   { w: 480, h: 320 },
    file:   { w: 400, h: 400 },
    link:   { w: 240, h: 80  },
    portal: { w: 200, h: 120 },
  };
  return map[type] ?? { w: 400, h: 300 };
}

// ─── file node content reader ─────────────────────────────────────────────────

const BINARY_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.zip', '.7z']);
const MAX_READ_BYTES = 64 * 1024; // - 64 KB cap so CC context stays manageable

/**
 * Resolve a file node's URI to an absolute path, read it, and return the
 * content as a string ready for CC to consume.
 *
 * Handles:
 *   vault://name/rel/path   → resolved via .vscode/settings.json skena.vaults
 *   ./relative/path         → resolved relative to the canvas file's directory
 *   /absolute/path          → used as-is
 */
async function readFileNodeContent(uri: string, canvasPath: string): Promise<string> {
  // - 1. resolve URI → absolute path
  let fsPath: string;
  if (uri.startsWith('vault://')) {
    const resolved = await resolveVaultUri(uri, canvasPath);
    if (!resolved) {
      return `vault URI: ${uri}\n(vault not configured — add it to skena.vaults in .vscode/settings.json)`;
    }
    fsPath = resolved;
  } else if (path.isAbsolute(uri)) {
    fsPath = uri;
  } else {
    // - canvas-relative path (strip leading ./ if present)
    fsPath = path.resolve(path.dirname(canvasPath), uri);
  }

  // - 2. header line always included
  const header = `File: ${fsPath}`;

  // - 3. skip binary files — just report the path
  const ext = path.extname(fsPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return `${header}\n(binary file — content not shown)`;
  }

  // - 4. read text content with size cap
  try {
    const stat = await fs.stat(fsPath);
    if (stat.size > MAX_READ_BYTES) {
      // - read first MAX_READ_BYTES, trim to last newline
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const fd  = await fs.open(fsPath, 'r');
      try {
        const { bytesRead } = await fd.read(buf, 0, MAX_READ_BYTES, 0);
        let text = buf.slice(0, bytesRead).toString('utf-8');
        const lastNl = text.lastIndexOf('\n');
        if (lastNl > 0) text = text.slice(0, lastNl + 1);
        return `${header}\n(truncated — showing first ${MAX_READ_BYTES / 1024} KB of ${Math.round(stat.size / 1024)} KB)\n\n${text}`;
      } finally {
        await fd.close();
      }
    }
    const text = await fs.readFile(fsPath, 'utf-8');
    return `${header}\n\n${text}`;
  } catch (e) {
    return `${header}\n(error reading file: ${e})`;
  }
}

// ─── tools ────────────────────────────────────────────────────────────────────

async function canvasList(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  const d = await readCanvas(p);

  const lines: string[] = [
    `Canvas: ${p}`,
    `${d.nodes.length} node(s), ${d.edges.length} edge(s)`,
    '',
    'Nodes:',
  ];

  for (const n of d.nodes) {
    const ext    = n as CanvasNodeBase & { createdBy?: string; tags?: string[] };
    const aiMark = ext.createdBy === 'ai' ? ' 🤖' : '';
    const tags   = ext.tags?.length ? `  [${ext.tags.join(', ')}]` : '';
    lines.push(`  ${(n.nodeLabel ?? '?').padEnd(4)}  ${typeLabel(n).padEnd(10)}  ${nodeSnippet(n)}${aiMark}${tags}`);
  }

  if (d.edges.length > 0) {
    lines.push('', 'Edges:');
    const labelMap = new Map(d.nodes.map(n => [n.id, n.nodeLabel ?? n.id.slice(0, 8)]));
    for (const e of d.edges) {
      const from = labelMap.get(e.fromNode) ?? e.fromNode;
      const to   = labelMap.get(e.toNode)   ?? e.toNode;
      const lbl  = e.label ? `  "${e.label}"` : '';
      lines.push(`  ${from} → ${to}${lbl}`);
    }
  }

  return lines.join('\n');
}

async function canvasRead(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref as string);
  if (!n) return `Node not found: ${args.ref}`;

  const labelMap = new Map(d.nodes.map(nd => [nd.id, nd.nodeLabel ?? nd.id.slice(0, 8)]));
  const outgoing = d.edges.filter(e => e.fromNode === n.id).map(e => `→ ${labelMap.get(e.toNode) ?? e.toNode}${e.label ? ` "${e.label}"` : ''}`);
  const incoming = d.edges.filter(e => e.toNode   === n.id).map(e => `← ${labelMap.get(e.fromNode) ?? e.fromNode}${e.label ? ` "${e.label}"` : ''}`);

  const meta: string[] = [
    `Node ${n.nodeLabel ?? '?'} (id: ${n.id})`,
    `Type: ${typeLabel(n)}`,
  ];
  const ext = n as CanvasNodeBase & { createdBy?: string; tags?: string[] };
  if (ext.createdBy) meta.push(`Created by: ${ext.createdBy}`);
  if (ext.tags?.length) meta.push(`Tags: [${ext.tags.join(', ')}]`);
  meta.push(`Position: (${n.x}, ${n.y})  Size: ${n.width}×${n.height}`);
  if (incoming.length || outgoing.length) {
    meta.push(`Connections: ${[...incoming, ...outgoing].join('  ')}`);
  }

  let content = '';
  switch (n.type) {
    case 'text':   content = n.text; break;
    case 'file':   content = await readFileNodeContent(n.file, p); break;
    case 'link':   content = `URL: ${n.url}`; break;
    case 'group':  content = `Label: ${n.label ?? '(none)'}`; break;
    case 'cell':   content = `Format: ${n.format}\n\n${n.content}`; break;
    case 'chat':   content = `Agent: ${n.agent}  Model: ${n.model ?? 'default'}\nTitle: ${n.title}`; break;
    case 'portal': content = `Sub-canvas: ${n.canvas}`; break;
  }

  return [
    ...meta,
    '',
    '─'.repeat(60),
    content,
    '─'.repeat(60),
  ].join('\n');
}

async function canvasSearch(args: Record<string, unknown>): Promise<string> {
  const p     = resolvePath(args.canvasPath as string);
  const d     = await readCanvas(p);
  const query = (args.query as string).toLowerCase();
  const type  = args.type as string | undefined;

  const results: CanvasNode[] = [];
  for (const n of d.nodes) {
    if (type && n.type !== type) continue;
    const haystack = [
      n.nodeLabel ?? '',
      (n as { tags?: string[] }).tags?.join(' ') ?? '',
      n.type === 'text'   ? n.text     : '',
      n.type === 'file'   ? n.file     : '',
      n.type === 'link'   ? n.url      : '',
      n.type === 'group'  ? (n.label ?? '') : '',
      n.type === 'cell'   ? n.content  : '',
      n.type === 'chat'   ? n.title    : '',
      n.type === 'portal' ? n.canvas   : '',
      d.edges.filter(e => e.fromNode === n.id || e.toNode === n.id).map(e => e.label ?? '').join(' '),
    ].join(' ').toLowerCase();

    if (haystack.includes(query)) results.push(n);
  }

  if (results.length === 0) return `No nodes match "${args.query}"`;

  const lines = [`Found ${results.length} node(s) matching "${args.query}":`, ''];
  for (const n of results) {
    lines.push(`  ${(n.nodeLabel ?? '?').padEnd(4)}  ${typeLabel(n).padEnd(10)}  ${nodeSnippet(n)}`);
  }
  return lines.join('\n');
}

async function canvasEdges(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref as string);
  if (!n) return `Node not found: ${args.ref}`;

  const labelMap = new Map(d.nodes.map(nd => [nd.id, nd.nodeLabel ?? nd.id.slice(0, 8)]));
  const lines    = [`Edges for ${n.nodeLabel ?? n.id}:`, ''];
  const out      = d.edges.filter(e => e.fromNode === n.id);
  const inn      = d.edges.filter(e => e.toNode   === n.id);
  if (!out.length && !inn.length) return `No edges for ${n.nodeLabel ?? n.id}`;
  for (const e of inn) lines.push(`  ←  ${(labelMap.get(e.fromNode) ?? e.fromNode).padEnd(6)}  ${e.label ? `"${e.label}"` : '(no label)'}  [${e.fromSide ?? '?'} → ${e.toSide ?? '?'}]`);
  for (const e of out) lines.push(`  →  ${(labelMap.get(e.toNode)   ?? e.toNode  ).padEnd(6)}  ${e.label ? `"${e.label}"` : '(no label)'}  [${e.fromSide ?? '?'} → ${e.toSide ?? '?'}]`);
  return lines.join('\n');
}

async function canvasFollow(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref as string);
  if (!n) return `Node not found: ${args.ref}`;

  if (n.type === 'file') {
    // - canvas_follow just resolves the path (no content) — use canvas_read for content
    if (n.file.startsWith('vault://')) {
      const resolved = await resolveVaultUri(n.file, p);
      if (!resolved) return `Vault URI: ${n.file}\n(vault not configured in .vscode/settings.json — add it to skena.vaults)`;
      return `File path: ${resolved}\nVault URI: ${n.file}`;
    }
    const abs = path.isAbsolute(n.file) ? n.file : path.resolve(path.dirname(p), n.file);
    return `File path: ${abs}`;
  }
  if (n.type === 'portal') {
    const abs = path.isAbsolute(n.canvas) ? n.canvas : path.resolve(path.dirname(p), n.canvas);
    return `Sub-canvas path: ${abs}`;
  }
  if (n.type === 'link') {
    return `URL: ${n.url}`;
  }
  return `Node ${n.nodeLabel ?? n.id} (${n.type}) is not a file, portal, or link node`;
}

async function canvasAddNode(args: Record<string, unknown>): Promise<string> {
  const p    = resolvePath(args.canvasPath as string);
  const d    = await readCanvas(p);
  const type = (args.type as string | undefined) ?? 'text';
  const dims = defaultDims(type);
  const w    = (args.width  as number | undefined) ?? dims.w;
  const h    = (args.height as number | undefined) ?? dims.h;
  const pos  = (args.x !== undefined && args.y !== undefined)
    ? { x: args.x as number, y: args.y as number }
    : autoPlace(d.nodes, w, h);

  // - build the shared base fields for all node types
  const base = {
    id:        uid(),
    type:      type as CanvasNode['type'],
    x:         pos.x,
    y:         pos.y,
    width:     w,
    height:    h,
    createdBy: 'ai' as const,
    ...(args.color ? { color: args.color as CanvasNodeBase['color'] } : {}),
    ...(args.tags  ? { tags:  args.tags  as string[] } : {}),
  };

  let newNode: CanvasNode;
  switch (type) {
    case 'text':
      newNode = { ...base, type: 'text', text: (args.content as string | undefined) ?? '' } as CanvasNode;
      break;
    case 'cell':
      newNode = { ...base, type: 'cell', format: (args.format as 'html' | 'markdown' | 'image' | undefined) ?? 'markdown', content: (args.content as string | undefined) ?? '' } as CanvasNode;
      break;
    case 'file':
      newNode = { ...base, type: 'file', file: (args.file as string | undefined) ?? '' } as CanvasNode;
      break;
    case 'link':
      newNode = { ...base, type: 'link', url: (args.url as string | undefined) ?? '' } as CanvasNode;
      break;
    case 'portal':
      newNode = { ...base, type: 'portal', canvas: (args.canvas as string | undefined) ?? '' } as CanvasNode;
      break;
    default:
      newNode = { ...base, type: 'text', text: (args.content as string | undefined) ?? '' } as CanvasNode;
  }

  const labeled = assignLabel(newNode, d.nodes);
  d.nodes.push(labeled);
  await writeCanvas(p, d);

  return `Created node ${labeled.nodeLabel} (id: ${labeled.id})\nType: ${type}\nPosition: (${labeled.x}, ${labeled.y})  Size: ${labeled.width}×${labeled.height}\nCanvas: ${p}`;
}

async function canvasUpdateNode(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref as string);
  if (!n) return `Node not found: ${args.ref}`;

  const idx     = d.nodes.indexOf(n);
  const updated = { ...n } as CanvasNode & { tags?: string[] };

  if (args.content !== undefined) {
    if (n.type === 'text') (updated as typeof n & { text: string }).text = args.content as string;
    if (n.type === 'cell') (updated as typeof n & { content: string }).content = args.content as string;
  }
  if (args.tags  !== undefined) updated.tags  = args.tags  as string[];
  if (args.color !== undefined) updated.color = args.color as CanvasNodeBase['color'];
  if (args.label !== undefined) updated.nodeLabel = args.label as string;

  d.nodes[idx] = updated;
  await writeCanvas(p, d);
  return `Updated node ${updated.nodeLabel ?? updated.id}`;
}

async function canvasRemoveNode(args: Record<string, unknown>): Promise<string> {
  const p    = resolvePath(args.canvasPath as string);
  const d    = await readCanvas(p);
  const refs = Array.isArray(args.ref) ? args.ref as string[] : [args.ref as string];

  const toRemove = new Set<string>();
  const labels: string[] = [];
  for (const ref of refs) {
    const n = findNode(d, ref);
    if (n) { toRemove.add(n.id); labels.push(n.nodeLabel ?? n.id); }
  }
  if (toRemove.size === 0) return `No nodes found for: ${refs.join(', ')}`;

  d.nodes = d.nodes.filter(n => !toRemove.has(n.id));
  d.edges = d.edges.filter(e => !toRemove.has(e.fromNode) && !toRemove.has(e.toNode));
  await writeCanvas(p, d);
  return `Removed ${toRemove.size} node(s): ${labels.join(', ')}`;
}

async function canvasAddEdge(args: Record<string, unknown>): Promise<string> {
  const p  = resolvePath(args.canvasPath as string);
  const d  = await readCanvas(p);
  const fn = findNode(d, args.from as string);
  const tn = findNode(d, args.to   as string);
  if (!fn) return `Source node not found: ${args.from}`;
  if (!tn) return `Target node not found: ${args.to}`;

  const edge: CanvasEdge = {
    id:       `edge-${uid()}`,
    fromNode: fn.id,
    fromSide: (args.fromSide as CanvasEdge['fromSide']) ?? 'right',
    toNode:   tn.id,
    toSide:   (args.toSide   as CanvasEdge['toSide'])   ?? 'left',
    toEnd:    'arrow',
    ...(args.label ? { label: args.label as string } : {}),
    ...(args.color ? { color: args.color as CanvasEdge['color'] } : {}),
  };
  d.edges.push(edge);
  await writeCanvas(p, d);
  return `Connected ${fn.nodeLabel ?? fn.id} → ${tn.nodeLabel ?? tn.id}  (edge id: ${edge.id})`;
}

async function canvasPinOutput(args: Record<string, unknown>): Promise<string> {
  const p       = resolvePath(args.canvasPath as string);
  const d       = await readCanvas(p);
  const format  = (args.format as 'html' | 'markdown' | 'image' | undefined) ?? 'html';
  const content = (args.content as string | undefined) ?? '';
  const W = 480, H = 320;

  // - place to the right of source node if specified
  let x: number, y: number;
  let sourceNode: CanvasNode | undefined;
  if (args.sourceRef) {
    sourceNode = findNode(d, args.sourceRef as string);
    if (sourceNode) {
      x = Math.round(sourceNode.x + sourceNode.width + 60);
      y = Math.round(sourceNode.y + (sourceNode.height - H) / 2);
    } else {
      const pos = autoPlace(d.nodes, W, H);
      x = pos.x; y = pos.y;
    }
  } else {
    const pos = autoPlace(d.nodes, W, H);
    x = pos.x; y = pos.y;
  }

  const cell: CanvasNode = {
    id:        uid(),
    type:      'cell',
    x, y,
    width:     W,
    height:    H,
    format,
    content,
    createdBy: 'ai',
    ...(args.tags ? { tags: args.tags as string[] } : {}),
  } as CanvasNode;

  const labeled = assignLabel(cell, d.nodes);
  d.nodes.push(labeled);

  let edgeId = '';
  if (sourceNode) {
    const edge: CanvasEdge = {
      id:       `edge-pin-${uid()}`,
      fromNode: sourceNode.id,
      fromSide: 'right',
      toNode:   labeled.id,
      toSide:   'left',
      toEnd:    'arrow',
      label:    (args.edgeLabel as string | undefined) ?? nowLabel(),
    };
    d.edges.push(edge);
    edgeId = edge.id;
  }

  await writeCanvas(p, d);

  const lines = [`Pinned output as cell node ${labeled.nodeLabel} (id: ${labeled.id})`];
  if (sourceNode) lines.push(`Connected from ${sourceNode.nodeLabel ?? sourceNode.id} with edge "${d.edges.find(e => e.id === edgeId)?.label}"`);
  lines.push(`Canvas: ${p}`);
  return lines.join('\n');
}

// ─── tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'canvas_list',
    description: 'List all nodes and edges on a canvas. Returns node labels (N1, J3, etc.), types, and content previews. Use these labels to reference nodes in other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Absolute, workspace-relative, or ~/... path to the .canvas file' },
      },
      required: ['canvasPath'],
    },
  },
  {
    name: 'canvas_read',
    description: 'Read the full content and metadata of a canvas node by its label (e.g. N1, J3) or node ID.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { type: 'string', description: 'Node label (N1, J3, etc.) or full node ID' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_search',
    description: 'Search for canvas nodes whose labels, content, filenames, or tags match a query string.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        query:      { type: 'string', description: 'Search string (case-insensitive)' },
        type:       { type: 'string', description: 'Optional: filter by node type (text, file, cell, link, portal, etc.)' },
      },
      required: ['canvasPath', 'query'],
    },
  },
  {
    name: 'canvas_edges',
    description: 'List all edges (connections) going to or from a specific node.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { type: 'string', description: 'Node label or ID' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_follow',
    description: 'Resolve a file or portal node to its filesystem path so you can read its contents. File nodes return their absolute path; portal nodes return the sub-canvas path; link nodes return their URL.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { type: 'string', description: 'Node label or ID of a file, portal, or link node' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_add_node',
    description: 'Add a new node to the canvas. The node is automatically marked as AI-created (🤖 badge) and assigned a label. Position defaults to the right of all existing nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        type:       { type: 'string', description: 'Node type: text (default), cell, file, link, portal' },
        content:    { type: 'string', description: 'Text content for text/cell nodes' },
        format:     { type: 'string', description: 'Cell format: markdown (default), html, image' },
        file:       { type: 'string', description: 'File path for file nodes (vault:// URI or absolute path)' },
        url:        { type: 'string', description: 'URL for link nodes' },
        canvas:     { type: 'string', description: 'Relative canvas path for portal nodes' },
        tags:       { type: 'array',  items: { type: 'string' }, description: 'Optional tags for search/organisation' },
        color:      { type: 'string', description: 'Node accent color: 1=red, 2=orange, 3=yellow, 4=green, 5=cyan, 6=purple' },
        x:          { type: 'number', description: 'X position (auto-placed if omitted)' },
        y:          { type: 'number', description: 'Y position (auto-placed if omitted)' },
        width:      { type: 'number', description: 'Width in canvas units (default: type-dependent)' },
        height:     { type: 'number', description: 'Height in canvas units (default: type-dependent)' },
      },
      required: ['canvasPath'],
    },
  },
  {
    name: 'canvas_update_node',
    description: 'Update the content, tags, or color of an existing canvas node.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { type: 'string', description: 'Node label or ID to update' },
        content:    { type: 'string', description: 'New text/cell content' },
        tags:       { type: 'array',  items: { type: 'string' }, description: 'Replace tags list' },
        color:      { type: 'string', description: 'New accent color (1-6)' },
        label:      { type: 'string', description: 'Override the node label (e.g. rename N5 to N1)' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_remove_node',
    description: 'Delete one or more nodes from the canvas (also removes their connected edges).',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Node label, node ID, or array of labels/IDs to delete' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_add_edge',
    description: 'Connect two canvas nodes with a directed edge.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        from:       { type: 'string', description: 'Source node label or ID' },
        to:         { type: 'string', description: 'Target node label or ID' },
        label:      { type: 'string', description: 'Optional edge label text' },
        fromSide:   { type: 'string', description: 'Source handle: top, right (default), bottom, left' },
        toSide:     { type: 'string', description: 'Target handle: top, left (default), bottom, right' },
        color:      { type: 'string', description: 'Edge color (1-6)' },
      },
      required: ['canvasPath', 'from', 'to'],
    },
  },
  {
    name: 'canvas_pin_output',
    description: 'Pin a content snippet (analysis result, notebook output, HTML table, image) as a CellNode on the canvas. Automatically links it to a source node if specified.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        content:    { type: 'string', description: 'Content to pin (markdown text, HTML string, or base64 image data URI)' },
        format:     { type: 'string', description: 'Content format: html (default), markdown, image' },
        sourceRef:  { type: 'string', description: 'Optional: label/ID of the node this output came from (notebook, analysis). Creates an edge.' },
        edgeLabel:  { type: 'string', description: 'Label for the connecting edge (defaults to current timestamp yy-mm-dd hh:mm)' },
        tags:       { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['canvasPath', 'content'],
    },
  },
];

// ─── MCP protocol ─────────────────────────────────────────────────────────────

type JsonRpcMsg = {
  jsonrpc: '2.0';
  id?:     number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?:  { code: number; message: string };
};

function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function ok(id: number | string | null | undefined, result: unknown): void {
  send({ jsonrpc: '2.0', id: id ?? null, result });
}

function err(id: number | string | null | undefined, code: number, message: string): void {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

async function dispatch(msg: JsonRpcMsg): Promise<void> {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    ok(id, {
      protocolVersion: '2024-11-05',
      capabilities:    { tools: {} },
      serverInfo:      { name: 'skena', version: '1.0.0' },
    });
    return;
  }

  if (method === 'notifications/initialized') return; // - no response needed

  if (method === 'tools/list') {
    ok(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const name = (params?.name as string | undefined) ?? '';
    const args = (params?.arguments as Record<string, unknown> | undefined) ?? {};
    try {
      let text: string;
      switch (name) {
        case 'canvas_list':        text = await canvasList(args);        break;
        case 'canvas_read':        text = await canvasRead(args);        break;
        case 'canvas_search':      text = await canvasSearch(args);      break;
        case 'canvas_edges':       text = await canvasEdges(args);       break;
        case 'canvas_follow':      text = await canvasFollow(args);      break;
        case 'canvas_add_node':    text = await canvasAddNode(args);     break;
        case 'canvas_update_node': text = await canvasUpdateNode(args);  break;
        case 'canvas_remove_node': text = await canvasRemoveNode(args);  break;
        case 'canvas_add_edge':    text = await canvasAddEdge(args);     break;
        case 'canvas_pin_output':  text = await canvasPinOutput(args);   break;
        default: throw new Error(`Unknown tool: ${name}`);
      }
      ok(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ok(id, { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
    }
    return;
  }

  // - method not found
  err(id, -32601, `Method not found: ${method}`);
}

// ─── entry point ──────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: JsonRpcMsg;
  try {
    msg = JSON.parse(trimmed) as JsonRpcMsg;
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  dispatch(msg).catch(e => {
    process.stderr.write(`Skena MCP: unhandled error: ${e}\n`);
  });
});

rl.on('close', () => process.exit(0));
process.stdin.resume();
