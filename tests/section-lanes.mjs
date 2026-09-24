// - run: npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=tests/.build/sectionLanes.mjs && node --test tests/section-lanes.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sortLanes, groupIdsByLane, pruneFoldedIds, unfoldLane, laneIndexForY, deriveLanes, migrateSections, LANE_BOTTOM_PAD, outputCellGeom, memberCodeCellsInRunOrder, parkFirstLaneAtOrigin, laneIndexForNode, pinnedLaneIndex, SECTION_FOLDED_H, SECTION_MIN_H, fitLanes, applyLaneFit, sectionTargetHeight, pinOutputToLane, laneTopForNode, sectionByRef, insertLaneAt, foldLane, allFolded } from './.build/sectionLanes.mjs';

const lane = (id, y, extra = {}) => ({ id, y, createdAt: 1, ...extra });

test('sortLanes orders by y and does not mutate the input', () => {
  const input = [lane('b', 500), lane('a', 0)];
  const out = sortLanes(input);
  assert.deepEqual(out.map(l => l.id), ['a', 'b']);
  assert.deepEqual(input.map(l => l.id), ['b', 'a']);
});

test('laneIndexForY picks the last lane whose y is at or above the point', () => {
  const lanes = [lane('a', 0), lane('b', 500), lane('c', 900)];
  assert.equal(laneIndexForY(lanes, 0), 0);
  assert.equal(laneIndexForY(lanes, 499), 0);
  assert.equal(laneIndexForY(lanes, 500), 1);   // - boundary belongs to the LOWER lane
  assert.equal(laneIndexForY(lanes, 10000), 2); // - the last lane is unbounded
});

test('laneIndexForY clamps a node above the first lane into it (no orphans)', () => {
  const lanes = [lane('a', 100), lane('b', 500)];
  assert.equal(laneIndexForY(lanes, -9999), 0);
});

test('deriveLanes assigns members by position and labels by stack order', () => {
  const lanes = [lane('a', 0), lane('b', 500)];
  const nodes = [
    { id: 'n1', x: 300, y: 100, width: 200, height: 100 },
    { id: 'n2', x: 700, y: 200, width: 200, height: 100 },
    { id: 'n3', x: 400, y: 600, width: 200, height: 100 },
  ];
  const [s1, s2] = deriveLanes(nodes, lanes);
  assert.deepEqual(s1.memberIds, ['n1', 'n2']);
  assert.deepEqual(s2.memberIds, ['n3']);
  assert.equal(s1.label, 'S1');
  assert.equal(s2.label, 'S2');
  assert.equal(s1.top, 0);
  assert.equal(s1.bottom, 500);          // - bounded by the next lane
});

test('the last lane grows with its content (this is the live-growth guarantee)', () => {
  const lanes = [lane('a', 0)];
  const near = deriveLanes([{ id: 'n', x: 0, y: 100, width: 10, height: 100 }], lanes)[0];
  const far = deriveLanes([{ id: 'n', x: 0, y: 900, width: 10, height: 100 }], lanes)[0];
  assert.equal(near.bottom, 200 + LANE_BOTTOM_PAD);
  assert.equal(far.bottom, 1000 + LANE_BOTTOM_PAD);  // - moving the node moved the lane bottom
});

test('an empty lane derives without members and anchors to its own top', () => {
  const [s] = deriveLanes([], [lane('a', 300)]);
  assert.deepEqual(s.memberIds, []);
  assert.equal(s.top, 300);
  assert.equal(s.bottom, 300 + LANE_BOTTOM_PAD);
});

test('deriveLanes returns an empty array when there are no lanes', () => {
  assert.deepEqual(deriveLanes([{ id: 'n', x: 0, y: 0, width: 1, height: 1 }], []), []);
});

