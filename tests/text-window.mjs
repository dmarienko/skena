// - run: npx esbuild src/webview/canvas/textWindow.ts --bundle --format=esm --outfile=tests/.build/textWindow.mjs && npx esbuild src/shared/mathDelims.ts --bundle --format=esm --outfile=tests/.build/mathDelims.mjs && node --test tests/text-window.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import { toHtml } from 'hast-util-to-html';
import { chunkEnd, definitionsAfter } from './.build/textWindow.mjs';
import { normalizeMathDelimiters } from './.build/mathDelims.mjs';

// - every end chunkEnd gives when walked from 0 with this budget
function cuts(text, budget) {
  const ends = [];
  for (let from = 0; from < text.length;) {
    const end = chunkEnd(text, from, budget);
    assert.ok(end > from, `no progress at ${from}`);
    ends.push(end);
    from = end;
  }
  return ends;
}

const para = (ch, n) => ch.repeat(n);

test('a text no longer than the budget comes back whole', () => {
  const text = '# Title\n\nShort paragraph.\n';
  assert.equal(chunkEnd(text, 0, text.length), text.length);
  assert.equal(chunkEnd(text, 0, 10_000), text.length);
});

test('a cut falls at the start of the first paragraph that begins past the budget', () => {
  const text = `${para('a', 50)}\n\n${para('b', 50)}\n\n${para('c', 50)}\n`;
  assert.equal(chunkEnd(text, 0, 10), 52);    // - inside the first paragraph: cut before the second
  assert.equal(chunkEnd(text, 0, 52), 52);
  assert.equal(chunkEnd(text, 0, 53), 104);
  assert.equal(chunkEnd(text, 52, 1), 104);
});

test('a heading is a cut without a blank line before it', () => {
  const text = `${para('a', 50)}\n## Next\n${para('b', 50)}\n`;
  assert.equal(chunkEnd(text, 0, 10), 51);
  assert.ok(text.slice(51).startsWith('## Next'));
});

test('a fenced code block is never cut, blank lines inside or not', () => {
  const text = `intro\n\n\`\`\`python\nx = 1\n\n\ny = 2\n\n\`\`\`\n\nafter\n`;
  assert.equal(text.slice(chunkEnd(text, 0, 8)), 'after\n');
  // - a tilde fence closes only on a run at least as long as the one that opened it
  const tilde = `intro\n\n~~~~\na\n\n~~~\n\nb\n~~~~\n\nafter\n`;
  assert.equal(tilde.slice(chunkEnd(tilde, 0, 8)), 'after\n');
  // - ```x``` on one line is inline code, not a fence
  const inline = `\`\`\`x\`\`\` here\n\nnext\n`;
  assert.equal(inline.slice(chunkEnd(inline, 0, 3)), 'next\n');
});

test('a $$ math block is never cut; $$x$$ on one line opens nothing', () => {
  const text = `intro\n\n$$\na = 1\n\nb = 2\n$$\n\nafter\n`;
  assert.equal(text.slice(chunkEnd(text, 0, 8)), 'after\n');
  const inline = `$$x$$ inline\n\nnext\n`;
  assert.equal(inline.slice(chunkEnd(inline, 0, 3)), 'next\n');
});

test('$$ with text after it stays open until a line of only $$ (remark-math)', () => {
  // - `y$$` does not close the block that `$$-x` opened, so `para` is still inside it
  const text = `intro\n\n$$-x\ny$$\n\npara\n\n$$\n\nafter\n`;
  assert.deepEqual(cuts(text, 1).map(e => text.slice(e).split('\n')[0]), ['$$-x', 'after', '']);
});

test('a %% Typst block is never cut', () => {
  const text = `intro\n\n%%\nf(x) = 1\n\ng(x) = 2\n%%\n\nafter\n`;
  assert.equal(text.slice(chunkEnd(text, 0, 8)), 'after\n');
});

test('a \\[ … \\] display spanning a blank line is never cut', () => {
  const text = `intro \\[ a\n\nb \\] tail\n\nafter\n`;
  assert.equal(text.slice(chunkEnd(text, 0, 8)), 'after\n');
});

test('a table is never cut, not even before a heading that ends it', () => {
  const text = `intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n# Heading\n\nafter\n`;
  for (const end of cuts(text, 1)) {
    const before = text.slice(0, end).trimEnd().split('\n').at(-1);
    assert.ok(!before.includes('|') || end === text.length || text.slice(end).startsWith('after'), `cut after a table row at ${end}`);
  }
  assert.equal(text.slice(chunkEnd(text, 0, 8)), 'after\n');
});

test('an html element opened at a line start is never cut until it closes, nor an html comment', () => {
  const div = `intro\n\n<div class="box">\n\ninside\n\n<div>\n\nnested\n\n</div>\n\nstill inside\n\n</div>\n\nafter\n`;
  assert.equal(div.slice(chunkEnd(div, 0, 8)), 'after\n');
  const comment = `intro\n\n<!-- a\n\nb -->\n\nafter\n`;
  assert.equal(comment.slice(chunkEnd(comment, 0, 8)), 'after\n');
  // - a void tag or an element closed on its own line opens nothing
  const plain = `<img src="a.png">\n\n<p>one</p>\n\nnext\n`;
  assert.equal(cuts(plain, 1).length, 3);
});

