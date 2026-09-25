// - run: npx esbuild src/shared/layoutEngine.ts --bundle --format=esm --outfile=tests/.build/layoutEngine.mjs && npx esbuild src/shared/sectionLanes.ts --bundle --format=esm --outfile=tests/.build/sectionLanes.mjs && node --test tests/layout-engine.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeCellHeight, estimateCodeNeedPx, ridersOf, hangingBelow, deriveColumns, derivePairs, outputOwners, layoutSection, reflowSection, insertAfter, forkOf, placeOutput, applyPatchesToCanvas, toEngineNodes, sectionEngineNodes, sectionMembership, columnsOfDeleted } from './.build/layoutEngine.mjs';
import { deriveLanes, fitLanes } from './.build/sectionLanes.mjs';

// - mirrors src/shared/constants.ts; the bundle does not re-export it
const GRID = 100;

const code = (id, x, y, h = 300, out) => ({ id, type: 'code', x, y, w: 700, h, ...(out ? { outputNodeId: out } : {}) });
const cell = (id, x, y, w = 600, h = 300) => ({ id, type: 'cell', x, y, w, h });
const note = (id, x, y, w, h) => ({ id, type: 'text', x, y, w, h });

const apply = (nodes, patches) => nodes.map(n => (patches[n.id] ? { ...n, ...patches[n.id] } : n));

// - the fixtures were drawn before `keepRow` (§3.5): every edge holds, as the engine read them then
const allHeld = edges => edges.map(e => ({ ...e, keepRow: true }));

// - the engine's rule: two boxes need a full grid gap on at least one axis
const tooClose = (a, b) => !(
  a.x + a.w + GRID <= b.x || b.x + b.w + GRID <= a.x ||
  a.y + a.h + GRID <= b.y || b.y + b.h + GRID <= a.y
);

// 1
test('codeCellHeight steps by 50px from the default height up to the cap', () => {
  assert.equal(codeCellHeight(200), 300);    // - well inside the default 300, so it stays there
  assert.equal(codeCellHeight(301), 350);    // - one line past what 300 holds
  assert.equal(codeCellHeight(349), 350);
  assert.equal(codeCellHeight(350), 350);    // - an exact step stays on it
  assert.equal(codeCellHeight(351), 400);
  assert.equal(codeCellHeight(2000), 900);   // - capped at CODE_MAX_H
});

// 2
const inserted = () => [
  code('E1', 1600, 400),
  code('E2', 1600, 800),
  code('E3', 1600, 1200),
  code('F1', 3100, 800),      // - a fork: its own pair, right of E's
  code('NEW', 1600, 800),     // - the inserted cell, placed on E2's y
];

test('an insert pushes its own column down and leaves the fork alone', () => {
  const nodes = inserted();
  const patches = layoutSection(nodes, { moverIds: ['NEW'] });
  assert.deepEqual(patches, {
    E2: { x: 1600, y: 1200 },
    E3: { x: 1600, y: 1600 },
  });
  // - pure: the input array is untouched
  assert.deepEqual(nodes.find(n => n.id === 'E2'), code('E2', 1600, 800));
});

// 3
test('a delete pulls the column up to one gap', () => {
  const patches = layoutSection([code('E1', 1600, 400), code('E3', 1600, 1200)], { columnX: 1600 });
  assert.deepEqual(patches, { E3: { x: 1600, y: 800 } });
});

// 4
const withOutput = (outH = 300, outW = 600, outX = 2000, outY = 500) => [
  code('E1', 1600, 400),
  code('E2', 1600, 800, 300, 'C2'),
  code('E3', 1600, 1200),
  cell('C2', outX, outY, outW, outH),
];

test('an output cell is placed in its pair column at its code cell y', () => {
  const patches = layoutSection(withOutput(), { moverIds: ['E2'] });
  assert.deepEqual(patches, { C2: { x: 2400, y: 800 } });   // - 1600 + 700 + 100
});

// 5
test('an output taller than its code pushes the column below it', () => {
  const patches = layoutSection(withOutput(700), { moverIds: ['E2'] });
  assert.deepEqual(patches, {
    C2: { x: 2400, y: 800 },
    E3: { x: 1600, y: 1600 },   // - 800 + 700 + 100
  });
});

// 6
const grownOutput = outW => [
  code('E1', 1600, 400),
  code('E2', 1600, 800, 300, 'C2'),
  code('E3', 1600, 1200),
  cell('C2', 2400, 800, outW, 300),   // - the widened output
  code('F1', 3600, 800, 300, 'C4'),   // - the next pair, hand-placed with room to spare
  cell('C4', 4400, 800, 600, 300),
];

test('an output wide enough to reach the next pair moves that pair right by the overlap', () => {
  // - C2 ends at 3600 and needs a gap: F1 is 100 into it. Down would be 400, so right wins
  const patches = layoutSection(grownOutput(1200), { moverIds: ['C2'] });
  assert.deepEqual(patches, {
    F1: { x: 3700, y: 800 },
    C4: { x: 4500, y: 800 },   // - the output rides with its code cell
  });
});

// 7
test('an output that grows without reaching the next pair moves nothing', () => {
  // - C2 ends at 3400, a full gap short of F1 at 3600: no overlap, so no push at all
  assert.deepEqual(layoutSection(grownOutput(1000), { moverIds: ['C2'] }), {});

  // - and a pair parked further right than the tight position is never pulled back
  const parkedPair = [
    code('E1', 1600, 400),
    code('E2', 1600, 800, 300, 'C2'),
    code('E3', 1600, 1200),
    cell('C2', 2400, 800, 600, 300),
    code('F1', 4000, 800),   // - tight would be 3100; a hand-placed fork stays where it is
  ];
  assert.deepEqual(layoutSection(parkedPair, { moverIds: ['C2'] }), {});
});

// 8
test('a note at the foot of a pushed column is packed under the cells that moved', () => {
  const nodes = [...inserted(), note('N1', 1600, 1250, 300, 200)];
  const patches = layoutSection(nodes, { moverIds: ['NEW'] });
  assert.deepEqual(patches, {
    E2: { x: 1600, y: 1200 },
    E3: { x: 1600, y: 1600 },
    N1: { x: 1600, y: 2000 },   // - clear of E3: 1600 + 300 + 100
  });
});

// 9
const dropped = () => [
  code('E1', 1600, 400),
  code('E2', 1600, 800),
  code('E3', 1600, 1200),
  note('N1', 1600, 800, 300, 200),   // - dropped on E2
];

test('a note dropped on a cell row takes that row, and the cells below pack under it', () => {
  const patches = layoutSection(dropped(), { moverIds: ['N1'] });
  assert.deepEqual(patches, {
    E2: { x: 1600, y: 1100 },   // - 800 + 200 + 100
    E3: { x: 1600, y: 1500 },   // - packed below the pushed E2
  });
});

// 10
test('a second call on the result of the first changes nothing', () => {
  const cases = [
    ['insert', inserted(), { moverIds: ['NEW'] }],
    ['tall output', withOutput(700), { moverIds: ['E2'] }],
    ['wider output', grownOutput(1200), { moverIds: ['C2'] }],
    ['dropped note', dropped(), { moverIds: ['N1'] }],
  ];
  for (const [name, nodes, opts] of cases) {
    const once = apply(nodes, layoutSection(nodes, opts));
    assert.deepEqual(layoutSection(once, opts), {}, name);
  }
});

// 11
const mess = () => [
  code('E1', 1600, 400),
  code('E2', 1650, 900),              // - off the column, and a gap too low
  code('E3', 1600, 1700),             // - a hole above it
  code('F1', 5000, 400, 300, 'C4'),   // - a fork parked far to the right
  cell('C4', 5800, 400, 600, 300),
];

test('reflowSection snaps off-column cells back, closes holes and pulls the pairs in', () => {
  const nodes = mess();
  const patches = reflowSection(nodes);
  assert.deepEqual(patches, {
    E2: { x: 1600, y: 800 },    // - joins the 1600 column (1700 is within half a pair of it)
    E3: { x: 1600, y: 1200 },
    F1: { x: 2400, y: 400 },    // - one gap right of column 1600: none of its cells has an output, so it ends at 2300
    C4: { x: 3200, y: 400 },
  });
  assert.deepEqual(reflowSection(apply(nodes, patches)), {});
});

// 12
test('insertAfter puts the new node one gap under the row it follows, whatever the anchor is', () => {
  const plain = [code('E1', 1600, 400), note('T1', 0, 0, 300, 300)];
  assert.deepEqual(insertAfter(plain, 'E1'), { x: 1600, y: 800 });
  assert.deepEqual(insertAfter(plain, 'T1'), { x: 0, y: 400 });   // - a note anchors its column too
  assert.equal(insertAfter(plain, 'nope'), null);
  const tall = [code('E1', 1600, 400, 300, 'C1'), cell('C1', 2400, 400, 600, 700)];
  assert.deepEqual(insertAfter(tall, 'E1'), { x: 1600, y: 1200 });   // - 400 + 700 + 100
});

// 13
test('forkOf opens a new pair beside the cell, and refuses a left fork at the origin', () => {
  const nodes = [code('E1', 1600, 400, 300, 'C1'), cell('C1', 2400, 400, 600, 300), note('T1', 0, 0, 300, 300)];
  assert.deepEqual(forkOf(nodes, 'E1', 'right'), { x: 3100, y: 400 });
  assert.deepEqual(forkOf(nodes, 'E1', 'left'), { x: 100, y: 400 });   // - 1600 - 100 - (700 + 100 + 600)
  assert.equal(forkOf([code('E1', 1400, 400)], 'E1', 'left'), null);
  assert.equal(forkOf(nodes, 'T1', 'right'), null);
});

// 14
test('placeOutput lands in the pair output column and keeps an existing size', () => {
  const nodes = [code('E1', 1600, 400), note('T1', 0, 0, 300, 300)];
  assert.deepEqual(placeOutput(nodes, 'E1'), { x: 2400, y: 400, width: 600, height: 300 });
  assert.deepEqual(placeOutput(nodes, 'E1', { w: 1000, h: 500 }), { x: 2400, y: 400, width: 1000, height: 500 });
  assert.equal(placeOutput(nodes, 'T1'), null);
});

// 15
const FIXTURES = ['H1', 'H2', 'H3', 'H4', 'H5'];
const TMP = '/tmp/skena-engine';
const here = path.dirname(fileURLToPath(import.meta.url));

// - frozen copies of the H canvases in tests/fixtures/ (geometry, sections, edges and output links, every
//   text replaced by x's of the same shape), read once and worked on as copies under /tmp
fs.mkdirSync(TMP, { recursive: true });
for (const name of FIXTURES) fs.writeFileSync(path.join(TMP, `${name}.json`), fs.readFileSync(path.join(here, 'fixtures', `${name}.json`)));

test('reflowSection on copies of the H canvases: no managed overlap, every code cell on a column x', () => {
  // - every section is checked and every failure collected, so one failing section does not hide the
  //   rest. The list below is what the engine gives on the fixtures today: in H2 S1 the snap puts the
  //   two sources of C14 in one column, the tie then picks the other one, and the second Reflow packs
  //   to that row (spec §3.5). A new entry, or one that goes away, fails the test.
  const failures = [];
  let checked = 0;
  for (const name of FIXTURES) {
    const data = JSON.parse(fs.readFileSync(path.join(TMP, `${name}.json`), 'utf8'));
    const lanes = data.metadata?.sections ?? [];
    if (lanes.length === 0 || !data.nodes.some(n => n.type === 'code')) {
      console.log(`  ${name}: no sections or no code cells — skipped`);
      continue;
    }
    for (const lane of deriveLanes(data.nodes, lanes)) {
      const members = toEngineNodes(data.nodes.filter(n => lane.memberIds.includes(n.id)));
      if (!members.some(n => n.type === 'code')) continue;
      const patches = reflowSection(members, { riders: ridersOf(members, allHeld(data.edges ?? [])) });
      const after = apply(members, patches);
      const owners = outputOwners(after);
      const managed = after.filter(n => n.type === 'code' || owners.has(n.id));
      for (let i = 0; i < managed.length; i++) {
        for (let j = i + 1; j < managed.length; j++) {
          if (tooClose(managed[i], managed[j])) failures.push(`${name} ${lane.label}: ${managed[i].id} sits on ${managed[j].id}`);
        }
      }
      const columnXs = new Set(deriveColumns(after).map(c => c.x));
      for (const c of after.filter(n => n.type === 'code')) {
        if (c.x % GRID !== 0 || !columnXs.has(c.x)) failures.push(`${name} ${lane.label}: ${c.id} is on no column`);
      }
      const second = reflowSection(after, { riders: ridersOf(after, allHeld(data.edges ?? [])) });
      if (Object.keys(second).length > 0) failures.push(`${name} ${lane.label}: a second Reflow moves ${Object.keys(second).length} node(s)`);
      checked++;
    }
  }
  assert.ok(checked >= 2, `expected at least two sections with code cells, checked ${checked}`);
  assert.deepEqual(failures, ['H2 S1: a second Reflow moves 6 node(s)']);
});

// 16
test('applyPatchesToCanvas returns the same array when there is nothing to apply', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', x: 5, y: 5, width: 10, height: 10 },
  ];
  assert.equal(applyPatchesToCanvas(nodes, {}), nodes);

  const sized = applyPatchesToCanvas(nodes, { b: { x: 100, y: 200, w: 300, h: 400 } });
  assert.notEqual(sized, nodes);
  assert.equal(sized[0], nodes[0]);   // - an untouched node keeps its object
  assert.deepEqual(sized[1], { id: 'b', x: 100, y: 200, width: 300, height: 400 });
  assert.deepEqual(nodes[1], { id: 'b', x: 5, y: 5, width: 10, height: 10 });

  const moved = applyPatchesToCanvas(nodes, { a: { x: 1, y: 2 } });
  assert.deepEqual(moved[0], { id: 'a', x: 1, y: 2, width: 10, height: 10 });   // - size kept
});

// 17
const parked = () => [
  code('E1', 1600, 400),
  code('E2', 1600, 800),
  code('F1', 3100, 400),
  code('F2', 3100, 1200),             // - a hole above it: the delete case
  note('N1', 1600, 600, 300, 200),    // - the user parked it on E1 and left it there
];

test('a note sitting on a cell moves only when its own column is the one this call touched', () => {
  // - a different column is edited: the pre-existing overlap is none of the engine's business
  assert.deepEqual(layoutSection(parked(), { columnX: 3100 }), { F2: { x: 3100, y: 800 } });

  // - now the note's own column is edited: it is a member of it and packs with the cells, in y order
  const nodes = [...parked(), code('NEW', 1600, 400)];
  const patches = layoutSection(nodes, { moverIds: ['NEW'] });
  assert.deepEqual(patches, {
    E1: { x: 1600, y: 800 },    // - NEW keeps 400, so E1 takes the row under it
    N1: { x: 1600, y: 1200 },   // - the note follows E1: 800 + 300 + 100
    E2: { x: 1600, y: 1500 },   // - and E2 the row under the note: 1200 + 200 + 100
  });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['NEW'] }), {});
});

// 18
test('an output measured at its real width, past OUTPUT_MAX_W, moves the next column right by the real overlap', () => {
  const nodes = [
    code('E1', 1600, 400, 300, 'C1'),
    cell('C1', 2400, 400, 1600, 300),   // - wider than OUTPUT_MAX_W: the clamp is the caller's, not the engine's
    code('F1', 3100, 400),
  ];
  // - C1 reaches 4000 and F1 is 1000 into it, a gap included: F1's column moves 1000 right to make room
  //   (§3.5), even though down would be 400
  assert.deepEqual(layoutSection(nodes, { moverIds: ['C1'] }), { F1: { x: 4100, y: 400 } });
  assert.deepEqual(layoutSection(apply(nodes, layoutSection(nodes, { moverIds: ['C1'] })), { moverIds: ['C1'] }), {});
});

// 19
const carried = () => [
  code('E1', 1600, 400),
  code('E2', 1600, 800),
  code('F1', 3300, 1600),              // - a fork cell this call never moves
  note('N1', 2000, 1250, 1400, 200),   // - clear of everything until E2 is pushed under it
  code('NEW', 1600, 800),
];

test('the push packs under the note lying across the column instead of shoving it down', () => {
  // - until §3.4 this read: E2 took 1200, landed on N1, pushed it to 1600, and N1 pushed F1 to
  //   (3500, 1600) in turn. N1 reaches from 2000 to 3400, so it lies across column 1600; the column
  //   now packs around it and nothing else in the section moves at all.
  const nodes = carried();
  const patches = layoutSection(nodes, { moverIds: ['NEW'] });
  assert.deepEqual(patches, { E2: { x: 1600, y: 1550 } });   // - N1 ends at 1450, one gap under it
  assert.equal(overlapCount(apply(nodes, patches)), 0);
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['NEW'] }), {});
});

// 20
// - four hand-placed text nodes in a 2x2 grid, no code cell: the shape test/H5.canvas had when
//   the bump rule was measured on it. Literals, not the file — the user edits that canvas live.
const h5 = () => [
  note('N1', 0, 0, 700, 300),
  note('N2', 0, 400, 700, 300),
  note('N5', 800, 0, 700, 300),
  note('N3', 800, 400, 700, 300),
];

test('a node widened into the column beside it moves that column right by the overlap', () => {
  const nodes = h5().map(n => (n.id === 'N1' ? { ...n, w: 800 } : n));
  const patches = layoutSection(nodes, { moverIds: ['N1'] });
  assert.deepEqual(patches, {
    N5: { x: 900, y: 0 },     // - 100 right, not 400 down
    N3: { x: 900, y: 400 },   // - its column mate travels with it
  });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['N1'] }), {});
});

