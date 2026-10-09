// - run: npx esbuild src/shared/mathDelims.ts --bundle --format=esm --outfile=tests/.build/mathDelims.mjs && npx esbuild src/webview/canvas/textWindow.ts --bundle --format=esm --outfile=tests/.build/textWindow.mjs && node --test tests/math-normalize.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import { toHtml } from 'hast-util-to-html';
import { normalizeDisplayMath, normalizeMath } from './.build/mathDelims.mjs';
import { chunkEnd, definitionsAfter } from './.build/textWindow.mjs';

const lines = (...ls) => ls.join('\n');

// - every input the tests below use, for the idempotence check
const seen = [];
function norm(md) {
  seen.push(md);
  return normalizeDisplayMath(md);
}

const mdast = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
function blocks(md) {
  const tree = mdast.runSync(mdast.parse(md));
  const text = n => (n.value ?? '') + (n.children ?? []).map(text).join('');
  return tree.children.filter(n => n.type !== 'footnoteDefinition').map(n => `${n.type}:${text(n)}`);
}

// - a footnote mark glued to the first opening $$, then two more blocks
const PAPER = lines(
  '# Paper', '', 'where', '', '[^1]$$', 'a = 1 .', '$$', '',
  'Here $m$ is the window.', '', '$$', 'b = 2', '$$', 'where $b$ is fixed, obtained from', '$$', 'c = 3', '$$', '',
  'The end.', '', '[^1]: A note.', '',
);

test('a footnote mark glued to the opening $$ goes on its own line', () => {
  assert.equal(
    norm(lines('where', '', '[^1]$$', 'a = b + c', '$$', '', 'after')),
    lines('where', '', '[^1]', '$$', 'a = b + c', '$$', '', 'after'),
  );
  // - any text, and a closing line with text after it
  assert.equal(
    norm(lines('given by $$', 'a = 1', '$$ where a is fixed.')),
    lines('given by', '$$', 'a = 1', '$$', 'where a is fixed.'),
  );
});

test('text glued to the closing $$ goes on its own line', () => {
  assert.equal(
    norm(lines('$$', 'a = b .$$', '', 'after')),
    lines('$$', 'a = b .', '$$', '', 'after'),
  );
});

test('$$text opening a block, and $$text closing one, are split', () => {
  // - remark-math drops the text after an opening $$; split, it is the first line of the math
  assert.equal(
    norm(lines('$$-\\log P', '=-\\sum_k s_k', '$$')),
    lines('$$', '-\\log P', '=-\\sum_k s_k', '$$'),
  );
  assert.equal(
    norm(lines('$$', 'a = 1', '$$, where $a$ is fixed.', '', 'after')),
    lines('$$', 'a = 1', '$$', ', where $a$ is fixed.', '', 'after'),
  );
  // - text on both ends
  assert.equal(
    norm(lines('$$x', 'y$$', '', 'after')),
    lines('$$', 'x', 'y', '$$', '', 'after'),
  );
});

test('a balanced $$a$$ inside a sentence is left alone', () => {
  const md = lines('text $$a$$ more', '', 'and $$b$$ with $$c$$', '$$', 'x', '$$', '');
  assert.equal(norm(md), md);
  // - nor is one that spans two lines of a paragraph
  const two = lines('see $$a', 'b$$ here', '', '$$', 'c', '$$', '');
  assert.equal(norm(two), two);
});

