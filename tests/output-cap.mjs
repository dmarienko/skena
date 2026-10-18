// - run: npx esbuild src/shared/outputCap.ts --bundle --format=esm --platform=node --outfile=tests/.build/outputCap.mjs && node --test tests/output-cap.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { capOutputHtml, MAX_OUTPUT_HTML_BYTES } from './.build/outputCap.mjs';

// - an <img> the way renderOutput writes a matplotlib chart, with a base64 payload of `kb` KB
const img = (kb, fill = 'A') => `<img src="data:image/png;base64,${fill.repeat(kb * 1024)}" style="max-width:100%;display:block;margin:6px 0" />`;
const table = '<pre class="skena-out-stream">factor   ic    t\nmom     0.04  2.1\n</pre>';

test('a small table and four charts over the limit in all render whole', () => {
  const html = [table, img(107, 'A'), img(107, 'B'), img(107, 'C'), img(107, 'D')].join('\n');
  assert.ok(html.length > MAX_OUTPUT_HTML_BYTES);
  assert.equal(capOutputHtml(html), html);
});

test('HTML that is large without its images is still cut, and a chart before the cut stays whole', () => {
  const big = `<div>${'<span>x</span>'.repeat(40_000)}</div>`;
  const html = [img(50, 'A'), big].join('\n');
  const out = capOutputHtml(html);
  assert.match(out, /output truncated/);
  assert.ok(out.includes(img(50, 'A')));
  // - the text after the chart is kept up to the limit
  const kept = out.split('<div class="skena-out-truncated">')[0];
  assert.ok(kept.length - img(50, 'A').length >= MAX_OUTPUT_HTML_BYTES - 100, `kept ${kept.length}`);
});

test('a cut never ends inside an image payload', () => {
  const big = '<span>x</span>'.repeat(21_500);   // - ~300 KB on each side of the image
  const html = [big, img(200, 'B'), big].join('\n');
  const out = capOutputHtml(html);
  assert.match(out, /output truncated/);
  const kept = out.split('<div class="skena-out-truncated">')[0];
  // - the image is either kept whole or not at all
  const payload = /data:image\/png;base64,(B*)/.exec(kept)?.[1] ?? '';
  assert.ok(payload.length === 0 || payload.length === 200 * 1024, `kept ${payload.length} payload chars`);
});

test('a table over the row limit is still cut to its first rows', () => {
  const rows = Array.from({ length: 500 }, (_, i) => `<tr><td>${i}</td></tr>`).join('');
  const out = capOutputHtml(`<table><tbody>${rows}</tbody></table>`);
  assert.match(out, /showing first 200 of 500 rows/);
});
