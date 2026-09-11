import { GRID } from './constants';

/**
 * Edge routing for one section (spec 2026-09-11-edges-design.md §1–§2). The layout engine leaves a
 * full grid between columns and between rows, so every edge can run on the centre line of a gap.
 * This module builds that lattice once per section, routes every edge on it with a shortest path
 * that pays for its corners, spreads the edges of one border 10 px apart, and puts parallel runs on
 * the same grid line into 10 px lanes. Pure — no React, no DOM.
 */

export interface RouteNode { id: string; type: string; x: number; y: number; w: number; h: number; outputNodeId?: string }
export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface RouteEdge { id: string; source: string; target: string; sourceSide?: Side; targetSide?: Side }
export type EdgeKind = 'sequence' | 'output' | 'context';
export type Point = [number, number];

export interface RoutedEdge {
  id: string;
  kind: EdgeKind;
  /** - polyline, first = exit point on the source border, last = entry point on the target border */
  points: Point[];
  /** - 0-based index among the edges sharing the source border (colour + exit slot) */
  variant: number;
  /** - true when no gap route was found (caller uses the old router) */
  fallback: boolean;
}

/** - px between parallel edges in one gap, and between exit points on one border */
export const LANE_STEP = 10;
/** - a corner costs one grid of length */
export const BEND_COST = GRID;

const HALF = GRID / 2;
// - 9 lanes fit in a 100 px gap
const LANE_COUNT = 9;

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

/**
 * The gap lattice of a section: one line half a grid outside every node border. `free` says a
 * crossing is usable, `clearH` / `clearV` say a run between two crossings on one line is.
 */
export interface GapGraph {
  xs: number[];
  ys: number[];
  free: (xi: number, yi: number) => boolean;
  clearH: (yi: number, xa: number, xb: number) => boolean;
  clearV: (xi: number, ya: number, yb: number) => boolean;
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
  return {
    xs, ys,
    free:   (xi, yi)     => clearSeg(nodes, xs[xi], ys[yi], xs[xi], ys[yi]),
    clearH: (yi, xa, xb) => clearSeg(nodes, xs[xa], ys[yi], xs[xb], ys[yi]),
    clearV: (xi, ya, yb) => clearSeg(nodes, xs[xi], ys[ya], xs[xi], ys[yb]),
  };
}

