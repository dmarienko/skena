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
 *   canvas_run_cell     run a code node on a bound kernel, write output to a cell node
 */

import * as fs       from 'fs/promises';
import * as path     from 'path';
import * as os       from 'os';
import * as readline from 'readline';
import * as crypto   from 'crypto';

import { CanvasData, CanvasNode, CanvasEdge, CanvasNodeBase, CellNode, CodeNode, KernelRecord, AgentRunPersist, AgentRunPersistResult } from '../../shared/types';
import { nextKernelColorIndex } from '../../shared/kernelPalette';
import { assignLabel, ensureLabels } from '../../shared/nodeLabels';
import { snapGrid } from '../../shared/grid';
import { NODE_SIZE, OUTPUT_MAX_W, OUTPUT_MAX_H } from '../../shared/constants';
import { clampToOrigin } from '../../shared/bounds';
import { applyLaneFit, deriveLanes, outputCellGeom, pinOutputToLane, pruneFoldedIds, sectionByRef, insertLaneAt, foldLane, unfoldLane, sectionTargetHeight, parkFirstLaneAtOrigin, memberCodeCellsInRunOrder, type SectionLane } from '../../shared/sectionLanes';
import { resolveCellKernel, cellKernelView, kernelById, upstreamCellsForRun, resolveKernelCellsInCanvas, type KernelLike } from '../../shared/kernelBinding';
import { layoutSection, reflowSection, insertAfter, forkOf, placeOutput, applyPatchesToCanvas, columnsOfDeleted, ridersOf, hangingBelow, sectionEngineNodes, sectionMembership, toEngineNodes, codeCellHeight, estimateCodeNeedPx, keepRowOf, markKeepRowOnLoad } from '../../shared/layoutEngine';
import { resolveKernelConfig, type KernelServerConfig } from '../jupyter/config';
import { executeCell, startKernel, shutdownKernel } from '../jupyter/client';
import { renderOutput, hasVisibleOutput } from '../jupyter/output';
import type { CollectedOutput } from '../jupyter/protocol';

// - "port:token" from the host (SKENA_RUN_IPC) → the 127.0.0.1 relay for live agent-run output
function parseRunIpc(raw: string | undefined): { port: number; token: string } | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(':');
  if (i <= 0) return null;
  const port = Number(raw.slice(0, i));
  const token = raw.slice(i + 1);
  return port && token ? { port, token } : null;
}

