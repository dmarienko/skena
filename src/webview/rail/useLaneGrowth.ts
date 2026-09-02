import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Node } from '@xyflow/react';
import { growLaneForNodes, type LaneGrowth, type SectionLane } from '../../shared/sectionLanes';

const geomOf = (n: Node) => ({
  id: n.id, x: n.position.x, y: n.position.y,
  width: Number(n.width ?? n.style?.width ?? 0), height: Number(n.height ?? n.style?.height ?? 0),
});

/**
 * Watches node geometry. After any change that is not part of an in-progress drag or resize (drop,
 * resize end, keyboard move, creation, paste, an external write), asks growLaneForNodes whether a
 * section must grow and hands the shifts to `apply`. The shifted nodes come back through this
 * effect once more and produce no further growth, so it settles in one extra pass.
 */
export function useLaneGrowth(nodes: Node[], lanes: SectionLane[], dragging: MutableRefObject<boolean>, skipOnce: MutableRefObject<boolean>, apply: (g: LaneGrowth) => void): void {
  const prev = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    // - mid-drag or mid-resize: the end state is diffed against the start
    if (dragging.current || nodes.some(n => n.resizing)) return;
    const sig = new Map(nodes.map(n => { const g = geomOf(n); return [n.id, `${g.x},${g.y},${g.width},${g.height}`]; }));
    const before = prev.current;
    prev.current = sig;
    if (skipOnce.current) { skipOnce.current = false; return; }   // - a state restored by undo/redo is taken as is: record it, grow nothing
    if (!before) return;
    const changed = [...sig].filter(([id, s]) => before.get(id) !== s).map(([id]) => id);
    if (changed.length === 0) return;
    const g = growLaneForNodes(lanes, nodes.map(geomOf), changed);
    if (Object.keys(g.laneShifts).length) apply(g);
  }, [nodes, lanes, dragging, skipOnce, apply]);
}
