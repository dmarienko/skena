// - run: npx esbuild src/shared/markdownHref.ts --bundle --format=esm --platform=node --outfile=tests/.build/markdownHref.mjs && node --test tests/markdown-href.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { micromark } from 'micromark';
import { hrefToOpenTarget } from './.build/markdownHref.mjs';
import { parseNodeRef } from './.build/nodeRef.mjs';

// - the href micromark renders for a link, as the webview gets it from the <a>
const hrefOf = (md) => /href="([^"]*)"/.exec(micromark(md))[1];

test('a link to a node in a canvas whose name has spaces names that canvas', () => {
  const target = hrefToOpenTarget(hrefOf('[N15](<3.1 Methods Descriptions.canvas#N15>)'));
  assert.deepEqual(parseNodeRef(target), { canvas: '3.1 Methods Descriptions.canvas', label: 'N15' });
});

test('a link to a file in a folder with spaces keeps its line', () => {
  assert.equal(hrefToOpenTarget(hrefOf('[f](<my notes/a b.md#L3>)')), 'my notes/a b.md#L3');
});

test('a vault link with spaces is decoded', () => {
  assert.equal(hrefToOpenTarget('vault://crtx/bugs/a%20b.md'), 'vault://crtx/bugs/a b.md');
});

test('a web address is sent as written', () => {
  const href = hrefOf('[w](https://example.com/a%20b?q=1%2B2)');
  assert.equal(hrefToOpenTarget(href), href);
});

test('a name with a % that is not an escape is sent as written', () => {
  assert.equal(hrefToOpenTarget('100% done.md'), '100% done.md');
});

test('a Windows path is decoded, its drive is not taken for a scheme', () => {
  assert.equal(hrefToOpenTarget('C:/notes/a%20b.md'), 'C:/notes/a b.md');
});