// - delegate the .canvas WRITE to the host over /persist so the host is the single writer while a
// - panel is open (kills the two-writer race that duplicated output nodes). handled=false — no relay,
// - no panel, or any error — means the MCP must fall back to its own writeCanvas.
async function persistViaHost(
  ipc:        { port: number; token: string } | null,
  canvasPath: string,
  payload:    AgentRunPersist,
): Promise<AgentRunPersistResult> {
  if (!ipc) return { handled: false };
  try {
    const res = await fetch(`http://127.0.0.1:${ipc.port}/persist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-skena-token': ipc.token },
      body: JSON.stringify({ canvasPath, payload }),
    });
    if (!res.ok) return { handled: false };
    return await res.json() as AgentRunPersistResult;
  } catch { return { handled: false }; }
}

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

/** Parse VS Code's relaxed JSON (comments + trailing commas allowed). */
function parseRelaxedJson(raw: string): Record<string, unknown> {
  const stripped = raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');          // - trailing commas
  return JSON.parse(stripped) as Record<string, unknown>;
}

/** Read a settings file and return its parsed content, or null on failure. */
async function readSettingsFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseRelaxedJson(raw);
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

/**
 * Normalize a file URI for storage in a canvas node.
 *
 * - vault:// URIs are kept verbatim.
 * - Absolute paths that sit under the canvas directory are converted to
 *   canvas-relative paths (e.g. `./research/foo.ipynb`).
 * - Absolute paths outside the canvas directory are kept absolute.
 * - Already-relative paths are kept as-is.
 */
function normalizeFileUri(fileUri: string, canvasPath: string): string {
  if (!fileUri || fileUri.startsWith('vault://')) return fileUri;
  if (!path.isAbsolute(fileUri)) return fileUri;

  const canvasDir = path.dirname(canvasPath);
  const rel       = path.relative(canvasDir, fileUri).replace(/\\/g, '/');

  // - path.relative returns something starting with ".." when outside canvasDir
  if (rel.startsWith('..')) return fileUri; // - keep absolute, it's outside the project
  return rel.startsWith('./') ? rel : `./${rel}`;
}

// ─── per-file async lock ───────────────────────────────────────────────────────
//
// - All read-modify-write operations on the same canvas file must be serialized.
// - Without this, two concurrent tool calls (e.g. canvas_add_node + canvas_add_edge)
// - both readCanvas before either writes back → each overwrites the other's changes,
// - causing label collisions and silently lost edges/nodes.
//
// - Usage: wrap the entire read → mutate → write sequence:
//   return withFileLock(fsPath, async () => { ... });

const _fileLocks = new Map<string, Promise<void>>();

function withFileLock<T>(fsPath: string, fn: () => Promise<T>): Promise<T> {
  // - chain onto the previous operation for this path (or a resolved promise)
  const prev  = _fileLocks.get(fsPath) ?? Promise.resolve();
  const next  = prev.then(() => fn(), () => fn()); // - run fn regardless of prev outcome
  // - store a void chain so errors don't leak into future callers
  _fileLocks.set(fsPath, next.then(() => {}, () => {}));
  return next;
}

// ─── canvas I/O ───────────────────────────────────────────────────────────────

async function readCanvas(fsPath: string): Promise<CanvasData> {
  const raw    = await fs.readFile(fsPath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<CanvasData>;
  // - spread first: metadata (sections, aiModel) and any Obsidian-owned field must
  //   survive the round trip — writeCanvas serialises this object, so a dropped key is a deleted key
  const data: CanvasData = {
    ...(parsed as CanvasData),
    nodes: parsed.nodes ?? [],
    edges: parsed.edges ?? [],
  };
  // - ensure every node has a label (idempotent)
  data.nodes = ensureLabels(data.nodes);
  // - an edge stored with no `keepRow` gets true where holding its target moves nothing (§3.5); it
  //   reaches the file with the write the tool makes, if any
  data.edges = markKeepRowOnLoad(data.nodes, data.metadata?.sections ?? [], data.edges);
  return data;
}

// - the target's section, as the engine reads it, for `keepRowOf`
function holdSection(d: CanvasData, edge: CanvasEdge) {
  return sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], edge.toNode) ?? toEngineNodes(d.nodes);
}

async function writeCanvas(fsPath: string, data: CanvasData): Promise<void> {
  // - direct write (no atomic rename) so VS Code's createFileSystemWatcher fires
  // - onDidChange via inotify IN_CLOSE_WRITE, which triggers the webview reload.
  // - Atomic rename emits IN_MOVED_TO instead, which VS Code does not always map
  // - to onDidChange on the target path, leaving the open canvas stale.
  await fs.writeFile(fsPath, JSON.stringify(data, null, 2), 'utf-8');
}

// - read a canvas, or return an empty one if the file doesn't exist yet (create-on-first-write)
async function readCanvasOrEmpty(fsPath: string): Promise<CanvasData> {
  try {
    return await readCanvas(fsPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], edges: [] };
    throw e;
  }
}

// ─── node helpers ─────────────────────────────────────────────────────────────

function findNode(data: CanvasData, ref: string): CanvasNode | undefined {
  // - match by nodeLabel first, then by id
  return data.nodes.find(n => n.nodeLabel === ref) ?? data.nodes.find(n => n.id === ref);
}

// - resolve an edge by id string, or by { from, to } node refs (labels/ids); either endpoint optional
function findEdge(data: CanvasData, ref: unknown): CanvasEdge | undefined {
  if (typeof ref === 'string') return data.edges.find(e => e.id === ref);
  if (ref && typeof ref === 'object') {
    const r = ref as { from?: string; to?: string };
    const fromId = r.from ? findNode(data, r.from)?.id : undefined;
    const toId   = r.to   ? findNode(data, r.to)?.id   : undefined;
    if (fromId === undefined && toId === undefined) return undefined;
    return data.edges.find(e =>
      (fromId === undefined || e.fromNode === fromId) &&
      (toId   === undefined || e.toNode   === toId));
  }
  return undefined;
}

function nodeSnippet(node: CanvasNode): string {
  switch (node.type) {
    case 'text':    return truncate(node.text.replace(/\n/g, ' '), 80);
    case 'file':    return node.file;
    case 'link':    return node.url;
    case 'group':   return node.label ? `"${node.label}"` : '(unnamed group)';
    case 'cell':    return `${node.format} (${node.content.length} chars)`;
    case 'code':    return truncate((node.code ?? '').replace(/\n/g, ' '), 80) || '(empty code cell)';
    case 'kernel':  return `kernel: ${node.displayName ?? node.server}${node.kernelId ? ' (live)' : ''}`;
    case 'chat':    return `${node.agent}: ${node.title}`;
    case 'portal':  return `→ ${node.canvas}`;
    case 'knowledge': return truncate(node.title, 80);
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

function stampLabel(ms: number): string {
  const d   = new Date(ms);
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const dd  = String(d.getDate()).padStart(2, '0');
  const hh  = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${min}`;
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

// - what every reply says when the bump walk ran out of steps with overlaps still on the section
const CAPPED_NOTE = 'some overlaps could not be resolved; run canvas_reflow_section';

/**
 * Run the layout engine over the sections a write touched and apply what it moved. `movers` are the
 * nodes the write added, moved or resized; `holes` name a section plus the snapped x of a column a
 * removed cell left a gap in. One call per section: a push never crosses a section boundary.
 *
 * Returns the touched sections' membership as it stood BEFORE any job ran, for `applyLaneFit`'s
 * `own`: a cell a pack pushed past its section's bottom edge still counts for that section, so the
 * section grows and the ones below move down instead of adopting it. Every job's member list is
 * read from that same pre-engine derivation, so job N cannot change job N+1's slice.
 *
 * `anchor` names the node a write created its new nodes FROM (`after`, `forkOf`, the code cell of a
 * run's output) plus those `joining` ids: they are laid out with the anchor's section and counted
 * for it whatever their y, so a node placed past its bottom edge grows that section instead of
 * being adopted by the one below.
 */
function applyEngine(d: CanvasData, movers: string[], holes: { sectionId: string; columnX: number }[] = [], report?: { capped?: boolean }, anchor?: { id: string; joining: string[] }): Map<string, number> {
  const own = new Map<string, number>();
  const lanes = d.metadata?.sections ?? [];
  if (lanes.length === 0) return own;
  const derived = deriveLanes(d.nodes, lanes);
  const home    = anchor ? derived.find(l => l.memberIds.includes(anchor.id)) : undefined;
  // - the ids that leave the lane their y puts them in for the anchor's
  const joined  = new Set(home && anchor ? anchor.joining.filter(id => !home.memberIds.includes(id)) : []);
  const jobs: { members: Set<string>; moverIds?: string[]; columnX?: number }[] = [];
  const take = (laneId: string) => {
    const lane = derived.find(l => l.id === laneId);
    if (!lane) return null;
    const ids = lane.memberIds.filter(id => !joined.has(id));
    if (lane.id === home?.id) ids.push(...joined);
    for (const id of ids) own.set(id, lane.index);
    return new Set(ids);
  };

  const byLane = new Map<string, string[]>();
  for (const id of movers) {
    const lane = joined.has(id) ? home : derived.find(l => l.memberIds.includes(id));
    if (!lane) continue;
    const list = byLane.get(lane.id);
    if (list) list.push(id); else byLane.set(lane.id, [id]);
  }
  for (const [laneId, moverIds] of byLane) { const members = take(laneId); if (members) jobs.push({ members, moverIds }); }
  for (const h of holes) { const members = take(h.sectionId); if (members) jobs.push({ members, columnX: h.columnX }); }

  for (const job of jobs) {
    const members = toEngineNodes(d.nodes.filter(n => job.members.has(n.id)));
    // - the cells a sequence edge holds on another cell's row, and the nodes hanging below another node
    //   (§3.5), as the webview reads them
    const patches = layoutSection(members, { moverIds: job.moverIds, columnX: job.columnX, riders: ridersOf(members, d.edges), hanging: hangingBelow(members, d.edges), report });
    if (Object.keys(patches).length === 0) continue;
    d.nodes = applyPatchesToCanvas(d.nodes, patches);
  }
  return own;
}

// - x,y of every node, to diff a write against afterwards
function geomOf(d: CanvasData): Map<string, string> {
  return new Map(d.nodes.map(n => [n.id, `${n.x},${n.y}`] as const));
}

// - the labels of the nodes a write moved, in file order, without the ones the caller itself named.
//   Read it AFTER the lane fit: the fit's shifts are moves the caller should hear about too.
function movedLabels(d: CanvasData, before: Map<string, string>, exclude: string[] = []): string[] {
  return d.nodes
    .filter(n => !exclude.includes(n.id) && before.has(n.id) && before.get(n.id) !== `${n.x},${n.y}`)
    .map(n => n.nodeLabel ?? n.id);
}

// - default dimensions per node type
function defaultDims(type: string): { w: number; h: number } {
  const map: Record<string, { w: number; h: number }> = {
    text:   { w: 400, h: 300 },
    cell:   { w: 480, h: 320 },
    code:   { w: NODE_SIZE.code.w, h: NODE_SIZE.code.h },   // - the size the webview gives a code cell, so both build the same column
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

// - which cell is a code cell's output, both ways: `outputNodeId` on the code cell, when that node
//   exists on the canvas
function outputLinks(d: CanvasData): { output: Map<string, CanvasNode>; outputOf: Map<string, CanvasNode> } {
  const byId = new Map(d.nodes.map(n => [n.id, n]));
  const output = new Map<string, CanvasNode>(), outputOf = new Map<string, CanvasNode>();
  for (const n of d.nodes) {
    if (n.type !== 'code' || !n.outputNodeId) continue;
    const o = byId.get(n.outputNodeId);
    if (!o) continue;
    output.set(n.id, o); outputOf.set(o.id, n);
  }
  return { output, outputOf };
}

async function canvasList(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  const d = await readCanvas(p);

  const lines: string[] = [
    `Canvas: ${p}`,
    `${d.nodes.length} node(s), ${d.edges.length} edge(s)`,
    '',
    'Nodes:',
  ];

  const links = outputLinks(d);
  for (const n of d.nodes) {
    const ext    = n as CanvasNodeBase & { createdBy?: string; tags?: string[] };
    const aiMark = ext.createdBy === 'ai' ? ' 🤖' : '';
    const tags   = ext.tags?.length ? `  [${ext.tags.join(', ')}]` : '';
    const out    = links.output.get(n.id), of = links.outputOf.get(n.id);
    const link   = out ? `  (output: ${out.nodeLabel ?? out.id})` : of ? `  (output of: ${of.nodeLabel ?? of.id})` : '';
    lines.push(`  ${(n.nodeLabel ?? '?').padEnd(4)}  ${typeLabel(n).padEnd(10)}  ${nodeSnippet(n)}${aiMark}${tags}${link}`);
  }

  if (d.metadata?.sections?.length) {
    lines.push('', 'Sections:');
    for (const l of deriveLanes(d.nodes, d.metadata.sections)) {
      // - a record has no nodeLabel; a node's displayName is usually unset, so its label is the fallback
      const kRec  = l.kernelId ? kernelById(d, l.kernelId) : null;
      const kernel = kRec ? (kRec.displayName ?? (kRec as { nodeLabel?: string }).nodeLabel ?? kRec.id) : '-';
      const title  = l.title ? `"${l.title}"` : `(untitled, ${stampLabel(l.createdAt)})`;
      // - the member count includes the ones a fold hides
      const fold   = l.folded ? ' folded' : '';
      lines.push(`  ${l.label.padEnd(4)}${`y=${l.top}`.padEnd(8)}${`kernel=${kernel}`.padEnd(11)}${title}${fold} nodes=${l.memberIds.length}`);
    }
  }

  if (d.metadata?.kernels?.length) {
    lines.push('', 'Kernels:');
    for (const k of d.metadata.kernels) {
      const live = k.kernelId ? k.kernelId.slice(0, 8) : '-';
      lines.push(`  ${k.id.padEnd(11)}${(k.displayName ?? '-').padEnd(12)}${`server=${k.server}`.padEnd(16)}live=${live}`);
    }
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
  const lane = deriveLanes(d.nodes, d.metadata?.sections ?? []).find(l => l.memberIds.includes(n.id));
  if (lane) meta.push(`Section: ${lane.label}${lane.folded?.includes(n.id) ? ' hidden (folded)' : ''}`);
  const links = outputLinks(d);
  const out = links.output.get(n.id), of = links.outputOf.get(n.id);
  if (out) meta.push(`Output: ${out.nodeLabel ?? '?'} (id: ${out.id})`);
  if (of)  meta.push(`Output of: ${of.nodeLabel ?? '?'} (id: ${of.id})`);
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
    case 'code':   content = `Language: ${n.language ?? 'python'}  Status: ${n.lastStatus ?? 'never run'}\n\n${n.code ?? ''}`; break;
    case 'kernel': content = `Kernel: ${n.displayName ?? 'kernel'}  Server: ${n.server}  ${n.kernelId ? `Live id: ${n.kernelId}` : '(not started)'}`; break;
    case 'chat':   content = `Agent: ${n.agent}  Model: ${n.model ?? 'default'}\nTitle: ${n.title}`; break;
    case 'portal': content = `Sub-canvas: ${n.canvas}`; break;
    case 'knowledge': content = `Format: knowledge\nServer: ${n.server}\nSource: ${n.uri}\nFetched: ${n.fetchedAt}${n.error ? `\nLast refresh failed: ${n.error}` : ''}\n\n${n.text}`; break;
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
      n.type === 'code'   ? (n.code ?? '') : '',
      n.type === 'chat'   ? n.title    : '',
      n.type === 'portal' ? n.canvas   : '',
      n.type === 'knowledge' ? `${n.title} ${n.text}` : '',
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
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
  const d    = await readCanvasOrEmpty(p);   // - create-on-first-add: empty canvas if the file is new
  // - `after` and `forkOf` both let the engine place the new node, so a supplied x/y is ignored (the
  //   reply says so). `after` takes any node; `forkOf` names a code cell, since it opens a new pair
  //   and only a code cell has an output column. Without an explicit `type`, a node made off a code
  //   cell is a code cell and anything else gets a note.
  const anchorRef = (args.after as string | undefined) ?? (args.forkOf as string | undefined);
  const anchor    = anchorRef !== undefined ? findNode(d, anchorRef) : undefined;
  if (anchorRef !== undefined && !anchor) return `Node not found: ${anchorRef}`;

  const type = (args.type as string | undefined) ?? (anchor?.type === 'code' ? 'code' : 'text');
  const dims = defaultDims(type);
  const w    = (args.width  as number | undefined) ?? dims.w;
  // - a code cell written here is as tall as its text needs, the way the webview sizes one the user
  //   edits; an explicit height still wins. `codeCellHeight` steps by 50, off the 100 grid, so that
  //   height is the one size not snapped.
  const sized = type === 'code' && args.height === undefined && typeof args.content === 'string';
  const h     = sized ? codeCellHeight(estimateCodeNeedPx(args.content as string)) : ((args.height as number | undefined) ?? dims.h);

  let placed: { x: number; y: number } | null = null;
  if (anchor) {
    if (args.forkOf !== undefined && anchor.type !== 'code') return 'forkOf must be a code cell';
    // - the anchor's own section; a canvas that has no sections yet still gets a position out of this
    const around = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], anchor.id) ?? toEngineNodes(d.nodes);
    placed = args.after !== undefined
      ? insertAfter(around, anchor.id)
      : forkOf(around, anchor.id, (args.side as 'right' | 'left' | undefined) ?? 'right', snapGrid(w));
    // - the anchor is a node of the section either way, so the only refusal left is a left fork off
    //   the edge
    if (!placed) return 'a left fork does not fit before the origin';
  }

  const pos  = placed ?? ((args.x !== undefined && args.y !== undefined)
    ? { x: args.x as number, y: args.y as number }
    : autoPlace(d.nodes, w, h));

  // - never off the canvas, as the webview's creation funnel
  const at = clampToOrigin(snapGrid(pos.x), snapGrid(pos.y));

  // - build the shared base fields for all node types
  const base = {
    id:        uid(),
    type:      type as CanvasNode['type'],
    x:         at.x,
    y:         at.y,
    width:     snapGrid(w),
    height:    sized ? h : snapGrid(h),
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
    case 'code':
      newNode = { ...base, type: 'code', code: (args.content as string | undefined) ?? '', language: 'python' } as CanvasNode;
      break;
    case 'file': {
      // - normalize absolute paths to canvas-relative (vault:// URIs are kept as-is)
      const rawFile = (args.file as string | undefined) ?? '';
      const fileUri = normalizeFileUri(rawFile, p);
      newNode = { ...base, type: 'file', file: fileUri } as CanvasNode;
      break;
    }
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
  const before  = geomOf(d);
  d.nodes.push(labeled);
  // - a cell inserted into a FOLDED section is a hidden member of it, like a run's output: it stays
  //   pinned to that lane until the user unfolds, rather than being adopted by the lane below
  if (anchor && d.metadata?.sections) d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, anchor.id, labeled.id) };
  const report: { capped?: boolean } = {};
  const own = applyEngine(d, [labeled.id], [], report, anchor ? { id: anchor.id, joining: [labeled.id] } : undefined);
  Object.assign(d, applyLaneFit(d, Date.now(), own));   // - every write fits the sections
  const moved = movedLabels(d, before, [labeled.id]);
  await writeCanvas(p, d);

  // - the engine and the fit may both have moved the new node: report where the file has it
  const final = d.nodes.find(n => n.id === labeled.id) ?? labeled;
  const lines = [
    `Created node ${labeled.nodeLabel} (id: ${labeled.id})`,
    `Type: ${type}`,
    `Position: (${final.x}, ${final.y})  Size: ${final.width}×${final.height}`,
  ];
  if (anchor && (args.x !== undefined || args.y !== undefined)) lines.push(`x/y ignored: placed ${args.after !== undefined ? 'after' : 'as a fork of'} ${anchor.nodeLabel ?? anchor.id}`);
  if (moved.length) lines.push(`Moved: ${moved.join(', ')}`);
  if (report.capped) lines.push(CAPPED_NOTE);
  lines.push(`Canvas: ${p}`);
  return lines.join('\n');
  }); // - withFileLock
}

async function canvasUpdateNode(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
  const d = await readCanvas(p);
  const n = findNode(d, args.ref as string);
  if (!n) return `Node not found: ${args.ref}`;

  const idx     = d.nodes.indexOf(n);
  const updated = { ...n } as CanvasNode & { tags?: string[] };

  if (args.content !== undefined) {
    // - a knowledge node's text is a cached copy of the server's; editing it here would make the
    //   node disagree with its source and a refresh would silently undo the edit
    if (n.type === 'knowledge') return 'content is not settable on a knowledge node — use canvas_add_knowledge';
    if (n.type === 'text') (updated as typeof n & { text: string }).text = args.content as string;
    if (n.type === 'cell') (updated as typeof n & { content: string }).content = args.content as string;
    if (n.type === 'code') (updated as typeof n & { code: string }).code = args.content as string;
  }
  if (args.tags  !== undefined) updated.tags  = args.tags  as string[];
  if (args.color !== undefined) updated.color = args.color as CanvasNodeBase['color'];
  if (args.label !== undefined) updated.nodeLabel = args.label as string;
  // - move / resize (absolute coords, partial — only supplied fields change)
  // - never off the canvas, as the webview's creation funnel
  const at = clampToOrigin(
    args.x !== undefined ? snapGrid(args.x as number) : updated.x,
    args.y !== undefined ? snapGrid(args.y as number) : updated.y,
  );
  if (args.x      !== undefined) updated.x      = at.x;
  if (args.y      !== undefined) updated.y      = at.y;
  if (args.width  !== undefined) updated.width  = snapGrid(args.width  as number);
  if (args.height !== undefined) updated.height = snapGrid(args.height as number);
  // - text that really CHANGED, no explicit height: the cell is re-sized to what it now needs,
  //   growing or shrinking as the webview does on an edit. Re-sending the same text changes nothing,
  //   so a cell given a height by hand keeps it. A new height re-packs the column, as a resize does.
  let resized = false;
  if (n.type === 'code' && args.height === undefined && args.content !== undefined && (args.content as string) !== n.code) {
    updated.height = codeCellHeight(estimateCodeNeedPx(args.content as string));
    resized = updated.height !== n.height;
  }

  // - an output cell's column is the pair's, so an oversized one would overlap the pair to its right
  const isOutput = d.nodes.some(o => o.type === 'code' && o.outputNodeId === n.id);
  const clamped: string[] = [];
  if (isOutput && updated.width  > OUTPUT_MAX_W) { updated.width  = OUTPUT_MAX_W; clamped.push(`width to ${OUTPUT_MAX_W}`); }
  if (isOutput && updated.height > OUTPUT_MAX_H) { updated.height = OUTPUT_MAX_H; clamped.push(`height to ${OUTPUT_MAX_H}`); }

  const before = geomOf(d);
  d.nodes[idx] = updated;
  // - a move or a resize re-packs the node's column and bumps whatever it now really overlaps
  const geom = args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined || resized;
  // - a section too dense for the bump walk to clear is reported, not silently left overlapping
  const report: { capped?: boolean } = {};
  const own  = geom ? applyEngine(d, [updated.id], [], report) : new Map<string, number>();
  Object.assign(d, applyLaneFit(d, Date.now(), own));   // - every write fits the sections
  const moved = geom ? movedLabels(d, before, [updated.id]) : [];
  await writeCanvas(p, d);
  return `Updated node ${updated.nodeLabel ?? updated.id}`
    + (clamped.length ? ` — output cell clamped: ${clamped.join(', ')}` : '')
    + (moved.length ? ` — moved ${moved.join(', ')}` : '')
    + (report.capped ? ` — ${CAPPED_NOTE}` : '');
  }); // - withFileLock
}

