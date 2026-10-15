/**
 * useKernelState — the live LED state of one kernel, from the host's kernelStatus poll.
 * Shared by the kernel node's circle and the rail's kernel rows.
 */

import { useEffect, useState } from 'react';
import type { KernelStatusEntry } from '../../shared/types';

export type LedState = KernelStatusEntry['state'];

// - the last poll: a hook mounted between polls (a rail segment scrolled into view) starts from the
//   kernel's known state instead of dead for up to one poll interval. Registered at module load, so
//   it is current before any hook's own listener runs.
let lastPoll: KernelStatusEntry[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('skena:kernelStatus', e => { lastPoll = (e as CustomEvent).detail as KernelStatusEntry[]; });
}

// - a node with no kernelId (never started, or just shut down) is dead — do NOT
// - fall back to matching some other live kernel on the same server (misleading green)
function stateIn(kernels: KernelStatusEntry[], server: string, kernelId?: string): LedState {
  const hit = kernelId ? kernels.find(k => k.server === server && k.kernelId === kernelId) : undefined;
  return hit ? hit.state : 'dead';
}

export function useKernelState(server: string, kernelId?: string): LedState {
  const [state, setState] = useState<LedState>(() => stateIn(lastPoll, server, kernelId));
  useEffect(() => {
    // - a shutdown clears kernelId: go dead now, instead of holding the last colour until the next poll
    setState(stateIn(lastPoll, server, kernelId));
    const onStatus = (e: Event) => setState(stateIn((e as CustomEvent).detail as KernelStatusEntry[], server, kernelId));
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

// - the kernel's name in a section title: green when idle, amber while busy, grey when stopped
export const KERNEL_TEXT_COLOR: Record<LedState, string> = {
  idle:  LED_COLOR.idle,
  busy:  '#f59e0b',   // - the amber of STATUS_COLORS (shared/constants.ts)
  dead:  LED_COLOR.dead,
  error: LED_COLOR.error,
};