test('migrateSections converts legacy section nodes into lanes and strips node membership', () => {
  const canvas = { nodes: [
    { id: 's-old', type: 'section', x: 100, y: 40, width: 900, height: 500, title: 'mongo probe', createdAt: 7, folded: true },
    { id: 'n1', type: 'text', x: 300, y: 100, width: 200, height: 100, sectionId: 's-old' },
  ], edges: [] };
  const out = migrateSections(canvas, 999);
  assert.equal(out.nodes.length, 1);
  assert.equal(out.nodes[0].id, 'n1');
  assert.equal('sectionId' in out.nodes[0], false);
  assert.deepEqual(out.metadata.sections, [{ id: 's-old', y: 40, title: 'mongo probe', createdAt: 7, folded: [] }]);
});

test('migrateSections drops the legacy "Section" placeholder title so the datetime shows', () => {
  const canvas = { nodes: [
    { id: 's', type: 'section', x: 0, y: 0, width: 10, height: 10, title: 'Section' },
    { id: 'n', type: 'text', x: 0, y: 100, width: 10, height: 10 },
  ], edges: [] };
  const s = migrateSections(canvas, 999).metadata.sections[0];
  assert.equal(s.title, undefined);
  assert.equal(s.createdAt, 999);   // - no createdAt on the legacy node → stamped with `now`
});

test('migrateSections creates one lane at y=0 for a canvas that has nodes but no sections', () => {
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 300, width: 10, height: 10 }], edges: [] };
  const out = migrateSections(canvas, 999);
  assert.equal(out.metadata.sections.length, 1);
  assert.equal(out.metadata.sections[0].y, 0);
  assert.equal(out.metadata.sections[0].createdAt, 999);
});

test('migrateSections is idempotent — an already-migrated canvas returns the same reference', () => {
  // - node clear of the lane's header band, so there is genuinely nothing left to do
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 100, width: 10, height: 10 }], edges: [],
    metadata: { sections: [{ id: 'a', y: 0, createdAt: 1 }] } };
  assert.equal(migrateSections(canvas, 999), canvas);
});

test('migrateSections leaves an empty canvas untouched', () => {
  const canvas = { nodes: [], edges: [] };
  assert.equal(migrateSections(canvas, 999), canvas);
});

test('migrateSections preserves other metadata (aiModel must survive)', () => {
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 100, width: 10, height: 10 }], edges: [],
    metadata: { aiModel: 'opus' } };
  const out = migrateSections(canvas, 999);
  assert.equal(out.metadata.aiModel, 'opus');
  assert.equal(out.metadata.sections.length, 1);
});

test('migrateSections lifts a negative lane to the origin, carrying its nodes', () => {
  // - legacy sections sat one header-lane above their content, so migration produced a negative y.
  //   The band above y=0 is unusable (nodes are floored at 0), so it must be lifted away.
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 19, width: 10, height: 10 }], edges: [],
    metadata: { sections: [{ id: 'a', y: -44, createdAt: 1 }] } };
  const out = migrateSections(canvas, 999);
  assert.equal(out.metadata.sections[0].y, 0);   // - lane parked at the origin
  assert.equal(out.nodes[0].y, 19 + 44);         // - node carried down by the same amount
});


test('migrateSections leaves a non-negative lane alone (same reference)', () => {
  const canvas = { nodes: [{ id: 'n', type: 'text', x: 0, y: 100, width: 10, height: 10 }], edges: [],
    metadata: { sections: [{ id: 'a', y: 0, createdAt: 1 }] } };
  assert.equal(migrateSections(canvas, 999), canvas);
});

const node = (id, y, height = 100, x = 0, width = 100) => ({ id, x, y, width, height });

test('outputCellGeom: right of the cell, centred, floored at the section top', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  assert.deepEqual(outputCellGeom(lanes, { x: 0, y: 1000, width: 700, height: 300 }), { x: 840, y: 1000, width: 480, height: 320 });   // - centring would give 990: floored
  assert.deepEqual(outputCellGeom(lanes, { x: 0, y: 1500, width: 700, height: 300 }), { x: 840, y: 1490, width: 480, height: 320 });
  assert.deepEqual(outputCellGeom([], { x: 0, y: 0, width: 700, height: 300 }), { x: 840, y: -10, width: 480, height: 320 });         // - no lanes: plain centring
  assert.equal(outputCellGeom(lanes, { x: 0, y: 1500, width: 700, height: 300 }, 60).x, 760);
});

