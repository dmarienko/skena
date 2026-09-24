import { GRID, NODE_SIZE, CODE_MAX_H, CODE_H_STEP, CODE_LINE_H_ESTIMATE, CODE_CHROME_ESTIMATE, OUTPUT_MIN_W, OUTPUT_DEFAULT_H } from './constants';
import { snapGrid } from './grid';
import { deriveLanes, type SectionLane } from './sectionLanes';

/**
 * The layout engine of one section (spec 2026-09-08-layout-engine-design.md).
 * A column = every node of the section sharing a snapped x, whatever its type, ordered by y; the two
 * exceptions are an output cell, which rides with the code cell that names it in `outputNodeId`, and
 * a kernel badge, which is a marker the user parks anywhere. A pair = a column + its output column
 * (only a code cell has an output). Every function is pure and returns only what changed.
 */

export interface EngineNode { id: string; type: string; x: number; y: number; w: number; h: number; outputNodeId?: string }
// - `w`/`h` are reserved for content measurement: no engine function emits a size yet, so every
//   patch a caller receives today carries only x/y.
export interface Patch { x: number; y: number; w?: number; h?: number }
export type Patches = Record<string, Patch>;
export interface Column { x: number; width: number; cellIds: string[] }
export interface Pair { column: Column; outputX: number; outputW: number; right: number; hasOutput: boolean }
// - `report` is filled in by the call: `capped` says the bump walk stopped with overlaps still
//   there (a dense section), so the caller can tell the user to reflow. `maxSteps` overrides how
//   many steps that walk gets (default `nodes.length * 4 + 32`), which is how the cap is tested.
// - `riders` is the anchoring of §3.5: target id → source id, one entry per node that keeps
//   another node's row. Every caller builds it from the canvas edges with `ridersOf` below.
export interface LayoutOpts { moverIds?: Iterable<string>; columnX?: number; riders?: Map<string, string>; report?: { capped?: boolean }; maxSteps?: number }

// - what a column pack needs from the call around it (§3.5): `held` = the movers, their pair partners
//   and the riders of the packed columns (a rider goes under these); `noBump` = the nodes no bump
//   will move in this call; `placed` = the riders this call has already put on their rows.
interface PackSets { held: Set<string>; noBump: Set<string>; placed: Set<string> }

const byId = (nodes: EngineNode[]) => new Map(nodes.map(n => [n.id, n] as const));

// - a column x the engine computes is always rounded UP to the grid: deriveColumns snaps x back on
//   the next call, so an off-grid column (a code or output cell of off-grid width puts one there)
//   would move its cells again and a second run would not be a no-op. Up, never down: the gap holds.
const gridUp = (v: number) => Math.ceil(v / GRID) * GRID;

/**
 * Height of a code cell whose content needs `neededPx` (the editor's content height plus the
 * header, border and status bar around it): CODE_H_STEP steps from NODE_SIZE.code.h up to
 * CODE_MAX_H. The caller measures the need, so the cell only grows once the text really no
 * longer fits, and by 50px rather than a whole grid row.
 */
export function codeCellHeight(neededPx: number): number {
  const raw = Math.ceil(Math.max(0, neededPx) / CODE_H_STEP) * CODE_H_STEP;
  return Math.min(CODE_MAX_H, Math.max(NODE_SIZE.code.h, raw));
}

/**
 * What a code cell's text needs in px, for a caller with no editor to measure it: the line count
 * times a line height, plus the chrome the cell puts around the editor (both estimated, see
 * CODE_LINE_H_ESTIMATE in ./constants.ts). The webview measures the real numbers off the live DOM
 * (`CodeNode.reportHeight`) and that replaces this on the user's first edit, so only the CODE_H_STEP
 * of `codeCellHeight` has to absorb the difference. A trailing newline counts as a line, as Monaco
 * shows it.
 */
export function estimateCodeNeedPx(code: string): number {
  const lines = code.split('\n').length;
  return lines * CODE_LINE_H_ESTIMATE + CODE_CHROME_ESTIMATE;
}

/** Ids of output cells owned by a code cell (the nodes that ride with a cell instead of a column). */
export function outputOwners(nodes: EngineNode[]): Map<string, string> {
  const owners = new Map<string, string>();
  const ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) if (n.type === 'code' && n.outputNodeId && ids.has(n.outputNodeId)) owners.set(n.outputNodeId, n.id);
  return owners;
}

