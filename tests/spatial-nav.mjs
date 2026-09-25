// - run: npx esbuild src/webview/canvas/spatialNav.ts --bundle --format=esm --outfile=tests/.build/spatialNav.mjs && node --test tests/spatial-nav.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { connectionLabels, edgesOnSide, findNearestNode, focusAfterDelete, navScore, revealPan } from './.build/spatialNav.mjs';

// - three stacked sections; one node per section, plus `r` to the right of `b` in S2
const lane = (id, y, folded) => (folded ? { id, y, createdAt: 1, folded } : { id, y, createdAt: 1 });
const node = (id, x, y) => ({ id, x, y, w: 700, h: 300 });

const a = node('a', 100, 200);
const b = node('b', 100, 1700);
const c = node('c', 100, 3300);
const r = node('r', 1000, 1700);
const NODES = [a, b, c, r];

const lanes = (s2folded, s3folded) => [lane('S1', 0), lane('S2', 1600, s2folded), lane('S3', 3200, s3folded)];
const ctx = (over = {}) => ({ nodes: NODES, edges: [], lanes: lanes(), ...over });
const edge = (source, target, sourceHandle, targetHandle = null) => ({ source, target, sourceHandle, targetHandle });

test('1. down from a lands in the next section', () => {
  assert.equal(findNearestNode(a, 'down', ctx()), 'b');
});

test('2. a folded section is passed over', () => {
  // - a fold pins every visible member of the lane, so S2 folded hides r along with b
  assert.equal(findNearestNode(a, 'down', ctx({ lanes: lanes(['b', 'r']) })), 'c');
});

test('3. nothing visible below → no move', () => {
  assert.equal(findNearestNode(a, 'down', ctx({ lanes: lanes(['b', 'r'], ['c']) })), null);
});

test('4. right never leaves the section', () => {
  assert.equal(findNearestNode(a, 'right', ctx()), null);
});

test('5. right inside the section', () => {
  assert.equal(findNearestNode(b, 'right', ctx()), 'r');
});

test('6. an edge into a folded node is not followed', () => {
  const over = { edges: [edge('a', 'b', 'bottom')], lanes: lanes(['b', 'r']) };
  assert.equal(findNearestNode(a, 'down', ctx(over)), 'c');
});

test('7. an edge takes right across no section, and down to no node outside the column', () => {
  assert.equal(findNearestNode(a, 'right', ctx({ edges: [edge('a', 'r', 'right')] })), null);
  // - b and c dropped; r is wired from a's bottom but sits outside a's column (x 1000-1700 against 100-800)
  const only = { nodes: [a, r], edges: [edge('a', 'r', 'bottom')] };
  assert.equal(findNearestNode(a, 'down', ctx(only)), null);
});

test('8. up crosses into the open section above, skipping a folded one', () => {
  assert.equal(findNearestNode(c, 'up', ctx()), 'b');
  assert.equal(findNearestNode(c, 'up', ctx({ lanes: lanes(['b', 'r']) })), 'a');
});

test('9. no sections at all: plain geometry', () => {
  assert.equal(findNearestNode(a, 'down', ctx({ lanes: [] })), 'b');
});

// - measured on test/H4.canvas: one column, an edge from the top node straight to the bottom one
const E5 = node('E5', 8000, 500);
const N8 = node('N8', 8000, 900);
const E2 = node('E2', 8000, 1300);
const h4 = { nodes: [E5, N8, E2], edges: [edge('E5', 'E2', 'bottom', 'top')], lanes: [lane('S1', 0)] };

test('10. the wired node does not hide the unwired node between them', () => {
  assert.equal(findNearestNode(E5, 'down', h4), 'N8');
  assert.equal(findNearestNode(N8, 'down', h4), 'E2');
  assert.equal(findNearestNode(E2, 'up', h4), 'N8');
  assert.equal(findNearestNode(N8, 'up', h4), 'E5');
});

test('11. a wired node outside the row band is never a target, for down or for right', () => {
  const far = node('far', 6000, 800);
  const over = { nodes: [a, far], lanes: [lane('S1', 0)] };
  assert.equal(findNearestNode(a, 'down', ctx(over)), null);
  assert.equal(findNearestNode(a, 'down', ctx({ ...over, edges: [edge('a', 'far', 'bottom')] })), null);
  // - 200 right of a and 2500 below its row: no shared row band, wired or not
  const low = node('low', 1000, 3000);
  const side = { nodes: [a, low], lanes: [lane('S1', 0)] };
  assert.equal(findNearestNode(a, 'right', ctx(side)), null);
  assert.equal(findNearestNode(a, 'right', ctx({ ...side, edges: [edge('a', 'low', 'right')] })), null);
});

