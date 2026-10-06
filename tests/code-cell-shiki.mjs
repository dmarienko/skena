// - run: npx esbuild src/webview/canvas/codeCellShiki.ts --bundle --format=esm --platform=node --outfile=tests/.build/codeCellShiki.mjs && npx esbuild src/webview/canvas/codeCellMonaco.ts --bundle --format=esm --platform=node --outfile=tests/.build/codeCellMonaco.mjs && npx esbuild src/webview/canvas/codeCellView.ts --bundle --format=esm --outfile=tests/.build/codeCellView.mjs && node --test tests/code-cell-shiki.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHighlighter, bundledThemes } from 'shiki';
import {
  resolveCodeTheme, codeTokenizer, tokenizeCodeLines, codeRunStyle, codeTokenName, codeTokenRules, codeTokensProvider,
  shikiCodeTheme, opaqueColor,
} from './.build/codeCellShiki.mjs';
import { skenaCodeTheme, tokenStyler } from './.build/codeCellMonaco.mjs';
import { tokenBracketLevels } from './.build/codeCellView.mjs';

const SAMPLE = readFileSync(new URL('./fixtures/code-cell-sample.py', import.meta.url), 'utf8');
// - a triple-quoted string with an empty line inside, and code after it
const DOCSTRING = 'def f():\n    s = """one\n\n    two (x]"""\n    return s  # done (\n';
const BLACK = '#000000';
const hl = await createHighlighter({ themes: ['ayu-dark', 'dark-plus'], langs: ['python'] });
const lines = text => text.replace(/\r\n?/g, '\n').split('\n');

// - ayu-dark's two colours with alpha in the sample, worked out by hand over black (channel × alpha / 255)
const AYU_OVER_BLACK = { '#acb6bf8c': '#5e6469', '#bfbdb6b3': '#868580' };

// - the colour and font style at every character of a line, from runs that start at `offset`
function perChar(line, runs) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    let k = 0;
    while (k + 1 < runs.length && runs[k + 1].offset <= i) k++;
    out.push(runs[k].style);
  }
  return out;
}

test('1. skena.code.theme: a shiki theme id is kept, factors is kept, anything else is ayu-dark', () => {
  const ids = Object.keys(bundledThemes);
  assert.equal(resolveCodeTheme('tokyo-night', ids), 'tokyo-night');
  assert.equal(resolveCodeTheme('ayu-dark', ids), 'ayu-dark');
  assert.equal(resolveCodeTheme('factors', ids), 'factors');
  assert.equal(resolveCodeTheme('no-such-theme', ids), 'ayu-dark');
  assert.equal(resolveCodeTheme('', ids), 'ayu-dark');
  assert.equal(resolveCodeTheme(undefined, ids), 'ayu-dark');
  assert.equal(resolveCodeTheme(42, ids), 'ayu-dark');
});

test('2. a colour with alpha is drawn as the colour it shows over the background; an opaque one as itself', () => {
  assert.equal(opaqueColor('#FF8F40', BLACK), '#ff8f40');
  assert.equal(opaqueColor('#ACB6BF8C', BLACK), '#5e6469');
  assert.equal(opaqueColor('#ff000080', '#0000ff'), '#80007f');
});

test('3. the preview colours each character as shiki codeToTokens does (ayu-dark, over black)', () => {
  for (const code of [SAMPLE, DOCSTRING]) {
    const tok = codeTokenizer(hl, 'ayu-dark');
    const src = lines(code);
    const mine = tokenizeCodeLines(tok, src);
    const ref = hl.codeToTokens(code, { lang: 'python', theme: 'ayu-dark' }).tokens;
    assert.equal(mine.length, ref.length);
    let checked = 0;
    src.forEach((line, i) => {
      const lineStart = ref[i][0]?.offset ?? 0;
      const want = perChar(line, ref[i].map(t => {
        const c = (t.color ?? '#bfbdb6').toLowerCase();
        const color = c.length === 9 ? AYU_OVER_BLACK[c] : c;
        assert.ok(color, `no hand-worked value for ${c}`);
        return { offset: t.offset - lineStart, style: { color, italic: (t.fontStyle & 1) !== 0, bold: (t.fontStyle & 2) !== 0 } };
      }));
      const got = perChar(line, mine[i].map(t => {
        const s = codeRunStyle(t, BLACK);
        return { offset: t.offset, style: { color: s.color, italic: !!s.italic, bold: !!s.bold } };
      }));
      assert.deepEqual(got, want, `line ${i + 1}: ${line}`);
      checked += line.length;
    });
    assert.ok(checked > 0);
  }
});

