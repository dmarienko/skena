/**
 * CodeCellPreview — the read-only view of a code cell, drawn to match its Monaco editor: the same
 * font, line height and line-number column, relative line numbers around the line the cursor opens
 * on, and brackets coloured by nesting pair. Colours come from shiki; code highlighted before under
 * the same theme is drawn in the first render from a cache.
 */

import React, { useMemo } from 'react';
import { useHighlightedCode, type CodeToken } from '../../renderers/CodeRenderer';
import {
  bracketColor, codeGutter, pythonBracketLevels, relativeLineNumbers, scaleAlpha,
  LINE_NUMBER_ACTIVE_COLOR, LINE_NUMBER_COLOR,
} from '../codeCellView';

export interface CodeCellFont { family: string; size: number; lineHeight: number }

// - Monaco reads the platform the same way in a browser; on Linux it dims the number of a final empty line
const IS_LINUX = typeof navigator === 'object' && navigator.userAgent.indexOf('Linux') >= 0;
const LINE_NUMBER_DIMMED_COLOR = scaleAlpha(LINE_NUMBER_COLOR, 0.4);

/** The cell text as the editor splits it into lines. */
export function codeCellLines(code: string): string[] {
  return code.replace(/\r\n?/g, '\n').split('\n');
}

interface CodeCellPreviewProps {
  code:          string;
  language:      string;
  /** - 1-based line the editor's cursor opens on */
  cursorLine:    number;
  font:          CodeCellFont;
  /** - Monaco's measured width of the widest digit in `font` */
  maxDigitWidth: number;
  dark:          boolean;
}

function runStyle(t: CodeToken): React.CSSProperties {
  return {
    color:          t.color,
    fontStyle:      t.italic ? 'italic' : undefined,
    fontWeight:     t.bold ? 'bold' : undefined,
    textDecoration: t.underline ? 'underline' : undefined,
  };
}

// - the line's runs, with each coloured bracket split out into its own span
function lineRuns(line: string, tokens: CodeToken[] | undefined, brackets: Map<number, string> | undefined): React.ReactNode[] {
  const runs = tokens && tokens.map(t => t.content).join('') === line ? tokens : [{ content: line, italic: false }];
  const out: React.ReactNode[] = [];
  let col = 0;
  runs.forEach((t, ti) => {
    const style = runStyle(t);
    let start = 0;
    if (brackets) {
      for (let i = 0; i < t.content.length; i++) {
        const color = brackets.get(col + i);
        if (color === undefined) continue;
        if (i > start) out.push(<span key={`${ti}.${start}`} style={style}>{t.content.slice(start, i)}</span>);
        out.push(<span key={`${ti}.${i}`} style={{ ...style, color }}>{t.content[i]}</span>);
        start = i + 1;
      }
    }
    if (start < t.content.length) out.push(<span key={`${ti}.${start}`} style={style}>{t.content.slice(start)}</span>);
    col += t.content.length;
  });
  return out;
}

export function CodeCellPreview({ code, language, cursorLine, font, maxDigitWidth, dark }: CodeCellPreviewProps): JSX.Element {
  const lines = useMemo(() => codeCellLines(code), [code]);
  const text = useMemo(() => lines.join('\n'), [lines]);
  const bracketsByLine = useMemo(() => {
    const byLine = new Map<number, Map<number, string>>();
    for (const mark of pythonBracketLevels(lines)) {
      let row = byLine.get(mark.line);
      if (!row) byLine.set(mark.line, row = new Map());
      row.set(mark.col, bracketColor(mark, dark));
    }
    return byLine;
  }, [lines, dark]);
  const numbers = useMemo(() => relativeLineNumbers(lines.length, cursorLine), [lines.length, cursorLine]);
  const highlighted = useHighlightedCode(text, language);
  const { lineNumbersWidth, contentLeft } = codeGutter(lines.length, maxDigitWidth);
  const current = Math.min(Math.max(1, Math.floor(cursorLine) || 1), lines.length);
  const lastIsEmpty = lines[lines.length - 1] === '';

  return (
    <div
      className="skena-code-cell-lines"
      style={{
        // - the font settings Monaco applies to its lines (fontLigatures on → liga + calt)
        fontFamily:          font.family,
        fontSize:            font.size,
        lineHeight:          `${font.lineHeight}px`,
        fontWeight:          'normal',
        letterSpacing:       0,
        fontFeatureSettings: '"liga" on, "calt" on',
        whiteSpace:          'pre',
        tabSize:             4,
        color:               highlighted?.fg ?? 'var(--vscode-editor-foreground)',
      }}
    >
      {lines.map((line, i) => {
        const isCurrent = i + 1 === current;
        const numberColor = IS_LINUX && lastIsEmpty && i === lines.length - 1
          ? LINE_NUMBER_DIMMED_COLOR
          : isCurrent ? LINE_NUMBER_ACTIVE_COLOR : LINE_NUMBER_COLOR;
        return (
          <div key={i} data-line={i} style={{ position: 'relative', height: font.lineHeight, paddingLeft: contentLeft }}>
            <span
              className="skena-code-cell-ln"
              style={{
                position: 'absolute', left: 0, top: 0, width: lineNumbersWidth,
                // - Monaco left-aligns the cursor line's own number and right-aligns the distances
                textAlign: isCurrent ? 'left' : 'right',
                color: numberColor, fontVariantNumeric: 'tabular-nums', userSelect: 'none',
              }}
            >{numbers[i]}</span>
            {lineRuns(line, highlighted?.lines[i], bracketsByLine.get(i))}
          </div>
        );
      })}
    </div>
  );
}

function textRect(node: Node, start: number, end: number): DOMRect {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range.getBoundingClientRect();
}

/** Screen rect of the first non-blank character under `lineEl`, skipping text inside `skip`. */
export function firstGlyphRect(lineEl: Element, skip?: Element | null): DOMRect | null {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (skip && skip.contains(n)) continue;
    const s = n.textContent ?? '';
    const i = s.search(/[^\s ]/);
    if (i >= 0) return textRect(n, i, i + 1);
  }
  return null;
}

/** Screen rect of the first non-empty text inside `el` (the glyphs, not the box of an element around them). */
export function textContentRect(el: Element): DOMRect | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (len > 0) return textRect(n, 0, len);
  }
  return null;
}

/** Screen rects of the first code glyph and of the line number on 0-based `line` of a preview under `root`. */
export function previewLineRects(root: Element, line: number): { glyph: DOMRect | null; number: DOMRect | null } {
  const lineEl = root.querySelector(`.skena-code-cell-lines > [data-line="${line}"]`);
  if (!lineEl) return { glyph: null, number: null };
  const num = lineEl.querySelector('.skena-code-cell-ln');
  return { glyph: firstGlyphRect(lineEl, num), number: num ? textContentRect(num) : null };
}