// - revealPan: `area` and the result are pane pixels, the boxes flow coordinates
const AREA = { left: 0, top: 0, right: 1000, bottom: 600 };
const NODE_BOX = { x1: 100, y1: 100, x2: 460, y2: 300 };
const PAIR_FITS = { x1: 100, y1: 40, x2: 960, y2: 360 };
const PAIR_WIDE = { x1: 100, y1: 40, x2: 1500, y2: 360 };

test('12. a node already inside the area does not move the viewport', () => {
  assert.equal(revealPan(NODE_BOX, null, AREA, { x: 0, y: 0, zoom: 1 }), null);
});

test('13. the pair fits, so its right edge decides', () => {
  assert.equal(revealPan(NODE_BOX, PAIR_FITS, AREA, { x: 0, y: 0, zoom: 1 }), null);
  assert.deepEqual(revealPan(NODE_BOX, PAIR_FITS, AREA, { x: 100, y: 0, zoom: 1 }), { x: 16, y: 0 });
});

test('14. the pair does not fit, so the visible node alone decides', () => {
  assert.equal(revealPan(NODE_BOX, PAIR_WIDE, AREA, { x: 0, y: 0, zoom: 1 }), null);
});

test('15. off-screen node with a fitting pair pans on the pair', () => {
  assert.deepEqual(revealPan(NODE_BOX, PAIR_FITS, AREA, { x: -500, y: 0, zoom: 1 }), { x: -76, y: 0 });
});

test('16. off-screen node with a too-wide pair pans on the node', () => {
  assert.deepEqual(revealPan(NODE_BOX, PAIR_WIDE, AREA, { x: -500, y: 0, zoom: 1 }), { x: -76, y: 0 });
});

test('17. zooming out makes the same pair fit', () => {
  assert.deepEqual(revealPan(NODE_BOX, PAIR_WIDE, AREA, { x: 300, y: 0, zoom: 0.5 }), { x: 226, y: 4 });
});

test('18. the margin is measured from the area edge, not from zero', () => {
  const box = { x1: 0, y1: 100, x2: 360, y2: 300 };
  assert.deepEqual(revealPan(box, null, { ...AREA, left: 44 }, { x: 0, y: 0, zoom: 1 }), { x: 68, y: 0 });
});

// - measured on test/H4.canvas: a tall node one grid to the right of N17, and a short one far past it
const N17 = { id: 'N17', x: 2400, y: 1700, w: 700, h: 300 };
const C6  = { id: 'C6',  x: 3200, y: 1600, w: 700, h: 1400 };
const N11 = { id: 'N11', x: 4100, y: 1700, w: 700, h: 300 };
const tall = { nodes: [N17, C6, N11], edges: [edge('N17', 'C6', 'right', 'left')], lanes: [lane('S1', 0)] };

test('19. the tall neighbour beats the far one: gap 100 against gap 1000', () => {
  assert.equal(navScore(N17, C6, 'right'), 100);
  assert.equal(navScore(N17, N11, 'right'), 1000);
  assert.equal(findNearestNode(N17, 'right', tall), 'C6');
  assert.equal(findNearestNode(C6, 'left', tall), 'N17');
  // - back from N11: C6 is 200 away and overlaps it in y, N17 is 1000 away
  assert.equal(findNearestNode(N11, 'left', tall), 'C6');
});

test('20. the tall box does not pull up or down', () => {
  assert.equal(findNearestNode(C6, 'up', tall), null);
  assert.equal(findNearestNode(N17, 'down', tall), null);
  assert.equal(findNearestNode(C6, 'down', tall), null);
});

// - also measured on test/H4.canvas: M2's bottom is N18's top and N13's bottom is C6's top, so both
//   pairs touch without sharing any of the row
const N18 = { id: 'N18', x: 3200, y: 1200, w: 700, h: 300 };
const M2  = { id: 'M2',  x: 4000, y: 100,  w: 700, h: 1100 };
const N13 = { id: 'N13', x: 4000, y: 1300, w: 700, h: 300 };
const rows = { nodes: [N18, M2, N13, C6, N11], edges: [], lanes: [lane('S1', 0)] };