const typed = (id, type, y, x = 0) => ({ id, type, x, y, width: 100, height: 100 });

test('memberCodeCellsInRunOrder: unknown section or no code cells → []', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  assert.deepEqual(memberCodeCellsInRunOrder([typed('E1', 'code', 0)], lanes, 'zzz'), []);
  assert.deepEqual(memberCodeCellsInRunOrder([typed('T1', 'text', 0)], lanes, 'a'), []);
  assert.deepEqual(memberCodeCellsInRunOrder([], lanes, 'a'), []);
});

test('memberCodeCellsInRunOrder: top to bottom, then left to right, code cells only, own section only', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  const nodes = [
    typed('E3', 'code', 500, 0), typed('E2', 'code', 200, 300), typed('E1', 'code', 200, 0),
    typed('T1', 'text', 100), typed('E9', 'code', 1200),   // - T1 not code; E9 is in section b
  ];
  assert.deepEqual(memberCodeCellsInRunOrder(nodes, lanes, 'a'), ['E1', 'E2', 'E3']);
  assert.deepEqual(memberCodeCellsInRunOrder(nodes, lanes, 'b'), ['E9']);
});

test('memberCodeCellsInRunOrder: a cell above the first section belongs to it', () => {
  const lanes = [lane('a', 100)];
  assert.deepEqual(memberCodeCellsInRunOrder([typed('E1', 'code', -50)], lanes, 'a'), ['E1']);
});

test('parkFirstLaneAtOrigin: the topmost lane starts at 0; same reference when it already does', () => {
  const lanes = [lane('b', 1000), lane('c', 2000)];
  assert.deepEqual(parkFirstLaneAtOrigin(lanes).map(l => l.y), [0, 2000]);
  const ok = [lane('a', 0), lane('b', 1000)];
  assert.equal(parkFirstLaneAtOrigin(ok), ok);
  assert.equal(parkFirstLaneAtOrigin([]).length, 0);
});

test('migrateSections drops a stored colorIndex and is idempotent afterwards', () => {
  const canvas = { nodes: [node('n1', 0)], edges: [], metadata: { sections: [{ id: 'a', y: 0, createdAt: 1, colorIndex: 3 }] } };
  const once = migrateSections(canvas, 5);
  assert.deepEqual(once.metadata.sections, [{ id: 'a', y: 0, createdAt: 1 }]);
  assert.equal(migrateSections(once, 6), once);
});

test('laneIndexForNode: a pinned node belongs to the lane that lists it, whatever its y', () => {
  const lanes = [lane('a', 0, { folded: ['h1'] }), lane('b', 100)];
  const pinned = pinnedLaneIndex(lanes);
  assert.equal(laneIndexForNode(lanes, { id: 'h1', y: 5000 }, pinned), 0);
  assert.equal(laneIndexForNode(lanes, { id: 'n2', y: 5000 }, pinned), 1);
});

test('deriveLanes: pinned members are listed, hidden from content, and a folded lane is one grid tall', () => {
  const lanes = [lane('a', 0, { folded: ['h1'] }), lane('b', SECTION_FOLDED_H)];
  const nodes = [node('h1', 3000, 300), node('n2', SECTION_FOLDED_H)];
  const [a, b] = deriveLanes(nodes, lanes);
  assert.deepEqual(a.memberIds, ['h1']);
  assert.equal(a.bottom, SECTION_FOLDED_H);
  assert.deepEqual(b.memberIds, ['n2']);
  const [last] = deriveLanes([node('h1', 3000, 300)], [lane('a', 0, { folded: ['h1'] })]);
  assert.equal(last.bottom, SECTION_FOLDED_H);   // - a folded last lane is one grid, not content + pad
});

