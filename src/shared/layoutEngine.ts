import { GRID, NODE_SIZE, CODE_MAX_H, OUTPUT_MIN_W, OUTPUT_MAX_W, OUTPUT_DEFAULT_H, CODE_LINE_PX, CODE_CHROME_PX } from './constants';
import { snapGrid } from './grid';

/**
 * The layout engine of one section (spec 2026-09-08-layout-engine-design.md).
 * Managed = code cells and the output cells they name in `outputNodeId`; free = everything else.
 * A column = code cells sharing a snapped x, ordered by y; a pair = a column + its output column.
 * Every function is pure and returns only what changed.
 */

export interface EngineNode { id: string; type: string; x: number; y: number; w: number; h: number; outputNodeId?: string }
export interface Patch { x: number; y: number; w?: number; h?: number }
export type Patches = Record<string, Patch>;
export interface Column { x: number; codeW: number; cellIds: string[] }
export interface Pair { column: Column; outputX: number; outputW: number; right: number }
export interface LayoutOpts { moverIds?: Iterable<string>; columnX?: number }

const byId = (nodes: EngineNode[]) => new Map(nodes.map(n => [n.id, n] as const));

// - a column x the engine computes is always rounded UP to the grid: deriveColumns snaps x back on
//   the next call, so an off-grid column (a code or output cell of off-grid width puts one there)
//   would move its cells again and a second run would not be a no-op. Up, never down: the gap holds.
const gridUp = (v: number) => Math.ceil(v / GRID) * GRID;

/** Height of a code cell for `lines` lines: grid steps from NODE_SIZE.code.h up to CODE_MAX_H. */
export function codeCellHeight(lines: number): number {
  const raw = Math.ceil((Math.max(1, lines) * CODE_LINE_PX + CODE_CHROME_PX) / GRID) * GRID;
  return Math.min(CODE_MAX_H, Math.max(NODE_SIZE.code.h, raw));
}

/** Ids of output cells owned by a code cell (the managed non-code nodes). */
export function outputOwners(nodes: EngineNode[]): Map<string, string> {
  const owners = new Map<string, string>();
  const ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) if (n.type === 'code' && n.outputNodeId && ids.has(n.outputNodeId)) owners.set(n.outputNodeId, n.id);
  return owners;
}

/** Columns of a section, left to right; cells top to bottom, a mover first on a tie. */
export function deriveColumns(nodes: EngineNode[], movers = new Set<string>()): Column[] {
  const groups = new Map<number, EngineNode[]>();
  for (const n of nodes) {
    if (n.type !== 'code') continue;
    const x = snapGrid(n.x);
    const g = groups.get(x);
    if (g) g.push(n); else groups.set(x, [n]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, cells]) => {
      cells.sort((a, b) => a.y - b.y || Number(movers.has(b.id)) - Number(movers.has(a.id)) || a.id.localeCompare(b.id));
      return { x, codeW: Math.max(...cells.map(c => c.w)), cellIds: cells.map(c => c.id) };
    });
}

/** Pairs = columns with their output column: x right of the code, width = widest output, min OUTPUT_MIN_W. */
export function derivePairs(nodes: EngineNode[], columns: Column[]): Pair[] {
  const map = byId(nodes);
  return columns.map(column => {
    let outputW = OUTPUT_MIN_W;
    for (const id of column.cellIds) {
      const out = map.get(map.get(id)?.outputNodeId ?? '');
      if (out) outputW = Math.max(outputW, Math.min(OUTPUT_MAX_W, out.w));
    }
    const outputX = column.x + column.codeW + GRID;
    return { column, outputX, outputW, right: outputX + outputW };
  });
}

// - bottom of a code cell's row = the taller of the cell and its output
function rowBottom(cell: EngineNode, map: Map<string, EngineNode>): number {
  const out = map.get(cell.outputNodeId ?? '');
  return cell.y + Math.max(cell.h, out ? out.h : 0);
}

// - two boxes need a full grid gap between them on at least one axis
function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  const sepX = a.x + a.w + GRID <= b.x || b.x + b.w + GRID <= a.x;
  const sepY = a.y + a.h + GRID <= b.y || b.y + b.h + GRID <= a.y;
  return !(sepX || sepY);
}

// - pack one column tight top → bottom; outputs follow their code (same y, output x of the pair).
//   `floors` holds cells a dropped free node pushed down: they keep that y, the pack closes below them.
function packColumn(pair: Pair, map: Map<string, EngineNode>, out: Patches, floors?: Map<string, number>): void {
  let prevBottom: number | null = null;
  for (const id of pair.column.cellIds) {
    const cell = map.get(id)!;
    const tight = prevBottom === null ? snapGrid(cell.y) : prevBottom + GRID;
    const y = Math.max(tight, floors?.get(id) ?? tight);
    const x = pair.column.x;
    if (x !== cell.x || y !== cell.y) { out[id] = { x, y }; cell.x = x; cell.y = y; }
    const o = map.get(cell.outputNodeId ?? '');
    if (o && (o.x !== pair.outputX || o.y !== y)) { out[o.id] = { x: pair.outputX, y }; o.x = pair.outputX; o.y = y; }
    prevBottom = rowBottom(cell, map);
  }
}