// - the text comes from the caller: the MCP process holds no knowledge-server token, so an agent
// - that searched the server itself passes what it read back in here
async function canvasAddKnowledge(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
  const d = await readCanvasOrEmpty(p);   // - create-on-first-add, as canvas_add_node does
  const anchorRef = args.after as string | undefined;
  const anchor    = anchorRef !== undefined ? findNode(d, anchorRef) : undefined;
  if (anchorRef !== undefined && !anchor) return `Node not found: ${anchorRef}`;

  const w = NODE_SIZE.knowledge.w;
  const h = NODE_SIZE.knowledge.h;
  const server = (args.server as string | undefined) ?? '';
  const uri    = (args.uri    as string | undefined) ?? '';

  // - `after` lets the engine place the node, so a supplied x/y is ignored (the reply says so)
  let placed: { x: number; y: number } | null = null;
  if (anchor) {
    const around = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], anchor.id) ?? toEngineNodes(d.nodes);
    placed = insertAfter(around, anchor.id);
  }
  const pos = placed ?? ((args.x !== undefined && args.y !== undefined)
    ? { x: args.x as number, y: args.y as number }
    : autoPlace(d.nodes, w, h));
  const at = clampToOrigin(snapGrid(pos.x), snapGrid(pos.y));

  // - no `changed`: a node that was just fetched has nothing to compare against
  const node: CanvasNode = {
    id:        uid(),
    type:      'knowledge',
    x:         at.x,
    y:         at.y,
    width:     w,
    height:    h,
    server,
    uri,
    title:     (args.title as string | undefined) ?? '',
    text:      (args.text  as string | undefined) ?? '',
    fetchedAt: new Date().toISOString(),
    createdBy: 'ai',
  } as CanvasNode;

  const labeled = assignLabel(node, d.nodes);
  const before  = geomOf(d);
  d.nodes.push(labeled);
  // - a node added under a member of a FOLDED section is a hidden member of it too, not adopted by
  //   the section below
  if (anchor && d.metadata?.sections) d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, anchor.id, labeled.id) };
  const report: { capped?: boolean } = {};
  const own = applyEngine(d, [labeled.id], [], report, anchor ? { id: anchor.id, joining: [labeled.id] } : undefined);
  Object.assign(d, applyLaneFit(d, Date.now(), own));   // - every write fits the sections
  const moved = movedLabels(d, before, [labeled.id]);
  await writeCanvas(p, d);

  const final = d.nodes.find(n => n.id === labeled.id) ?? labeled;
  const lines = [
    `Created node ${labeled.nodeLabel} (id: ${labeled.id})`,
    'Type: knowledge',
    `Source: ${server} ${uri}`,
    `Position: (${final.x}, ${final.y})  Size: ${final.width}×${final.height}`,
  ];
  if (anchor && (args.x !== undefined || args.y !== undefined)) lines.push(`x/y ignored: placed after ${anchor.nodeLabel ?? anchor.id}`);
  if (moved.length) lines.push(`Moved: ${moved.join(', ')}`);
  if (report.capped) lines.push(CAPPED_NOTE);
  lines.push(`Canvas: ${p}`);
  return lines.join('\n');
  }); // - withFileLock
}

// - older than any refreshAfterHours window, so the host's staleness check picks the node up
const KNOWLEDGE_EPOCH = '1970-01-01T00:00:00.000Z';

async function canvasRefreshKnowledge(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
  const d = await readCanvas(p);
  const n = findNode(d, args.ref as string);
  if (!n) return `Node not found: ${args.ref}`;
  if (n.type !== 'knowledge') return `Node ${n.nodeLabel ?? n.id} is not a knowledge node`;
  // - this process has no token for the knowledge server, so it only ages the node out; the host
  //   fetches the new text when the canvas is next opened
  n.fetchedAt = KNOWLEDGE_EPOCH;
  await writeCanvas(p, d);
  return `Marked ${n.nodeLabel ?? n.id} for refresh on the next open`;
  }); // - withFileLock
}