test('deriveLanes: a folded last lane with a stray visible node ends where the fit would put it', () => {
  const lanes = [lane('a', 0), lane('z', 1000, { folded: ['h9'] })];
  const nodes = [node('n1', 0), node('h9', 5000), node('v', 1000, 250)];
  const [, z] = deriveLanes(nodes, lanes);
  assert.equal(z.bottom, 1400);
});

test('memberCodeCellsInRunOrder includes pinned (folded) cells', () => {
  const lanes = [lane('a', 0, { folded: ['E9'] }), lane('b', 100)];
  const nodes = [typed('E9', 'code', 5000), typed('E1', 'code', 0)];
  assert.deepEqual(memberCodeCellsInRunOrder(nodes, lanes, 'a'), ['E1', 'E9']);
});

test('migrateSections: folded: true becomes the member ids by y, once', () => {
  const canvas = { nodes: [node('n1', 0), node('n2', 1200)], edges: [], metadata: { sections: [{ id: 'a', y: 0, createdAt: 1, folded: true }, lane('b', 1000)] } };
  const once = migrateSections(canvas, 5);
  assert.deepEqual(once.metadata.sections[0].folded, ['n1']);
  assert.equal(migrateSections(once, 6), once);
});

test('fitLanes: an empty middle lane grows to SECTION_MIN_H; the last lane never moves', () => {
  const lanes = [lane('a', 0), lane('b', 100), lane('c', 100 + SECTION_MIN_H)];
  const f = fitLanes(lanes, [node('n1', 0), node('n3', 100 + SECTION_MIN_H)]);
  assert.deepEqual(f.laneShifts, { b: SECTION_MIN_H - 100, c: SECTION_MIN_H - 100 });
  assert.deepEqual(f.nodeShifts, { n3: SECTION_MIN_H - 100 });
});

test('fitLanes: content taller than the minimum → content + GRID, snapped up', () => {
  const lanes = [lane('a', 0), lane('b', SECTION_MIN_H)];
  const f = fitLanes(lanes, [node('n1', 0, 950)]);   // - 950 + 100 = 1050 → 1100
  assert.deepEqual(f.laneShifts, { b: 1100 - SECTION_MIN_H });
});

test('fitLanes: slack shrinks the lane back, snapped, and everything below moves up', () => {
  const lanes = [lane('a', 0), lane('b', 2000), lane('c', 3000)];
  const nodes = [node('n1', 0, 300), node('n2', 2000, 900), node('n3', 3000)];   // - a needs max(800, 400) = 800 → −1200
  // - b: 900 + 100 = 1000 = its range, so only a shrinks
  const f = fitLanes(lanes, nodes);
  assert.deepEqual(f.laneShifts, { b: -1200, c: -1200 });
  assert.deepEqual(f.nodeShifts, { n2: -1200, n3: -1200 });
});

test('fitLanes: a folded lane is SECTION_FOLDED_H; its pinned members are ignored and move with it', () => {
  const lanes = [lane('a', 0), lane('b', SECTION_MIN_H, { folded: ['h1'] }), lane('c', SECTION_MIN_H + 2000)];
  const nodes = [node('n1', 0), node('h1', SECTION_MIN_H + 500, 300), node('n3', SECTION_MIN_H + 2000)];
  const f = fitLanes(lanes, nodes);
  assert.deepEqual(f.laneShifts, { c: SECTION_FOLDED_H - 2000 });
  assert.deepEqual(f.nodeShifts, { n3: SECTION_FOLDED_H - 2000 });   // - h1 stays: its lane b did not move
  const g = fitLanes([lane('a', 0), lane('b', 100, { folded: ['h1'] })], [node('n1', 0, 950), node('h1', 400)]);
  assert.deepEqual(g.nodeShifts, { h1: 1000 });   // - a grows to 1100: b and its pinned member move together
});

