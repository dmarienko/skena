// - run: npx esbuild src/shared/findReferences.ts --bundle --format=esm --outfile=tests/.build/findReferences.mjs && npx esbuild tests/fixtures/monaco-references-model.js --bundle --format=esm --platform=node --outfile=tests/.build/monacoReferencesModel.mjs && node --test tests/find-references.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { failureReason, openedTarget, peekBoxHeight, peekCellUri, peekPlan, referencesFromLocations } from './.build/findReferences.mjs';
import { ReferencesModel, URI } from './.build/monacoReferencesModel.mjs';

// - the joined text of three cells (header line 0): A on lines 1-2, B on 4-5, C on 7
const J = { text: '', spans: [{ id: 'A', first: 1, lines: 2 }, { id: 'B', first: 4, lines: 2 }, { id: 'C', first: 7, lines: 1 }] };
const DOC = 'file:///run/user/1000/skena/definition/def-abc-111111111111.py';
const DIR = 'file:///run/user/1000/skena/definition/';
const ref = (line, character, length = 4, uri = DOC) => ({ uri, line, character, endLine: line, endCharacter: character + length });

test('1. references: in the joined document to their cell with the range; between cells, another joined file and repeats dropped; files kept', () => {
  const lib = 'file:///home/u/proj/src/m.py';
  const old = 'file:///run/user/1000/skena/definition/def-abc-222222222222.py';
  assert.deepEqual(referencesFromLocations([ref(2, 4), ref(5, 0), ref(3, 0), ref(0, 2), ref(9, 4, 4, old), ref(11, 4, 6, lib), ref(5, 0)], DOC, DIR, J), [
    { kind: 'cell', cellId: 'A', line: 2, col: 5, endLine: 2, endCol: 9 },
    { kind: 'cell', cellId: 'B', line: 2, col: 1, endLine: 2, endCol: 5 },
    { kind: 'file', uri: lib, line: 12, col: 5, endLine: 12, endCol: 11 },
  ]);
});

// - E7 asks (its editor's model is EDITOR); E9 runs 3rd and E10 12th, the other way round from their labels' order; two files
const EDITOR = 'canvas-cell://0/E7';
const ANSWER = {
  targets: [
    { kind: 'file', uri: 'file:///home/u/proj/src/b.py', line: 3, col: 1, endLine: 3, endCol: 4 },
    { kind: 'cell', cellId: 'c9', line: 1, col: 1, endLine: 1, endCol: 4 },
    { kind: 'cell', cellId: 'c7', line: 2, col: 5, endLine: 2, endCol: 8 },
    { kind: 'cell', cellId: 'c10', line: 5, col: 1, endLine: 5, endCol: 4 },
    { kind: 'file', uri: 'file:///home/u/proj/src/a.py', line: 9, col: 1, endLine: 9, endCol: 4 },
    { kind: 'cell', cellId: 'c7', line: 1, col: 1, endLine: 1, endCol: 4 },
  ],
  cells: [
    { id: 'c7', label: 'E7', order: 7, code: 'abc = 1\nx = abc' },
    { id: 'c9', label: 'E9', order: 3, code: 'abc' },
    { id: 'c10', label: 'E10', order: 12, code: '\n\n\n\nabc' },
  ],
  files: [{ uri: 'file:///home/u/proj/src/a.py', text: 'a' }, { uri: 'file:///home/u/proj/src/b.py', text: 'b' }],
};

test('2. the peek lists the asking cell first, the other cells in run order, then the files, and starts on the reference under the cursor', () => {
  const plan = peekPlan(ANSWER, 'c7', EDITOR);
  assert.deepEqual(plan.models.map(m => m.uri), [peekCellUri(3, 'E9'), peekCellUri(12, 'E10'), 'file:///home/u/proj/src/a.py', 'file:///home/u/proj/src/b.py']);
  assert.deepEqual(plan.models.map(m => m.language), ['python', 'python', undefined, undefined]);
  const model = new ReferencesModel(plan.locations.map(l => ({ uri: URI.parse(l.uri), range: l.range })), 'References');
  assert.deepEqual(model.groups.map(g => [URI.parse(g.uri.toString()).path.split('/').pop(), g.children.length]), [['E7', 2], ['E9', 1], ['E10', 1], ['a.py', 1], ['b.py', 1]]);
  const start = model.nearestReference(URI.parse(EDITOR), { lineNumber: 2, column: 6 });
  assert.equal(start.uri.toString(), EDITOR);
  assert.equal(start.range.startLineNumber, 2);
});

test('3. a reference opened in the peek goes to its cell (the asking one included) or its file', () => {
  const plan = peekPlan(ANSWER, 'c7', EDITOR);
  assert.deepEqual(openedTarget(plan, EDITOR, 2, 5), { kind: 'cell', cellId: 'c7', line: 2, col: 5 });
  assert.deepEqual(openedTarget(plan, peekCellUri(12, 'E10'), 5, 1), { kind: 'cell', cellId: 'c10', line: 5, col: 1 });
  assert.deepEqual(openedTarget(plan, 'file:///home/u/proj/src/a.py', 9, 1), { kind: 'file', uri: 'file:///home/u/proj/src/a.py', line: 9, col: 1 });
  assert.equal(openedTarget(plan, 'canvas-cell://0/E8', 1, 1), null);
});

test('4. a file whose text did not come gets a model saying so on each reference\'s line; opening one goes to the reference', () => {
  const gone = 'file:///home/u/my%20proj/gone.py';
  const say = '(could not read /home/u/my proj/gone.py)';
  const answer = { ...ANSWER, targets: [...ANSWER.targets, { kind: 'file', uri: gone, line: 4, col: 1, endLine: 4, endCol: 4 }, { kind: 'file', uri: gone, line: 2, col: 9, endLine: 2, endCol: 12 }] };
  const plan = peekPlan(answer, 'c7', EDITOR);
  assert.deepEqual(plan.models.find(m => m.uri === gone), { uri: gone, text: `\n${say}\n\n${say}`, language: 'plaintext' });
  assert.deepEqual(plan.locations.filter(l => l.uri === gone).map(l => l.range), [
    { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: say.length + 1 },
    { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: say.length + 1 },
  ]);
  assert.deepEqual(openedTarget(plan, gone, 2, 1), { kind: 'file', uri: gone, line: 2, col: 9 });
  // - the files whose text came are as before
  assert.deepEqual(plan.models.filter(m => m.uri.startsWith('file:') && m.uri !== gone).map(m => m.text), ['a', 'b']);
});

test('5. a cell shorter than the peek needs is drawn taller by the difference; a tall one keeps its size', () => {
  // - 18 lines: the editor needs 23 lines of 19 px = 437 px
  assert.equal(peekBoxHeight(160, 114, 19), 160 + 437 - 114);
  assert.equal(peekBoxHeight(600, 437, 19), null);
  assert.equal(peekBoxHeight(600, 500, 19), null);
  // - a peek of 10 lines: 13 lines (ceil(10 / 0.8)) beat 12 (the peek, the cursor's line and the next)
  assert.equal(peekBoxHeight(100, 60, 20, 10), 100 + 260 - 60);
});

test('6. a failed lookup is noted by the first line of its message, cut to 60 characters', () => {
  assert.equal(failureReason(new Error('Pylance is not installed')), 'Pylance is not installed');
  assert.equal(failureReason(new Error('ENOENT: no such file or directory\n    at open (node:fs:1:1)')), 'ENOENT: no such file or directory');
  assert.equal(failureReason('x'.repeat(70)), `${'x'.repeat(59)}…`);
  assert.equal(failureReason(new Error('')), 'unknown error');
});
