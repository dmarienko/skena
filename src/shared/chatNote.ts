import type { CanvasData, CanvasEdge, CanvasNode, TextNode } from './types';
import { NODE_SIZE } from './constants';
import { snapGrid } from './grid';
import { assignLabel } from './nodeLabels';
import { applyLaneFit, pinOutputToLane } from './sectionLanes';
import { directionSlot, estimateNoteNeedPx, forkOf, keepRowOf, layoutAround, noteHeight, sectionEngineNodes, toEngineNodes } from './layoutEngine';

/**
 * Add the chat's text note to `canvas`: the agent's `add_note` tool and the chat's ＋ canvas both come
 * here. The note goes right of `activeNodeId` the way `l` places a node, joined to it by an edge, and
 * the layout engine lays out its section with the note as the mover. It is NODE_SIZE.text.w wide and
 * as tall as its text needs (`noteHeight`). Mutates `canvas` in place: the host's document holds that
 * reference. Null when `content` is blank.
 */
export function addChatNote(
  canvas:       CanvasData,
  activeNodeId: string | null,
  content:      string,
  id:           string,
  now:          number,
): { node: CanvasNode; edge?: CanvasEdge } | null {
  if (!content.trim()) return null;

  const sections = canvas.metadata?.sections ?? [];
  const w = NODE_SIZE.text.w;
  const h = noteHeight(estimateNoteNeedPx(content));
  const anchor = activeNodeId ? canvas.nodes.find(n => n.id === activeNodeId) : undefined;

  // - as `l` does: off a code cell a new column right of its pair, off anything else the column slot
  //   one gap right of it, on its row. The pack below sorts the note into whatever that column holds.
  let at: { x: number; y: number } | null = null;
  if (anchor) {
    const around = sectionEngineNodes(canvas.nodes, sections, anchor.id) ?? toEngineNodes(canvas.nodes);
    at = (anchor.type === 'code' ? forkOf(around, anchor.id, 'right', w) : null)
      ?? directionSlot('L', { x: anchor.x, y: anchor.y, w: anchor.width }, w, h);
  }
  if (!at) {
    const last = canvas.nodes[canvas.nodes.length - 1];
    at = last ? { x: snapGrid(last.x + last.width + 60), y: snapGrid(last.y) } : { x: 200, y: 200 };
  }

  const node = assignLabel({
    id, type: 'text', x: at.x, y: at.y, width: w, height: h, text: content, createdBy: 'ai', lastTouched: now,
  } as TextNode, canvas.nodes);
  canvas.nodes.push(node);

  let edge: CanvasEdge | undefined;
  if (anchor) {
    // - made off a node a fold hides, the note is hidden with it, as a run's output is
    const pinned = pinOutputToLane(sections, anchor.id, id);
    if (pinned !== sections) canvas.metadata = { ...canvas.metadata, sections: pinned };
    // - `keepRow` as every node created with its edge gets it (§3.5): read with the note at its slot,
    //   in the focused node's section, before the engine runs
    const drawn: CanvasEdge = { id: `e-${id}`, fromNode: anchor.id, fromSide: 'right', toNode: id, toSide: 'left', toEnd: 'arrow' };
    const around = sectionEngineNodes(canvas.nodes, canvas.metadata?.sections ?? [], anchor.id, [id]) ?? toEngineNodes(canvas.nodes);
    edge = { ...drawn, keepRow: keepRowOf(around, [...canvas.edges, drawn], drawn) };
    canvas.edges.push(edge);
  }

  // - a note made off the focused node is laid out with that node's section, whatever its y
  const own = layoutAround(canvas, anchor?.id ?? id, { moverIds: [id] }, anchor ? [id] : undefined);
  Object.assign(canvas, applyLaneFit(canvas, now, own));
  // - the engine and the fit replace every node they move
  return { node: canvas.nodes.find(n => n.id === id) ?? node, edge };
}