// 21
test('the same node grown downwards moves the node under it, and nothing beside it', () => {
  const nodes = h5().map(n => (n.id === 'N1' ? { ...n, h: 800 } : n));
  const patches = layoutSection(nodes, { moverIds: ['N1'] });
  assert.deepEqual(patches, { N2: { x: 0, y: 900 } });   // - 500 down beats 800 right
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['N1'] }), {});
});

// 22
const droppedMid = () => [
  code('E1', 1600, 400),
  code('E2', 1600, 1000, 300, 'C2'),
  cell('C2', 2400, 1000, 600, 300),
  code('E3', 1600, 1400, 300, 'C3'),
  cell('C3', 2400, 1400, 600, 300),
  note('N1', 1600, 900, 300, 200),   // - dropped over the top of E2
];

test('a note dropped on the middle of a code column joins it, the cells below packing under it', () => {
  const nodes = droppedMid();
  const patches = layoutSection(nodes, { moverIds: ['N1'] });
  assert.deepEqual(patches, {
    N1: { x: 1600, y: 800 },    // - the row under E1, one gap below it: 400 + 300 + 100
    E2: { x: 1600, y: 1100 },   // - under the note: 800 + 200 + 100
    C2: { x: 2400, y: 1100 },   // - the output rides at its cell's y
    E3: { x: 1600, y: 1500 },
    C3: { x: 2400, y: 1500 },
  });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['N1'] }), {});
});

// 23
test('a node the mover sits right of moves down, never left, whether or not there is room', () => {
  // - 100px of room to the left, and it is still not taken: a left step is not monotone and lets
  //   the walk cycle, so down past the mover's row is the only move a node left of it has
  const room = [note('O1', 100, 0, 700, 300), note('M1', 800, 0, 700, 300)];
  assert.deepEqual(layoutSection(room, { moverIds: ['M1'] }), { O1: { x: 100, y: 400 } });

  const none = [note('O1', 0, 0, 700, 300), note('M1', 700, 0, 700, 300)];
  assert.deepEqual(layoutSection(none, { moverIds: ['M1'] }), { O1: { x: 0, y: 400 } });
});

// 24
const overlapCount = ns => {
  let n = 0;
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (tooClose(ns[i], ns[j])) n++;
  return n;
};

test('layoutSection on copies of H1, H4 and H5, once per NODE: idempotent, never more overlap', () => {
  let checked = 0;
  for (const name of ['H1', 'H4', 'H5']) {
    const data = JSON.parse(fs.readFileSync(path.join(TMP, `${name}.json`), 'utf8'));
    for (const lane of deriveLanes(data.nodes, data.metadata?.sections ?? [])) {
      const members = toEngineNodes(data.nodes.filter(n => lane.memberIds.includes(n.id)));
      if (members.length === 0) continue;
      const before = overlapCount(members);
      let worst = 0, movedBy = 0;
      for (const mover of members) {
        const opts = { moverIds: [mover.id] };
        const patches = layoutSection(members, opts);
        const once = apply(members, patches);
        assert.deepEqual(layoutSection(once, opts), {}, `${name} ${lane.label} mover ${mover.id}`);
        const after = overlapCount(once);
        assert.ok(after <= before, `${name} ${lane.label} mover ${mover.id}: ${before} overlaps -> ${after}`);
        worst = Math.max(worst, after);
        if (Object.keys(patches).length > 0) movedBy++;
        checked++;
      }
      console.log(`  ${name} ${lane.label}: ${members.length} nodes, ${before} overlaps -> at worst ${worst}; ${movedBy}/${members.length} movers change something`);
    }
  }
  assert.ok(checked >= 30, `expected at least thirty movers, checked ${checked}`);
});

// 25
test('a node above the one just placed does not move past it: the placed node yields and drops below', () => {
  // - O1 sits above M1 at the same x, so its own axis would be up: it steps aside if it can, and
  //   here it cannot — the free column at x 1600 holds M1, and a column slides only as one. So M1,
  //   the node the operation placed, is the one that gives way
  const nodes = [note('O1', 1600, 300, 700, 300), note('M1', 1600, 400, 700, 300)];
  const patches = layoutSection(nodes, { moverIds: ['M1'] });
  assert.deepEqual(patches, { M1: { x: 1600, y: 700 } });   // - 300 + 300 + 100, O1 unmoved
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['M1'] }), {});
});

// 26
// - a note dropped on the output of a code cell that sits above it. The note pushes the output down,
//   the pair moving as one; the code cell is then above the note, so the note yields and drops —
//   onto the output again. The two chase each other down 300px a step and the walk never clears.
const chase = () => [
  note('N1', 800, 900, 900, 400),
  { id: 'E1', type: 'code', x: 0, y: 300, w: 900, h: 400, outputNodeId: 'C1' },
  cell('C1', 800, 1000, 1400, 400),
];

test('the bump walk reports when it hits its step cap', () => {
  const capped = {};
  layoutSection(chase(), { moverIds: ['N1'], report: capped });
  assert.equal(capped.capped, true);

  const clear = {};
  const h5wide = h5().map(n => (n.id === 'N1' ? { ...n, w: 800 } : n));
  layoutSection(h5wide, { moverIds: ['N1'], report: clear });
  assert.equal(clear.capped, undefined);

  // - the 41-node diagonal staircase capped here while a bump could carry the node doing the
  //   bumping; it now settles in 63 steps, well inside its 196
  const stair = Array.from({ length: 41 }, (_, i) => note(`N${String(i).padStart(2, '0')}`, i * 100, i * 100, 700, 300));
  const settles = {};
  layoutSection(stair, { moverIds: ['N20'], report: settles });
  assert.equal(settles.capped, undefined);
});

// 27
test('a node created from an anchor is taken into the anchor section, which then grows', () => {
  // - the H5 shape: S1 at its minimum height holds two nodes, S2 starts where S1 ends, and the new
  //   node lands exactly on the boundary
  const nodes = [
    { id: 'N1', type: 'text', x: 0, y: 0,   width: 700, height: 300 },
    { id: 'N2', type: 'text', x: 0, y: 400, width: 700, height: 300 },
    { id: 'N3', type: 'text', x: 0, y: 800, width: 700, height: 300 },
  ];
  const sections = [{ id: 's1', y: 0, createdAt: 1 }, { id: 's2', y: 800, createdAt: 2 }];
  assert.equal(sectionMembership(nodes, sections, 'N3').get('N3'), 1);   // - by its y alone, S2's

  const own = sectionMembership(nodes, sections, 'N2', ['N3']);
  assert.deepEqual([...own], [['N1', 0], ['N2', 0], ['N3', 0]]);
  assert.deepEqual(sectionEngineNodes(nodes, sections, 'N2', ['N3']).map(n => n.id), ['N1', 'N2', 'N3']);
  assert.deepEqual(sectionEngineNodes(nodes, sections, 'N2').map(n => n.id), ['N1', 'N2']);

  // - S1 grows by the 400 the new node needs; S2 and its members move down by the same
  const fit = fitLanes(sections, nodes, own);
  assert.deepEqual(fit.laneShifts, { s2: 400 });
  assert.deepEqual(fit.nodeShifts, {});
});

// 28
test('an off-grid note column snaps onto the grid and packs when it is touched', () => {
  // - H6: N1 (59,0) and N2 (59,400), and a third node the old 48 px free-slot search parked at 748.
  //   All three share the snapped x 100, so the pack owns them: x onto the column, y one gap apart
  const nodes = [note('N1', 59, 0, 700, 300), note('N2', 59, 400, 700, 300), note('N3', 59, 748, 700, 300)];
  const patches = layoutSection(nodes, { moverIds: ['N3'] });
  assert.deepEqual(patches, {
    N1: { x: 100, y: 0 },
    N2: { x: 100, y: 400 },
    N3: { x: 100, y: 800 },
  });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['N3'] }), {});
});

// 29
test('a node dropped under an output cell drops below it instead of moving the pair sideways', () => {
  // - H4: `o` on an output put the new node 48 px under C4. Sideways is open — the pair could slide
  //   800 right — but the mover clears C4 in 52, and the smaller move wins
  const nodes = [
    code('E2', 8000, 1300, 300, 'C4'),
    cell('C4', 8800, 1300, 600, 300),
    note('N8', 8800, 1648, 700, 300),
  ];
  const patches = layoutSection(nodes, { moverIds: ['N8'] });
  assert.deepEqual(patches, { N8: { x: 8800, y: 1700 } });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['N8'] }), {});
});

// 30
test('a note dropped onto a column takes the row its drop y puts it in, not the drop y itself', () => {
  // - the note is dropped at 700, between E1 (row 0-300) and E2: it is the second member of the
  //   column, so the pack gives it the row under E1, at 400. E2 and E3 already sit clear of it
  const nodes = [code('E1', 1600, 0), code('E2', 1600, 800), code('E3', 1600, 1200), note('N1', 1600, 700, 700, 300)];
  const patches = layoutSection(nodes, { moverIds: ['N1'] });
  assert.deepEqual(patches, { N1: { x: 1600, y: 400 } });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['N1'] }), {});

  // - the note's width no longer changes the outcome: a narrow one packs into the same row
  const narrow = [code('E1', 1600, 0), code('E2', 1600, 800), code('E3', 1600, 1200), note('N1', 1600, 700, 100, 300)];
  assert.deepEqual(layoutSection(narrow, { moverIds: ['N1'] }), { N1: { x: 1600, y: 400 } });
});

// 31
test('a code cell dropped between two cells of another column joins it, its output riding along', () => {
  // - M is dropped on A2's y: the mover wins the tie, so it takes A2's place and A2/A3 move down one
  //   row. M is the cell the operation moved, so its output comes with it, onto the new pair's slot
  const nodes = [
    code('A1', 1600, 0),
    code('A2', 1600, 400),
    code('A3', 1600, 800),
    code('M', 1600, 400, 300, 'MO'),
    cell('MO', 3900, 0, 600, 300),
  ];
  const patches = layoutSection(nodes, { moverIds: ['M'] });
  assert.deepEqual(patches, {
    MO: { x: 2400, y: 400 },
    A2: { x: 1600, y: 800 },
    A3: { x: 1600, y: 1200 },
  });
  // - the dropped cell keeps the position it was dropped at
  assert.equal(patches.M, undefined);
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['M'] }), {});
});

// 32
// - S1 of test/H4.canvas as it stood at 13:30: a hand-placed section with no overlap in it. The
//   outputs sit at 2400, one grid right of the 2300 slot the 1500 column models.
const h4s1 = () => [
  note('N2', 0, 100, 700, 900),
  note('N4', 800, 100, 600, 300),
  note('N6', 800, 500, 600, 100),
  note('N7', 800, 800, 600, 300),
  note('N8', 1540, 900, 700, 300),
  code('E1', 1500, 100, 300, 'C1'),
  cell('C1', 2400, 100, 600, 300),
  code('E5', 1500, 500, 300, 'C2'),
  cell('C2', 2400, 500, 600, 700),
  code('E2', 1500, 1300, 300, 'C4'),
  cell('C4', 2400, 1300, 600, 300),
];

test('a note sharing a column x with code cells packs into that column on the first edit', () => {
  // - N8 sits at 1540, which snaps to the 1500 column: it is a member of it, between E5 and E2. The
  //   section overlaps nowhere, but the first edit of that column still tidies it — expected, and
  //   the price of one rule for every type. A second edit then moves nothing.
  const nodes = h4s1();
  assert.equal(overlapCount(nodes), 0);
  const packed = {
    N8: { x: 1500, y: 1300 },   // - the row under E5, whose output C2 is 700 deep: 500 + 700 + 100
    E2: { x: 1500, y: 1700 },
    C4: { x: 2400, y: 1700 },
  };
  for (const mover of ['E1', 'E5', 'E2']) {
    const patches = layoutSection(nodes, { moverIds: [mover] });
    assert.deepEqual(patches, packed, mover);
    const once = apply(nodes, patches);
    assert.equal(overlapCount(once), 0, mover);
    assert.deepEqual(layoutSection(once, { moverIds: [mover] }), {}, mover);
  }
});

// 33
test('a capped bump walk leaves the section as the pack left it', () => {
  const nodes = chase();
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['N1'], report });
  assert.equal(report.capped, true);
  assert.deepEqual(patches, {}, 'no free node is packed, so a capped walk leaves nothing to apply');
  assert.equal(overlapCount(apply(nodes, patches)), overlapCount(nodes));
});

// 34
test('a cell the pack only pushed keeps its output where the user parked it', () => {
  // - the mirror of 31: A2 is not the cell the operation moved, it is just pushed down a row, so its
  //   output takes the new y and keeps the x the user gave it
  const nodes = [
    code('A1', 1600, 0),
    code('A2', 1600, 400, 300, 'AO'),
    cell('AO', 3900, 400, 600, 300),
    code('NEW', 1600, 0),
  ];
  const patches = layoutSection(nodes, { moverIds: ['NEW'] });
  assert.deepEqual(patches, {
    A1: { x: 1600, y: 400 },
    A2: { x: 1600, y: 800 },
    AO: { x: 3900, y: 800 },
  });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['NEW'] }), {});
});

// 35
test('a walk that settles on its LAST allowed step keeps its patches and is not capped', () => {
  // - the 5-note staircase clears in exactly 4 bump steps, so at maxSteps 4 the last step allowed is
  //   the one that settles it: without a check after the loop that result is undone and flagged capped
  const stair = () => Array.from({ length: 5 }, (_, i) => note(`N${i}`, i * 100, i * 100, 700, 300));
  const settled = {};
  const patches = layoutSection(stair(), { moverIds: ['N2'], report: settled, maxSteps: 4 });
  assert.equal(settled.capped, undefined);
  assert.deepEqual(patches, { N2: { x: 200, y: 800 } });
  assert.ok(overlapCount(apply(stair(), patches)) < overlapCount(stair()));
  assert.deepEqual(layoutSection(apply(stair(), patches), { moverIds: ['N2'], maxSteps: 4 }), {});
  // - one step short the walk really does run out, and the section is left exactly as it was
  const short = {};
  assert.deepEqual(layoutSection(stair(), { moverIds: ['N2'], report: short, maxSteps: 3 }), {});
  assert.equal(short.capped, true);
});

// 36
test('deleting a note hands the engine its column, and the notes below pull up', () => {
  const canvas = [
    { id: 'N1', type: 'text', x: 1600, y: 0,    width: 700, height: 300 },
    { id: 'N2', type: 'text', x: 1600, y: 400,  width: 700, height: 300 },
    { id: 'N3', type: 'text', x: 1600, y: 1200, width: 700, height: 300 },   // - a hole above it
  ];
  const sections = [{ id: 's1', y: 0, createdAt: 1 }];
  // - a deleted note leaves a hole in its column, exactly as a deleted code cell does
  assert.deepEqual(columnsOfDeleted(canvas, sections, new Set(['N1'])), [{ sectionId: 's1', columnX: 1600 }]);

  const left = toEngineNodes(canvas.filter(n => n.id !== 'N1'));
  // - N2 is the first member now and keeps its y (as in case 3); N3 closes the hole under it
  assert.deepEqual(layoutSection(left, { columnX: 1600 }), { N3: { x: 1600, y: 800 } });
  assert.deepEqual(layoutSection(apply(left, { N3: { x: 1600, y: 800 } }), { columnX: 1600 }), {});
});

// 37
test('`o` on a note puts the new node one gap under it and pushes the column down', () => {
  const column = [note('N1', 1600, 400, 700, 300), note('N2', 1600, 800, 700, 300)];
  const at = insertAfter(column, 'N1');
  assert.deepEqual(at, { x: 1600, y: 800 });   // - N1's row bottom + one gap

  const withNew = [...column, note('NEW', at.x, at.y, 700, 300)];
  const patches = layoutSection(withNew, { moverIds: ['NEW'] });
  assert.deepEqual(patches, { N2: { x: 1600, y: 1200 } });   // - the new node wins the tie at 800
  assert.deepEqual(layoutSection(apply(withNew, patches), { moverIds: ['NEW'] }), {});
});

// 38
test('a mixed column packs in y order, the code cell taking its output with it', () => {
  const nodes = [
    note('T1', 1600, 400, 700, 300),
    code('E1', 1600, 900, 300, 'C1'),   // - half a gap too low
    cell('C1', 2400, 900, 600, 500),    // - taller than its cell: the row is 500 deep
    note('T2', 1600, 1300, 700, 300),
  ];
  const patches = layoutSection(nodes, { moverIds: ['E1'] });
  assert.deepEqual(patches, {
    E1: { x: 1600, y: 800 },    // - pulled up under T1: 400 + 300 + 100
    C1: { x: 2400, y: 800 },    // - the output rides at its cell's y
    T2: { x: 1600, y: 1400 },   // - clear of the output, not of the cell: 800 + 500 + 100
  });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['E1'] }), {});
});

// 39
test('a kernel badge is no column member: the code cell under it keeps its y', () => {
  // - the H1 shape: a 140x160 kernel badge parked at the top of a column, a code cell far below it
  const nodes = [
    { id: 'K1', type: 'kernel', x: 4800, y: 100, w: 140, h: 160 },
    code('E1', 4800, 4600),
  ];
  assert.deepEqual(deriveColumns(nodes).map(c => c.cellIds), [['E1']]);
  assert.deepEqual(layoutSection(nodes, { moverIds: ['E1'] }), {});
  // - and touching the badge does not drag the cell up to it either
  assert.deepEqual(layoutSection(nodes, { moverIds: ['K1'] }), {});
});

// 40
test('codeCellHeight shrinks back down the same 50px steps', () => {
  assert.equal(codeCellHeight(120), 300);   // - a short cell sits on the floor, not under it
  assert.equal(codeCellHeight(320), 350);   // - a cell the user dragged to 500 comes back to 350
  assert.equal(codeCellHeight(0), 300);
});