test('a paragraph that is one line of $$…$$ becomes $$, the body and $$ on three lines', () => {
  assert.equal(
    norm(lines('before', '', '$$f_{nt}=r_{nt}-R_t^M, \\tag{2}$$', '', 'after')),
    lines('before', '', '$$', 'f_{nt}=r_{nt}-R_t^M, \\tag{2}', '$$', '', 'after'),
  );
  // - the whole text, spaces inside the delimiters and after the closing one
  assert.equal(norm('$$ a = 1 $$  '), lines('$$', 'a = 1', '$$  '));
  // - after a heading, with up to three spaces before it, and right before a $$ block
  assert.equal(
    norm(lines('## Model', '   $$a$$', '$$', 'b', '$$')),
    lines('## Model', '   $$', '   a', '   $$', '$$', 'b', '$$'),
  );
  // - in a list item, after a fence and after a $$ block
  assert.equal(
    norm(lines('- item', '', '  $$a$$', '', '```', 'x', '```', '$$b$$', '$$', 'c', '$$', '$$d$$')),
    lines('- item', '', '  $$', '  a', '  $$', '', '```', 'x', '```', '$$', 'b', '$$', '$$', 'c', '$$', '$$', 'd', '$$'),
  );
  // - an escaped \$ in the body stays in the body
  assert.equal(norm('$$\\$5 \\tag{1}$$'), lines('$$', '\\$5 \\tag{1}', '$$'));
  // - CRLF line ends are kept
  assert.equal(norm('a\r\n\r\n$$x \\tag{1}$$\r\n\r\nb'), 'a\r\n\r\n$$\r\nx \\tag{1}\r\n$$\r\n\r\nb');
});

test('a one-line $$…$$ that shares its paragraph or its line, or sits in code, a quote or %%, is left alone', () => {
  for (const md of [
    lines('where', '$$a$$', ''),
    lines('$$a$$', 'where a is fixed', ''),
    lines('$$a$$', '$$b$$', ''),
    lines('$$a$$ $$b$$', ''),
    lines('$$a$$ where', ''),
    // - a setext heading
    lines('$$a$$', '---', ''),
    lines('- $$a$$', ''),
    lines('> $$a$$', ''),
    lines('    $$a$$', ''),
    lines('`$$a$$`', ''),
    lines('```', '$$a$$', '```', ''),
    lines('%%', '$$a$$', '%%', ''),
    lines('\\$$a$$', ''),
    lines('$$a\\$$', ''),
    lines('$$ $$', ''),
  ]) assert.equal(norm(md), md);
});

const katex = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype).use(rehypeKatex, { output: 'mathml', throwOnError: false });
async function katexHtml(md) {
  return toHtml(await katex.run(katex.parse(normalizeMath(md))));
}
const count = (s, re) => (s.match(re) ?? []).length;

test('a \\tag in a one-line $$…$$ paragraph renders as a display equation', async () => {
  const md = lines(
    'Excess returns', '', '$$f_{nt}=r_{nt}-R_t^M, \\tag{2}$$', '',
    '$$\\lambda_t(k)=\\frac{1}{M}\\sum_m\\frac{\\tilde\\sigma_{mt}(k)}{\\sigma_{mt}(k)},\\qquad \\lambda(k)=\\frac{1}{T}\\sum_t\\lambda_t(k). \\tag{10–11}$$',
    '', 'where $M$ is the number of draws.',
  );
  const html = await katexHtml(md);
  assert.equal(count(html, /katex-error/g), 0);
  assert.equal(count(html, /<math[^>]*display="block"/g), 2);
  assert.equal(count(html, /<math(?![^>]*display="block")/g), 1);
  // - CRLF reads as LF
  assert.deepEqual(blocks(normalizeMath(md.replace(/\n/g, '\r\n'))), blocks(normalizeMath(md)));
});

test('$ math is left alone', () => {
  const md = lines('cost $x$ and $y$,', 'then $z$.', '$$', 'w', '$$', '');
  assert.equal(norm(md), md);
});

test('an escaped \\$ is no $$ run', () => {
  for (const md of [
    lines('paid \\$\\$', '$$', 'x', '$$', ''),
    lines('paid \\$$', '$$', 'x', '$$', ''),
    lines('$$', 'x = 5\\$$', 'y', '$$', ''),
  ]) assert.equal(norm(md), md);
});

