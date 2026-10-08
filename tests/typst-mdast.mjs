// - run: npx esbuild src/extension/typst-mdast.ts --bundle --format=esm --outfile=tests/.build/typst-mdast.mjs && node --test tests/typst-mdast.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { renderTypstSpans } from './.build/typst-mdast.mjs';

// - markdown-html.ts parses any text holding a % with this processor (buildProcessor)
const proc = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const compile = (body, block) => (block ? `<typst-block>${body}</typst-block>` : `<typst>${body}</typst>`);

function render(md) {
  const tree = proc.parse(md);
  renderTypstSpans(tree, md, compile);
  return tree;
}

const shape = (n) =>
  n.type === 'text' ? { text: n.value }
  : n.type === 'html' ? { html: n.value }
  : n.children ? { [n.type]: n.children.map(shape) }
  : { [n.type]: n.value ?? null };

const para = (md) => shape(render(md).children[0]).paragraph;

test('the user line: a span split by _i (z_ emphasis renders whole with the raw body', () => {
  assert.deepEqual(para('text %op("cov")_i (z_(i,t)^k, r_(i,t))% end'), [
    { text: 'text ' },
    { html: '<typst>op("cov")_i (z_(i,t)^k, r_(i,t))</typst>' },
    { text: ' end' },
  ]);
});

test('a span holding *a* (emphasis) or **a** (strong) renders whole', () => {
  assert.deepEqual(para('see %x *a* y% now'), [
    { text: 'see ' }, { html: '<typst>x *a* y</typst>' }, { text: ' now' },
  ]);
  assert.deepEqual(para('see %x **a** y% now'), [
    { text: 'see ' }, { html: '<typst>x **a** y</typst>' }, { text: ' now' },
  ]);
});

test('an opening % inside emphasis keeps the part of the emphasis before it', () => {
  assert.deepEqual(para('*word %x*1% after'), [
    { emphasis: [{ text: 'word ' }] }, { html: '<typst>x*1</typst>' }, { text: ' after' },
  ]);
});

test('a closing % inside strong keeps the part of the strong after it', () => {
  assert.deepEqual(para('%a **b% c**'), [
    { html: '<typst>a **b</typst>' }, { strong: [{ text: ' c' }] },
  ]);
});

test('a span inside one text node renders as before', () => {
  assert.deepEqual(para('area is %pi r^2% today'), [
    { text: 'area is ' }, { html: '<typst>pi r^2</typst>' }, { text: ' today' },
  ]);
});

test('percent escapes in a link url are untouched, and a span after the link still renders', () => {
  const tree = render('[x](http://a.com/%20b%20c)');
  assert.deepEqual(shape(tree.children[0]).paragraph, [{ link: [{ text: 'x' }] }]);
  assert.equal(tree.children[0].children[0].url, 'http://a.com/%20b%20c');
  assert.deepEqual(para('see [x](http://a.com/%20b) and %y%'), [
    { text: 'see ' }, { link: [{ text: 'x' }] }, { text: ' and ' }, { html: '<typst>y</typst>' },
  ]);
});

test('% inside inline code is untouched, and a span may not cross inline code or inline math', () => {
  assert.deepEqual(para('`50%` and `x%`'), [
    { inlineCode: '50%' }, { text: ' and ' }, { inlineCode: 'x%' },
  ]);
  assert.deepEqual(para('code `%a` and b%'), [
    { text: 'code ' }, { inlineCode: '%a' }, { text: ' and b%' },
  ]);
  assert.deepEqual(para('%a `b` c%'), [{ text: '%a ' }, { inlineCode: 'b' }, { text: ' c%' }]);
  assert.deepEqual(para('%a $x$ b%'), [{ text: '%a ' }, { inlineMath: 'x' }, { text: ' b%' }]);
});

test('real emphasis next to a span stays emphasis', () => {
  assert.deepEqual(para('_word_ %x_1%'), [
    { emphasis: [{ text: 'word' }] }, { text: ' ' }, { html: '<typst>x_1</typst>' },
  ]);
});

test('two spans in one paragraph, one split by emphasis and one not', () => {
  assert.deepEqual(para('%a *b* c% and %d%'), [
    { html: '<typst>a *b* c</typst>' }, { text: ' and ' }, { html: '<typst>d</typst>' },
  ]);
});

test('a split span renders in a heading, a table cell and a list item', () => {
  assert.deepEqual(shape(render('## see %a *b* c% end').children[0]).heading, [
    { text: 'see ' }, { html: '<typst>a *b* c</typst>' }, { text: ' end' },
  ]);
  const table = render('| h |\n|---|\n| %a *b* c% |').children[0];
  assert.deepEqual(shape(table.children[1].children[0]).tableCell, [{ html: '<typst>a *b* c</typst>' }]);
  const item = render('- x %a *b* c%').children[0].children[0].children[0];
  assert.deepEqual(shape(item).paragraph, [{ text: 'x ' }, { html: '<typst>a *b* c</typst>' }]);
});

test('a single-line %%..%% split by emphasis renders as a block', () => {
  assert.deepEqual(para('%%sum *x* y%%'), [{ html: '<typst-block>sum *x* y</typst-block>' }]);
});

test('a split %%..%% across lines is left alone', () => {
  assert.deepEqual(para('%%a *b*\nc%%'), [{ text: '%%a ' }, { emphasis: [{ text: 'b' }] }, { text: '\nc%%' }]);
});

test('two split spans sharing a text node, and a split span inside emphasis', () => {
  assert.deepEqual(para('%a *b* c% x %d *e* f%'), [
    { html: '<typst>a *b* c</typst>' }, { text: ' x ' }, { html: '<typst>d *e* f</typst>' },
  ]);
  assert.deepEqual(para('*%a _b_ c% d*'), [{ emphasis: [{ html: '<typst>a _b_ c</typst>' }, { text: ' d' }] }]);
});

test('escaped characters around a split span keep their markdown reading outside it', () => {
  assert.deepEqual(para('a \\* b %x *y* z% \\_w'), [
    { text: 'a * b ' }, { html: '<typst>x *y* z</typst>' }, { text: ' _w' },
  ]);
});

test('prose percentages stay text, and a span next to them still renders', () => {
  assert.deepEqual(para('Mean simulated bias: about **4.5%** relative and **6.4%** risk.'), [
    { text: 'Mean simulated bias: about ' }, { strong: [{ text: '4.5%' }] }, { text: ' relative and ' },
    { strong: [{ text: '6.4%' }] }, { text: ' risk.' },
  ]);
  assert.deepEqual(para('vol 19.84% and 14.64%; Where %z_(i,t)^k% - actually factor %f_(i,t)^k% made'), [
    { text: 'vol 19.84% and 14.64%; Where ' }, { html: '<typst>z_(i,t)^k</typst>' },
    { text: ' - actually factor ' }, { html: '<typst>f_(i,t)^k</typst>' }, { text: ' made' },
  ]);
});
