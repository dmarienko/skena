import { GRID, NODE_SIZE, CODE_MAX_H, OUTPUT_MIN_W, OUTPUT_DEFAULT_H, CODE_LINE_PX, CODE_CHROME_PX } from './constants';
import { snapGrid } from './grid';
import { deriveLanes, type SectionLane } from './sectionLanes';

/**
 * The layout engine of one section (spec 2026-09-08-layout-engine-design.md).
 * Managed = code cells and the output cells they name in `outputNodeId`; free = everything else.
 * A column = code cells sharing a snapped x, ordered by y; a pair = a column + its output column.
 * Every function is pure and returns only what changed.
 */

export interface EngineNode { id: string; type: string; x: number; y: number; w: number; h: number; outputNodeId?: string }
// - `w`/`h` are reserved for content measurement: no engine function emits a size yet, so every
//   patch a caller receives today carries only x/y.
export interface Patch { x: number; y: number; w?: number; h?: number }
export type Patches = Record<string, Patch>;
export interface Column { x: number; codeW: number; cellIds: string[] }
export interface Pair { column: Column; outputX: number; outputW: number; right: number }
// - `report` is filled in by the call: `capped` says the bump walk stopped with overlaps still
//   there (a dense section), so the caller can tell the user to reflow
export interface LayoutOpts { moverIds?: Iterable<string>; columnX?: number; report?: { capped?: boolean } }

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

/**
 * Pairs = columns with their output column: x one gap right of the code, width = the widest output
 * the column holds, at its REAL width (never clamped: a wide output must not overlap the pair to its
 * right — OUTPUT_MAX_W is for the callers that create or resize an output), floored at OUTPUT_MIN_W.
 */
