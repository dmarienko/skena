/**
 * Section container helpers. A section is a band node that owns other nodes via their `sectionId`.
 * `wrapNodesInSection` migrates a legacy canvas (free nodes, no sections) so every node belongs to
 * a section — runs once on the host load path, before normalizeCanvasToOrigin (wrap first, so the
 * section band normalizes to the origin in one pass). Pure; bundled into both host and webview. No
 * Node.js APIs.
 */

import type { CanvasData, CanvasNode, SectionNode } from './types';

// - header overlay height (screen-space; the header is drawn above the band, not inside it)
export const SECTION_HEADER_H = 44;
// - how far the band extends past its content on the open (right) side, so it reads as a lane
export const SECTION_OPEN_RIGHT = 600;

// - deterministic id from the min node so a re-migration of the same content is stable
function sectionIdFor(seedId: string): string {
  return `section-${seedId}`;
}

/**
 * Wrap every node that lacks a `sectionId` into a single new section sized to their bounding box.
 * The band is tight to the content on the left/top/bottom (no margin strips) and open on the right
 * (extends past the content by SECTION_OPEN_RIGHT), so it reads as a lane, not a box. Nodes already
 * assigned to a section are untouched. Returns the same reference when nothing needs wrapping (empty
 * canvas, or all nodes already sectioned) so it triggers no save.
 */
export function wrapNodesInSection(canvas: CanvasData): CanvasData {
  const free = canvas.nodes.filter(n => n.type !== 'section' && !n.sectionId);
  if (free.length === 0) return canvas;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of free) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  const seed = free.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
  const id = sectionIdFor(seed.id);
  const section: SectionNode = {
    id,
    type: 'section',
    x: minX,
    y: minY,
    width: maxX - minX + SECTION_OPEN_RIGHT,
    height: maxY - minY,
    title: 'Section',
  };

  const freeIds = new Set(free.map(n => n.id));
  const nodes: CanvasNode[] = [
    section,
    ...canvas.nodes.map(n => (freeIds.has(n.id) ? { ...n, sectionId: id } : n)),
  ];
  return { ...canvas, nodes };
}