test('21. the same gap goes to the node that shares the row, not the one that touches it', () => {
  // - M2 and N13 both start one grid past N18; M2 only touches its top edge, N13 overlaps it by 200
  assert.equal(navScore(N18, M2, 'right'), 350);
  assert.equal(navScore(N18, N13, 'right'), 100);
  assert.equal(findNearestNode(N18, 'right', rows), 'N13');
});

test('22. an overlapping node one grid further out beats a touching one', () => {
  assert.equal(navScore(C6, N13, 'right'), 350);
  assert.equal(navScore(C6, N11, 'right'), 200);
  assert.equal(findNearestNode(C6, 'right', rows), 'N11');
});

// - edgesOnSide: the g-chord order on one border. The slot comes from the routing pass — `variant`
//   where the focused node is the edge's source, `variantIn` where it is the target.
const S = { id: 'S', x: 0, y: 1000, w: 700, h: 300 };
const T1 = { id: 'T1', x: 1000, y: 400,  w: 700, h: 300 };
const T2 = { id: 'T2', x: 1000, y: 1000, w: 700, h: 300 };
const T3 = { id: 'T3', x: 1000, y: 1600, w: 700, h: 300 };
const withId = (id, source, target, sourceHandle, targetHandle = null) => ({ id, source, target, sourceHandle, targetHandle });
const route = (variant, variantIn, points = []) => ({ variant, variantIn, points });

test('23. the right border is ordered by the exit slot, not by the edge order', () => {
  // - e1 is drawn third on the border, e2 first, e3 second
  const edges = [withId('e1', 'S', 'T1', 'right', 'left'), withId('e2', 'S', 'T2', 'right', 'left'), withId('e3', 'S', 'T3', 'right', 'left')];
  const routes = new Map([['e1', route(2, 0)], ['e2', route(0, 0)], ['e3', route(1, 0)]]);
  const got = edgesOnSide(S, 'right', { nodes: [S, T1, T2, T3], edges, routes });
  assert.deepEqual(got.map(c => c.nodeId), ['T2', 'T3', 'T1']);
  assert.deepEqual(got.map(c => c.edgeId), ['e2', 'e3', 'e1']);
});

test('24. where the focused node is the target the slot is variantIn', () => {
  const edges = [withId('e1', 'T1', 'S', 'right', 'left'), withId('e2', 'T2', 'S', 'right', 'left')];
  // - variant (0 / 0) is each source's own border; only variantIn orders S's left border
  const routes = new Map([['e1', route(0, 1)], ['e2', route(0, 0)]]);
  const got = edgesOnSide(S, 'left', { nodes: [S, T1, T2], edges, routes });
  assert.deepEqual(got.map(c => c.nodeId), ['T2', 'T1']);
});

test('25. an unrouted edge sorts after the routed ones, by the other end\'s y', () => {
  const edges = [withId('e1', 'S', 'T1', 'right', 'left'), withId('e2', 'S', 'T2', 'right', 'left'), withId('e3', 'S', 'T3', 'right', 'left')];
  // - only e3 was routed; T1 (y 400) and T2 (y 1000) follow it in y order
  const routes = new Map([['e3', route(0, 0)]]);
  const got = edgesOnSide(S, 'right', { nodes: [S, T1, T2, T3], edges, routes });
  assert.deepEqual(got.map(c => c.nodeId), ['T3', 'T1', 'T2']);
});

test('26. the candidate carries the point its edge meets the border at', () => {
  const edges = [withId('e1', 'S', 'T1', 'right', 'left'), withId('e2', 'T2', 'S', 'right', 'left')];
  const routes = new Map([['e1', route(0, 0, [[700, 1140], [850, 1140], [850, 550]])], ['e2', route(0, 1, [[1000, 1150], [700, 1160]])]]);
  const right = edgesOnSide(S, 'right', { nodes: [S, T1, T2], edges, routes });
  // - S is e1's source, so its point is the first of the polyline
  assert.deepEqual(right.map(c => c.at), [[700, 1140]]);
  const left = edgesOnSide(S, 'left', { nodes: [S, T1, T2], edges, routes });
  // - S is e2's target, so its point is the last
  assert.deepEqual(left.map(c => c.at), [[700, 1160]]);
});

