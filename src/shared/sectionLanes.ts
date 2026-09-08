/**
 * Virtual section lanes. A section is one number — the flow y where its lane starts. Lanes partition
 * the canvas vertically: lane i owns [y_i, y_{i+1}), the last owns [y_n, +inf). A node belongs to the
 * lane whose range contains its top edge, so membership is a pure function of position, except that
 * a fold pins its hidden members to their lane (`folded`). Pure; bundled into host and webview.
 */

import { GRID, SECTION_MIN_H, SECTION_FOLDED_H } from './constants';
import type { CanvasData, CanvasNode } from './types';

export { SECTION_MIN_H, SECTION_FOLDED_H };

// - how far a lane extends past its lowest node when nothing bounds it from below
export const LANE_BOTTOM_PAD = GRID;

export interface SectionLane {
  id: string;
  /** - flow y where this lane starts; the only geometry a section stores */
  y: number;
  /** - absent → the rail shows the creation datetime instead */
  title?: string;
  createdAt: number;
  /** - ids of the members hidden by a fold; present (even empty) → folded, range = SECTION_FOLDED_H */
  folded?: string[];
  /** - id of a kernel record or kernel node on this canvas: the section's colour and the fallback kernel of its cells */
  kernelId?: string;
}

/** Minimal node shape the lane maths needs; both CanvasNode and a React Flow node can supply it. */
export interface LaneNodeGeom {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DerivedLane extends SectionLane {
  /** - S1, S2 … by stack order, top to bottom; derived, never stored */
  label: string;
  index: number;
  memberIds: string[];
  top: number;
  bottom: number;
}

/** Lanes ordered top to bottom. Returns a new array; never mutates the input. */
export function sortLanes(lanes: SectionLane[]): SectionLane[] {
  return [...lanes].sort((a, b) => a.y - b.y);
}

/**
 * Index of the lane owning a flow y: the last lane starting at or above it. A point above the first
 * lane clamps into it, so a node can never be orphaned. Expects lanes already sorted.
 */
export function laneIndexForY(lanes: SectionLane[], y: number): number {
  let idx = 0;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i].y <= y) idx = i;
  }
  return idx;
}

/** node id → index of the lane that pins it (its `folded` list). Expects sorted lanes. */
export function pinnedLaneIndex(sorted: SectionLane[]): Map<string, number> {
  const m = new Map<string, number>();
  sorted.forEach((l, i) => { for (const id of l.folded ?? []) m.set(id, i); });
  return m;
}

/** The lane owning a node: the one that pins it, else the one whose range holds its top edge. */
export function laneIndexForNode(sorted: SectionLane[], node: { id: string; y: number }, pinned: Map<string, number>): number {
  return pinned.get(node.id) ?? laneIndexForY(sorted, node.y);
}

/**
 * Resolve lanes against the live nodes: membership, bounds and labels. Called from a useMemo on the
 * node array, so dragging a node re-derives on the same frame — that is how a lane tracks its content
 * without any stored geometry.
 */
export function deriveLanes(nodes: LaneNodeGeom[], lanes: SectionLane[]): DerivedLane[] {
  if (lanes.length === 0) return [];
  const sorted = sortLanes(lanes);
  const pinned = pinnedLaneIndex(sorted);
  const members: string[][] = sorted.map(() => []);
  const visible: LaneNodeGeom[][] = sorted.map(() => []);
  const maxY: number[] = sorted.map(() => -Infinity);

  for (const n of nodes) {
    const i = laneIndexForNode(sorted, n, pinned);
    members[i].push(n.id);
    // - hidden (pinned) members count for nothing in a lane's content
    if (pinned.has(n.id)) continue;
    visible[i].push(n);
    if (n.y + n.height > maxY[i]) maxY[i] = n.y + n.height;
  }

  return sorted.map((l, i) => {
    const next = sorted[i + 1];
    const has = maxY[i] > -Infinity;
    // - a bounded lane ends where the next begins; a folded last lane ends where a fit would put it;
    //   otherwise the last lane follows its visible content
    const bottom = next ? next.y : l.folded ? l.y + sectionTargetHeight(l, visible[i]) : (has ? maxY[i] : l.y) + LANE_BOTTOM_PAD;
    return { ...l, label: `S${i + 1}`, index: i, memberIds: members[i], top: l.y, bottom };
  });
}

export interface LaneGrowth {
  /** - lane id → how far it moves, flow units; may be negative */
  laneShifts: Record<string, number>;
  /** - node id → how far it moves, flow units; may be negative */
  nodeShifts: Record<string, number>;
}