// - a kernel badge is a 140×160 marker the user parks where they like, so it is no column member:
//   as the head of a column it would drag the first code cell up to its own y. It is still a plain
//   box, so the bumps still move it, on its own, to keep it clear of what lands on it.
const isMember = (n: EngineNode, owners: Map<string, string>) => !owners.has(n.id) && n.type !== 'kernel';

/**
 * Which nodes keep another node's row (§3.5): target id → source id. An edge counts when it leaves
 * the source's right border and enters the target's left one (a side the file leaves out is that
 * border), and the source's column is strictly left of the target's. Any two node types count, with
 * these exceptions: the target is a column member and not a band (a `group` node) — an output cell
 * already takes its code cell's row, a kernel badge is in no column — and the source is not a kernel
 * badge or a band. An output cell as the source stands for its code cell: its row is that cell's
 * row, so the map names the code cell, and that cell's column too has to be left of the target's.
 * Everything else — a bottom-to-top edge down one column, an edge drawn back to the left — stays a
 * drawing and moves nothing. A target several edges point at takes the leftmost source, ties going
 * to the lower id, so the result does not depend on the edge order in the file.
 */
export function ridersOf(nodes: EngineNode[], edges: { fromNode: string; toNode: string; fromSide?: string; toSide?: string }[]): Map<string, string> {
  const map = byId(nodes);
  const owners = outputOwners(nodes);
  const best = new Map<string, EngineNode>();
  for (const e of edges) {
    if ((e.fromSide ?? 'right') !== 'right' || (e.toSide ?? 'left') !== 'left') continue;
    const from = map.get(e.fromNode);
    const to   = map.get(e.toNode);
    if (!from || !to || !isMember(to, owners) || to.type === 'group' || from.type === 'kernel' || from.type === 'group') continue;
    const source = map.get(owners.get(from.id) ?? '') ?? from;
    if (snapGrid(from.x) >= snapGrid(to.x) || snapGrid(source.x) >= snapGrid(to.x)) continue;
    const held = best.get(to.id);
    if (!held || snapGrid(source.x) < snapGrid(held.x) || (snapGrid(source.x) === snapGrid(held.x) && source.id < held.id)) best.set(to.id, source);
  }
  return new Map([...best].map(([target, source]) => [target, source.id] as const));
}

/**
 * Columns of a section, left to right; cells top to bottom, a mover first on a tie. Every node type
 * is a column member — a note, a file and a code cell at the same snapped x are one column and pack
 * together. Two are not: an output cell takes its code cell's row (`packColumn`), and a kernel badge
 * is a marker that belongs to no column.
 */
export function deriveColumns(nodes: EngineNode[], movers = new Set<string>()): Column[] {
  const owners = outputOwners(nodes);
  const groups = new Map<number, EngineNode[]>();
  for (const n of nodes) {
    if (!isMember(n, owners)) continue;
    const x = snapGrid(n.x);
    const g = groups.get(x);
    if (g) g.push(n); else groups.set(x, [n]);
  }
  const columns = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, cells]) => {
      cells.sort((a, b) => a.y - b.y || Number(movers.has(b.id)) - Number(movers.has(a.id)) || a.id.localeCompare(b.id));
      return { x, cells };
    });
  // - a member that reaches over the next column, or stops short of it by less than a gap, does not
  //   set this column's width (§3.4): it is an obstacle that column packs around, not a reason to
  //   send it further right. The width is the widest member that stays clear; a column whose members
  //   all reach over keeps its widest, as before, there being no narrower one to read the pair off.
  return columns.map((c, i) => {
    const nextX = columns[i + 1]?.x;
    const inside = nextX === undefined ? c.cells : c.cells.filter(m => c.x + m.w + GRID <= nextX);
    const widths = (inside.length > 0 ? inside : c.cells).map(m => m.w);
    return { x: c.x, width: Math.max(...widths), cellIds: c.cells.map(m => m.id) };
  });
}

