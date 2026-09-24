// - run: npx esbuild src/extension/settingsJson.ts --bundle --platform=node --format=esm --main-fields=module,main --outfile=tests/.build/settingsJson.mjs && node --test tests/settings-json.mjs
// - jsonc-parser's package.json "main" points at a UMD build whose wrapper require() esbuild
//   cannot statically resolve for ESM output ("Dynamic require ... not supported"); --main-fields
//   makes esbuild prefer the "module" (real ESM) build instead.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseSettingsJson } from './.build/settingsJson.mjs';

test('parseSettingsJson keeps URL string values intact past // line comments and block comments', () => {
  const raw = `{
    // a line comment
    "hubUrl": "http://127.0.0.1:8000/some/path", // trailing comment
    /* a block
       comment */
    "url": "http://kb-server:8788/mcp",
    "note": "see http://example.com/docs for details",
    "trailing": [1, 2, 3,],
  }`;
  const out = parseSettingsJson(raw);
  assert.equal(out.hubUrl, 'http://127.0.0.1:8000/some/path');
  assert.equal(out.url, 'http://kb-server:8788/mcp');
  assert.equal(out.note, 'see http://example.com/docs for details');
  assert.deepEqual(out.trailing, [1, 2, 3]);
});

test('parseSettingsJson throws on an unterminated object', () => {
  assert.throws(() => parseSettingsJson('{ "a": 1'));
});

test('parseSettingsJson throws on a top-level array', () => {
  assert.throws(() => parseSettingsJson('[1, 2, 3]'));
});