/** Bottom edge of a lane's visible content (its top when nothing visible is in it). */
function visibleContentBottom(l: SectionLane, members: LaneNodeGeom[]): number {
  let bottom = l.y;
  for (const n of members) if (n.y + n.height > bottom) bottom = n.y + n.height;
  return bottom;
}

/**
 * A folded lane wants one grid, or its visible content when something visible sits in it; an
 * unfolded lane wants its content plus a gap, never under the minimum. `members` are the lane's
 * visible (non-pinned) nodes.
 */
export function sectionTargetHeight(l: SectionLane, members: LaneNodeGeom[]): number {
  const content = visibleContentBottom(l, members) + GRID - l.y;
  const raw = Math.max(l.folded ? SECTION_FOLDED_H : SECTION_MIN_H, content);
  return Math.ceil(raw / GRID) * GRID;
}

/**
 * Fit every lane but the last to its content: a lane taller than its target shrinks, a shorter one
 * grows; the difference moves every lane below and that lane's members (pinned members travel with
 * their lane). Pure; the caller applies the shifts. Idempotent after one application.
 * `own` maps node id → lane index for nodes that belong to that lane even where their y says
 * otherwise, but that are still visible and still count for its content: used while a fold is
 * released, so the lane grows back before the lane below can adopt them.
 *
 * The first lane is also parked at the origin. It owns everything above it anyway, so a first lane
 * at y > 0 only leaves a strip of canvas no section can hold and starts the rail below the top. The
 * park moves the lane record alone — its members keep their positions, and its target height is
 * measured from y = 0.
 */
export function fitLanes(lanes: SectionLane[], nodes: LaneNodeGeom[], own?: Map<string, number>): LaneGrowth {
  const empty: LaneGrowth = { laneShifts: {}, nodeShifts: {} };
  const sorted = sortLanes(lanes);
  if (sorted.length === 0) return empty;
  const park = sorted[0].y !== 0 ? -sorted[0].y : 0;
  if (sorted.length < 2) return park ? { laneShifts: { [sorted[0].id]: park }, nodeShifts: {} } : empty;
  const hidden = pinnedLaneIndex(sorted);
  const owner  = new Map([...hidden, ...(own ?? [])]);
  const visible: LaneNodeGeom[][] = sorted.map(() => []);
  const laneOf = new Map<string, number>();
  for (const n of nodes) {
    const i = laneIndexForNode(sorted, n, owner);
    laneOf.set(n.id, i);
    if (!hidden.has(n.id)) visible[i].push(n);
  }

  // - the shifts of the lanes BELOW the first: these are the ones that carry their members with
  //   them. The park is added afterwards so lane 0's members are never moved by it.
  const belowShifts: Record<string, number> = {};
  let acc = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const l = i === 0 ? { ...sorted[0], y: 0 } : sorted[i];
    const range = sorted[i + 1].y - l.y;
    acc += sectionTargetHeight(l, visible[i]) - range;
    if (acc !== 0) belowShifts[sorted[i + 1].id] = acc;
  }
  if (park === 0 && Object.keys(belowShifts).length === 0) return empty;

  const nodeShifts: Record<string, number> = {};
  for (const n of nodes) {
    const s = belowShifts[sorted[laneOf.get(n.id) as number].id];   // - filled from the same array above
    if (s) nodeShifts[n.id] = s;
  }
  return { laneShifts: park ? { [sorted[0].id]: park, ...belowShifts } : belowShifts, nodeShifts };
}

/**
 * Release a fold in one step: the lane's range grows to its members while they still belong to it,
 * so no member is adopted by the lane below. Returns the shifts to apply and the lanes with the key
 * removed. Same lanes reference and empty shifts when the lane is not folded.
 */
export function unfoldLane(lanes: SectionLane[], nodes: LaneNodeGeom[], id: string): LaneGrowth & { lanes: SectionLane[] } {
  const sorted = sortLanes(lanes);
  const i = sorted.findIndex(l => l.id === id);
  if (i < 0 || !sorted[i].folded) return { laneShifts: {}, nodeShifts: {}, lanes };
  const own = new Map((sorted[i].folded as string[]).map(m => [m, i] as [string, number]));
  const released = sorted.map((l, k) => { if (k !== i) return l; const { folded: _open, ...rest } = l; return rest; });
  const f = fitLanes(released, nodes, own);
  return { ...f, lanes: released.map(l => (f.laneShifts[l.id] ? { ...l, y: l.y + f.laneShifts[l.id] } : l)) };
}

/**
 * Apply `fitLanes` to a canvas, and seed the first section when the canvas has content but no
 * section at all — so `canvas_add_node` on an empty canvas leaves a section behind, the same way the
 * webview's own add path does. Same reference when nothing moves (no spurious save).
 */
