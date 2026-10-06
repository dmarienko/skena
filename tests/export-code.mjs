// - run: npx esbuild src/extension/export/codeHtml.ts --bundle --format=esm --platform=node --outfile=tests/.build/exportCode.mjs && npx esbuild src/webview/canvas/codeCellShiki.ts --bundle --format=esm --platform=node --outfile=tests/.build/codeCellShiki.mjs && node --test tests/export-code.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHighlighter } from 'shiki';
import { codeCellHtml } from './.build/exportCode.mjs';
import { codeTokenizer } from './.build/codeCellShiki.mjs';

// - every line one plain token of one colour, so the test reads the brackets, magic and escaping alone
const plain = {
  theme: 'stub', fg: '#cccccc', colors: ['#cccccc'],
  tokenizeLine: (line, state) => ({ tokens: line ? [{ offset: 0, color: '#aabbcc', fontStyle: 0, type: 0 }] : [], endState: state }),
};

test('1. one numbered row per line; the gutter is at least three digits wide', () => {
  const html = codeCellHtml('a = 1\n\nb = 2', plain, '#000000', true);
  assert.ok(html.startsWith('<pre class="skena-export-code" style="color:#cccccc;--skena-export-gutter:3ch">'));
  assert.equal(html.match(/class="skena-export-ln"/g).length, 3);
  assert.ok(html.includes('<span class="skena-export-ln">3</span><span style="color:#aabbcc">b = 2</span>'));
});

test('2. brackets take Monaco\'s colour for their nesting level; text is escaped', () => {
  const html = codeCellHtml('f(a[0]) < 1', plain, '#000000', true);
  assert.ok(html.includes('<span style="color:#ffd700">(</span>'));
  assert.ok(html.includes('<span style="color:#da70d6">[</span>'));
  assert.ok(html.includes('&lt; 1'));
});

test('3. an IPython magic is marked as the editor marks it', () => {
  assert.ok(codeCellHtml('%time f()', plain, '#000000', true).includes('<span class="skena-magic" style="color:#aabbcc">%time</span>'));
});

test('4. with shiki ayu-dark a keyword has the colour shiki gives it', async () => {
  const hl = await createHighlighter({ themes: ['ayu-dark'], langs: ['python'] });
  const want = hl.codeToTokens('def', { lang: 'python', theme: 'ayu-dark' }).tokens[0][0].color.toLowerCase();
  const html = codeCellHtml('def f():\n    pass', codeTokenizer(hl, 'ayu-dark'), '#000000', true);
  assert.ok(html.includes(`<span style="color:${want}">def</span>`), html.slice(0, 400));
});
