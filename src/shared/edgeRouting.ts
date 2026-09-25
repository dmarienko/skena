import { GRID } from './constants';

/**
 * Edge routing for one section (spec 2026-09-11-edges-design.md §1–§2). The layout engine leaves a
 * full grid between columns and between rows, so every edge can run on the centre line of a gap.
 * This module builds that grid of crossings once per section, adds to it, for each edge, the two
 * lines that edge's own end points stand on, routes the edge on the two together with a shortest
 * path that pays for its corners, spreads the edges of one border 10 px apart, and puts
 * parallel runs on one line into 10 px lanes so that no two edges are drawn over each other.
 * Pure — no React, no DOM.
 */

/** - the geometry a border is measured from; RouteNode and the nav nodes both satisfy it */
export interface BoxGeom { x: number; y: number; w: number; h: number }
export interface RouteNode extends BoxGeom { id: string; type: string; outputNodeId?: string }
export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface RouteEdge { id: string; source: string; target: string; sourceSide?: Side; targetSide?: Side }
export type EdgeKind = 'sequence' | 'output' | 'context';

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
// - a React Flow handle id is the JSON Canvas side; anything else (a node-local handle) has no side
export const sideOfHandle = (h?: string | null): Side | undefined =>
  (SIDES as string[]).includes(h ?? '') ? h as Side : undefined;
export type Point = [number, number];

export interface RoutedEdge {
  id: string;
  kind: EdgeKind;
  /** - polyline, first = exit point on the source border, last = entry point on the target border */
  points: Point[];
  /** - 0-based slot among the edges sharing the source border (colour + exit slot) */
  variant: number;
  /** - the same slot on the target border */
  variantIn: number;
  /** - the border each end leaves or enters by, after the geometry default; absent when that end is
      not a node of this section (such an edge always falls back) */
  sourceSide?: Side;
  targetSide?: Side;
  /** - true when no gap route was found (caller uses the old router) */
  fallback: boolean;
}

/** What a pass could not do; the caller may surface it. */
export interface RouteReport {
  /** - the section has more crossings than MAX_CROSSINGS, so every edge came back as a fallback */
  capped?: boolean;
  /** - lanes turned down because the shifted run would have crossed a node */
  blockedLanes?: number;
  /** - runs that found no lane whose whole stretch was free; each took the one sharing the least */
  crowded?: number;
}

/** - px between parallel edges in one gap, and between exit points on one border */
export const LANE_STEP = 10;
/** - a corner costs one grid of length */
export const BEND_COST = GRID;
// - the crossings cost one clear test each to build and one Dijkstra state per direction per edge to
//   search, and each edge adds a crossing of its own on every line it meets (two lines x 62 lines =
//   124 more on a section at the cap). 40 000 crossings (100 nodes sharing no column and no row) take
//   10.8 s for 99 long edges. A section just under the cap (3 844 crossings, 31 such nodes) takes
//   11 ms for 30 chained edges and 0.88 s for 99 long ones. Past the cap a section is not routed —
//   the old per-edge router draws it.
export const MAX_CROSSINGS = 4000;

const HALF = GRID / 2;
// - 9 lanes fit in a 100 px gap
const LANE_COUNT = 9;
// - the furthest from its line a lane can put a run, so also how far a corner on it can travel
const LANE_SPREAD = LANE_STEP * ((LANE_COUNT - 1) / 2);

// - lanes fill from the gap centre outwards (0, -10, +10, -20 … ±40), so a lone run keeps the centre
//   line and a pair straddles it; past the ninth the lanes repeat
const laneOffset = (k: number): number => {
  const lane = k % LANE_COUNT;
  return (lane % 2 === 1 ? -1 : 1) * Math.ceil(lane / 2) * LANE_STEP;
};

export function edgeKind(e: RouteEdge, byId: Map<string, RouteNode>): EdgeKind {
  const s = byId.get(e.source), t = byId.get(e.target);
  if (!s || !t) return 'context';
  if (s.type === 'code' && s.outputNodeId === t.id) return 'output';
  if (s.type === 'code' && t.type === 'code') return 'sequence';
  return 'context';
}

