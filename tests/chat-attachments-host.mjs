// - run: npx esbuild src/extension/chat-attachments.ts --bundle --platform=node --format=esm --outfile=tests/.build/chatAttachmentsHost.mjs && node --test tests/chat-attachments-host.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachmentBlocks } from './.build/chatAttachmentsHost.mjs';

const dir    = mkdtempSync(join(tmpdir(), 'skena-att-'));
const canvas = {
  nodes: [{ id: 'n1', type: 'text', text: '## Lookup\nfalls back to exchange', nodeLabel: 'N8', x: 0, y: 0, width: 300, height: 100 }],
  edges: [],
};
const pathMode    = { fileNodeMode: 'path' };
const contentMode = { fileNodeMode: 'content' };

test('a picked text node brings its label, type, title and text', async () => {
  const [b] = await attachmentBlocks([{ kind: 'node', id: 'n1', label: 'N8' }], canvas, dir, pathMode, true);
  assert.deepEqual(b, { heading: '[N8] (text) Lookup', body: '## Lookup\nfalls back to exchange' });
});

test('a node deleted after it was picked says so', async () => {
  const [b] = await attachmentBlocks([{ kind: 'node', id: 'gone', label: 'N9' }], canvas, dir, pathMode, true);
  assert.deepEqual(b, { heading: '[N9]', body: '(this node is no longer on the canvas)' });
});

test('a file is a path for the harness', async () => {
  const [b] = await attachmentBlocks([{ kind: 'file', path: '/w/a.py', name: 'a.py' }], canvas, dir, pathMode, true);
  assert.deepEqual(b, { heading: 'file /w/a.py', body: '[file on disk — read it yourself if needed: /w/a.py]' });
});

test('a file is its text for providers without file tools', async () => {
  const p = join(dir, 'a.py');
  writeFileSync(p, 'print(1)\n');
  const [b] = await attachmentBlocks([{ kind: 'file', path: p, name: 'a.py' }], canvas, dir, contentMode, false);
  assert.equal(b.body, 'print(1)\n');
});

test('a binary file is not inlined', async () => {
  const p = join(dir, 'x.bin');
  writeFileSync(p, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
  const [b] = await attachmentBlocks([{ kind: 'file', path: p, name: 'x.bin' }], canvas, dir, contentMode, false);
  assert.equal(b.body, '[binary file, not inlined: x.bin]');
});

test('an image is named in the text and marked as sent or not sent', async () => {
  const img = { kind: 'image', id: 'img-1', name: 'image 1', mediaType: 'image/png', data: 'AA' };
  assert.equal((await attachmentBlocks([img], canvas, dir, pathMode, true))[0].body, '(sent with this message as an image)');
  assert.equal((await attachmentBlocks([img], canvas, dir, contentMode, false))[0].body, '(not sent: this provider takes text only)');
});