test('a list is never cut: not before an item, nor before an indented continuation', () => {
  const text = `intro\n\n- one\n\n  more of one\n\n- two\n\n1. three\n\n    code in three\n\nafter\n`;
  assert.deepEqual(cuts(text, 1).map(e => text.slice(e).split('\n')[0]), ['after', '']);
});

test('a text with no cut past the budget comes back whole', () => {
  const text = `intro\n\n\`\`\`\n${'x\n\n'.repeat(100)}\`\`\`\n`;
  assert.equal(chunkEnd(text, 0, 10), text.length);
});

// - every construct the cut has to respect, plus footnotes referenced early and defined at the end
const SAMPLE = [
  '---', 'title: Sample', '---', '',
  '# A paper', '', 'Authors<br>Second author', '',
  `Abstract with a note[^a] and a link to [the site][site]. ${para('Prose. ', 20)}`, '',
  '## 1. Fenced code', '', '```python', 'def f():', '', '    return 1', '```', '',
  `Text with inline $x^2$ math and 5% of it.[^b] ${para('More prose. ', 15)}`, '',
  '$$', '\\begin{aligned}', 'a &= b', '', 'c &= d', '\\end{aligned}', '$$', '',
  '$$-\\log P', '=-\\sum_k s_k.$$', '', 'Swallowed by the math block above.', '', '$$', '',
  'Display \\[ \\frac{1}{2}', '', '\\] after display.', '',
  '| col | val |', '|-----|-----|', '| a   | 1   |', '| b   | 2   |', '### After the table', '',
  '<details>', '<summary>More</summary>', '', '**inside** the element', '', '</details>', '',
  '<!-- a comment', '', 'spanning a blank line -->', '',
  '- loose item one', '', '  continuation', '', '- loose item two', '',
  '1. first', '2. second', '',
  '> a quote', '> on two lines', '',
  `Closing paragraph with another note[^a]. ${para('End. ', 30)}`, '',
  '[site]: https://example.com "Example"', '',
  '[^a]:    The first note.', '    Its second line.', '',
  '[^b]: The second note,', 'continued lazily.', '',
].join('\n');

test('successive chunks concatenate back to the original exactly, each starting at a line start', () => {
  for (const budget of [1, 7, 40, 200, 1000, 100_000]) {
    const ends = cuts(SAMPLE, budget);
    assert.equal(ends.at(-1), SAMPLE.length);
    let joined = '';
    let from = 0;
    for (const end of ends) {
      assert.ok(end === SAMPLE.length || SAMPLE[end - 1] === '\n', `cut mid-line at ${end}`);
      joined += SAMPLE.slice(from, end);
      from = end;
    }
    assert.equal(joined, SAMPLE);
  }
});

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true });
async function render(md) {
  const html = toHtml(await processor.run(processor.parse(normalizeMathDelimiters(md))), { allowDangerousHtml: true });
  return html.replace(/<section data-footnotes[\s\S]*<\/section>/, '').trimEnd();
}

test('the start of the text, with the definitions after it appended, renders as it does inside the whole text', async () => {
  const whole = await render(SAMPLE);
  const ends = cuts(SAMPLE, 1);
  assert.ok(ends.length > 10, `only ${ends.length} cuts in the sample`);
  for (const end of ends) {
    const start = SAMPLE.slice(0, end);
    const shown = await render(`${start}\n\n${definitionsAfter(SAMPLE, end)}`);
    assert.ok(whole.startsWith(shown), `cut at ${end} (${JSON.stringify(SAMPLE.slice(end, end + 30))}) renders differently`);
  }
  // - the references early in the text render as footnote links, not as [^a]
  const end = ends.find(e => e > SAMPLE.indexOf('[^a]'));
  const first = await render(`${SAMPLE.slice(0, end)}\n\n${definitionsAfter(SAMPLE, end)}`);
  assert.ok(first.includes('data-footnote-ref') && !first.includes('[^a]'));
});

test('definitionsAfter returns the footnote and link definitions after the cut with their continuation lines', () => {
  const at = SAMPLE.indexOf('Closing paragraph');
  assert.equal(definitionsAfter(SAMPLE, at), [
    '[site]: https://example.com "Example"',
    '[^a]:    The first note.\n    Its second line.',
    '[^b]: The second note,\ncontinued lazily.',
  ].join('\n\n'));
  assert.equal(definitionsAfter(SAMPLE, SAMPLE.length), '');
});

test('definitionsAfter leaves out definitions inside a fenced block, and prose that only looks like one', () => {
  const text = 'start\n\n```\n[^x]: not a definition\n```\n\n[1]: see above for details\n\n[^y]: a real one\n';
  assert.equal(definitionsAfter(text, 0), '[^y]: a real one');
  assert.equal(definitionsAfter('just prose\n', 0), '');
});