test('4. the code theme is set on the shared highlighter for each line, whatever another caller set last', () => {
  const tok = codeTokenizer(hl, 'ayu-dark');
  const src = lines(SAMPLE);
  const alone = tokenizeCodeLines(tok, src);
  let state = null;
  const interleaved = src.map(line => {
    hl.codeToTokens('x = "y"  # z', { lang: 'python', theme: 'dark-plus' });
    const r = tok.tokenizeLine(line, state);
    state = r.endState;
    return r.tokens;
  });
  assert.deepEqual(interleaved, alone);
});

test('5. the editor shows the colours the preview draws: token names through Monaco\'s matching of the skena-code rules', () => {
  const tok = codeTokenizer(hl, 'ayu-dark');
  const theme = shikiCodeTheme(skenaCodeTheme(true, false, BLACK), codeTokenRules(tok.colors, BLACK));
  const styler = tokenStyler(theme);
  const provider = codeTokensProvider(tok);
  for (const code of [SAMPLE, DOCSTRING]) {
    const src = lines(code);
    const preview = tokenizeCodeLines(tok, src);
    let state = provider.getInitialState();
    src.forEach((line, i) => {
      const r = provider.tokenize(line, state);
      state = r.endState;
      const editor = perChar(line, r.tokens.map(t => ({ offset: t.startIndex, style: styler(t.scopes) })));
      const drawn = perChar(line, preview[i].map(t => ({ offset: t.offset, style: codeRunStyle(t, BLACK) })));
      assert.deepEqual(editor, drawn, `line ${i + 1}: ${line}`);
    });
  }
});

test('6. skena-code under a code theme keeps skena\'s editor colours; its token rules are the code theme\'s only', () => {
  const tok = codeTokenizer(hl, 'ayu-dark');
  const ui = skenaCodeTheme(true, true, BLACK);
  const theme = shikiCodeTheme(ui, codeTokenRules(tok.colors, BLACK));
  assert.equal(theme.base, ui.base);
  assert.deepEqual(theme.colors, ui.colors);
  assert.equal(theme.colors['editor.background'], BLACK);
  assert.equal(theme.colors['editorCursor.foreground'], '#f01010');
  assert.ok(theme.rules.length > 0 && theme.rules.every(r => r.token.startsWith('shk.')));
  const styler = tokenStyler(theme);
  const keyword = { offset: 0, color: '#FF8F40', fontStyle: 0, type: 0 };
  const comment = { offset: 0, color: '#ACB6BF8C', fontStyle: 1, type: 1 };
  assert.equal(styler(codeTokenName(keyword)).color, '#ff8f40');
  assert.deepEqual(styler(codeTokenName(comment)), { color: '#5e6469', italic: true, bold: false, underline: false, strikethrough: false });
});

test('7. comment and string tokens are named so Monaco reads them as comment / string (its bracket colouring skips them)', () => {
  const tok = codeTokenizer(hl, 'ayu-dark');
  const [line] = tokenizeCodeLines(tok, ['x = "(" # (']);
  const at = col => codeTokenName(line[line.findLastIndex(t => t.offset <= col)]);
  assert.match(at(5), /\bstring\b/);
  assert.match(at(10), /\bcomment\b/);
  assert.doesNotMatch(at(0), /\b(string|comment|regex)\b/);
});

test('8. brackets from the code theme\'s tokens: those in strings and comments are left out, the rest coloured by depth', () => {
  const tok = codeTokenizer(hl, 'ayu-dark');
  const src = lines(DOCSTRING + 'y = f(a["k(]"], \')\')  # (x]');
  const marks = tokenBracketLevels(src, tokenizeCodeLines(tok, src)).map(b => `${b.line}:${b.col}:${b.invalid ? 'X' : b.level}`);
  assert.deepEqual(marks, ['0:5:0', '0:6:0', '5:5:0', '5:7:1', '5:13:1', '5:19:0']);
});

test('9. an empty line gives the editor one plain token and leaves the tokenizer state as it was', () => {
  const tok = codeTokenizer(hl, 'ayu-dark');
  const provider = codeTokensProvider(tok);
  const first = provider.tokenize('s = """a', provider.getInitialState());
  const empty = provider.tokenize('', first.endState);
  assert.equal(empty.endState, first.endState);
  assert.equal(empty.tokens.length, 1);
  assert.equal(empty.tokens[0].startIndex, 0);
});
