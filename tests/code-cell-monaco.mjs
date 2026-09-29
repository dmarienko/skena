// - run: npx esbuild src/webview/canvas/codeCellMonaco.ts --bundle --format=esm --platform=node --outfile=tests/.build/codeCellMonaco.mjs && node --test tests/code-cell-monaco.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { codeIndentation, indentGuideColors, indentGuides, skenaCodeTheme, tokenStyler } from './.build/codeCellMonaco.mjs';

const color = (styler, type) => styler(type).color;

test('1. factors theme: each python token type gets the colour of its skena-code rule', () => {
  const s = tokenStyler(skenaCodeTheme(true, true, ''));
  assert.equal(color(s, 'identifier.python'), '#c7d1cc');
  assert.equal(color(s, 'delimiter.python'), '#7c8a84');
  // - a rule matches every type below it: delimiter covers delimiter.parenthesis
  assert.equal(color(s, 'delimiter.parenthesis.python'), '#7c8a84');
  assert.equal(color(s, 'keyword.python'), '#4cc8a0');
  assert.equal(color(s, 'string.escape.python'), '#d9a23f');
  assert.deepEqual(s('comment.python'), { color: '#56635d', italic: true, bold: false, underline: false, strikethrough: false });
});

test('2. a type no rule names takes the base theme default text colour', () => {
  const s = tokenStyler(skenaCodeTheme(true, true, '#101010'));
  assert.equal(color(s, ''), '#d4d4d4');
  assert.equal(color(s, 'white.python'), '#d4d4d4');
});

test('3. the default theme inherits the vs-dark / vs rules it does not override', () => {
  const dark = tokenStyler(skenaCodeTheme(true, false, ''));
  assert.equal(color(dark, 'delimiter.python'), '#dcdcdc');
  assert.equal(color(dark, 'number.python'), '#b5cea8');
  assert.equal(color(dark, 'keyword.python'), '#569cd6');
  assert.equal(dark('comment.python').italic, true);
  const light = tokenStyler(skenaCodeTheme(false, false, ''));
  assert.equal(color(light, 'keyword.python'), '#0070c1');
});

test('4. indentation guide colours come from the base theme', () => {
  assert.deepEqual(indentGuideColors(skenaCodeTheme(true, false, '')), { normal: '#404040', active: '#707070' });
  assert.deepEqual(indentGuideColors(skenaCodeTheme(false, true, '')), { normal: '#D3D3D3', active: '#939393' });
});

test('5. indentation is guessed from the text, 4 when there is none', () => {
  assert.deepEqual(codeIndentation(['if x:', '    y', '    if z:', '        w']), { tabSize: 4, indentSize: 4 });
  assert.deepEqual(codeIndentation(['if x:', '  y', '  if z:', '    w']), { tabSize: 2, indentSize: 2 });
  assert.deepEqual(codeIndentation(['x = 1', 'y = 2']), { tabSize: 4, indentSize: 4 });
});

const lines = ['def f(x):', '    if x:', '        y = (1,', '             2)', '', '    return y'];
const columns = guides => guides.map(row => row.map(g => g.column));

test('6. one guide per indent level, at columns 1, 5, 9, …; a partial level counts as a whole one', () => {
  assert.deepEqual(columns(indentGuides(lines, { tabSize: 4, indentSize: 4 }, null)), [[], [1], [1, 5], [1, 5, 9, 13], [1], [1]]);
});

test('7. a blank line takes the level of the line below it (python folds by indentation)', () => {
  const g = indentGuides(['if a:', '        b', '', '    c'], { tabSize: 4, indentSize: 4 }, null);
  assert.deepEqual(columns(g)[2], [1]);
});

test('8. no active guide until the editor has a cursor position', () => {
  assert.ok(indentGuides(lines, { tabSize: 4, indentSize: 4 }, null).flat().every(g => !g.active));
});

test('9. the active guide is the cursor line\'s block, on every line of that block', () => {
  const g = indentGuides(lines, { tabSize: 4, indentSize: 4 }, 3);
  const active = g.map(row => row.filter(x => x.active).map(x => x.column));
  assert.deepEqual(active, [[], [], [5], [5], [], []]);
});

test('10. with the cursor on a line that opens a block, the block below is the active one', () => {
  const g = indentGuides(lines, { tabSize: 4, indentSize: 4 }, 1);
  const active = g.map(row => row.filter(x => x.active).map(x => x.column));
  assert.deepEqual(active, [[], [1], [1], [1], [1], [1]]);
});
