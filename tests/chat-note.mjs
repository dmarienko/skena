// - run: npx esbuild src/shared/chatNote.ts --bundle --format=esm --outfile=tests/.build/chatNote.mjs && node --test tests/chat-note.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addChatNote } from './.build/chatNote.mjs';

// - mirrors src/shared/constants.ts; the bundle does not re-export it
const GRID = 100;

const box = (id, type, x, y, width, height, extra = {}) => ({ id, type, x, y, width, height, ...extra });
const canvasOf = (nodes, edges = []) => ({ nodes, edges, metadata: { sections: [{ id: 's1', y: 0, createdAt: 0 }] } });
const at = (canvas, id) => { const n = canvas.nodes.find(m => m.id === id); return [n.x, n.y]; };

// - the engine's rule: two boxes need a full grid gap on at least one axis
const tooClose = (a, b) => !(
  a.x + a.width + GRID <= b.x || b.x + b.width + GRID <= a.x ||
  a.y + a.height + GRID <= b.y || b.y + b.height + GRID <= a.y
);
const closePairs = nodes => nodes.flatMap((a, i) => nodes.slice(i + 1).filter(b => tooClose(a, b)).map(b => `${a.id}/${b.id}`));

// - several paragraphs with display math, like the answer the user added on H3
const LONG = [
  'The spread is the log price of A minus beta times the log price of B. Beta comes from a rolling OLS fit over the last 500 bars, refit every 50 bars.',
  '$$',
  's_t = \\log P^A_t - \\beta_t \\log P^B_t',
  '$$',
  'The z-score divides the spread minus its rolling mean by its rolling standard deviation, both over the same 500 bars as the fit.',
  '$$',
  'z_t = \\frac{s_t - \\mu_t}{\\sigma_t}',
  '$$',
  'An entry opens when the z-score crosses 2 in either direction and closes when it crosses back through 0. A stop closes the position when the z-score reaches 4.',
  '%%',
  'h = ln(2) / theta',
  '%%',
  'The half-life above comes from the mean-reversion speed theta of an Ornstein-Uhlenbeck fit to the spread, and sets the maximum holding time at three half-lives.',
].join('\n\n');

test('a note added right of a knowledge node takes the next column and overlaps nothing (H3 W2 + ＋ canvas)', () => {
  // - W2 (1600,800) 700x300 focused; C4 (2400,800) 480x320 already in the column right of it.
  //   The old placement put the note at (2360,800), on top of C4.
  const canvas = canvasOf([box('W2', 'knowledge', 1600, 800, 700, 300), box('C4', 'cell', 2400, 800, 480, 320)]);
  const added = addChatNote(canvas, 'W2', LONG, 'n1', 0);
  const note = canvas.nodes.find(n => n.id === 'n1');
  assert.deepEqual(closePairs(canvas.nodes), []);
  assert.equal(note.x, 2400);                          // - W2's right edge + one gap: the next column
  assert.equal(note.y % GRID, 0);
  assert.deepEqual(added.node, note);                  // - the webview gets the geometry the canvas holds
});

test('the note on an exact row tie keeps the focused node\'s row, and the cell there packs under it', () => {
  // - the spec's rule for a node added beside another (§2, the insert row): on an exact y tie the new node
  //   wins and the occupant moves down. The edge gets keepRow true: holding the note moves nothing.
  const canvas = canvasOf([box('W2', 'knowledge', 1600, 800, 700, 300), box('C4', 'cell', 2400, 800, 480, 320)]);
  const { edge } = addChatNote(canvas, 'W2', LONG, 'n1', 0);
  const note = canvas.nodes.find(n => n.id === 'n1');
  assert.deepEqual(at(canvas, 'n1'), [2400, 800]);
  assert.deepEqual(at(canvas, 'C4'), [2400, 800 + note.height + GRID]);
  assert.deepEqual(at(canvas, 'W2'), [1600, 800]);
  assert.deepEqual(edge, { id: 'e-n1', fromNode: 'W2', fromSide: 'right', toNode: 'n1', toSide: 'left', toEnd: 'arrow', keepRow: true });
  assert.deepEqual(canvas.edges, [edge]);
});

