// tests/drop-nodes.mjs
// - behavioral tests: a dropped/pasted .canvas path becomes a portal node, anything else a file node.
// - run: npx esbuild src/extension/dropNodes.ts --bundle --format=esm --platform=node --outfile=tests/.build/dropNodes.mjs && node --test tests/drop-nodes.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildDroppedNode } from './.build/dropNodes.mjs';

test('.canvas path -> portal node, sized 200x200, canvas field set', () => {
  const n = buildDroppedNode('id1', '/ws/sub/notes.canvas', './sub/notes.canvas', 10, 20);
  assert.deepEqual(n, { id: 'id1', type: 'portal', canvas: './sub/notes.canvas', x: 10, y: 20, width: 200, height: 200 });
});

test('.canvas path is case-insensitive', () => {
  const n = buildDroppedNode('id1', '/ws/notes.CANVAS', './notes.CANVAS', 0, 0);
  assert.equal(n.type, 'portal');
});

test('non-canvas path -> file node, sized 700x700, file field set', () => {
  const n = buildDroppedNode('id2', '/ws/notes.md', './notes.md', 5, 6);
  assert.deepEqual(n, { id: 'id2', type: 'file', file: './notes.md', x: 5, y: 6, width: 700, height: 700 });
});

test('a vault:// relPath is stored as-is regardless of node type', () => {
  const portal = buildDroppedNode('id3', '/vault/x.canvas', 'vault://kb/x.canvas', 0, 0);
  assert.equal(portal.canvas, 'vault://kb/x.canvas');
  const file = buildDroppedNode('id4', '/vault/x.md', 'vault://kb/x.md', 0, 0);
  assert.equal(file.file, 'vault://kb/x.md');
});
