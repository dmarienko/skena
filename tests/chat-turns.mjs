// - run: npx esbuild src/webview/canvas/chat/chatTurns.ts --bundle --format=esm --outfile=tests/.build/chatTurns.mjs && node --test tests/chat-turns.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addToTurn, clockTime, firstLine, groupTurns, noteAddedLine, turnAnswer, turnCost } from './.build/chatTurns.mjs';

const at    = (h, m) => new Date(2026, 8, 27, h, m).toISOString();
const user  = (content, ts = at(14, 0)) => ({ kind: 'text', role: 'user', content, timestamp: ts });
const reply = (content, extra = {}) => ({ kind: 'text', role: 'assistant', content, timestamp: at(14, 1), ...extra });
const tool  = id => ({ kind: 'tool', id, name: 'Bash', input: {}, status: 'ok', timestamp: at(14, 1) });

test('each prompt starts a turn; its replies and steps follow it', () => {
  const turns = groupTurns([user('a'), tool('t1'), reply('x'), user('b', at(15, 30)), reply('y')]);
  assert.deepEqual(turns.map(t => t.key), ['turn-0', 'turn-1']);
  assert.deepEqual(turns.map(t => t.prompt), ['a', 'b']);
  assert.deepEqual(turns.map(t => t.items.length), [2, 1]);
  assert.equal(turns[1].time, at(15, 30));
});

test('an empty history has no turns', () => {
  assert.deepEqual(groupTurns([]), []);
});

test('items logged before the first prompt form a turn with no prompt', () => {
  const turns = groupTurns([reply('note'), user('a')]);
  assert.equal(turns[0].prompt, null);
  assert.equal(turns[0].items.length, 1);
  assert.equal(turns[1].key, 'turn-1');
});

test('earlier turn keys stay the same when the history grows', () => {
  const h = [user('a'), reply('x')];
  const before = groupTurns(h).map(t => t.key);
  const after  = groupTurns([...h, user('b'), reply('y')]).map(t => t.key);
  assert.deepEqual(after.slice(0, 1), before);
});

test('a line added to an earlier turn goes after its items, and no turn key changes', () => {
  const h    = [user('a'), reply('x'), user('b'), reply('y')];
  const line = reply(noteAddedLine('N17'));
  const next = addToTurn(h, 'turn-0', line);
  assert.deepEqual(next, [user('a'), reply('x'), line, user('b'), reply('y')]);
  assert.deepEqual(groupTurns(next).map(t => t.key), groupTurns(h).map(t => t.key));
});

test('a line added to the latest turn, or to a turn no longer there, goes at the end', () => {
  const h    = [user('a'), reply('x')];
  const line = reply(noteAddedLine('N17'));
  assert.deepEqual(addToTurn(h, 'turn-0', line), [...h, line]);
  assert.deepEqual(addToTurn(h, 'turn-9', line), [...h, line]);
});

test('the line saying the answer was added to the canvas is short and is not the answer', () => {
  assert.equal(noteAddedLine('N17'), '📌 added N17 to the canvas');
  const [t] = groupTurns([user('a'), reply('Done.'), reply(noteAddedLine('N17'))]);
  assert.equal(turnAnswer(t), 'Done.');
});

test('the answer is the last reply of the turn, not the narration before a tool call', () => {
  const [t] = groupTurns([user('a'), reply('Let me read N8.'), tool('t1'), reply('Added N17 under N8.')]);
  assert.equal(turnAnswer(t), 'Added N17 under N8.');
});

test('a node-added notice after the reply is not the answer', () => {
  const [t] = groupTurns([user('a'), reply('Done.'), reply('📌 *Added to canvas:*\n\nnote')]);
  assert.equal(turnAnswer(t), 'Done.');
});

test('a turn with no reply has an empty answer', () => {
  const [t] = groupTurns([user('a'), tool('t1')]);
  assert.equal(turnAnswer(t), '');
});

test('the turn cost comes from the last reply that carries one', () => {
  const [t] = groupTurns([user('a'), reply('x', { deltaUsd: 0.02, costUsd: 0.4 })]);
  assert.deepEqual(turnCost(t), { deltaUsd: 0.02, costUsd: 0.4 });
  assert.equal(turnCost(groupTurns([user('b'), reply('y')])[0]), null);
});

test('firstLine keeps the first non-empty line', () => {
  assert.equal(firstLine('  refactor E7\n1. move it'), 'refactor E7');
  assert.equal(firstLine('\n\nhello'), 'hello');
  assert.equal(firstLine(''), '');
});

test('clockTime shows local hours and minutes', () => {
  assert.equal(clockTime(at(14, 5)), '14:05');
  assert.equal(clockTime('not a date'), '');
});