// 41
// - the 20-node S1 slice of test/H4.canvas as it stood on 2026-09-11, right after `o` on M1 put
//   N11 at (3100, 800) on top of N8. Literals, not the file — the user edits that canvas live.
const h4n11 = () => [
  note('N1', 0, 1100, 700, 200),
  note('N2', 0, 100, 700, 900),
  note('N3', 800, 1300, 700, 300),
  code('E1', 1600, 100, 350, 'C1'),
  note('N5', 0, 1400, 700, 300),
  code('E5', 1600, 550, 200, 'C2'),
  note('N4', 800, 100, 700, 100),
  note('N6', 800, 300, 700, 400),
  { id: 'M1', type: 'file', x: 3100, y: 100, w: 700, h: 600 },
  note('N9', 800, 800, 700, 400),
  code('E6', 1600, 850, 300),
  code('E2', 1600, 1250, 300),
  cell('C1', 2400, 100, 600, 300),
  cell('C2', 2400, 550, 600, 200),
  note('N10', 0, 1800, 700, 300),
  { id: 'M2', type: 'file', x: 4000, y: 100, w: 700, h: 1100 },
  note('N7', 800, 1700, 700, 300),
  note('N8', 2400, 900, 900, 300),
  code('E7', 1600, 1650, 300),
  note('N11', 3100, 800, 700, 300),
];

test('a new node on M1 packs under the note lying across its column, and nothing walks (H4 N11)', () => {
  // - N8 sits LEFT of N11 and overlapped it by 300 either way. While a left step was allowed, N8's
  //   column slid left onto E6's, that one slid left in turn, and the moves came back round: the
  //   walk never settled at 112, 500 or 5000 steps and the capped undo left the overlap on screen.
  // - §3.4 settles it one step earlier still: N8 runs from 2400 to 3300, across column 3100, so the
  //   new node packs under it (1300) and N8 is not moved at all. The expectation was N8 → (2400,1200).
  const nodes = h4n11();
  assert.equal(overlapCount(nodes), 1);
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['N11'], report });
  assert.deepEqual(patches, { N11: { x: 3100, y: 1300 } });   // - clear of N8's row: 900 + 300 + 100
  assert.equal(report.capped, undefined);
  const once = apply(nodes, patches);
  assert.equal(overlapCount(once), 0);
  assert.deepEqual(layoutSection(once, { moverIds: ['N11'] }), {});
});

// 42
test('a node added right of its anchor takes the column slot and packs under what is there (H4 C4 + `l`)', () => {
  // - C4 (2400, 1000) 700x400 + `l`: the slot is the column right of it, at C4's row —
  //   2400 + 700 + 100 = 3200, y 1000. N8 already holds that column, so the pack sorts the new
  //   node under it instead of the old free-slot search walking on to x 4800, two columns out.
  const nodes = [note('N8', 3200, 800, 600, 300), note('N11', 3200, 1000, 700, 300)];
  const patches = layoutSection(nodes, { moverIds: ['N11'] });
  assert.deepEqual(patches, { N11: { x: 3200, y: 1200 } });   // - N8's row bottom + one gap
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['N11'] }), {});
});

// 43
test('a column that holds a node the walk is moving does not slide: the node in the way goes down', () => {
  // - M1 pushes A right onto B's column, which makes A active. A then overlaps B, and the sideways
  //   step for B's column would carry A along with it: the same overlap, the same 700px step, for
  //   ever (20 000 of them before the cap undid the walk). With the column held, B goes down.
  const nodes = [note('M1', 0, 400, 900, 200), note('A', 800, 500, 600, 900), note('B', 800, 800, 700, 400)];
  assert.equal(overlapCount(nodes), 2);
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['M1'], report, maxSteps: 20000 });
  assert.deepEqual(patches, {
    A: { x: 1000, y: 500 },    // - 200 right, clear of M1's 0..900
    B: { x: 1000, y: 1500 },   // - carried right with its column, then down under A: 500 + 900 + 100
  });
  assert.equal(report.capped, undefined);
  const once = apply(nodes, patches);
  assert.equal(overlapCount(once), 0);
  assert.deepEqual(layoutSection(once, { moverIds: ['M1'] }), {});
});

// 44
test('the down group does not carry the node doing the bumping either (downward runaway)', () => {
  // - the mirror of 43. M1 pushes A right onto B's column, and B sits ABOVE A there, so B is the one
  //   that has to go down. The group that goes down is B and everything under it in that column —
  //   which is A. Carried along, A kept the same overlap, 700px lower each step, for ever.
  const nodes = [note('M1', 0, 400, 700, 300), note('A', 700, 400, 700, 300), note('B', 800, 100, 700, 300)];
  assert.equal(overlapCount(nodes), 2);
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['M1'], report, maxSteps: 20000 });
  assert.deepEqual(patches, {
    A: { x: 800, y: 400 },   // - 100 right, clear of M1
    B: { x: 800, y: 800 },   // - down past A's row on its own: 400 + 300 + 100
  });
  assert.equal(report.capped, undefined);
  const once = apply(nodes, patches);
  assert.equal(overlapCount(once), 0);
  assert.deepEqual(layoutSection(once, { moverIds: ['M1'] }), {});
});

// 45
test('estimateCodeNeedPx counts the lines plus the chrome, a trailing newline being a line', () => {
  const LINE = 18, CHROME = 39;   // - CODE_LINE_H_ESTIMATE / CODE_CHROME_ESTIMATE
  assert.equal(estimateCodeNeedPx(''), LINE + CHROME);                  // - an empty cell is one line
  assert.equal(estimateCodeNeedPx('x = 1'), LINE + CHROME);
  assert.equal(estimateCodeNeedPx('a\nb'), 2 * LINE + CHROME);
  assert.equal(estimateCodeNeedPx('a\n'), 2 * LINE + CHROME);           // - Monaco shows the empty last line
  const twelve = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n');
  assert.equal(estimateCodeNeedPx(twelve), 12 * LINE + CHROME);
  const forty = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n');
  assert.equal(estimateCodeNeedPx(forty), 40 * LINE + CHROME);
});

// 46
test('a cell sized from its text stays at the default height for a few lines and hits the cap past 47', () => {
  const lines = n => Array.from({ length: n }, (_, i) => `l${i}`).join('\n');
  const from = n => codeCellHeight(estimateCodeNeedPx(lines(n)));
  assert.equal(from(1), 300);
  assert.equal(from(12), 300);     // - 12*18 + 39 = 255, still inside the default
  assert.equal(from(14), 300);     // - 291: the last line that fits
  assert.equal(from(15), 350);     // - 309: one step up
  assert.equal(from(40), 800);     // - 759 → 800
  assert.equal(from(48), 900);     // - 903 → capped
  assert.equal(from(60), 900);
  assert.equal(from(500), 900);
});

// 47
test('reflowSection snaps every column member onto a column, notes and files included', () => {
  const nodes = [
    code('E1', 1500, 0),
    note('T1', 1540, 400, 700, 300),    // - all but on the column already
    note('T2', 1900, 900, 700, 300),    // - 400 off it, inside half a pair
    note('T3', 2300, 1400, 700, 300),   // - 800 off it, further than half a pair
  ];
  const patches = reflowSection(nodes);
  assert.deepEqual(patches, {
    T1: { x: 1500, y: 400 },    // - joins E1's column and packs under it
    T2: { x: 1500, y: 800 },    // - adopted too, then one gap under T1
  });
  // - T3 is its own column, already one gap past E1's column: E1 has no output, so no slot is kept
  const after = apply(nodes, patches);
  assert.deepEqual(deriveColumns(after).map(c => c.cellIds), [['E1', 'T1', 'T2'], ['T3']]);
  assert.deepEqual(reflowSection(after), {});
});

// 48
test('a note well left of a code column keeps a column of its own; an output follows its cell', () => {
  const nodes = [
    note('T1', 1000, 1000, 400, 300),   // - 500 left of the code column: a column on the right is joined only one grid step away
    code('E1', 1500, 0, 300, 'C1'),
    cell('C1', 2300, 0, 600, 300),
    code('E2', 1500, 500),
    code('E3', 5000, 0, 300, 'C2'),     // - a pair parked far right
    cell('C2', 5800, 0, 600, 300),
  ];
  const patches = reflowSection(nodes);
  assert.deepEqual(patches, {
    E2: { x: 1500, y: 400 },    // - the code cells keep x 1500, one gap past T1's column (1000 + 400 + 100)
    E3: { x: 3000, y: 0 },      // - one gap past the first pair, which ends at 2900
    C2: { x: 3800, y: 0 },      // - the output rides along with its cell: 3000 + 700 + 100
  });
  const after = apply(nodes, patches);
  assert.deepEqual(deriveColumns(after).map(c => [c.x, c.cellIds]), [[1000, ['T1']], [1500, ['E1', 'E2']], [3000, ['E3']]]);
  assert.deepEqual(reflowSection(after), {});
});

// 49
test('reflowSection leaves an output cell and a kernel badge out of the column adoption', () => {
  const nodes = [
    code('E1', 0, 0, 300, 'C1'),
    cell('C1', 800, 0, 600, 300),
    { id: 'K1', type: 'kernel', x: 300, y: 600, w: 140, h: 160 },
  ];
  // - the badge is at a snapped x 300, well inside half a pair of the column at 0, and stays there
  assert.deepEqual(reflowSection(nodes), {});
});

// 50
test('two notes beside one column both land on it, in y order', () => {
  const nodes = [code('E1', 1500, 0), note('T2', 1560, 900, 400, 300), note('T1', 1540, 400, 400, 300)];
  const patches = reflowSection(nodes);
  assert.deepEqual(patches, { T2: { x: 1500, y: 800 }, T1: { x: 1500, y: 400 } });
  const after = apply(nodes, patches);
  assert.deepEqual(deriveColumns(after).map(c => c.cellIds), [['E1', 'T1', 'T2']]);
  assert.deepEqual(reflowSection(after), {});
});

// 51
test('a group pasted one gap right of the focused node packs into that column, it does not walk away', () => {
  // - the webview's yank-and-paste with N16 focused: directionSlot('L') puts the copy one gap right
  //   of N16 (0,2000 700 wide) — on 800,2000, where N3 already sits — and the engine runs with the
  //   copy as the mover. Inline fixture, not test/H4.canvas (a live file the user keeps changing):
  //   just the slice of it this case needs, at the values it held when the case was measured.
  const nodes = [
    { id: 'N16', type: 'text', x: 0,   y: 2000, width: 700, height: 300 },
    { id: 'N3',  type: 'text', x: 800, y: 1500, width: 700, height: 700 },
    { id: 'N15', type: 'text', x: 800, y: 2300, width: 700, height: 300 },
    { id: 'N14', type: 'text', x: 800, y: 2700, width: 700, height: 300 },
    { id: 'N12', type: 'text', x: 800, y: 3100, width: 700, height: 300 },
    { id: 'N20', type: 'text', x: 0,   y: 2400, width: 700, height: 300 },
  ];
  const sections = [{ id: 's1', y: 0, createdAt: 1 }];
  const copy = { id: 'paste-1', type: 'text', x: 800, y: 2000, width: 700, height: 300 };
  const members = sectionEngineNodes([...nodes, copy], sections, 'N16', [copy.id]);
  assert.ok(overlapCount(members) > 0, 'the slot is taken — that is the case under test');

  const patches = layoutSection(members, { moverIds: [copy.id] });
  const after = apply(members, patches);
  const at = id => { const n = after.find(x => x.id === id); return [n.x, n.y]; };
  assert.deepEqual(at('paste-1'), [800, 2300]);   // - N3's row ends at 2200, so the pack puts it one gap under
  assert.deepEqual(at('N16'), [0, 2000]);      // - the focused node stays where the user is looking
  assert.deepEqual(at('N3'),  [800, 1500]);    // - the note above the slot keeps its place
  assert.deepEqual(at('N15'), [800, 2700]);    // - the column under the copy moves down by its row
  assert.deepEqual(at('N20'), [0, 2400]);      // - the next column over is not touched
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: [copy.id] }), {});
});

// 52
test('a knowledge node at a column x is packed under that column like a note', () => {
  // - the engine has no knowledge case: isMember takes it because it is neither an output nor a
  //   kernel, so it joins the column it shares an x with and packs under the last cell there
  const kn = (id, x, y, w = 700, h = 300) => ({ id, type: 'knowledge', x, y, w, h });
  const nodes = [code('E1', 1500, 0), code('E2', 1500, 400), kn('K1', 1500, 500)];
  const patches = layoutSection(nodes, { moverIds: ['K1'] });
  assert.deepEqual(patches, { K1: { x: 1500, y: 800 } });
  const after = apply(nodes, patches);
  assert.deepEqual(deriveColumns(after).map(c => c.cellIds), [['E1', 'E2', 'K1']]);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['K1'] }), {});
});

// 53
// - the §3.4 shape, measured on the user's canvas: column 0 holds a 1500-wide cell (E15) that
//   reaches over column 800, and E14 sits off both columns. Literals, not the live file.
const wideCell = () => [
  code('E4', 0, 200, 100),
  code('E3', 0, 400, 200),
  { id: 'E15', type: 'code', x: 0, y: 700, w: 1500, h: 300 },
  code('E17', 0, 1100),
  code('E18', 0, 1500),
  code('E12', 0, 1900),
  code('E13', 800, 200),
  { id: 'E14', type: 'code', x: 1100, y: 1900, w: 500, h: 300 },
];
const at = (ns, id) => { const n = ns.find(x => x.id === id); return [n.x, n.y]; };

test('a cell moved into a column packs under the wide cell crossing it, not inside it', () => {
  const nodes = wideCell().map(n => (n.id === 'E14' ? { ...n, x: 800 } : n));
  const patches = layoutSection(nodes, { moverIds: ['E14'] });
  // - E13's row ends at 500, so the free row is 600 — but E15 spans 0..1500 and ends at 1000
  assert.deepEqual(patches, { E14: { x: 800, y: 1100 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['E14'] }), {});
});

// 54
test('a spanning cell does not widen its column: reflow leaves the column beside it where it fits', () => {
  const nodes = wideCell();
  const patches = reflowSection(nodes);
  // - column 0 is 700 wide (E15 spans, so it sets no width) and none of its cells has an output, so
  //   it ends at 700 and column 800 stays. E15's own width would have sent it to 1600. E14 joins
  //   column 800 and packs under E15.
  assert.deepEqual(patches, { E14: { x: 800, y: 1100 } });
  const after = apply(nodes, patches);
  assert.equal(at(after, 'E13')[0], 800);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after), {});
});

// 55
test('a wide note is the same obstacle as a wide code cell', () => {
  // - the same shape with E15 replaced by a plain 1500-wide note: the type does not matter
  const nodes = wideCell().map(n => (n.id === 'E15' ? { ...n, type: 'text' } : n))
    .map(n => (n.id === 'E14' ? { ...n, x: 800 } : n));
  assert.deepEqual(layoutSection(nodes, { moverIds: ['E14'] }), { E14: { x: 800, y: 1100 } });
});

// 56
test('an obstacle one gap above the row is not in the way, one that touches it is', () => {
  // - M2 is 1500 wide, so W1 at x 800 crosses it; M1 is 700 wide and clears W1 either way. The row
  //   M2 wants is 500. W1 ending at 400 leaves the full gap, so M2 takes 500; W1 ending ON 500
  //   leaves no gap at all — the engine asks for one everywhere else, so M2 moves under it.
  const shape = wy => [
    code('M1', 0, 100),
    { id: 'M2', type: 'code', x: 0, y: 700, w: 1500, h: 300 },
    { id: 'W1', type: 'text', x: 800, y: wy, w: 700, h: 300 },
  ];
  assert.deepEqual(layoutSection(shape(100), { moverIds: ['M2'] }), { M2: { x: 0, y: 500 } });
  assert.deepEqual(layoutSection(shape(200), { moverIds: ['M2'] }), { M2: { x: 0, y: 600 } });
  for (const wy of [100, 200]) {
    const nodes = shape(wy);
    const after = apply(nodes, layoutSection(nodes, { moverIds: ['M2'] }));
    assert.equal(overlapCount(after), 0, `W1 at ${wy}`);
    assert.deepEqual(layoutSection(after, { moverIds: ['M2'] }), {}, `W1 at ${wy}`);
  }
});

// 57
// - the §3.5 shape: the sequence edges of the same section, four of them bottom → top down column 0
//   and one right → left from E12 across to E14
const seqEdges = () => [
  { id: 'q1', fromNode: 'E4',  fromSide: 'bottom', toNode: 'E3',  toSide: 'top' },
  { id: 'q2', fromNode: 'E3',  fromSide: 'bottom', toNode: 'E15', toSide: 'top' },
  { id: 'q3', fromNode: 'E15', fromSide: 'bottom', toNode: 'E17', toSide: 'top' },
  { id: 'q4', fromNode: 'E17', fromSide: 'bottom', toNode: 'E18', toSide: 'top' },
  { id: 'q5', fromNode: 'E12', fromSide: 'right',  toNode: 'E14', toSide: 'left', keepRow: true },
];
const moved14 = () => wideCell().map(n => (n.id === 'E14' ? { ...n, x: 800 } : n));

test('a right-to-left sequence edge makes the target ride on its source row', () => {
  const nodes = moved14();
  const riders = ridersOf(nodes, seqEdges());
  assert.deepEqual([...riders], [['E14', 'E12']]);
  // - E12 is at 1900 and E14 is already on that row, so the pack has nothing to move. Without the
  //   edge the same call packs E14 up to 1100, under E15 (test 53) — the edge is what holds it here.
  assert.deepEqual(layoutSection(nodes, { moverIds: ['E14'], riders }), {});
  assert.deepEqual(layoutSection(nodes, { moverIds: ['E14'] }), { E14: { x: 800, y: 1100 } });

  // - and dropped anywhere else in that column it comes back to its source's row
  const dropped = nodes.map(n => (n.id === 'E14' ? { ...n, y: 300 } : n));
  const patches = layoutSection(dropped, { moverIds: ['E14'], riders: ridersOf(dropped, seqEdges()) });
  assert.deepEqual(patches, { E14: { x: 800, y: 1900 } });
  const after = apply(dropped, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['E14'], riders: ridersOf(after, seqEdges()) }), {});
});