async function canvasRemoveNode(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
  const d    = await readCanvas(p);
  const refs = Array.isArray(args.ref) ? args.ref as string[] : [args.ref as string];

  const toRemove = new Set<string>();
  const labels: string[] = [];
  for (const ref of refs) {
    const n = findNode(d, ref);
    if (n) { toRemove.add(n.id); labels.push(n.nodeLabel ?? n.id); }
  }
  if (toRemove.size === 0) return `No nodes found for: ${refs.join(', ')}`;

  // - read the holes while the doomed nodes are still there; the engine closes them after
  const holes  = columnsOfDeleted(d.nodes, d.metadata?.sections ?? [], toRemove);
  const before = geomOf(d);
  d.nodes = d.nodes.filter(n => !toRemove.has(n.id));
  d.edges = d.edges.filter(e => !toRemove.has(e.fromNode) && !toRemove.has(e.toNode));
  // - a removed node must not stay in a fold list, pinning its lane to an id that is gone
  if (d.metadata?.sections) d.metadata = { ...d.metadata, sections: pruneFoldedIds(d.metadata.sections, toRemove) };
  const report: { capped?: boolean } = {};
  const own = applyEngine(d, [], holes, report);
  Object.assign(d, applyLaneFit(d, Date.now(), own));   // - every write fits the sections
  const moved = movedLabels(d, before);
  await writeCanvas(p, d);
  return `Removed ${toRemove.size} node(s): ${labels.join(', ')}`
    + (moved.length ? ` — moved ${moved.join(', ')}` : '')
    + (report.capped ? ` — ${CAPPED_NOTE}` : '');
  }); // - withFileLock
}

async function canvasAddEdge(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
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
  // - connecting moves nothing: the edge keeps its target on the source's row only where holding it
  //   moves nothing (§3.5), as when the user draws one
  d.edges.push({ ...edge, keepRow: keepRowOf(holdSection(d, edge), d.edges, edge) });
  await writeCanvas(p, d);
  return `Connected ${fn.nodeLabel ?? fn.id} → ${tn.nodeLabel ?? tn.id}  (edge id: ${edge.id})`;
  }); // - withFileLock
}

async function canvasUpdateEdge(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const e = findEdge(d, args.ref);
    if (!e) return `Edge not found: ${JSON.stringify(args.ref)}`;
    // - new sides test `keepRow` again, as for a new edge (§3.5). An edge that stops holding its target
    //   releases it, and its column packs, as when the edge is removed; one that starts moves nothing.
    const around = holdSection(d, e);
    const was = ridersOf(around, [e]).has(e.toNode);
    // - a side passed with the value already stored is no new side; an absent side reads as the
    //   engine reads it, right → left
    const newSides = (args.fromSide !== undefined && args.fromSide !== (e.fromSide ?? 'right'))
                  || (args.toSide   !== undefined && args.toSide   !== (e.toSide   ?? 'left'));
    if (args.label    !== undefined) e.label    = args.label as string;
    if (args.color    !== undefined) e.color    = args.color as CanvasEdge['color'];
    if (args.fromSide !== undefined) e.fromSide = args.fromSide as CanvasEdge['fromSide'];
    if (args.toSide   !== undefined) e.toSide   = args.toSide as CanvasEdge['toSide'];
    if (newSides) e.keepRow = keepRowOf(around, d.edges, e);
    const before = geomOf(d);
    const report: { capped?: boolean } = {};
    if (was && !ridersOf(around, [e]).has(e.toNode)) {
      Object.assign(d, applyLaneFit(d, Date.now(), applyEngine(d, [e.toNode], [], report)));
    }
    const moved = movedLabels(d, before);
    await writeCanvas(p, d);
    return `Updated edge ${e.id}`
      + (moved.length ? ` — moved ${moved.join(', ')}` : '')
      + (report.capped ? ` — ${CAPPED_NOTE}` : '');
  }); // - withFileLock
}

async function canvasRemoveEdge(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const e = findEdge(d, args.ref);
    if (!e) return `Edge not found: ${JSON.stringify(args.ref)}`;
    // - read it before the edge goes: afterwards nothing says the target was ever held on that row
    const around = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], e.toNode) ?? toEngineNodes(d.nodes);
    const released = ridersOf(around, [e]).has(e.toNode);
    d.edges = d.edges.filter(x => x.id !== e.id);
    const before = geomOf(d);
    const report: { capped?: boolean } = {};
    if (released) Object.assign(d, applyLaneFit(d, Date.now(), applyEngine(d, [e.toNode], [], report)));
    const moved = movedLabels(d, before);
    await writeCanvas(p, d);
    return `Removed edge ${e.id}`
      + (moved.length ? ` — moved ${moved.join(', ')}` : '')
      + (report.capped ? ` — ${CAPPED_NOTE}` : '');
  }); // - withFileLock
}

// - batch move/resize: one file write for many nodes (partial, absolute coords per item)
async function canvasLayout(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d     = await readCanvas(p);
    const items = Array.isArray(args.nodes) ? args.nodes as Array<Record<string, unknown>> : [];
    const done: string[] = [];
    const missing: string[] = [];
    const movers: string[] = [];
    const before = geomOf(d);
    for (const it of items) {
      const n = findNode(d, it.ref as string);
      if (!n) { missing.push(String(it.ref)); continue; }
      // - never off the canvas, as the webview's creation funnel
      const at = clampToOrigin(
        it.x !== undefined ? snapGrid(it.x as number) : n.x,
        it.y !== undefined ? snapGrid(it.y as number) : n.y,
      );
      if (it.x      !== undefined) n.x      = at.x;
      if (it.y      !== undefined) n.y      = at.y;
      if (it.width  !== undefined) n.width  = snapGrid(it.width  as number);
      if (it.height !== undefined) n.height = snapGrid(it.height as number);
      if (it.x !== undefined || it.y !== undefined || it.width !== undefined || it.height !== undefined) movers.push(n.id);
      done.push(n.nodeLabel ?? n.id);
    }
    const report: { capped?: boolean } = {};
    Object.assign(d, applyLaneFit(d, Date.now(), applyEngine(d, movers, [], report)));   // - every write fits the sections
    const moved = movedLabels(d, before, movers);
    await writeCanvas(p, d);
    return `Laid out ${done.length} node(s): ${done.join(', ')}` +
      (moved.length ? ` — moved ${moved.join(', ')}` : '') +
      (missing.length ? ` — not found: ${missing.join(', ')}` : '') +
      (report.capped ? ` — ${CAPPED_NOTE}` : '');
  }); // - withFileLock
}

async function canvasCreate(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    try { await fs.access(p); return `Canvas already exists: ${p}`; } catch { /* - create it */ }
    await fs.mkdir(path.dirname(p), { recursive: true });
    await writeCanvas(p, { nodes: [], edges: [] });
    return `Created empty canvas: ${p}`;
  }); // - withFileLock
}

async function canvasPinOutput(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
  const d       = await readCanvas(p);
  const format  = (args.format as 'html' | 'markdown' | 'image' | undefined) ?? 'html';
  const content = (args.content as string | undefined) ?? '';
  const W = 480, H = 320;

  // - a pin onto a code cell with no output yet IS that cell's output: same slot as a run, so the
  //   engine keeps the pair together. Off a code cell, or onto one whose output already fills that
  //   slot, it stays a free node placed by the old free-slot search — the engine would otherwise put
  //   it exactly on the existing output, and nothing moves it off (the mover is skipped by the free
  //   settle, and an output cell is not something a free node pushes).
  let geom = { x: 0, y: 0, width: W, height: H };
  let sourceNode: CanvasNode | undefined;
  if (args.sourceRef) {
    sourceNode = findNode(d, args.sourceRef as string);
    if (sourceNode) {
      const around = sourceNode.type === 'code' && !sourceNode.outputNodeId
        ? sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], sourceNode.id)
        : null;
      const slot   = around && placeOutput(around, sourceNode.id);
      geom = slot ?? { ...outputCellGeom(d.metadata?.sections ?? [], sourceNode, 60), width: W, height: H };   // - W/H match outputCellGeom's 480x320; a manual pin keeps its 60px gap
    }
  }
  if (!sourceNode) geom = { ...autoPlace(d.nodes, W, H), width: W, height: H };

  const cell: CanvasNode = {
    id:        uid(),
    type:      'cell',
    ...geom,
    format,
    content,
    createdBy: 'ai',
    ...(args.tags ? { tags: args.tags as string[] } : {}),
  } as CanvasNode;

  const labeled = assignLabel(cell, d.nodes);
  const before  = geomOf(d);
  d.nodes.push(labeled);

  let edgeId = '';
  let pinEdge: CanvasEdge | undefined;
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
    edgeId = edge.id;
    pinEdge = edge;
  }

  // - the cell adopts the pinned node as its output, which is what keeps the two in one pair. A cell
  //   that already has an output keeps it, and the pin stays a free node.
  const adopted = sourceNode?.type === 'code' && !sourceNode.outputNodeId;
  if (adopted) (sourceNode as CodeNode).outputNodeId = labeled.id;
  if (sourceNode && d.metadata?.sections) d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, sourceNode.id, labeled.id) };   // - an output of a folded cell stays folded
  // - a free pin is a column member its edge could hold: `keepRow` as for any new edge, read in the
  //   source's section with the pin joining it (§3.5)
  if (pinEdge) d.edges.push({ ...pinEdge, keepRow: keepRowOf(sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], sourceNode!.id, [labeled.id]) ?? toEngineNodes(d.nodes), d.edges, pinEdge) });
  // - an adopted pin is the mover, as a run's output is. A free one is NOT: it starts beside a code
  //   cell that already has an output, so it has to be the node the settle pushes down and clear,
  //   not the one that stays put — the code cell is what the engine is asked to lay out around.
  const report: { capped?: boolean } = {};
  const own = applyEngine(d, [adopted || !sourceNode ? labeled.id : sourceNode.id], [], report, sourceNode ? { id: sourceNode.id, joining: [labeled.id] } : undefined);
  Object.assign(d, applyLaneFit(d, Date.now(), own));   // - every write fits the sections
  const moved = movedLabels(d, before, [labeled.id]);
  await writeCanvas(p, d);

  const lines = [`Pinned output as cell node ${labeled.nodeLabel} (id: ${labeled.id})`];
  if (sourceNode) lines.push(`Connected from ${sourceNode.nodeLabel ?? sourceNode.id} with edge "${d.edges.find(e => e.id === edgeId)?.label}"`);
  if (moved.length) lines.push(`Moved: ${moved.join(', ')}`);
  if (report.capped) lines.push(CAPPED_NOTE);
  lines.push(`Canvas: ${p}`);
  return lines.join('\n');
  }); // - withFileLock
}

