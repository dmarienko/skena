// tests/chat-timeline.mjs
// - run: npx esbuild src/webview/canvas/chat/chatTimeline.ts --bundle --format=esm --outfile=tests/.build/chatTimeline.mjs && node --test tests/chat-timeline.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyToolEvent, flushPendingText, migrateHistory } from './.build/chatTimeline.mjs';

const TS = '2026-07-08T00:00:00Z';

test('tool use flushes pending text, then appends a running card', () => {
  let items = [];
  let pending = 'hello ';
  ({ items, pending } = applyToolEvent(items, pending, { kind: 'use', id: 't1', name: 'Bash', input: { command: 'ls' } }, TS));
  assert.equal(items.length, 2);
  assert.deepEqual({ kind: items[0].kind, role: items[0].role, content: items[0].content }, { kind: 'text', role: 'assistant', content: 'hello ' });
  assert.equal(items[1].kind, 'tool');
  assert.equal(items[1].status, 'running');
  assert.equal(pending, '');
});

test('result updates the matching card by id', () => {
  let items = [{ kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'running', timestamp: TS }];
  let pending = '';
  ({ items, pending } = applyToolEvent(items, pending, { kind: 'result', id: 't1', ok: true, preview: 'done' }, TS));
  assert.equal(items[0].status, 'ok');
  assert.equal(items[0].resultPreview, 'done');
});

test('result with error → status error', () => {
  let items = [{ kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'running', timestamp: TS }];
  ({ items } = applyToolEvent(items, '', { kind: 'result', id: 't1', ok: false, preview: 'boom' }, TS));
  assert.equal(items[0].status, 'error');
});

test('result for unknown id is ignored (no throw)', () => {
  const { items } = applyToolEvent([], '', { kind: 'result', id: 'nope', ok: true, preview: 'x' }, TS);
  assert.deepEqual(items, []);
});

test('thinking flushes text then appends a thinking item', () => {
  const { items, pending } = applyToolEvent([], 'partial', { kind: 'thinking', content: 'hmm' }, TS);
  assert.equal(items[0].content, 'partial');
  assert.equal(items[1].kind, 'thinking');
  assert.equal(items[1].content, 'hmm');
  assert.equal(pending, '');
});

test('empty pending text does not create an empty text item', () => {
  const { items } = applyToolEvent([], '', { kind: 'use', id: 't2', name: 'Read', input: {} }, TS);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'tool');
});

test('flushPendingText appends assistant text with cost', () => {
  const items = flushPendingText([], 'final answer', TS, { costUsd: 0.1, deltaUsd: 0.02 });
  assert.deepEqual(
    { kind: items[0].kind, content: items[0].content, deltaUsd: items[0].deltaUsd },
    { kind: 'text', content: 'final answer', deltaUsd: 0.02 },
  );
});

test('flushPendingText with empty text is a no-op', () => {
  assert.deepEqual(flushPendingText([{ kind: 'thinking', content: 'x', timestamp: TS }], '', TS), [{ kind: 'thinking', content: 'x', timestamp: TS }]);
});

test('migrateHistory upgrades legacy ChatMessage[] to ChatItem text items', () => {
  const legacy = [
    { role: 'user', content: 'hi', timestamp: TS },
    { role: 'assistant', content: 'yo', timestamp: TS, costUsd: 0.3, deltaUsd: 0.1 },
  ];
  const out = migrateHistory(legacy);
  assert.equal(out[0].kind, 'text');
  assert.equal(out[0].role, 'user');
  assert.equal(out[1].deltaUsd, 0.1);
});

test('migrateHistory passes through already-migrated items', () => {
  const items = [{ kind: 'tool', id: 't', name: 'Bash', input: {}, status: 'ok', timestamp: TS }];
  assert.deepEqual(migrateHistory(items), items);
});

test('migrateHistory sanitizes a persisted running tool card to error', () => {
  const out = migrateHistory([{ kind: 'tool', id: 't', name: 'Bash', input: {}, status: 'running', timestamp: TS }]);
  assert.equal(out[0].status, 'error');
});
