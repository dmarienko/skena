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

// - within this many px of the true bottom counts as "at the bottom"
const BOTTOM_TOLERANCE = 24;

// - whether the scroll area's visible bottom edge sits at, or within BOTTOM_TOLERANCE px of, its content
export function isAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_TOLERANCE;
}

// - a click keeps the view on its turn: an opened turn's line goes to the top of the scroll area, a
// - folded one stays where it was on screen. Without a click, new content (streamed text, a tool step,
// - a new answer, the panel reopened) pins to the latest only when the view was already at the bottom
// - just before that content arrived; `ownAction` (the user's own prompt) pins it regardless of where
// - the view was. Anything else leaves the scroll as it is
export function turnScroll(click: TurnClick | null, newContent: boolean, atBottomBefore: boolean, ownAction: boolean): TurnScroll {
  if (click) return { to: 'turn', key: click.key, offset: click.opened ? 0 : click.offset };
  if (!newContent) return { to: 'stay' };
  return atBottomBefore || ownAction ? { to: 'latest' } : { to: 'stay' };
}
