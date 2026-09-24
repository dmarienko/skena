// tests/tool-card-view.mjs
// - run: npx esbuild src/webview/canvas/chat/toolCardView.ts --bundle --format=esm --outfile=tests/.build/toolCardView.mjs && node --test tests/tool-card-view.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toolCardView } from './.build/toolCardView.mjs';

test('Edit → basename title, result shown', () => {
  const v = toolCardView('Edit', { file_path: '/home/u/proj/src/app.ts' });
  assert.equal(v.title, 'Edit app.ts');
  assert.equal(v.hidden, false);
  assert.equal(v.showResult, true);
});

test('Write and MultiEdit behave like Edit', () => {
  assert.equal(toolCardView('Write', { file_path: '/a/b.py' }).title, 'Edit b.py');
  assert.equal(toolCardView('MultiEdit', { file_path: '/a/c.md' }).title, 'Edit c.md');
});

test('Bash → truncated command', () => {
  const v = toolCardView('Bash', { command: 'git status --porcelain' });
  assert.equal(v.title, 'Bash: git status --porcelain');
  const long = toolCardView('Bash', { command: 'x'.repeat(80) });
  assert.ok(long.title.length <= 6 + 60 + 1, 'command truncated to ~60');
  assert.ok(long.title.endsWith('…'));
});

test('Read → hidden', () => {
  assert.equal(toolCardView('Read', { file_path: '/a/b' }).hidden, true);
});

test('TodoWrite → todo kind with items, result hidden', () => {
  const v = toolCardView('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] });
  assert.equal(v.kind, 'todo');
  assert.equal(v.showResult, false);
  assert.deepEqual(v.todos, [{ text: 'a', status: 'completed' }, { text: 'b', status: 'pending' }]);
});

test('mcp__skena__canvas_add_node → friendly canvas label', () => {
  assert.equal(toolCardView('mcp__skena__canvas_add_node', {}).title, 'canvas: add node');
});

test('unknown tool → raw name', () => {
  assert.equal(toolCardView('Grep', { pattern: 'x' }).title, 'Grep');
});