// 58
test('removing the edge releases the cell and it packs up', () => {
  const nodes = moved14();
  const left = seqEdges().filter(e => e.id !== 'q5');
  assert.deepEqual([...ridersOf(nodes, left)], []);
  const patches = layoutSection(nodes, { moverIds: ['E14'], riders: ridersOf(nodes, left) });
  assert.deepEqual(patches, { E14: { x: 800, y: 1100 } });   // - under E15 again
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['E14'], riders: new Map() }), {});
});

// 59
test('a rider follows its source down and is pulled back with it', () => {
  // - the source really moves: E18 grows by 400, so E12 takes 2300 and E14 rides down to it
  const nodes = moved14().map(n => (n.id === 'E18' ? { ...n, h: 700 } : n));
  const riders = ridersOf(nodes, seqEdges());
  const patches = layoutSection(nodes, { moverIds: ['E18'], riders });
  assert.deepEqual(patches, { E12: { x: 0, y: 2300 }, E14: { x: 800, y: 2300 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['E18'], riders }), {});

  // - dragging E12 itself down by 400 moves nothing: its column packs tight, so E12 comes back to
  //   1900 and E14 stays on that row with it
  const dragged = moved14().map(n => (n.id === 'E12' ? { ...n, y: 2300 } : n));
  assert.deepEqual(layoutSection(dragged, { moverIds: ['E12'], riders: ridersOf(dragged, seqEdges()) }), { E12: { x: 0, y: 1900 } });
});

// 60
test('two riders of one source stack in their current order, the column packing around them', () => {
  const nodes = [...moved14(), code('E16', 800, 2600)];
  const edges = [...seqEdges(), { id: 'q6', fromNode: 'E12', fromSide: 'right', toNode: 'E16', toSide: 'left', keepRow: true }];
  const riders = ridersOf(nodes, edges);
  assert.deepEqual([...riders].sort(), [['E14', 'E12'], ['E16', 'E12']]);
  const patches = layoutSection(nodes, { moverIds: ['E16'], riders });
  assert.deepEqual(patches, { E16: { x: 800, y: 2300 } });   // - E14 holds 1900, E16 one gap under it
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['E16'], riders }), {});
});

// 61
test('a rider is a fixed row its column packs around', () => {
  const nodes = [code('S1', 0, 600), code('A1', 800, 200), code('R1', 800, 1500), code('B1', 800, 900)];
  const edges = [{ id: 'q1', fromNode: 'S1', fromSide: 'right', toNode: 'R1', toSide: 'left', keepRow: true }];
  const riders = ridersOf(nodes, edges);
  const patches = layoutSection(nodes, { moverIds: ['R1'], riders });
  assert.deepEqual(patches, {
    R1: { x: 800, y: 600 },    // - S1's row
    B1: { x: 800, y: 1000 },   // - was going to take 600; R1 holds it, so it packs under: 900 + 100
  });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['R1'], riders }), {});
});

// 62
test('only a right-to-left edge, left to right, makes a rider', () => {
  const nodes = moved14();
  const one = (from, to, fromSide, toSide) => [...ridersOf(nodes, [{ id: 'q', fromNode: from, toNode: to, fromSide, toSide, keepRow: true }])];
  assert.deepEqual(one('E12', 'E14', 'bottom', 'top'), []);     // - a bottom → top edge is a drawing
  assert.deepEqual(one('E12', 'E14', 'left', 'right'), []);     // - and so is a left → right one
  assert.deepEqual(one('E14', 'E12', 'right', 'left'), []);     // - the source has to sit LEFT
  assert.deepEqual(one('E4', 'E3', 'right', 'left'), []);       // - same column: no rider
  assert.deepEqual(one('E12', 'E14', undefined, undefined), [['E14', 'E12']]);   // - sides may be absent
  // - the node types do not matter: a note is a target like a code cell
  const note1 = [...nodes, note('T1', 800, 3000, 700, 300)];
  assert.deepEqual([...ridersOf(note1, [{ id: 'q', fromNode: 'E12', toNode: 'T1', fromSide: 'right', toSide: 'left', keepRow: true }])], [['T1', 'E12']]);
  // - a source outside the section's nodes is no source at all
  assert.deepEqual([...ridersOf(nodes, [{ id: 'q', fromNode: 'GONE', toNode: 'E14', fromSide: 'right', toSide: 'left', keepRow: true }])], []);
});

// 63
test('reflowSection keeps a rider on its source row', () => {
  const nodes = moved14();
  const riders = ridersOf(nodes, seqEdges());
  // - E14 stays on E12's row, 1900; without the edge Reflow packs it up under E15, to 1100
  assert.deepEqual(reflowSection(nodes, { riders }), {});
  assert.deepEqual(reflowSection(nodes), { E14: { x: 800, y: 1100 } });
  assert.equal(overlapCount(nodes), 0);
});

// 64
test('a rider whose source lands in its own column packs as a plain member', () => {
  // - Reflow snaps x onto columns before it packs, so S1 and T1 end up in one column; reading S1's y
  //   as T1's fixed row pushed S1 down and did it again on every call
  const nodes = [code('S1', 0, 100), code('S2', 0, 500), { id: 'T1', type: 'code', x: 700, y: 1500, w: 400, h: 300 }];
  const edges = [{ id: 'q', fromNode: 'S1', fromSide: 'right', toNode: 'T1', toSide: 'left', keepRow: true }];
  const riders = ridersOf(nodes, edges);
  assert.deepEqual([...riders], [['T1', 'S1']]);
  const patches = reflowSection(nodes, { riders });
  assert.deepEqual(patches, { T1: { x: 0, y: 900 } });   // - under S2: 500 + 300 + 100
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after, { riders }), {});
});

// 65
test('layoutSection packs a rider that shares its source column, leaving the source where it is', () => {
  const nodes = [code('S1', 0, 100), code('S2', 0, 500), code('T1', 0, 1500)];
  const riders = new Map([['T1', 'S1']]);
  const patches = layoutSection(nodes, { moverIds: ['T1'], riders });
  assert.deepEqual(patches, { T1: { x: 0, y: 900 } });
  assert.deepEqual(layoutSection(apply(nodes, patches), { moverIds: ['T1'], riders }), {});
});

// 66
test('a node the column only touches on the right is bumped right; one on the left stops the column', () => {
  // - right: O1 starts at the column's right edge, so it is no obstacle — M2 packs up to 500 and the
  //   bump moves O1 out of the way instead
  const right = [code('M1', 0, 100), code('M2', 0, 900), note('O1', 700, 500, 700, 300)];
  const rp = layoutSection(right, { columnX: 0 });
  assert.deepEqual(rp, { M2: { x: 0, y: 500 }, O1: { x: 800, y: 500 } });
  assert.deepEqual(layoutSection(apply(right, rp), { columnX: 0 }), {});

  // - left: L1 reaches the column x, within the gap the width rule asks for, so it is an obstacle and
  //   M2 stops under it at 900 rather than packing up to 500
  const left = [code('M1', 1000, 100), code('M2', 1000, 1500), note('L1', 300, 500, 700, 300)];
  const lp = layoutSection(left, { columnX: 1000 });
  assert.deepEqual(lp, { M2: { x: 1000, y: 900 } });
  assert.deepEqual(layoutSection(apply(left, lp), { columnX: 1000 }), {});
});

// 67
// - H4's S2 as the user had it: E15 spans 1600, and the edge E12 → E14 anchors E14 to E12's row
const s2Anchored = () => [
  code('E4', 0, 200, 100),
  code('E3', 0, 400, 200),
  { id: 'E15', type: 'code', x: 0, y: 700, w: 1600, h: 300 },
  code('E17', 0, 1100),
  code('E18', 0, 1500),
  code('E12', 0, 1900),
  code('E13', 800, 200),
  { id: 'E14', type: 'code', x: 800, y: 1900, w: 600, h: 300 },
  note('N27', 2300, 1200, 700, 300),
  { id: 'W1', type: 'knowledge', x: 3100, y: 1000, w: 700, h: 700 },
  { id: 'W2', type: 'knowledge', x: 3100, y: 2200, w: 700, h: 300 },
];

test('a node dropped on an anchored node in another column settles instead of leaving them overlapping', () => {
  const nodes = [...s2Anchored(), note('N25', 1300, 2000, 700, 300)];
  const riders = ridersOf(nodes, [{ id: 'q5', fromNode: 'E12', fromSide: 'right', toNode: 'E14', toSide: 'left', keepRow: true }]);
  assert.deepEqual([...riders], [['E14', 'E12']]);
  assert.equal(overlapCount(nodes), 1);   // - the drop left N25 on E14; that is the case under test
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['N25'], riders, report });
  // - E14 sits left of N25, so it has no sideways move. N25 is the node the operation placed and E14
  //   is above it, so N25 yields and drops one gap below E14's row: 1900 + 300 + 100.
  assert.deepEqual(patches, { N25: { x: 1300, y: 2300 } });
  assert.equal(!!report.capped, false);
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(at(after, 'E14'), [800, 1900]);   // - E14 keeps E12's row
  assert.deepEqual(layoutSection(after, { moverIds: ['N25'], riders }), {});
});

// 68
test('a bump pushes an anchored node off its row outside the packed columns; the next pack restores it', () => {
  const nodes = [code('S1', 0, 600), code('R1', 800, 600), note('M1', 1300, 400, 700, 300)];
  const riders = ridersOf(nodes, [{ id: 'q', fromNode: 'S1', fromSide: 'right', toNode: 'R1', toSide: 'left', keepRow: true }]);
  assert.deepEqual([...riders], [['R1', 'S1']]);
  // - M1 is dropped from above onto R1 and packs in its own column, 1300, so R1's column is none this
  //   call packs: R1 takes the downward bump and leaves S1's row
  const dropped = layoutSection(nodes, { moverIds: ['M1'], riders });
  assert.deepEqual(dropped, { R1: { x: 800, y: 800 } });
  const after = apply(nodes, dropped);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['M1'], riders }), {});

  // - the next call that packs R1's column puts it back on S1's row: S1 as the mover packs column 0
  //   and, S1 being the source, column 800 with it. M1 is in the way there and steps right.
  const back = layoutSection(after, { moverIds: ['S1'], riders });
  assert.deepEqual(back, { R1: { x: 800, y: 600 }, M1: { x: 1600, y: 400 } });
  const settled = apply(after, back);
  assert.equal(overlapCount(settled), 0);
  assert.deepEqual(layoutSection(settled, { moverIds: ['S1'], riders }), {});
});

// 69
// - H4's S2 on 2026-09-24: the text note N27 is connected from E18 (right → left) and was packed
//   under E14 instead of taking E18's row, because the rule then took code cells only
const n27Case = () => [
  code('E4', 0, 200, 100),
  code('E3', 0, 400, 200),
  { id: 'E15', type: 'code', x: 0, y: 700, w: 1600, h: 300 },
  code('E17', 0, 1100),
  code('E18', 0, 1900),
  code('E12', 0, 2300),
  code('E13', 800, 200),
  { id: 'E14', type: 'code', x: 800, y: 1100, w: 600, h: 300 },
  note('N27', 800, 1500, 600, 300),
];
const n27Edge = [{ id: 'q', fromNode: 'E18', fromSide: 'right', toNode: 'N27', toSide: 'left', keepRow: true }];

test('a note connected from a code cell on its left takes that cell row, and packs back once the edge goes', () => {
  const nodes = n27Case();
  const riders = ridersOf(nodes, n27Edge);
  assert.deepEqual([...riders], [['N27', 'E18']]);
  for (const mover of ['E14', 'N27']) {
    const patches = layoutSection(nodes, { moverIds: [mover], riders });
    assert.deepEqual(patches, { N27: { x: 800, y: 1900 } }, `mover ${mover}`);
    const after = apply(nodes, patches);
    assert.equal(overlapCount(after), 0);
    assert.deepEqual(layoutSection(after, { moverIds: [mover], riders: ridersOf(after, n27Edge) }), {}, `mover ${mover}`);

    // - the edge removed: N27 packs up under E14, 1100 + 300 + 100
    const released = layoutSection(after, { moverIds: [mover], riders: ridersOf(after, []) });
    assert.deepEqual(released, { N27: { x: 800, y: 1500 } }, `mover ${mover}`);
    const packed = apply(after, released);
    assert.equal(overlapCount(packed), 0);
    assert.deepEqual(layoutSection(packed, { moverIds: [mover], riders: new Map() }), {}, `mover ${mover}`);
  }
});

// 70
test('a note connected from a note on its left takes that note row', () => {
  const nodes = [note('A', 0, 300, 700, 300), note('B', 800, 0, 700, 300)];
  const edges = [{ id: 'q', fromNode: 'A', fromSide: 'right', toNode: 'B', toSide: 'left', keepRow: true }];
  const riders = ridersOf(nodes, edges);
  assert.deepEqual([...riders], [['B', 'A']]);
  const patches = layoutSection(nodes, { moverIds: ['B'], riders });
  assert.deepEqual(patches, { B: { x: 800, y: 300 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['B'], riders: ridersOf(after, edges) }), {});
});

// 71
test('an edge from an output cell anchors its target to the row of the output code cell', () => {
  const nodes = [code('S', 0, 300, 300, 'O'), cell('O', 800, 300), note('T', 1600, 0, 700, 300)];
  const edges = [{ id: 'q', fromNode: 'O', fromSide: 'right', toNode: 'T', toSide: 'left', keepRow: true }];
  const riders = ridersOf(nodes, edges);
  assert.deepEqual([...riders], [['T', 'S']]);   // - the map names the code cell, whose row the output has
  const patches = layoutSection(nodes, { moverIds: ['T'], riders });
  assert.deepEqual(patches, { T: { x: 1600, y: 300 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['T'], riders: ridersOf(after, edges) }), {});

  // - S dragged down to 700: its output comes back onto its row, and T follows both
  const dragged = after.map(n => (n.id === 'S' ? { ...n, y: 700 } : n));
  const moved = layoutSection(dragged, { moverIds: ['S'], riders: ridersOf(dragged, edges) });
  assert.deepEqual(moved, { O: { x: 800, y: 700 }, T: { x: 1600, y: 700 } });
  const settled = apply(dragged, moved);
  assert.deepEqual(layoutSection(settled, { moverIds: ['S'], riders: ridersOf(settled, edges) }), {});
});

// 72
test('a kernel badge or a band anchors nothing, as the source or as the target', () => {
  const kernel = (id, x, y) => ({ id, type: 'kernel', x, y, w: 140, h: 160 });
  const band = (id, x, y) => ({ id, type: 'group', x, y, w: 700, h: 300 });
  const edge = (from, to) => [{ id: 'q', fromNode: from, fromSide: 'right', toNode: to, toSide: 'left', keepRow: true }];
  const cases = [
    { nodes: [kernel('K', 0, 300), note('T', 800, 0, 700, 300)], from: 'K', to: 'T', mover: 'T' },
    { nodes: [band('G', 0, 300), note('T', 800, 0, 700, 300)], from: 'G', to: 'T', mover: 'T' },
    { nodes: [code('S', 0, 300), kernel('K', 800, 0)], from: 'S', to: 'K', mover: 'K' },
    { nodes: [code('S', 0, 300), band('G', 800, 0)], from: 'S', to: 'G', mover: 'G' },
  ];
  for (const c of cases) {
    const riders = ridersOf(c.nodes, edge(c.from, c.to));
    assert.deepEqual([...riders], [], `${c.from} → ${c.to}`);
    // - the target stays at y 0; a rider would have moved it to its source's row, 300
    assert.deepEqual(layoutSection(c.nodes, { moverIds: [c.mover], riders }), {}, `${c.from} → ${c.to}`);
  }
});

// 73
test('a node in the output column of its source takes the first row under that output', () => {
  // - H4 S1 N17 under C4: S's row in column 800 is held by its output O, so T packs one gap under O
  //   rather than on top of it — the two are pinned once packed and no bump would part them
  const nodes = [code('S', 0, 300, 300, 'O'), cell('O', 800, 300), note('T', 800, 1200, 700, 300)];
  const edges = [{ id: 'q', fromNode: 'S', fromSide: 'right', toNode: 'T', toSide: 'left', keepRow: true }];
  const riders = ridersOf(nodes, edges);
  assert.deepEqual([...riders], [['T', 'S']]);
  for (const mover of ['S', 'T']) {
    const patches = layoutSection(nodes, { moverIds: [mover], riders });
    assert.deepEqual(patches, { T: { x: 800, y: 700 } }, `mover ${mover}`);   // - 300 + 300 + 100
    const after = apply(nodes, patches);
    assert.equal(overlapCount(after), 0);
    assert.deepEqual(layoutSection(after, { moverIds: [mover], riders: ridersOf(after, edges) }), {}, `mover ${mover}`);
  }
  // - Reflow moves T's column right of the pair, where nothing holds the row any more: T takes S's row
  const reflowed = reflowSection(nodes, { riders });
  assert.deepEqual(reflowed, { T: { x: 1500, y: 300 } });
  const after = apply(nodes, reflowed);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after, { riders: ridersOf(after, edges) }), {});
});