test('$$ in code is left alone', () => {
  for (const md of [
    lines('```', 'a$$', '$$b', '```', '', '$$', 'x', '$$', ''),
    lines('~~~tex', '[^1]$$', 'x', '$$', '~~~', ''),
    lines('use `x$$`', '$$', 'y', '$$', ''),
    lines('%%', 'a$$', '%%', ''),
  ]) assert.equal(norm(md), md);
});

test('a $$ glued to text in a quote, a heading or indented code is left alone', () => {
  for (const md of [
    lines('> q $$', '$$', 'x', '$$', ''),
    lines('# Title $$', '$$', 'x', '$$', ''),
    lines('    code$$', '$$', 'x', '$$', ''),
    // - no line after the paragraph that could close the block
    lines('price 5$$', '', 'next', ''),
  ]) assert.equal(norm(md), md);
});

test('a CRLF text reads as the LF one does', () => {
  // - the block closes on `$$\r`, so the pair of $$ across the next two lines is left alone
  const md = lines('$$', 'x', '$$', '', 'see $$a', 'b$$', '').replace(/\n/g, '\r\n');
  assert.equal(norm(md), md);
  assert.deepEqual(blocks(normalizeMath(PAPER.replace(/\n/g, '\r\n'))), blocks(normalizeMath(PAPER)));
});

// - normalizeMath, with the input kept for the idempotence check
function normAll(md) {
  seen.push(md);
  return normalizeMath(md);
}

test('a \\$ inside $…$ math becomes a dollar sign written with no $', () => {
  assert.equal(normAll('costs $\\$5$ each'), 'costs ${\\char"24}5$ each');
  assert.equal(normAll('$x + \\$y$'), '$x + {\\char"24}y$');
  // - a formula over two lines of a paragraph, and one right after an escaped dollar in prose
  assert.equal(normAll(lines('from $a +', '\\$5$ on', '')), lines('from $a +', '{\\char"24}5$ on', ''));
  assert.equal(normAll('paid \\$$\\$5$'), 'paid \\$${\\char"24}5$');
  // - in a heading, a list item and a table cell
  assert.equal(normAll(lines('# Cost $\\$5$', '- $\\$6$', '')), lines('# Cost ${\\char"24}5$', '- ${\\char"24}6$', ''));
  assert.equal(
    normAll(lines('| a | b |', '|---|---|', '| $\\$5$ | c |', '')),
    lines('| a | b |', '|---|---|', '| ${\\char"24}5$ | c |', ''),
  );
});

test('a \\$ inside $$ math becomes a dollar sign written with no $', () => {
  assert.equal(normAll(lines('before', '', '$$a \\$ b$$', '', 'after')), lines('before', '', '$$', 'a {\\char"24} b', '$$', '', 'after'));
  assert.equal(normAll('see $$a \\$ b$$ here'), 'see $$a {\\char"24} b$$ here');
  assert.equal(
    normAll(lines('$$', 'c = \\$5 + \\$6', '\\$7', '$$', '')),
    lines('$$', 'c = {\\char"24}5 + {\\char"24}6', '{\\char"24}7', '$$', ''),
  );
  // - CRLF line ends
  assert.equal(
    normAll('a $\\$5$\r\n\r\n$$\r\n\\$6\r\n$$\r\n'),
    'a ${\\char"24}5$\r\n\r\n$$\r\n{\\char"24}6\r\n$$\r\n',
  );
});

test('a \\$ outside math, or in code, a fence or %%, is left alone', () => {
  for (const md of [
    'costs \\$5 and \\$6',
    lines('costs \\$5 and', '\\$6 more', ''),
    'use `$\\$5$` here',
    lines('```', '$\\$5$', '```', ''),
    lines('%%', '$\\$5$', '%%', ''),
    lines('    $\\$5$', ''),
    // - each cell of a table is read alone, so no math spans these
    lines('| a | b | c |', '|---|---|---|', '| $x | \\$5 | y$ |', ''),
  ]) assert.equal(normAll(md), md);
  // - only the \$ in the math changes
  assert.equal(normAll('costs \\$5, or $\\$6$, or \\$7'), 'costs \\$5, or ${\\char"24}6$, or \\$7');
});

