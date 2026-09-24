// - run: npx esbuild src/shared/edgeRouting.ts --bundle --format=esm --outfile=tests/.build/edgeRouting.mjs && node --test tests/edge-routing.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { edgeKind, facingSide, buildGapGraph, routeSection, LANE_STEP, BEND_COST, MAX_CROSSINGS } from './.build/edgeRouting.mjs';

// - mirrors src/shared/constants.ts; the bundle does not re-export it
const GRID = 100;

const code = (id, x, y, w = 700, h = 300, out) => ({ id, type: 'code', x, y, w, h, ...(out ? { outputNodeId: out } : {}) });
const cell = (id, x, y, w = 600, h = 300) => ({ id, type: 'cell', x, y, w, h });
const note = (id, x, y, w = 700, h = 300) => ({ id, type: 'text', x, y, w, h });
const know = (id, x, y, w = 700, h = 300) => ({ id, type: 'knowledge', x, y, w, h });
const link = (id, source, target, sourceSide, targetSide) => ({
  id, source, target,
  ...(sourceSide ? { sourceSide } : {}), ...(targetSide ? { targetSide } : {}),
});
const byId = nodes => new Map(nodes.map(n => [n.id, n]));
const routeOf = (routes, id) => routes.find(r => r.id === id);

// - the two-column section of plan cases 2-5: a code column at x 0, its neighbours at x 800
const twoColumns = () => [code('E1', 0, 0), code('E2', 0, 400), cell('C1', 800, 0)];

// - measured over the 300 sections of case 10, seed 20260911: how many pairs of runs come out drawn
//   over each other, and the longest stretch any one pair shares. All 250 are two first or last
//   runs, 99 of them sharing more than one grid. Each edge searches on the row its own end point
//   stands on, so it reaches the target border in two corners along that row; every node of a row
//   of this generator has the same height, so the same middle, and two edges ending in one row draw
//   their last run on one line. Neither can move: a run that ends at a border point is held there.
const PAIRS = 250, LONGEST = 2460;

assert.equal(LANE_STEP, 10);
assert.equal(BEND_COST, GRID);

// 1
test('edgeKind: output for a cell and the output it names, sequence for code to code, context for the rest', () => {
  const nodes = [code('E1', 0, 0, 700, 300, 'O1'), cell('O1', 800, 0), code('E2', 0, 400), note('T1', 0, 800)];
  const map = byId(nodes);
  assert.equal(edgeKind(link('a', 'E1', 'O1'), map), 'output');
  assert.equal(edgeKind(link('b', 'E1', 'E2'), map), 'sequence');
  assert.equal(edgeKind(link('c', 'T1', 'E2'), map), 'context');
  assert.equal(edgeKind(link('d', 'E1', 'gone'), map), 'context');   // - an end outside the section
});

// 2
test('two facing borders one gap apart give a straight line, and the grid lines sit half a grid off every border', () => {
  const nodes = twoColumns();
  const g = buildGapGraph(nodes);
  assert.deepEqual(g.xs, [-50, 750, 1450]);          // - E1/E2 left and right, C1 right
  assert.deepEqual(g.ys, [-50, 350, 750]);           // - above E1, the row gap, below E2
  assert.equal(g.free(1, 0), true);                  // - (750, -50) is in the open corner
  assert.equal(g.clearH(1, 0, 2), true);             // - y = 350 runs through the row gap

  const routes = routeSection(nodes, [link('e1', 'E1', 'C1', 'right', 'left')]);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].fallback, false);
  assert.equal(routes[0].variant, 0);                // - the only edge on E1's right border
  assert.deepEqual(routes[0].points, [[700, 150], [800, 150]]);
});

// 3
test('two cells in one column connect straight down through the row gap', () => {
  const routes = routeSection(twoColumns(), [link('e1', 'E1', 'E2', 'bottom', 'top')]);
  assert.deepEqual(routes[0].points, [[350, 300], [350, 400]]);
});

