// - run: npx esbuild src/shared/chatAttachments.ts --bundle --format=esm --outfile=tests/.build/chatAttachments.mjs && node --test tests/chat-attachments.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  attachmentKey, chipLabel, formatAttachments, looksBinary, mergeAttachments, parseImageDataUrl, removeAttachment,
} from './.build/chatAttachments.mjs';

const node = { kind: 'node', id: 'n1', label: 'N8' };
const file = { kind: 'file', path: '/w/a.py', name: 'a.py' };
const img  = { kind: 'image', id: 'img-1', name: 'image 1', mediaType: 'image/png', data: 'AAAA' };

test('keys tell kinds and items apart', () => {
  assert.deepEqual([node, file, img].map(attachmentKey), ['node:n1', 'file:/w/a.py', 'image:img-1']);
});

test('a chip shows the node label, or the file or image name', () => {
  assert.deepEqual([node, file, img].map(chipLabel), ['N8', 'a.py', 'image 1']);
});

test('attaching the same node twice keeps one chip, in first-seen order', () => {
  assert.deepEqual(mergeAttachments([node], [file, node]), [node, file]);
});

test('removing by key drops only that attachment', () => {
  assert.deepEqual(removeAttachment([node, file], 'node:n1'), [file]);
});

test('a PNG data URL splits into media type and base64 data', () => {
  assert.deepEqual(parseImageDataUrl('data:image/png;base64,iVBOR'), { mediaType: 'image/png', data: 'iVBOR' });
});

test('an unsupported type or a non-base64 data URL is rejected', () => {
  assert.equal(parseImageDataUrl('data:image/bmp;base64,Qk0'), null);
  assert.equal(parseImageDataUrl('data:text/plain,hello'), null);
});

test('text with a NUL character is treated as binary', () => {
  assert.equal(looksBinary('print(1)\n'), false);
  assert.equal(looksBinary('PK\u0003\u0004\u0000'), true);
});

test('no attachments give no text', () => {
  assert.equal(formatAttachments([]), '');
});

test('blocks are listed under one heading with their count', () => {
  const out = formatAttachments([
    { heading: '[N8] (text) lookup', body: 'falls back to exchange' },
    { heading: 'file /w/a.py', body: '[file on disk — read it yourself if needed: /w/a.py]' },
  ]);
  assert.equal(out, 'ATTACHED BY THE USER (2):\n### [N8] (text) lookup\nfalls back to exchange\n\n### file /w/a.py\n[file on disk — read it yourself if needed: /w/a.py]');
});

test('a block that would pass the cap is left out with a note; a smaller later block still fits', () => {
  const out = formatAttachments([
    { heading: 'A', body: 'x'.repeat(150) },
    { heading: 'B', body: 'y'.repeat(140) },
    { heading: 'C', body: 'z'.repeat(10) },
  ], 320);
  assert.equal(out, `ATTACHED BY THE USER (3):\n### A\n${'x'.repeat(150)}\n\n### B\n[left out: attachments are capped at 320 characters]\n\n### C\n${'z'.repeat(10)}`);
  assert.ok(out.length <= 320);
});

test('the headings and the left-out notes count toward the cap, not only the bodies', () => {
  const out = formatAttachments([
    { heading: 'A', body: 'x'.repeat(150) },
    { heading: 'B', body: 'y'.repeat(140) },
  ], 300);
  assert.equal(out, `ATTACHED BY THE USER (2):\n### A\n${'x'.repeat(150)}\n\n### B\n[left out: attachments are capped at 300 characters]`);
  assert.ok(out.length <= 300);
});

test('when not every heading fits, one line counts the attachments left out', () => {
  const blocks = [1, 2, 3, 4, 5].map(i => ({ heading: `H${i}`, body: 'b'.repeat(10) }));
  const out = formatAttachments(blocks, 200);
  assert.equal(out, `ATTACHED BY THE USER (5):\n### H1\n${'b'.repeat(10)}\n\n[4 more attachments left out: attachments are capped at 200 characters]`);
  assert.ok(out.length <= 200);
});
