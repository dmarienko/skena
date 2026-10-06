// - run: npx esbuild src/extension/export/markdown.ts --bundle --platform=node --format=esm --outfile=tests/.build/exportMarkdown.mjs --external:@myriaddreamin/typst-ts-node-compiler "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && npx esbuild src/shared/markdownCodeBlocks.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownCodeBlocks.mjs && node --test tests/export-markdown.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHighlighter } from 'shiki';
import { fileMarkdownHtml, nodeMarkdownHtml, rendersOnHost } from './.build/exportMarkdown.mjs';
import { FACTORS_THEME } from './.build/markdownCodeBlocks.mjs';

const hl = await createHighlighter({ themes: [FACTORS_THEME], langs: ['python'] });
const FENCE = '```python\ndef f():\n    pass\n```';

test('1. routing: a % or (factors) a fence goes to the host renderer, as useHostMarkdown routes it', () => {
  assert.equal(rendersOnHost('growth of 5%', false), true);
  assert.equal(rendersOnHost('```py\nx\n```', false), false);
  assert.equal(rendersOnHost('```py\nx\n```', true), true);
  assert.equal(rendersOnHost('$x$', true), false);
});

test('2. math in a text the webview renders comes out as KaTeX HTML', async () => {
  const html = await nodeMarkdownHtml('$x^2$', false, null);
  assert.ok(html.includes('class="katex-html"'));
  assert.ok(!html.includes('<math'));
});

test('3. math in a text the host renders comes out as MathML, Typst as an inline SVG', async () => {
  const html = await nodeMarkdownHtml('$x^2$ and %y^2% at 5', false, null);
  assert.ok(html.includes('<math'));
  assert.ok(html.includes('typst-math'));
});

test('4. a fence is coloured only under the factors theme', async () => {
  assert.ok((await nodeMarkdownHtml(FENCE, true, hl)).includes('<pre class="shiki factors"'));
  assert.ok(!(await nodeMarkdownHtml(FENCE, false, hl)).includes('shiki'));
  assert.ok((await fileMarkdownHtml(FENCE, true, hl)).includes('<pre class="shiki factors"'));
  assert.ok((await fileMarkdownHtml(FENCE, false, hl)).includes('<code class="language-python">'));
});