// 4
test('a cell two rows down is reached by the column gap, with a corner at each end and no detour', () => {
  const nodes = [...twoColumns(), code('N3', 800, 800)];
  const routes = routeSection(nodes, [link('e1', 'E1', 'N3')]);   // - sides from geometry: right, left
  // - the only run on the x = 750 gap line takes lane 0, which is the line itself
  assert.deepEqual(routes[0].points, [[700, 150], [750, 150], [750, 950], [800, 950]]);
  assert.equal(routes[0].fallback, false);
});

// 5
test('three edges off one border: exit points 10 px apart, variants in border order, lanes on the shared gap line', () => {
  const nodes = [...twoColumns(), code('N2', 800, 400), code('N3', 800, 800)];
  const edges = [link('e1', 'E1', 'C1'), link('e2', 'E1', 'N2'), link('e3', 'E1', 'N3')];
  const routes = routeSection(nodes, edges);

  // - ordered by the other end's y: C1 (0), N2 (400), N3 (800) → slots 0/1/2, offsets -10/0/+10
  assert.deepEqual(routes.map(r => r.variant), [0, 1, 2]);
  assert.deepEqual(routes.map(r => r.points[0][1]), [140, 150, 160]);

  // - C1, N2 and N3 each hold one edge, so each entry point copies its slot offset: 140, 550, 960.
  //   e1 then runs straight across; e2 takes lane 0 of the x = 750 gap line (the line itself) and e3
  //   overlaps it, so it takes lane 1, 10 px left of the line.
  assert.deepEqual(routeOf(routes, 'e1').points, [[700, 140], [800, 140]]);
  assert.deepEqual(routeOf(routes, 'e2').points, [[700, 150], [750, 150], [750, 550], [800, 550]]);
  assert.deepEqual(routeOf(routes, 'e3').points, [[700, 160], [740, 160], [740, 960], [800, 960]]);
});

// 6
test('the edge order in does not change what comes out', () => {
  const nodes = [...twoColumns(), code('N2', 800, 400), code('N3', 800, 800)];
  const edges = [link('e1', 'E1', 'C1'), link('e2', 'E1', 'N2'), link('e3', 'E1', 'N3')];
  const forward = routeSection(nodes, edges);
  const backward = routeSection(nodes, [...edges].reverse());
  assert.deepEqual(backward, forward);               // - both come back in edge-id order
});

// 7
test('a target the gap grid cannot reach falls back, with no points', () => {
  const nodes = [note('BIG', 0, 0, 1000, 1000), cell('TGT', 400, 400, 100, 100), code('SRC', 1200, 0)];
  const routes = routeSection(nodes, [link('e1', 'SRC', 'TGT')]);
  assert.equal(routes[0].fallback, true);
  assert.deepEqual(routes[0].points, []);
  assert.equal(routes[0].kind, 'context');
});

// 8
test('H5: two rows of two cells route straight across, each on its own y, sharing no segment', () => {
  const nodes = [code('N1', 0, 0), code('N5', 900, 0), code('N2', 0, 400), code('N3', 900, 400)];
  const routes = routeSection(nodes, [link('a', 'N1', 'N5'), link('b', 'N2', 'N3')]);
  assert.deepEqual(routeOf(routes, 'a').points, [[700, 150], [900, 150]]);
  assert.deepEqual(routeOf(routes, 'b').points, [[700, 550], [900, 550]]);
  assert.equal(routes.every(r => r.fallback === false), true);
});

// 9
test('routing the same section twice gives the same routes', () => {
  const nodes = [...twoColumns(), code('N2', 800, 400), code('N3', 800, 800)];
  const edges = [link('e1', 'E1', 'C1'), link('e2', 'E1', 'N2'), link('e3', 'E1', 'N3'), link('e4', 'E1', 'E2')];
  assert.deepEqual(routeSection(nodes, edges), routeSection(nodes, edges));
});

// - every straight stretch of every route; `step` marks the two that run between a border and its
//   end point, which hold the slot they were given and take no lane
const segmentsOf = routes => routes.flatMap(r => {
  const out = [], runs = r.points.length - 1;
  for (let i = 0; i < runs; i++) {
    const [x1, y1] = r.points[i], [x2, y2] = r.points[i + 1];
    const vertical = x1 === x2;
    const [a, b] = vertical ? [y1, y2] : [x1, x2];
    out.push({ id: r.id, step: i === 0 || i === runs - 1, vertical, coord: vertical ? x1 : y1, lo: Math.min(a, b), hi: Math.max(a, b) });
  }
  return out;
});

