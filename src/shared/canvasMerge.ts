/**
 * Three-way merge of two canvases that both started from one base: what changed from `base` to
 * `theirs` is applied to `ours`. Used wherever one side's copy of a canvas has to take in the other
 * side's writes without dropping its own: the editor host when the file changed under it, the
 * webview when a reload arrives while it holds unsaved changes, and the undo history on a reload.
 *
 * Nodes, edges, sections and kernel records are matched by id. An item changed on both sides is
 * merged field by field; where both sides changed the same field, or one side deleted an item the
 * other changed, `theirs` wins. Every other key is one value, merged the same way, except
 * `creationCounter`, which takes the larger of the two.
 */
import type { CanvasData, CanvasEdge, CanvasNode } from './types';
import type { SectionLane } from './sectionLanes';

type Obj = Record<string, unknown>;
type Item = { id: string };

/** - equal as JSON sees it: key order is ignored and a key holding undefined is a missing key */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Obj, bo = b as Obj;
  let na = 0;
  for (const k in ao) {
    if (ao[k] === undefined) continue;
    na++;
    if (!same(ao[k], bo[k])) return false;
  }
  let nb = 0;
  for (const k in bo) if (bo[k] !== undefined) nb++;
  return na === nb;
}

interface Picked<T> { v: T; kept: boolean }

// - one value three ways; `kept` = the result is ours and differs from theirs
function pick<T>(b: T, o: T, t: T): Picked<T> {
  if (same(o, t) || same(o, b)) return { v: t, kept: false };
  if (same(t, b)) return { v: o, kept: true };
  return { v: t, kept: false };
}

// - one item three ways, field by field when both sides changed it; undefined = absent on that side
function mergeItem<T extends Item>(b: T | undefined, o: T | undefined, t: T | undefined): Picked<T | undefined> {
  if (same(o, t) || same(o, b)) return { v: t, kept: false };
  if (same(t, b)) return { v: o, kept: true };
  if (!b || !o || !t) return { v: t, kept: false };
  const bo = b as unknown as Obj, oo = o as unknown as Obj, to = t as unknown as Obj;
  const out: Obj = {};
  let kept = false;
  for (const k of new Set([...Object.keys(to), ...Object.keys(oo)])) {
    const r = pick(bo[k], oo[k], to[k]);
    if (r.v !== undefined) out[k] = r.v;
    kept ||= r.kept;
  }
  return { v: out as unknown as T, kept };
}

const byId = <T extends Item>(xs: T[]): Map<string, T> => new Map(xs.map(x => [x.id, x]));

/** - what theirs changed in a list against the base: id → theirs' item, or undefined where theirs deleted it */
function listDelta<T extends Item>(b: T[], t: T[]): Map<string, T | undefined> {
  const bm = byId(b), tm = byId(t);
  const d = new Map<string, T | undefined>();
  for (const x of t) {
    const bx = bm.get(x.id);
    if (!bx || !same(bx, x)) d.set(x.id, x);
  }
  for (const x of b) if (!tm.has(x.id)) d.set(x.id, undefined);
  return d;
}

// - ours with theirs' changes applied; ours' order, then what only theirs has. `kept` is only worked out when asked.
function applyListDelta<T extends Item>(b: T[], o: T[], d: Map<string, T | undefined>, wantKept: boolean): Picked<T[]> {
  const bm = byId(b);
  const out: T[] = [];
  const seen = new Set<string>();
  let kept = false;
  for (const x of o) {
    seen.add(x.id);
    if (d.has(x.id)) {
      const r = mergeItem(bm.get(x.id), x, d.get(x.id));
      if (r.v) out.push(r.v);
      kept ||= r.kept;
    } else {
      out.push(x);
      if (wantKept && !kept) kept = !same(bm.get(x.id), x);
    }
  }
  for (const [id, tx] of d) {
    if (seen.has(id) || !tx) continue;
    const r = mergeItem(bm.get(id), undefined, tx);
    if (r.v) out.push(r.v);
    kept ||= r.kept;
  }
  // - an item ours deleted that theirs left alone stays deleted, and the result then differs from theirs
  if (wantKept && !kept) for (const x of b) if (!seen.has(x.id) && !d.has(x.id)) { kept = true; break; }
  return { v: out, kept };
}