/**
 * Pairs = columns with their output column: x one gap right of the column's widest member, width =
 * the widest output the column holds, at its REAL width (never clamped: a wide output must not
 * overlap the pair to its right — OUTPUT_MAX_W is for the callers that create or resize an output),
 * floored at OUTPUT_MIN_W. Every column gets a pair; the output column only means something for a
 * column that holds a code cell, since nothing else has an output.
 * `right` is the far edge of the pair as it really sits: the modelled slot (kept for a code column
 * whose cells have not run yet, so a fork clears the outputs to come), or an output the user has
 * parked further right than it. A column with no code cell ends at its own right edge.
 * `hasOutput` says whether any cell of the column has an output node in the section: Reflow keeps
 * the output slot only for such a column (§3.4).
 */
export function derivePairs(nodes: EngineNode[], columns: Column[]): Pair[] {
  const map = byId(nodes);
  return columns.map(column => {
    let outputW = OUTPUT_MIN_W;
    let parked = 0;
    let hasCode = false;
    let hasOutput = false;
    for (const id of column.cellIds) {
      const cell = map.get(id);
      if (cell?.type === 'code') hasCode = true;
      const out = map.get(cell?.outputNodeId ?? '');
      if (out) { hasOutput = true; outputW = Math.max(outputW, out.w); parked = Math.max(parked, out.x + out.w); }
    }
    const outputX = column.x + column.width + GRID;
    const right = hasCode ? Math.max(outputX + outputW, parked) : column.x + column.width;
    return { column, outputX, outputW, right, hasOutput };
  });
}

// - bottom of a column member's row = the taller of the node and its output (a note has none)
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

// - what a column packs around (§3.4): every node of the section that is not one of its members —
//   a wide cell of the column left of it, a note parked across it, another column's output. Three
//   are not obstacles: the members themselves, the outputs of those members (this same pack puts
//   them on their cells' rows, so their old y says nothing), and a kernel badge, which the user
//   parks where they like and the bumps keep clear, as before.
function obstaclesOf(pair: Pair, nodes: EngineNode[], owners: Map<string, string>): EngineNode[] {
  const members = new Set(pair.column.cellIds);
  return nodes.filter(n => !members.has(n.id) && n.type !== 'kernel' && !members.has(owners.get(n.id) ?? ''));
}

/**
 * The row a member takes: `start`, moved under every obstacle it would sit in. `obstacles` comes in
 * y order, so one pass down skips a whole stack of them.
 * An obstacle is in the way when its x-span crosses the member's, and one coming from the LEFT also
 * when it stops within a gap of the column — the same line `deriveColumns` draws for a member that
 * is too wide to set its column's width. A node at or right of the column that merely touches it is
 * not an obstacle: the bumps move it right rather than sending the column under it (§3.2).
 * On y the row has to clear the obstacle by a full grid gap, the distance the bumps ask for
 * everywhere else, so the pack never leaves behind an overlap of its own making.
 * `near` = the nodes no bump will move in this call: these count within a gap on the right too,
 * since the bumps would leave the two where they are.
 */
function rowStart(start: number, x: number, member: EngineNode, obstacles: EngineNode[], near?: Set<string>): number {
  let y = start;
  for (const o of obstacles) {
    const both = near?.has(o.id) ?? false;
    if (o.x + o.w + (o.x < x || both ? GRID : 0) <= x || x + member.w + (both ? GRID : 0) <= o.x) continue;
    if (o.y + o.h + GRID <= y || y + member.h + GRID <= o.y) continue;
    y = o.y + o.h + GRID;
  }
  return y;
}