test('27. two edges to the same node on one border are one candidate, on the first slot', () => {
  const edges = [withId('e1', 'S', 'T1', 'right', 'left'), withId('e2', 'S', 'T1', 'right', 'left'), withId('e3', 'S', 'T3', 'right', 'left')];
  const routes = new Map([['e1', route(2, 0)], ['e2', route(0, 0)], ['e3', route(1, 0)]]);
  const got = edgesOnSide(S, 'right', { nodes: [S, T1, T3], edges, routes });
  assert.deepEqual(got.map(c => c.nodeId), ['T1', 'T3']);
  assert.equal(got[0].edgeId, 'e2');
});

test('28. a node the caller left out of `nodes` is no candidate, and a hidden border is empty', () => {
  const edges = [withId('e1', 'S', 'T1', 'right', 'left'), withId('e2', 'S', 'T2', 'right', 'left')];
  const routes = new Map([['e1', route(0, 0)], ['e2', route(1, 0)]]);
  assert.deepEqual(edgesOnSide(S, 'right', { nodes: [S, T2], edges, routes }).map(c => c.nodeId), ['T2']);
  assert.deepEqual(edgesOnSide(S, 'top', { nodes: [S, T1, T2], edges, routes }), []);
});

test('29. no handle: the border comes from the geometry', () => {
  const edges = [withId('e1', 'S', 'T1'), withId('e2', 'S', 'T3')];
  const routes = new Map([['e1', route(1, 0)], ['e2', route(0, 0)]]);
  // - both targets sit right of S and further across than down, so both land on the right border
  assert.deepEqual(edgesOnSide(S, 'right', { nodes: [S, T1, T3], edges, routes }).map(c => c.nodeId), ['T3', 'T1']);
});

// - connectionLabels: the key `g` shows on every connection of a node. The first of a border is that
//   border's vim key; every further one takes the next symbol of the one shared sequence, walked
//   left, top, right, bottom.
const L1 = { id: 'L1', x: -1000, y: 700,  w: 700, h: 300 };
const L2 = { id: 'L2', x: -1000, y: 1300, w: 700, h: 300 };

test('30. two connections left and three right read h 1 and l 2 3', () => {
  const edges = [
    withId('eL1', 'L1', 'S', 'right', 'left'), withId('eL2', 'L2', 'S', 'right', 'left'),
    withId('eR1', 'S', 'T1', 'right', 'left'), withId('eR2', 'S', 'T2', 'right', 'left'), withId('eR3', 'S', 'T3', 'right', 'left'),
  ];
  const routes = new Map([
    ['eL1', route(0, 0)], ['eL2', route(0, 1)],
    ['eR1', route(0, 0)], ['eR2', route(1, 0)], ['eR3', route(2, 0)],
  ]);
  const got = connectionLabels(S, { nodes: [S, L1, L2, T1, T2, T3], edges, routes });
  assert.deepEqual(got.map(c => c.label), ['h', '1', 'l', '2', '3']);
  assert.deepEqual(got.map(c => c.side), ['left', 'left', 'right', 'right', 'right']);
  assert.deepEqual(got.map(c => c.nodeId), ['L1', 'L2', 'T1', 'T2', 'T3']);
});

