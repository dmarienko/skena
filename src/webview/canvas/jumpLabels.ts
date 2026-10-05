/**
 * Jump labels (EasyMotion style), the pure part: leader leader h/j/k/l puts a label on every target on
 * that side, typing a label moves there. editorJumpLabels.ts (Monaco) and CanvasView.tsx (nodes) find
 * the targets with the functions here, draw the labels and read the keys.
 */
import type { NavNode, Rect } from './spatialNav';

export const DEFAULT_LEADER = ';';
export const DEFAULT_JUMP_LABELS = 'asdfghjklqwertyuiopzxcvbnm';

export type JumpDir = 'h' | 'j' | 'k' | 'l';
/** - how many leader presses are held back, waiting for the next key */
export type LeaderState = 0 | 1 | 2;
export interface JumpKey { key: string; ctrl: boolean; meta: boolean; alt: boolean }

/**
 * - `none`: not part of a leader sequence; the key goes on as usual and the state stays
 * - `hold`: a leader; stop the key and wait for the next one
 * - `show`: leader leader + h/j/k/l; stop the key and show the labels
 * - `release`: any other key ends the sequence; the `held` leaders keep their own meaning, then the
 *   key goes on as usual
 */
export type LeaderStep =
  | { do: 'none' }
  | { do: 'hold'; next: 1 | 2 }
  | { do: 'show'; dir: JumpDir }
  | { do: 'release'; held: 1 | 2 };

export type JumpMatch =
  | { kind: 'jump'; index: number }
  | { kind: 'narrow'; prefix: string }
  | { kind: 'cancel' };

const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);
const DIRS: ReadonlySet<string> = new Set(['h', 'j', 'k', 'l']);

/** - the setting when it is exactly one character, else the default */
export function normalizeLeader(raw: unknown): string {
  return typeof raw === 'string' && [...raw].length === 1 && (raw === ' ' || !/\s/.test(raw)) ? raw : DEFAULT_LEADER;
}

/** - the name monaco-vim's handleKey takes for the leader: a character as itself, space as <Space> */
export function vimKeyOf(leader: string): string {
  return leader === ' ' ? '<Space>' : leader;
}

/** - the label characters in setting order: no repeats, no blanks, never the leader */
function usableChars(chars: string, leader: string): string[] {
  const out: string[] = [];
  for (const ch of chars) if (ch !== leader && !/\s/.test(ch) && !out.includes(ch)) out.push(ch);
  return out;
}

/**
 * Labels for `count` targets ordered nearest first. With n characters and count <= n every target
 * gets one character. With more, the last p characters become first characters of two-character
 * labels (each followed by every character), the first n - p stay one-character labels for the
 * nearest targets, and p is the fewest that covers count (at most n). No label is a prefix of
 * another. Past n * n targets the rest get no label. Fewer than two usable characters in the
 * setting: the default characters are used.
 */
export function assignLabels(count: number, chars: string, leader: string): string[] {
  const own = usableChars(chars, leader);
  const keys = own.length >= 2 ? own : usableChars(DEFAULT_JUMP_LABELS, leader);
  const n = keys.length;
  if (count <= n) return keys.slice(0, Math.max(0, count));
  const p = Math.min(n, Math.ceil((count - n) / (n - 1)));
  const pairs: string[] = [];
  for (const first of keys.slice(n - p)) for (const second of keys) pairs.push(first + second);
  return [...keys.slice(0, n - p), ...pairs].slice(0, count);
}

/** - the keys typed so far against the labels: a whole label jumps, the start of one narrows */
export function matchKeys(labels: readonly string[], typed: string): JumpMatch {
  const index = labels.indexOf(typed);
  if (index >= 0) return { kind: 'jump', index };
  if (typed !== '' && labels.some(l => l.startsWith(typed))) return { kind: 'narrow', prefix: typed };
  return { kind: 'cancel' };
}

/**
 * One key while the labels are shown. A modifier pressed alone changes nothing (`ignore`); Esc, a
 * chord with Ctrl/Alt/Meta and any named key cancel; a character is matched after `typed`.
 */
export function labelKey(labels: readonly string[], typed: string, k: JumpKey): JumpMatch | { kind: 'ignore' } {
  if (MODIFIER_KEYS.has(k.key)) return { kind: 'ignore' };
  if (k.ctrl || k.meta || k.alt || [...k.key].length !== 1) return { kind: 'cancel' };
  return matchKeys(labels, typed + k.key);
}