/** Side of `from` that faces `to` — the default when the canvas edge names no handle. */
export function facingSide(from: BoxGeom, to: BoxGeom): Side {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * The gap grid of a section: one line half a grid outside every node border, the crossings of those
 * lines, and the straight runs between neighbouring crossings. A crossing is addressed by
 * `xi * ys.length + yi`.
 */
export interface GapGraph {
  xs: number[];
  ys: number[];
  /** - too many crossings to route (see MAX_CROSSINGS): `nbrs` is empty and every edge falls back */
  capped: boolean;
  free: (xi: number, yi: number) => boolean;
  clearH: (yi: number, xa: number, xb: number) => boolean;
  clearV: (xi: number, ya: number, yb: number) => boolean;
  /** - the crossings each crossing reaches in one straight run */
  nbrs: number[][];
}

// - only a run through a box's interior is blocked: the lines sit half a grid off the borders, so a
//   run that merely touches a border is the normal case, not an obstruction
function clearSeg(nodes: RouteNode[], x1: number, y1: number, x2: number, y2: number): boolean {
  const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
  return !nodes.some(n => xb > n.x && xa < n.x + n.w && yb > n.y && ya < n.y + n.h);
}

export function buildGapGraph(nodes: RouteNode[]): GapGraph {
  const xv = new Set<number>(), yv = new Set<number>();
  // - the leftmost and rightmost of these lines are already the section's outer margin (min x - HALF,
  //   max right + HALF), so no separate bounding-box line is needed
  for (const n of nodes) {
    xv.add(n.x - HALF); xv.add(n.x + n.w + HALF);
    yv.add(n.y - HALF); yv.add(n.y + n.h + HALF);
  }
  const xs = [...xv].sort((a, b) => a - b);
  const ys = [...yv].sort((a, b) => a - b);
  const free = (xi: number, yi: number) => clearSeg(nodes, xs[xi], ys[yi], xs[xi], ys[yi]);
  const clearH = (yi: number, xa: number, xb: number) => clearSeg(nodes, xs[xa], ys[yi], xs[xb], ys[yi]);
  const clearV = (xi: number, ya: number, yb: number) => clearSeg(nodes, xs[xi], ys[ya], xs[xi], ys[yb]);
  const nbrs: number[][] = [];
  if (xs.length * ys.length > MAX_CROSSINGS) return { xs, ys, capped: true, free, clearH, clearV, nbrs };

  const nx = xs.length, ny = ys.length;
  const open: boolean[] = [];
  for (let i = 0; i < nx * ny; i++) { open.push(free(Math.floor(i / ny), i % ny)); nbrs.push([]); }
  for (let xi = 0; xi < nx; xi++) for (let yi = 0; yi < ny; yi++) {
    const i = xi * ny + yi;
    if (!open[i]) continue;
    const right = i + ny;
    if (xi + 1 < nx && open[right] && clearH(yi, xi, xi + 1)) { nbrs[i].push(right); nbrs[right].push(i); }
    const down = i + 1;
    if (yi + 1 < ny && open[down] && clearV(xi, yi, yi + 1)) { nbrs[i].push(down); nbrs[down].push(i); }
  }
  return { xs, ys, capped: false, free, clearH, clearV, nbrs };
}

/** Point on `side` of `n`, `off` px from the middle of that border. */
export function borderPoint(n: BoxGeom, side: Side, off: number): Point {
  if (side === 'right')  return [n.x + n.w, n.y + n.h / 2 + off];
  if (side === 'left')   return [n.x, n.y + n.h / 2 + off];
  if (side === 'bottom') return [n.x + n.w / 2 + off, n.y + n.h];
  return [n.x + n.w / 2 + off, n.y];
}

const isHorizontal = (side: Side) => side === 'left' || side === 'right';

/** Where one end of an edge meets its node: the border, the point on it, and which slot of it. */
interface BorderEnd { node: RouteNode; side: Side; at: Point; slot: number; off: number; count: number }
interface Attachment { edgeId: string; role: 'source' | 'target'; node: RouteNode; other: RouteNode; side: Side }

/**
 * Resolves both ends of every edge: the side it leaves or enters by, and its point on that border.
 * The edges of one border are ordered by `turns` when given (see `turnOrder`, keyed
 * `<edge id>:source` / `<edge id>:target`), then by the position of the node at the other end, and
 * spread LANE_STEP apart around the border's middle, so no two of them share a point.
 */
function resolveEnds(edges: RouteEdge[], byId: Map<string, RouteNode>, turns?: Map<string, number>): Map<string, { source?: BorderEnd; target?: BorderEnd }> {
  const borders = new Map<string, Attachment[]>();
  const add = (a: Attachment) => {
    const key = `${a.node.id}:${a.side}`;
    const list = borders.get(key);
    if (list) list.push(a); else borders.set(key, [a]);
  };
  for (const e of edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t || s === t) continue;
    add({ edgeId: e.id, role: 'source', node: s, other: t, side: e.sourceSide ?? facingSide(s, t) });
    add({ edgeId: e.id, role: 'target', node: t, other: s, side: e.targetSide ?? facingSide(t, s) });
  }

  const ends = new Map<string, { source?: BorderEnd; target?: BorderEnd }>();
  for (const list of borders.values()) {
    const across = isHorizontal(list[0].side);
    const turn = (a: Attachment) => turns?.get(`${a.edgeId}:${a.role}`) ?? 0;
    list.sort((p, q) =>
      (turn(p) - turn(q)) ||
      (across ? p.other.y - q.other.y : p.other.x - q.other.x) ||
      (across ? p.other.x - q.other.x : p.other.y - q.other.y) ||
      (p.edgeId < q.edgeId ? -1 : p.edgeId > q.edgeId ? 1 : 0));
    list.forEach((a, i) => {
      const off = (i - (list.length - 1) / 2) * LANE_STEP;
      const end: BorderEnd = { node: a.node, side: a.side, at: borderPoint(a.node, a.side, off), slot: i, off, count: list.length };
      const cur = ends.get(a.edgeId) ?? {};
      cur[a.role] = end;
      ends.set(a.edgeId, cur);
    });
  }

  // - a border holding a single edge lines its point up with the slot the busy border at the other
  //   end gave that edge, so a facing pair stays one straight line instead of stepping in the gap.
  //   Only when both ends spread along the same axis: across two axes there is nothing to line up.
  for (const { source, target } of ends.values()) {
    if (!source || !target || isHorizontal(source.side) !== isHorizontal(target.side)) continue;
    if (source.count === 1 && target.count > 1) adopt(source, target.off);
    else if (target.count === 1 && source.count > 1) adopt(target, source.off);
  }
  return ends;
}

