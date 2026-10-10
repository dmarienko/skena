// - run: npx esbuild src/shared/sectionNav.ts --bundle --format=esm --outfile=tests/.build/sectionNav.mjs && npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=tests/.build/sectionLanes.mjs && node --test tests/section-nav.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bandNavBox, firstVisibleMember, focusAfterFold, nearestBand, nearestVisibleNode, sectionIndexAtY, stepSection, viewIsEmpty } from './.build/sectionNav.mjs';
import { deriveLanes } from './.build/sectionLanes.mjs';

// - four sections; S2 holds two nodes on one row, the right one first in the array
const box = (id, x, y, w = 400, h = 150) => ({ id, x, y, w, h });
const NODES = [
  box('a', 0, 100), box('a2', 500, 100),
  box('b2', 500, 1300), box('b', 0, 1300),
  box('c', 0, 2300),
  box('d', 0, 3300),
];
const geom = nodes => nodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.w, height: n.h }));
const lane = (id, y, folded) => (folded ? { id, y, createdAt: 1, folded } : { id, y, createdAt: 1 });
const setup = (folds = {}, nodes = NODES) => {
  const raw = [lane('s1', 0, folds.s1), lane('s2', 1200, folds.s2), lane('s3', 2200, folds.s3), lane('s4', 3200, folds.s4)];
  const lanes = deriveLanes(geom(nodes), raw);
  const hidden = new Set(raw.flatMap(l => l.folded ?? []));
  return { lanes, hidden, nodes };
};

test('sectionIndexAtY: the section whose range holds y; above the first → the first, past the last → the last', () => {
  const { lanes } = setup();
  assert.equal(sectionIndexAtY(lanes, 0), 0);
  assert.equal(sectionIndexAtY(lanes, 1199), 0);
  assert.equal(sectionIndexAtY(lanes, 1200), 1);
  assert.equal(sectionIndexAtY(lanes, -50), 0);
  assert.equal(sectionIndexAtY(lanes, 99999), 3);
  assert.equal(sectionIndexAtY([], 10), -1);
});

test('firstVisibleMember: by y, then x, whatever the array order', () => {
  const { lanes, hidden } = setup();
  assert.equal(firstVisibleMember(lanes[1], NODES, hidden), 'b');
});

test('firstVisibleMember: a hidden member is skipped; nothing visible → null', () => {
  const { lanes, hidden } = setup({ s2: ['b', 'b2'] });
  assert.equal(firstVisibleMember(lanes[1], NODES, hidden), null);
  const one = setup({ s2: ['b'] });
  assert.equal(firstVisibleMember(one.lanes[1], NODES, one.hidden), 'b2');
});

test('stepSection down from an open section into an open one: its first node', () => {
  const { lanes, hidden } = setup();
  assert.deepEqual(stepSection(lanes, 0, 'down', NODES, hidden), { kind: 'node', laneId: 's2', nodeId: 'b' });
});

test('stepSection onto a folded section: its band, not a node', () => {
  const { lanes, hidden } = setup({ s2: ['b', 'b2'] });
  assert.deepEqual(stepSection(lanes, 0, 'down', NODES, hidden), { kind: 'band', laneId: 's2' });
  assert.deepEqual(stepSection(lanes, 2, 'up', NODES, hidden), { kind: 'band', laneId: 's2' });
});

test('stepSection from a band continues to the next section', () => {
  const { lanes, hidden } = setup({ s2: ['b', 'b2'] });
  assert.deepEqual(stepSection(lanes, 1, 'down', NODES, hidden), { kind: 'node', laneId: 's3', nodeId: 'c' });
  assert.deepEqual(stepSection(lanes, 1, 'up', NODES, hidden), { kind: 'node', laneId: 's1', nodeId: 'a' });
});

test('stepSection at the first / last section: null, no wrap', () => {
  const { lanes, hidden } = setup();
  assert.equal(stepSection(lanes, 0, 'up', NODES, hidden), null);
  assert.equal(stepSection(lanes, 3, 'down', NODES, hidden), null);
});

test('stepSection passes over an open section with no node', () => {
  const nodes = NODES.filter(n => n.id !== 'c');
  const { lanes, hidden } = setup({}, nodes);
  assert.deepEqual(stepSection(lanes, 1, 'down', nodes, hidden), { kind: 'node', laneId: 's4', nodeId: 'd' });
  // - and nothing past it: null, not the empty section
  const last = nodes.filter(n => n.id !== 'd');
  const s = setup({}, last);
  assert.equal(stepSection(s.lanes, 1, 'down', last, s.hidden), null);
});

