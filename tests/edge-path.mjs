// - run: npx esbuild src/shared/edgePath.ts --bundle --format=esm --outfile=tests/.build/edgePath.mjs && npx esbuild src/shared/orthogonalRoute.ts --bundle --format=esm --outfile=tests/.build/orthogonalRoute.mjs && node --test tests/edge-path.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { edgeLabelPoint, waypointPath } from './.build/edgePath.mjs';
import { ORTHOGONAL_CORNER_R, routeOrthogonal } from './.build/orthogonalRoute.mjs';

// - true when the open segment a-b passes through the inside of rect r grown by pad on every side
function crosses(a, b, r, pad) {
  const xa = Math.min(a[0], b[0]), xb = Math.max(a[0], b[0]);
  const ya = Math.min(a[1], b[1]), yb = Math.max(a[1], b[1]);
  return xb > r.x - pad && xa < r.x + r.w + pad && yb > r.y - pad && ya < r.y + r.h + pad;
}

test('1. a straight edge is a move and a line', () => {
  assert.equal(waypointPath([[0, 0], [100, 0]], ORTHOGONAL_CORNER_R), 'M 0,0 L 100,0');
});

test('2. a corner is cut by the radius and drawn as a quadratic curve through it', () => {
  assert.equal(waypointPath([[0, 0], [100, 0], [100, 100]], 8), 'M 0,0 L 92,0 Q 100,0 100,8 L 100,100');
});

test('3. fewer than two points draw nothing', () => {
  assert.equal(waypointPath([[5, 5]], 8), '');
});

test('4. the label sits in the middle of the middle segment', () => {
  assert.deepEqual(edgeLabelPoint([[0, 0], [100, 0], [100, 100]]), [50, 0]);
  assert.deepEqual(edgeLabelPoint([[0, 0], [0, 40], [60, 40], [60, 100]]), [30, 40]);
});

test('5. the fallback router takes the JSON Canvas side names and keeps every run axis-aligned', () => {
  const pts = routeOrthogonal(0, 50, 'right', 400, 50, 'left', []);
  assert.deepEqual(pts[0], [0, 50]);
  assert.deepEqual(pts[pts.length - 1], [400, 50]);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], `segment ${i} is not axis-aligned`);
  }
});

test('6. the fallback router goes around a box between the two ends', () => {
  const box = { x: 150, y: 0, w: 100, h: 100 };
  const pts = routeOrthogonal(0, 50, 'right', 400, 50, 'left', [box]);
  // - the first and last runs leave and enter the end points; the runs between keep clear of the box
  for (let i = 2; i < pts.length - 1; i++) assert.ok(!crosses(pts[i - 1], pts[i], box, 0), `segment ${i} crosses the box`);
});
