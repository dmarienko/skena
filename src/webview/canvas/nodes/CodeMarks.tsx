/**
 * The marks of a code cell (`# %% <text>` lines, codeMarks.ts), drawn above the cell at a fixed size on
 * screen so they read at any zoom: one row per mark in code order, the first on top, all hanging from a
 * line that runs down the cell's left side to a pin level with each marked line.
 *
 * Two layers, both placed at the cell's top-left corner. The rows and the part of the line above the cell
 * are in screen px, in a box scaled by 1 / zoom. The line beside the cell and the pins are in canvas
 * units, so they follow the code: the first code line starts below the cell's border, its band inset and
 * the 24 px top row. Every element carries ZOOM_WIDTH_CLASS, so a zoom rewrites its --skena-zoom and
 * --skena-band-extra and nothing re-renders.
 */
import { memo } from 'react';
import type { CodeMark } from '../../../shared/codeMarks';
import { ZOOM_WIDTH_CLASS, baseBorderWidth } from './nodeShared';

// - screen px: row height, gap between the cell's top edge and the last row, the line's distance left of the cell
const ROW_H = 20;
const GAP = 8;
const SPINE_X = -8;
const PIN = 7;
const HEADER_H = 24;

interface Props {
  marks: CodeMark[];
  /** - the code's line height, canvas px */
  lineHeight: number;
  /** - how far the code is scrolled, canvas px */
  scrollTop: number;
  /** - the cell's height, canvas px */
  height: number;
  zoomVars: React.CSSProperties;
}

function CodeMarksInner({ marks, lineHeight, scrollTop, height, zoomVars }: Props): JSX.Element | null {
  if (marks.length === 0) return null;
  const n = marks.length;
  const border = baseBorderWidth(1.5);
  const codeTop = `(${border} + var(--skena-band-extra) + ${HEADER_H}px)`;
  const codeBottom = `(${height}px - ${border} - var(--skena-band-extra) - ${lineHeight / 2}px)`;
  // - a pin's centre in canvas px: its line's middle, kept inside the visible code when scrolled away
  const pinY = (line: number) =>
    `clamp(calc(${codeTop} + ${lineHeight / 2}px), calc(${codeTop} + ${(line - 1) * lineHeight + lineHeight / 2 - scrollTop}px), calc(${codeBottom}))`;
  const lastPin = pinY(marks[n - 1].line);
  const rowTop = (k: number) => -(GAP + (n - k) * ROW_H);
  const base: React.CSSProperties = { ...zoomVars, position: 'absolute', pointerEvents: 'none' };

  return (
    <>
      {/* - screen px: the rows and the line from the first row down to the cell's top edge */}
      <div className={`${ZOOM_WIDTH_CLASS} skena-code-marks`}
        style={{ ...base, left: 0, top: 0, width: 0, height: 0, transform: 'scale(calc(1 / var(--skena-zoom)))', transformOrigin: '0 0', zIndex: 5 }}>
        <div className="skena-code-mark-line" style={{ position: 'absolute', left: SPINE_X, top: rowTop(0) + ROW_H - 1, width: 1, height: -(rowTop(0) + ROW_H - 1) }} />
        {marks.map((m, k) => (
          <div key={`${m.line}-${k}`} className="skena-code-mark" style={{ position: 'absolute', left: SPINE_X, top: rowTop(k), height: ROW_H }}>
            {m.text}
          </div>
        ))}
      </div>
      {/* - canvas px: the line beside the cell down to the last pin, and a pin per marked line */}
      <div className={`${ZOOM_WIDTH_CLASS} skena-code-mark-line`}
        style={{ ...base, left: `calc(${SPINE_X}px / var(--skena-zoom))`, top: 0, width: 'calc(1px / var(--skena-zoom))', height: lastPin, zIndex: 5 }} />
      {marks.map((m, k) => (
        <div key={`pin-${m.line}-${k}`} className={`${ZOOM_WIDTH_CLASS} skena-code-mark-pin`}
          style={{
            ...base, zIndex: 5,
            width: `calc(${PIN}px / var(--skena-zoom))`, height: `calc(${PIN}px / var(--skena-zoom))`,
            left: `calc(${SPINE_X - PIN / 2}px / var(--skena-zoom))`, top: `calc(${pinY(m.line)} - ${PIN / 2}px / var(--skena-zoom))`,
          }} />
      ))}
    </>
  );
}

export const CodeMarks = memo(CodeMarksInner);
