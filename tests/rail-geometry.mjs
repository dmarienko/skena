// - run: npx esbuild src/webview/rail/railGeometry.ts --bundle --format=esm --outfile=tests/.build/railGeometry.mjs && node --test tests/rail-geometry.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { railSegments, railItems, kernelButtons, SEG_MIN_H, BTN_H, DOT_BTN_H, LABEL_H, COMPACT_FOLD_H } from './.build/railGeometry.mjs';

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
  assert.deepEqual(railItems(27, 20, true), { items: ['fold'], titleMaxPx: 0, compact: true });   // - a band cut by the pane's edge
  assert.deepEqual(railItems(15, 20, true).items, []);
  assert.deepEqual(railItems(28, 20).items, ['label']);   // - unfolded: unchanged
  assert.deepEqual(railItems(60, 20, true).items, ['fold', 'label']);
});

test('railItems: a folded segment of 28 px holds the chevron and S#, packed with no padding or gap', () => {
  assert.equal(COMPACT_FOLD_H + LABEL_H, SEG_MIN_H);
  assert.deepEqual(railItems(28, 20, true), { items: ['fold', 'label'], titleMaxPx: 0, compact: true });
  assert.deepEqual(railItems(46, 20, true), { items: ['fold', 'label'], titleMaxPx: 0, compact: true });
  // - from 47 px the usual column holds both: 8 + 20 + 7 + 12
  assert.deepEqual(railItems(47, 20, true), { items: ['fold', 'label'], titleMaxPx: 0 });
  assert.equal(railItems(28, 20).compact, undefined);   // - an open section never packs
});

test('railItems: the stacked boxes of a folded section never exceed the segment, packed or not', () => {
  const box = { label: LABEL_H, fold: BTN_H, title: 0, run: BTN_H, kernel: DOT_BTN_H, delete: BTN_H };
  for (let h = 10; h <= 400; h++) {
    const { items, titleMaxPx, compact } = railItems(h, 20, true);
    const stacked = compact
      ? COMPACT_FOLD_H + (items.includes('label') ? LABEL_H : 0)
      : 8 + items.reduce((s, i) => s + (i === 'title' ? titleMaxPx : box[i]), 0) + Math.max(0, items.length - 1) * 7;
    assert.ok(stacked <= h, `height ${h}: stacked ${stacked}`);
    if (h >= SEG_MIN_H) assert.ok(items.includes('fold') && (items.includes('label') || items.includes('title')), `height ${h}: ${items}`);
  }
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

test('railItems: the kernel buttons are drawn between ▶ and the kernel dot', () => {
  assert.deepEqual(railItems(600, 20, false, ALL_K).items,
    ['fold', 'title', 'run', 'stop', 'interrupt', 'restart', 'shutdown', 'select', 'kernel', 'delete']);
  assert.deepEqual(railItems(600, 20, false, ['select']).items, ['fold', 'title', 'run', 'select', 'kernel', 'delete']);
});

test('railItems: a shorter segment drops the kernel buttons from the end of ■ ❚❚ ↻ ⏻ ⇄, before the title is cut or ▶ ● ✕ go', () => {
  const kb = ['stop', 'interrupt', 'restart', 'shutdown', 'select'];
  const titleH = Math.ceil(20 * 6.5);
  let prev = kb.length;
  // - 74 is the least height that holds S#, the chevron and ▶ (as before the kernel buttons)
  for (let h = 400; h >= 74; h--) {
    const { items, titleMaxPx } = railItems(h, 20, false, ALL_K);
    const got = items.filter(i => kb.includes(i));
    assert.deepEqual(got, kb.slice(0, got.length), `height ${h}: ${items}`);
    assert.ok(got.length <= prev, `height ${h}: grew from ${prev} to ${got.length}`);
    assert.ok(items.includes('run'), `height ${h}: lost ▶`);
    if (got.length > 0) assert.ok(titleMaxPx === titleH && items.includes('kernel') && items.includes('delete'), `height ${h}: a kernel button kept over the title, ● or ✕: ${items} ${titleMaxPx}`);
    prev = got.length;
  }
  // - the full title first, then as many buttons as fit
  assert.deepEqual(railItems(300, 20, false, ALL_K), { items: ['fold', 'title', 'run', 'stop', 'interrupt', 'kernel', 'delete'], titleMaxPx: titleH });
  // - no room for them: exactly the controls of a section without kernel buttons
  assert.deepEqual(railItems(140, 20, false, ALL_K), railItems(140, 20));
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
