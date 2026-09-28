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
