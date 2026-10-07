// - run: npx esbuild src/webview/canvas/gestureTracker.ts --bundle --format=esm --outfile=tests/.build/gestureTracker.mjs && node --test tests/gesture-tracker.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createGestureTracker } from './.build/gestureTracker.mjs';

// - a clock the test moves by hand: timers fire only inside advance(), in due order
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    set: (fn, ms) => { const h = ++seq; pending.set(h, { at: now + ms, fn }); return h; },
    clear: h => { pending.delete(h); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
    get now() { return now; },
  };
}

function tracked(idleMs = 150) {
  const timers = fakeTimers();
  const log = [];
  const g = createGestureTracker({
    idleMs, timers,
    onStart: () => log.push(['start', timers.now]),
    onEnd: () => log.push(['end', timers.now]),
  });
  return { g, timers, log };
}

// - what one wheel notch does: the tick, then React Flow's start at once and its end in a later task
function notch(g, timers) {
  g.wheel();
  g.moveStart();
  timers.advance(0);
  g.moveEnd();
}

test('1. a run of wheel notches is one gesture that ends idleMs after the last notch', () => {
  const { g, timers, log } = tracked();
  for (let i = 0; i < 5; i++) { notch(g, timers); timers.advance(40); }
  assert.deepEqual(log, [['start', 0]]);
  timers.advance(200);
  assert.deepEqual(log, [['start', 0], ['end', 160 + 150]]);
});

test('2. notches further apart than idleMs are separate gestures', () => {
  const { g, timers, log } = tracked();
  notch(g, timers);
  timers.advance(300);
  notch(g, timers);
  timers.advance(300);
  assert.deepEqual(log, [['start', 0], ['end', 150], ['start', 300], ['end', 450]]);
});

test('3. a drag starts and ends with React Flow, with no wait', () => {
  const { g, timers, log } = tracked();
  g.moveStart();
  timers.advance(500);
  g.moveEnd();
  assert.deepEqual(log, [['start', 0], ['end', 500]]);
  timers.advance(1000);
  assert.equal(log.length, 2);
});

test('4. a drag that outlasts a wheel run ends the gesture when the drag ends', () => {
  const { g, timers, log } = tracked();
  notch(g, timers);
  timers.advance(50);
  g.moveStart();
  timers.advance(400);
  assert.deepEqual(log, [['start', 0]]);
  g.moveEnd();
  assert.deepEqual(log, [['start', 0], ['end', 450]]);
});

test('5. a wheel run that outlasts a drag ends idleMs after its last notch', () => {
  const { g, timers, log } = tracked();
  g.moveStart();
  timers.advance(100);
  g.wheel();
  g.moveEnd();
  timers.advance(100);
  assert.deepEqual(log, [['start', 0]]);
  timers.advance(100);
  assert.deepEqual(log, [['start', 0], ['end', 250]]);
});

test('6. after dispose a pending wheel end never fires', () => {
  const { g, timers, log } = tracked();
  notch(g, timers);
  g.dispose();
  timers.advance(1000);
  assert.deepEqual(log, [['start', 0]]);
});