/** Side of `from` that faces `to` — the default when the canvas edge names no handle. */
function facingSide(from: RouteNode, to: RouteNode): Side {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Point on `side` of `n`, `off` px from the middle of that border. */
function borderPoint(n: RouteNode, side: Side, off: number): Point {
  if (side === 'right')  return [n.x + n.w, n.y + n.h / 2 + off];
  if (side === 'left')   return [n.x, n.y + n.h / 2 + off];
  if (side === 'bottom') return [n.x + n.w / 2 + off, n.y + n.h];
  return [n.x + n.w / 2 + off, n.y];
}

const isHorizontal = (side: Side) => side === 'left' || side === 'right';

interface EndPoint { node: RouteNode; side: Side; at: Point; slot: number; off: number; count: number }
interface Attachment { edgeId: string; role: 'source' | 'target'; node: RouteNode; other: RouteNode; side: Side }

/**
 * Resolves both ends of every edge: the side it leaves or enters by, and its point on that border.
 * The edges of one border are ordered by the position of the node at the other end and spread
 * LANE_STEP apart around the border's middle, so no two of them share a point.
 */
function resolveEnds(edges: RouteEdge[], byId: Map<string, RouteNode>): Map<string, { source?: EndPoint; target?: EndPoint }> {
  const borders = new Map<string, Attachment[]>();
  const add = (a: Attachment) => {
    const key = `${a.node.id}:${a.side}`;
    const list = borders.get(key);
    if (list) list.push(a); else borders.set(key, [a]);
  };
  for (const e of edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t || s === t) continue;
    const sSide = e.sourceSide ?? facingSide(s, t);
    const tSide = e.targetSide ?? facingSide(t, s);
    add({ edgeId: e.id, role: 'source', node: s, other: t, side: sSide });
    add({ edgeId: e.id, role: 'target', node: t, other: s, side: tSide });
  }

  const ends = new Map<string, { source?: EndPoint; target?: EndPoint }>();
  for (const list of borders.values()) {
    const across = isHorizontal(list[0].side);
    list.sort((p, q) =>
      (across ? p.other.y - q.other.y : p.other.x - q.other.x) ||
      (across ? p.other.x - q.other.x : p.other.y - q.other.y) ||
      (p.edgeId < q.edgeId ? -1 : p.edgeId > q.edgeId ? 1 : 0));
    list.forEach((a, i) => {
      const off = (i - (list.length - 1) / 2) * LANE_STEP;
      const end: EndPoint = { node: a.node, side: a.side, at: borderPoint(a.node, a.side, off), slot: i, off, count: list.length };
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

function adopt(end: EndPoint, off: number): void {
  end.off = off;
  end.at = borderPoint(end.node, end.side, off);
}

interface Lattice { ny: number; free: boolean[]; nbrs: number[][] }

function buildLattice(g: GapGraph): Lattice {
  const nx = g.xs.length, ny = g.ys.length;
  const free: boolean[] = [];
  const nbrs: number[][] = [];
  for (let i = 0; i < nx * ny; i++) { free.push(g.free(Math.floor(i / ny), i % ny)); nbrs.push([]); }
  for (let xi = 0; xi < nx; xi++) for (let yi = 0; yi < ny; yi++) {
    const i = xi * ny + yi;
    if (!free[i]) continue;
    const right = (xi + 1) * ny + yi;
    if (xi + 1 < nx && free[right] && g.clearH(yi, xi, xi + 1)) { nbrs[i].push(right); nbrs[right].push(i); }
    const down = i + 1;
    if (yi + 1 < ny && free[down] && g.clearV(xi, yi, yi + 1)) { nbrs[i].push(down); nbrs[down].push(i); }
  }
  return { ny, free, nbrs };
}

// - a small binary heap: Dijkstra runs over 4 states per lattice vertex, far too many to scan
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
 * Shortest orthogonal path from `start` to `goal` over the lattice plus the two port vertices in
 * `extra`. Cost = length + BEND_COST per change of direction, counting the corner where the route
 * leaves the exit segment and the one where it meets the entry segment.
 */
function shortestPath(
  lat: Lattice, extra: Map<number, number[]>, at: (i: number) => Point,
  start: number, startDir: number, goal: number, goalDir: number,
): number[] | null {
  const count = lat.nbrs.length + 2;
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
    const base = v < lat.nbrs.length ? lat.nbrs[v] : [];
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

interface Port { at: Point; vertical: boolean; line: number }

/** The point one step out of the node: the nearest grid line in the direction the border faces. */
function portOf(g: GapGraph, end: EndPoint): Port | null {
  const vertical = isHorizontal(end.side);
  const vals = vertical ? g.xs : g.ys;
  const v = vertical ? end.at[0] : end.at[1];
  const line = end.side === 'right' || end.side === 'bottom' ? lineAbove(vals, v) : lineBelow(vals, v);
  if (line < 0) return null;
  return { at: vertical ? [vals[line], end.at[1]] : [end.at[0], vals[line]], vertical, line };
}

/**
 * Waypoints of one edge: the exit point, the grid run between the two ports, the entry point.
 * Returns null when the gap lattice does not connect the two.
 */
function routeOne(nodes: RouteNode[], g: GapGraph, lat: Lattice, source: EndPoint, target: EndPoint): Point[] | null {
  const src = portOf(g, source), tgt = portOf(g, target);
  if (!src || !tgt) return null;
  if (src.at[0] === tgt.at[0] && src.at[1] === tgt.at[1]) return simplify([source.at, src.at, target.at]);

  const size = lat.nbrs.length;
  const extra = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    for (const [from, to] of [[a, b], [b, a]]) {
      const list = extra.get(from);
      if (list) list.push(to); else extra.set(from, [to]);
    }
  };
  // - a port that lands exactly on a crossing is that crossing; otherwise it is an extra vertex tied
  //   to the two crossings it sits between on its own line
  const attach = (p: Port, spare: number): number => {
    const cross = p.vertical ? g.ys.indexOf(p.at[1]) : g.xs.indexOf(p.at[0]);
    if (cross >= 0) {
      const idx = p.vertical ? p.line * lat.ny + cross : cross * lat.ny + p.line;
      if (lat.free[idx]) return idx;
    }
    const vals = p.vertical ? g.ys : g.xs;
    const along = p.vertical ? p.at[1] : p.at[0];
    for (const k of [lineBelow(vals, along), lineAbove(vals, along)]) {
      if (k < 0) continue;
      const idx = p.vertical ? p.line * lat.ny + k : k * lat.ny + p.line;
      const to: Point = p.vertical ? [p.at[0], vals[k]] : [vals[k], p.at[1]];
      if (lat.free[idx] && clearSeg(nodes, p.at[0], p.at[1], to[0], to[1])) link(spare, idx);
    }
    return spare;
  };
  const pointAt = (i: number): Point =>
    i === size ? src.at : i === size + 1 ? tgt.at : [g.xs[Math.floor(i / lat.ny)], g.ys[i % lat.ny]];
  const from = attach(src, size);
  const to = attach(tgt, size + 1);
  // - the two ports may face each other on one line: that is the straight edge, no crossing needed
  if ((src.at[0] === tgt.at[0] || src.at[1] === tgt.at[1]) && clearSeg(nodes, src.at[0], src.at[1], tgt.at[0], tgt.at[1])) link(from, to);

  // - the route meets the entry segment head on, so the goal direction is the target side reversed
  const path = shortestPath(lat, extra, pointAt, from, OUT_DIR[source.side], to, OUT_DIR[target.side] ^ 1);
  if (!path) return null;
  return simplify([source.at, ...path.map(pointAt), target.at]);
}

/** Drops repeated points and the middle of three points on one line. */
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
 * Spreads the runs that share a grid line. A run takes the lowest lane whose spans do not overlap
 * its own (touching is free), and lanes fill outwards from the line itself. The exit and entry
 * segments keep the border points they were given.
 */
function laneShift(paths: Map<string, Point[]>, order: string[], g: GapGraph): void {
  const onX = new Set(g.xs), onY = new Set(g.ys);
  const taken = new Map<string, Span[][]>();
  for (const id of order) {
    const pts = paths.get(id);
    if (!pts || pts.length < 4) continue;
    const moved = pts.map(p => [p[0], p[1]] as Point);
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i], b = pts[i + 1];
      const vertical = a[0] === b[0];
      const coord = vertical ? a[0] : a[1];
      // - a run off the grid can only be the straight shot between two facing borders; the spread
      //   exit points already keep those apart, so it needs no lane
      if (!(vertical ? onX : onY).has(coord)) continue;
      const lo = Math.min(vertical ? a[1] : a[0], vertical ? b[1] : b[0]);
      const hi = Math.max(vertical ? a[1] : a[0], vertical ? b[1] : b[0]);
      const key = `${vertical ? 'v' : 'h'}${coord}`;
      const lanes = taken.get(key) ?? [];
      let k = 0;
      while (lanes[k] && lanes[k].some(s => lo < s.b && s.a < hi)) k++;
      if (!lanes[k]) lanes[k] = [];
      lanes[k].push({ a: lo, b: hi });
      taken.set(key, lanes);
      const shifted = coord + laneOffset(k);
      if (vertical) { moved[i][0] = shifted; moved[i + 1][0] = shifted; }
      else          { moved[i][1] = shifted; moved[i + 1][1] = shifted; }
    }
    paths.set(id, simplify(moved));
  }
}

/**
 * Routes every edge of one section in one pass. Edges are handled in id order, so the lanes and the
 * returned array do not depend on the order they arrive in. An edge with no route on the gap
 * lattice comes back with `fallback: true` and no points; the caller routes that one the old way.
 */
export function routeSection(nodes: RouteNode[], edges: RouteEdge[]): RoutedEdge[] {
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  const ordered = [...edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const g = buildGapGraph(nodes);
  const lat = buildLattice(g);
  const ends = resolveEnds(ordered, byId);

  const paths = new Map<string, Point[]>();
  for (const e of ordered) {
    const end = ends.get(e.id);
    if (!end || !end.source || !end.target) continue;
    const pts = routeOne(nodes, g, lat, end.source, end.target);
    if (pts) paths.set(e.id, pts);
  }
  laneShift(paths, ordered.map(e => e.id), g);

  return ordered.map(e => {
    const pts = paths.get(e.id);
    return {
      id: e.id,
      kind: edgeKind(e, byId),
      points: pts ?? [],
      variant: ends.get(e.id)?.source?.slot ?? 0,
      fallback: !pts,
    };
  });
}
