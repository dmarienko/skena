// - run: npx esbuild src/shared/markdownCodeBlocks.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownCodeBlocks.mjs && node --test tests/markdown-code-blocks.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHighlighter } from 'shiki';
import { FACTORS_THEME, highlightCodeBlocks } from './.build/markdownCodeBlocks.mjs';

const hl = await createHighlighter({ themes: [FACTORS_THEME], langs: ['python'] });

test('1. a fenced python block becomes shiki html in the factors palette; the text around it is kept', () => {
  const html = '<p>before</p>\n<pre><code class="language-py">def f(x):\n    return x &lt; 1\n</code></pre>\n<p>after</p>';
  const out = highlightCodeBlocks(html, hl);
  assert.ok(out.startsWith('<p>before</p>\n<pre class="shiki factors"'));
  assert.ok(out.endsWith('</pre>\n<p>after</p>'));
  assert.ok(out.includes('color:#4CC8A0'));   // - the keyword def
  assert.ok(out.includes('&#x3C;') || out.includes('&lt;'));   // - the < is still escaped
});

test('2. a block in a language the highlighter has not loaded, and html with no block, are unchanged', () => {
  const rust = '<pre><code class="language-rust">fn main() {}</code></pre>';
  assert.equal(highlightCodeBlocks(rust, hl), rust);
  assert.equal(highlightCodeBlocks('<p>plain</p>', hl), '<p>plain</p>');
});
