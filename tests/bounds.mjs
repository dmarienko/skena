// - run: npx esbuild src/shared/bounds.ts --bundle --format=esm --outfile=tests/.build/bounds.mjs && node --test tests/bounds.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { clampToOrigin, normalizeCanvasToOrigin, clampViewportToOrigin, clampCameraToOrigin } from './.build/bounds.mjs';

test('clampToOrigin floors both axes at 0', () => {
  assert.deepEqual(clampToOrigin(-50, -10), { x: 0, y: 0 });
  assert.deepEqual(clampToOrigin(300, 20), { x: 300, y: 20 });
});

test('normalizeCanvasToOrigin parks negative content flush at the origin (0)', () => {
  const canvas = { nodes: [
    { id: 'a', x: -5700, y: -300, width: 100, height: 100 },
    { id: 'b', x: -5600, y: 0,    width: 100, height: 100 },
  ], edges: [] };
  const out = normalizeCanvasToOrigin(canvas);
  assert.equal(Math.min(...out.nodes.map(n => n.x)), 0);
  assert.equal(Math.min(...out.nodes.map(n => n.y)), 0);
  assert.equal(out.nodes[1].x - out.nodes[0].x, 100);   // - relative geometry preserved
});

test('normalizeCanvasToOrigin is idempotent — same ref when already at the origin', () => {
  const canvas = { nodes: [{ id: 'a', x: 0, y: 0, width: 10, height: 10 }], edges: [] };
  assert.equal(normalizeCanvasToOrigin(canvas), canvas);
});

test('normalizeCanvasToOrigin shifts the saved viewport so framing is preserved', () => {
  const canvas = { nodes: [{ id: 'a', x: -100, y: -100, width: 10, height: 10 }], edges: [],
    viewport: { x: 0, y: 0, zoom: 2 } };
  const out = normalizeCanvasToOrigin(canvas);
  // - dx = -(-100) = 100 (park at 0); viewport.x -= dx*zoom = -200
  assert.equal(out.viewport.x, 0 - 100 * 2);
  assert.equal(out.viewport.y, 0 - 100 * 2);
});

test('normalizeCanvasToOrigin leaves an empty canvas untouched', () => {
  const canvas = { nodes: [], edges: [] };
  assert.equal(normalizeCanvasToOrigin(canvas), canvas);
});

test('normalizeCanvasToOrigin leaves positive content untouched (same ref)', () => {
  const canvas = { nodes: [{ id: 'a', x: 30, y: 30, width: 10, height: 10 }], edges: [] };
  assert.equal(normalizeCanvasToOrigin(canvas), canvas);
});

test('normalizeCanvasToOrigin corrects only the axis that is negative', () => {
  const canvas = { nodes: [{ id: 'a', x: -100, y: 500, width: 10, height: 10 }], edges: [] };
  const out = normalizeCanvasToOrigin(canvas);
  assert.equal(out.nodes[0].x, 0);     // - x was negative → parked flush at 0
  assert.equal(out.nodes[0].y, 500);   // - y was positive → untouched
});

test('clampViewportToOrigin caps the translate at one grid of margin above/left of the origin', () => {
  assert.deepEqual(clampViewportToOrigin(500, 500, 1),   { x: 100, y: 100 });  // - cap = ORIGIN_GUTTER*1
  assert.deepEqual(clampViewportToOrigin(50, 50, 1),     { x: 50, y: 50 });    // - within the margin → unchanged
  assert.deepEqual(clampViewportToOrigin(300, 300, 2),   { x: 200, y: 200 });  // - cap = ORIGIN_GUTTER*2 = 200
});

test('clampCameraToOrigin: one grid of margin on the left, flush at the top', () => {
  assert.deepEqual(clampCameraToOrigin(500, 500, 2), { x: 200, y: 0 });      // - ORIGIN_GUTTER 100 · zoom 2 on x; y capped at 0
  assert.deepEqual(clampCameraToOrigin(-300, -400, 1), { x: -300, y: -400 }); // - panning into content is free
  assert.deepEqual(clampCameraToOrigin(50, 50, 1), { x: 50, y: 0 });
});

test('normalizeCanvasToOrigin lifts the section lanes with the content', () => {
  const canvas = { nodes: [{ id: 'a', x: 0, y: -300, width: 10, height: 10 }], edges: [],
    metadata: { sections: [{ id: 'a', y: -300, createdAt: 1 }] } };
  const out = normalizeCanvasToOrigin(canvas);
  assert.equal(out.nodes[0].y, 0);
  assert.equal(out.metadata.sections[0].y, 0);
  // - nothing negative → untouched, lanes included (same ref, no save)
  const still = { nodes: [{ id: 'a', x: 0, y: 300, width: 10, height: 10 }], edges: [],
    metadata: { sections: [{ id: 'a', y: 0, createdAt: 1 }] } };
  assert.equal(normalizeCanvasToOrigin(still), still);
});
