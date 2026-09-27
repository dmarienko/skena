// - pure sizes for the docked chat console; no DOM
export const INPUT_LINE_H          = 20;
export const INPUT_MAX_LINES       = 8;
export const DEFAULT_CONSOLE_WIDTH = 760;
export const MIN_CONSOLE_W         = 420;
// - free space kept between the console and each side of the window
export const SIDE_GUTTER           = 16;

export function inputHeight(lines: number): number {
  const n = Math.min(INPUT_MAX_LINES, Math.max(1, Math.round(lines)));
  return n * INPUT_LINE_H;
}

export function clampConsoleWidth(width: number, viewportW: number): number {
  const max = Math.max(0, viewportW - 2 * SIDE_GUTTER);
  return Math.round(Math.min(max, Math.max(MIN_CONSOLE_W, width)));
}

// - the console is centred, so moving one edge by dx moves the other edge by dx as well
export function dragWidth(startW: number, dx: number, edge: 'left' | 'right'): number {
  return startW + (edge === 'right' ? 2 * dx : -2 * dx);
}