// - push the pairs right of `from` so each starts a gap after the previous one; never pulls back
function pushPairsRight(pairs: Pair[], fromIndex: number, map: Map<string, EngineNode>, out: Patches): void {
  for (let i = Math.max(1, fromIndex + 1); i < pairs.length; i++) {
    const prev = pairs[i - 1], cur = pairs[i];
    const minX = gridUp(prev.right + GRID);
    if (cur.column.x >= minX) continue;
    const dx = minX - cur.column.x;
    for (const id of cur.column.cellIds) {
      const cell = map.get(id)!;
      cell.x += dx; out[id] = { x: cell.x, y: cell.y };
      const o = map.get(cell.outputNodeId ?? '');
      if (o) { o.x += dx; out[o.id] = { x: o.x, y: o.y }; }
    }
    cur.column.x += dx; cur.outputX += dx; cur.right += dx;
  }
}

// - free nodes that a managed node (or an earlier free node) now overlaps move down, never sideways
function settleFree(nodes: EngineNode[], owners: Map<string, string>, movers: Set<string>, out: Patches): void {
  const managed = nodes.filter(n => n.type === 'code' || owners.has(n.id));
  const free = nodes.filter(n => n.type !== 'code' && !owners.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: EngineNode[] = [...managed];
  for (const f of free) {
    if (movers.has(f.id)) { placed.push(f); continue; }   // - the dropped/resized free node stays put
    let moved = true;
    while (moved) {
      moved = false;
      for (const p of placed) {
        if (overlaps(f, p)) { f.y = p.y + p.h + GRID; out[f.id] = { x: f.x, y: f.y }; moved = true; }
      }
    }
    placed.push(f);
  }
}

// - a free node that was itself dropped or resized pushes the managed cells it covers down; only a
//   column it covers is repacked, so a column it does not touch keeps the layout it had
function freeMoverPushes(map: Map<string, EngineNode>, owners: Map<string, string>, movers: Set<string>, pairs: Pair[], out: Patches): void {
  const dropped: EngineNode[] = [];
  for (const id of movers) {
    const f = map.get(id);
    if (f && f.type !== 'code' && !owners.has(id)) dropped.push(f);
  }
  if (dropped.length === 0) return;
  for (const pair of pairs) {
    const floors = new Map<string, number>();
    for (const cid of pair.column.cellIds) {
      const cell = map.get(cid)!;
      for (const f of dropped) {
        if (overlaps(f, cell)) { cell.y = f.y + f.h + GRID; floors.set(cid, cell.y); out[cid] = { x: cell.x, y: cell.y }; }
      }
    }
    if (floors.size > 0) packColumn(pair, map, out, floors);
  }
}

function clone(nodes: EngineNode[]): EngineNode[] { return nodes.map(n => ({ ...n })); }
function diff(before: EngineNode[], after: EngineNode[], out: Patches): Patches {
  const b = byId(before);
  const res: Patches = {};
  for (const n of after) { const o = b.get(n.id)!; if (o.x !== n.x || o.y !== n.y) res[n.id] = { x: n.x, y: n.y }; }
  for (const [id, p] of Object.entries(out)) if (!(id in res)) { const o = b.get(id); if (o && (o.x !== p.x || o.y !== p.y)) res[id] = p; }
  return res;
}

/**
 * Lay out one section after an operation. `moverIds` = the nodes the operation inserted, moved or
 * resized (they win ties and, when free, push what they cover); `columnX` = the column to pack when
 * nothing moved (a delete). Only the touched column is packed; pairs right of it are pushed, not
 * pulled; free nodes settle downward. Same input → same output; a second call changes nothing.
 */
export function layoutSection(input: EngineNode[], opts: LayoutOpts = {}): Patches {
  const nodes = clone(input);
  const map = byId(nodes);
  const movers = new Set(opts.moverIds ?? []);
  const owners = outputOwners(nodes);
  const columns = deriveColumns(nodes, movers);
  const pairs = derivePairs(nodes, columns);
  const out: Patches = {};

  // - which columns are touched: the movers' (a moved output counts for its code's column) + columnX
  const touched = new Set<number>();
  for (const id of movers) {
    const n = map.get(id); if (!n) continue;
    const codeId = n.type === 'code' ? id : owners.get(id);
    if (codeId) touched.add(snapGrid(map.get(codeId)!.x));
  }
  if (opts.columnX !== undefined) touched.add(snapGrid(opts.columnX));

  let firstTouched = pairs.length;
  pairs.forEach((pair, i) => { if (touched.has(pair.column.x)) { packColumn(pair, map, out); firstTouched = Math.min(firstTouched, i); } });
  // - re-measure after the pack (an output moved with its code) and push the pairs to the right
  const repaired = derivePairs(nodes, deriveColumns(nodes, movers));
  if (firstTouched < repaired.length) pushPairsRight(repaired, firstTouched, map, out);
  freeMoverPushes(map, owners, movers, repaired, out);
  settleFree(nodes, owners, movers, out);
  return diff(input, nodes, out);
}

/** Whole-section pack: every code cell snapped to its column, every column and pair tight, free nodes settled. */
export function reflowSection(input: EngineNode[]): Patches {
  const nodes = clone(input);
  const map = byId(nodes);
  const owners = outputOwners(nodes);
  // - snap x onto columns, left → right: a cell joins the nearest column established so far when it
  //   sits within half a pair width, else it starts one at its own snapped x. A cell is never a
  //   candidate column for itself — that is what leaves an off-column cell in its own column.
  const codes = nodes.filter(n => n.type === 'code')
    .sort((a, b) => snapGrid(a.x) - snapGrid(b.x) || a.y - b.y || a.id.localeCompare(b.id));
  const half = (NODE_SIZE.code.w + GRID + OUTPUT_MIN_W) / 2;
  const xs: number[] = [];
  for (const n of codes) {
    const sx = snapGrid(n.x);
    const near = xs.filter(x => Math.abs(x - sx) <= half).sort((a, b) => Math.abs(a - sx) - Math.abs(b - sx))[0];
    if (near === undefined) xs.push(sx);
    n.x = near ?? sx;
  }
  const columns = deriveColumns(nodes);
  const pairs = derivePairs(nodes, columns);
  const out: Patches = {};
  for (const pair of pairs) packColumn(pair, map, out);
  // - pairs tight left → right (the first keeps its x); outputs re-measured after the packs
  const tight = derivePairs(nodes, deriveColumns(nodes));
  for (let i = 1; i < tight.length; i++) {
    const want = gridUp(tight[i - 1].right + GRID);
    const dx = want - tight[i].column.x;
    if (dx === 0) continue;
    for (const id of tight[i].column.cellIds) {
      const cell = map.get(id)!; cell.x += dx; out[id] = { x: cell.x, y: cell.y };
      const o = map.get(cell.outputNodeId ?? ''); if (o) { o.x += dx; out[o.id] = { x: o.x, y: o.y }; }
    }
    tight[i].column.x += dx; tight[i].outputX += dx; tight[i].right += dx;
  }
  settleFree(nodes, owners, new Set(), out);
  return diff(input, nodes, out);
}

/** Where a new code cell goes after `afterId`: its column, one gap below. Null when `afterId` is not a code cell. */
export function insertAfter(nodes: EngineNode[], afterId: string): { x: number; y: number } | null {
  const after = nodes.find(n => n.id === afterId);
  if (!after || after.type !== 'code') return null;
  const map = byId(nodes);
  return { x: snapGrid(after.x), y: rowBottom(after, map) + GRID };
}

/** Where a fork of `cellId` starts: a new pair right of its pair, or left of its column; null when refused. */
export function forkOf(nodes: EngineNode[], cellId: string, side: 'right' | 'left', w = NODE_SIZE.code.w): { x: number; y: number } | null {
  const cell = nodes.find(n => n.id === cellId);
  if (!cell || cell.type !== 'code') return null;
  const pairs = derivePairs(nodes, deriveColumns(nodes));
  const pair = pairs.find(p => p.column.cellIds.includes(cellId));
  if (!pair) return null;
  if (side === 'right') return { x: gridUp(pair.right + GRID), y: snapGrid(cell.y) };
  // - down, not up: the left fork keeps its full gap from the column it forks off
  const x = Math.floor((pair.column.x - GRID - (w + GRID + OUTPUT_MIN_W)) / GRID) * GRID;
  return x < 0 ? null : { x, y: snapGrid(cell.y) };
}

/** Geometry of the output cell of `codeId`: the pair's output column, the code's y; existing size kept. */
export function placeOutput(nodes: EngineNode[], codeId: string, existing?: { w: number; h: number }): { x: number; y: number; width: number; height: number } | null {
  const code = nodes.find(n => n.id === codeId);
  if (!code || code.type !== 'code') return null;
  const pairs = derivePairs(nodes, deriveColumns(nodes));
  const pair = pairs.find(p => p.column.cellIds.includes(codeId));
  if (!pair) return null;
  return { x: pair.outputX, y: snapGrid(code.y), width: existing?.w ?? OUTPUT_MIN_W, height: existing?.h ?? OUTPUT_DEFAULT_H };
}

/** Apply patches to canvas-shaped nodes; the same array reference when nothing changed. */
export function applyPatchesToCanvas<T extends { id: string; x: number; y: number; width: number; height: number }>(nodes: T[], p: Patches): T[] {
  if (Object.keys(p).length === 0) return nodes;
  return nodes.map(n => {
    const q = p[n.id];
    return q ? { ...n, x: q.x, y: q.y, ...(q.w !== undefined ? { width: q.w } : {}), ...(q.h !== undefined ? { height: q.h } : {}) } : n;
  });
}

/** Adapter: canvas nodes → engine nodes (the file's `width`/`height` → `w`/`h`). */
export function toEngineNodes(nodes: { id: string; type: string; x: number; y: number; width: number; height: number; outputNodeId?: string }[]): EngineNode[] {
  return nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height, ...(n.outputNodeId ? { outputNodeId: n.outputNodeId } : {}) }));
}