test('fitLanes: a visible node inside a folded lane still fits', () => {
  const lanes = [lane('a', 0, { folded: ['h1'] }), lane('b', SECTION_FOLDED_H)];
  const f = fitLanes(lanes, [node('h1', 5000), node('v', 0, 250)]);   // - 250 + 100 = 350 → 400
  assert.deepEqual(f.laneShifts, { b: 400 - SECTION_FOLDED_H });
});

test('fitLanes is idempotent after one application', () => {
  const canvas = { nodes: [node('n1', 0, 950), node('n2', 2000), node('n3', 3000)], edges: [], metadata: { sections: [lane('a', 0), lane('b', 2000), lane('c', 3000)] } };
  const once = applyLaneFit(canvas);
  assert.notEqual(once, canvas);
  assert.equal(applyLaneFit(once), once);
  assert.equal(once.metadata.sections[1].y, 1100);
  assert.equal(once.nodes.find(n => n.id === 'n2').y, 1100);
});

test('sectionTargetHeight: minimum, content, folded, folded with a visible node', () => {
  assert.equal(sectionTargetHeight(lane('a', 0), [node('n1', 0)]), SECTION_MIN_H);
  assert.equal(sectionTargetHeight(lane('a', 0), [node('n1', 0, 950)]), 1100);
  assert.equal(sectionTargetHeight(lane('a', 0, { folded: ['n1'] }), []), SECTION_FOLDED_H);
  assert.equal(sectionTargetHeight(lane('a', 0, { folded: ['n1'] }), [node('v', 0, 250)]), 400);
});

test('pinOutputToLane: an output of a pinned cell is pinned too; otherwise untouched', () => {
  const lanes = [lane('a', 0, { folded: ['E1'] }), lane('b', 100)];
  assert.deepEqual(pinOutputToLane(lanes, 'E1', 'O1')[0].folded, ['E1', 'O1']);
  assert.equal(pinOutputToLane(lanes, 'E2', 'O2'), lanes);
});

test('laneTopForNode and outputCellGeom respect pinning', () => {
  const lanes = [lane('a', 0, { folded: ['E1'] }), lane('b', 100)];
  assert.equal(laneTopForNode(lanes, { id: 'E1', y: 5000 }), 0);
  assert.equal(laneTopForNode(lanes, { id: 'E2', y: 5000 }), 100);
  assert.equal(outputCellGeom(lanes, { id: 'E1', x: 0, y: 5000, width: 700, height: 300 }).y, 4990);   // - pinned: no floor to lane b
});

test('pruneFoldedIds drops removed ids and returns the same reference when nothing changed', () => {
  const lanes = [lane('a', 0, { folded: ['x', 'y'] }), lane('b', 100)];
  assert.deepEqual(pruneFoldedIds(lanes, new Set(['y']))[0].folded, ['x']);
  assert.equal(pruneFoldedIds(lanes, new Set(['z'])), lanes);
});

test('fold then unfold is a round trip: members stay in their section, S3 returns', () => {
  const lanes0 = [lane('S1', 0), lane('S2', 800), lane('S3', 1600)];
  const nodes0 = [node('n1', 0, 300), node('n2', 800, 300), node('n2b', 1200, 300), node('n3', 1600, 300)];
  assert.deepEqual(fitLanes(lanes0, nodes0).laneShifts, {});                       // - at rest
  const folded = lanes0.map(l => (l.id === 'S2' ? { ...l, folded: ['n2', 'n2b'] } : l));
  const c1 = applyLaneFit({ nodes: nodes0, edges: [], metadata: { sections: folded } });
  assert.equal(c1.metadata.sections.find(l => l.id === 'S3').y, 900);
  const u = unfoldLane(c1.metadata.sections, c1.nodes, 'S2');
  assert.deepEqual(u.laneShifts, { S3: 700 });
  assert.deepEqual(u.nodeShifts, { n3: 700 });                                       // - n2b is NOT shifted
  const lanes2 = u.lanes, nodes2 = c1.nodes.map(n => (u.nodeShifts[n.id] ? { ...n, y: n.y + u.nodeShifts[n.id] } : n));
  assert.equal(lanes2.find(l => l.id === 'S3').y, 1600);
  assert.deepEqual(deriveLanes(nodes2, lanes2).map(l => l.memberIds), [['n1'], ['n2', 'n2b'], ['n3']]);
  assert.deepEqual(fitLanes(lanes2, nodes2).laneShifts, {});                       // - at rest again
  assert.equal(unfoldLane(lanes2, nodes2, 'S2').lanes, lanes2);                   // - not folded: same reference
});

