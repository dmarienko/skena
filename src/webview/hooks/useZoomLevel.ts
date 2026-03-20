/**
 * Tracks React Flow viewport zoom and maps it to a discrete ZoomLevel
 * for LOD (Level of Detail) rendering decisions.
 */

import { useState, useCallback } from 'react';
import { useOnViewportChange, Viewport } from '@xyflow/react';
import { ZoomLevel, zoomToLevel } from '../../shared/types';

export function useZoomLevel(): ZoomLevel {
  const [level, setLevel] = useState<ZoomLevel>('reading');

  useOnViewportChange({
    onChange: useCallback((vp: Viewport) => {
      setLevel(zoomToLevel(vp.zoom));
    }, []),
  });

  return level;
}
