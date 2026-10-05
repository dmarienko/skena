import type { VimConfig } from '../../shared/types';
import { DEFAULT_JUMP_LABELS, DEFAULT_LEADER, normalizeLeader } from './jumpLabels';

let current: VimConfig = { leader: DEFAULT_LEADER, jumpLabels: DEFAULT_JUMP_LABELS };

/**
 * skena.vim.* as the host sent them last (App.tsx). The editors and the canvas read them on every
 * key, so a change applies at once.
 */
export function vimSettings(): VimConfig {
  return current;
}

export function setVimSettings(c: VimConfig): void {
  current = {
    leader:     normalizeLeader(c.leader),
    jumpLabels: typeof c.jumpLabels === 'string' && c.jumpLabels !== '' ? c.jumpLabels : DEFAULT_JUMP_LABELS,
  };
}