// - kernel servers for the agent-run path: prefer the harness-injected env (JSON),
// - else fall back to the same ~/.aix/xlmcp/.env resolution the host uses.
function loadKernelServersFromEnv(): KernelServerConfig[] {
  const raw = process.env.SKENA_JUPYTER_KERNELS;
  if (raw) {
    try { return JSON.parse(raw) as KernelServerConfig[]; } catch { /* - fall through to config */ }
  }
  return resolveKernelConfig(undefined, null);
}

// - run ONE code cell on its kernel: mark running (stripe via soft-reload), stream live output to
// - the host webview via the relay, persist the output cell + status. Mutates `d`; writes the canvas.
async function runCellCore(
  d:      CanvasData,
  cell:   CodeNode,
  kernel: KernelLike,
  kernelId: string,
  server: KernelServerConfig,
  p:      string,
  ipc:    { port: number; token: string } | null,
): Promise<{ status: 'ok' | 'error'; outLabel: string; streamText: string; moved: string[]; capped: boolean; error?: string }> {
  // - single-writer: when a panel is open the host owns the .canvas write (no MCP write → no
  // - watcher reload race). It returns the authoritative output-node id. No panel → hostOwns is
  // - false and the MCP writes the file itself, as before.
  const startRes = await persistViaHost(ipc, p, { phase: 'start', cellNodeId: cell.id, kernelNodeId: kernel.id, kernelId });
  const hostOwns = startRes.handled;
  const outId    = hostOwns ? (startRes.outputNodeId ?? cell.outputNodeId ?? uid()) : (cell.outputNodeId ?? uid());
  if (!hostOwns) { cell.lastStatus = 'running'; await writeCanvas(p, d); }

  // - the engine's slot for this cell's output: its pair's output column, the cell's y. The fallback
  //   covers a canvas with no sections; a code cell inside one is always in a column.
  const around  = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], cell.id);
  const outPrev = d.nodes.find(n => n.id === outId && n.type === 'cell');
  const outGeom = (around && placeOutput(around, cell.id, outPrev ? { w: outPrev.width, h: outPrev.height } : undefined))
    ?? outputCellGeom(d.metadata?.sections ?? [], cell);
  // - same edge-id scheme as the host persist (`e-${outId}`), so a streaming run's live-delta edge and
  // - the host's persisted edge are ONE edge, not two with different ids
  const outEdge = { id: `e-${outId}`, fromNode: cell.id, fromSide: 'right' as const, toNode: outId, toSide: 'left' as const, toEnd: 'arrow' as const };

  let lastPost = 0;
  const postFrame = (partial: CollectedOutput) => {
    if (!ipc) return;
    if (!hasVisibleOutput(partial)) return;   // - skip style/script-only + whitespace: no empty node
    const { format, content } = renderOutput(partial);
    const message = {
      type: 'runOutput', codeNodeId: cell.id, lastStatus: 'running',
      kernelNodeId: kernel.id, kernelId, source: 'mcp',
      outputNode: { id: outId, type: 'cell', format, content, ...outGeom, createdBy: 'ai' },
      edge: outEdge,
    };
    void fetch(`http://127.0.0.1:${ipc.port}/delta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-skena-token': ipc.token },
      body: JSON.stringify({ canvasPath: p, message }),
    }).catch(() => { /* - relay is best-effort */ });
  };
  const onDelta = (partial: CollectedOutput) => {
    const now = Date.now();
    if (now - lastPost >= 350) { lastPost = now; postFrame(partial); }   // - coalesce fast frames
  };

  const ids = { msgId: crypto.randomUUID(), session: crypto.randomUUID(), date: new Date().toISOString() };
  let out: CollectedOutput;
  try {
    out = await executeCell(server, kernelId, cell.code, ids, onDelta);
  } catch (e) {
    // - transport/kernel failure: persist error status so the cell isn't left stuck 'running' on disk
    if (hostOwns) {
      await persistViaHost(ipc, p, { phase: 'done', cellNodeId: cell.id, kernelNodeId: kernel.id, kernelId, outputNodeId: outId, status: 'error', output: null });
    } else {
      cell.lastStatus = 'error';
      cell.lastRun    = Date.now();
      await writeCanvas(p, d);
    }
    return { status: 'error', outLabel: '(error)', streamText: '', moved: [], capped: false, error: e instanceof Error ? e.message : String(e) };
  }

  const { format, content } = renderOutput(out);
  const hasOutput = hasVisibleOutput(out);
  let outLabel = '(no output)';
  let moved: string[] = [];
  const report: { capped?: boolean } = {};

  if (hostOwns) {
    // - host is the single writer: it applies the output node, writes with self-save suppression,
    // - and sends the final runOutput to the webview. Keep local status/label right for the return.
    await persistViaHost(ipc, p, {
      phase: 'done', cellNodeId: cell.id, kernelNodeId: kernel.id, kernelId,
      outputNodeId: outId, status: out.status === 'error' ? 'error' : 'ok',
      output: hasOutput ? { format, content } : null,
    });
    cell.lastStatus = out.status === 'error' ? 'error' : 'ok';
    cell.lastRun    = Date.now();
    // - keep the MCP's in-memory canvas in sync with what the host committed, so if a LATER cell in
    //   this run falls back to a direct writeCanvas(d) it can't wipe this cell's output-node id
    if (hasOutput) cell.outputNodeId = outId;
    outLabel        = hasOutput ? outId : '(no output)';
  } else {
    // - before the engine: it replaces every node it moves, and this cell may be one of them
    cell.lastStatus = out.status === 'error' ? 'error' : 'ok';
    cell.lastRun    = Date.now();
    const before = geomOf(d);
    let own = new Map<string, number>();
    if (hasOutput) {
      // - persist to the SAME node id the live frames streamed to (outId), so a re-run updates in place
      const existing = d.nodes.find(n => n.id === outId && n.type === 'cell') as CellNode | undefined;
      if (existing) {
        // - content only; keep the node where it is (the user may have dragged it — don't snap it)
        existing.format  = format;
        existing.content = content;
        // - ensure the connecting edge exists (a stale reload may have dropped it); match by node
        //   pair so an old `edge-out-` edge on a pre-fix canvas isn't duplicated by a new `e-` one
        if (!d.edges.some(e => e.fromNode === cell.id && e.toNode === outId)) d.edges.push(outEdge);
        outLabel = existing.nodeLabel ?? existing.id;
      } else {
        const outNode: CellNode = { id: outId, type: 'cell', format, content, ...outGeom, createdBy: 'ai' };
        const labeled = assignLabel(outNode, d.nodes);
        d.nodes.push(labeled);
        d.edges.push(outEdge);
        cell.outputNodeId = outId;   // - before the engine: the link is what makes the new cell this code cell's output rather than a free node
        // - only a NEW output node is pinned (same rule as the host): a re-run must not re-pin an
        //   output the user has since dragged out of the folded section
        if (d.metadata?.sections) d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, cell.id, outId) };
        own = applyEngine(d, [outId], [], report, { id: cell.id, joining: [outId] });
        outLabel = labeled.nodeLabel ?? labeled.id;
      }
    }

    Object.assign(d, applyLaneFit(d, Date.now(), own));   // - every write fits the sections; d is reused for the next cell of a chain, so a discarded result would be undone by that cell's write
    moved = movedLabels(d, before);
    await writeCanvas(p, d);

    // - deterministic final frame so the result doesn't depend on the (racy) soft-reload winning
    if (ipc) {
      const message = hasOutput
        ? { type: 'runOutput', codeNodeId: cell.id, lastStatus: cell.lastStatus, kernelNodeId: kernel.id, kernelId, source: 'mcp', outputNode: { id: outId, type: 'cell', format, content, ...outGeom, createdBy: 'ai' }, edge: outEdge }
        : { type: 'runOutput', codeNodeId: cell.id, lastStatus: cell.lastStatus, kernelNodeId: kernel.id, kernelId, source: 'mcp' };
      void fetch(`http://127.0.0.1:${ipc.port}/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-skena-token': ipc.token },
        body: JSON.stringify({ canvasPath: p, message }),
      }).catch(() => { /* - best-effort */ });
    }
  }

  return { status: cell.lastStatus, outLabel, moved, capped: report.capped === true, streamText: out.streamText, error: out.error };
}

// - resolve kernelRef against a KernelRecord (by id or displayName) or a kernel node (label or id)
function kernelByRef(d: CanvasData, ref: string): KernelLike | null {
  const n = findNode(d, ref);
  return kernelById(d, ref)
    ?? (d.metadata?.kernels?.find(k => k.displayName === ref) ?? null)
    ?? (n?.type === 'kernel' ? kernelById(d, n.id) : null);
}

interface RunContext { kernel: KernelLike; kernelId: string; server: KernelServerConfig; ipc: { port: number; token: string } | null }

