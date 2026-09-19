/**
 * Refresh bookkeeping, no timers and no network: which cached copies are old enough to fetch
 * again, what one fetch means for a node, and how many calls a server may have in flight.
 * The host runner drives this; the tests drive it directly.
 */

export interface RefreshTarget {
  id:     string;
  server: string;
  uri:    string;
  text:   string;
  // - only staleTargets reads it; the webview filters before it posts, so the host's targets
  //   arrive without one and a missing timestamp counts as old
  fetchedAt?: string;
}

export interface RefreshOutcome {
  id:         string;
  text?:      string;
  title?:     string;
  fetchedAt?: string;
  changed?:   boolean;
  error?:     string;
}

export function staleTargets(nodes: RefreshTarget[], now: Date, afterHours: number): RefreshTarget[] {
  const limit = now.getTime() - afterHours * 3600_000;
  return nodes.filter(n => {
    const t = Date.parse(n.fetchedAt ?? '');
    return Number.isNaN(t) || t < limit;
  });
}

// - same text → only the timestamp moves; different text → changed; gone → old text kept, error shown
export function outcomeOf(
  target: RefreshTarget,
  result: { text: string; title: string; fetchedAt: string } | { gone: string } | { error: string },
): RefreshOutcome {
  if ('error' in result) return { id: target.id, error: result.error };
  if ('gone' in result)  return { id: target.id, error: result.gone };
  if (result.text === target.text) return { id: target.id, fetchedAt: result.fetchedAt };
  return { id: target.id, text: result.text, title: result.title, fetchedAt: result.fetchedAt, changed: true };
}

export interface QueueState {
  pending:  RefreshTarget[];
  inFlight: Map<string, number>;
  ready:    RefreshOutcome[];
  stopped:  Set<string>;
}

export const MAX_IN_FLIGHT = 3;

export function newQueue(targets: RefreshTarget[]): QueueState {
  return { pending: [...targets], inFlight: new Map(), ready: [], stopped: new Set() };
}

export function takeNext(q: QueueState): RefreshTarget | undefined {
  const i = q.pending.findIndex(t => !q.stopped.has(t.server) && (q.inFlight.get(t.server) ?? 0) < MAX_IN_FLIGHT);
  if (i < 0) return undefined;
  const [t] = q.pending.splice(i, 1);
  q.inFlight.set(t.server, (q.inFlight.get(t.server) ?? 0) + 1);
  return t;
}

// - serverDown: the server did not answer, so the rest of its work is dropped rather than
//   waiting for the same failure once per node
export function settle(q: QueueState, t: RefreshTarget, o: RefreshOutcome, serverDown = false): void {
  q.inFlight.set(t.server, (q.inFlight.get(t.server) ?? 1) - 1);
  q.ready.push(o);
  if (serverDown) {
    q.stopped.add(t.server);
    q.pending = q.pending.filter(p => p.server !== t.server);
  }
}

export function drain(q: QueueState): RefreshOutcome[] {
  const r = q.ready;
  q.ready = [];
  return r;
}

export function done(q: QueueState): boolean {
  return q.pending.length === 0 && [...q.inFlight.values()].every(n => n === 0);
}
