import { createContext, useContext } from 'react';
import type { SectionLane } from '../../shared/sectionLanes';

// - metadata.sections, provided by CanvasView so node components can apply the section-kernel rule
export const LanesContext = createContext<SectionLane[]>([]);

export function useLanes(): SectionLane[] {
  return useContext(LanesContext);
}