// - two stretches of different edges drawn on the same line over the same range: the bug F1 is about
const overlaps = routes => {
  const segs = segmentsOf(routes), bad = [];
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.id === b.id || a.vertical !== b.vertical || a.coord !== b.coord) continue;
    const over = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
    if (over > 0) bad.push({ a: a.id, b: b.id, coord: a.coord, over, steps: a.step && b.step });
  }
  return bad;
};

const insideAny = (nodes, routes) => segmentsOf(routes).filter(s => {
  const [xa, xb] = s.vertical ? [s.coord, s.coord] : [s.lo, s.hi];
  const [ya, yb] = s.vertical ? [s.lo, s.hi] : [s.coord, s.coord];
  return nodes.some(n => xb > n.x && xa < n.x + n.w && yb > n.y && ya < n.y + n.h);
});

const rand = seed => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

// - column left edges, pitch alternating 800 and 900: two of the five column gaps are 200 px wide, so
//   the two end points of an edge across them land on two different lines and have to step sideways.
//   At a uniform 800 pitch every gap is one grid, and 25 of 10 948 end points took a sideways step.
const COLUMN_X = [];
for (let c = 0, x = 0; c < 6; c++) { COLUMN_X.push(x); x += c % 2 === 0 ? 800 : 900; }

// - a section the layout engine could have produced: the columns above, rows of their own height one
//   grid apart, so the lines are never evenly spaced
const randomSection = next => {
  const rows = [];
  for (let r = 0, y = 0; r < 6; r++) {
    const h = [200, 300, 400][Math.floor(next() * 3)];
    rows.push({ y, h });
    y += h + GRID;
  }
  const cells = [];
  for (let c = 0; c < 6; c++) for (let r = 0; r < 6; r++) cells.push([c, r]);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const nodes = cells.slice(0, 20).map(([c, r], i) => code(`n${i}`, COLUMN_X[c], rows[r].y, 700, rows[r].h));
  const edges = [];
  // - 20 edges over 20 nodes: enough to fill gaps, few enough that no gap needs more than its 9 lanes
  for (let i = 0; i < 20; i++) {
    const s = Math.floor(next() * nodes.length);
    let t = Math.floor(next() * nodes.length);
    if (t === s) t = (s + 1) % nodes.length;
    edges.push(link(`e${String(i).padStart(2, '0')}`, nodes[s].id, nodes[t].id));
  }
  return { nodes, edges };
};

// 10
test('lanes keep the runs of 300 random sections apart: only first and last runs ever touch', () => {
  const next = rand(20260911);
  let pairs = 0, longest = 0;
  for (let s = 0; s < 300; s++) {
    const { nodes, edges } = randomSection(next);
    const routes = routeSection(nodes, edges);
    assert.deepEqual(insideAny(nodes, routes), []);
    for (const bad of overlaps(routes)) {
      // - two edges crossing one gap in opposite directions have their four border points on the same
      //   two lines, so whichever lane each takes, one pair of steps reaches past the other. The
      //   router takes the lane that shares least. Runs that can take a lane never share one; a run
      //   ending at a border point can take none, which is where the long shares come from.
      assert.ok(bad.steps || bad.over <= GRID, `runs drawn over each other: ${JSON.stringify(bad)}`);
      pairs++; longest = Math.max(longest, bad.over);
    }
  }
  assert.deepEqual([pairs, longest], [PAIRS, LONGEST]);
});

// 11
test('a 60 px gap: a lane that would push a run inside a node is turned down and counted', () => {
  const nodes = [code('A', 0, 0)];
  for (let i = 0; i < 5; i++) nodes.push(code(`B${i}`, 760, 400 + i * 400));
  // - named sides: from the geometry alone only the first of the five faces right, and the other four
  //   leave A's bottom border, where the 60 px gap is not what they have to cross
  const edges = nodes.slice(1).map((n, i) => link(`e${i}`, 'A', n.id, 'right', 'left'));
  const report = {};
  const routes = routeSection(nodes, edges, report);
  assert.deepEqual(insideAny(nodes, routes), []);          // - no run ends up inside a node
  assert.deepEqual(overlaps(routes), []);
  assert.ok(report.blockedLanes > 0, `blockedLanes=${report.blockedLanes}`);
});