test('31. twelve connections on one border read h then 1-9 a b', () => {
  const nodes = [S];
  const edges = [];
  const routes = new Map();
  for (let i = 0; i < 12; i++) {
    const n = { id: `R${i}`, x: 1000, y: 100 + i * 400, w: 700, h: 300 };
    nodes.push(n);
    edges.push(withId(`e${i}`, 'S', n.id, 'right', 'left'));
    routes.set(`e${i}`, route(i, 0));
  }
  const got = connectionLabels(S, { nodes, edges, routes });
  assert.deepEqual(got.map(c => c.label), ['l', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b']);
});

test('32. a node with no connection gets no labels', () => {
  assert.deepEqual(connectionLabels(S, { nodes: [S, T1], edges: [], routes: new Map() }), []);
});

test('33. the sequence never hands out g, h, j, k or l', () => {
  const nodes = [S];
  const edges = [];
  const routes = new Map();
  // - 30 on the top border: one takes k, the other 29 come out of the sequence
  for (let i = 0; i < 30; i++) {
    const n = { id: `U${i}`, x: -6000 + i * 400, y: -400, w: 300, h: 300 };
    nodes.push(n);
    edges.push(withId(`u${i}`, 'S', n.id, 'top', 'bottom'));
    routes.set(`u${i}`, route(i, 0));
  }
  const got = connectionLabels(S, { nodes, edges, routes });
  assert.equal(got[0].label, 'k');
  assert.deepEqual(got.slice(1).map(c => c.label).join(''), '123456789abcdefimnopqrstuvwxy');
  for (const c of got.slice(1)) assert.ok(!'ghjkl'.includes(c.label), `sequence handed out ${c.label}`);
});

test('34. the label carries the point and the edge it names', () => {
  const edges = [withId('e1', 'S', 'T1', 'right', 'left'), withId('e2', 'S', 'T2', 'right', 'left')];
  const routes = new Map([['e1', route(0, 0, [[700, 1140], [700, 550]])], ['e2', route(1, 0)]]);
  const got = connectionLabels(S, { nodes: [S, T1, T2], edges, routes });
  assert.deepEqual(got.map(c => [c.label, c.edgeId]), [['l', 'e1'], ['1', 'e2']]);
  // - e2 was not routed, so it has no point of its own; the caller places that badge
  assert.deepEqual(got.map(c => c.at), [[700, 1140], undefined]);
});

// - focusAfterDelete: a node goes from S1; the survivors sit in S1 and in the section below
const GONE = { x: 0, y: 0, w: 200, h: 100, sectionId: 'S1' };
const surv = (id, x, y, sectionId, hidden = false) => ({ id, x, y, w: 200, h: 100, hidden, sectionId });

test('35. the focus stays in the section the deleted node sat in', () => {
  // - n2 is 100 away and n1 is 800, but n1 is the one in S1
  const n1 = surv('n1', 1000, 0, 'S1');
  const n2 = surv('n2', 0, 200, 'S2');
  assert.equal(focusAfterDelete(GONE, [n2, n1]), 'n1');
});

test('36. a folded node is never focused', () => {
  const folded = surv('folded', 300, 0, 'S1', true);
  const open = surv('open', 1000, 0, 'S1');
  assert.equal(focusAfterDelete(GONE, [folded, open]), 'open');
});

test('37. with its own section folded away the focus crosses to an open one', () => {
  const folded = surv('folded', 300, 0, 'S1', true);
  const other = surv('other', 0, 2000, 'S2');
  assert.equal(focusAfterDelete(GONE, [folded, other]), 'other');
});

test('38. nothing visible left → no focus', () => {
  assert.equal(focusAfterDelete(GONE, []), null);
  assert.equal(focusAfterDelete(GONE, [surv('a', 300, 0, 'S1', true), surv('b', 0, 2000, 'S2', true)]), null);
});

test('39. inside the section the nearest box wins, measured edge to edge', () => {
  // - tall is centred far below, but its top edge is 40 under the hole; wide is 300 to the right
  const tall = surv('tall', 0, 140, 'S1');
  const wide = surv('wide', 500, 0, 'S1');
  assert.equal(focusAfterDelete(GONE, [wide, tall]), 'tall');
});

// - j / k stay in the focused node's column: a candidate has to share part of its x-span. The boxes
//   are H3's as the layout suite's h3Case keeps them (tests/layout-engine.mjs, test 74).
const E10 = node('E10', 2400, 3700);
const E11 = node('E11', 2400, 4100);
const N14 = node('N14', 800, 3900);
const N15 = node('N15', 800, 4300);
const N16 = node('N16', 3200, 4100);
const h3 = (extra = [], edges = []) => ({
  nodes: [E10, E11, N14, N15, N16, ...extra],
  edges: [edge('E10', 'E11', 'bottom', 'top'), edge('E11', 'N16', 'right', 'left'), ...edges],
  lanes: [lane('S1', 0)],
});

test('40. H3: nothing under E11 in its column, so j does not move; k goes to E10', () => {
  assert.equal(findNearestNode(E11, 'down', h3()), null);
  assert.equal(findNearestNode(E11, 'up', h3()), 'E10');
});

test('41. a wide node below that spans the column is taken', () => {
  const wide = { id: 'wide', x: 1600, y: 4800, w: 1400, h: 300 };
  assert.equal(findNearestNode(E11, 'down', h3([wide])), 'wide');
});

test('42. a node below, offset by less than its width, shares the column and is taken', () => {
  const offset = node('offset', 2800, 4600);
  assert.equal(findNearestNode(E11, 'down', h3([offset])), 'offset');
});

test('43. a node connected from the bottom border but outside the column is not a j target', () => {
  const wired = node('wired', 1600, 4600);
  assert.equal(findNearestNode(E11, 'down', h3([wired], [edge('E11', 'wired', 'bottom', 'top')])), null);
});

test('44. a node below one column over, near enough to be roughly aligned, is not a j target', () => {
  // - 400 below E11's bottom and 100 left of its x-span: inside the 0.6 × gap that h / l allow
  const near = node('near', 1600, 4800);
  assert.equal(findNearestNode(E11, 'down', h3([near])), null);
});

// - measured on test/H3.canvas: a wide note with a bottom→top edge to a node that now sits above it
//   after a layout change, plus an unwired node below that shares its column
const WIDE = { id: 'WIDE', x: 0, y: 1000, w: 2000, h: 300 };
const ABOVE = node('ABOVE', 200, 100);
const BELOW = node('BELOW', 200, 2000);
const wideCtx = (extra = []) => ({
  nodes: [WIDE, ABOVE, ...extra],
  edges: [edge('WIDE', 'ABOVE', 'bottom', 'top')],
  lanes: [lane('S1', 0)],
});

test('45. a wired node behind the pressed direction never beats an unwired one ahead', () => {
  assert.equal(findNearestNode(WIDE, 'down', wideCtx([BELOW])), 'BELOW');
});

test('46. a wired node behind the pressed direction is not a candidate even alone', () => {
  assert.equal(findNearestNode(WIDE, 'down', wideCtx()), null);
});

// - measured on H3: N1's row is y 0-300; nothing to its right shares it, so l does not move even
//   though N8 sits inside the old cone allowance
const rowN1 = node('N1', 800, 0);
const rowE7 = node('E7', 2300, 900);
const rowN8 = node('N8', 3100, 900);
const rowCtx = (extra = []) => ({ nodes: [rowN1, rowE7, rowN8, ...extra], edges: [], lanes: [lane('S1', 0)] });

test('47. H3: l returns null when nothing shares N1\'s row band', () => {
  assert.equal(findNearestNode(rowN1, 'right', rowCtx()), null);
});

test('48. l reaches a node that shares part of the row band', () => {
  const inBand = node('inBand', 1600, 100);
  assert.equal(findNearestNode(rowN1, 'right', rowCtx([inBand])), 'inBand');
});

test('49. h reaches a node that shares part of the row band, the same way', () => {
  const inBand = node('inBand', -700, 100);
  assert.equal(findNearestNode(rowN1, 'left', rowCtx([inBand])), 'inBand');
});

// - measured on H3: M2's row (y 800-1500) is shared by both N7 and M3, each 100 px away — a tied
//   gap. The tie goes to N7, whose top matches M2's, not to M3 merely because it sits first in the
//   canvas node order
const tieM2 = { id: 'M2', x: 0,   y: 800,  w: 700, h: 700 };
const tieN7 = { id: 'N7', x: 800, y: 800,  w: 700, h: 300 };
const tieM3 = { id: 'M3', x: 800, y: 1200, w: 700, h: 700 };
const tieCtx = { nodes: [tieM2, tieM3, tieN7], edges: [], lanes: [lane('S1', 0)] };

test('50. a tied gap goes to the node whose top is closest, not to canvas order', () => {
  assert.equal(findNearestNode(tieM2, 'right', tieCtx), 'N7');
  assert.equal(findNearestNode(tieN7, 'left', tieCtx), 'M2');
});

// - the same tie, rotated 90°: two candidates below V0 share its column and sit the same gap away;
//   V2 is first in canvas order, but V1's left edge matches V0's
const tieV0 = { id: 'V0', x: 800,  y: 0,   w: 700, h: 700 };
const tieV1 = { id: 'V1', x: 800,  y: 800, w: 300, h: 700 };
const tieV2 = { id: 'V2', x: 1200, y: 800, w: 700, h: 700 };
const tieVCtx = { nodes: [tieV0, tieV2, tieV1], edges: [], lanes: [lane('S1', 0)] };

test('51. a tied gap on j / k goes to the node whose left edge is closest', () => {
  assert.equal(findNearestNode(tieV0, 'down', tieVCtx), 'V1');
});