// - everything one run needs, or the error text explaining why it cannot start: an explicit kernelRef
// - (a kernel record id/name, or a kernel node label/id), else the cell's kernel — edge-bound kernel,
// - else the kernel bound to the cell's section.
function prepareRun(d: CanvasData, cell: CanvasNode, kernelRef?: string): RunContext | string {
  let kernel: KernelLike | null = kernelRef ? kernelByRef(d, kernelRef) : null;
  if (kernelRef && !kernel) return `error: no kernel matches "${kernelRef}" — a record id or display name, or a kernel node label/id`;
  if (!kernel) {
    const kid = resolveCellKernel(cell.id, cellKernelView(d));
    kernel = kid ? kernelById(d, kid) : null;
  }
  if (!kernel) return 'error: no kernel bound to this cell — connect it to a kernel node, or bind a kernel to its section from the rail';

  const servers = loadKernelServersFromEnv();
  const server  = servers.find(s => s.name === kernel.server);
  if (!server) return `error: unknown server ${kernel.server}`;
  if (!kernel.kernelId) return 'error: kernel has no live kernelId (open the canvas so Skena starts it)';

  return { kernel, kernelId: kernel.kernelId, server, ipc: parseRunIpc(process.env.SKENA_RUN_IPC) };
}

async function canvasRunCell(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);

    const cell = findNode(d, args.cellRef as string);
    if (!cell || cell.type !== 'code') return `error: ${args.cellRef} is not a code node`;

    const prep = prepareRun(d, cell, args.kernelRef as string | undefined);
    if (typeof prep === 'string') return prep;
    const { kernel, kernelId, server, ipc } = prep;

    // - run-with-upstream: run each upstream cell (closer to the kernel) whose flag is clear, in
    // - dependency order, then the requested cell. Already-run ('ok') cells are skipped; a failed
    // - upstream cell aborts the chain.
    const upstream = upstreamCellsForRun(cell.id, cellKernelView(d));
    const ran: string[] = [];
    for (const upId of upstream) {
      const up = d.nodes.find(n => n.id === upId && n.type === 'code') as CodeNode | undefined;
      if (!up || up.lastStatus === 'ok') continue;   // - already run (and unchanged) → skip
      const r = await runCellCore(d, up, kernel, kernelId, server, p, ipc);
      ran.push(`${up.nodeLabel ?? up.id}:${r.status}`);
      if (r.status === 'error') {
        return `error: upstream ${up.nodeLabel ?? up.id} failed — ${r.error ?? ''} (ran ${ran.join(', ')})`;
      }
    }

    // - the upstream loop may have re-fitted sections and replaced d.nodes: read the target and kernel again
    const cellNow   = d.nodes.find(n => n.id === cell.id) as CodeNode | undefined;
    const kernelNow = kernelById(d, kernel.id);
    if (!cellNow || !kernelNow) return 'error: cell or kernel vanished during the upstream run';

    const res    = await runCellCore(d, cellNow, kernelNow, kernelId, server, p, ipc);
    const prefix = ran.length ? `(upstream ${ran.join(', ')}) ` : '';
    return `${prefix}ran ${cellNow.nodeLabel ?? cellNow.id} on ${kernelNow.server} → ${res.outLabel}: ${res.status}` +
      `${res.moved.length ? ` — moved ${res.moved.join(', ')}` : ''}` +
      `${res.capped ? ` — ${CAPPED_NOTE}` : ''}` +
      `${res.error ? ' — ' + res.error : ''}\n${res.streamText.slice(0, 500)}`;
  }); // - withFileLock
}

async function canvasAddSection(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d     = await readCanvasOrEmpty(p);
    const lanes = d.metadata?.sections ?? [];
    const now   = Date.now();

    let next: SectionLane[];
    if (args.y !== undefined) {
      const y = args.y as number;
      next = insertLaneAt(lanes, y, now);
      if (next === lanes) {
        return y < 0 ? 'error: y must be ≥ 0' : `error: a section already starts at y=${snapGrid(y)}`;
      }
    } else {
      // - append under the last section's fitted range, as the rail's + does
      const last = deriveLanes(d.nodes, lanes).at(-1);
      let y = 0;
      if (last) {
        const hidden  = new Set(last.folded ?? []);
        const visible = d.nodes.filter(n => last.memberIds.includes(n.id) && !hidden.has(n.id));
        y = last.top + sectionTargetHeight(last, visible);
      }
      next = insertLaneAt(lanes, y, now);
      if (next === lanes) return `error: a section already starts at y=${snapGrid(y)}`;
    }

    const created = next.find(l => !lanes.includes(l));
    if (created && typeof args.title === 'string' && args.title) created.title = args.title as string;
    d.metadata = { ...d.metadata, sections: next };
    Object.assign(d, applyLaneFit(d, now));   // - every write fits the sections
    await writeCanvas(p, d);

    const shown = deriveLanes(d.nodes, d.metadata?.sections ?? []).find(l => l.id === created?.id);
    return `Created section ${shown?.label ?? 'S?'} (id ${created?.id}) at y=${shown?.top ?? created?.y}`;
  }); // - withFileLock
}

async function canvasRemoveSection(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d     = await readCanvas(p);
    const lanes = d.metadata?.sections ?? [];
    const lane  = sectionByRef(lanes, args.ref as string);
    if (!lane) return `error: no section matches ${args.ref}`;

    const derived = deriveLanes(d.nodes, lanes).find(l => l.id === lane.id);
    const label   = derived?.label ?? lane.id;
    // - the pinned members of a fold count too: they are the section's, they go with it
    const doomed  = new Set(derived?.memberIds ?? []);
    d.nodes = d.nodes.filter(n => !doomed.has(n.id));
    d.edges = d.edges.filter(e => !doomed.has(e.fromNode) && !doomed.has(e.toNode));
    const kept = parkFirstLaneAtOrigin(pruneFoldedIds(lanes.filter(l => l.id !== lane.id), doomed));
    // - the last section gone: drop the key rather than persisting an empty list
    if (kept.length) d.metadata = { ...d.metadata, sections: kept };
    else { const { sections: _none, ...rest } = d.metadata ?? {}; d.metadata = rest; }
    Object.assign(d, applyLaneFit(d, Date.now()));   // - every write fits the sections
    await writeCanvas(p, d);
    return `Removed section ${label} and ${doomed.size} node(s)`;
  }); // - withFileLock
}

async function canvasUpdateSection(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d     = await readCanvas(p);
    let lanes   = d.metadata?.sections ?? [];
    const lane  = sectionByRef(lanes, args.ref as string);
    if (!lane) return `error: no section matches ${args.ref}`;
    const label = deriveLanes(d.nodes, lanes).find(l => l.id === lane.id)?.label ?? lane.id;
    const changed: string[] = [];

    if (typeof args.title === 'string') {
      const t = args.title as string;
      // - an empty title is not stored: the rail shows the creation datetime instead
      lanes = lanes.map(l => { if (l.id !== lane.id) return l; const { title: _drop, ...rest } = l; return t ? { ...rest, title: t } : rest; });
      changed.push(t ? `title "${t}"` : 'title cleared');
    }

    if (args.kernelRef !== undefined) {
      if (args.kernelRef === null) {
        lanes = lanes.map(l => { if (l.id !== lane.id) return l; const { kernelId: _unbound, ...rest } = l; return rest; });
        changed.push('kernel unbound');
      } else {
        const k = kernelByRef(d, args.kernelRef as string);
        if (!k) return `error: no kernel matches "${args.kernelRef}" — a record id or display name, or a kernel node label/id`;
        lanes = lanes.map(l => (l.id === lane.id ? { ...l, kernelId: k.id } : l));
        changed.push(`kernel ${k.displayName ?? k.id}`);
      }
    }

    let foldNoop = false;
    if (args.folded !== undefined) {
      if (args.folded) {
        const next = foldLane(lanes, d.nodes, lane.id);
        foldNoop = next === lanes;
        changed.push(foldNoop ? 'already folded' : `folded (${next.find(l => l.id === lane.id)?.folded?.length ?? 0} node(s) hidden)`);
        lanes = next;
      } else {
        // - grow the lane back before the members are released, or the one below adopts them
        const u = unfoldLane(lanes, d.nodes, lane.id);
        foldNoop = u.lanes === lanes;
        if (foldNoop) changed.push('already unfolded');
        else {
          d.nodes = d.nodes.map(n => (u.nodeShifts[n.id] ? { ...n, y: n.y + u.nodeShifts[n.id] } : n));
          lanes = u.lanes;
          changed.push('unfolded');
        }
      }
    }

    if (changed.length === 0) return 'error: nothing to update — supply title, kernelRef or folded';
    // - the section is already in the state asked for and nothing else changed: no file write
    if (foldNoop && changed.length === 1) return `Section ${label}: ${changed[0]}`;
    d.metadata = { ...d.metadata, sections: lanes };
    Object.assign(d, applyLaneFit(d, Date.now()));   // - every write fits the sections
    await writeCanvas(p, d);
    return `Updated section ${label}: ${changed.join(', ')}`;
  }); // - withFileLock
}

async function canvasReflowSection(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d     = await readCanvas(p);
    const lanes = d.metadata?.sections ?? [];
    const lane  = sectionByRef(lanes, args.ref as string);
    if (!lane) return `error: no section matches ${args.ref}`;
    const derived = deriveLanes(d.nodes, lanes).find(l => l.id === lane.id);
    const label   = derived?.label ?? lane.id;

    const members = new Set(derived?.memberIds ?? []);
    const around  = toEngineNodes(d.nodes.filter(n => members.has(n.id)));
    const patches = reflowSection(around, { riders: ridersOf(around, d.edges) });
    const count   = Object.keys(patches).length;
    // - nothing moved: no write, so a reflow of a packed section leaves the file's mtime alone
    if (count === 0) return `Reflowed ${label}: nothing moved`;
    const own = sectionMembership(d.nodes, lanes, { sectionId: lane.id });
    d.nodes = applyPatchesToCanvas(d.nodes, patches);
    Object.assign(d, applyLaneFit(d, Date.now(), own));   // - every write fits the sections
    await writeCanvas(p, d);
    return `Reflowed ${label}: ${count} node(s) moved`;
  }); // - withFileLock
}