/** - one key of leader leader h/j/k/l, from `state` leaders held. Shift does not count as a modifier. */
export function leaderStep(state: LeaderState, k: JumpKey, leader: string): LeaderStep {
  if (MODIFIER_KEYS.has(k.key)) return { do: 'none' };
  const plain = !k.ctrl && !k.meta && !k.alt;
  if (state === 0) return plain && k.key === leader ? { do: 'hold', next: 1 } : { do: 'none' };
  if (state === 1) return plain && k.key === leader ? { do: 'hold', next: 2 } : { do: 'release', held: 1 };
  return plain && DIRS.has(k.key) ? { do: 'show', dir: k.key as JumpDir } : { do: 'release', held: 2 };
}

/** - 1-based line and column, as Monaco counts them */
export interface TextPos { line: number; col: number }
/** - one line the editor shows, by its model line number */
export interface VisibleLine { line: number; text: string }

const WORD_CHAR = /[\p{L}\p{N}_]/u;

// - vim's `w` classes: 0 blank, 1 letters, digits and _, 2 any other non-blank character
function charClass(ch: string): 0 | 1 | 2 {
  if (/\s/.test(ch)) return 0;
  return WORD_CHAR.test(ch) ? 1 : 2;
}

/** - 1-based columns where a word starts: a non-blank character whose class differs from the one before */
function lineWordStarts(text: string): number[] {
  const out: number[] = [];
  let prev: 0 | 1 | 2 = 0;
  for (let i = 0; i < text.length;) {
    const start = i;
    const cp = text.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    i += cp > 0xffff ? 2 : 1;
    if (/\p{M}/u.test(ch)) continue;
    const c = charClass(ch);
    if (c !== 0 && c !== prev) out.push(start + 1);
    prev = c;
  }
  return out;
}

/**
 * Word starts in `lines` (ascending line numbers) after the cursor (`forward`) or before it
 * (`backward`), nearest first: document order outward from the cursor. A line's first non-blank
 * character always starts a word.
 */
export function wordStarts(lines: readonly VisibleLine[], cursor: TextPos, dir: 'forward' | 'backward'): TextPos[] {
  const all: TextPos[] = [];
  for (const l of lines) for (const col of lineWordStarts(l.text)) all.push({ line: l.line, col });
  if (dir === 'forward') return all.filter(p => p.line > cursor.line || (p.line === cursor.line && p.col > cursor.col));
  return all.filter(p => p.line < cursor.line || (p.line === cursor.line && p.col < cursor.col)).reverse();
}

/**
 * The first non-blank character of each line in `lines` (ascending) below (`down`) or above (`up`)
 * the cursor's line, nearest first. A line with no non-blank character gives column 1.
 */
export function lineStarts(lines: readonly VisibleLine[], cursorLine: number, dir: 'down' | 'up'): TextPos[] {
  const picked = lines.filter(l => (dir === 'down' ? l.line > cursorLine : l.line < cursorLine));
  if (dir === 'up') picked.reverse();
  return picked.map(l => {
    const i = l.text.search(/\S/);
    return { line: l.line, col: i < 0 ? 1 : i + 1 };
  });
}

/**
 * The nodes that overlap `view` and whose centre is strictly on the `dir` side of `origin` (l right,
 * h left, j below, k above), nearest centre first; equal distances keep the input order. All in flow
 * coordinates. The focused node's own centre is the origin, so it is never on any side.
 */
export function nodesInDirection(nodes: readonly NavNode[], origin: { x: number; y: number }, view: Rect, dir: JumpDir): NavNode[] {
  const onSide = (cx: number, cy: number): boolean =>
    dir === 'l' ? cx > origin.x : dir === 'h' ? cx < origin.x : dir === 'j' ? cy > origin.y : cy < origin.y;
  return nodes
    .filter(n => n.x < view.right && n.x + n.w > view.left && n.y < view.bottom && n.y + n.h > view.top)
    .map(n => ({ n, cx: n.x + n.w / 2, cy: n.y + n.h / 2 }))
    .filter(c => onSide(c.cx, c.cy))
    .map(c => ({ n: c.n, d: Math.hypot(c.cx - origin.x, c.cy - origin.y) }))
    .sort((a, b) => a.d - b.d)
    .map(c => c.n);
}