function adopt(end: BorderEnd, off: number): void {
  end.off = off;
  end.at = borderPoint(end.node, end.side, off);
}

// - a small binary heap: Dijkstra runs over 4 states per crossing, far too many to scan
class MinHeap {
  private cost: number[] = [];
  private item: number[] = [];

  get size(): number { return this.item.length; }

  push(cost: number, item: number): void {
    this.cost.push(cost); this.item.push(item);
    let i = this.item.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      this.swap(p, i); i = p;
    }
  }

  /** Removes and returns the cheapest item; the caller checks `size` first. */
  pop(): number {
    const top = this.item[0];
    const last = this.item.length - 1;
    this.cost[0] = this.cost[last]; this.item[0] = this.item[last];
    this.cost.length = last; this.item.length = last;
    for (let i = 0; ;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < last && this.cost[l] < this.cost[m]) m = l;
      if (r < last && this.cost[r] < this.cost[m]) m = r;
      if (m === i) break;
      this.swap(m, i); i = m;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.cost[a], this.cost[b]] = [this.cost[b], this.cost[a]];
    [this.item[a], this.item[b]] = [this.item[b], this.item[a]];
  }
}

// - direction codes: 0 = +x, 1 = -x, 2 = +y, 3 = -y
const dirBetween = (a: Point, b: Point): number => b[0] > a[0] ? 0 : b[0] < a[0] ? 1 : b[1] > a[1] ? 2 : 3;
const OUT_DIR: Record<Side, number> = { right: 0, left: 1, bottom: 2, top: 3 };

