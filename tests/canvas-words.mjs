// - word completion for the text-node editor and the chat input: words come from the canvas
// - run: npx esbuild src/webview/canvas/canvasWords.ts --bundle --format=esm --outfile=tests/.build/canvasWords.mjs && node --test tests/canvas-words.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { splitWords, buildWordList, matchWords, wordBefore } from './.build/canvasWords.mjs';

const text = (t, label) => ({ type: 'text', id: `t-${label ?? t}`, text: t, nodeLabel: label });
const words = list => list.map(w => w.word);

test('splitWords splits on anything that is not a letter, digit or _', () => {
  assert.deepEqual(
    splitWords('foo-bar baz_qux,x1y2.über(éclair)\tend\nnew'),
    ['foo', 'bar', 'baz_qux', 'x1y2', 'über', 'éclair', 'end', 'new'],
  );
});

test('splitWords drops words shorter than 3 characters', () => {
  assert.deepEqual(splitWords('a ab abc abcd x1 x12'), ['abc', 'abcd', 'x12']);
});

test('buildWordList takes words from notes, code, knowledge text and text outputs', () => {
  const nodes = [
    { type: 'text',      id: 'a', text: 'note alpha' },
    { type: 'code',      id: 'b', code: 'import pandas' },
    { type: 'knowledge', id: 'c', server: 's', uri: 'u', title: 'kbtitle', text: 'vault gamma', fetchedAt: '' },
    { type: 'cell',      id: 'd', format: 'markdown', content: 'outmd' },
    { type: 'cell',      id: 'e', format: 'html', content: '<pre class="skena-out-stream"><span style="color:red">printed</span> &amp; done</pre>' },
    { type: 'cell',      id: 'f', format: 'image', content: 'data:image/png;base64,iVBORwimagebytes' },
    { type: 'cell',      id: 'g', format: 'plotly', content: '{"data":[{"type":"scatter"}]}' },
  ];
  assert.deepEqual(
    words(buildWordList(nodes)).sort(),
    ['alpha', 'done', 'gamma', 'import', 'kbtitle', 'note', 'outmd', 'pandas', 'printed', 'vault'],
  );
});

test('buildWordList skips base64 images pasted into a note', () => {
  const nodes = [text('see ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg) here')];
  assert.deepEqual(words(buildWordList(nodes)).sort(), ['here', 'see']);
});

test('buildWordList includes node labels, even ones shorter than 3 characters', () => {
  const nodes = [text('hello', 'N8'), { type: 'code', id: 'c', code: '', nodeLabel: 'E17' }];
  assert.deepEqual(words(buildWordList(nodes)).sort(), ['E17', 'N8', 'hello']);
});

test('buildWordList orders by frequency, then alphabetically', () => {
  const nodes = [text('beta alpha beta gamma'), text('gamma beta delta Alpha')];
  const list = buildWordList(nodes);
  assert.deepEqual(words(list), ['beta', 'gamma', 'Alpha', 'alpha', 'delta']);
  assert.deepEqual(list.map(w => w.count), [3, 2, 1, 1, 1]);
});

test('matchWords keeps case-insensitive prefix matches, in list order', () => {
  const list = buildWordList([text('Price price priced prime other print')]);
  assert.deepEqual(matchWords(list, 'PRI'), ['Price', 'price', 'priced', 'prime', 'print']);
  assert.deepEqual(matchWords(list, 'pric'), ['Price', 'price', 'priced']);
  assert.deepEqual(matchWords(list, 'zzz'), []);
});

test('matchWords leaves out the word being typed', () => {
  const list = buildWordList([text('price priced')]);
  assert.deepEqual(matchWords(list, 'price'), ['priced']);
});

test('matchWords with an empty prefix returns the most frequent words', () => {
  const list = buildWordList([text('two two one three three three')]);
  assert.deepEqual(matchWords(list, ''), ['three', 'two', 'one']);
});

test('matchWords returns at most 50 words by default, and honours a smaller cap', () => {
  const many = Array.from({ length: 60 }, (_, i) => `word${String(i).padStart(2, '0')}`).join(' ');
  const list = buildWordList([text(many)]);
  const got = matchWords(list, 'wor');
  assert.equal(got.length, 50);
  assert.equal(got[0], 'word00');
  assert.equal(got[49], 'word49');
  assert.equal(matchWords(list, 'wor', 5).length, 5);
});

test('wordBefore returns the letters, digits and _ right before the cursor', () => {
  assert.equal(wordBefore('see the pri'), 'pri');
  assert.equal(wordBefore('call foo_ba'), 'foo_ba');
  assert.equal(wordBefore('x.éc'), 'éc');
  assert.equal(wordBefore('ends with space '), '');
  assert.equal(wordBefore(''), '');
});