async function canvasRunSection(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d     = await readCanvas(p);
    const lanes = d.metadata?.sections ?? [];
    const lane  = sectionByRef(lanes, args.ref as string);
    if (!lane) return `error: no section matches ${args.ref}`;
    const label = deriveLanes(d.nodes, lanes).find(l => l.id === lane.id)?.label ?? lane.id;

    const order = memberCodeCellsInRunOrder(d.nodes as (CanvasNode & { type: string })[], lanes, lane.id);
    if (order.length === 0) return `error: no code cells in ${label}`;

    const ran: string[] = [];
    const moved: string[] = [];
    let capped = false;
    for (const cellId of order) {
      // - a previous cell's run re-fits the sections and replaces d.nodes: read this one again
      const cell = d.nodes.find(n => n.id === cellId && n.type === 'code') as CodeNode | undefined;
      if (!cell) continue;
      const prep = prepareRun(d, cell);
      if (typeof prep === 'string') return `${prep}${ran.length ? ` (ran ${ran.join(', ')})` : ''}`;
      const r = await runCellCore(d, cell, prep.kernel, prep.kernelId, prep.server, p, prep.ipc);
      ran.push(`${cell.nodeLabel ?? cell.id}:${r.status}`);
      for (const m of r.moved) if (!moved.includes(m)) moved.push(m);
      capped ||= r.capped;
      if (r.status === 'error') return `error: ${cell.nodeLabel ?? cell.id} failed — ${r.error ?? ''} (ran ${ran.join(', ')})`;
    }
    return `ran ${ran.join(', ')}`
      + (moved.length ? ` — moved ${moved.join(', ')}` : '')
      + (capped ? ` — ${CAPPED_NOTE}` : '');
  }); // - withFileLock
}

async function canvasAddKernel(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d       = await readCanvas(p);
    const servers = loadKernelServersFromEnv();
    const server  = servers.find(s => s.name === args.server);
    if (!server) return `error: unknown server ${args.server} — known: ${servers.map(s => s.name).join(', ') || '(none configured)'}`;

    const spec = args.spec as string | undefined;
    let kernelId: string | undefined;
    if (args.start !== false) {
      try { kernelId = (await startKernel(server, spec ?? 'python3')).id; }
      catch (e) { return `error: failed to start kernel on ${server.name}: ${e instanceof Error ? e.message : String(e)}`; }
    }

    // - a kernel node and a kernel record share the palette, so both count towards the next colour
    const existing = (d.metadata?.kernels?.length ?? 0) + d.nodes.filter(n => n.type === 'kernel').length;
    const record: KernelRecord = {
      id:          `k-${Date.now().toString(36)}`,
      server:      server.name,
      ...(spec ? { spec } : {}),
      displayName: (args.displayName as string | undefined) ?? spec ?? 'kernel',
      ...(kernelId ? { kernelId } : {}),
      colorIndex:  nextKernelColorIndex(existing),
    };

    let bound = '';
    let sections = d.metadata?.sections;
    if (args.bindSection !== undefined) {
      const lane = sectionByRef(sections ?? [], args.bindSection as string);
      if (!lane) return `error: no section matches ${args.bindSection}`;
      sections = (sections ?? []).map(l => (l.id === lane.id ? { ...l, kernelId: record.id } : l));
      bound = `, bound to ${deriveLanes(d.nodes, sections).find(l => l.id === lane.id)?.label ?? lane.id}`;
    }

    d.metadata = { ...d.metadata, kernels: [...(d.metadata?.kernels ?? []), record], ...(sections ? { sections } : {}) };
    Object.assign(d, applyLaneFit(d, Date.now()));   // - every write fits the sections
    await writeCanvas(p, d);
    return `Added kernel ${record.id} (${record.displayName}) on ${server.name}, live id ${kernelId ?? '(not started)'}${bound}`;
  }); // - withFileLock
}

async function canvasRemoveKernel(args: Record<string, unknown>): Promise<string> {
  const p = resolvePath(args.canvasPath as string);
  return withFileLock(p, async () => {
    const d   = await readCanvas(p);
    const ref = args.ref as string;
    const rec = d.metadata?.kernels?.find(k => k.id === ref || k.displayName === ref);
    if (!rec) {
      const n = findNode(d, ref);
      if (n?.type === 'kernel') return `error: ${ref} is a kernel node; remove it with canvas_remove_node`;
      return `error: no kernel record matches ${ref} — a record id or display name`;
    }

    const server = loadKernelServersFromEnv().find(s => s.name === rec.server);
    if (server && rec.kernelId) {
      try { await shutdownKernel(server, rec.kernelId); } catch { /* - already gone */ }
    }
    // - its namespace dies with it, so every cell that ran on it is un-run. Resolved BEFORE the
    //   rewrite below, while the lanes still name this kernel.
    const bound = new Set(resolveKernelCellsInCanvas(rec.id, cellKernelView(d)));
    for (const n of d.nodes) {
      if (n.type === 'code' && bound.has(n.id)) (n as CodeNode).lastStatus = undefined;
    }
    d.metadata = {
      ...d.metadata,
      kernels:  d.metadata?.kernels?.filter(k => k.id !== rec.id),
      // - drop the key rather than persisting `kernelId: undefined` on the lane
      sections: d.metadata?.sections?.map(l => { if (l.kernelId !== rec.id) return l; const { kernelId: _unbound, ...rest } = l; return rest; }),
    };
    Object.assign(d, applyLaneFit(d, Date.now()));   // - every write fits the sections
    await writeCanvas(p, d);
    return `Removed kernel ${rec.id} (${rec.displayName ?? 'kernel'}); ${bound.size} cell(s) un-run`;
  }); // - withFileLock
}

