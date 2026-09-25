// - how long g waits for its second key when it shows nothing
export const G_CHORD_MS = 400;
// - set on <html> while the badges are on screen, so a node's own key listener leaves the key to them
export const G_BADGES_ATTR = 'data-skena-g-badges';

export interface GChordState {
  /** - when g was pressed; 0 while the chord is not armed */
  armedAt: number;
  /** - true while the badges are on screen */
  showing: boolean;
  /** - each badge key → the node its connection leads to */
  labels: ReadonlyMap<string, string>;
}

export interface KeyPress { key: string; shift: boolean; ctrl: boolean; meta: boolean; alt: boolean }

/**
 * - `first`: a second g, to the first member of the section
 * - `jump`: a badge key, to the node its connection leads to
 * - `close`: any other key while the badges are shown; it closes them and does nothing else
 * - `pass`: any other key of a chord that shows nothing; it cancels the chord and is handled as usual
 */
export type GChordStep = { do: 'first' } | { do: 'jump'; nodeId: string } | { do: 'close' } | { do: 'pass' };

/**
 * What the key after `g` does. The badges have no time limit: they wait for the next key. A chord
 * that shows nothing, on a node without connections, lasts G_CHORD_MS. Null when the chord is not
 * armed or that window has run out, so the key is not the chord's.
 */
export function gChordStep(s: GChordState, k: KeyPress, now: number): GChordStep | null {
  if (s.armedAt === 0) return null;
  if (!s.showing && now - s.armedAt >= G_CHORD_MS) return null;
  if (!k.shift && !k.ctrl && !k.meta && !k.alt) {
    if (k.key === 'g') return { do: 'first' };
    const nodeId = k.key.length === 1 ? s.labels.get(k.key) : undefined;
    if (nodeId !== undefined) return { do: 'jump', nodeId };
  }
  return s.showing ? { do: 'close' } : { do: 'pass' };
}
