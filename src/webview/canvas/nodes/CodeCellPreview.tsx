/**
 * CodeCellPreview — the read-only view of a code cell, drawn the way its Monaco editor draws the same
 * text: Monaco's python tokenizer and the skena-code theme for the colours, brackets coloured by
 * nesting pair, relative line numbers, indentation guides, and lines laid out like Monaco's view lines
 * (absolutely placed rows inside a translate3d layer, a separate layer for the line numbers).
 */

import React, { useEffect, useMemo, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import {
  bracketColor, codeGutter, magicRange, pythonBracketLevels, relativeLineNumbers, scaleAlpha, splitRuns,
  LINE_NUMBER_ACTIVE_COLOR, LINE_NUMBER_COLOR, type RunStyle,
} from '../codeCellView';
import { codeIndentation, indentGuideColors, indentGuides, skenaCodeTheme, tokenStyler } from '../codeCellMonaco';

export interface CodeCellFont { family: string; size: number; lineHeight: number }

/** Monaco's measured widths for the cell font: the widest digit (line numbers) and a space (guides). */
export interface CodeCellMetrics { maxDigitWidth: number; spaceWidth: number }

// - Monaco reads the platform the same way in a browser; on Linux it dims the number of a final empty
// - line, and gives line numbers of an odd line height a 1px top margin (lh-odd)
const IS_LINUX = typeof navigator === 'object' && navigator.userAgent.indexOf('Linux') >= 0;
const LINE_NUMBER_DIMMED_COLOR = scaleAlpha(LINE_NUMBER_COLOR, 0.4);
// - Monaco's transform on its lines and margin layers (layer hinting)
const LAYER_HINT = 'translate3d(0px, 0px, 0px)';

/** The cell text as the editor splits it into lines. */
export function codeCellLines(code: string): string[] {
  return code.replace(/\r\n?/g, '\n').split('\n');
}

// - Monaco loads its python tokenizer on first request; tokenize() gives plain tokens until then
let pythonReady = false;
let pythonReadyPromise: Promise<void> | null = null;

/** Resolves once Monaco's python tokenizer is loaded. */
export function whenPythonTokenizerReady(): Promise<void> {
  if (!pythonReadyPromise) {
    // - colorize awaits the tokenizer (TokenizationRegistry.getOrCreate) before it resolves
    pythonReadyPromise = monaco.editor.colorize('', 'python', {}).then(
      () => { pythonReady = true; },
      err => { pythonReady = true; console.warn('[skena] python tokenizer', err); },
    );
  }
  return pythonReadyPromise;
}

type LineTokens = { offset: number; type: string }[][];
const tokenCache = new Map<string, LineTokens>();
const TOKEN_CACHE_MAX = 400;

// - Monaco's token types for `text` (same line split as the editor), from a cache after the first time
function pythonTokens(text: string): LineTokens {
  let hit = tokenCache.get(text);
  if (!hit) {
    hit = monaco.editor.tokenize(text, 'python').map(line => line.map(t => ({ offset: t.offset, type: t.type })));
    if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value as string);
    tokenCache.set(text, hit);
  }
  return hit;
}

const stylers = new Map<string, (type: string) => RunStyle>();
function stylerFor(dark: boolean, factors: boolean): (type: string) => RunStyle {
  const key = `${dark}|${factors}`;
  let styler = stylers.get(key);
  if (!styler) stylers.set(key, styler = tokenStyler(skenaCodeTheme(dark, factors, '')));
  return styler;
}

function runCss(style: RunStyle): React.CSSProperties {
  const decoration = [style.underline && 'underline', style.strikethrough && 'line-through'].filter(Boolean).join(' ');
  return {
    color:                 style.color,
    fontStyle:             style.italic ? 'italic' : undefined,
    fontWeight:            style.bold ? 'bold' : undefined,
    textDecoration:        decoration || undefined,
    textUnderlinePosition: style.underline ? 'under' : undefined,
  };
}

interface CodeCellPreviewProps {
  code:        string;
  /** - 1-based line the editor's cursor opens on */
  cursorLine:  number;
  /** - Monaco draws the active indentation guide only once its editor has seen a cursor move */
  activeGuide: boolean;
  font:        CodeCellFont;
  metrics:     CodeCellMetrics;
  dark:        boolean;
}