// 74
// - H3 on 2026-09-24 as canvas_read gave it, one section. E7's output C1 holds E7's row in column
//   2400, so N8 (connected from E7) sits one gap under C1, and N10 (1400 wide, crossing column 2400)
//   packed under N8. Then E4 runs and its output lands where N8 is.
const h3Case = () => {
  const file = (id, x, y, w, h) => ({ id, type: 'file', x, y, w, h });
  return [
    file('M1', 0, 0, 700, 700), file('M2', 0, 780, 700, 700), note('N6', 0, 1580, 700, 300), note('N5', 0, 1980, 700, 300),
    note('N12', 0, 3300, 1500, 100), file('M5', 0, 3500, 700, 700),
    note('N1', 800, 0, 700, 300), note('N2', 800, 400, 700, 300), note('N7', 800, 800, 700, 300), file('M3', 800, 1180, 700, 700),
    file('M4', 800, 1980, 700, 1000), note('N13', 800, 3500, 700, 300), note('N14', 800, 3900, 700, 300), note('N15', 800, 4300, 700, 300),
    code('E7', 1600, 0, 300, 'C1'), code('E4', 1600, 400),
    note('N10', 1600, 1200, 1400, 100), note('N11', 1600, 1400, 700, 100), file('M6', 1600, 1600, 700, 900),
    cell('C1', 2450, 0), note('N8', 2400, 400, 600, 700),
    code('E9', 2400, 3300), code('E10', 2400, 3700), code('E11', 2400, 4100), note('N16', 3200, 4100, 700, 300),
  ];
};
const h3Edges = [
  { id: 'e1', fromNode: 'M1', fromSide: 'bottom', toNode: 'M2', toSide: 'top' },
  { id: 'e2', fromNode: 'M1', fromSide: 'right', toNode: 'N1', toSide: 'left', keepRow: true },
  { id: 'e3', fromNode: 'M1', fromSide: 'right', toNode: 'N2', toSide: 'left', keepRow: true },
  { id: 'e4', fromNode: 'E7', fromSide: 'right', toNode: 'N8', toSide: 'left', keepRow: true },
  { id: 'e5', fromNode: 'E7', fromSide: 'right', toNode: 'C1', toSide: 'left', keepRow: true },
];
const tooClosePairs = ns => {
  const out = [];
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (tooClose(ns[i], ns[j])) out.push(`${ns[i].id}×${ns[j].id}`);
  return out;
};

test('a new output on the row of a node held to another cell takes its code cell under that node, and the column below follows', () => {
  const before = h3Case();
  assert.deepEqual([...ridersOf(before, h3Edges)].sort(), [['N1', 'M1'], ['N2', 'M1'], ['N8', 'E7']]);
  // - the two pairs the user left closer than a gap, in columns this call does not pack
  assert.deepEqual(tooClosePairs(before), ['M1×M2', 'N7×M3']);
  const slot = placeOutput(before, 'E4');
  assert.deepEqual(slot, { x: 2400, y: 400, width: 600, height: 300 });   // - on N8
  const nodes = [...before.map(n => (n.id === 'E4' ? { ...n, outputNodeId: 'OUT' } : n)), cell('OUT', slot.x, slot.y, slot.width, slot.height)];
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['OUT'], riders: ridersOf(nodes, h3Edges), report });
  // - N8 is held to E7, not to E4, so it keeps its row (400, one gap under E7's output C1) and E4 goes
  //   one gap under N8 with OUT, 400 + 700 + 100 (decided by the user 2026-09-24). Column 1600 packs
  //   under E4: N10 at 1200 + 300 + 100, then N11 and M6 one gap apart.
  assert.deepEqual(patches, {
    E4: { x: 1600, y: 1200 }, OUT: { x: 2400, y: 1200 },
    N10: { x: 1600, y: 1600 }, N11: { x: 1600, y: 1800 }, M6: { x: 1600, y: 2000 },
  });
  assert.equal(!!report.capped, false);
  const after = apply(nodes, patches);
  assert.deepEqual(tooClosePairs(after), ['M1×M2', 'N7×M3']);
  assert.deepEqual(layoutSection(after, { moverIds: ['OUT'], riders: ridersOf(after, h3Edges) }), {});
});

// 75
test('two nodes held on one row, the wide one crossing the other column: the second goes under the first', () => {
  const nodes = [code('S', 0, 400), note('X', 800, 0, 1500, 300), note('R', 1600, 1000, 700, 300)];
  const edges = [
    { id: 'q1', fromNode: 'S', fromSide: 'right', toNode: 'X', toSide: 'left', keepRow: true },
    { id: 'q2', fromNode: 'S', fromSide: 'right', toNode: 'R', toSide: 'left', keepRow: true },
  ];
  const riders = ridersOf(nodes, edges);
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['S'], riders, report });
  // - X takes S's row and crosses column 1600 there; R takes the first row under X, 400 + 300 + 100
  assert.deepEqual(patches, { X: { x: 800, y: 400 }, R: { x: 1600, y: 800 } });
  assert.equal(!!report.capped, false);
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['S'], riders: ridersOf(after, edges) }), {});
});

// 76
test('a plain wide head of a packed column goes under a rider crossing it, not the rider under it', () => {
  // - W heads column 800 (Y above it is a rider of S1) and crosses column 1600, where R takes S2's
  //   row. Both columns are packed and no bump parts two packed nodes, so one of them has to clear
  //   the other: W is a plain member, so W's column packs down under R.
  const nodes = [code('S1', 0, 0), code('S2', 0, 400), note('Y', 800, 0, 700, 300), note('W', 800, 400, 1500, 300), note('R', 1600, 1000, 700, 300)];
  const edges = [
    { id: 'q1', fromNode: 'S1', fromSide: 'right', toNode: 'Y', toSide: 'left', keepRow: true },
    { id: 'q2', fromNode: 'S2', fromSide: 'right', toNode: 'R', toSide: 'left', keepRow: true },
  ];
  const riders = ridersOf(nodes, edges);
  for (const mover of ['S1', 'S2', 'R']) {
    const report = {};
    const patches = layoutSection(nodes, { moverIds: [mover], riders, report });
    assert.deepEqual(patches, { R: { x: 1600, y: 400 }, W: { x: 800, y: 800 } }, `mover ${mover}`);   // - 400 + 300 + 100
    assert.equal(!!report.capped, false);
    const after = apply(nodes, patches);
    assert.equal(overlapCount(after), 0, `mover ${mover}`);
    assert.deepEqual(layoutSection(after, { moverIds: [mover], riders: ridersOf(after, edges) }), {}, `mover ${mover}`);
  }
});

// 77
test('two nodes held on one row in one column keep their current order, not the id order', () => {
  // - B sits above A now; the id order would put A on S's row
  const nodes = [code('S', 0, 400), note('B', 800, 0, 700, 300), note('A', 800, 1200, 700, 300)];
  const edges = [
    { id: 'q1', fromNode: 'S', fromSide: 'right', toNode: 'A', toSide: 'left', keepRow: true },
    { id: 'q2', fromNode: 'S', fromSide: 'right', toNode: 'B', toSide: 'left', keepRow: true },
  ];
  const riders = ridersOf(nodes, edges);
  const patches = layoutSection(nodes, { moverIds: ['S'], riders });
  assert.deepEqual(patches, { B: { x: 800, y: 400 }, A: { x: 800, y: 800 } });   // - 400 + 300 + 100
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['S'], riders: ridersOf(after, edges) }), {});
  // - on a tie of the current y the column's own tie order decides: the mover first, then the id
  const tied = [code('S', 0, 400), note('B', 800, 1200, 700, 300), note('A', 800, 1200, 700, 300)];
  for (const [mover, top, under] of [['B', 'B', 'A'], ['A', 'A', 'B']]) {
    const p = layoutSection(tied, { moverIds: [mover], riders: ridersOf(tied, edges) });
    assert.deepEqual(p, { [top]: { x: 800, y: 400 }, [under]: { x: 800, y: 800 } }, `mover ${mover}`);
    const a = apply(tied, p);
    assert.deepEqual(layoutSection(a, { moverIds: [mover], riders: ridersOf(a, edges) }), {}, `mover ${mover}`);
  }
});

// 78
test('Reflow keeps room for outputs only right of a column that has an output', () => {
  // - column 0 holds code cells, none of them run: the notes one gap right of it stay at x 800
  const nodes = [code('E1', 0, 0), code('E2', 0, 600), note('J1', 800, 0, 700, 300), note('J2', 800, 700, 700, 300)];
  const patches = reflowSection(nodes);
  assert.deepEqual(patches, { E2: { x: 0, y: 400 }, J2: { x: 800, y: 400 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after), {});
  // - forkOf still clears the outputs to come: the fork of E1 starts right of the empty output slot
  assert.deepEqual(forkOf(after, 'E1', 'right'), { x: 1500, y: 0 });
});

// 79
test('a rider goes under its own source when the source reaches its column, and the call is stable', () => {
  // - the source is a plain member, but packed around its rider it would move the row the rider
  //   follows, and the two would walk down together. 1100 wide crosses column 800; 800 wide stops
  //   inside the gap before it. Either way R takes the first row under S: 400 + 300 + 100.
  for (const w of [1100, 800]) {
    const nodes = [code('A', 0, 0), { ...code('S', 0, 400), w }, note('R', 800, 0, 700, 100)];
    const edges = [{ id: 'q', fromNode: 'S', fromSide: 'right', toNode: 'R', toSide: 'left', keepRow: true }];
    for (const mover of ['A', 'S', 'R']) {
      const report = {};
      const patches = layoutSection(nodes, { moverIds: [mover], riders: ridersOf(nodes, edges), report });
      assert.deepEqual(patches, { R: { x: 800, y: 800 } }, `S ${w} wide, mover ${mover}`);
      assert.equal(!!report.capped, false);
      const after = apply(nodes, patches);
      assert.equal(overlapCount(after), 0);
      assert.deepEqual(layoutSection(after, { moverIds: [mover], riders: ridersOf(after, edges) }), {}, `S ${w} wide, mover ${mover}`);
    }
  }
});

// 80
test('a plain member that stops inside the gap before a rider column packs under the rider', () => {
  // - M, 800 wide in column 0, ends where column 800 starts. R keeps S's row, 0 to 500, and M packs
  //   under it: 500 + 100. When M is the mover it holds its row and R goes under it instead.
  const nodes = [code('S', 0, 0), note('M', 0, 400, 800, 100), note('R', 800, 600, 600, 500)];
  const edges = [{ id: 'q', fromNode: 'S', fromSide: 'right', toNode: 'R', toSide: 'left', keepRow: true }];
  const patches = layoutSection(nodes, { moverIds: ['S'], riders: ridersOf(nodes, edges) });
  assert.deepEqual(patches, { R: { x: 800, y: 0 }, M: { x: 0, y: 600 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['S'], riders: ridersOf(after, edges) }), {});
  // - M as the mover keeps its row, 400, and R goes one gap under it, even when R starts on M's row:
  //   400 + 100 + 100
  const onRow = nodes.map(n => (n.id === 'R' ? { ...n, y: 300 } : n));
  const moved = layoutSection(onRow, { moverIds: ['M'], riders: ridersOf(onRow, edges) });
  assert.deepEqual(moved, { R: { x: 800, y: 600 } });
  const settled = apply(onRow, moved);
  assert.equal(overlapCount(settled), 0);
  assert.deepEqual(layoutSection(settled, { moverIds: ['M'], riders: ridersOf(settled, edges) }), {});
});

// 81
test('Reflow packs a plain member around a rider as a regular call does, and a second Reflow changes nothing', () => {
  const e = (from, to) => ({ id: `${from}-${to}`, fromNode: from, fromSide: 'right', toNode: to, toSide: 'left', keepRow: true });
  // - test 76's shape: W heads column 800 and crosses column 1600, where R takes S2's row
  const wide = [code('S1', 0, 0), code('S2', 0, 400), note('Y', 800, 0, 700, 300), note('W', 800, 400, 1500, 300), note('R', 1600, 1000, 700, 300)];
  // - test 80's shape: M stops inside the gap before column 800, where R takes S's row. Column 0 has
  //   no output, so Reflow leaves column 800 where it is.
  const touching = [code('S', 0, 0), note('M', 0, 400, 800, 100), note('R', 800, 600, 600, 500)];
  for (const [nodes, edges, want] of [
    [wide, [e('S1', 'Y'), e('S2', 'R')], { R: { x: 1600, y: 400 }, W: { x: 800, y: 800 } }],
    [touching, [e('S', 'R')], { R: { x: 800, y: 0 }, M: { x: 0, y: 600 } }],
  ]) {
    const patches = reflowSection(nodes, { riders: ridersOf(nodes, edges) });
    assert.deepEqual(patches, want);
    const after = apply(nodes, patches);
    assert.equal(overlapCount(after), 0);
    assert.deepEqual(reflowSection(after, { riders: ridersOf(after, edges) }), {});
  }
});

// - a call, its result, no two nodes closer than a gap, and a second call that moves nothing
const settles = (nodes, edges, moverIds, want, label = '') => {
  const report = {};
  const patches = layoutSection(nodes, { moverIds, riders: ridersOf(nodes, edges), hanging: hangingBelow(nodes, edges), report });
  assert.deepEqual(patches, want, label);
  assert.equal(!!report.capped, false, label);
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0, label);
  assert.deepEqual(layoutSection(after, { moverIds, riders: ridersOf(after, edges), hanging: hangingBelow(after, edges) }), {}, label);
  return after;
};
const edgeTo = (from, to) => ({ id: `${from}-${to}`, fromNode: from, fromSide: 'right', toNode: to, toSide: 'left', keepRow: true });
const edgeDown = (from, to) => ({ id: `${from}v${to}`, fromNode: from, fromSide: 'bottom', toNode: to, toSide: 'top' });

// 82
test('a plain member counts a packed node of another column that stops inside the gap, not only one that crosses', () => {
  // - M (800 wide) ends where column 800 starts. Once R holds S's row, 0 to 500, M packs under R, to
  //   600, and then under P (600 to 900), to 1000. Stopping at 600 left M and P closer than a gap.
  const nodes = [code('S', 0, 0), note('M', 0, 400, 800, 100), note('P', 800, 600, 600, 300), note('R', 800, 1200, 600, 500)];
  const edges = [edgeTo('S', 'R')];
  const first = settles(nodes, edges, ['R'], { M: { x: 0, y: 1000 }, R: { x: 800, y: 0 } }, 'mover R');
  settles(first, edges, ['S'], {}, 'mover S');
  // - Reflow, with S a note: the same rows. M (800 wide) clears R and P, the nodes it reaches over,
  //   and takes 1000; the wide node gives way (§3.4).
  const asNote = nodes.map(n => (n.id === 'S' ? note('S', 0, 0, 700, 300) : n));
  const reflowed = reflowSection(asNote, { riders: ridersOf(asNote, edges) });
  assert.deepEqual(reflowed, { M: { x: 0, y: 1000 }, R: { x: 800, y: 0 } });
  const after = apply(asNote, reflowed);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after, { riders: ridersOf(after, edges) }), {});
});

// 83
test('a held node of another column goes under a mover; a plain node no bump moves does not', () => {
  // - M 1500 wide, below the head of its column, crossing column 800 where R sits: R goes under M,
  //   400 + 300 + 100
  const wide = [code('S', 0, 0), note('M', 0, 400, 1500, 300), note('R', 800, 300, 700, 500)];
  settles(wide, [edgeTo('S', 'R')], ['M'], { R: { x: 800, y: 800 } }, '1500 wide');
  // - M dropped at (0, 400), 800 wide, ends where column 800 starts. P heads that column at 600 and no
  //   bump moves it, so M packs one gap under P, 600 + 300 + 100; R keeps S's row
  const tidy = [code('S', 0, 0), note('R', 800, 0, 700, 500), note('P', 800, 600, 700, 300)];
  settles([...tidy, note('M', 0, 400, 800, 300)], [edgeTo('S', 'R')], ['M'], { M: { x: 0, y: 1000 } }, '800 wide');
});

// 84
test('a column head does not move down for a held node that has not yet taken its row', () => {
  // - N0 is held to E7 and sits at 400 before the call, on E6's rows. It goes to E7's row this call,
  //   so E6, the head of column 0, stays at 100.
  const nodes = [code('E6', 0, 100), { ...code('E7', 0, 700, 300, 'OE7'), w: 600 }, cell('OE7', 1400, 600, 700, 300), note('N0', 500, 400, 800, 100)];
  settles(nodes, [edgeTo('E7', 'N0')], ['E7'], { E7: { x: 0, y: 500 }, OE7: { x: 800, y: 500 }, N0: { x: 500, y: 900 } });
});

// 85
test('a mover that heads its column does not go under a held node of another column', () => {
  // - W (moved) heads column 1600; F, held on S1's row, pushes it to 800, onto R's row (R is held
  //   to S0, 1500 wide, crossing column 1600). W is a mover, so R goes under it: 800 + 300 + 100.
  const nodes = [code('S1', 0, 400), code('S0', 0, 800), note('R', 800, 0, 1500, 300), note('W', 1600, 400, 700, 300), note('F', 1600, 1500, 700, 300)];
  settles(nodes, [edgeTo('S0', 'R'), edgeTo('S1', 'F')], ['S0', 'W'], { R: { x: 800, y: 1200 }, W: { x: 1600, y: 800 }, F: { x: 1600, y: 400 } });
});

// 86
test('a column head does not pack around the node held to it', () => {
  // - N0 heads column 1600 and is the source of N2. In the first round N2 lands at 1900, just under
  //   N0's old row; N0 then clears N3 (held to N4) to 1200. Packed around N2 as well, N0 would drop to
  //   2500 and N2 would follow it to 3300.
  const nodes = [note('N0', 1600, 600, 600, 700), code('E1', 0, 0), note('N2', 1700, 1100, 600, 500), note('N3', 1600, 1000, 750, 100), note('N4', 0, 300, 1400, 700), note('N6', 0, 300, 1400, 500)];
  settles(nodes, [edgeTo('N4', 'N3'), edgeTo('N0', 'N2')], ['N6'], {
    N0: { x: 1600, y: 1200 }, N2: { x: 1700, y: 2000 }, N4: { x: 0, y: 1000 }, N6: { x: 0, y: 400 },
  });
});