test('a node already held to the focused node\'s row keeps that row: the note goes under it with keepRow false (H3 W2→C4)', () => {
  // - C4 was pasted onto W2, so the edge W2→C4 holds it on W2's row; E2 and its output C1 sit under
  //   it. Live, the note took (2400,800) on top of C4. Both id orders, since the tie must not hang on ids.
  for (const c4 of ['cell-c4', 'a-c4']) {
    const canvas = canvasOf([
      box('W2', 'knowledge', 1600, 800, 700, 300),
      box(c4, 'cell', 2400, 800, 480, 320),
      box('E2', 'code', 2400, 1220, 700, 300, { code: '', outputNodeId: 'C1' }),
      box('C1', 'cell', 3200, 1220, 600, 300),
    ], [{ id: 'e-c4', fromNode: 'W2', fromSide: 'right', toNode: c4, toSide: 'left', toEnd: 'arrow', keepRow: true }]);
    const { edge } = addChatNote(canvas, 'W2', LONG, 'ai-n1', 0);
    assert.deepEqual(at(canvas, c4), [2400, 800], c4);
    assert.deepEqual(at(canvas, 'ai-n1'), [2400, 800 + 320 + GRID], c4);
    assert.equal(edge.keepRow, false, c4);
    assert.deepEqual(closePairs(canvas.nodes), [], c4);
  }
});

test('the result lists the other nodes the layout moved, where they now are, for the webview to apply', () => {
  const canvas = canvasOf([box('W2', 'knowledge', 1600, 800, 700, 300), box('C4', 'cell', 2400, 800, 480, 320)]);
  const { node, moved } = addChatNote(canvas, 'W2', LONG, 'n1', 0);
  assert.deepEqual(moved, [{ id: 'C4', x: 2400, y: 800 + node.height + GRID }]);
});

test('a note whose row an output of another pair blocks gets keepRow false and packs under that output', () => {
  // - E1's output O1 (800,0) 1400x500 crosses the slot right of A (800,400): holding the note on A's
  //   row would move it under O1, so the edge does not hold, and the note goes under O1 as a mover.
  const canvas = canvasOf([
    box('E1', 'code', 0, 0, 700, 300, { code: '', outputNodeId: 'O1' }),
    box('O1', 'cell', 800, 0, 1400, 500),
    box('A', 'text', 0, 400, 700, 300, { text: 'a' }),
  ]);
  const { edge } = addChatNote(canvas, 'A', 'short', 'n1', 0);
  assert.equal(edge.keepRow, false);
  assert.deepEqual(at(canvas, 'n1'), [800, 600]);   // - O1's bottom 500 + one gap
  assert.deepEqual(closePairs(canvas.nodes), []);
});

test('a note off a code cell starts a column right of the cell\'s output, as `l` does', () => {
  const canvas = canvasOf([
    box('E1', 'code', 0, 0, 700, 300, { code: '', outputNodeId: 'O1' }),
    box('O1', 'cell', 800, 0, 600, 300),
  ]);
  addChatNote(canvas, 'E1', 'short', 'n1', 0);
  assert.deepEqual(at(canvas, 'n1'), [1500, 0]);    // - output's right edge 1400 + one gap
  assert.deepEqual(at(canvas, 'O1'), [800, 0]);
});

test('the note is the column width, and as tall as its text within the new-note and output limits', () => {
  const size = text => { const c = canvasOf([box('A', 'text', 0, 0, 700, 300, { text: 'a' })]); addChatNote(c, 'A', text, 'n1', 0); const n = c.nodes.find(m => m.id === 'n1'); return [n.width, n.height]; };
  assert.deepEqual(size('one line'), [700, 300]);                      // - never shorter than a new note
  const long = size(LONG);
  assert.equal(long[0], 700);
  assert.ok(long[1] > 300 && long[1] < 900, `height ${long[1]}`);
  assert.equal(long[1] % GRID, 0);
  assert.deepEqual(size(Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')), [700, 900]);   // - capped
});

test('with no focused node the note keeps the old fallback spot, snapped to the grid, and the engine runs', () => {
  // - the fallback is right of the last node: 800 + 700 + 60 = 1560, snapped to 1600
  const canvas = canvasOf([box('A', 'text', 0, 0, 700, 300, { text: 'a' }), box('B', 'text', 800, 0, 700, 300, { text: 'b' })]);
  const added = addChatNote(canvas, null, 'short', 'n1', 0);
  assert.deepEqual(at(canvas, 'n1'), [1600, 0]);
  assert.equal(added.edge, undefined);
  assert.deepEqual(canvas.edges, []);
  assert.deepEqual(closePairs(canvas.nodes), []);
});

test('a focused node that is gone gets no edge, and the note takes the fallback spot', () => {
  const canvas = canvasOf([box('A', 'text', 0, 0, 700, 300, { text: 'a' })]);
  const added = addChatNote(canvas, 'gone', 'short', 'n1', 0);
  assert.equal(added.edge, undefined);
  assert.deepEqual(canvas.edges, []);
  assert.deepEqual(at(canvas, 'n1'), [800, 0]);      // - 0 + 700 + 60 = 760, snapped to 800
});

test('a blank note adds nothing', () => {
  const canvas = canvasOf([box('A', 'text', 0, 0, 700, 300, { text: 'a' })]);
  assert.equal(addChatNote(canvas, 'A', '  \n ', 'n1', 0), null);
  assert.equal(canvas.nodes.length, 1);
});