/**
 * Shortest orthogonal path from `start` to `goal` over the `count` vertices: the section's crossings
 * and, past them, the vertices this edge added, whose links are in `extra`. Cost = length + BEND_COST
 * per change of direction, counting the corner where the route leaves the exit segment and the one
 * where it meets the entry segment.
 */
function shortestPath(
  g: GapGraph, extra: Map<number, number[]>, at: (i: number) => Point, count: number,
  start: number, startDir: number, goal: number, goalDir: number,
): number[] | null {
  const dist = new Float64Array(count * 4).fill(Infinity);
  const prev = new Int32Array(count * 4).fill(-1);
  const done = new Uint8Array(count * 4);
  const heap = new MinHeap();
  dist[start * 4 + startDir] = 0;
  heap.push(0, start * 4 + startDir);

  let best = Infinity;
  while (heap.size > 0) {
    const state = heap.pop();
    if (done[state]) continue;
    done[state] = 1;
    // - the popped cost is the smallest still in play, so nothing left can beat a finished goal
    if (dist[state] >= best) break;
    if ((state >> 2) === goal) best = Math.min(best, dist[state] + ((state & 3) === goalDir ? 0 : BEND_COST));
    const v = state >> 2, dir = state & 3;
    const base = v < g.nbrs.length ? g.nbrs[v] : [];
    const here = at(v);
    for (const w of [...base, ...(extra.get(v) ?? [])]) {
      const there = at(w);
      const step = dirBetween(here, there);
      const cost = dist[state] + Math.abs(there[0] - here[0]) + Math.abs(there[1] - here[1]) + (step === dir ? 0 : BEND_COST);
      const next = w * 4 + step;
      if (cost < dist[next]) { dist[next] = cost; prev[next] = state; heap.push(cost, next); }
    }
  }

  let bestState = -1, bestCost = Infinity;
  for (let d = 0; d < 4; d++) {
    const total = dist[goal * 4 + d] + (d === goalDir ? 0 : BEND_COST);
    if (total < bestCost) { bestCost = total; bestState = goal * 4 + d; }
  }
  if (bestState < 0 || !Number.isFinite(bestCost)) return null;

  const path: number[] = [];
  for (let s = bestState; s >= 0; s = prev[s]) path.unshift(s >> 2);
  return path;
}

const lineBelow = (vals: number[], v: number) => { let i = -1; while (i + 1 < vals.length && vals[i + 1] < v) i++; return i; };
const lineAbove = (vals: number[], v: number) => { let i = vals.length; while (i - 1 >= 0 && vals[i - 1] > v) i--; return i < vals.length ? i : -1; };

/** Where a route starts and stops being a grid run: one step out of the node, on the nearest line. */
interface EndPoint { at: Point; vertical: boolean }

function endPointOf(g: GapGraph, end: BorderEnd): EndPoint | null {
  const vertical = isHorizontal(end.side);
  const vals = vertical ? g.xs : g.ys;
  const v = vertical ? end.at[0] : end.at[1];
  const line = end.side === 'right' || end.side === 'bottom' ? lineAbove(vals, v) : lineBelow(vals, v);
  if (line < 0) return null;
  return { at: vertical ? [vals[line], end.at[1]] : [end.at[0], vals[line]], vertical };
}

/** Sorted union of `base` and `vals`; `from[i]` is the index in `base`, or -1 for an added line. */
function mergeLines(base: number[], vals: number[]): { all: number[]; from: number[] } {
  const all = [...new Set([...base, ...vals])].sort((a, b) => a - b);
  const index = new Map(base.map((v, i) => [v, i] as const));
  return { all, from: all.map(v => index.get(v) ?? -1) };
}

const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Waypoints of one edge: the exit point, the two end points with the grid run between them, the
 * entry point. The end points are kept even when they fall on a straight stretch — the lanes are
 * measured between them. Returns null when the gap grid does not connect the two.
 */