export function derivePairs(nodes: EngineNode[], columns: Column[]): Pair[] {
  const map = byId(nodes);
  return columns.map(column => {
    let outputW = OUTPUT_MIN_W;
    for (const id of column.cellIds) {
      const out = map.get(map.get(id)?.outputNodeId ?? '');
      if (out) outputW = Math.max(outputW, out.w);
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

// - pack one column tight top → bottom; outputs follow their code (same y, output x of the pair)
function packColumn(pair: Pair, map: Map<string, EngineNode>, out?: Patches): void {
  let prevBottom: number | null = null;
  for (const id of pair.column.cellIds) {
    const cell = map.get(id)!;
    const y = prevBottom === null ? snapGrid(cell.y) : prevBottom + GRID;
    const x = pair.column.x;
    if (x !== cell.x || y !== cell.y) { if (out) out[id] = { x, y }; cell.x = x; cell.y = y; }
    const o = map.get(cell.outputNodeId ?? '');
    if (o && (o.x !== pair.outputX || o.y !== y)) { if (out) out[o.id] = { x: pair.outputX, y }; o.x = pair.outputX; o.y = y; }
    prevBottom = rowBottom(cell, map);
  }
}

// - Reflow only: a free node moves down until it is clear of every managed node and of the free
//   nodes settled before it. A regular call bumps instead (`resolveBumps`); Reflow is the user
//   asking for the whole section to be tidied, so it settles against everything.
function settleFree(nodes: EngineNode[], owners: Map<string, string>): void {
  const managed = nodes.filter(n => n.type === 'code' || owners.has(n.id));
  const free = nodes.filter(n => n.type !== 'code' && !owners.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: EngineNode[] = [...managed];
  for (const f of free) {
    for (let again = true; again;) {
      again = false;
      for (const p of placed) if (overlaps(f, p)) { f.y = p.y + p.h + GRID; again = true; }
    }
    placed.push(f);
  }
}

// - what one bump moves with `node`: a code cell — or an output, through its code cell — takes its
//   column (the code cells at that snapped x, their outputs riding along); a free node takes the
//   free nodes at its x (spec §3.3). `downward` keeps only the ones at or under the anchor, which is
//   what a downward bump takes; a sideways bump takes the whole column, so the columns stay aligned.
function bumpGroup(node: EngineNode, nodes: EngineNode[], owners: Map<string, string>, map: Map<string, EngineNode>, downward: boolean): EngineNode[] {
  const anchor = map.get(owners.get(node.id) ?? '') ?? node;
  const x = snapGrid(anchor.x);
  const column = anchor.type === 'code'
    ? nodes.filter(n => n.type === 'code' && snapGrid(n.x) === x)
    : nodes.filter(n => n.type !== 'code' && !owners.has(n.id) && snapGrid(n.x) === x);
  const taken = downward ? column.filter(n => n.y >= anchor.y) : column;
  const group = [...taken];
  for (const c of taken) { const o = map.get(c.outputNodeId ?? ''); if (o) group.push(o); }
  return group;
}

// - the overlap to resolve next: the nodes this call moved, in id order, against every other node by
//   (y, x). A pinned node never moves, so when it is the one in the way the two swap roles; two
//   pinned nodes on top of each other are the caller's placement and are left alone. A code cell and
//   its own output are one row, placed by `packColumn`: how close they sit is not a bump.
function nextBump(nodes: EngineNode[], owners: Map<string, string>, pinned: Set<string>, active: Set<string>): { mover: EngineNode; other: EngineNode } | null {
  const moved = nodes.filter(n => active.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
  const rest = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const mover of moved) {
    for (const other of rest) {
      if (other.id === mover.id || owners.get(other.id) === mover.id || owners.get(mover.id) === other.id) continue;
      if (!overlaps(mover, other)) continue;
      if (!pinned.has(other.id)) return { mover, other };
      if (!pinned.has(mover.id)) return { mover: other, other: mover };
    }
  }
  return null;
}

/**
 * Bumps (spec §3.2). While a node this call moved overlaps another one, that other node moves by
 * exactly the overlap, on the axis with the smaller move: right when it sits at or right of the
 * mover, left when it sits left of it (never past x = 0), down when it sits at or below it, never
 * up. A column never changes order, so a node ABOVE the one in hand does not move past it: it steps
 * aside, or — when that is the smaller move, or there is nowhere to step — the node the operation
 * placed YIELDS and drops below it, with whatever sits under it in its own column. That is the one
 * case where a mover moves. A cell the pack has just laid out does not yield; the node above it
 * steps aside, and falls past it only when it cannot.
 * Everything a bump moved is checked again, so a bump cascades — through real overlaps and by
 * overlap amounts only, never by a modelled distance, which is why a hand-placed section an edit
 * does not actually reach is left alone. `report.capped` is set when the walk ran out of steps with
 * overlaps still on the section.
 */
function resolveBumps(nodes: EngineNode[], owners: Map<string, string>, pinned: Set<string>, placed: Set<string>, active: Set<string>, report?: { capped?: boolean }): void {
  const map = byId(nodes);
  // - the cap is a real limit, not a formality: a dense section (a diagonal staircase, a tight grid)
  //   holds more overlaps than this many steps resolve, and the walk then stops with some of them
  //   still there. `capped` tells the caller, who can offer a Reflow.
  for (let guard = nodes.length * 4 + 32; guard > 0; guard--) {
    const hit = nextBump(nodes, owners, pinned, active);
    if (!hit) return;
    const { mover, other } = hit;
    const column = bumpGroup(other, nodes, owners, map, false);
    // - a sideways step is the overlap rounded UP to the grid: the whole column moves by the same
    //   grid multiple, so it still shares one snapped x and the next call reads the same column.
    //   A column slides only as one: with a pinned node in it, the node in the way goes down instead.
    const leftBy = gridUp(other.x + other.w + GRID - mover.x);
    const dx = column.some(n => pinned.has(n.id)) ? 0
      : other.x >= mover.x ? gridUp(mover.x + mover.w + GRID - other.x)
      : Math.min(...column.map(n => n.x)) >= leftBy ? -leftBy : 0;
    const dy = mover.y + mover.h + GRID - other.y;    // - the other node clears the mover, downward
    const drop = other.y + other.h + GRID - mover.y;   // - the mover clears the other node, downward
    // - a node ABOVE the node in hand does not move down past it: that would reorder the column the
    //   user is looking at. It steps aside if its column can slide, and otherwise the node in hand
    //   YIELDS — it drops below the one in its way, taking what sits under it in its own column. The
    //   smaller of the two wins, ties sideways, the same comparison the other direction uses. Only a
    //   node the operation itself placed yields: a cell the pack has just laid out keeps its place,
    //   so the pack and the bumps never fight over it (that fight is not idempotent).
    const yields = other.y < mover.y && placed.has(mover.id);
    const sideways = dx !== 0 && (yields ? Math.abs(dx) <= drop : other.y < mover.y || Math.abs(dx) <= dy);
    if (sideways) for (const n of column) { n.x += dx; active.add(n.id); }
    else if (yields) for (const n of bumpGroup(mover, nodes, owners, map, true)) { n.y += drop; active.add(n.id); }
    else for (const n of bumpGroup(other, nodes, owners, map, true)) { if (!pinned.has(n.id)) { n.y += dy; active.add(n.id); } }
  }
  if (report) report.capped = true;
}

function clone(nodes: EngineNode[]): EngineNode[] { return nodes.map(n => ({ ...n })); }
function diff(before: EngineNode[], after: EngineNode[]): Patches {
  const b = byId(before);
  const res: Patches = {};
  for (const n of after) { const o = b.get(n.id)!; if (o.x !== n.x || o.y !== n.y) res[n.id] = { x: n.x, y: n.y }; }
  return res;
}

/**
 * Lay out one section after an operation. `moverIds` = the nodes the operation inserted, moved or
 * resized (they win ties in their column, and move only to yield to a node above them, §3.2);
 * `columnX` = the column to pack when nothing moved (a delete). Only the touched column is packed;
 * everything else moves only where a node this call moved really overlaps it, by that overlap
 * (§3.2). Same input → same output; a second call changes nothing.
 */
export function layoutSection(input: EngineNode[], opts: LayoutOpts = {}): Patches {
  const nodes = clone(input);
  const map = byId(nodes);
  const movers = new Set(opts.moverIds ?? []);
  const owners = outputOwners(nodes);
  const pairs = derivePairs(nodes, deriveColumns(nodes, movers));
  const packed: Patches = {};

  // - which columns are touched: the movers' (a moved output counts for its code's column) + columnX
  const touched = new Set<number>();
  // - a managed mover IS placed by the pack below, snapped onto its column and stacked in it; what
  //   pinning means is that no BUMP moves it, bar the one yield in `resolveBumps`. The other half of
  //   its pair is pinned with it, an output having its code cell's y.
  const pinned = new Set(movers);
  for (const id of movers) {
    const n = map.get(id); if (!n) continue;
    const codeId = n.type === 'code' ? id : owners.get(id);
    if (codeId) { touched.add(snapGrid(map.get(codeId)!.x)); pinned.add(codeId); }
    if (n.outputNodeId) pinned.add(n.outputNodeId);
  }
  if (opts.columnX !== undefined) touched.add(snapGrid(opts.columnX));
  // - the nodes the operation itself placed, before the pack adds its column: the only ones that
  //   yield downward to a node above them
  const placed = new Set(pinned);

  for (const pair of pairs) if (touched.has(pair.column.x)) {
    packColumn(pair, map, packed);
    // - the pack owns the column it just laid out: a bump moves what is in its way, never it, so the
    //   two never fight over the same cell and the next call packs it to the same place
    for (const id of pair.column.cellIds) { pinned.add(id); const outId = map.get(id)!.outputNodeId; if (outId) pinned.add(outId); }
  }
  resolveBumps(nodes, owners, pinned, placed, new Set([...movers, ...Object.keys(packed)]), opts.report);
  return diff(input, nodes);
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
  for (const pair of pairs) packColumn(pair, map);
  // - pairs tight left → right (the first keeps its x); outputs re-measured after the packs
  const tight = derivePairs(nodes, deriveColumns(nodes));
  for (let i = 1; i < tight.length; i++) {
    const want = gridUp(tight[i - 1].right + GRID);
    const dx = want - tight[i].column.x;
    if (dx === 0) continue;
    for (const id of tight[i].column.cellIds) {
      const cell = map.get(id)!; cell.x += dx;
      const o = map.get(cell.outputNodeId ?? ''); if (o) o.x += dx;
    }
    tight[i].column.x += dx; tight[i].outputX += dx; tight[i].right += dx;
  }
  settleFree(nodes, owners);
  return diff(input, nodes);
}

/** Where a new code cell goes after `afterId`: its column, one gap below. Null when `afterId` is not a code cell. */
export function insertAfter(nodes: EngineNode[], afterId: string): { x: number; y: number } | null {
  const after = nodes.find(n => n.id === afterId);
  if (!after || after.type !== 'code') return null;
  const map = byId(nodes);
  return { x: snapGrid(after.x), y: rowBottom(after, map) + GRID };
}

/** Where a fork of `cellId` starts: a new pair right of its pair, or left of its column; null when refused. */
export function forkOf(nodes: EngineNode[], cellId: string, side: 'right' | 'left', w: number = NODE_SIZE.code.w): { x: number; y: number } | null {
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

/**
 * Apply patches to canvas-shaped nodes; the same array reference when nothing changed. The `w`/`h`
 * branch is kept for content measurement: no engine function emits a size yet.
 */
export function applyPatchesToCanvas<T extends { id: string; x: number; y: number; width: number; height: number }>(nodes: T[], p: Patches): T[] {
  if (Object.keys(p).length === 0) return nodes;
  return nodes.map(n => {
    const q = p[n.id];
    return q ? { ...n, x: q.x, y: q.y, ...(q.w !== undefined ? { width: q.w } : {}), ...(q.h !== undefined ? { height: q.h } : {}) } : n;
  });
}

/** A node as the file holds it — what every caller of the section helpers below has in hand. */
export interface CanvasShapedNode { id: string; type: string; x: number; y: number; width: number; height: number; outputNodeId?: string }

/** Which section to slice: a node id, or `{ nodeId }` / `{ sectionId }` when the caller has one. */
export type SectionAnchor = string | { nodeId?: string; sectionId?: string };

// - the derived lane an anchor names
function anchorLane(nodes: CanvasShapedNode[], sections: SectionLane[], anchor: SectionAnchor) {
  const nodeId = typeof anchor === 'string' ? anchor : anchor.nodeId;
  const derived = deriveLanes(nodes, sections);
  return typeof anchor !== 'string' && anchor.sectionId !== undefined
    ? derived.find(l => l.id === anchor.sectionId)
    : derived.find(l => nodeId !== undefined && l.memberIds.includes(nodeId));
}

/**
 * One section's nodes as the engine sees them: the lane the anchor names, its folded members
 * included (deriveLanes lists them). Null when the canvas has no sections — a file written before
 * they existed — or the anchor sits in none: the engine lays out ONE section, so there is nothing
 * for it to work on and the caller leaves the geometry alone.
 * `extraIds` are nodes the operation created FROM the anchor: they are laid out with the anchor's
 * section even when their y falls in the next one, which is what keeps a new cell in the section it
 * was created from rather than handing it to the section below.
 */
export function sectionEngineNodes(nodes: CanvasShapedNode[], sections: SectionLane[], anchor: SectionAnchor, extraIds?: Iterable<string>): EngineNode[] | null {
  const lane = anchorLane(nodes, sections, anchor);
  if (!lane) return null;
  const members = new Set([...lane.memberIds, ...(extraIds ?? [])]);
  return toEngineNodes(nodes.filter(n => members.has(n.id)));
}

/**
 * That same section's members as `fitLanes`' `own`: node id → the section's lane index. A cell the
 * engine pushed past the section's bottom edge still counts for THAT section, so the section grows
 * and the ones below move down, instead of the one below adopting the cell and leaving the overlap.
 * `extraIds` (the same ones `sectionEngineNodes` took) get the anchor's lane index too, so a node
 * created below the section's bottom edge grows it instead of joining the section under it.
 * Read it BEFORE the engine runs; empty when the anchor names no section.
 */
export function sectionMembership(nodes: CanvasShapedNode[], sections: SectionLane[], anchor: SectionAnchor, extraIds?: Iterable<string>): Map<string, number> {
  const lane = anchorLane(nodes, sections, anchor);
  return new Map(lane ? [...lane.memberIds, ...(extraIds ?? [])].map(id => [id, lane.index] as const) : []);
}

/**
 * The columns a delete leaves a hole in, read BEFORE the removal so the engine can close them after:
 * an output cell counts for its code cell's column, and a code cell going with its output leaves one
 * entry, not two. One entry per column; empty when the canvas has no sections.
 */
export function columnsOfDeleted(nodes: CanvasShapedNode[], sections: SectionLane[], deletedIds: Set<string>): { sectionId: string; columnX: number }[] {
  if (sections.length === 0) return [];
  const derived = deriveLanes(nodes, sections);
  const seen = new Set<string>();
  const cols: { sectionId: string; columnX: number }[] = [];
  for (const n of nodes) {
    if (!deletedIds.has(n.id)) continue;
    const code = n.type === 'code' ? n : nodes.find(c => c.type === 'code' && c.outputNodeId === n.id && !deletedIds.has(c.id));
    if (!code) continue;
    const lane = derived.find(l => l.memberIds.includes(code.id));
    if (!lane) continue;
    const key = `${lane.id}|${snapGrid(code.x)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cols.push({ sectionId: lane.id, columnX: snapGrid(code.x) });
  }
  return cols;
}

/** Adapter: canvas nodes → engine nodes (the file's `width`/`height` → `w`/`h`). */
export function toEngineNodes(nodes: CanvasShapedNode[]): EngineNode[] {
  return nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height, ...(n.outputNodeId ? { outputNodeId: n.outputNodeId } : {}) }));
}
