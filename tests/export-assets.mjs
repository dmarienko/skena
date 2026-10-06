// - run: node --test tests/export-assets.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExportAssets } from '../scripts/build-export-assets.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'skena-export-assets-'));
buildExportAssets(ROOT, OUT);
const read = f => readFileSync(join(OUT, f), 'utf8');

test('1. KaTeX: every font face points at its woff2 as a data url, and no file is referenced', () => {
  const css = read('katex.css');
  assert.equal(css.match(/@font-face/g).length, 20);
  assert.equal(css.match(/url\(data:font\/woff2;base64,/g).length, 20);
  assert.ok(!/url\(fonts\//.test(css));
  assert.ok(!/format\("(woff|truetype)"\)/.test(css));
});

test('2. codicons: the font is a data url', () => {
  const css = read('codicon.css');
  assert.ok(css.includes('url(data:font/ttf;base64,'));
  assert.ok(!css.includes('codicon.ttf'));
});

test('3. skena.css holds the canvas, markdown and export rules; the IBM Plex fonts are copied', () => {
  const css = read('skena.css');
  assert.ok(css.includes('.skena-node {'));
  assert.ok(css.includes(':root[data-md-theme="factors"] .skena-markdown {'));
  assert.ok(css.includes('.skena-export-node {'));
  assert.equal(read('ibm-plex.css').match(/@font-face/g).length, 4);
});