function routeOne(nodes: RouteNode[], g: GapGraph, source: BorderEnd, target: BorderEnd): Point[] | null {
  const src = endPointOf(g, source), tgt = endPointOf(g, target);
  if (!src || !tgt) return null;
  if (src.at[0] === tgt.at[0] && src.at[1] === tgt.at[1]) return [source.at, src.at, target.at];

  const ny = g.ys.length;
  const size = g.nbrs.length;
  // - the section's lines plus this edge's own two: the row a left or right end point stands on, the
  //   column a top or bottom one stands on. Both end points are then crossings, each of them reaching
  //   every line of the section in one run, so an offset of less than a row costs two corners, not
  //   four. Only this edge searches on them; the section's own grid is untouched.
  const cols = mergeLines(g.xs, [src, tgt].filter(p => !p.vertical).map(p => p.at[0]));
  const rows = mergeLines(g.ys, [src, tgt].filter(p => p.vertical).map(p => p.at[1]));
  const xs = cols.all, ys = rows.all, nyAll = ys.length;

  // - the crossings on the added lines, numbered from `size` up; their links live in `extra`
  const added: Point[] = [];
  const ids = new Map<number, number>();
  const extra = new Map<number, number[]>();
  const join = (a: number, b: number) => {
    for (const [from, to] of [[a, b], [b, a]]) {
      const list = extra.get(from);
      if (list) list.push(to); else extra.set(from, [to]);
    }
  };
  const idAt = (i: number, j: number): number => {
    const xi = cols.from[i], yi = rows.from[j];
    if (xi >= 0 && yi >= 0) return xi * ny + yi;
    const key = i * nyAll + j;
    const have = ids.get(key);
    if (have !== undefined) return have;
    added.push([xs[i], ys[j]]);
    ids.set(key, size + added.length - 1);
    return size + added.length - 1;
  };
  const pointAt = (i: number): Point =>
    i < size ? [g.xs[Math.floor(i / ny)], g.ys[i % ny]] : added[i - size];
  const open = (i: number, j: number) => clearSeg(nodes, xs[i], ys[j], xs[i], ys[j]);

  // - ties one crossing of an added line to its neighbour along both lines through it. A step back is
  //   taken only onto the section's own grid, since a crossing on an added line steps forward itself.
  const tie = (i: number, j: number) => {
    if (!open(i, j)) return;
    const here = idAt(i, j);
    for (const [di, dj] of STEPS) {
      const a = i + di, b = j + dj;
      if (a < 0 || a >= xs.length || b < 0 || b >= nyAll) continue;
      if ((di < 0 || dj < 0) && (cols.from[a] < 0 || rows.from[b] < 0)) continue;
      if (!open(a, b) || !clearSeg(nodes, xs[i], ys[j], xs[a], ys[b])) continue;
      join(here, idAt(a, b));
    }
  };
  for (let j = 0; j < nyAll; j++) if (rows.from[j] < 0) for (let i = 0; i < xs.length; i++) tie(i, j);
  for (let i = 0; i < xs.length; i++) if (cols.from[i] < 0)
    for (let j = 0; j < nyAll; j++) if (rows.from[j] >= 0) tie(i, j);

  const xAt = new Map(xs.map((v, i) => [v, i] as const));
  const yAt = new Map(ys.map((v, j) => [v, j] as const));
  const vertexOf = (p: Point): number | null => {
    const i = xAt.get(p[0]), j = yAt.get(p[1]);
    return i === undefined || j === undefined || !open(i, j) ? null : idAt(i, j);
  };
  const from = vertexOf(src.at), to = vertexOf(tgt.at);
  if (from === null || to === null) return null;

  // - the route meets the entry segment head on, so the goal direction is the target side reversed
  const path = shortestPath(g, extra, pointAt, size + added.length, from, OUT_DIR[source.side], to, OUT_DIR[target.side] ^ 1);
  if (!path) return null;
  return [source.at, ...simplify(path.map(pointAt)), target.at];
}

/**
 * Where a route first turns once it has left the border of one of its ends, as a sort key for that
 * border's slots: a route turning towards slot 0 sorts first, a straight one in the middle, one
 * turning the other way last, and within each side the sooner a route turns, the nearer the end of
 * the border it goes. So a route that turns does not cross the routes that run on past its turn.
 */
