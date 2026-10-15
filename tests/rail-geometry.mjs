// - run: npx esbuild src/webview/rail/railGeometry.ts --bundle --format=esm --outfile=tests/.build/railGeometry.mjs && node --test tests/rail-geometry.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { railSegments, railItems, kernelButtons, SEG_MIN_H, BTN_H, DOT_BTN_H, LABEL_H } from './.build/railGeometry.mjs';

const lane = (id, top, bottom) => ({ id, top, bottom });

test('railSegments: a lane projects to screen, clipped to the viewport, with the gap taken off both ends', () => {
  const [s] = railSegments([lane('a', 0, 1000)], 0, 1, 600);
  assert.deepEqual(s, { id: 'a', top: 3, height: 594 });
});

test('railSegments: panned inside a lane → the segment starts at the viewport top', () => {
  const [s] = railSegments([lane('a', 0, 1000)], -500, 1, 600);
  assert.deepEqual(s, { id: 'a', top: 3, height: 494 });
});

test('railSegments: lanes outside the viewport are not emitted', () => {
  assert.deepEqual(railSegments([lane('a', 2000, 3000)], 0, 1, 600), []);
  assert.deepEqual(railSegments([lane('a', 0, 100)], -200, 1, 600), []);
});

test('railSegments: adjacent lanes keep the 6px gap', () => {
  const [a, b] = railSegments([lane('a', 0, 300), lane('b', 300, 600)], 0, 1, 600);
  assert.equal(a.top + a.height, 297);
  assert.equal(b.top, 303);
});

test('railSegments: a tiny projection is floored at SEG_MIN_H and kept inside the viewport', () => {
  const [s] = railSegments([lane('a', 0, 1000)], 0, 0.01, 600);   // - projects to 0..10
  assert.equal(s.height, SEG_MIN_H);
  assert.equal(s.top, 0);
  const [t] = railSegments([lane('a', 0, 1000)], 590, 0.01, 600);   // - projects to 590..600
  assert.equal(t.height, SEG_MIN_H);
  assert.equal(t.top + t.height, 600);
});

test('railSegments: the floor is centred when nothing is in the way', () => {
  assert.deepEqual(railSegments([lane('a', 300, 310)], 0, 1, 600), [{ id: 'a', top: 291, height: 28 }]);
});

test('railSegments: a zero-height viewport gives nothing; a viewport under the floor wins over it', () => {
  assert.deepEqual(railSegments([lane('a', 0, 1000)], 0, 1, 0), []);
  assert.deepEqual(railSegments([lane('a', 0, 1000)], 0, 1, 20), [{ id: 'a', top: 0, height: 20 }]);
});

test('railSegments: two tiny adjacent lanes never overlap — the floor grows only into free space', () => {
  const [a, b] = railSegments([lane('a', 0, 1000), lane('b', 1000, 2000)], 0, 0.01, 600);   // - 0..10 and 10..20
  assert.deepEqual(a, { id: 'a', top: 0, height: 7 });
  assert.deepEqual(b, { id: 'b', top: 13, height: 28 });
});

test('railSegments: a lane with no visible pixel is not emitted', () => {
  assert.deepEqual(railSegments([lane('a', 600, 1000)], 0, 1, 600), []);
  assert.deepEqual(railSegments([lane('a', 0, 34)], 100, 1, 600), [{ id: 'a', top: 103, height: 28 }]);
});

test('railItems: fixed controls first, then an elastic title that replaces S# when at least TITLE_MIN_PX is left', () => {
  assert.deepEqual(railItems(28, 20),  { items: ['label'], titleMaxPx: 0 });
  assert.deepEqual(railItems(60, 20),  { items: ['fold', 'label'], titleMaxPx: 0 });
  assert.deepEqual(railItems(100, 20), { items: ['fold', 'label', 'run', 'kernel'], titleMaxPx: 0 });
  assert.deepEqual(railItems(200, 20), { items: ['fold', 'title', 'run', 'kernel', 'delete'], titleMaxPx: 83 });
  assert.deepEqual(railItems(400, 20), { items: ['fold', 'title', 'run', 'kernel', 'delete'], titleMaxPx: 130 });
  assert.deepEqual(railItems(400, 60), { items: ['fold', 'title', 'run', 'kernel', 'delete'], titleMaxPx: 283 });   // - long title truncated, no control lost
  assert.deepEqual(railItems(60, 0),   { items: ['fold', 'label'], titleMaxPx: 0 });
  assert.deepEqual(railItems(10, 5),   { items: [], titleMaxPx: 0 });
});

test('railSegments: rounding never pushes a segment past the viewport or into the next one', () => {
  const lanes = [lane('a', -1295, -1293), lane('b', -1293, -511), lane('c', -511, 535), lane('d', 535, 1182), lane('e', 1182, 1963), lane('f', 1963, 2035)];
  const segs = railSegments(lanes, 311, 0.5, 600);
  for (const s of segs) assert.ok(s.top + s.height <= 600, `${s.id} ends at ${s.top + s.height}`);
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i].top >= segs[i - 1].top + segs[i - 1].height, `${segs[i].id} overlaps ${segs[i - 1].id}`);
});

