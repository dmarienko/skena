/**
 * ZoomLevelContext — single source of truth for the canvas zoom level.
 *
 * A single useOnViewportChange listener lives here (inside CanvasViewInner,
 * which is inside ReactFlowProvider). All node components read from this
 * context instead of each registering their own viewport listener.
 *
 * Without this, N file-nodes each called useOnViewportChange → N listeners
 * firing on every pan frame → N setState calls → N re-renders per frame even
 * though the discrete zoom level (minimal/overview/reading/detail) never
 * changes during a pan.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useOnViewportChange, Viewport } from '@xyflow/react';
import { ZoomLevel, zoomToLevel } from '../../shared/types';

const ZoomLevelContext = createContext<ZoomLevel>('reading');

export function useZoomLevel(): ZoomLevel {
  return useContext(ZoomLevelContext);
}

interface Props {
  children: React.ReactNode;
}

/** - must be rendered inside a ReactFlowProvider */
export function ZoomLevelProvider({ children }: Props): JSX.Element {
  const [level, setLevel] = useState<ZoomLevel>('reading');

  useOnViewportChange({
    onChange: useCallback((vp: Viewport) => {
      setLevel(prev => {
        const next = zoomToLevel(vp.zoom);
        // - avoid re-renders when the discrete level hasn't changed
        return next === prev ? prev : next;
      });
    }, []),
  });

  return (
    <ZoomLevelContext.Provider value={level}>
      {children}
    </ZoomLevelContext.Provider>
  );
}
