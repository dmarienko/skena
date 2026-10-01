// - run: npx esbuild src/shared/nodeRef.ts --bundle --format=esm --outfile=tests/.build/node-ref.mjs && node --test tests/node-ref.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseNodeRef, formatNodeRef, isNodeRef, isSectionLabel, findRefTarget, refTitle } from './.build/node-ref.mjs';

test('parseNodeRef splits path and label', () => {
  assert.deepEqual(parseNodeRef('test/H1.canvas#N2'), { canvas: 'test/H1.canvas', label: 'N2' });
  assert.deepEqual(parseNodeRef('a/b c/x.canvas#E10'), { canvas: 'a/b c/x.canvas', label: 'E10' });
});

test('parseNodeRef trims surrounding whitespace', () => {
  assert.deepEqual(parseNodeRef('  x.canvas#K1\n'), { canvas: 'x.canvas', label: 'K1' });
});

test('parseNodeRef rejects non-references', () => {
  assert.equal(parseNodeRef('a note about x.canvas'), null);
  assert.equal(parseNodeRef('http://example.com#N2'), null);
  assert.equal(parseNodeRef('x.canvas#37'), null);
  assert.equal(parseNodeRef('x.py#N2'), null);
});

test('formatNodeRef round-trips with parseNodeRef', () => {
  const s = formatNodeRef('test/H1.canvas', 'N2');
  assert.equal(s, 'test/H1.canvas#N2');
  assert.deepEqual(parseNodeRef(s), { canvas: 'test/H1.canvas', label: 'N2' });
});

test('isNodeRef is true only for valid references', () => {
  assert.equal(isNodeRef('test/H1.canvas#N2'), true);
  assert.equal(isNodeRef('just text'), false);
});

test('a section reference parses like a node reference and round-trips', () => {
  assert.deepEqual(parseNodeRef('notes/plan.canvas#S3'), { canvas: 'notes/plan.canvas', label: 'S3' });
  assert.equal(formatNodeRef('notes/plan.canvas', 'S3'), 'notes/plan.canvas#S3');
});

test('isSectionLabel: S followed by digits only', () => {
  for (const l of ['S1', 'S3', 'S12']) assert.equal(isSectionLabel(l), true, l);
  for (const l of ['N3', 'SE3', 'D1', 's3', 'S']) assert.equal(isSectionLabel(l), false, l);
});

// - sections stored out of stack order: the label follows y, not the array position
const canvas = {
  nodes: [
    { id: 'n1', type: 'text', nodeLabel: 'N1', text: '## Plan\nbody', x: 0, y: 0, width: 700, height: 300 },
    { id: 'e1', type: 'code', nodeLabel: 'E1', code: '\nimport numpy as np\nnp.arange(3)', x: 0, y: 900, width: 700, height: 100 },
    // - a node given a section-shaped label by hand
    { id: 'odd', type: 'text', nodeLabel: 'S2', text: 'odd', x: 0, y: 1800, width: 700, height: 300 },
  ],
  metadata: { sections: [
    { id: 'sec-b', y: 800, createdAt: 2 },
    { id: 'sec-a', y: 0, title: ' Lesson 1 ', createdAt: 1 },
  ] },
};

test('findRefTarget: a node label gives the node id, a section label the section by stack order', () => {
  assert.deepEqual(findRefTarget(canvas, 'E1'), { kind: 'node', id: 'e1' });
  assert.deepEqual(findRefTarget(canvas, 'S1'), { kind: 'section', label: 'S1' });
  assert.deepEqual(findRefTarget(canvas, 'S2'), { kind: 'section', label: 'S2' }, 'the section wins over a node labelled S2');
});

test('findRefTarget: a label that names nothing is null', () => {
  assert.equal(findRefTarget(canvas, 'N9'), null);
  assert.equal(findRefTarget(canvas, 'S3'), null, 'past the last section');
  assert.equal(findRefTarget(canvas, 'S0'), null);
  assert.equal(findRefTarget(canvas, 'S01'), null, 'labels are S1, S2 …, never zero-padded');
  assert.equal(findRefTarget({ nodes: [] }, 'S1'), null, 'a canvas with no sections');
});

test('refTitle: the section title by stack order, nothing for an untitled one', () => {
  assert.equal(refTitle(canvas, 'S1'), 'Lesson 1');
  assert.equal(refTitle(canvas, 'S2'), undefined);
});

test('refTitle: one line from the node — heading marks dropped, blank lines skipped — capped at 80 characters', () => {
  assert.equal(refTitle(canvas, 'N1'), 'Plan');
  assert.equal(refTitle(canvas, 'E1'), 'import numpy as np');
  assert.equal(refTitle(canvas, 'N9'), undefined);
  const long = { nodes: [{ id: 'l', type: 'link', nodeLabel: 'L1', url: `https://x.io/${'a'.repeat(200)}` }] };
  assert.equal(refTitle(long, 'L1').length, 80);
});