// 12
test('a section with more crossings than the cap is not routed: every edge falls back', () => {
  const nodes = [];
  for (let i = 0; i < 40; i++) nodes.push(code(`n${i}`, i * 1000, i * 500));   // - 80 x 80 crossings
  const g = buildGapGraph(nodes);
  assert.equal(g.xs.length * g.ys.length > MAX_CROSSINGS, true);
  assert.equal(g.capped, true);
  assert.deepEqual(g.nbrs, []);

  const report = {};
  const routes = routeSection(nodes, [link('e1', 'n0', 'n1'), link('e2', 'n2', 'n3')], report);
  assert.equal(report.capped, true);
  assert.equal(routes.every(r => r.fallback && r.points.length === 0), true);
  assert.equal(routes[0].sourceSide, 'right');             // - the sides are still resolved
});

// 13
test('a route carries the slot at each end and the border each end uses', () => {
  const nodes = [...twoColumns(), code('N2', 800, 400), code('N3', 800, 800)];
  const edges = [link('e1', 'E1', 'C1'), link('e2', 'E1', 'N2'), link('e3', 'E1', 'N3'), link('e4', 'E2', 'N2')];
  const routes = routeSection(nodes, edges);
  const map = byId(nodes);
  assert.equal(facingSide(map.get('E1'), map.get('N3')), 'right');
  assert.equal(facingSide(map.get('N3'), map.get('E1')), 'left');
  assert.equal(facingSide(map.get('E1'), map.get('E2')), 'bottom');

  // - E1's right border holds e1/e2/e3, so variant runs 0/1/2; each target border holds one edge
  assert.deepEqual(routes.map(r => [r.variant, r.variantIn]), [[0, 0], [1, 0], [2, 0], [0, 1]]);
  assert.deepEqual(routes.map(r => `${r.sourceSide}/${r.targetSide}`),
    ['right/left', 'right/left', 'right/left', 'right/left']);
});

// 14
test('two columns with a wider-than-one-grid gap and offset rows: the route turns twice, not four times', () => {
  const nodes = [code('E12', 0, 1900), code('E14', 900, 2300)];
  const routes = routeSection(nodes, [link('e1', 'E12', 'E14', 'right', 'left')]);
  assert.equal(routes[0].fallback, false);
  assert.deepEqual(insideAny(nodes, routes), []);
  assert.ok(routes[0].points.length <= 4, `more than two corners: ${JSON.stringify(routes[0].points)}`);
});

// 15
test('the same two cells inside their H4 section of eight still turn twice', () => {
  // - copied from test/H4.canvas: the section E12 and E14 belong to
  const nodes = [
    code('E4', 0, 4500, 700, 100), code('E3', 0, 4700, 700, 200), code('E12', 0, 6200, 700, 300),
    code('E13', 800, 4500, 700, 300), code('E14', 1100, 6600, 500, 300), code('E15', 0, 5000, 1500, 300),
    code('E17', 0, 5400, 700, 300), code('E18', 0, 5800, 700, 300),
  ];
  const edges = [
    link('E12->E14', 'E12', 'E14', 'right', 'left'), link('E15->E17', 'E15', 'E17', 'bottom', 'top'),
    link('E17->E18', 'E17', 'E18', 'bottom', 'top'), link('E3->E15', 'E3', 'E15', 'bottom', 'top'),
    link('E4->E3', 'E4', 'E3', 'bottom', 'top'),
  ];
  const routes = routeSection(nodes, edges);
  assert.equal(routes.every(r => r.fallback === false), true);
  assert.deepEqual(insideAny(nodes, routes), []);
  const r = routeOf(routes, 'E12->E14');
  assert.ok(r.points.length <= 4, `more than two corners: ${JSON.stringify(r.points)}`);
});