export function applyLaneFit(canvas: CanvasData, now: number): CanvasData {
  const lanes = canvas.metadata?.sections ?? [];
  if (lanes.length === 0) {
    if (canvas.nodes.length === 0) return canvas;
    return { ...canvas, metadata: { ...canvas.metadata, sections: [{ id: `sec-${now.toString(36)}`, y: 0, createdAt: now }] } };
  }
  const f = fitLanes(lanes, canvas.nodes);
  if (Object.keys(f.laneShifts).length === 0) return canvas;
  return {
    ...canvas,
    nodes: canvas.nodes.map(n => (f.nodeShifts[n.id] ? { ...n, y: n.y + f.nodeShifts[n.id] } : n)),
    metadata: { ...canvas.metadata, sections: sortLanes(lanes).map(l => (f.laneShifts[l.id] ? { ...l, y: l.y + f.laneShifts[l.id] } : l)) },
  };
}

/**
 * Drop removed node ids from every lane's fold list, so a deleted node cannot keep a lane pinned to
 * an id that no longer exists. Same reference when no list changed (no spurious save).
 */
export function pruneFoldedIds(lanes: SectionLane[], removed: Set<string>): SectionLane[] {
  let changed = false;
  const next = lanes.map(l => {
    if (!l.folded) return l;
    const kept = l.folded.filter(id => !removed.has(id));
    if (kept.length === l.folded.length) return l;
    changed = true;
    return { ...l, folded: kept };
  });
  return changed ? next : lanes;
}

/** A section by its printed label (S1… in stack order, case-insensitive) or its id. */
export function sectionByRef(lanes: SectionLane[], ref: string): SectionLane | null {
  const sorted = sortLanes(lanes);
  const m = /^s(\d+)$/i.exec(ref.trim());
  if (m) return sorted[Number(m[1]) - 1] ?? null;
  return sorted.find(l => l.id === ref) ?? null;
}

/**
 * Insert a lane starting at `y` (snapped to the grid): the lane it lands in is split, nodes stay where
 * they are and membership follows `y`. Same reference when a lane already starts there or `y` is above
 * the origin.
 */
export function insertLaneAt(lanes: SectionLane[], y: number, now: number, id = `sec-${now.toString(36)}`): SectionLane[] {
  const at = Math.round(y / GRID) * GRID;
  if (at < 0 || lanes.some(l => l.y === at)) return lanes;
  return sortLanes([...lanes, { id, y: at, createdAt: now }]);
}

/** Fold a section: pin its visible members. Same reference when it is already folded or unknown. */
export function foldLane(lanes: SectionLane[], nodes: LaneNodeGeom[], id: string): SectionLane[] {
  const target = deriveLanes(nodes, lanes).find(l => l.id === id);
  if (!target || target.folded) return lanes;
  return lanes.map(l => (l.id === id ? { ...l, folded: target.memberIds } : l));
}

/** A run's output cell for a pinned (folded) code cell is pinned to the same lane. Same reference otherwise. */
export function pinOutputToLane(lanes: SectionLane[], codeId: string, outId: string): SectionLane[] {
  const i = lanes.findIndex(l => l.folded?.includes(codeId));
  if (i < 0 || lanes[i].folded?.includes(outId)) return lanes;
  return lanes.map((l, k) => (k === i ? { ...l, folded: [...(l.folded ?? []), outId] } : l));
}

/** Top of the lane owning a node (pinned membership wins over its `y`); -Infinity without lanes. */
export function laneTopForNode(lanes: SectionLane[], node: { id: string; y: number }): number {
  if (lanes.length === 0) return -Infinity;
  const sorted = sortLanes(lanes);
  const pinned = pinnedLaneIndex(sorted);
  return sorted[laneIndexForNode(sorted, node, pinned)].y;
}

/**
 * Where a run's output cell goes: to the right of its code cell, vertically centred on it, but never
 * above the code cell's section top — that would make the output a member of the section above (a
 * pinned code cell's output floors to that same pinned lane instead).
 * `gap` = horizontal distance from the code cell; runs use 140, a manual pin 60.
 */
export function outputCellGeom(lanes: SectionLane[], cell: { id: string; x: number; y: number; width: number; height: number }, gap = 140): { x: number; y: number; width: number; height: number } {
  const w = 480, h = 320;
  const y = Math.max(laneTopForNode(lanes, cell), Math.round(cell.y + (cell.height - h) / 2));
  return { x: Math.round(cell.x + cell.width + gap), y, width: w, height: h };
}

