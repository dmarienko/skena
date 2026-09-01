/**
 * Section container helpers. A section is a band node that owns other nodes via their `sectionId`.
 * The band is a full-width horizontal lane: its left edge sits at the origin gutter (extends to the
 * canvas edge, not just the leftmost node), it is tight to the content on top/bottom, and it is open
 * on the right. `wrapNodesInSection` migrates a legacy canvas (free nodes) into sections;
 * `fitSectionsToContent` re-sizes existing sections to their current members on every load, so the
 * band tracks its content and picks up geometry changes. Both run on the host load path, wrapped
 * inside normalizeCanvasToOrigin (so the lane normalizes to the origin in one pass). Pure; bundled
 * into both host and webview. No Node.js APIs.
 */

import type { CanvasData, CanvasNode, SectionNode } from './types';
import { ORIGIN_GUTTER } from './bounds';

// - header overlay height (screen-space; the header is drawn above the band, not inside it)
export const SECTION_HEADER_H = 44;
// - how far the band extends past its content on the open (right) side, so it reads as a lane
export const SECTION_OPEN_RIGHT = 600;

// - deterministic id from the min node so a re-migration of the same content is stable
function sectionIdFor(seedId: string): string {
  return `section-${seedId}`;
}

/**
 * Geometry of the full-width lane enclosing a set of member nodes: left at the origin gutter (but
 * never cropping content that sits left of the gutter), tight top/bottom, open on the right.
 */
function laneGeom(members: CanvasNode[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of members) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  const x = Math.min(ORIGIN_GUTTER, minX);
  return { x, y: minY, width: maxX + SECTION_OPEN_RIGHT - x, height: maxY - minY };
}

/**
 * Wrap every node that lacks a `sectionId` into a single new full-width-lane section. Nodes already
 * assigned to a section are untouched. Returns the same reference when nothing needs wrapping.
 */
export function wrapNodesInSection(canvas: CanvasData): CanvasData {
  const free = canvas.nodes.filter(n => n.type !== 'section' && !n.sectionId);
  if (free.length === 0) return canvas;

  const seed = free.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
  const id = sectionIdFor(seed.id);
  const section: SectionNode = { id, type: 'section', ...laneGeom(free), title: 'Section' };

  const freeIds = new Set(free.map(n => n.id));
  const nodes: CanvasNode[] = [
    section,
    ...canvas.nodes.map(n => (freeIds.has(n.id) ? { ...n, sectionId: id } : n)),
  ];
  return { ...canvas, nodes };
}

/**
 * Re-size each section's band to fit its current members (the full-width lane geometry), so the band
 * tracks content and reflects geometry changes on reload. Sections with no members are left as-is.
 * Returns the same reference when nothing changed (no spurious save).
 */
export function fitSectionsToContent(canvas: CanvasData): CanvasData {
  if (!canvas.nodes.some(n => n.type === 'section')) return canvas;
  let changed = false;
  const nodes = canvas.nodes.map(n => {
    if (n.type !== 'section') return n;
    const members = canvas.nodes.filter(m => m.sectionId === n.id);
    if (members.length === 0) return n;
    const g = laneGeom(members);
    if (n.x === g.x && n.y === g.y && n.width === g.width && n.height === g.height) return n;
    changed = true;
    return { ...n, ...g };
  });
  return changed ? { ...canvas, nodes } : canvas;
}
