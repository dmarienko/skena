import { useEffect, type MutableRefObject } from 'react';
import type { Node } from '@xyflow/react';
import { fitLanes, type LaneGrowth, type SectionLane } from '../../shared/sectionLanes';

const geomOf = (n: Node) => ({
  id: n.id, x: n.position.x, y: n.position.y,
  width: Number(n.width ?? n.style?.width ?? 0), height: Number(n.height ?? n.style?.height ?? 0),
});

/**
 * After any node or lane change that is not part of an in-progress drag or resize, fits every
 * section to its content and hands the shifts to `apply`. The shifted state comes back through this
 * effect once more and fits with no shifts, so it settles in one extra pass.
 */
export function useLaneFit(nodes: Node[], lanes: SectionLane[], dragging: MutableRefObject<boolean>, skipOnce: MutableRefObject<boolean>, apply: (f: LaneGrowth) => void): void {
  useEffect(() => {
    if (dragging.current || nodes.some(n => n.resizing)) return;   // - mid-gesture: the end state is fitted
    if (skipOnce.current) { skipOnce.current = false; return; }    // - a state restored by undo/redo is taken as is
    const f = fitLanes(lanes, nodes.map(geomOf));
    if (Object.keys(f.laneShifts).length) apply(f);
  }, [nodes, lanes, dragging, skipOnce, apply]);
}
