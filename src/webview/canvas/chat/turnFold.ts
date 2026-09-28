// - `toggled` holds the turns the user folded by clicking; every other turn is open, including a
// - turn just opened by a new prompt and every turn loaded from history when the canvas opens
export function isTurnOpen(toggled: ReadonlySet<string>, key: string): boolean {
  return !toggled.has(key);
}

export function toggleTurn(toggled: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(toggled);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// - clearing the whole history (Reset) drops every fold, so a turn key it reuses starts open again
export function clearFolds(toggled: ReadonlySet<string>, hadTurns: boolean, hasTurns: boolean): ReadonlySet<string> {
  return hadTurns && !hasTurns ? new Set<string>() : toggled;
}

// - a click on a turn's ▸ or ▾ line: the turn, whether the click opened it, and how far the line sat
// - below the top of the scroll area just before the click
export interface TurnClick { key: string; opened: boolean; offset: number }

export type TurnScroll =
  | { to: 'latest' }
  | { to: 'turn'; key: string; offset: number }
  | { to: 'stay' };

// - a click keeps the view on its turn: an opened turn's line goes to the top of the scroll area, a
// - folded one stays where it was on screen. Without a click, new content (a prompt, streamed text, a
// - tool step, the panel reopened) pins to the latest; anything else leaves the scroll as it is
export function turnScroll(click: TurnClick | null, newContent: boolean): TurnScroll {
  if (click) return { to: 'turn', key: click.key, offset: click.opened ? 0 : click.offset };
  return newContent ? { to: 'latest' } : { to: 'stay' };
}
