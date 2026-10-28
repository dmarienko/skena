// - run: npx esbuild src/shared/codeMarks.ts --bundle --format=esm --platform=node --outfile=tests/.build/codeMarks.mjs && node --test tests/code-marks.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { codeMarks } from './.build/codeMarks.mjs';

test('every # %% line with text is a mark, with its 1-based line', () => {
  const code = '# %% Select by correlation, RHO_MAX\nx = 1\n\n# %% Plot the survivors\nplt.plot(x)';
  assert.deepEqual(codeMarks(code), [
    { line: 1, text: 'Select by correlation, RHO_MAX' },
    { line: 4, text: 'Plot the survivors' },
  ]);
});

test('an indented marker and extra spaces still count; the text is trimmed', () => {
  assert.deepEqual(codeMarks('if True:\n    #   %%   inside a block   \n    pass'), [{ line: 2, text: 'inside a block' }]);
});

test('ordinary comments, a bare # %% and %% inside code are not marks', () => {
  assert.deepEqual(codeMarks('# - a comment\n# %%\n#%%\nx = "# %% not a comment"\ny = 1  # %% trailing'), []);
});

test('a Jupytext cell type in brackets is kept as written', () => {
  assert.deepEqual(codeMarks('# %% [markdown] Notes'), [{ line: 1, text: '[markdown] Notes' }]);
});

test('Windows line ends do not leak into the text', () => {
  assert.deepEqual(codeMarks('# %% One\r\nx = 1\r\n# %% Two\r\n'), [{ line: 1, text: 'One' }, { line: 3, text: 'Two' }]);
});

test('#%% without a space counts, as in VS Code cell markers', () => {
  assert.deepEqual(codeMarks('#%% Load data'), [{ line: 1, text: 'Load data' }]);
});
