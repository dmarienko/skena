// - values the claude CLI takes for --effort
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function effortArgs(effort: string | undefined): string[] {
  return effort && (EFFORT_LEVELS as readonly string[]).includes(effort) ? ['--effort', effort] : [];
}