// 87
test('a stacked member does not pack around the node held to it', () => {
  // - N2 (800 wide) is stacked in column 0 and is the source of N0 and N3. Packed around N0 it would
  //   drop, N0 and N3 would follow it, and E4, the head of column 1600, would clear N3's passing row
  //   and stay at 2800 once the others came back up. Here E4 clears N3 and N0 only: 2100.
  const nodes = [note('N0', 800, 800, 1100, 500), note('N1', 0, 100, 700, 500), note('N2', 0, 500, 800, 700), note('N3', 1600, 300, 800, 700), code('E4', 1600, 1100, 500)];
  settles(nodes, [edgeTo('N2', 'N0'), edgeTo('N2', 'N3')], ['N1'], {
    N0: { x: 800, y: 1500 }, N2: { x: 0, y: 700 }, N3: { x: 1600, y: 700 }, E4: { x: 1600, y: 2100 },
  });
});

// 88
test('a column head clears a held node of the next column that stops inside the gap', () => {
  // - N2 (750 wide) heads column 1600 and ends 50 px before column 2400, where E3 takes E0's row,
  //   600 to 1100. N2 clears E0 (its own column's held node) to 1000 and then E3 to 1200.
  const nodes = [code('E0', 1600, 1000), { ...code('E1', 0, 600), w: 600 }, note('N2', 1600, 0, 750, 700), code('E3', 2400, 1000, 500)];
  settles(nodes, [edgeTo('E1', 'E0'), edgeTo('E0', 'E3')], ['E0'], { E0: { x: 1600, y: 600 }, N2: { x: 1600, y: 1200 }, E3: { x: 2400, y: 600 } });
});

// 89
test('a held node goes under an output that it stops inside the gap before', () => {
  // - R (750 wide) ends 50 px before O, the output E parked at 1600 on S's row. R takes the first
  //   row under O: 400 + 300 + 100.
  const nodes = [code('S', 0, 0), code('E', 0, 400, 300, 'O'), cell('O', 1600, 400), note('R', 800, 1200, 750, 700)];
  settles(nodes, [edgeTo('S', 'R')], ['S'], { R: { x: 800, y: 800 } });
});

// 90
test('a column packs around the output of its held node, not only the node', () => {
  // - E, held to S, takes row 0 and its output O (700 tall) rides with it. H (1500 wide, spanning
  //   because Z starts a column at 2300) heads column 800 and crosses O's column: it clears O, 0 to
  //   700, to 800.
  const nodes = [code('S', 0, 0), code('E', 800, 1000, 300, 'O'), cell('O', 1600, 1000, 600, 700), note('H', 800, 400, 1500, 300), note('Z', 2300, 3000, 700, 300)];
  settles(nodes, [edgeTo('S', 'E')], ['S'], { E: { x: 800, y: 0 }, O: { x: 1600, y: 0 }, H: { x: 800, y: 800 } });
});

// 91
test('Reflow does not hold a node its snap has put in its source column', () => {
  // - N3 (1500 wide) at x 900 is held to E0 (column 800) by its edge. Reflow snaps N3 into column 800,
  //   E0's own column, where the edge holds nothing. Counted as held anyway, N3 kept its row next to
  //   N2, the two ended closer than a gap, and a second Reflow moved three nodes.
  const nodes = [{ ...code('E0', 800, 200, 500), w: 600 }, code('E1', 800, 500, 300, 'OE1'), cell('OE1', 1700, 500, 600, 300), note('N2', 1600, 600, 1100, 300), note('N3', 900, 400, 1500, 500)];
  const edges = [edgeTo('E0', 'N3')];
  const patches = reflowSection(nodes, { riders: ridersOf(nodes, edges) });
  assert.deepEqual(patches, { E1: { x: 800, y: 1600 }, OE1: { x: 1600, y: 1600 }, N2: { x: 2300, y: 600 }, N3: { x: 800, y: 1000 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after, { riders: ridersOf(after, edges) }), {});
});

// 92
test('a mover that ends inside the gap before a plain head of a packed column packs under it', () => {
  // - M (800 wide), dropped under S, ends where column 800 starts, on P's rows. P heads column 800 and
  //   no bump moves either of them, so M counts P within the gap like any member and goes one gap
  //   under it: 400 + 300 + 100. R, held on S's row, keeps it.
  const nodes = [code('S', 0, 0), note('R', 800, 0, 700, 300), note('P', 800, 400, 700, 300), note('M', 0, 400, 800, 300)];
  for (const movers of [['M'], ['M', 'S'], ['S']]) settles(nodes, [edgeTo('S', 'R')], movers, { M: { x: 0, y: 800 } }, movers.join('+'));
});

// 93
test('a node held under a mover follows the rows the bumps leave that mover on', () => {
  // - N8 and E1 are dragged together; N5 is held to N8 and N3 sits left of N8's column. The pack puts
  //   E1 at 900 and N5 under it; then N8 pushes N3 down to 800 and E1, below N3's top, drops under N3
  //   to 1600. The packs run again on those rows: N5 goes back under N8 alone, 0 + 700 + 100.
  const nodes = [note('N8', 700, 0, 1400, 700), code('E1', 700, 1200), note('N5', 800, 900, 800, 500), note('N3', 0, 100, 700, 700)];
  settles(nodes, [edgeTo('N8', 'N5')], ['N8', 'E1'], { E1: { x: 700, y: 1600 }, N5: { x: 800, y: 800 }, N3: { x: 0, y: 800 } });
});

// 94
test('a column head moves only for a row a held node keeps at the end of the call', () => {
  // - OE5 (E5's output) is dragged onto N3's rows. N3 and N4 are held to E5. In the first round N3
  //   passes through 2000 to 2500, over N7 (the head of column 3600, at 1800), and ends at 1000 to
  //   1500. N7 stays at 1800.
  const a = [note('N3', 3600, 600, 800, 500), note('N4', 4400, 1200, 600, 700), { ...code('E5', 1600, 200, 300, 'OE5'), w: 600 }, cell('OE5', 3400, 500, 700, 500), note('N7', 3600, 1800, 600, 300)];
  settles(a, [edgeTo('E5', 'N3'), edgeTo('E5', 'N4')], ['OE5'], { N3: { x: 3600, y: 1000 }, N4: { x: 4400, y: 200 }, OE5: { x: 3400, y: 200 } }, 'output dragged');
  // - H (900 wide) heads column 800 under Q and reaches column 1600, where N3 is held on E5's row. N4
  //   (held to E5, column 2400) starts on N3's row and moves off it; N3 ends at 200, and H stays at 600.
  const b = [code('E5', 0, 200), note('Q', 800, 200, 700, 300), note('H', 800, 600, 900, 300), note('N3', 1600, 200, 800, 300), note('N4', 2400, 100, 600, 700)];
  settles(b, [edgeTo('E5', 'Q'), edgeTo('E5', 'N3'), edgeTo('E5', 'N4')], ['E5'], { N4: { x: 2400, y: 600 } }, 'source moved');
});

// 95
test('when the packs do not settle with the heads coming back up, the heads stop coming back up', () => {
  // - N0 and E3 moved together; N7 is held to E3. Heads starting from their old rows every round do
  //   not settle here and ended with N7 on N0 and on E2. After 8 rounds the heads only move down, and
  //   the rounds settle.
  const nodes = [note('N0', 1600, 800, 600, 700), { ...code('E2', 800, 1100, 500, 'OE2'), w: 600 }, cell('OE2', 1500, 1100, 700, 300), { ...code('E3', 800, 1100), w: 600 }, note('N7', 900, 600, 750, 300)];
  settles(nodes, [edgeTo('E3', 'N7')], ['N0', 'E3'], { N0: { x: 1600, y: 2700 }, E2: { x: 800, y: 1900 }, OE2: { x: 1500, y: 1900 }, N7: { x: 900, y: 1500 } });
});

// 96
test('a held node outside the packed columns does not follow its source down a bump', () => {
  // - E3 (moved) is held to N4 and goes under it, 400 + 100 + 100. N4 is held to N2, but N4's column
  //   is not packed, so N4 is a plain node for the bumps. When E3 pushes N2 down, N4 used to follow N2,
  //   land on E3 from above, E3 yielded below it and pushed N2 again, 100 px lower each time, until
  //   the step cap undid the walk.
  const nodes = [note('N0', 2500, 800, 600, 100), note('N2', 1600, 900, 800, 100), { ...code('E3', 2400, 100, 300, 'OE3'), w: 600 }, cell('OE3', 3100, 100, 700, 500), note('N4', 1700, 400, 1500, 100)];
  settles(nodes, [edgeTo('N2', 'N4'), edgeTo('N4', 'E3')], ['E3'], { N0: { x: 2500, y: 1200 }, N2: { x: 1600, y: 1000 }, E3: { x: 2400, y: 600 }, OE3: { x: 3100, y: 600 } });
});

// 97
test('Reflow leaves no two boxes on top of each other: a head clears what crosses it, an output too', () => {
  const intersect = ns => { const o = []; for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { const a = ns[i], b = ns[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h && a.outputNodeId !== b.id && b.outputNodeId !== a.id) o.push(`${a.id}x${b.id}`); } return o; };
  // - W (1400 wide) heads column 0 and reaches column 800, where N heads its column on W's rows. On
  //   Reflow a head clears obstacles like a stacked member, and the wide node gives way (decided by
  //   the user): column 0 packs first, so W goes under N, 100 + 300 + 100, and E follows.
  const wide = [note('W', 0, 0, 1400, 300), code('E', 0, 400), note('N', 800, 100, 700, 300)];
  const p1 = reflowSection(wide);
  assert.deepEqual(p1, { W: { x: 0, y: 500 }, E: { x: 0, y: 900 } });
  const a1 = apply(wide, p1);
  assert.deepEqual(intersect(a1), []);
  assert.deepEqual(reflowSection(a1), {});
  // - E2 is held to N0 and takes its row, 700, with OE2 (500 tall) beside it. E3 heads the rest of
  //   column 1600: its own box clears E2 at 1100, but its output would land on OE2, so it takes 1300.
  const outs = [note('N0', 900, 600, 1500, 700), note('N1', 1600, 1100, 600, 300), code('E2', 1600, 700, 300, 'OE2'), cell('OE2', 2400, 700, 600, 500),
    { ...code('E3', 1600, 700, 300, 'OE3'), w: 600 }, cell('OE3', 2300, 700, 700, 500), note('N4', 0, 300, 1100, 300)];
  const edges = [edgeTo('N0', 'E2')];
  const p2 = reflowSection(outs, { riders: ridersOf(outs, edges) });
  assert.deepEqual(p2, { N0: { x: 0, y: 700 }, N1: { x: 1600, y: 1900 }, E3: { x: 1600, y: 1300 }, OE3: { x: 2400, y: 1300 } });
  const a2 = apply(outs, p2);
  assert.deepEqual(intersect(a2), []);
  assert.deepEqual(reflowSection(a2, { riders: ridersOf(a2, edges) }), {});
});

// 98
test('Reflow brings a head back up once the tight pass has moved the column it cleared', () => {
  // - N4 (1400 wide) heads column 900 and reaches column 1600, where N3 sits on its row: the first
  //   pack puts N4 under N3, at 400. The tight pass then moves column 1600 to 2400, out of N4's way,
  //   and the second pack starts N4 from 200 again.
  const nodes = [code('E1', 1600, 1100), note('N3', 1600, 200, 800, 100), note('N4', 900, 200, 1400, 300)];
  const patches = reflowSection(nodes);
  assert.deepEqual(patches, { E1: { x: 2400, y: 400 }, N3: { x: 2400, y: 200 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after), {});
});

// 99
test('when packs and bumps do not settle in their turns, the call keeps the first turn and reports it', () => {
  // - N1 held to E2; the mover N1 yields under N5 and takes N8 with it: the first turn moves N8 400
  const b = [note('N1', 3100, 1600, 800, 500), { ...code('E2', 1500, 1200, 500), w: 600 }, note('N5', 2300, 800, 750, 700), note('N8', 3100, 2200, 600, 500)];
  const r2 = {};
  assert.deepEqual(layoutSection(b, { moverIds: ['N1'], riders: ridersOf(b, [edgeTo('E2', 'N1')]), report: r2 }), { N8: { x: 3100, y: 2600 } });
  assert.equal(r2.capped, true);
});

// 100
test('a column head clears a node no bump will move, by a full gap, like a stacked member', () => {
  // - S (dragged up to 0) holds Q and R on its row. A (800 wide) heads column 800 and reaches column
  //   1600, where B heads its column; neither is moved by a bump, so A packs under R and then under B:
  //   700 + 300 + 100.
  const dragged = [code('S', 0, 0), note('Q', 800, 1500, 700, 100), note('A', 800, 200, 800, 300), note('B', 1600, 700, 700, 300), note('R', 1600, 1500, 700, 500)];
  settles(dragged, [edgeTo('S', 'Q'), edgeTo('S', 'R')], ['S'], { Q: { x: 800, y: 0 }, A: { x: 800, y: 1100 }, R: { x: 1600, y: 0 } }, 'two heads');
  // - M (800 wide) dropped at the top of column 0 ends where column 800 starts, on P's rows: M, now
  //   the head, clears P and goes to 500; T, S and R follow
  const dropped = [note('T', 0, 0, 600, 1000), code('S', 0, 1100), note('R', 800, 1100, 700, 300), note('P', 800, 100, 700, 300), note('M', 0, 0, 800, 300)];
  settles(dropped, [edgeTo('S', 'R')], ['M'], { T: { x: 0, y: 900 }, S: { x: 0, y: 2000 }, R: { x: 800, y: 2000 }, M: { x: 0, y: 500 } }, 'mover heads its column');
  // - E7 moved; N6 held to E3 holds N10 and N11. N1 heads column 800 under N6 and ends next to E0,
  //   the head of column 1600: it clears E0 and takes 2900.
  const c = [code('E0', 1600, 1700), note('N1', 800, 1500, 800, 100), code('E3', 100, 100), note('N6', 800, 100, 1100, 700), { ...code('E7', 100, 900), h: 500 }, note('N10', 1600, 900, 1500, 500), note('N11', 3100, 1700, 700, 700)];
  settles(c, [edgeTo('N6', 'N11'), edgeTo('E3', 'N6'), edgeTo('N6', 'N10')], ['E7'], {
    E0: { x: 1600, y: 2500 }, N1: { x: 800, y: 2900 }, N6: { x: 800, y: 1100 }, E7: { x: 100, y: 500 }, N10: { x: 1600, y: 1900 }, N11: { x: 3100, y: 1100 },
  }, 'packed head beside');
});

// 101
test('a call whose turns do not settle keeps its result, unreported, when a second call would move nothing', () => {
  // - N2 (moved) is held to E0 and takes 600. The turns inside the call do not settle, but the result
  //   is one a second call leaves alone, so it stands and the call is not reported capped.
  const nodes = [code('E0', 900, 500, 500), code('E1', 1700, 200), note('N2', 2400, 1000, 1500, 500)];
  settles(nodes, [edgeTo('E0', 'N2')], ['N2'], { N2: { x: 2400, y: 600 } });
});

// 102
test('a held node outside the packed columns follows its source down a bump, unless it is a source of the node pushing', () => {
  // - N3 (moved) pushes N1 down; E5 is held to N1 in a column this call does not pack and follows N1
  //   to 600, its output with it. Left behind, E5 started a walk that never settled.
  const nodes = [note('N1', 0, 400, 1400, 100), note('N2', 2500, 200, 1400, 300), note('N3', 900, 0, 1500, 500), { ...code('E5', 2400, 400, 500, 'OE5'), w: 600 }, cell('OE5', 3100, 600, 600, 500)];
  settles(nodes, [edgeTo('N1', 'E5')], ['N3'], { N1: { x: 0, y: 600 }, E5: { x: 2400, y: 600 }, OE5: { x: 3100, y: 800 } });
});

// 103
// - tests/fixtures/H3.json S1 with the ids replaced by the labels the user sees. E4 runs and its new
//   output C6 lands on N8, which is held to E7's row.
const h3Fixture = () => {
  const data = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'H3.json'), 'utf8'));
  const label = new Map(data.nodes.map(n => [n.id, n.nodeLabel]));
  const nodes = toEngineNodes(data.nodes.map(n => ({ ...n, id: label.get(n.id), ...(n.outputNodeId ? { outputNodeId: label.get(n.outputNodeId) } : {}) })));
  const edges = allHeld(data.edges).map(e => ({ ...e, fromNode: label.get(e.fromNode), toNode: label.get(e.toNode) }));
  return { nodes, edges };
};

test('a new output that lands on a node held to another cell row takes its code cell down under that node', () => {
  const { nodes: before, edges } = h3Fixture();
  assert.equal(ridersOf(before, edges).get('N8'), 'E7');
  assert.equal(ridersOf(before, edges).has('N3'), false);
  const slot = placeOutput(before, 'E4');
  assert.deepEqual(slot, { x: 2600, y: 400, width: 600, height: 300 });   // - on N8, (2600, 0) 600×700
  const nodes = [...before.map(n => (n.id === 'E4' ? { ...n, outputNodeId: 'C6' } : n)), cell('C6', slot.x, slot.y, slot.width, slot.height)];
  assert.deepEqual(tooClosePairs(nodes), ['N8×C6']);
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['C6'], riders: ridersOf(nodes, edges), report });
  assert.equal(!!report.capped, false);
  // - N8 and C3 (held to N8) stay; E4 and C6 go one gap under N8, 0 + 700 + 100. N10, 2200 wide,
  //   starts under E4 at 1200 and goes under N4 (3300, 1000, 300 tall), to 1400; the rest of column
  //   1800 follows one gap apart, the outputs C4 and C2 on their cells' rows, N16 on E11's row.
  //   N3, a plain member of column 2600, goes under C6 and then under N10, to 1600; C5 under N16.
  assert.deepEqual(patches, {
    E4: { x: 1800, y: 800 }, C6: { x: 2600, y: 800 },
    N10: { x: 1800, y: 1400 }, N11: { x: 1800, y: 1600 },
    E9: { x: 1800, y: 2000 }, C4: { x: 2600, y: 2000 },
    E10: { x: 1800, y: 2400 }, C2: { x: 2600, y: 2400 },
    E11: { x: 1800, y: 2800 }, N16: { x: 2600, y: 2800 },
    M6: { x: 1800, y: 3200 },
    N3: { x: 2600, y: 1600 }, C5: { x: 2600, y: 3200 },
  });
  const after = apply(nodes, patches);
  assert.deepEqual(tooClosePairs(after), []);
  assert.deepEqual(layoutSection(after, { moverIds: ['C6'], riders: ridersOf(after, edges) }), {});
});

