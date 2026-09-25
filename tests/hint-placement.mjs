// - run: npx esbuild src/webview/canvas/hintPlacement.ts --bundle --format=esm --outfile=tests/.build/hintPlacement.mjs && node --test tests/hint-placement.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BADGE_HALF, CARD_GAP, CARD_H, CARD_W, PANE_MARGIN, placeBadges, placeCards } from './.build/hintPlacement.mjs';

const PANE = { left: 0, top: 0, right: 2000, bottom: 1200 };
// - a badge already placed on screen, centred on (cx, cy)
const badge = (key, side, cx, cy) => ({ hint: { key, label: key, x: 0, y: 0, side }, cx, cy, ex: cx, ey: cy, lead: false });

test('1. badges: two exit points at one spot fan 16 px apart on screen and stay centred on it', () => {
  const hints = [
    { key: 'a', label: 'l', x: 100, y: 50, side: 'right' },
    { key: 'b', label: '1', x: 100, y: 50, side: 'right' },
  ];
  // - flow (100, 50) at zoom 2, shifted (10, 20): screen (210, 120); the badge sits 8 px outside
  const [a, b] = placeBadges(hints, 10, 20, 2);
  assert.equal(a.cx, 218);
  assert.equal(b.cy - a.cy, 16);
  assert.equal((a.cy + b.cy) / 2, 120);
  assert.ok(a.lead && b.lead);
});

test('2. cards of one border keep the badge order, do not overlap, and stay centred on their badges', () => {
  const cards = placeCards([badge('a', 'right', 500, 590), badge('b', 'right', 500, 600), badge('c', 'right', 500, 610)], PANE);
  assert.deepEqual(cards.map(c => c.key), ['a', 'b', 'c']);
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i].top >= cards[i - 1].top + CARD_H);
  const centre = cards.reduce((s, c) => s + c.top + CARD_H / 2, 0) / cards.length;
  assert.ok(Math.abs(centre - 600) < 1e-9);
});

test('3. a card sits just outside its badge, away from the node, on every border', () => {
  const off = BADGE_HALF + CARD_GAP;
  const [r] = placeCards([badge('r', 'right', 500, 600)], PANE);
  assert.equal(r.left, 500 + off);
  const [l] = placeCards([badge('l', 'left', 500, 600)], PANE);
  assert.equal(l.left + CARD_W, 500 - off);
  const [b] = placeCards([badge('b', 'bottom', 500, 600)], PANE);
  assert.equal(b.top, 600 + off);
  const [t] = placeCards([badge('t', 'top', 500, 600)], PANE);
  assert.equal(t.top + CARD_H, 600 - off);
  assert.ok([r, l, b, t].every(c => !c.lead));
});

test('4. cards stay inside the pane: pushed in near its edges', () => {
  const pane = { left: 0, top: 0, right: 800, bottom: 600 };
  const [r] = placeCards([badge('r', 'right', 780, 20)], pane);
  assert.equal(r.left, 800 - PANE_MARGIN - CARD_W);
  assert.equal(r.top, PANE_MARGIN);
  const run = placeCards([badge('a', 'bottom', 700, 100), badge('b', 'bottom', 710, 100), badge('c', 'bottom', 720, 100)], pane);
  assert.ok(run.every(c => c.left >= PANE_MARGIN && c.left + CARD_W <= 800 - PANE_MARGIN));
  for (let i = 1; i < run.length; i++) assert.ok(run[i].left >= run[i - 1].left + CARD_W);
  // - a pane whose left part the floating chat covers
  const [l] = placeCards([badge('l', 'left', 320, 300)], { left: 300, top: 0, right: 1200, bottom: 600 });
  assert.equal(l.left, 300 + PANE_MARGIN);
  // - a run longer than the pane keeps its start inside
  const long = placeCards([badge('a', 'right', 100, 50), badge('b', 'right', 100, 60)], { left: 0, top: 0, right: 800, bottom: 150 });
  assert.equal(long[0].top, PANE_MARGIN);
});

test('5. a card moved off its badge is marked for a line back to it; one still beside it is not', () => {
  const cards = placeCards([badge('a', 'right', 500, 600), badge('b', 'right', 500, 600), badge('c', 'right', 500, 600)], PANE);
  assert.deepEqual(cards.map(c => c.lead), [true, false, true]);
  const a = cards[0];
  assert.deepEqual([a.bx, a.by], [500, 600]);
  // - the line ends on the card's nearest corner: the bottom-left one, since the card moved up
  assert.deepEqual([a.lx, a.ly], [a.left, a.top + CARD_H]);
});