/** After a removal, the topmost lane starts at the origin again (a lane owns everything above it anyway). */
export function parkFirstLaneAtOrigin(lanes: SectionLane[]): SectionLane[] {
  const sorted = sortLanes(lanes);
  if (sorted.length === 0 || sorted[0].y === 0) return lanes;
  return sorted.map((l, i) => (i === 0 ? { ...l, y: 0 } : l));
}

/**
 * Ids of the code cells in one section, in run order: top to bottom, then left to right. Empty when
 * the section id is unknown or the section holds no code cell.
 */
export function memberCodeCellsInRunOrder(
  nodes: (LaneNodeGeom & { type: string })[], lanes: SectionLane[], sectionId: string,
): string[] {
  const lane = deriveLanes(nodes, lanes).find(l => l.id === sectionId);
  if (!lane) return [];
  const members = new Set(lane.memberIds);
  return nodes
    .filter(n => n.type === 'code' && members.has(n.id))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(n => n.id);
}

/**
 * One-time conversion from the stored-section-node model to lanes. Legacy `type: 'section'` nodes
 * become lane records keyed on their y; the nodes themselves and every `sectionId` are dropped. A
 * canvas with content but no sections gets a single lane at the origin. Returns the same reference
 * when there is nothing to do, so a migrated canvas never triggers a spurious save.
 */
export function migrateSections(canvas: CanvasData, now: number): CanvasData {
  const legacy = canvas.nodes.filter(n => (n as { type?: string }).type === 'section');
  const hasMembership = canvas.nodes.some(n => (n as { sectionId?: string }).sectionId !== undefined);
  const existing = canvas.metadata?.sections;
  const needsSeed = !existing?.length && legacy.length === 0 && canvas.nodes.length > 0;
  // - a lane above the origin makes the strip between it and y=0 unusable: nodes are floored at 0, so
  //   that band can never be dragged into. Legacy section nodes sat one lane above their
  //   content, so migrated lanes land negative. Detect it here and shift everything back down.
  const minLaneY = existing?.length ? Math.min(...existing.map(l => l.y)) : 0;
  const needsLift = minLaneY < 0;
  const hasColor = !!existing?.some(l => (l as { colorIndex?: number }).colorIndex !== undefined);   // - pre-rail canvases stored a stripe colour
  const hasLegacyFold = !!existing?.some(l => (l as { folded?: unknown }).folded === true);   // - folded was a boolean before the collapsing fold
  if (legacy.length === 0 && !hasMembership && !needsSeed && !needsLift && !hasColor && !hasLegacyFold) return canvas;

  const converted: SectionLane[] = legacy.map(n => {
    const s = n as CanvasNode & { title?: string; createdAt?: number; folded?: boolean };
    const lane: SectionLane = { id: s.id, y: s.y, createdAt: s.createdAt ?? now };
    // - 'Section' was the old placeholder; drop it so the rail falls back to the datetime
    if (s.title && s.title !== 'Section') lane.title = s.title;
    if (s.folded) lane.folded = [];   // - members unknown at this point; an empty list is a folded, empty range
    return lane;
  });

  const sortedExisting = sortLanes(existing ?? []);
  const stripped = sortedExisting.map((l, i) => {
    const { colorIndex: _drop, ...rest } = l as SectionLane & { colorIndex?: number };
    if ((rest as { folded?: unknown }).folded === true) {
      // - legacy boolean fold: pin the members it covers by y, this once. Legacy section nodes are
      //   dropped below, so they must not end up in a fold list.
      const memberIds = canvas.nodes
        .filter(n => (n as { type?: string }).type !== 'section' && laneIndexForY(sortedExisting, n.y) === i)
        .map(n => n.id);
      return { ...rest, folded: memberIds } as SectionLane;
    }
    return rest as SectionLane;
  });
  let sections = sortLanes([...stripped, ...converted]);
  if (sections.length === 0) sections.push({ id: `sec-${now.toString(36)}`, y: 0, createdAt: now });

  let nodes = canvas.nodes
    .filter(n => (n as { type?: string }).type !== 'section')
    .map(n => {
      if ((n as { sectionId?: string }).sectionId === undefined) return n;
      const { sectionId: _drop, ...rest } = n as CanvasNode & { sectionId?: string };
      return rest as CanvasNode;
    });

  // - park the topmost lane at the origin, carrying the nodes with it, so no lane sits in the
  //   unusable negative band and the first lane starts flush at the top of the canvas
  const lift = sections[0].y < 0 ? -sections[0].y : 0;
  if (lift > 0) {
    sections = sections.map(l => ({ ...l, y: l.y + lift }));
    nodes = nodes.map(n => ({ ...n, y: n.y + lift }));
  }

  return { ...canvas, nodes, metadata: { ...canvas.metadata, sections } };
}