// 104
test('a new output on a node held to its own code cell still sends that node one gap under the output', () => {
  // - T is held to S and sits in S's output column (the user's answer 2a): S runs, O lands on T, T goes
  //   under O and S keeps its row
  const nodes = [code('S', 0, 300, 300, 'O'), note('T', 800, 300, 700, 300), cell('O', 800, 300)];
  settles(nodes, [edgeTo('S', 'T')], ['O'], { T: { x: 800, y: 700 } });
});

// 105
test('a new output on a plain note moves the note, not the code cell', () => {
  // - P is held by nothing: its column moves right to make room (§3.5), 800 + 600 + 100 - 800 = 700,
  //   although down would be 400
  const nodes = [code('E', 0, 0, 300, 'O'), note('P', 800, 0, 700, 300), cell('O', 800, 0)];
  settles(nodes, [], ['O'], { P: { x: 1500, y: 0 } });
});

// 106
test('a held node carried onto another cell output by its moved source goes under that output', () => {
  // - S is dragged from 0 to 800; R, held to S, follows it onto O, A's output, and goes one gap under O.
  //   A and O stay.
  const nodes = [note('S', 0, 800, 700, 300), code('A', 800, 800, 300, 'O'), cell('O', 1600, 800), note('R', 1600, 0, 600, 300)];
  settles(nodes, [edgeTo('S', 'R')], ['S'], { R: { x: 1600, y: 1200 } });
});

// 107
test('a new output on a node held to a node held to its own code cell sends that node under the output', () => {
  // - R is held to X and X to E, so R keeps E's row and moves whenever E does: E cannot go under R.
  //   O, E's output parked right of the slot and moved, stays; R goes one gap under it. Read as a node
  //   held to another cell (X), E goes under R, X and R follow E, all four end 3200 lower with O still
  //   on R, and a second call moves them 3200 more.
  const nodes = [code('E', 0, 0, 300, 'O'), cell('O', 3000, 0), note('X', 1600, 0, 600, 300), note('R', 3000, 0, 600, 300)];
  settles(nodes, [edgeTo('E', 'X'), edgeTo('X', 'R')], ['O'], { R: { x: 3000, y: 400 } });
});

// 108
test('a new output on a node held to a source in a column the call does not pack moves that node, as before', () => {
  // - E1 heads column 100 and its new output OE1 lands on E0, held to N2 in column 0, which this call
  //   does not pack; N2 sits under E1, 900 down. The bumps move E0: under OE1, to 400. Taking E1 under
  //   E0 instead (to 700) put E1 on N2; the bump then pushed N2 down, E0 followed N2 onto OE1, and E1
  //   went under E0 again, 400 lower each time, until the walk was capped.
  const nodes = [code('E0', 800, 100, 500), { ...code('E1', 100, 0, 500, 'OE1'), w: 600 }, cell('OE1', 800, 0), note('N2', 0, 900, 600, 700)];
  settles(nodes, [edgeTo('N2', 'E0')], ['OE1'], { E0: { x: 800, y: 400 } });
});

// 109
test('a held node that comes back to its row in this call keeps it against a new output, whichever column packs first', () => {
  // - R is held to S but sits off S's row, at 1200. Column 0 packs first and reads R there, clear of O;
  //   R's own pack then puts it on S's row, 0, which O's row 400 crosses. R keeps that row and the next
  //   round takes E and O under R, 0 + 600 + 100.
  const nodes = [note('S', 0, 0, 700, 300), code('E', 0, 400, 300, 'O'), cell('O', 800, 400), note('R', 800, 1200, 700, 600)];
  settles(nodes, [edgeTo('S', 'R')], ['O'], { R: { x: 800, y: 0 }, E: { x: 0, y: 700 }, O: { x: 800, y: 700 } });
});

// 110
test('a code cell held to another row still goes under the held node its new output lands on', () => {
  // - E is held to T's row, 0; its new output O, 700 tall, lands on R, held to S at 400. E leaves T's
  //   row and goes under R with O, 400 + 300 + 100.
  const nodes = [note('T', 0, 0, 700, 300), code('E', 800, 0, 300, 'O'), note('S', 800, 400, 700, 300), cell('O', 1600, 0, 600, 700), note('R', 1600, 400, 600, 300)];
  settles(nodes, [edgeTo('T', 'E'), edgeTo('S', 'R')], ['O'], { E: { x: 800, y: 800 }, O: { x: 1600, y: 800 } });
});

// 111
test('a new output on a node whose source is in its own column moves that node, since it is held to nothing there', () => {
  // - the map holds N to S, but S is a member of N's column, so N is a plain member: O lands on it and
  //   column 800 moves right to make room, 700 (§3.5). There H takes A's row, 400, and S goes under it.
  //   E and O stay.
  const nodes = [code('E', 0, 0, 300, 'O'), cell('O', 800, 0), note('A', 0, 400, 700, 300), note('N', 800, 0, 700, 300), note('S', 800, 400, 700, 300), note('H', 800, 1200, 700, 300)];
  const riders = new Map([['N', 'S'], ['H', 'A']]);
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['O'], riders, report });
  assert.deepEqual(patches, { N: { x: 1500, y: 0 }, S: { x: 1500, y: 800 }, H: { x: 1500, y: 400 } });
  assert.equal(!!report.capped, false);
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['O'], riders }), {});
});

// 112
test('a dragged output that goes under a held node also goes under a node above its new row in a column the call does not pack', () => {
  // - O is dragged onto R, held to S. E and O go under R, to 1100, where O would sit on P (column 1600,
  //   not packed); they go under P too, to 1400. Q, under R, is clear of them there.
  const nodes = [note('S', 0, 0, 700, 300), code('E', 0, 400, 300, 'O'), cell('O', 1800, 400, 700, 300), note('P', 1600, 800, 700, 500), note('R', 2400, 0, 700, 1000), note('Q', 2400, 1100, 700, 100)];
  settles(nodes, [edgeTo('S', 'R')], ['O'], { E: { x: 0, y: 1400 }, O: { x: 1800, y: 1400 } });
});

// 113
test('a code cell moved under a held node does not also go under a node that starts below its new row', () => {
  // - O lands on R, held to S, and E and O go under R, to 800. Q (column 1200, not packed) starts at
  //   900, below that row, so it is not cleared: the bump moves Q 300 right, to 1500 (300 down ties,
  //   and a tie goes right).
  const nodes = [note('S', 0, 0, 700, 300), code('E', 0, 400, 300, 'O'), cell('O', 800, 400), note('R', 800, 0, 600, 700), note('Q', 1200, 900, 700, 400)];
  settles(nodes, [edgeTo('S', 'R')], ['O'], { E: { x: 0, y: 800 }, O: { x: 800, y: 800 }, Q: { x: 1500, y: 900 } });
});

// 114
test('a code cell moved under a held node also goes under a node above its new row that its output ends inside the gap before', () => {
  // - O, 650 wide, lands on R, held to S, and E and O go under R, to 800. There O ends at 1450, 50 px
  //   before P (column 1500, not packed, from 600 to 900). P counts within a gap, so E and O go under
  //   it too, 600 + 300 + 100.
  const nodes = [note('S', 0, 0, 700, 300), code('E', 0, 400, 300, 'O'), cell('O', 800, 400, 650, 300), note('R', 800, 0, 600, 700), note('P', 1500, 600, 700, 300)];
  settles(nodes, [edgeTo('S', 'R')], ['O'], { E: { x: 0, y: 1000 }, O: { x: 800, y: 1000 } });
});

// 115
test('run E1 on H3: the output slot clears E1 by a gap, the column the output lands on moves right, column 1800 stays', () => {
  // - tests/fixtures/H3-E1.json: H3 before the user ran E1 on 2026-09-25, geometry only
  const data = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'H3-E1.json'), 'utf8'));
  const before = toEngineNodes(data.nodes);
  // - E1 (2600, 400) is 700 wide and ends at 3300; N3, 600 wide, sets the width of column 2600
  const slot = placeOutput(before, 'E1');
  assert.deepEqual(slot, { x: 3400, y: 400, width: 600, height: 300 });
  const nodes = [...before.map(n => (n.id === 'E1' ? { ...n, outputNodeId: 'C1' } : n)), cell('C1', slot.x, slot.y, slot.width, slot.height)];
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['C1'], riders: ridersOf(nodes, allHeld(data.edges)), report });
  assert.equal(!!report.capped, false);
  // - C1 lands on E4: column 3400 (C3, E4, W1) moves right by 3400 + 600 + 100 - 3400 = 700. C3 is held
  //   to N8 in E1's column, so the call packs column 3400 too: W1 goes up to one gap under N10, 1000.
  assert.deepEqual(patches, { C3: { x: 4100, y: 0 }, E4: { x: 4100, y: 400 }, W1: { x: 4100, y: 1000 } });
  const after = apply(nodes, patches);
  const was = new Set(tooClosePairs(before));
  assert.deepEqual(tooClosePairs(after).filter(p => !was.has(p)), []);
  assert.deepEqual(layoutSection(after, { moverIds: ['C1'], riders: ridersOf(after, allHeld(data.edges)) }), {});
});

// 116
test('an output slot sits one gap right of every code cell in its column, even one too wide to set the width', () => {
  // - N, 600 wide, sets column 0's width; E, 700 wide, ends where Q's column starts, so it does not
  const nodes = [code('E', 0, 0), note('N', 0, 400, 600, 300), note('Q', 700, 1000, 700, 300)];
  assert.equal(deriveColumns(nodes)[0].width, 600);
  assert.deepEqual(placeOutput(nodes, 'E'), { x: 800, y: 0, width: 600, height: 300 });
  // - Reflow reads the same slot, and a second Reflow moves nothing
  const withOut = [...nodes.map(n => (n.id === 'E' ? { ...n, outputNodeId: 'O' } : n)), cell('O', 800, 0)];
  const after = apply(withOut, reflowSection(withOut));
  assert.equal(after.find(n => n.id === 'O').x, 800);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(reflowSection(after), {});
});

// 117
test('a code column does not slide sideways when one of its outputs is in the way', () => {
  // - the 7 nodes left of H3 when the E1 run is reduced to the part that slides column 1800 (no edges).
  //   E1 is dragged 400 down.
  const nodes = [
    code('E4', 3400, 400), note('N10', 1900, 800, 2200, 100), note('N11', 1800, 1000, 700, 300),
    { id: 'M6', type: 'file', x: 2600, y: 2600, w: 800, h: 900 }, code('E10', 1800, 1800, 300, 'C4'), cell('C4', 2600, 1800),
    code('E1', 2600, 800),
  ];
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['E1'], report });
  assert.equal(!!report.capped, false);
  const slid = Object.keys(patches).filter(id => patches[id].x !== nodes.find(n => n.id === id).x);
  assert.deepEqual(slid, []);
  // - E1 pushes N10 down to 1200, and N10 pushes N11, E10 and C4 400 down, onto M6, which the first
  //   turn packed at 2200, under E1 and C4. E10's row goes one gap under M6, to 3200, where before
  //   column 1800 moved 1700 right. The next turn packs M6 up to 1400, one gap under N10; no bump moves
  //   E10 back up.
  assert.deepEqual(patches, {
    N10: { x: 1900, y: 1200 }, N11: { x: 1800, y: 1400 }, M6: { x: 2600, y: 1400 },
    E10: { x: 1800, y: 3200 }, C4: { x: 2600, y: 3200 },
  });
  const after = apply(nodes, patches);
  assert.deepEqual(tooClosePairs(after), []);
  assert.deepEqual(layoutSection(after, { moverIds: ['E1'] }), {});
});

// 118
test('a new output on a plain note moves the note column right to make room', () => {
  // - E1 and E2 have not run; J1 and J2 sit one gap right of them. E1 runs and its output lands on J1:
  //   column 800 moves right by 800 + 600 + 100 - 800 = 700
  const cells = [code('E1', 0, 0), code('E2', 0, 400), note('J1', 800, 0, 700, 300), note('J2', 800, 400, 700, 300)];
  const slot = placeOutput(cells, 'E1');
  assert.deepEqual(slot, { x: 800, y: 0, width: 600, height: 300 });
  const nodes = [...cells.map(n => (n.id === 'E1' ? { ...n, outputNodeId: 'O' } : n)), cell('O', slot.x, slot.y)];
  settles(nodes, [], ['O'], { J1: { x: 1500, y: 0 }, J2: { x: 1500, y: 400 } });
});

// 119
test('a new output on a code cell of the next column moves that column right to make room', () => {
  const nodes = [code('E', 0, 0, 300, 'O'), code('F', 800, 0), note('G', 800, 400, 700, 300), cell('O', 800, 0)];
  settles(nodes, [], ['O'], { F: { x: 1500, y: 0 }, G: { x: 1500, y: 400 } });
});

// 120
test('a new output on a plain member of a column the call packs moves that column right too', () => {
  // - R, held to S in column 0, puts column 800 in the call; F, a plain code cell, heads the rest of it.
  //   Before, F went one gap under the output, to 800.
  const nodes = [note('S', 0, 0, 700, 300), code('E', 0, 400, 300, 'O'), note('R', 800, 0, 700, 300), code('F', 800, 400), cell('O', 800, 400)];
  settles(nodes, [edgeTo('S', 'R')], ['O'], { R: { x: 1500, y: 0 }, F: { x: 1500, y: 400 } });
});

// 121
test('a dragged output that lands on a plain note of a column right of it moves that column right, and the call settles', () => {
  // - OE5 is dragged to (3500, 1200) and packs onto E5's row, 700, where it lands on N3: column 3800
  //   moves right by 3500 + 600 + 100 - 3800 = 400. Before, the turns did not settle and the call kept
  //   its first turn, capped.
  const nodes = [note('N3', 3800, 600, 1100, 100), { ...code('E5', 1500, 700, 300, 'OE5'), w: 600 }, cell('OE5', 3500, 1200, 600, 500), { ...code('E6', 0, 700), w: 600 }, note('N7', 1500, 1900, 1500, 700)];
  settles(nodes, [edgeTo('E6', 'E5')], ['OE5'], { N3: { x: 4200, y: 600 }, OE5: { x: 3500, y: 700 } });
});

// 122
test('a column that moved right to make room changes the slot of the column on its left in the same call', () => {
  // - test 117's 7 nodes; E1 runs. C1 lands on E4 and column 3400 moves 700 right. M6, 800 wide in
  //   E1's column, then stays a gap clear of E4's column, so the width of column 2600 is 800 and the
  //   slot 3500: C1 goes there in this call, and E4 100 further. Read once, the slot stayed at 3400
  //   and a second call moved C1 and E4.
  const cells = [
    code('E4', 3400, 400), note('N10', 1900, 800, 2200, 100), note('N11', 1800, 1000, 700, 300),
    { id: 'M6', type: 'file', x: 2600, y: 2600, w: 800, h: 900 }, code('E10', 1800, 1800, 300, 'C4'), cell('C4', 2600, 1800),
    code('E1', 2600, 400),
  ];
  const slot = placeOutput(cells, 'E1');
  assert.deepEqual(slot, { x: 3400, y: 400, width: 600, height: 300 });
  const nodes = [...cells.map(n => (n.id === 'E1' ? { ...n, outputNodeId: 'C1' } : n)), cell('C1', slot.x, slot.y)];
  settles(nodes, [], ['C1'], { C1: { x: 3500, y: 400 }, E4: { x: 4200, y: 400 }, M6: { x: 2600, y: 2200 } });
});

// 123
test('a node the pack laid out gives way to a node above it instead of pushing that node down past it', () => {
  // - H3 reduced to what moves when C5, E1's output, grows from 300 to 400 tall. C5 reaches N10, which
  //   goes 100 down and lands on E3. E3 is pinned only because the call packs its column (C3, held to
  //   N8 in E1's column, is in it), so E3 gives way by the overlap, 100. Before, N10 went 500 down,
  //   past E3, to 1400.
  const nodes = [
    note('N8', 2600, 0, 700, 300), note('N10', 1800, 800, 2300, 100), cell('C3', 4100, 0, 600, 200),
    code('E1', 2600, 400, 300, 'C5'), code('E3', 4100, 1000), cell('C5', 3400, 400, 600, 400),
  ];
  settles(nodes, [edgeTo('N8', 'C3')], ['C5'], { N10: { x: 1800, y: 900 }, E3: { x: 4100, y: 1100 } });
});