test('a $$ inline formula at the start of a line keeps the \\$ that stops the line opening a $$ block', () => {
  const md = lines('$$\\$5 + x', 'y$$ more', '');
  assert.deepEqual(blocks(normAll(md)), blocks(md));
  assert.deepEqual(blocks(md), ['paragraph:\\$5 + x\ny more']);
});

const katexOut = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype).use(rehypeKatex, { output: 'html', throwOnError: false });

test('$ math holding \\$ renders the dollar sign with no KaTeX error, in MathML and in HTML', async () => {
  const md = lines(
    'in excess of $\\$ 100$ billion, roughly \\$5 billion', '',
    '| x | y |', '|---|---|', '| $\\Delta \\mathrm{SR} / \\$ \\mathrm{~B}$ | \\$B |', '',
    '$$', 'c = \\$5', '$$', '',
  );
  // - as written, the $ of a \$ closes the formula
  assert.ok(count(toHtml(await katex.run(katex.parse(md))), /katex-error/g) > 0);
  const mathml = await katexHtml(md);
  const html = toHtml(await katexOut.run(katexOut.parse(normalizeMath(md))));
  for (const out of [mathml, html]) {
    assert.equal(count(out, /katex-error/g), 0);
    assert.equal(count(out, />\$</g), 3);
    assert.ok(out.includes('roughly $5 billion'));
    assert.ok(out.includes('>$B<'));
  }
});

test('applying it twice gives what applying it once does', () => {
  for (const md of seen) {
    const once = normalizeDisplayMath(md);
    assert.equal(normalizeDisplayMath(once), once, JSON.stringify(md));
    assert.equal(normalizeMath(normalizeMath(md)), normalizeMath(md), JSON.stringify(md));
  }
});

test('a glued opening $$ followed by more blocks: every block pairs as written', () => {
  // - as written, remark-math pairs every $$ after the glued one with the wrong one
  assert.notDeepEqual(blocks(PAPER).filter(b => b.startsWith('math:')), ['math:a = 1 .', 'math:b = 2', 'math:c = 3']);
  assert.deepEqual(blocks(normalizeMath(PAPER)), [
    'heading:Paper', 'paragraph:where', 'paragraph:', 'math:a = 1 .',
    'paragraph:Here m is the window.', 'math:b = 2', 'paragraph:where b is fixed, obtained from', 'math:c = 3',
    'paragraph:The end.',
  ]);
});



const html = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true });
async function render(md) {
  const out = toHtml(await html.run(html.parse(normalizeMath(md))), { allowDangerousHtml: true });
  return out.replace(/<section data-footnotes[\s\S]*<\/section>/, '').trimEnd();
}

// - one-line $$…$$ paragraphs, as an exported paper writes its numbered equations
const TAGGED = lines(
  '# Model', '', 'Excess returns', '', '$$f_{nt}=r_{nt}-R_t^M, \\tag{2}$$', '',
  'and their covariance', '$$', 'V = F F\'', '$$', '$$B=\\sqrt{b}. \\tag{5}$$', '', 'The end.[^1]', '', '[^1]: A note.', '',
);

test('the start of the normalized text, cut anywhere, renders as it does inside the whole', async () => {
  for (const md of [PAPER, TAGGED]) {
    const text = normalizeMath(md);
    const whole = await render(text);
    for (let from = 0; from < text.length;) {
      const end = chunkEnd(text, from, 1);
      const shown = await render(`${text.slice(0, end)}\n\n${definitionsAfter(text, end)}`);
      assert.ok(whole.startsWith(shown), `cut at ${end} (${JSON.stringify(text.slice(end, end + 20))})`);
      from = end;
    }
  }
  assert.equal(count(await render(TAGGED), /math-display/g), 3);
});