// 16
test('two cells offset by one grid row, nothing else in the section: the route turns twice', () => {
  // - copied from test/H4.canvas: E14 and the note N25 to its right, one grid row higher
  const nodes = [code('E14', 800, 1900, 600, 300), note('N25', 1900, 1800, 700, 300)];
  const routes = routeSection(nodes, [link('e1', 'E14', 'N25', 'right', 'left')]);
  assert.equal(routes[0].fallback, false);
  assert.deepEqual(insideAny(nodes, routes), []);
  assert.ok(routes[0].points.length <= 4, `more than two corners: ${JSON.stringify(routes[0].points)}`);
});

// 17
test('the same two cells inside their H4 section of eleven still turn twice', () => {
  // - copied from test/H4.canvas: the section E14 and N25 belong to. The wide E15 and the narrow E14
  //   put four x lines in the gap the edge crosses, so the two end points sit on different lines.
  const nodes = [
    code('E4', 0, 200, 700, 100), code('E13', 800, 200, 700, 300), code('E3', 0, 400, 700, 200),
    code('E15', 0, 700, 1600, 300), { id: 'W1', type: 'knowledge', x: 2300, y: 1000, w: 700, h: 700 },
    code('E17', 0, 1100, 700, 300), note('N23', 800, 1100, 700, 300), code('E18', 0, 1500, 700, 300),
    note('N25', 1900, 1800, 700, 300), code('E12', 0, 1900, 700, 300), code('E14', 800, 1900, 600, 300),
  ];
  const edges = [
    link('E4->E3', 'E4', 'E3', 'bottom', 'top'), link('E3->E15', 'E3', 'E15', 'bottom', 'top'),
    link('E17->E18', 'E17', 'E18', 'bottom', 'top'), link('E15->E17', 'E15', 'E17', 'bottom', 'top'),
    link('E12->E14', 'E12', 'E14', 'right', 'left'), link('E14->N25', 'E14', 'N25', 'right', 'left'),
  ];
  const routes = routeSection(nodes, edges);
  assert.equal(routes.every(r => r.fallback === false), true);
  assert.deepEqual(insideAny(nodes, routes), []);
  assert.deepEqual(overlaps(routes), []);
  const r = routeOf(routes, 'E14->N25');
  assert.ok(r.points.length <= 4, `more than two corners: ${JSON.stringify(r.points)}`);
});

// 18
test('an end point two thirds of a row above the other: the route turns twice across three columns', () => {
  // - copied from test/H4.canvas: the section E18 and the note N27 belong to. The two end points are
  //   on rows 1650 and 1350, neither a line of the section, and they reach no vertical line in common.
  const nodes = [
    code('E4', 0, 200, 700, 100), code('E13', 800, 200), code('E3', 0, 400, 700, 200),
    code('E15', 0, 700, 1600, 300), know('W1', 3100, 1000, 700, 700), code('E17', 0, 1100),
    note('N27', 2300, 1200), code('E18', 0, 1500), code('E12', 0, 1900),
    code('E14', 800, 1900, 600, 300), note('N25', 1300, 2000), know('W2', 3100, 2200),
  ];
  const edges = [
    link('E4->E3', 'E4', 'E3', 'bottom', 'top'), link('E3->E15', 'E3', 'E15', 'bottom', 'top'),
    link('E15->E17', 'E15', 'E17', 'bottom', 'top'), link('E17->E18', 'E17', 'E18', 'bottom', 'top'),
    link('E12->E14', 'E12', 'E14', 'right', 'left'), link('E14->N25', 'E14', 'N25', 'right', 'left'),
    link('E18->N27', 'E18', 'N27', 'right', 'left'),
  ];
  const routes = routeSection(nodes, edges);
  assert.deepEqual(insideAny(nodes, routes), []);
  assert.deepEqual(overlaps(routes), []);
  // - E14 and N25 overlap on this canvas, so E14's exit point is inside N25 and that one edge has no
  //   route on the grid; every other edge of the section does
  assert.deepEqual(routes.filter(r => r.fallback).map(r => r.id), ['E14->N25']);
  const r = routeOf(routes, 'E18->N27');
  assert.equal(r.fallback, false);
  assert.ok(r.points.length <= 4, `more than two corners: ${JSON.stringify(r.points)}`);
});
