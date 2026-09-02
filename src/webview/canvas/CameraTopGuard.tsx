import { useEffect } from 'react';
import { useStore, useReactFlow } from '@xyflow/react';

/**
 * CameraTopGuard — keeps the camera from ever showing above the first section.
 *
 * translateExtent only bounds INTERACTIVE panning, and the canvas moves the camera from a dozen
 * places besides: restore, nav, zoom hotkeys, marks, fitView (which adds padding above by design) and
 * React Flow's own fit button. Clamping each writer has failed twice — one missed path puts the empty
 * strip back. This watches the resulting transform instead, so the boundary holds no matter who wrote
 * it. It corrects only past the boundary, so it never fights a legal pan.
 */
export function CameraTopGuard({ topFlowY }: { topFlowY: number | null }): null {
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  const tx = useStore(s => s.transform[0]);
  const { setViewport } = useReactFlow();
  useEffect(() => {
    if (topFlowY === null) return;
    const cap = -topFlowY * zoom;
    if (ty > cap + 0.5) setViewport({ x: tx, y: cap, zoom }, { duration: 0 });
  }, [tx, ty, zoom, topFlowY, setViewport]);
  return null;
}