// - pack one column tight top → bottom, whatever the node types in it, around whatever crosses it;
//   outputs take their code cell's y and are placed here rather than as members, and a rider takes
//   its source's row (§3.5) rather than a slot in the stack. `toSlot` decides whether an output also
//   goes back to the pair's x slot: Reflow (the explicit tidy) takes every one of them, a regular
//   call only the ones whose pair the operation itself broke. An output the user parked overlaps
//   nothing where it is, so pulling it left starts a bump the section never needed.
function packColumn(pair: Pair, nodes: EngineNode[], map: Map<string, EngineNode>, riders: Map<string, string>, owners: Map<string, string>, out?: Patches, toSlot: (cellId: string, output: EngineNode, wasY: number) => boolean = () => true, sets: PackSets = { held: new Set(), noBump: new Set(), placed: new Set() }): void {
  const { held, noBump, placed } = sets;
  const x = pair.column.x;
  const place = (cell: EngineNode, y: number) => {
    const wasY = cell.y;
    if (x !== cell.x || y !== cell.y) { if (out) out[cell.id] = { x, y }; cell.x = x; cell.y = y; }
    const o = map.get(cell.outputNodeId ?? '');
    const ox = o ? (toSlot(cell.id, o, wasY) ? pair.outputX : Math.max(o.x, pair.outputX)) : 0;
    if (o && (o.x !== ox || o.y !== y)) { if (out) out[o.id] = { x: ox, y }; o.x = ox; o.y = y; }
  };
  const members = pair.column.cellIds.map(id => map.get(id)!);
  const own = new Set(pair.column.cellIds);
  // - the riders first, each on the row of the node its edge comes from (§3.5), two on one row
  //   stacking in the column's order: the one higher now stays on top. A rider whose source is not in
  //   this section is no rider: it packs. Nor is one whose source is a member of THIS column: Reflow
  //   snaps columns before it packs and can put the two in one, and reading a column-mate's y as a
  //   fixed row walks the column down.
  const anchored = members
    .map((cell, order) => { const s = riders.get(cell.id); return { cell, order, at: s !== undefined && !own.has(s) ? map.get(s)?.y : undefined }; })
    .filter((a): a is { cell: EngineNode; order: number; at: number } => a.at !== undefined)
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const byRow = (a: EngineNode, b: EngineNode) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
  const around = obstaclesOf(pair, nodes, owners);
  // - a rider goes under an output of another pair, a `held` node and its own source (§3.5). A plain
  //   member of a packed column packs around the rider instead; the source cannot, since the rider
  //   follows its row.
  const blocking = around.filter(n => owners.has(n.id) || held.has(n.id)).sort(byRow);
  let prevRider: number | null = null;
  for (const a of anchored) {
    const source = map.get(riders.get(a.cell.id)!)!;
    const inWay = blocking.includes(source) ? blocking : [...blocking, source].sort(byRow);
    place(a.cell, rowStart(prevRider === null ? a.at : Math.max(a.at, prevRider + GRID), x, a.cell, inWay, noBump));
    placed.add(a.cell.id);
    prevRider = rowBottom(a.cell, map);
  }
  // - in y order, and nothing else this pack moves is in the list, so one ordering serves every
  //   member. The riders join it, with their outputs: fixed rows the rest of the column packs around.
  const taken = new Set(anchored.map(a => a.cell.id));
  const fixed = anchored.flatMap(a => [a.cell, map.get(a.cell.outputNodeId ?? '')].filter((n): n is EngineNode => n !== undefined));
  const obstacles = [...around, ...fixed].sort(byRow);
  const otherRiders = around.filter(n => riders.has(n.id) && held.has(n.id));
  const others = new Set(otherRiders.map(n => n.id));
  // - the head clears only riders already on their rows: one still at its y from before the call
  //   would push the head down for a row the rider does not keep, and a head never moves back up
  const riderRows = [...fixed, ...otherRiders.filter(n => placed.has(n.id))].sort(byRow);
  let prevBottom: number | null = null;
  for (const cell of members) {
    if (taken.has(cell.id)) continue;
    // - a plain member packs around the riders of other packed columns and clears what no bump will
    //   move by a gap on either side. A held member does neither: those riders go under it. No member
    //   packs around its own rider.
    const isHeld = held.has(cell.id);
    const keep = (o: EngineNode) => riders.get(o.id) !== cell.id && !(isHeld && others.has(o.id));
    const near = isHeld ? undefined : noBump;
    // - the head keeps its own y, obstacles or not (§3.4); only a rider's row moves it down
    const y = prevBottom === null
      ? rowStart(snapGrid(cell.y), x, cell, riderRows.filter(keep), near)
      : rowStart(prevBottom + GRID, x, cell, obstacles.filter(keep), near);
    place(cell, y);
    prevBottom = rowBottom(cell, map);
  }
}

