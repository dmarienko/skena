/**
 * A code cell's lines as static HTML, drawn from the parts the canvas preview (CodeCellPreview) is
 * drawn from: the shiki code theme's tokens, Monaco's bracket colours by nesting pair, the IPython
 * magic decoration, and a line-number gutter. Pure, given a tokenizer.
 */

import { codeRunStyle, opaqueColor, tokenizeCodeLines, type CodeTokenizer } from '../../webview/canvas/codeCellShiki';
import { LINE_NUMBERS_MIN_CHARS, bracketColor, magicRange, splitRuns, tokenBracketLevels, type RunStyle } from '../../webview/canvas/codeCellView';
import { escapeHtml } from './html';

function runCss(s: RunStyle): string {
  const css: string[] = [];
  if (s.color) css.push(`color:${s.color}`);
  if (s.italic) css.push('font-style:italic');
  if (s.bold) css.push('font-weight:bold');
  const deco = [s.underline && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  return css.join(';');
}

/**
 * `code` as a <pre>: one row per line, its number first, then its runs. `bg` is the editor
 * background a colour with alpha is mixed over; `dark` picks Monaco's bracket colours.
 */
export function codeCellHtml(code: string, tok: CodeTokenizer, bg: string, dark: boolean): string {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const tokens = tokenizeCodeLines(tok, lines);
  const brackets = new Map<number, Map<number, string>>();
  for (const mark of tokenBracketLevels(lines, tokens)) {
    let row = brackets.get(mark.line);
    if (!row) brackets.set(mark.line, row = new Map());
    row.set(mark.col, bracketColor(mark, dark));
  }
  const digits = Math.max(String(lines.length).length, LINE_NUMBERS_MIN_CHARS);
  const rows = lines.map((line, i) => {
    const runs = splitRuns(line, tokens[i].map(t => ({ offset: t.offset, style: codeRunStyle(t, bg) })), brackets.get(i), magicRange(line));
    const text = runs.map(r => `<span${r.magic ? ' class="skena-magic"' : ''} style="${runCss(r.style)}">${escapeHtml(r.text)}</span>`).join('');
    return `<span class="skena-export-ln">${i + 1}</span>${text}`;
  });
  return `<pre class="skena-export-code" style="color:${opaqueColor(tok.fg, bg)};--skena-export-gutter:${digits}ch">${rows.join('\n')}</pre>`;
}
