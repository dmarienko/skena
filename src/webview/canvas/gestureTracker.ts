/**
 * Whether the canvas is moving, as one span from the first start to the last end, over two sources:
 * React Flow's move start and end (a drag, an animated jump) and wheel notches. A wheel notch has no
 * end of its own — the wheel zoom sets the viewport once per notch, and React Flow reports a start and
 * an end for every set — so a run of notches ends `idleMs` after its last notch. Pure: the timers are
 * passed in.
 */

// - d3-zoom's own wait before it ends a wheel gesture
export const WHEEL_IDLE_MS = 150;

export interface GestureTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface GestureTracker {
  moveStart: () => void;
  moveEnd: () => void;
  wheel: () => void;
  dispose: () => void;
}

export function createGestureTracker(opts: {
  idleMs: number;
  timers: GestureTimers;
  onStart: () => void;
  onEnd: () => void;
}): GestureTracker {
  let moving = false;
  // - the pending end of a wheel run; null when no notch came in the last idleMs
  let wheelTimer: unknown = null;
  let active = false;
  let disposed = false;

  const update = (): void => {
    const now = moving || wheelTimer !== null;
    if (now === active || disposed) return;
    active = now;
    if (now) opts.onStart();
    else opts.onEnd();
  };

  return {
    moveStart: () => { moving = true; update(); },
    moveEnd: () => { moving = false; update(); },
    wheel: () => {
      if (disposed) return;
      if (wheelTimer !== null) opts.timers.clear(wheelTimer);
      wheelTimer = opts.timers.set(() => { wheelTimer = null; update(); }, opts.idleMs);
      update();
    },
    dispose: () => {
      if (wheelTimer !== null) opts.timers.clear(wheelTimer);
      wheelTimer = null;
      disposed = true;
    },
  };
}