function mergeList<T extends Item>(b: T[] | undefined, o: T[] | undefined, t: T[] | undefined): Picked<T[] | undefined> {
  if (b === undefined && o === undefined && t === undefined) return { v: undefined, kept: false };
  const r = applyListDelta(b ?? [], o ?? [], listDelta(b ?? [], t ?? []), true);
  // - no list on theirs and nothing in ours either: keep the key absent rather than write an empty list
  return t === undefined && r.v.length === 0 && !r.kept ? { v: undefined, kept: false } : r;
}

const LIST_KEYS = new Set(['sections', 'kernels']);

function mergeMetadata(b: Obj | undefined, o: Obj | undefined, t: Obj | undefined): Picked<Obj | undefined> {
  if (same(o, t) || same(o, b)) return { v: t, kept: false };
  if (same(t, b)) return { v: o, kept: true };
  const out: Obj = {};
  let kept = false;
  for (const k of new Set([...Object.keys(t ?? {}), ...Object.keys(o ?? {})])) {
    const r = LIST_KEYS.has(k)
      ? mergeList(b?.[k] as Item[] | undefined, o?.[k] as Item[] | undefined, t?.[k] as Item[] | undefined)
      : pick(b?.[k], o?.[k], t?.[k]);
    if (r.v !== undefined) out[k] = r.v;
    kept ||= r.kept;
  }
  return { v: out, kept };
}

/**
 * `theirs`' changes since `base` applied to `ours`. `kept` says whether the result differs from
 * `theirs`, that is whether some change of `ours` is in it and still has to reach the other side.
 */
export function merge3(base: CanvasData, ours: CanvasData, theirs: CanvasData): { canvas: CanvasData; kept: boolean } {
  const b = base as unknown as Obj, o = ours as unknown as Obj, t = theirs as unknown as Obj;
  const out: Obj = {};
  let kept = false;
  for (const k of new Set([...Object.keys(t), ...Object.keys(o)])) {
    let r: Picked<unknown>;
    if (k === 'nodes' || k === 'edges') r = mergeList(b[k] as Item[], o[k] as Item[], t[k] as Item[]);
    else if (k === 'metadata') r = mergeMetadata(b[k] as Obj | undefined, o[k] as Obj | undefined, t[k] as Obj | undefined);
    else if (k === 'creationCounter') {
      const ov = typeof o[k] === 'number' ? o[k] as number : -Infinity;
      const tv = typeof t[k] === 'number' ? t[k] as number : -Infinity;
      r = { v: Math.max(ov, tv) === -Infinity ? undefined : Math.max(ov, tv), kept: ov > tv };
    } else r = pick(b[k], o[k], t[k]);
    if (r.v !== undefined) out[k] = r.v;
    kept ||= r.kept;
  }
  out.nodes ??= [];
  out.edges ??= [];
  return { canvas: out as unknown as CanvasData, kept };
}

/** - one undo or redo step: the nodes, edges and sections it restores */
export interface HistoryEntry { nodes: CanvasNode[]; edges: CanvasEdge[]; sections: SectionLane[] }

/**
 * Every history entry with the change from `base` to `theirs` applied, so that undoing a step later
 * restores what the user had before that step and keeps what another writer changed since.
 */
export function rebaseHistory<E extends HistoryEntry>(entries: E[], base: CanvasData, theirs: CanvasData): E[] {
  if (entries.length === 0) return entries;
  const bs = base.metadata?.sections ?? [], ts = theirs.metadata?.sections ?? [];
  const dn = listDelta(base.nodes, theirs.nodes);
  const de = listDelta(base.edges, theirs.edges);
  const ds = listDelta(bs, ts);
  if (dn.size === 0 && de.size === 0 && ds.size === 0) return entries;
  return entries.map(e => ({
    ...e,
    nodes: dn.size ? applyListDelta(base.nodes, e.nodes, dn, false).v : e.nodes,
    edges: de.size ? applyListDelta(base.edges, e.edges, de, false).v : e.edges,
    sections: ds.size ? applyListDelta(bs, e.sections, ds, false).v : e.sections,
  }));
}