function turnOrder(pts: Point[], atSource: boolean, side: Side): number {
  const seq = atSource ? pts : [...pts].reverse();
  const out = OUT_DIR[side];
  for (let k = 0; k + 1 < seq.length; k++) {
    if (seq[k][0] === seq[k + 1][0] && seq[k][1] === seq[k + 1][1]) continue;
    const dir = dirBetween(seq[k], seq[k + 1]);
    if (dir === out) continue;
    // - direction codes 1 and 3 run towards slot 0 on both axes
    const dist = Math.abs(seq[k][0] - seq[0][0]) + Math.abs(seq[k][1] - seq[0][1]);
    return (dir === 1 || dir === 3 ? -1 : 1) / (1 + dist);
  }
  return 0;
}

/** Drops repeated points and the middle of any three points on one line. */
function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  for (let i = 1; i < out.length - 1;) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1); else i++;
  }
  return out;
}

interface Span { a: number; b: number }

/**
 * Puts the runs that would be drawn over each other into separate lanes. A route is a chain of
 * straight runs, each one held at a fixed coordinate and reaching from the coordinate of the run
 * before it to the coordinate of the run after it — so moving one run into a lane also moves the
 * corners of its two neighbours. A run takes the first lane that leaves its own stretch and both
 * neighbours' stretches untouched, or else the lane that shares the least. Stretches are booked
 * against the coordinate a run ends up on, not the line it came from, so two lines shifting towards
 * each other are seen as well. The two steps between a border and its end point never move: two
 * edges crossing one gap therefore still share part of one step, which is what `crowded` counts.
 * A run that lies in line with such a step has no corner there to slide, so it leaves its line and
 * comes back to it in right-angle jogs (see `jogAt`); every segment stays horizontal or vertical.
 */
