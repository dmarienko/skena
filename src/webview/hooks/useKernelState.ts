/**
 * useKernelState — the live LED state of one kernel, from the host's kernelStatus poll.
 * Shared by the kernel node's circle and the rail's kernel rows.
 */

import { useEffect, useState } from 'react';
import type { KernelStatusEntry } from '../../shared/types';

export type LedState = KernelStatusEntry['state'];

export function useKernelState(server: string, kernelId?: string): LedState {
  const [state, setState] = useState<LedState>('dead');
  useEffect(() => {
    // - a shutdown clears kernelId: go dead now, instead of holding the last colour until the next poll
    setState('dead');
    const onStatus = (e: Event) => {
      const kernels = (e as CustomEvent).detail as KernelStatusEntry[];
      // - a node with no kernelId (never started, or just shut down) is dead — do NOT
      // - fall back to matching some other live kernel on the same server (misleading green)
      const hit = kernelId ? kernels.find(k => k.server === server && k.kernelId === kernelId) : undefined;
      setState(hit ? hit.state : 'dead');
    };
    window.addEventListener('skena:kernelStatus', onStatus);
    return () => window.removeEventListener('skena:kernelStatus', onStatus);
  }, [server, kernelId]);
  return state;
}

export const LED_COLOR: Record<LedState, string> = {
  idle:  '#3fbf6f',
  busy:  '#3fbf6f',
  dead:  '#6b7280',
  error: '#e5484d',
};
