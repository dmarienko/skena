// - `toggled` holds the turns the user clicked: an earlier turn in it is open, the latest turn in it is folded
export function isTurnOpen(toggled: ReadonlySet<string>, key: string, latestKey: string | null): boolean {
  return key === latestKey ? !toggled.has(key) : toggled.has(key);
}

export function toggleTurn(toggled: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(toggled);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// - a new latest turn (a new prompt, or a cleared history) folds every earlier turn again
export function nextToggled(toggled: ReadonlySet<string>, prevLatest: string | null, nextLatest: string | null): ReadonlySet<string> {
  return prevLatest === nextLatest ? toggled : new Set<string>();
}
