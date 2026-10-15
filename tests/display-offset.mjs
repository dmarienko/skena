// - run: npx esbuild src/webview/canvas/displayOffset.ts --bundle --format=esm --outfile=tests/.build/displayOffset.mjs && node --test tests/display-offset.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bandStep, laneDisplay, drawnLanes, toStoredY, toDisplayY, BAND_MIN_PX, BAND_FULL_ZOOM } from './.build/displayOffset.mjs';

const GRID = 100;
// - S1 folded, S2 open, S3 folded, S4 folded with a 300-tall node dropped in after the fold, S5 open (last)
const lanes = [
  { top: 0, bottom: 100, folded: ['a'] },
  { top: 100, bottom: 900 },
  { top: 900, bottom: 1000, folded: ['b'] },
  { top: 1000, bottom: 1400, folded: ['c'] },
  { top: 1400, bottom: 2500 },
];
// - every zoom a 6 % wheel notch reaches from 1 down to the minimum zoom
const sweep = [];
for (let z = 1; z >= 0.05; z *= 0.94) sweep.push(z);

test('a one-grid band is 34 px tall on screen at the zoom where nothing starts to move', () => {
  assert.equal(BAND_MIN_PX, 34);
  assert.equal(BAND_FULL_ZOOM * GRID, BAND_MIN_PX);
});

test('at and above that zoom no section is drawn anywhere but where it is stored', () => {
  for (const z of [BAND_FULL_ZOOM, 0.5, 1]) {
    assert.equal(bandStep(z), 0);
    for (const d of laneDisplay(lanes, bandStep(z))) assert.deepEqual(d, { shift: 0, extra: 0 });
  }
});

test('every folded band is drawn at least 34 px tall at every zoom of a wheel run down to 0.05', () => {
  for (const z of sweep) {
    const drawn = drawnLanes(lanes, laneDisplay(lanes, bandStep(z)));
    lanes.forEach((l, i) => {
      if (l.folded) assert.ok((drawn[i].bottom - drawn[i].top) * z >= BAND_MIN_PX - 1e-9, `zoom ${z} lane ${i}`);
    });
  }
});

test('a band is drawn taller by whole grids, so what is below it stays on the grid', () => {
  for (const z of sweep) for (const d of laneDisplay(lanes, bandStep(z))) assert.equal(d.extra % GRID, 0, `zoom ${z}`);
});

test('a band whose stored height is off the grid is still drawn taller by whole grids', () => {
  const odd = [{ top: 0, bottom: 150, folded: [] }, { top: 150, bottom: 1000 }];
  for (const z of sweep) {
    const disp = laneDisplay(odd, bandStep(z));
    assert.equal(disp[0].extra % GRID, 0, `zoom ${z}`);
    assert.ok((150 + disp[0].extra) * z >= BAND_MIN_PX - 1e-9, `zoom ${z}`);
  }
});

test('an open section is drawn at its stored height, lower by the extra of every folded band above it', () => {
  for (const z of sweep) {
    const disp = laneDisplay(lanes, bandStep(z));
    const drawn = drawnLanes(lanes, disp);
    let above = 0;
    lanes.forEach((l, i) => {
      if (!l.folded) {
        assert.equal(disp[i].extra, 0);
        assert.equal(drawn[i].top, l.top + above);
        assert.equal(drawn[i].bottom - drawn[i].top, l.bottom - l.top);
      }
      above += disp[i].extra;
    });
  }
});

test('the drawn sections still follow each other with no gap and no overlap', () => {
  for (const z of sweep) {
    const drawn = drawnLanes(lanes, laneDisplay(lanes, bandStep(z)));
    for (let i = 1; i < drawn.length; i++) assert.equal(drawn[i].top, drawn[i - 1].bottom, `zoom ${z} lane ${i}`);
  }
});

test('a band already 34 px tall from its own content is drawn at its stored height', () => {
  // - S4 is 400 flow units: 34 px at zoom 0.085
  for (const z of sweep.filter(z => z >= 0.085)) assert.equal(laneDisplay(lanes, bandStep(z))[3].extra, 0, `zoom ${z}`);
});

test('stored y -> drawn y -> stored y gives back the same y in every section', () => {
  for (const z of [0.3, 0.12, 0.06]) {
    const disp = laneDisplay(lanes, bandStep(z));
    for (const l of lanes) for (const y of [l.top, l.top + 12.5, (l.top + l.bottom) / 2, l.bottom - 1]) {
      assert.equal(toStoredY(lanes, disp, toDisplayY(lanes, disp, y)), y, `zoom ${z} y ${y}`);
    }
  }
});

test('the drawn order is the stored order', () => {
  const disp = laneDisplay(lanes, bandStep(0.08));
  let prev = -Infinity;
  for (let y = 0; y < 2500; y += 25) {
    const d = toDisplayY(lanes, disp, y);
    assert.ok(d > prev, `y ${y}`);
    prev = d;
  }
});

test('a point in the part a band is drawn taller by lands at the top of that band', () => {
  const disp = laneDisplay(lanes, bandStep(0.1));
  const drawn = drawnLanes(lanes, disp);
  assert.ok(disp[2].extra > 0);
  for (const y of [drawn[2].top, drawn[2].top + disp[2].extra - 1]) assert.equal(toStoredY(lanes, disp, y), lanes[2].top, `drawn y ${y}`);
});

test('no sections: stored and drawn y are the same', () => {
  assert.deepEqual(laneDisplay([], 3), []);
  assert.equal(toStoredY([], [], 123), 123);
  assert.equal(toDisplayY([], [], 123), 123);
});

test('a wheel run from zoom 1 to 0.1 changes what is drawn only 3 times', () => {
  let changes = 0;
  let prev = bandStep(1);
  for (let z = 1; z >= 0.1; z *= 0.94) { const s = bandStep(z); if (s !== prev) changes++; prev = s; }
  assert.equal(changes, 3);
});