// 124
test('a node hanging below a wide node of another column moves down with it, with what sits under it', () => {
  // - W, 1500 wide, sits under A in column 0 and reaches over column 800; the edge W → T leaves W's
  //   bottom and enters T's top. A grows by 200, the pack moves W 200 down, and T and U, under T in
  //   column 800, go 200 down with it. Before, W stayed a gap clear of T and nothing else moved.
  const nodes = [code('A', 0, 0, 500), note('W', 0, 400, 1500, 100), note('T', 800, 800, 700, 300), note('U', 800, 1200, 700, 300)];
  const edges = [edgeDown('W', 'T')];
  assert.deepEqual([...hangingBelow(nodes, edges)], [['W', ['T']]]);
  settles(nodes, edges, ['A'], { W: { x: 0, y: 600 }, T: { x: 800, y: 1000 }, U: { x: 800, y: 1400 } });
  // - what does not hang: an edge between two sides, a target above the source's bottom, a target in
  //   the source's column, a target the source's x-span does not reach
  const others = [...nodes, note('V', 0, 800, 700, 300), note('X', 1600, 800, 700, 300), note('Y', 800, 0, 700, 300)];
  assert.deepEqual([...hangingBelow(others, [edgeTo('W', 'T'), edgeDown('W', 'Y'), edgeDown('W', 'V'), edgeDown('W', 'X')])], []);
  // - T held to S's row keeps that row when the pack moves W, in column 800, down onto it: W packs
  //   around T, to 1000 + 300 + 100
  const kept = [code('A', 800, 0, 900), note('W', 800, 400, 1500, 100), note('T', 1600, 1000, 700, 300), note('S', 0, 1000, 700, 300)];
  settles(kept, [edgeDown('W', 'T'), edgeTo('S', 'T')], ['A', 'S'], { W: { x: 800, y: 1400 } });
});

// 125
test('resize C5 on H3 from 300 to 400: every node that moves goes 100 down', () => {
  // - tests/fixtures/H3-C5.json: H3 on 2026-09-25 before the user resized C5, E1's output, geometry
  //   only. C5 reaches N10 (2300 wide). N10 goes 100 down; E3 gives way under it (test 123); N11, E9,
  //   E10 and E11 under N10 in column 1800 follow with their outputs C1 and C4; N4 and N3 hang below
  //   N10 and W1 below N4, so they follow with what sits under them in column 3300 (N16, M6).
  const data = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'H3-C5.json'), 'utf8'));
  const nodes = toEngineNodes(data.nodes).map(n => (n.id === 'C5' ? { ...n, h: 400 } : n));
  const report = {};
  // - as the webview's resize path calls it
  const patches = layoutSection(nodes, { moverIds: ['C5'], resized: ['C5'], riders: ridersOf(nodes, allHeld(data.edges)), hanging: hangingBelow(nodes, allHeld(data.edges)), report });
  assert.equal(!!report.capped, false);
  const down = id => ({ x: nodes.find(n => n.id === id).x, y: nodes.find(n => n.id === id).y + 100 });
  const ids = ['N10', 'N11', 'E9', 'C1', 'E10', 'C4', 'E11', 'N16', 'M6', 'N4', 'W1', 'N3', 'E3', 'C2'];
  assert.deepEqual(patches, Object.fromEntries(ids.map(id => [id, down(id)])));
  const after = apply(nodes, patches);
  const was = new Set(tooClosePairs(nodes));
  assert.deepEqual(tooClosePairs(after).filter(p => !was.has(p)), []);
  assert.deepEqual(layoutSection(after, { moverIds: ['C5'], resized: ['C5'], riders: ridersOf(after, allHeld(data.edges)), hanging: hangingBelow(after, allHeld(data.edges)) }), {});
});

// 126
test('the nodes hanging below a node the user drags down go down by the same amount; an upward drag moves nothing', () => {
  // - W heads column 0 alone. The user drags it from 400 to 700: the engine sees it at 700, and the
  //   caller gives where it was. T and U, under T in column 800, go 300 down with it.
  const edges = [edgeDown('W', 'T')];
  const was = [note('W', 0, 400, 1500, 100), note('T', 800, 1000, 700, 300), note('U', 800, 1400, 700, 300)];
  const drag = (from, to) => {
    const nodes = was.map(n => (n.id === 'W' ? { ...n, y: to } : n));
    const draggedFrom = new Map([['W', { x: 0, y: from }]]);
    return { nodes, patches: layoutSection(nodes, { moverIds: ['W'], draggedFrom, riders: ridersOf(nodes, edges), hanging: hangingBelow(nodes, edges, draggedFrom) }) };
  };
  const down = drag(400, 700);
  assert.deepEqual(down.patches, { T: { x: 800, y: 1300 }, U: { x: 800, y: 1700 } });
  const after = apply(down.nodes, down.patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['W'], riders: ridersOf(after, edges), hanging: hangingBelow(after, edges) }), {});
  // - the same drag the other way, from 700 up to 400 with T at 1000: T and U stay
  assert.deepEqual(drag(700, 400).patches, {});
});

// 127
test('an output resized by hand pushes the note it grows onto down; a new output there still moves the note column right', () => {
  // - O, E's output, has just grown from 300 to 500 tall and reaches N. A resize moves N down by the
  //   overlap, 100. As a new output, O moves column 800 right by 800 + 600 + 100 - 800 = 700. Either
  //   way E2 packs one gap under E's row, which O now ends at 500.
  const nodes = [code('E', 0, 0, 300, 'O'), cell('O', 800, 0, 600, 500), note('N', 800, 500, 700, 300), code('E2', 0, 400)];
  const patches = layoutSection(nodes, { moverIds: ['O'], resized: ['O'] });
  assert.deepEqual(patches, { N: { x: 800, y: 600 }, E2: { x: 0, y: 600 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['O'], resized: ['O'] }), {});
  assert.deepEqual(layoutSection(nodes, { moverIds: ['O'] }), { N: { x: 1500, y: 500 }, E2: { x: 0, y: 600 } });
});

// 128
test('a new output on a member that reaches into the next column moves that member down, not its column right', () => {
  // - the reviewer's generator for one output, seed 1164, the output at its slot. N0, 1100 wide, is the
  //   only member of column 1600 and reaches over column 1700. O lands on it. Before, column 1600 moved
  //   700 right, past N2, and the next call read the edge N2 → N0 as holding N0 on N2's row and moved
  //   N0 again. Now N1 takes A0's row, 0, and pushes N0 100 down; O moves N0 down by the overlap, to
  //   1000, and N0 then goes one gap under N2, to 1200, as before 0.17.66. A member that stays clear of
  //   the next column still moves right (test 118).
  const nodes = [
    code('A0', 800, 0), code('E', 800, 400, 300, 'O'), note('N0', 1600, 300, 1100, 100),
    note('N1', 1700, 500, 300, 300), note('N2', 1700, 1000, 700, 100), cell('O', 1600, 400, 600, 500),
  ];
  const edges = [edgeTo('N2', 'N0'), edgeTo('A0', 'N1')];
  const report = {};
  const patches = layoutSection(nodes, { moverIds: ['O'], riders: ridersOf(nodes, edges), hanging: hangingBelow(nodes, edges), report });
  assert.equal(!!report.capped, false);
  assert.deepEqual(patches, { N0: { x: 1600, y: 1200 }, N1: { x: 1700, y: 0 } });
  const after = apply(nodes, patches);
  assert.equal(overlapCount(after), 0);
  assert.deepEqual(layoutSection(after, { moverIds: ['O'], riders: ridersOf(after, edges), hanging: hangingBelow(after, edges) }), {});
});

// 129
test('which node is held to which is read from where the nodes are now, also after a drag', () => {
  // - D is dragged from (1600, 1400), in S's column, to (1300, 1800). Now S is held to D's row and D to
  //   R's, and R sits under T, which hangs below S: T would carry R, R would carry D and S, and S would
  //   carry T again. The pair S, T is left out, so S only goes to D's row and one gap under D, 2200.
  //   Before, T and R went 2200 down with S, and a second call moved S and D again.
  const nodes = [note('S', 1600, 0, 750, 300), note('T', 800, 800, 1500, 500), note('R', 800, 1400, 700, 300), note('D', 1300, 1800, 700, 300)];
  const edges = [edgeDown('S', 'T'), edgeTo('D', 'S'), edgeTo('R', 'D')];
  const draggedFrom = new Map([['D', { x: 1600, y: 1400 }]]);
  assert.deepEqual([...hangingBelow(nodes, edges, draggedFrom)], []);
  const patches = layoutSection(nodes, { moverIds: ['D'], draggedFrom, riders: ridersOf(nodes, edges), hanging: hangingBelow(nodes, edges, draggedFrom) });
  assert.deepEqual(patches, { S: { x: 1600, y: 2200 } });
  const after = apply(nodes, patches);
  assert.deepEqual(layoutSection(after, { moverIds: ['D'], riders: ridersOf(after, edges), hanging: hangingBelow(after, edges) }), {});
});

// 130
test('a node does not pack around what sits under a node hanging below it: those follow it down', () => {
  // - A grows from 300 to 700, and the pack moves W 400 down, onto U, which sits under T in column 800.
  //   T and U follow W, 400 down. Before, W packed under U, to 1200, T and U followed it 800 down, and
  //   a second call moved W back up to 800.
  const nodes = [code('A', 0, 0, 700), note('W', 0, 400, 1500, 100), note('T', 800, 600, 700, 100), note('U', 800, 800, 700, 300)];
  settles(nodes, [edgeDown('W', 'T')], ['A'], { W: { x: 0, y: 800 }, T: { x: 800, y: 1000 }, U: { x: 800, y: 1200 } });
});

// 131
test('a node held to a node that follows a drag takes the new row of that node in the same call', () => {
  // - S and H are dragged 200 down together. T hangs below S and follows it, 400 to 600; H is held to
  //   T's row and keeps 600. Before, the call packed H back on T's old row, 400, and a second call
  //   moved it to 600.
  const nodes = [note('S', 800, 200, 700, 100), note('T', 0, 400, 1500, 100), note('H', 1600, 600, 700, 300)];
  const edges = [edgeDown('S', 'T'), edgeTo('T', 'H')];
  const draggedFrom = new Map([['S', { x: 800, y: 0 }], ['H', { x: 1600, y: 400 }]]);
  const patches = layoutSection(nodes, { moverIds: ['S', 'H'], draggedFrom, riders: ridersOf(nodes, edges), hanging: hangingBelow(nodes, edges, draggedFrom) });
  assert.deepEqual(patches, { T: { x: 0, y: 600 } });
  const after = apply(nodes, patches);
  assert.deepEqual(layoutSection(after, { moverIds: ['S', 'H'], riders: ridersOf(after, edges), hanging: hangingBelow(after, edges) }), {});
});

// 132
test('the nodes hanging below a node that gives way to a node above it do not follow it down', () => {
  // - S is held to P's row, 400. X sits above S and across it, so S gives way, 300 down, in every call:
  //   the pack puts it back on P's row first. T, hanging below S, moves only the 100 it needs to clear
  //   S. Before, T went 300 down with S in every call.
  const nodes = [note('P', 0, 400, 700, 300), note('S', 800, 400, 800, 100), note('X', 1000, 300, 700, 300), note('T', 900, 800, 700, 300)];
  settles(nodes, [edgeTo('P', 'S'), edgeDown('S', 'T')], ['S'], { S: { x: 800, y: 700 }, T: { x: 900, y: 900 } });
});

// - the functions of the stored `keepRow` (§3.5), read off the module so a bundle without them fails
//   only the tests below
const withKeepRow = await import('./.build/layoutEngine.mjs');
const fixture = name => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));
// - the holds HEAD read before `keepRow`: every edge counted, per section, as `target<source`
const holdsOf = (data, edges) => deriveLanes(data.nodes, data.metadata?.sections ?? []).flatMap(l =>
  [...ridersOf(toEngineNodes(data.nodes.filter(n => l.memberIds.includes(n.id))), edges)].map(([t, s]) => `${t}<${s}`));

// 133
test('an edge holds its target on the source row only when it carries keepRow: true', () => {
  const nodes = [code('S', 0, 0), note('T', 800, 400, 700, 300)];
  const e = { id: 'q', fromNode: 'S', fromSide: 'right', toNode: 'T', toSide: 'left' };
  assert.deepEqual([...ridersOf(nodes, [e])], []);
  assert.deepEqual([...ridersOf(nodes, [{ ...e, keepRow: false }])], []);
  assert.deepEqual([...ridersOf(nodes, [{ ...e, keepRow: true }])], [['T', 'S']]);
});

// 134
test('connecting M1 to M6 on H3 moves nothing: holding M6 would move it, so the edge gets keepRow false', () => {
  // - tests/fixtures/H3-M1M6.json: the four nodes of H3 that are left when the user's M1 → M6 still
  //   moves a code cell. Before, the edge held M6 at once: M6 went from 3100 to M1's row, 0, and N10
  //   and E9 went 200 down under it.
  const data = fixture('H3-M1M6');
  const nodes = sectionEngineNodes(data.nodes, data.metadata.sections, 'M6');
  const edge = { id: 'q', fromNode: 'M1', fromSide: 'right', toNode: 'M6', toSide: 'left' };
  const keepRow = withKeepRow.keepRowOf?.(nodes, data.edges, edge);
  assert.equal(keepRow, false);
  const edges = [...data.edges, { ...edge, keepRow }];
  // - the add paths run the engine only for a target the new edge holds: none here
  assert.deepEqual([...ridersOf(nodes, edges)], []);
  for (const opts of [{ columnX: 3400 }, { moverIds: ['M1'] }, { moverIds: ['M6'] }]) {
    assert.deepEqual(layoutSection(nodes, { ...opts, riders: ridersOf(nodes, edges), hanging: hangingBelow(nodes, edges) }), {}, JSON.stringify(opts));
  }
});

// 135
test('connecting a node that sits on its source row: the edge gets keepRow true, and the node follows the source', () => {
  const nodes = [code('S', 0, 0), note('T', 800, 0, 700, 300)];
  const edge = { id: 'q', fromNode: 'S', fromSide: 'right', toNode: 'T', toSide: 'left' };
  const keepRow = withKeepRow.keepRowOf?.(nodes, [], edge);
  assert.equal(keepRow, true);
  const edges = [{ ...edge, keepRow }];
  assert.deepEqual(layoutSection(nodes, { columnX: 800, riders: ridersOf(nodes, edges), hanging: hangingBelow(nodes, edges) }), {});
  // - S dragged 800 down: T takes its new row
  const moved = nodes.map(n => (n.id === 'S' ? { ...n, y: 800 } : n));
  const draggedFrom = new Map([['S', { x: 0, y: 0 }]]);
  assert.deepEqual(layoutSection(moved, { moverIds: ['S'], draggedFrom, riders: ridersOf(moved, edges), hanging: hangingBelow(moved, edges, draggedFrom) }), { T: { x: 800, y: 800 } });
});

// 136
test('on load an edge with no keepRow gets true where holding moves nothing; H3 and H4', () => {
  const kept = {};
  for (const name of ['H3', 'H4']) {
    const data = fixture(name);
    const marked = withKeepRow.markKeepRowOnLoad(data.nodes, data.metadata.sections, data.edges);
    assert.ok(marked.every((e, i) => e.keepRow === true || e === data.edges[i]), `${name}: only true is written`);
    const head = holdsOf(data, data.edges.map(e => ({ ...e, keepRow: true })));
    const now = holdsOf(data, marked);
    assert.ok(now.every(h => head.includes(h)), `${name}: no hold HEAD did not read`);
    kept[name] = `${now.length} of ${head.length}`;
    // - every edge now carries the field, true or not, so a second load changes nothing
    const all = marked.map(e => ({ ...e, keepRow: e.keepRow === true }));
    assert.equal(withKeepRow.markKeepRowOnLoad(data.nodes, data.metadata.sections, all), all);
  }
  // - H4 loses N7 held to N24 and N11 held to N26: a pack of their column moves each off that row
  assert.deepEqual(kept, { H3: '8 of 8', H4: '13 of 15' });
});

// 137
test('on load an edge that has keepRow keeps it, true or false', () => {
  const data = fixture('H4');
  const marked = withKeepRow.markKeepRowOnLoad(data.nodes, data.metadata.sections, data.edges);
  const heldIds = new Set(data.edges.filter(e => holdsOf(data, [{ ...e, keepRow: true }]).length).map(e => e.id));
  const on = marked.find(e => heldIds.has(e.id) && e.keepRow === true);
  const off = marked.find(e => heldIds.has(e.id) && e.keepRow === undefined);
  assert.ok(on && off, 'H4 has a hold the load marks and one it does not');
  const stored = data.edges.map(e => (e.id === on.id ? { ...e, keepRow: false } : e.id === off.id ? { ...e, keepRow: true } : e));
  const again = withKeepRow.markKeepRowOnLoad(data.nodes, data.metadata.sections, stored);
  assert.equal(again.find(e => e.id === on.id).keepRow, false);
  assert.equal(again.find(e => e.id === off.id).keepRow, true);
  // - a file written by a webview save, read back: the fields are what was saved
  const saved = JSON.parse(JSON.stringify({ ...data, edges: stored }));
  assert.deepEqual(withKeepRow.markKeepRowOnLoad(saved.nodes, saved.metadata.sections, saved.edges).map(e => e.keepRow), again.map(e => e.keepRow));
});

// 138
test('a held node dragged far off its row keeps the link: the call puts it back, and a load keeps keepRow', () => {
  const edges = [{ ...edgeTo('S', 'T'), keepRow: true }];
  const nodes = [code('S', 0, 0), note('T', 800, 2000, 700, 300)];
  const draggedFrom = new Map([['T', { x: 800, y: 0 }]]);
  // - a canvas saved right after the drag, before any call, and opened again
  const reopened = withKeepRow.markKeepRowOnLoad(nodes.map(n => ({ ...n, width: n.w, height: n.h })), [{ id: 's', y: 0, createdAt: 0 }], edges);
  assert.equal(reopened, edges);
  assert.deepEqual(layoutSection(nodes, { moverIds: ['T'], draggedFrom, riders: ridersOf(nodes, reopened), hanging: hangingBelow(nodes, reopened, draggedFrom) }), { T: { x: 800, y: 0 } });
});