test('fitLanes parks the first lane at the origin without moving its members', () => {
  // - a's target is measured from y = 0: max(800, 200 + 100 - 0) = 800; b's range from 0 is 1100
  const f = fitLanes([lane('a', 100), lane('b', 1100)], [node('n1', 100), node('n2', 1100)]);
  assert.deepEqual(f.laneShifts, { a: -100, b: -300 });
  assert.deepEqual(f.nodeShifts, { n2: -300 });
});

test('fitLanes parks a lone first lane too', () => {
  const f = fitLanes([lane('a', 100)], [node('n1', 100)]);
  assert.deepEqual(f.laneShifts, { a: -100 });
  assert.deepEqual(f.nodeShifts, {});
  assert.deepEqual(fitLanes([lane('a', 0)], [node('n1', 0)]).laneShifts, {});   // - already parked
  assert.deepEqual(fitLanes([], []).laneShifts, {});
});

test('applyLaneFit: a canvas whose first lane sits below the origin comes back parked, settled', () => {
  const canvas = { nodes: [node('n1', 100), node('n2', 1100)], edges: [], metadata: { sections: [lane('a', 100), lane('b', 1100)] } };
  const once = applyLaneFit(canvas);
  assert.deepEqual(once.metadata.sections.map(l => l.y), [0, 800]);
  assert.equal(once.nodes.find(n => n.id === 'n1').y, 100);   // - lane 0's members do not move
  assert.equal(once.nodes.find(n => n.id === 'n2').y, 800);
  assert.equal(applyLaneFit(once), once);
});

test('applyLaneFit seeds the first section for a canvas that has content but none', () => {
  const seeded = applyLaneFit({ nodes: [node('n1', 0)], edges: [], metadata: {} }, 5);
  assert.equal(seeded.metadata.sections.length, 1);
  assert.equal(seeded.metadata.sections[0].y, 0);
  const emptyCanvas = { nodes: [], edges: [], metadata: {} };
  assert.equal(applyLaneFit(emptyCanvas, 5), emptyCanvas);   // - nothing to hold a section: same reference
});

test('sectionByRef: S# by stack order, or the lane id; null otherwise', () => {
  const lanes = [lane('b', 1000), lane('a', 0)];
  assert.equal(sectionByRef(lanes, 'S1').id, 'a');
  assert.equal(sectionByRef(lanes, 's2').id, 'b');
  assert.equal(sectionByRef(lanes, 'b').id, 'b');
  assert.equal(sectionByRef(lanes, 'S3'), null);
  assert.equal(sectionByRef(lanes, 'nope'), null);
});

test('insertLaneAt: snapped, inserted, sorted; same reference when a lane already starts there', () => {
  const lanes = [lane('a', 0), lane('c', 2000)];
  const out = insertLaneAt(lanes, 1049, 7, 'sec-x');
  assert.deepEqual(out.map(l => [l.id, l.y]), [['a', 0], ['sec-x', 1000], ['c', 2000]]);
  assert.equal(insertLaneAt(lanes, 2000, 7, 'sec-y'), lanes);
  assert.equal(insertLaneAt(lanes, -50, 7, 'sec-z'), lanes);   // - above the origin: refused
});