// ─── tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'canvas_list',
    description: 'List all nodes and edges on a canvas. Returns node labels (N1, J3, etc.), types, and content previews. Use these labels to reference nodes in other tools. A code cell that has an output ends its line with "(output: C5)", and that output cell with "(output of: E6)". Lists the sections (S1…, their y, kernel and title) when the canvas has any. Lists the kernel records (id, name, server, live id) when the canvas has any.',
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
    description: 'Read the full content and metadata of a canvas node by its label (e.g. N1, J3) or node ID. A code cell that has an output gets an "Output: C5 (id: …)" line naming that output cell; an output cell gets an "Output of: E6 (id: …)" line naming its code cell. An edge alone does not say which cell is an output.',
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
    description: 'Add a new node to the canvas. The node is automatically marked as AI-created (🤖 badge) and assigned a label. Position defaults to the right of all existing nodes. `after` puts the new node under any node, in that node\'s own column (the type defaults to code under a code cell, else to a text note); `forkOf` names a code cell and starts a new column pair beside its pair; both ignore x/y. Whatever the placement, the layout engine then packs the column the node landed in and pushes the column pairs to its right and the notes it covers out of the way — never across a section boundary. Sections fit their content: a node placed past its section\'s bottom edge grows it, slack shrinks it (never under the minimum), and every section and node below moves by the same grid multiple, down or up. Supplied coordinates are snapped to the grid and clamped to the canvas origin.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        type:       { type: 'string', description: 'Node type: text (default), code, cell, file, link, portal' },
        content:    { type: 'string', description: 'Text content for text/cell nodes, or the code for a code node' },
        format:     { type: 'string', description: 'Cell format: markdown (default), html, image' },
        file:       { type: 'string', description: 'File path for file nodes (vault:// URI or absolute path)' },
        url:        { type: 'string', description: 'URL for link nodes' },
        canvas:     { type: 'string', description: 'Relative canvas path for portal nodes' },
        tags:       { type: 'array',  items: { type: 'string' }, description: 'Optional tags for search/organisation' },
        color:      { type: 'string', description: 'Node accent color: 1=red, 2=orange, 3=yellow, 4=green, 5=cyan, 6=purple' },
        x:          { type: 'number', description: 'X position (auto-placed if omitted; ignored with after/forkOf)' },
        y:          { type: 'number', description: 'Y position (auto-placed if omitted; ignored with after/forkOf)' },
        width:      { type: 'number', description: 'Width in canvas units (default: type-dependent)' },
        height:     { type: 'number', description: 'Height in canvas units (default: type-dependent; a code cell with content is sized to the lines it holds, between 300 and 900)' },
        after:      { type: 'string', description: 'Label or id of any node: place the new node one gap below it in the same column (type defaults to code under a code cell, else text)' },
        forkOf:     { type: 'string', description: 'Label or id of a code cell: start a new column pair beside its pair (type defaults to code)' },
        side:       { type: 'string', description: 'forkOf side: right (default) or left; a left fork that would start before the canvas origin is refused' },
      },
      required: ['canvasPath'],
    },
  },
  {
    name: 'canvas_update_node',
    description: 'Update an existing node: content, tags, color, label, and/or move/resize it. Partial — only supplied fields change. Code content that CHANGES the cell\'s text, with no explicit height, re-sizes it to the lines it now holds (grows or shrinks, 300 to 900) and counts as a resize; re-sending the same text re-sizes nothing, so a height set by hand is kept. Move/resize uses absolute canvas coordinates and runs the layout engine: the node\'s column is packed, the column pairs to its right are pushed clear, and the notes it covers move down. An output cell is clamped to 1400 wide by 900 high so it cannot overlap the pair to its right. Sections fit their content: a node placed past its section\'s bottom edge grows it, slack shrinks it (never under the minimum), and every section and node below moves by the same grid multiple, down or up. Supplied coordinates are snapped to the grid and clamped to the canvas origin.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { type: 'string', description: 'Node label or ID to update' },
        content:    { type: 'string', description: 'New text/cell content' },
        tags:       { type: 'array',  items: { type: 'string' }, description: 'Replace tags list' },
        color:      { type: 'string', description: 'New accent color (1-6)' },
        label:      { type: 'string', description: 'Override the node label (e.g. rename N5 to N1)' },
        x:          { type: 'number', description: 'Move: absolute x (left)' },
        y:          { type: 'number', description: 'Move: absolute y (top)' },
        width:      { type: 'number', description: 'Resize: width' },
        height:     { type: 'number', description: 'Resize: height (omit it and code content that CHANGES the text re-sizes the cell to the lines it now holds, 300 to 900)' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_add_knowledge',
    description: 'Put a result you read from a knowledge server on the canvas as a knowledge node: the server name, the source URI, the title and the text you read, cached in the node so it reads offline. This server holds no knowledge-server token and never calls one — search the knowledge server yourself and pass the text you got back. The node is marked AI-created and assigned a W label; the canvas refreshes it from its server on a later open. Placement and the layout engine work as in canvas_add_node: `after` puts the node one gap below any node in that node\'s column and ignores x/y, otherwise x/y (snapped and clamped to the canvas origin) or a free slot right of everything; the column then packs, the pairs to its right are pushed clear, and the sections grow or shrink to fit.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        server:     { type: 'string', description: 'Name of the knowledge server the result came from (a skena.knowledge.servers entry, e.g. crtx)' },
        uri:        { type: 'string', description: 'Source URI as the server gave it (e.g. crtx://crtx/projects/skena.md#state); the canvas refreshes the node from it' },
        title:      { type: 'string', description: 'Title shown in the node header' },
        text:       { type: 'string', description: 'The markdown text you read from the server, cached in the node' },
        after:      { type: 'string', description: 'Label or id of any node: place the new node one gap below it in the same column' },
        x:          { type: 'number', description: 'X position (auto-placed if omitted; ignored with after)' },
        y:          { type: 'number', description: 'Y position (auto-placed if omitted; ignored with after)' },
      },
      required: ['canvasPath', 'server', 'uri', 'title', 'text'],
    },
  },
  {
    name: 'canvas_refresh_knowledge',
    description: 'Mark a knowledge node stale so the canvas fetches its text again the next time it is opened. This server has no knowledge-server token, so it cannot fetch the text itself — it only dates the node back. To replace the text now, read the source yourself and add a new node with canvas_add_knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { type: 'string', description: 'Label (W1, W2…) or id of the knowledge node' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_create',
    description: 'Create a new empty .canvas file (with parent directories). No-op if it already exists.',
    inputSchema: {
      type: 'object',
      properties: { canvasPath: { type: 'string', description: 'Path to the .canvas file to create' } },
      required: ['canvasPath'],
    },
  },
  {
    name: 'canvas_layout',
    description: 'Batch move/resize many nodes in one file write. Each item: { ref, x?, y?, width?, height? } (partial, absolute coordinates). Every moved node runs the layout engine over its section: its column is packed, the column pairs to its right are pushed clear, and the notes it covers move down. Sections fit their content: a node placed past its section\'s bottom edge grows it, slack shrinks it (never under the minimum), and every section and node below moves by the same grid multiple, down or up. Supplied coordinates are snapped to the grid and clamped to the canvas origin.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        nodes: {
          type: 'array',
          description: 'Nodes to position',
          items: {
            type: 'object',
            properties: {
              ref:    { type: 'string', description: 'Node label or ID' },
              x:      { type: 'number' }, y: { type: 'number' },
              width:  { type: 'number' }, height: { type: 'number' },
            },
            required: ['ref'],
          },
        },
      },
      required: ['canvasPath', 'nodes'],
    },
  },
  {
    name: 'canvas_update_edge',
    description: 'Update an existing edge: label, color, and/or handle sides. Partial. ref is an edge id, or { from, to } node labels/ids (either optional).',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { oneOf: [{ type: 'string' }, { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }], description: 'Edge id, or { from, to } node refs' },
        label:      { type: 'string', description: 'New edge label' },
        color:      { type: 'string', description: 'Edge color (1-6)' },
        fromSide:   { type: 'string', description: 'Source handle: top, right, bottom, left' },
        toSide:     { type: 'string', description: 'Target handle: top, left, bottom, right' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_remove_edge',
    description: 'Delete an edge. ref is an edge id, or { from, to } node labels/ids (either optional).',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'Path to the .canvas file' },
        ref:        { oneOf: [{ type: 'string' }, { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }], description: 'Edge id, or { from, to } node refs' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_remove_node',
    description: 'Delete one or more nodes from the canvas (also removes their connected edges). The column a deleted code cell sat in closes the hole it left, and sections fit their content.',
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
    description: 'Pin a content snippet (analysis result, notebook output, HTML table, image) as a CellNode on the canvas. Automatically links it to a source node if specified. Pinned onto a code cell it becomes that cell\'s output: it is placed in the pair\'s output column and the column below and the pairs to the right may move.',
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
  {
    name: 'canvas_run_section',
    description: 'Run every code cell of a section in run order (top to bottom, then left to right), each on its own resolved kernel, stopping at the first error. Needs a live kernel, as canvas_run_cell does. A new output is placed in its pair\'s output column; the column below and the pairs to the right may move.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        ref:        { type: 'string', description: 'S1, S2 … as printed by canvas_list, or the section id' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_add_kernel',
    description: 'Add a kernel record to the canvas (the kind a section binds, not a kernel node). By default it starts the kernel on the Jupyter server at once, as the rail\'s "New kernel…" does, so cells can run on it immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath:  { type: 'string', description: 'absolute path to the .canvas file' },
        server:      { type: 'string', description: 'a configured Jupyter server name (skena.jupyter.kernels[].name)' },
        spec:        { type: 'string', description: 'optional: kernelspec to launch, default python3; remembered so a restart reuses the same environment' },
        displayName: { type: 'string', description: 'optional: name shown in the rail; defaults to the spec' },
        bindSection: { type: 'string', description: 'optional: section to bind it to (S1, S2 … or the section id)' },
        start:       { type: 'boolean', description: 'optional: start the kernel now, default true' },
      },
      required: ['canvasPath', 'server'],
    },
  },
  {
    name: 'canvas_remove_kernel',
    description: 'Remove a kernel record: shut it down if live, unbind every section that named it, and un-run the cells that ran on it (its namespace is gone with it). A kernel NODE is removed with canvas_remove_node instead.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        ref:        { type: 'string', description: 'kernel record id or display name' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_add_section',
    description: 'Add a section (a horizontal lane; a node belongs to the lane whose range holds its top edge). Without y it goes under the last section\'s fitted range, as the rail\'s + does; with y it is snapped to the grid and inserted there, splitting the lane it lands in — nodes stay where they are and membership follows y. The section is fitted like every other write: a y inside the empty part of the section above is pulled up to that section\'s content, and the nodes below move with it; the returned y is the final one.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        title:      { type: 'string', description: 'optional: section title; without one the rail shows the creation datetime' },
        y:          { type: 'number', description: 'optional: canvas y where the section starts (snapped to the grid, must be ≥ 0); default is under the last section' },
      },
      required: ['canvasPath'],
    },
  },
  {
    name: 'canvas_remove_section',
    description: 'Delete a section: the nodes and edges of the section are deleted with it (including the ones a fold hides). The topmost remaining section re-parks at the canvas origin, fold lists drop the removed ids, and sections fit their content.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        ref:        { type: 'string', description: 'S1, S2 … as printed by canvas_list, or the section id' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_update_section',
    description: 'Rename a section, bind or unbind its kernel, or fold it. Folding hides its nodes (they stay in the file, pinned to the section); unfolding grows the section back before releasing them, so the section below cannot adopt one. Sections then fit their content.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        ref:        { type: 'string', description: 'S1, S2 … as printed by canvas_list, or the section id' },
        title:      { type: 'string', description: 'optional: new title; an empty string clears it' },
        kernelRef:  { type: ['string', 'null'], description: 'optional: a kernel record id or display name, or a kernel node label/id; null unbinds' },
        folded:     { type: 'boolean', description: 'optional: true folds the section, false unfolds it' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_reflow_section',
    description: 'Pack a section\'s code columns and output pairs tight and settle overlapped notes downward. The only whole-section move: every other write touches one column. Each code cell is snapped onto the nearest column, each column closes its holes, the pairs sit one gap apart left to right, and a note a managed cell overlaps moves down. Sections fit their content afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        ref:        { type: 'string', description: 'S1, S2 … as printed by canvas_list, or the section id' },
      },
      required: ['canvasPath', 'ref'],
    },
  },
  {
    name: 'canvas_run_cell',
    description: 'Run a code cell node on a Jupyter kernel and write its output to a linked cell node. Resolves the kernel from kernelRef, else the code node\'s bound-kernel edge, else the kernel bound to the node\'s section. A new output is placed in its pair\'s output column; the column below and the pairs to the right may move.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasPath: { type: 'string', description: 'absolute path to the .canvas file' },
        cellRef:    { type: 'string', description: 'label or id of the code node to run' },
        kernelRef:  { type: 'string', description: 'optional: a kernel record id or display name, or a kernel node label/id; defaults to the resolved one' },
      },
      required: ['canvasPath', 'cellRef'],
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
        case 'canvas_add_knowledge':     text = await canvasAddKnowledge(args);     break;
        case 'canvas_refresh_knowledge': text = await canvasRefreshKnowledge(args); break;
        case 'canvas_remove_node': text = await canvasRemoveNode(args);  break;
        case 'canvas_add_edge':    text = await canvasAddEdge(args);     break;
        case 'canvas_update_edge': text = await canvasUpdateEdge(args);  break;
        case 'canvas_remove_edge': text = await canvasRemoveEdge(args);  break;
        case 'canvas_layout':      text = await canvasLayout(args);      break;
        case 'canvas_create':      text = await canvasCreate(args);      break;
        case 'canvas_pin_output':  text = await canvasPinOutput(args);   break;
        case 'canvas_run_cell':    text = await canvasRunCell(args);     break;
        case 'canvas_add_section':    text = await canvasAddSection(args);    break;
        case 'canvas_remove_section': text = await canvasRemoveSection(args); break;
        case 'canvas_update_section': text = await canvasUpdateSection(args); break;
        case 'canvas_run_section':    text = await canvasRunSection(args);    break;
        case 'canvas_reflow_section': text = await canvasReflowSection(args); break;
        case 'canvas_add_kernel':     text = await canvasAddKernel(args);     break;
        case 'canvas_remove_kernel':  text = await canvasRemoveKernel(args);  break;
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