function laneShift(nodes: RouteNode[], paths: Map<string, Point[]>, order: string[], g: GapGraph, report: RouteReport): void {
  const onX = new Set(g.xs), onY = new Set(g.ys);
  const taken = new Map<string, Span[]>();
  const key = (vertical: boolean, coord: number) => `${vertical ? 'v' : 'h'}${coord}`;
  // - how much of `s` is already drawn on: 0 means the lane is free there
  const over = (k: string, s: Span) => (taken.get(k) ?? []).reduce((sum, t) => sum + Math.max(0, Math.min(s.b, t.b) - Math.max(s.a, t.a)), 0);
  // - whether anything is drawn on `s`, its two ends included: a corner on another route's line reads
  //   as a branch of that route
  const hits = (k: string, s: Span) => (taken.get(k) ?? []).some(t => t.a <= s.b && t.b >= s.a);
  const book = (k: string, s: Span) => { const l = taken.get(k); if (l) l.push(s); else taken.set(k, [s]); };
  const span = (u: number, w: number): Span => ({ a: Math.min(u, w), b: Math.max(u, w) });

  for (const id of order) {
    const pts = paths.get(id);
    if (!pts || pts.length < 3) continue;
    const runs = pts.length - 1;
    const vertical: boolean[] = [], coord: number[] = [], movable: boolean[] = [];
    for (let i = 0; i < runs; i++) {
      const v = pts[i][0] === pts[i + 1][0];
      const c = v ? pts[i][0] : pts[i][1];
      vertical.push(v);
      coord.push(c);
      // - a run off the lines is the straight shot between two facing borders, which the spread exit
      //   points already keep apart; the first and last run hold the slot their border gave them
      movable.push(i > 0 && i < runs - 1 && (v ? onX : onY).has(c));
    }
    // - a run reaches as far as the fixed coordinate of the perpendicular run beside it, which is why
    //   a lane moves its neighbours' corners. Beside a parallel run — the step to a border end point
    //   can be one — that coordinate is on the other axis, so there the shared point is the end.
    const along = (p: Point, i: number) => vertical[i] ? p[1] : p[0];
    // - where a run moved off its line jogs away from, or back to, a parallel run beside it
    const jogFrom: (number | undefined)[] = [], jogTo: (number | undefined)[] = [];
    // - `reach` is only padded while the run after this one is still waiting for its lane
    const stretch = (i: number, pad: boolean): Span => {
      const from = jogFrom[i] ?? (i === 0 || vertical[i - 1] === vertical[i] ? along(pts[i], i) : coord[i - 1]);
      const reach = jogTo[i] ?? (i === runs - 1 || vertical[i + 1] === vertical[i] ? along(pts[i + 1], i) : coord[i + 1]);
      const to = pad ? reach + (reach >= from ? LANE_SPREAD : -LANE_SPREAD) : reach;
      return { a: Math.min(from, to), b: Math.max(from, to) };
    };
    const clearOf = (i: number) => {
      const s = stretch(i, false);
      return vertical[i] ? clearSeg(nodes, coord[i], s.a, coord[i], s.b) : clearSeg(nodes, s.a, coord[i], s.b, coord[i]);
    };
    // - run i, moved from `line` to `lane`, in line with the step at its start (or its end): where it
    //   jogs, on a line of the other axis, and how much the jog draws over. It keeps to its own line
    //   as far as nothing else is drawn there, so it jogs at the last such line before the stretch
    //   that made it move; the end point itself counts as a line. A `clean` jog, and the part left on
    //   the line, touch no other route, not even at one point. Null when no jog is clear of nodes.
    const jogAt = (i: number, line: number, lane: number, atEnd: boolean, clean: boolean): { at: number; cost: number } | null => {
      const v = vertical[i];
      const start = along(pts[atEnd ? i + 1 : i], i);
      let far: number;
      if (atEnd) far = jogFrom[i] ?? coord[i - 1];
      else if (vertical[i + 1] === v) far = along(pts[i + 1], i);
      else {
        // - a run after this one still waiting for its lane can slide the far corner this way
        far = coord[i + 1];
        if (i + 1 < runs - 1 && movable[i + 1]) far += far >= start ? -LANE_SPREAD : LANE_SPREAD;
      }
      const dir = Math.sign(far - start);
      if (dir === 0) return null;
      const lines = (v ? g.ys : g.xs).filter(c => (c - start) * dir > 0 && (far - c) * dir > 0);
      if (dir < 0) lines.reverse();
      let best: { at: number; cost: number } | null = null;
      for (const c of [start, ...lines]) {
        const kept = span(start, c), across = span(line, lane);
        if (clean ? hits(key(v, line), kept) : over(key(v, line), kept) > 0) break;
        if (!(v ? clearSeg(nodes, line, c, lane, c) : clearSeg(nodes, c, line, c, lane))) continue;
        if (clean && hits(key(!v, c), across)) continue;
        const cost = clean ? 0 : over(key(!v, c), across);
        if (!best || cost <= best.cost) best = { at: c, cost };
      }
      return best;
    };

    for (let i = 1; i < runs - 1; i++) {
      if (!movable[i]) continue;
      const line = coord[i], next = i + 1;
      let chosen = line, least = Infinity, leastTouches = false;
      let chosenFrom: number | undefined, chosenTo: number | undefined;
      for (let k = 0; k < LANE_COUNT; k++) {
        coord[i] = line + laneOffset(k);
        jogFrom[i] = jogTo[i] = undefined;
        // - a jog that touches another route is taken only when no lane has a clean one
        let jogs = 0, touches = false;
        const ends: boolean[] = coord[i] === line ? [] :
          [false, true].filter(atEnd => vertical[atEnd ? next : i - 1] === vertical[i]);
        let ok = true;
        for (const atEnd of ends) {
          let s = jogAt(i, line, coord[i], atEnd, true);
          if (!s) { s = jogAt(i, line, coord[i], atEnd, false); touches = true; }
          if (!s) { ok = false; break; }
          if (atEnd) jogTo[i] = s.at; else jogFrom[i] = s.at;
          jogs += s.cost;
        }
        if (!ok) continue;
        // - a lane can push a run inside a node where the gap is under one grid; keep looking
        if (!clearOf(i)) { report.blockedLanes = (report.blockedLanes ?? 0) + 1; continue; }
        // - what this lane would draw over: the run itself, the run before it, whose corner it moves,
        //   and the run after it when that one has no lane of its own to dodge with
        const drawn = jogs +
          over(key(vertical[i], coord[i]), stretch(i, next < runs - 1 && movable[next])) +
          over(key(vertical[i - 1], coord[i - 1]), stretch(i - 1, false)) +
          (movable[next] ? 0 : over(key(vertical[next], coord[next]), stretch(next, next + 1 < runs - 1 && movable[next + 1])));
        if (drawn < least || (drawn === least && leastTouches && !touches)) {
          least = drawn; leastTouches = touches; chosen = coord[i]; chosenFrom = jogFrom[i]; chosenTo = jogTo[i];
        }
        if (drawn === 0 && !touches) break;
      }
      if (least > 0) report.crowded = (report.crowded ?? 0) + 1;
      coord[i] = chosen;
      jogFrom[i] = chosenFrom;
      jogTo[i] = chosenTo;
    }

    // - each corner takes its x from the vertical run and its y from the horizontal one; two parallel
    //   runs on different coordinates meet in a jog
    const moved: Point[] = [pts[0]];
    for (let p = 1; p < runs; p++) {
      const a = p - 1, b = p;
      if (vertical[a] !== vertical[b]) moved.push(vertical[a] ? [coord[a], coord[b]] : [coord[b], coord[a]]);
      else if (coord[a] === coord[b]) moved.push(pts[p]);
      else {
        const c = jogTo[a] ?? jogFrom[b] ?? along(pts[p], a);
        moved.push(vertical[a] ? [coord[a], c] : [c, coord[a]], vertical[a] ? [coord[b], c] : [c, coord[b]]);
      }
    }
    moved.push(pts[runs]);
    const out = simplify(moved);
    for (let p = 1; p < out.length; p++) {
      const v = out[p - 1][0] === out[p][0];
      book(key(v, v ? out[p][0] : out[p][1]), v ? span(out[p - 1][1], out[p][1]) : span(out[p - 1][0], out[p][0]));
    }
    paths.set(id, out);
  }
}

