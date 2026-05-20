/**
 * HeatmapContext — provides cluster glow data to all node and edge components.
 *
 * HeatmapProvider accepts nodes and edges (ReactFlow arrays), calls
 * useActivityHeatmap internally, and exposes the results + visibility toggle
 * via context.
 *
 * Usage:
 *   // In CanvasViewInner:
 *   <HeatmapProvider nodes={nodes} edges={edges} visible={heatmapVisible} toggle={toggleHeatmap}>
 *     <ZoomLevelProvider>
 *       ...
 *     </ZoomLevelProvider>
 *   </HeatmapProvider>
 *
 *   // In any node/edge component:
 *   const { visible, nodeGlow } = useHeatmap();
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Node, Edge, Viewport } from '@xyflow/react';
import { useOnViewportChange } from '@xyflow/react';
import type { HeatmapNode, EdgeGlow } from '../../shared/types';
import { useActivityHeatmap } from '../hooks/useActivityHeatmap';

interface HeatmapContextValue {
  visible:  boolean;
  toggle:   () => void;
  nodeGlow: Map<string, HeatmapNode>;
  edgeGlow: Map<string, EdgeGlow>;
}

const EMPTY_MAP_NODE = new Map<string, HeatmapNode>();
const EMPTY_MAP_EDGE = new Map<string, EdgeGlow>();

const HeatmapContext = createContext<HeatmapContextValue>({
  visible:  false,
  toggle:   () => undefined,
  nodeGlow: EMPTY_MAP_NODE,
  edgeGlow: EMPTY_MAP_EDGE,
});

export function useHeatmap(): HeatmapContextValue {
  return useContext(HeatmapContext);
}

interface HeatmapProviderProps {
  nodes:    Node[];
  edges:    Edge[];
  visible:  boolean;
  toggle:   () => void;
  children: React.ReactNode;
}

/** - must be rendered inside CanvasViewInner (inside ReactFlowProvider) where nodes/edges/viewport are available */
export function HeatmapProvider({ nodes, edges, visible, toggle, children }: HeatmapProviderProps): JSX.Element {
  // - track raw zoom so glow radii scale with viewport (pave effect at low zoom)
  const [zoom, setZoom] = useState(1);
  useOnViewportChange({
    onChange: useCallback((vp: Viewport) => setZoom(vp.zoom), []),
  });

  const { nodeGlow, edgeGlow } = useActivityHeatmap(
    visible ? nodes : [],
    visible ? edges : [],
    zoom,
  );

  return (
    <HeatmapContext.Provider value={{ visible, toggle, nodeGlow, edgeGlow }}>
      {children}
    </HeatmapContext.Provider>
  );
}