// - what one bump moves with `node`: its column — every node at that snapped x, outputs riding with
//   their code cells; an output is taken through the cell that owns it. `downward` keeps only the
//   ones at or under the anchor, which is what a downward bump takes; a sideways bump takes the
//   whole column, so the columns stay aligned. A kernel badge is in no column and moves alone.
function bumpGroup(node: EngineNode, nodes: EngineNode[], owners: Map<string, string>, map: Map<string, EngineNode>, downward: boolean): EngineNode[] {
  const anchor = map.get(owners.get(node.id) ?? '') ?? node;
  if (anchor.type === 'kernel') return [anchor];
  const x = snapGrid(anchor.x);
  const column = nodes.filter(n => isMember(n, owners) && snapGrid(n.x) === x);
  const taken = downward ? column.filter(n => n.y >= anchor.y) : column;
  const group = [...taken];
  for (const c of taken) { const o = map.get(c.outputNodeId ?? ''); if (o) group.push(o); }
  return group;
}

// - the nodes a downward bump moves, plus the riders of every one of them and those riders' outputs
//   (§3.5): a source that drops without its riders leaves them off the row they are anchored to. The
//   list grows as it is walked, so a rider of a rider comes too.
function withRiders(moving: EngineNode[], riders: Map<string, string>, map: Map<string, EngineNode>): EngineNode[] {
  const out = [...moving];
  const seen = new Set(out.map(n => n.id));
  for (let i = 0; i < out.length; i++) {
    for (const [target, source] of riders) {
      if (source !== out[i].id || seen.has(target)) continue;
      const rider = map.get(target);
      if (!rider) continue;
      seen.add(target); out.push(rider);
      const o = map.get(rider.outputNodeId ?? '');
      if (o && !seen.has(o.id)) { seen.add(o.id); out.push(o); }
    }
  }
  return out;
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
 * exactly the overlap — right or down, never left and never up. Sitting left of the mover, its only
 * move is down, past the mover's row; sitting at or right of it, it takes the smaller of right and
 * down, a tie going right. A column never changes order, so a node ABOVE the one in hand does not
 * move past it: it steps aside, or — when that is the smaller move, or there is nowhere to step —
 * the node the operation placed YIELDS and drops below it, with whatever sits under it in its own
 * column. That is the one case where a mover moves. A cell the pack has just laid out does not
 * yield; the node above it steps aside, and falls past it only when it cannot.
 * Everything a bump moved is checked again, so a bump cascades — through real overlaps and by
 * overlap amounts only, never by a modelled distance, which is why a hand-placed section an edit
 * does not actually reach is left alone. `report.capped` is set when the walk ran out of steps with
 * overlaps still on the section.
 */
function resolveBumps(nodes: EngineNode[], owners: Map<string, string>, riders: Map<string, string>, pinned: Set<string>, placed: Set<string>, active: Set<string>, opts: { report?: { capped?: boolean }; maxSteps?: number } = {}): void {
  const map = byId(nodes);
  const before = nodes.map(n => ({ node: n, x: n.x, y: n.y }));
  // - the cap is a real limit, not a formality: a dense section (a diagonal staircase, a tight grid)
  //   holds more overlaps than this many steps resolve, and the walk then stops with some of them
  //   still there. `capped` tells the caller, who can offer a Reflow.
  for (let guard = opts.maxSteps ?? nodes.length * 4 + 32; guard > 0; guard--) {
    const hit = nextBump(nodes, owners, pinned, active);
    if (!hit) return;
    const { mover, other } = hit;
    const column = bumpGroup(other, nodes, owners, map, false);
    // - a sideways step is RIGHT only, and is the overlap rounded UP to the grid: the whole column
    //   moves by the same grid multiple, so it still shares one snapped x and the next call reads
    //   the same column. A node left of the mover has no sideways move at all — a left step is not
    //   monotone, so a walk that allows one can return to a position it has already been in and
    //   never settle (H4, N11 created on M1: N8 slid left into E6's column, and round again).
    //   A column slides only as one, so it does not slide at all while a pinned node sits in it, nor
    //   while the node doing the bumping does: that one would ride along and the overlap would come
    //   out the same, step after step — 20 000 identical right steps, measured. It goes down instead.
    const dx = other.x < mover.x || column.some(n => pinned.has(n.id) || n.id === mover.id) ? 0
      : gridUp(mover.x + mover.w + GRID - other.x);
    const dy = mover.y + mover.h + GRID - other.y;    // - the other node clears the mover, downward
    const drop = other.y + other.h + GRID - mover.y;   // - the mover clears the other node, downward
    // - a node ABOVE the node in hand does not move down past it: that would reorder the column the
    //   user is looking at. It steps aside if its column can slide, and otherwise the node in hand
    //   YIELDS — it drops below the one in its way, taking what sits under it in its own column. The
    //   smaller of the two wins, ties sideways, the same comparison the other direction uses. Only a
    //   node the operation itself placed yields: a cell the pack has just laid out keeps its place,
    //   so the pack and the bumps never fight over it (that fight is not idempotent).
    const yields = other.y < mover.y && placed.has(mover.id);
    const sideways = dx !== 0 && (yields ? dx <= drop : other.y < mover.y || dx <= dy);
    // - the down group is the node in the way and what sits under it in its column, and that can
    //   hold the node doing the bumping too, which then rides down with them and leaves the overlap
    //   exactly as it was — the same walk that never closes as a column sliding with it. It is held
    //   back, and its pair partner with it, so a code cell and its output stay on one row.
    const held = new Set([mover.id, owners.get(mover.id) ?? mover.outputNodeId ?? '']);
    // - a node anchored by an edge moves when its SOURCE does, which is what keeps it on that source's
    //   row. A sideways step leaves every y alone, so those nodes stay where they are; a downward one
    //   takes them, and their outputs, with the source. In a column this call did not pack, such a
    //   node is otherwise a plain node here: a bump can push it off the row it is anchored to.
    if (sideways) for (const n of column) { n.x += dx; active.add(n.id); }
    else if (yields) for (const n of withRiders(bumpGroup(mover, nodes, owners, map, true), riders, map)) { n.y += drop; active.add(n.id); }
    else {
      const group = bumpGroup(other, nodes, owners, map, true).filter(n => !pinned.has(n.id) && !held.has(n.id));
      for (const n of withRiders(group, riders, map).filter(n => !held.has(n.id))) { n.y += dy; active.add(n.id); }
    }
  }
  // - the last allowed step may be the one that cleared the section: out of steps is not out of
  //   overlaps, so ask once more before undoing anything
  if (!nextBump(nodes, owners, pinned, active)) return;
  // - out of steps with overlaps still there: undo the walk. A half-bumped section can hold MORE
  //   overlaps than it started with, and the user's hand-placed layout is not ours to shuffle for
  //   nothing — the caller says to run Reflow instead.
  for (const b of before) { b.node.x = b.x; b.node.y = b.y; }
  if (opts.report) opts.report.capped = true;
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
  const riders = opts.riders ?? new Map<string, string>();
  const pairs = derivePairs(nodes, deriveColumns(nodes, movers));
  const packed: Patches = {};

  // - which columns are touched: the movers' (a moved output counts for its code's column) + columnX
  const touched = new Set<number>();
  // - a mover IS placed by the pack below, snapped onto its column and stacked in it; what pinning
  //   means is that no BUMP moves it, bar the one yield in `resolveBumps`. The other half of its
  //   pair is pinned with it, an output having its code cell's y.
  const pinned = new Set(movers);
  for (const id of movers) {
    const n = map.get(id); if (!n) continue;
    const memberId = owners.get(id) ?? id;
    touched.add(snapGrid(map.get(memberId)!.x));
    pinned.add(memberId);
    if (n.outputNodeId) pinned.add(n.outputNodeId);
  }
  if (opts.columnX !== undefined) touched.add(snapGrid(opts.columnX));
  // - the nodes the operation itself placed, before the pack adds its column: the only ones that
  //   yield downward to a node above them
  const placed = new Set(pinned);
  // - a rider sits on its source's row, so the column of every rider of a node in a touched column is
  //   touched too, and its riders in turn. The pairs run left → right below, and a source is always
  //   in a column left of its rider, so a source is packed before the rider that reads its y.
  for (let more = true; more;) {
    more = false;
    for (const [target, source] of riders) {
      const r = map.get(target), s = map.get(source);
      if (!r || !s || touched.has(snapGrid(r.x)) || !touched.has(snapGrid(s.x))) continue;
      touched.add(snapGrid(r.x)); more = true;
    }
  }
  // - a node anchored by an edge is protected only inside the columns this call packs (§3.5): there it
  //   goes where its source goes, so what it is in the way of is what moves. Anywhere else it is a
  //   normal node for the bumps and can be pushed off its source's row; the next pack of its column
  //   puts it back on that row. Protecting it section-wide left a node dropped on one of them with
  //   nowhere to go and nothing reported: both sides of the overlap were held.
  for (const target of riders.keys()) {
    const t = map.get(target);
    if (t && touched.has(snapGrid(t.x))) pinned.add(target);
  }
  // - taken before the packs add their columns to `pinned`: a plain member of a packed column does
  //   not hold a row against a rider (§3.5), its column packs around the rider instead
  const held = new Set(pinned);
  const noBump = new Set(held);
  for (const pair of pairs) if (touched.has(pair.column.x)) for (const id of pair.column.cellIds) {
    noBump.add(id);
    const outId = map.get(id)!.outputNodeId; if (outId) noBump.add(outId);
  }
  const sets: PackSets = { held, noBump, placed: new Set() };

  // - the packs run again until a round moves nothing: a column packed early in a round read the y
  //   of nodes that a later pack then moved (a rider, a node a wide member here packed around), so
  //   one round can leave two packed nodes overlapping, or a hole the next call closes. The cap only
  //   stops a shape that keeps changing.
  for (let round = 0; round < 8; round++) {
    const moved: Patches = {};
    for (const pair of pairs) if (touched.has(pair.column.x)) {
      // - an output goes back on the slot when the operation moved its code cell AND left it off that
      //   cell's row: the pair is broken, and a cell the user dragged takes its output with it
      packColumn(pair, nodes, map, riders, owners, moved, (id, o, wasY) => movers.has(id) && o.y !== wasY, sets);
      // - the pack owns the column it just laid out: a bump moves what is in its way, never it, so the
      //   two never fight over the same cell and the next call packs it to the same place
      for (const id of pair.column.cellIds) { pinned.add(id); const outId = map.get(id)!.outputNodeId; if (outId) pinned.add(outId); }
    }
    if (Object.keys(moved).length === 0) break;
    Object.assign(packed, moved);
  }
  resolveBumps(nodes, owners, riders, pinned, placed, new Set([...movers, ...Object.keys(packed)]), { report: opts.report, maxSteps: opts.maxSteps });
  return diff(input, nodes);
}

/**
 * Whole-section pack: every code cell snapped to its column, every column and every pair tight.
 * `riders` anchors the nodes an edge holds on another node's row (§3.5), as in `layoutSection`.
 */
export function reflowSection(input: EngineNode[], opts: { riders?: Map<string, string> } = {}): Patches {
  const nodes = clone(input);
  const map = byId(nodes);
  // - snap x onto columns, left → right: a node joins the nearest column found so far when it sits
  //   within half a pair width, else it starts one at its own snapped x. A node is never a candidate
  //   column for itself — that is what leaves an off-column node in its own column.
  const owners = outputOwners(nodes);
  const sweep = (a: EngineNode, b: EngineNode) => snapGrid(a.x) - snapGrid(b.x) || a.y - b.y || a.id.localeCompare(b.id);
  const half = (NODE_SIZE.code.w + GRID + OUTPUT_MIN_W) / 2;
  const xs: number[] = [];
  const adopt = (n: EngineNode) => {
    const sx = snapGrid(n.x);
    const near = xs.filter(x => Math.abs(x - sx) <= half).sort((a, b) => Math.abs(a - sx) - Math.abs(b - sx))[0];
    if (near === undefined) xs.push(sx);
    n.x = near ?? sx;
  };
  // - the code cells alone decide where the columns are: they carry the outputs and the pair widths,
  //   so a note parked beside them must not drag a whole pair sideways.
  for (const n of nodes.filter(n => n.type === 'code').sort(sweep)) adopt(n);
  // - then every other member joins the nearest of those columns, or starts one where none is in
  //   reach — a list the later notes can join in turn. An output is no member: it keeps its x here
  //   and `packColumn` below puts it back on its pair's slot. A kernel badge is parked by hand.
  for (const n of nodes.filter(n => isMember(n, owners) && n.type !== 'code').sort(sweep)) adopt(n);
  const riders = opts.riders ?? new Map<string, string>();
  // - every column is packed and no bump runs here, so every rider keeps its row as in a regular call
  //   (§3.5) and every node counts as one no bump moves. The packs repeat until a round moves nothing.
  //   A rider the snap above put in its source's column is no rider (§3.5), so it is not held either.
  const noBump = new Set(nodes.map(n => n.id));
  const packAll = () => {
    const held = new Set([...riders].filter(([t, s]) => map.has(t) && map.has(s) && snapGrid(map.get(t)!.x) !== snapGrid(map.get(s)!.x)).map(([t]) => t));
    const sets: PackSets = { held, noBump, placed: new Set() };
    for (let round = 0; round < 8; round++) {
      const moved: Patches = {};
      for (const pair of derivePairs(nodes, deriveColumns(nodes))) packColumn(pair, nodes, map, riders, owners, moved, () => true, sets);
      if (Object.keys(moved).length === 0) break;
    }
  };
  packAll();
  // - pairs tight left → right, the first keeping its x; outputs re-measured after the packs. Run
  //   again while it still moves something: a column's width is read off the members that stay clear
  //   of the NEXT column (§3.4), so moving that column changes the width, and the width decides where
  //   the column goes. Two or three rounds settle it; the cap is there so a shape that keeps changing
  //   stops rather than spins, and the next Reflow finishes it.
  //   The output slot is kept only right of a column that has an output (§3.4): a column of code cells
  //   that have not run yet ends at its own right edge here. `forkOf` still reads the full slot.
  const end = (p: Pair) => (p.hasOutput ? p.right : p.column.x + p.column.width);
  for (let round = 0; round < 8; round++) {
    const tight = derivePairs(nodes, deriveColumns(nodes));
    let moved = false;
    for (let i = 1; i < tight.length; i++) {
      const want = gridUp(end(tight[i - 1]) + GRID);
      const dx = want - tight[i].column.x;
      if (dx === 0) continue;
      for (const id of tight[i].column.cellIds) {
        const cell = map.get(id)!; cell.x += dx;
        const o = map.get(cell.outputNodeId ?? ''); if (o) o.x += dx;
      }
      tight[i].column.x += dx; tight[i].outputX += dx; tight[i].right += dx;
      moved = true;
    }
    if (!moved) break;
  }
  // - and packed once more: the columns have moved sideways, so which wide cell crosses which
  //   column has changed with them. Without this the next Reflow would pack them differently.
  packAll();
  return diff(input, nodes);
}

/** Where a new node goes after `afterId`: its column, one gap below its row. Null when there is no such node. */
export function insertAfter(nodes: EngineNode[], afterId: string): { x: number; y: number } | null {
  const after = nodes.find(n => n.id === afterId);
  if (!after) return null;
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
 * every deleted node leaves one in its own column, whatever its type, except an output cell — which
 * counts for its code cell's column, so a code cell going with its output leaves one entry, not two.
 * One entry per column; empty when the canvas has no sections.
 */
export function columnsOfDeleted(nodes: CanvasShapedNode[], sections: SectionLane[], deletedIds: Set<string>): { sectionId: string; columnX: number }[] {
  if (sections.length === 0) return [];
  const derived = deriveLanes(nodes, sections);
  const seen = new Set<string>();
  const cols: { sectionId: string; columnX: number }[] = [];
  for (const n of nodes) {
    if (!deletedIds.has(n.id)) continue;
    const member = nodes.find(c => c.type === 'code' && c.outputNodeId === n.id) ?? n;
    const lane = derived.find(l => l.memberIds.includes(member.id));
    if (!lane) continue;
    const key = `${lane.id}|${snapGrid(member.x)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cols.push({ sectionId: lane.id, columnX: snapGrid(member.x) });
  }
  return cols;
}

/** Adapter: canvas nodes → engine nodes (the file's `width`/`height` → `w`/`h`). */
export function toEngineNodes(nodes: CanvasShapedNode[]): EngineNode[] {
  return nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height, ...(n.outputNodeId ? { outputNodeId: n.outputNodeId } : {}) }));
}