/**
 * Routes every edge of one section in one pass. Edges are handled in id order, so the lanes and the
 * returned array do not depend on the order they arrive in. An edge with no route on the gap grid
 * comes back with `fallback: true` and no points; the caller routes that one the old way.
 */
export function routeSection(nodes: RouteNode[], edges: RouteEdge[], report: RouteReport = {}): RoutedEdge[] {
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  const ordered = [...edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const g = buildGapGraph(nodes);
  let ends = resolveEnds(ordered, byId);
  const paths = new Map<string, Point[]>();

  if (g.capped) report.capped = true;
  else {
    const route = (id: string) => {
      const end = ends.get(id);
      const pts = end?.source && end.target ? routeOne(nodes, g, end.source, end.target) : null;
      if (pts) paths.set(id, pts); else paths.delete(id);
    };
    for (const e of ordered) route(e.id);
    // - the slots again, now ordered by where the routes turn; only an edge whose end point moved is
    //   routed a second time
    const turns = new Map<string, number>();
    for (const [id, pts] of paths) {
      const end = ends.get(id);
      if (!end?.source || !end.target) continue;
      turns.set(`${id}:source`, turnOrder(pts, true, end.source.side));
      turns.set(`${id}:target`, turnOrder(pts, false, end.target.side));
    }
    const first = ends;
    ends = resolveEnds(ordered, byId, turns);
    const same = (a?: BorderEnd, b?: BorderEnd) => a?.at[0] === b?.at[0] && a?.at[1] === b?.at[1];
    for (const e of ordered) {
      const was = first.get(e.id), now = ends.get(e.id);
      if (!same(was?.source, now?.source) || !same(was?.target, now?.target)) route(e.id);
    }
    laneShift(nodes, paths, ordered.map(e => e.id), g, report);
  }

  return ordered.map(e => {
    const end = ends.get(e.id);
    const pts = paths.get(e.id);
    return {
      id: e.id,
      kind: edgeKind(e, byId),
      points: pts ?? [],
      variant: end?.source?.slot ?? 0,
      variantIn: end?.target?.slot ?? 0,
      sourceSide: end?.source?.side,
      targetSide: end?.target?.side,
      fallback: !pts,
    };
  });
}
