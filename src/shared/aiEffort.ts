// - values the claude CLI takes for --effort
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

function isEffortLevel(effort: string | undefined): effort is string {
  return !!effort && (EFFORT_LEVELS as readonly string[]).includes(effort);
}

export function effortArgs(effort: string | undefined): string[] {
  return isEffortLevel(effort) ? ['--effort', effort] : [];
}

// - the effort the model button shows: only the harness passes one to the model
export function shownEffort(effort: string | undefined, provider: string): string | undefined {
  return provider === 'harness' && isEffortLevel(effort) ? effort : undefined;
}
