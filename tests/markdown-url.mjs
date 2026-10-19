// - run: npx esbuild src/webview/renderers/markdownUrlTransform.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownUrlTransform.mjs && npx esbuild src/extension/markdown-html.ts --bundle --format=esm --platform=node --packages=external --outfile=tests/.build/markdownHtml.mjs && npx esbuild src/shared/markdownHref.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownHref.mjs && node --test tests/markdown-url.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { markdownUrlTransform } from './.build/markdownUrlTransform.mjs';
import { renderMarkdownToHtml } from './.build/markdownHtml.mjs';
import { hrefToOpenTarget } from './.build/markdownHref.mjs';

// - the markdown of a text node as the webview draws it (MarkdownRenderer's url check), and as the host draws it
const webview = (md) => renderToStaticMarkup(createElement(ReactMarkdown, { urlTransform: markdownUrlTransform }, md));
const hrefOf = (html) => /href="([^"]*)"/.exec(html)?.[1].replace(/&amp;/g, '&') ?? null;

test('a vault link with spaces in a text node opens the vault file', () => {
  const href = hrefOf(webview('[note](<vault://crtx/bugs/a b.md>)'));
  assert.equal(hrefToOpenTarget(href), 'vault://crtx/bugs/a b.md');
});

test('a vault link drawn by the host opens the same file', async () => {
  const href = hrefOf(await renderMarkdownToHtml('[note](<vault://crtx/bugs/a b.md>)'));
  assert.equal(hrefToOpenTarget(href), 'vault://crtx/bugs/a b.md');
});

test('a link to a dangerous scheme is still blanked', () => {
  assert.equal(hrefOf(webview('[x](javascript:alert(1))')), '');
  assert.equal(hrefOf(webview('[x](vbscript:msgbox)')), '');
});

test('web links and relative links are kept', () => {
  assert.equal(hrefOf(webview('[w](https://example.com/a?b=1)')), 'https://example.com/a?b=1');
  assert.equal(hrefToOpenTarget(hrefOf(webview('[n](<3.1 Methods Descriptions.canvas#N15>)'))), '3.1 Methods Descriptions.canvas#N15');
});

test('a knowledge server image keeps its own scheme', () => {
  assert.match(webview('![a](crtx://assets/x.png)'), /src="crtx:\/\/assets\/x.png"/);
});
