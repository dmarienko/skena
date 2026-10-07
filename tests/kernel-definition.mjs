// - run: npx esbuild src/extension/jupyter/definitionSnippet.ts --bundle --format=esm --outfile=tests/.build/definitionSnippet.mjs && node --test tests/kernel-definition.mjs
// - needs python3 on PATH (PYTHON=… picks another); nothing is installed
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { definitionExpression, parseDefinitionValue } from './.build/definitionSnippet.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/definition_fixture.py', import.meta.url));
const DRIVER = fileURLToPath(new URL('./fixtures/definition_driver.py', import.meta.url));
const lineOf = text => readFileSync(FIXTURE, 'utf8').split('\n').findIndex(l => l.includes(text)) + 1;

// - every name in one python run; name -> the parsed answer and the raw text/plain
const NAMES = [
  'fx.plain', 'fx.Box', 'fx.Box.area', 'fx.box.area', 'fx.box.side', 'fx.Box.make', 'fx.decorated', 'fx.Point', 'fx.box', 'fx',
  'len', 'math.sqrt', 'array.array', 'in_cell', 'CellBox', 'CellPoint', 'nope', 'fx.nope', '\uff46\uff58.plain',
];
const run = spawnSync(process.env.PYTHON ?? 'python3', [DRIVER], { input: JSON.stringify(NAMES.map(definitionExpression)), encoding: 'utf8' });
const out = run.stdout.trim().split('\n').map(l => JSON.parse(l));
const tail = out.pop();
const answers = Object.fromEntries(NAMES.map((n, i) => [n, parseDefinitionValue(out[i])]));
const textPlain = Object.fromEntries(NAMES.map((n, i) => [n, out[i].data['text/plain']]));
const at = (name, text, col) => ({ ok: true, def: { file: FIXTURE, line: lineOf(text), col, exists: true } });

test('1. a function, a class and a method: the def or class line, the column of the name', () => {
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(answers['fx.plain'], at('fx.plain', 'def plain(', 5));
  assert.deepEqual(answers['fx.Box'], at('fx.Box', 'class Box:', 7));
  assert.deepEqual(answers['fx.Box.area'], at('fx.Box.area', 'def area(', 9));
  assert.deepEqual(answers['fx.box.area'], at('fx.box.area', 'def area(', 9));
});

test('2. a property is not run and its getter is found; a classmethod; a decorated function at its def line', () => {
  assert.deepEqual(answers['fx.box.side'], at('fx.box.side', 'def side(', 9));
  assert.deepEqual(answers['fx.Box.make'], at('fx.Box.make', 'def make(', 9));
  assert.deepEqual(answers['fx.decorated'], at('fx.decorated', 'def decorated(', 5));
});

test('3. a dataclass; a value stands for its class; a module is its file at line 1', () => {
  assert.deepEqual(answers['fx.Point'], at('fx.Point', 'class Point:', 7));
  assert.deepEqual(answers['fx.box'], at('fx.box', 'class Box:', 7));
  assert.deepEqual(answers.fx, { ok: true, def: { file: FIXTURE, line: 1, col: 1, exists: true } });
});

test('4. builtins and C types have no source', () => {
  for (const n of ['len', 'math.sqrt', 'array.array']) assert.deepEqual(answers[n], { ok: false, error: 'no source' }, n);
});

test('5. a function and a class of a cell: the temporary file, the cell text, the block; a cell class without methods has none before 3.14', () => {
  const cell = 'import dataclasses, functools\n\n@functools.lru_cache\ndef in_cell(a):\n    return a + 1\n\nclass CellBox:\n    def grow(self):\n        return 2\n\n@dataclasses.dataclass\nclass CellPoint:\n    x: int = 0\n';
  assert.deepEqual(answers.in_cell, { ok: true, def: { file: tail.cellFile, line: 4, col: 5, exists: false, cell, start: 3, count: 3 } });
  assert.deepEqual(answers.CellBox, { ok: true, def: { file: tail.cellFile, line: 7, col: 7, exists: false, cell, start: 7, count: 3 } });
  // - 3.14 gives an annotated class an __annotate__ function, which names the cell's file
  const annotate = tail.version[0] > 3 || tail.version[1] >= 14;
  assert.deepEqual(answers.CellPoint, annotate
    ? { ok: true, def: { file: tail.cellFile, line: 12, col: 7, exists: false, cell, start: 11, count: 3 } }
    : { ok: false, error: 'no source' });
});

test('6. unknown names and attributes come back as the error, nothing is added to the namespace', () => {
  assert.deepEqual(answers.nope, { ok: false, error: "NameError: name 'nope' is not defined" });
  assert.equal(answers['fx.nope'].ok, false);
  assert.match(answers['fx.nope'].error, /^AttributeError: /);
  assert.deepEqual(tail.added, []);
});

test('7. text/plain is the same JSON, for a kernel that sends no application/json', () => {
  for (const n of NAMES) assert.deepEqual(parseDefinitionValue({ status: 'ok', data: { 'text/plain': textPlain[n] } }), answers[n], n);
});

test('8. only names and dots are ever sent; an expression error is reported', () => {
  for (const bad of ['fx.plain()', 'a[0]', 'x + y', '__import__("os")', 'a..b', '', '1x', 'import', 'fx.class', 'None']) assert.throws(() => definitionExpression(bad), /not a dotted name/, bad);
  assert.deepEqual(parseDefinitionValue({ status: 'error', ename: 'SyntaxError', evalue: 'invalid syntax' }), { ok: false, error: 'SyntaxError: invalid syntax' });
  assert.deepEqual(parseDefinitionValue(undefined), { ok: false, error: 'no reply' });
});

test('9. a name is sent NFKC-normalised, as Python stores identifiers: fullwidth fx is fx, \u216b is XII', () => {
  assert.deepEqual(answers['\uff46\uff58.plain'], answers['fx.plain']);
  assert.equal(definitionExpression('\u216b'), definitionExpression('XII'));
});
