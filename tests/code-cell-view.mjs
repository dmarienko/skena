// - run: npx esbuild src/webview/canvas/codeCellView.ts --bundle --format=esm --outfile=tests/.build/codeCellView.mjs && node --test tests/code-cell-view.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  pythonBracketLevels, bracketColor, relativeLineNumbers, codeGutter, scaleAlpha, splitRuns, magicRange,
  BRACKET_COLORS_DARK, BRACKET_COLORS_LIGHT, BRACKET_INVALID_COLOR,
} from './.build/codeCellView.mjs';

// - "line:col:level", or "line:col:X" for a bracket drawn red
const marks = src => pythonBracketLevels(src.split('\n')).map(b => `${b.line}:${b.col}:${b.invalid ? 'X' : b.level}`);

test('1. brackets in code are coloured by depth; brackets in strings and comments are not', () => {
  assert.deepEqual(marks(`x = f(a["k(]"], ')')  # (x]`), ['0:5:0', '0:7:1', '0:13:1', '0:19:0']);
});

test('2. triple-quoted strings run across lines; a bracket after the closing quotes is coloured', () => {
  assert.deepEqual(marks(`s = """doc (\n  still ] doc\n""" + (1)`), ['2:6:0', '2:8:0']);
  assert.deepEqual(marks(`t = '''a\n(\n'''`), []);
});

test('3. a backslash at the end of a quoted line carries the string onto the next line, as in the editor', () => {
  assert.deepEqual(marks(`a = 'x \\\n(y' + [z]`), ['1:6:0', '1:8:0']);
});

test('4. an unterminated quote ends at the end of its line', () => {
  assert.deepEqual(marks(`u = 'open (\nv = (1)`), ['1:4:0', '1:6:0']);
});

test('5. f-strings: the braces around an expression and brackets inside it are coloured, the text is not', () => {
  // - Monaco's python grammar gives `{expr` and `}` the identifier token, so its bracket matcher reads them
  assert.deepEqual(marks(`f"a ( {g(x)} )"`), ['0:6:0', '0:8:1', '0:10:1', '0:11:0']);
  // - only a leading lowercase f starts an f-string in that grammar
  assert.deepEqual(marks(`rf'{x}' + F"{y}"`), []);
});

test('6. one depth count across all three kinds, as Monaco does by default', () => {
  assert.deepEqual(marks('{[(x)]}'), ['0:0:0', '0:1:1', '0:2:2', '0:4:2', '0:5:1', '0:6:0']);
});

test('7. depths cycle through the three default colours', () => {
  const colors = pythonBracketLevels(['((((x))))']).slice(0, 4).map(b => bracketColor(b, true));
  assert.deepEqual(colors, [BRACKET_COLORS_DARK[0], BRACKET_COLORS_DARK[1], BRACKET_COLORS_DARK[2], BRACKET_COLORS_DARK[0]]);
  const light = pythonBracketLevels(['[x]']).map(b => bracketColor(b, false));
  assert.deepEqual(light, [BRACKET_COLORS_LIGHT[0], BRACKET_COLORS_LIGHT[0]]);
});

test('8. a closing bracket with no opener, and an opener never closed, are drawn red', () => {
  assert.deepEqual(marks(') (x'), ['0:0:X', '0:2:X']);
  assert.equal(bracketColor(pythonBracketLevels([')'])[0], true), BRACKET_INVALID_COLOR);
});

test('9. a closing bracket pairs with the nearest opener of its kind; openers left inside it turn red', () => {
  // - `[` is never closed: `)` closes `(`, the last `]` has nothing left to close
  assert.deepEqual(marks('( [ { ) ]'), ['0:0:0', '0:2:X', '0:4:X', '0:6:0', '0:8:X']);
  // - brackets inside an unclosed one still count its depth
  assert.deepEqual(marks('( [ (x) )'), ['0:0:0', '0:2:X', '0:4:2', '0:6:2', '0:8:0']);
});

test('10. relative line numbers: the cursor line shows its own number, the others their distance to it', () => {
  assert.deepEqual(relativeLineNumbers(5, 3), ['2', '1', '3', '1', '2']);
  assert.deepEqual(relativeLineNumbers(4, 1), ['1', '1', '2', '3']);
  assert.deepEqual(relativeLineNumbers(3, 3), ['2', '1', '3']);
});

test('11. relative line numbers: a cursor line outside the text is clamped to it', () => {
  assert.deepEqual(relativeLineNumbers(3, 9), ['2', '1', '3']);
  assert.deepEqual(relativeLineNumbers(3, 0), ['1', '1', '2']);
  assert.deepEqual(relativeLineNumbers(0, 1), []);
});

test('12. line-number column: at least three digits wide, rounded like Monaco, plus the 6 px decorations lane', () => {
  assert.deepEqual(codeGutter(1, 7.2), { lineNumbersWidth: 22, contentLeft: 28 });
  assert.deepEqual(codeGutter(999, 7.2), { lineNumbersWidth: 22, contentLeft: 28 });
  assert.deepEqual(codeGutter(1000, 7.2), { lineNumbersWidth: 29, contentLeft: 35 });
});

test('13. the dimmed final line number is the line-number colour at 0.4 of its alpha', () => {
  assert.equal(scaleAlpha('#90be065c', 0.4), 'rgba(144, 190, 6, 0.14)');
  assert.equal(scaleAlpha('#ffffff', 0.5), 'rgba(255, 255, 255, 0.5)');
});

test('14. runs: each token keeps its own style, a bracket takes its bracket colour over the token colour', () => {
  const id = { color: '#c7d1cc' }, delim = { color: '#7c8a84' };
  const runs = splitRuns('f(a, b)', [{ offset: 0, style: id }, { offset: 1, style: delim }, { offset: 2, style: id }, { offset: 3, style: delim }, { offset: 5, style: id }, { offset: 6, style: delim }],
    new Map([[1, '#ffd700'], [6, '#ffd700']]));
  assert.deepEqual(runs.map(r => [r.text, r.style.color]), [['f', '#c7d1cc'], ['(', '#ffd700'], ['a', '#c7d1cc'], [', ', '#7c8a84'], ['b', '#c7d1cc'], [')', '#ffd700']]);
});

test('15. runs: neighbouring pieces with the same look are joined; no tokens means one plain run', () => {
  const a = { color: '#111111' };
  assert.deepEqual(splitRuns('abcd', [{ offset: 0, style: a }, { offset: 2, style: { ...a } }]).map(r => r.text), ['abcd']);
  assert.deepEqual(splitRuns('x = 1', []), [{ text: 'x = 1', style: {}, magic: false }]);
  assert.deepEqual(splitRuns('', [{ offset: 0, style: a }]), []);
});

test('16. IPython magic: the %name / %%name / ! token after the indentation, and nothing on plain lines', () => {
  assert.deepEqual(magicRange('  %timeit f(x)'), [2, 9]);
  assert.deepEqual(magicRange('%%time'), [0, 6]);
  assert.deepEqual(magicRange('!ls -la'), [0, 1]);
  assert.equal(magicRange('x = 1 % 2'), null);
  const runs = splitRuns('%time f', [{ offset: 0, style: { color: '#d4d4d4' } }], undefined, magicRange('%time f'));
  assert.deepEqual(runs.map(r => [r.text, r.magic]), [['%time', true], [' f', false]]);
});