export function CodeCellPreview({ code, cursorLine, activeGuide, font, metrics, dark }: CodeCellPreviewProps): JSX.Element {
  const [ready, setReady] = useState(pythonReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    whenPythonTokenizerReady().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [ready]);
  // - re-render when the markdown theme flips: the editor theme follows it (factors palette)
  const [, setThemeTick] = useState(0);
  useEffect(() => {
    const on = () => setThemeTick(t => t + 1);
    window.addEventListener('skena:mdTheme', on);
    return () => window.removeEventListener('skena:mdTheme', on);
  }, []);
  const factors = document.documentElement.dataset.mdTheme === 'factors';

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
  const indentation = useMemo(() => codeIndentation(lines), [lines]);
  const current = Math.min(Math.max(1, Math.floor(cursorLine) || 1), lines.length);
  const guides = useMemo(() => indentGuides(lines, indentation, activeGuide ? current : null), [lines, indentation, activeGuide, current]);
  const numbers = useMemo(() => relativeLineNumbers(lines.length, cursorLine), [lines.length, cursorLine]);
  const tokens = ready ? pythonTokens(text) : null;
  const styler = stylerFor(dark, factors);
  const theme = skenaCodeTheme(dark, factors, '');
  const guideColors = indentGuideColors(theme);
  const { lineNumbersWidth, contentLeft } = codeGutter(lines.length, metrics.maxDigitWidth);
  const lh = font.lineHeight;
  const height = lines.length * lh;
  const lastIsEmpty = lines[lines.length - 1] === '';
  // - the font settings Monaco applies to its lines and margin (fontLigatures on → liga + calt)
  const fontCss: React.CSSProperties = {
    fontFamily: font.family, fontWeight: 'normal', fontSize: font.size, fontFeatureSettings: '"liga" on, "calt" on',
    lineHeight: `${lh}px`, letterSpacing: '0px',
  };

  return (
    <div className="skena-code-cell-lines" style={{ position: 'relative', height, ...fontCss, color: styler('').color }}>
      {/* - margin: Monaco's .margin layer with its .margin-view-overlays rows */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: contentLeft, height, transform: LAYER_HINT, contain: 'strict' }}>
        <div style={{ position: 'absolute', width: contentLeft, height, ...fontCss }}>
          {lines.map((_, i) => {
            const isCurrent = i + 1 === current;
            const color = IS_LINUX && lastIsEmpty && i === lines.length - 1
              ? LINE_NUMBER_DIMMED_COLOR
              : isCurrent ? LINE_NUMBER_ACTIVE_COLOR : LINE_NUMBER_COLOR;
            return (
              <div key={i} style={{ position: 'absolute', width: '100%', top: i * lh, height: lh, lineHeight: `${lh}px` }}>
                <div
                  className="skena-code-cell-ln"
                  data-line={i}
                  style={{
                    position: 'absolute', bottom: 0, left: 0, width: lineNumbersWidth, display: 'inline-block',
                    textAlign: 'right', verticalAlign: 'middle', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums',
                    marginTop: IS_LINUX && lh % 2 === 1 ? 1 : undefined, color, userSelect: 'none',
                  }}
                >
                  {/* - Monaco left-aligns the cursor line's own number inside the right-aligned box */}
                  {isCurrent
                    ? <span style={{ textAlign: 'left', display: 'inline-block', width: '100%' }}>{numbers[i]}</span>
                    : numbers[i]}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* - text: Monaco's .lines-content layer, with its .view-overlays rows (guides) and .view-line rows */}
      <div style={{ position: 'absolute', left: contentLeft, top: 0, height, transform: LAYER_HINT }}>
        <div style={{ position: 'absolute', top: 0 }}>
          {guides.map((row, i) => row.length > 0 && (
            <div key={i} style={{ position: 'absolute', top: i * lh, height: lh, lineHeight: `${lh}px` }}>
              {row.map(g => (
                <div
                  key={g.column}
                  className="skena-code-cell-guide"
                  data-active={g.active ? '1' : undefined}
                  style={{
                    position: 'absolute', boxSizing: 'border-box', height: '100%',
                    left: `${(g.column - 1) * metrics.spaceWidth}px`, width: `${metrics.spaceWidth}px`,
                    boxShadow: `1px 0 0 0 ${g.active ? guideColors.active : guideColors.normal} inset`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', ...fontCss }}>
          {lines.map((line, i) => {
            const lineTokens = tokens?.[i]?.map(t => ({ offset: t.offset, style: styler(t.type) })) ?? [];
            const runs = splitRuns(line, lineTokens, bracketsByLine.get(i), magicRange(line));
            return (
              <div
                key={i}
                className="skena-code-cell-line"
                data-line={i}
                style={{ position: 'absolute', top: i * lh, height: lh, lineHeight: `${lh}px`, boxSizing: 'border-box', whiteSpace: 'pre', tabSize: indentation.tabSize }}
              >
                <span style={{ position: 'absolute', top: 0, bottom: 0 }}>
                  {runs.map((r, k) => (
                    <span key={k} className={r.magic ? 'skena-magic' : undefined} style={runCss(r.style)}>{r.text}</span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
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
  const lineEl = root.querySelector(`.skena-code-cell-line[data-line="${line}"]`);
  const num = root.querySelector(`.skena-code-cell-ln[data-line="${line}"]`);
  return { glyph: lineEl ? firstGlyphRect(lineEl) : null, number: num ? textContentRect(num) : null };
}

/** Screen x of every indentation guide in a preview under `root`, and how many are drawn active. */
export function previewGuides(root: Element): { xs: number[]; active: number } {
  const els = Array.from(root.querySelectorAll('.skena-code-cell-guide'));
  return { xs: els.map(el => el.getBoundingClientRect().left), active: els.filter(el => el.getAttribute('data-active') === '1').length };
}