test('viewIsEmpty: a visible node inside → false; only empty canvas → true', () => {
  const { lanes, hidden } = setup();
  assert.equal(viewIsEmpty({ left: 0, top: 0, right: 1000, bottom: 1000 }, lanes, NODES, hidden), false);
  assert.equal(viewIsEmpty({ left: 0, top: 5000, right: 1000, bottom: 6000 }, lanes, NODES, hidden), true);
  // - a node that only touches the view's edge is not inside it
  assert.equal(viewIsEmpty({ left: 0, top: 250, right: 1000, bottom: 1200 }, lanes, NODES, hidden), true);
});

test('viewIsEmpty: a hidden node does not count, a folded band in view does', () => {
  const { lanes, hidden } = setup({ s4: ['d'] });
  const band = lanes[3];
  assert.equal(viewIsEmpty({ left: 0, top: 3200, right: 1000, bottom: 4000 }, lanes, NODES, new Set()), false);
  // - d hidden; the folded band [top, bottom) still overlaps the view
  assert.equal(viewIsEmpty({ left: 0, top: band.top, right: 1000, bottom: band.top + 50 }, lanes, NODES, hidden), false);
  // - below the band: nothing
  assert.equal(viewIsEmpty({ left: 0, top: band.bottom, right: 1000, bottom: band.bottom + 2000 }, lanes, NODES, hidden), true);
  // - the band spans the whole width: a view far to the right still shows it
  assert.equal(viewIsEmpty({ left: 50000, top: band.top, right: 51000, bottom: band.bottom }, lanes, NODES, hidden), false);
});

test('focusAfterFold: the first node of the next open section below', () => {
  const { lanes, hidden } = setup({ s2: ['b', 'b2'] });
  assert.deepEqual(focusAfterFold(lanes, 's2', NODES, hidden), { kind: 'node', laneId: 's3', nodeId: 'c' });
});

test('focusAfterFold: a folded section below is passed over', () => {
  const { lanes, hidden } = setup({ s2: ['b', 'b2'], s3: ['c'] });
  assert.deepEqual(focusAfterFold(lanes, 's2', NODES, hidden), { kind: 'node', laneId: 's4', nodeId: 'd' });
});

test('focusAfterFold: nothing open below → the nearest open section above', () => {
  const { lanes, hidden } = setup({ s4: ['d'] });
  assert.deepEqual(focusAfterFold(lanes, 's4', NODES, hidden), { kind: 'node', laneId: 's3', nodeId: 'c' });
});

test('focusAfterFold: no open section with a node left → the folded section\'s own band', () => {
  const { lanes, hidden } = setup({ s1: ['a', 'a2'], s2: ['b', 'b2'], s3: ['c'], s4: ['d'] });
  assert.deepEqual(focusAfterFold(lanes, 's2', NODES, hidden), { kind: 'band', laneId: 's2' });
});

test('bandNavBox: the band range over the whole canvas width, under an id no node has', () => {
  const { lanes } = setup({ s2: ['b', 'b2'] });
  const b = bandNavBox(lanes[1]);
  assert.equal(b.y, lanes[1].top);
  assert.equal(b.h, lanes[1].bottom - lanes[1].top);
  assert.equal(b.x, 0);
  assert.ok(b.w >= 1e6);
  assert.ok(!NODES.some(n => n.id === b.id));
});

test('nearestVisibleNode: closest centre among the visible nodes only', () => {
  const { hidden } = setup({ s2: ['b', 'b2'] });
  assert.equal(nearestVisibleNode(NODES, new Set(), { x: 200, y: 1375 }), 'b');
  assert.equal(nearestVisibleNode(NODES, hidden, { x: 200, y: 1375 }), 'c');   // - c's centre is 1000 away, a's 1200
  assert.equal(nearestVisibleNode(NODES, new Set(NODES.map(n => n.id)), { x: 0, y: 0 }), null);
});

test('nearestBand: the folded band closest to y; none folded → null', () => {
  const { lanes } = setup({ s2: ['b', 'b2'], s4: ['d'] });
  assert.equal(nearestBand(lanes, lanes[1].top + 10), 's2');
  assert.equal(nearestBand(lanes, lanes[3].top + 500), 's4');
  assert.equal(nearestBand(setup().lanes, 0), null);
});
