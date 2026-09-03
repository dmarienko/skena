import { createContext, useContext } from 'react';
import type { KernelRecord } from '../../shared/types';

// - metadata.kernels, provided by CanvasView so node components can resolve a section-bound record
export const KernelsContext = createContext<KernelRecord[]>([]);

export function useKernels(): KernelRecord[] {
  return useContext(KernelsContext);
}
