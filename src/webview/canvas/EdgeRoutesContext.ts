import { createContext, useContext } from 'react';
import type { RoutedEdge } from '../../shared/edgeRouting';

// - the routes of every section, keyed by edge id, computed in one pass by CanvasView so the lanes
//   see every edge at once (spec 2026-09-11-edges-design.md §2). An edge whose two ends sit in
//   different sections, or a canvas with no sections at all, is simply absent: LabeledEdge then
//   routes that one on its own with the old obstacle router.
export const EdgeRoutesContext = createContext<Map<string, RoutedEdge>>(new Map());

export function useEdgeRoute(id: string): RoutedEdge | undefined {
  return useContext(EdgeRoutesContext).get(id);
}