test('railItems: the stacked boxes never exceed the segment (8 top pad, boxes, 7px gaps between)', () => {
  const box = { label: LABEL_H, fold: BTN_H, title: 0, run: BTN_H, kernel: DOT_BTN_H, delete: BTN_H };
  for (let h = 10; h <= 400; h++) {
    const { items, titleMaxPx } = railItems(h, 20);
    const stacked = 8 + items.reduce((s, i) => s + (i === 'title' ? titleMaxPx : box[i]), 0) + Math.max(0, items.length - 1) * 7;
    assert.ok(stacked <= h, `height ${h}: stacked ${stacked}`);
  }
});

test('railItems: a folded section takes the chevron first, so the rail can always unfold it', () => {
  assert.deepEqual(railItems(28, 20, true), { items: ['fold'], titleMaxPx: 0 });
  assert.deepEqual(railItems(28, 20).items, ['label']);   // - unfolded: unchanged
  assert.deepEqual(railItems(60, 20, true).items, ['fold', 'label']);
});

test('kernelButtons: what an open section offers in each state, in display order', () => {
  const open = { folded: false, bound: false, live: false, running: false };
  assert.deepEqual(kernelButtons(open), ['select']);                                        // - no kernel: pick one
  assert.deepEqual(kernelButtons({ ...open, bound: true }), ['select']);                    // - bound, not started
  assert.deepEqual(kernelButtons({ ...open, bound: true, live: true }), ['interrupt', 'restart', 'shutdown', 'select']);
  assert.deepEqual(kernelButtons({ ...open, bound: true, live: true, running: true }), ['stop', 'interrupt', 'restart', 'shutdown', 'select']);
  assert.deepEqual(kernelButtons({ ...open, running: true }), ['stop', 'select']);          // - cells with a kernel edge run without a section kernel
});

test('kernelButtons: a folded section shows none of them', () => {
  assert.deepEqual(kernelButtons({ folded: true, bound: true, live: true, running: true }), []);
  assert.deepEqual(kernelButtons({ folded: true, bound: false, live: false, running: false }), []);
});

const ALL_K = ['stop', 'interrupt', 'restart', 'shutdown', 'select'];

test('railItems: the kernel buttons sit between ▶ and the kernel dot', () => {
  assert.deepEqual(railItems(600, 20, false, ALL_K).items,
    ['fold', 'title', 'run', 'stop', 'interrupt', 'restart', 'shutdown', 'select', 'kernel', 'delete']);
  assert.deepEqual(railItems(600, 20, false, ['select']).items, ['fold', 'title', 'run', 'select', 'kernel', 'delete']);
});

test('railItems: a shorter segment drops buttons from the end of ▶ ■ ❚❚ ↻ ⏻ ⇄ ● ✕ and keeps ▶', () => {
  const order = ['run', 'stop', 'interrupt', 'restart', 'shutdown', 'select', 'kernel', 'delete'];
  let prev = order.length;
  // - 74 is the least height that holds S#, the chevron and ▶ (as before the kernel buttons)
  for (let h = 400; h >= 74; h--) {
    const got = railItems(h, 20, false, ALL_K).items.filter(i => order.includes(i));
    assert.deepEqual(got, order.slice(0, got.length), `height ${h}: ${got}`);
    assert.ok(got.length <= prev, `height ${h}: grew from ${prev} to ${got.length}`);
    assert.ok(got.includes('run'), `height ${h}: lost ▶`);
    prev = got.length;
  }
  assert.deepEqual(railItems(140, 20, false, ALL_K).items, ['fold', 'label', 'run', 'stop', 'interrupt']);
});

test('railItems: with the kernel buttons the stacked boxes still never exceed the segment', () => {
  const box = { label: LABEL_H, fold: BTN_H, title: 0, run: BTN_H, kernel: DOT_BTN_H, delete: BTN_H, stop: BTN_H, interrupt: BTN_H, restart: BTN_H, shutdown: BTN_H, select: BTN_H };
  for (let h = 10; h <= 600; h++) {
    const { items, titleMaxPx } = railItems(h, 20, false, ALL_K);
    const stacked = 8 + items.reduce((s, i) => s + (i === 'title' ? titleMaxPx : box[i]), 0) + Math.max(0, items.length - 1) * 7;
    assert.ok(stacked <= h, `height ${h}: stacked ${stacked}`);
  }
});

test('railItems: a folded section never shows kernel buttons, even when passed', () => {
  assert.deepEqual(railItems(600, 20, true, ALL_K).items, ['fold', 'title', 'run', 'kernel', 'delete']);
});
