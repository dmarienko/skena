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
// - reserved band at the top of every lane: the header lives here and NO node may enter it, which is
//   what keeps a node from ever sitting under the title. One grid, so the header (fixed screen height)
//   fits inside it at any working zoom.
export const LANE_HEADER_BAND = GRID;

/**
 * Push a y coordinate out of its lane's reserved header band. Applied while dragging, when persisting
 * a drag, and during migration, so no node can occupy the strip the header is drawn in.
 */
export function clampOutOfHeaderBand(y: number, lanes: SectionLane[]): number {
  if (lanes.length === 0) return y;
  const sorted = sortLanes(lanes);
  const floor = sorted[laneIndexForY(sorted, y)].y + LANE_HEADER_BAND;
  return y < floor ? floor : y;
}

export interface SectionLane {
  id: string;
  /** - flow y where this lane starts; the only geometry a section stores */
  y: number;
  /** - absent → the header shows the creation datetime instead */
  title?: string;
  createdAt: number;
  /** - true → members are hidden and the lane collapses to its header */
  folded?: boolean;
  /** - index into the shared colour palette; gives each lane its own stripe colour */
  colorIndex?: number;
  /** - tint + kernel pill; wired in a later phase */
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
  /** - min y over members; the lane's own top when empty (what the header anchors to) */
  contentTop: number;
  /** - min x over members; 0 when empty */
  contentLeft: number;
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
  const minX: number[] = sorted.map(() => Infinity);
  const minY: number[] = sorted.map(() => Infinity);
  const maxY: number[] = sorted.map(() => -Infinity);

  for (const n of nodes) {
    const i = laneIndexForY(sorted, n.y);
    members[i].push(n.id);
    if (n.x < minX[i]) minX[i] = n.x;
    if (n.y < minY[i]) minY[i] = n.y;
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
      contentTop: has ? minY[i] : l.y,
      contentLeft: has ? minX[i] : 0,
    };
  });
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
  // - a node already parked in a header band predates the reservation and must be evicted
  const needsEvict = !!existing?.length
    && canvas.nodes.some(n => clampOutOfHeaderBand(n.y, existing) !== n.y);
  if (legacy.length === 0 && !hasMembership && !needsSeed && !needsLift && !needsEvict) return canvas;

  const converted: SectionLane[] = legacy.map((n, i) => {
    const s = n as CanvasNode & { title?: string; createdAt?: number; folded?: boolean };
    const lane: SectionLane = { id: s.id, y: s.y, createdAt: s.createdAt ?? now, colorIndex: i };
    // - 'Section' was the old placeholder; drop it so the header falls back to the datetime
    if (s.title && s.title !== 'Section') lane.title = s.title;
    if (s.folded) lane.folded = true;
    return lane;
  });

  let sections = sortLanes([...(existing ?? []), ...converted]);
  if (sections.length === 0) sections.push({ id: `sec-${now.toString(36)}`, y: 0, createdAt: now, colorIndex: 0 });

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

  // - evict any node already sitting in a header band (old canvases predate the reservation)
  nodes = nodes.map(n => {
    const y = clampOutOfHeaderBand(n.y, sections);
    return y === n.y ? n : { ...n, y };
  });

  return { ...canvas, nodes, metadata: { ...canvas.metadata, sections } };
}
