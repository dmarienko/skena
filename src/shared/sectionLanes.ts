/**
 * Virtual section lanes. A section is one number — the flow y where its lane starts. Lanes partition
 * the canvas vertically: lane i owns [y_i, y_{i+1}), the last owns [y_n, +inf). A node belongs to the
 * lane whose range contains its top edge, so membership and geometry are pure functions of position
 * and never need to be stored, migrated or kept in sync. Pure; bundled into host and webview.
 */

import { GRID } from './constants';
import type { CanvasData, CanvasNode } from './types';

// - how far a lane extends past its lowest node when nothing bounds it from below
export const LANE_BOTTOM_PAD = GRID;

export interface SectionLane {
  id: string;
  /** - flow y where this lane starts; the only geometry a section stores */
  y: number;
  /** - absent → the header shows the creation datetime instead */
  title?: string;
  createdAt: number;
  /** - true → members are hidden and the lane collapses to its header */
  folded?: boolean;
  /** - id of a kernel node on this canvas: the section's colour and the fallback kernel of its cells */
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

/**
 * Resolve lanes against the live nodes: membership, bounds and labels. Called from a useMemo on the
 * node array, so dragging a node re-derives on the same frame — that is how a lane tracks its content
 * without any stored geometry.
 */
export function deriveLanes(nodes: LaneNodeGeom[], lanes: SectionLane[]): DerivedLane[] {
  if (lanes.length === 0) return [];
  const sorted = sortLanes(lanes);
  const members: string[][] = sorted.map(() => []);
  const maxY: number[] = sorted.map(() => -Infinity);

  for (const n of nodes) {
    const i = laneIndexForY(sorted, n.y);
    members[i].push(n.id);
    if (n.y + n.height > maxY[i]) maxY[i] = n.y + n.height;
  }

  return sorted.map((l, i) => {
    const next = sorted[i + 1];
    const has = members[i].length > 0;
    // - a bounded lane ends where the next begins; the last lane follows its own content
    const bottom = next ? next.y : (has ? maxY[i] : l.y) + LANE_BOTTOM_PAD;
    return {
      ...l,
      label: `S${i + 1}`,
      index: i,
      memberIds: members[i],
      top: l.y,
      bottom,
    };
  });
}

export interface LaneGrowth {
  /** - lane id → how far it moves down, flow units */
  laneShifts: Record<string, number>;
  /** - node id → how far it moves down, flow units */
  nodeShifts: Record<string, number>;
}

/**
 * Downward growth. A changed node whose bottom edge plus one GRID crosses into the next lane pushes
 * that lane and everything below it down by a GRID multiple, so membership (by `y`) is unchanged: the
 * boundary moves, the node does not change section. The last lane is unbounded. Pushes accumulate
 * down the stack. Pure; the caller applies the shifts.
 */
export function growLaneForNodes(lanes: SectionLane[], nodes: LaneNodeGeom[], changedIds: string[]): LaneGrowth {
  const empty: LaneGrowth = { laneShifts: {}, nodeShifts: {} };
  const sorted = sortLanes(lanes);
  if (sorted.length < 2 || changedIds.length === 0) return empty;

  const byId = new Map(nodes.map(n => [n.id, n]));
  const need: number[] = sorted.map(() => 0);   // - need[i] = push of the boundary below lane i
  for (const id of changedIds) {
    const n = byId.get(id);
    if (!n) continue;
    const i = laneIndexForY(sorted, n.y);
    if (i >= sorted.length - 1) continue;
    const overflow = n.y + n.height + GRID - sorted[i + 1].y;
    if (overflow <= 0) continue;
    const delta = Math.ceil(overflow / GRID) * GRID;
    if (delta > need[i]) need[i] = delta;
  }

  const laneShifts: Record<string, number> = {};
  let acc = 0;
  for (let k = 1; k < sorted.length; k++) {
    acc += need[k - 1];
    if (acc > 0) laneShifts[sorted[k].id] = acc;
  }
  if (acc === 0) return empty;   // - nothing moved; skip the node scan

  const nodeShifts: Record<string, number> = {};
  for (const n of nodes) {
    const s = laneShifts[sorted[laneIndexForY(sorted, n.y)].id];
    if (s) nodeShifts[n.id] = s;
  }
  return { laneShifts, nodeShifts };
}

/** Apply `growLaneForNodes` to a canvas. Same reference when nothing moves (no spurious save). */
export function applyLaneGrowth(canvas: CanvasData, changedIds: string[]): CanvasData {
  const lanes = canvas.metadata?.sections ?? [];
  const g = growLaneForNodes(lanes, canvas.nodes, changedIds);
  if (Object.keys(g.laneShifts).length === 0) return canvas;
  return {
    ...canvas,
    nodes: canvas.nodes.map(n => (g.nodeShifts[n.id] ? { ...n, y: n.y + g.nodeShifts[n.id] } : n)),
    metadata: {
      ...canvas.metadata,
      sections: sortLanes(lanes).map(l => (g.laneShifts[l.id] ? { ...l, y: l.y + g.laneShifts[l.id] } : l)),
    },
  };
}

/** Top of the lane owning flow y; -Infinity when the canvas has no lanes (nothing to clamp to). */
export function laneTopForY(lanes: SectionLane[], y: number): number {
  if (lanes.length === 0) return -Infinity;
  const sorted = sortLanes(lanes);
  return sorted[laneIndexForY(sorted, y)].y;
}

/**
 * Where a run's output cell goes: to the right of its code cell, vertically centred on it, but never
 * above the code cell's section top — that would make the output a member of the section above.
 */
export function outputCellGeom(lanes: SectionLane[], cell: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const w = 480, h = 320, gap = 140;
  const y = Math.max(laneTopForY(lanes, cell.y), Math.round(cell.y + (cell.height - h) / 2));
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
  //   that band can never be dragged into. Legacy section nodes sat one header-lane above their
  //   content, so migrated lanes land negative. Detect it here and shift everything back down.
  const minLaneY = existing?.length ? Math.min(...existing.map(l => l.y)) : 0;
  const needsLift = minLaneY < 0;
  const hasColor = !!existing?.some(l => (l as { colorIndex?: number }).colorIndex !== undefined);   // - pre-rail canvases stored a stripe colour
  if (legacy.length === 0 && !hasMembership && !needsSeed && !needsLift && !hasColor) return canvas;

  const converted: SectionLane[] = legacy.map(n => {
    const s = n as CanvasNode & { title?: string; createdAt?: number; folded?: boolean };
    const lane: SectionLane = { id: s.id, y: s.y, createdAt: s.createdAt ?? now };
    // - 'Section' was the old placeholder; drop it so the header falls back to the datetime
    if (s.title && s.title !== 'Section') lane.title = s.title;
    if (s.folded) lane.folded = true;
    return lane;
  });

  const stripped = (existing ?? []).map(l => {
    const { colorIndex: _drop, ...rest } = l as SectionLane & { colorIndex?: number };
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
  //   unusable negative band and the first lane's header lands flush at the top of the canvas
  const lift = sections[0].y < 0 ? -sections[0].y : 0;
  if (lift > 0) {
    sections = sections.map(l => ({ ...l, y: l.y + lift }));
    nodes = nodes.map(n => ({ ...n, y: n.y + lift }));
  }

  return { ...canvas, nodes, metadata: { ...canvas.metadata, sections } };
}