test('insertLaneAt never reuses an id already on the canvas', () => {
  const lanes = [lane('sec-k', 0)];
  const out = insertLaneAt(lanes, 1000, 7, 'sec-k');
  assert.deepEqual(out.map(l => l.id), ['sec-k', 'sec-k-2']);
  assert.deepEqual(insertLaneAt(out, 2000, 7, 'sec-k').map(l => l.id), ['sec-k', 'sec-k-2', 'sec-k-3']);
});

test('insertLaneAt refuses a negative y on the raw argument, not the snapped one', () => {
  const lanesC = [lane('c', 2000)];
  assert.equal(insertLaneAt(lanesC, -40, 7, 'sec-w'), lanesC);   // - snaps to -0, still refused
});

test('foldLane: lists the visible members, ignores already-pinned ids, same reference when folded', () => {
  const lanes = [lane('a', 0), lane('b', 1000)];
  const nodes = [node('n1', 0), node('n2', 300), node('n3', 1000)];
  const out = foldLane(lanes, nodes, 'a');
  assert.deepEqual(out[0].folded, ['n1', 'n2']);
  assert.equal(foldLane(out, nodes, 'a'), out);
  assert.equal(foldLane(lanes, nodes, 'zzz'), lanes);
});

test('allFolded: true only when every lane is folded, false with none or some, false with no lanes', () => {
  assert.equal(allFolded([]), false);
  assert.equal(allFolded([lane('a', 0), lane('b', 500)]), false);
  assert.equal(allFolded([lane('a', 0, { folded: ['n1'] }), lane('b', 500)]), false);
  assert.equal(allFolded([lane('a', 0, { folded: [] }), lane('b', 500, { folded: ['n2'] })]), true);
});

test('applyLaneFit with `own` grows the section a pushed node left instead of the next one adopting it', () => {
  // - the layout engine has just packed S1's column and put n3 exactly on S2's top edge
  const canvas = {
    nodes: [node('n1', 400, 300), node('n2', 800, 300), node('n3', 1200, 300), node('n4', 1200, 300)],
    edges: [],
    metadata: { sections: [lane('a', 0), lane('b', 1200)] },
  };
  // - without `own`, n3's y makes it S2's content: S1 keeps its range and the overlap on n4 stays
  const loose = applyLaneFit(canvas, 7);
  assert.deepEqual(loose.metadata.sections.map(l => l.y), [0, 1200]);
  assert.equal(loose.nodes.find(n => n.id === 'n3').y, 1200);
  assert.equal(loose.nodes.find(n => n.id === 'n4').y, 1200);

  // - with it, n3 still counts for S1: S1 grows to hold it and S2 and n4 move down by the same step
  const own = new Map([['n1', 0], ['n2', 0], ['n3', 0]]);
  const fitted = applyLaneFit(canvas, 7, own);
  assert.deepEqual(fitted.metadata.sections.map(l => l.y), [0, 1600]);
  assert.equal(fitted.nodes.find(n => n.id === 'n3').y, 1200, 'the pushed node stays where the engine put it');
  assert.equal(fitted.nodes.find(n => n.id === 'n4').y, 1600, 'the section below and its members move down');
});

test('groupIdsByLane splits ids by the lane they are in, keeps their order and drops the rest', () => {
  const derived = [
    { id: 'a', memberIds: ['n1', 'n2', 'n3'] },
    { id: 'b', memberIds: ['n4', 'n5'] },
  ];
  const groups = groupIdsByLane(derived, ['n5', 'n3', 'n1', 'gone', 'n4']);
  assert.deepEqual([...groups.keys()], ['b', 'a']);      // - first id seen names the first group
  assert.deepEqual(groups.get('a'), ['n3', 'n1']);       // - the order they arrived in, not lane order
  assert.deepEqual(groups.get('b'), ['n5', 'n4']);
  assert.equal(groups.size, 2, 'an id in no lane is dropped');
  assert.deepEqual([...groupIdsByLane([], ['n1']).keys()], []);
});
