# Jump Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `docs/superpowers/specs/2026-10-05-jump-labels-design.md` (`0acf241`). Leader leader `h`/`j`/`k`/`l` puts a red label on every target on that side (word starts or line starts in a Monaco editor in vim normal mode; visible nodes on the canvas); typing a label moves there. Leader and label characters come from two new settings, `skena.vim.leader` (default `;`) and `skena.vim.jumpLabels` (default `asdfghjklqwertyuiopzxcvbnm`).

**Architecture:** A pure module, `src/webview/canvas/jumpLabels.ts`, assigns labels, matches typed keys, steps through the leader keys and finds the targets (word starts, line starts, nodes on one side); it is tested in node. In the three Monaco editors, `installJumpLabels` (`editorJumpLabels.ts`) reads keys in a capture listener on the editor's container before Monaco and monaco-vim see them, draws each label as the `::after` of an empty `beforeContentClassName` decoration, and hands a leader that was not followed by a second leader back to vim with `Vim.handleKey`. On the canvas the leader keys are read in the existing keydown handler next to the `g` chord, a `JumpTags` layer draws the tags the way `EdgeFollowHints` draws the `g` badges, and a jump calls `focusNodeById`; the settings reach the webview in a new `vimConfig` host message and are kept in a small module store.

**Tech Stack:** TypeScript 5, React 18, React Flow 12 (`@xyflow/react`), Monaco 0.55.1 through `@monaco-editor/react` 4.7, monaco-vim 0.4.4, the VS Code extension API, esbuild bundles + `node --test` (each test file's line 1 holds its run command).

---

## Before you start

- Work on branch `feature/spatial-notebook`. Stage files by name; commit only the files each task names. No attribution lines of any kind in commit messages.
- Another agent is changing `src/webview/canvas/nodes/KnowledgeNode.tsx`, `src/webview/canvas/nodes/FileNode.tsx` and the markdown rendering (`src/webview/renderers/MarkdownRenderer.tsx`, `src/webview/hooks/useHostMarkdown.ts`, `src/webview/lib/codeHighlight.ts`, `src/webview/styles/markdown.css`, `src/webview/components/ScrollableContent.tsx`, `src/webview/canvas/textWindow.ts`). Do not open, edit or stage them. If `git status` shows uncommitted changes in a file this plan edits and you did not make them, stop and ask.
- `.vscode/skena-mcp.js` and the untracked `.vscode/numbered-bookmarks.json` are not yours. Never stage them. `npm run build` rewrites `.vscode/skena-mcp.js`; leave it unstaged.
- If `git commit` fails on `index.lock`, wait a few seconds and run it again. Never delete the lock file.
- Line numbers in this plan are those of `a255521`. Find each edit by the quoted text; the numbers may have moved.
- Typecheck baseline at `a255521`: `npx tsc --noEmit` reports 3 errors, all in `src/extension/editor-provider.ts` (`fsPath` on `ResolvedUri`). They are old. The typecheck command in this plan filters them out:

  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"
  ```

  Expected output: nothing. An error in a file listed above as the other agent's: stop and report it.
- The code in this plan was applied to a copy of `a255521` on 2026-10-05, task by task, with the commands written here: each test step failed and then passed as stated (12, 17, 20 tests), the typecheck command printed nothing after Tasks 4, 5, 6 and 7, `npm run build` succeeded, and `tests/g-chord.mjs` (5) and `tests/spatial-nav.mjs` (61) still pass. The manual checks in Tasks 6, 7 and 8 have not been run.

## Why the editor keys are not bound through monaco-vim

The spec says the editor keys are bound "through monaco-vim's `Vim` object". With monaco-vim 0.4.4 that cannot work while `;` keeps its meaning:

- `;` is a default normal-mode key (`node_modules/monaco-vim/src/cm/keymap_vim.ts:328-333`, `repeatLastCharacterSearch`; the same entry is in `dist/monaco-vim.umd.js:4827-4832`, which esbuild bundles).
- `commandDispatcher.matchCommand` (`keymap_vim.ts:1996-2017`) returns the first full match whenever there is one, even if a longer mapping such as `;;l` also starts with the keys typed. Normal mode has no timeout (`handleKeyNonInsertMode`, `keymap_vim.ts:1659-1702`). So after `Vim.mapCommand(';;l', …)` the first `;` still runs at once and `;;l` is never reached.

So `installJumpLabels` reads the keys first: a `keydown` listener in the capture phase on `editor.getContainerDomNode()`. It runs before Monaco's own listener on the text input and before vim's `editor.onKeyDown` handler (`node_modules/monaco-vim/src/cm_adapter.ts:368-404`), and `stopPropagation` there means neither sees the key. The `Vim` object is still used: its per-editor state (`cm.state.vim`) says whether vim is in normal mode with nothing typed yet, and `Vim.handleKey(cm, ';')` (`keymap_vim.ts:1539-1544`) runs a leader that turned out not to start a jump.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/webview/canvas/jumpLabels.ts` | create | Pure. `assignLabels`, `matchKeys`, `labelKey`, `leaderStep`, `normalizeLeader`, `vimKeyOf`, `wordStarts`, `lineStarts`, `nodesInDirection`, defaults. |
| `tests/jump-labels.mjs` | create | node:test for every export of `jumpLabels.ts` (20 tests). |
| `src/webview/canvas/vimSettings.ts` | create | Module store for `skena.vim.*` in the webview: `vimSettings()`, `setVimSettings()`. |
| `src/webview/canvas/editorJumpLabels.ts` | create | `installJumpLabels(editor, vim)`: reads the keys in one Monaco editor, draws the labels, moves the cursor. |
| `src/webview/canvas/JumpTags.tsx` | create | The canvas tags: a pointer-transparent layer inside React Flow, one tag per target node. |
| `src/webview/styles/canvas.css` | modify | Label rules for the editors and the canvas tags (red `#f01010`, white text). |
| `package.json` | modify | Declare `skena.vim.leader` and `skena.vim.jumpLabels`. |
| `src/shared/types.ts` | modify | `VimConfig`, `MsgVimConfig`, add it to `HostToWebview`. |
| `src/extension/settings.ts` | modify | `getVimConfig()` reads `skena.vim.*`. |
| `src/extension/editor-provider.ts` | modify | Send `vimConfig` before `canvasLoaded` and on every `skena.vim` change. |
| `src/webview/App.tsx` | modify | Put a `vimConfig` message into the store. |
| `src/webview/canvas/nodes/TextNode.tsx` | modify | Call `installJumpLabels` in `onEditorMount`. |
| `src/webview/canvas/nodes/CodeNode.tsx` | modify | Keep `initVimMode`'s result; call `installJumpLabels` in `onEditorMount`. |
| `src/webview/canvas/chat/ChatInput.tsx` | modify | Keep `initVimMode`'s result; call `installJumpLabels` in `handleMount`. |
| `src/webview/canvas/gChord.ts` | modify | Comment only: `G_BADGES_ATTR` is now also set while the jump tags are shown. |
| `src/webview/canvas/CanvasView.tsx` | modify | Leader keys in the keydown handler, tag state, `showJumpTags`, `readJumpKey`, `jumpCapture`, render `JumpTags`. |

---

### Task 1: Labels, typed keys and the leader keys (pure)

**Files:**
- Create: `src/webview/canvas/jumpLabels.ts`
- Test: `tests/jump-labels.mjs`

Label assignment follows VSCodeVim's EasyMotion idea: with n label characters and more than n targets, the last p characters become first characters of two-character labels and the first n − p characters stay one-character labels for the nearest targets. p is the smallest number that covers all targets, at most n (then n × n targets get labels; the rest get none).

- [ ] **Step 1: Write the failing test**

Create `tests/jump-labels.mjs`:

```js
// - run: npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_JUMP_LABELS, assignLabels, labelKey, leaderStep, matchKeys, normalizeLeader, vimKeyOf,
} from './.build/jumpLabels.mjs';

const key = (k, mods = {}) => ({ key: k, ctrl: false, meta: false, alt: false, ...mods });

test('1. T <= N: one character per target, nearest first, in setting order', () => {
  assert.deepEqual(assignLabels(3, 'abc', ';'), ['a', 'b', 'c']);
  assert.deepEqual(assignLabels(2, 'abc', ';'), ['a', 'b']);
  assert.deepEqual(assignLabels(0, 'abc', ';'), []);
});

test('2. T > N: the nearest keep one character, the rest share first characters taken from the end', () => {
  assert.deepEqual(assignLabels(4, 'abc', ';'), ['a', 'b', 'ca', 'cb']);
  assert.deepEqual(assignLabels(5, 'abc', ';'), ['a', 'b', 'ca', 'cb', 'cc']);
  assert.deepEqual(assignLabels(6, 'abc', ';'), ['a', 'ba', 'bb', 'bc', 'ca', 'cb']);
  assert.deepEqual(assignLabels(9, 'abc', ';'), ['aa', 'ab', 'ac', 'ba', 'bb', 'bc', 'ca', 'cb', 'cc']);
});

test('3. past N * N targets the rest get no label', () => {
  assert.equal(assignLabels(10, 'abc', ';').length, 9);
});

test('4. with the default characters: unique, no label a prefix of another, singles before pairs', () => {
  for (const count of [1, 25, 26, 27, 40, 100, 400, 676, 700]) {
    const labels = assignLabels(count, DEFAULT_JUMP_LABELS, ';');
    assert.equal(labels.length, Math.min(count, 26 * 26), `count ${count}`);
    assert.equal(new Set(labels).size, labels.length, `count ${count}: repeats`);
    for (const a of labels) for (const b of labels) {
      if (a !== b) assert.ok(!b.startsWith(a), `count ${count}: ${a} starts ${b}`);
    }
    for (let i = 1; i < labels.length; i++) assert.ok(labels[i - 1].length <= labels[i].length, `count ${count}: order`);
  }
  assert.deepEqual(assignLabels(27, DEFAULT_JUMP_LABELS, ';').slice(0, 3), ['a', 's', 'd']);
});

test('5. the leader, blanks and repeats are never labels', () => {
  assert.deepEqual(assignLabels(3, 'a;b c', ';'), ['a', 'b', 'c']);
  assert.deepEqual(assignLabels(3, 'aabbc', ';'), ['a', 'b', 'c']);
  assert.ok(!assignLabels(700, DEFAULT_JUMP_LABELS, 'a').some(l => l.includes('a')));
});

test('6. fewer than two usable characters: the default characters, still without the leader', () => {
  assert.deepEqual(assignLabels(2, ';', ';'), ['a', 's']);
  assert.deepEqual(assignLabels(2, 'x', 'a'), ['s', 'd']);
});

test('7. typed keys: a whole label jumps, a first character narrows, anything else cancels', () => {
  const labels = ['a', 'b', 'ca', 'cb'];
  assert.deepEqual(matchKeys(labels, 'b'), { kind: 'jump', index: 1 });
  assert.deepEqual(matchKeys(labels, 'c'), { kind: 'narrow', prefix: 'c' });
  assert.deepEqual(matchKeys(labels, 'cb'), { kind: 'jump', index: 3 });
  assert.deepEqual(matchKeys(labels, 'cx'), { kind: 'cancel' });
  assert.deepEqual(matchKeys(labels, 'z'), { kind: 'cancel' });
  assert.deepEqual(matchKeys(labels, ''), { kind: 'cancel' });
});

test('8. a key while labels are shown: modifiers alone change nothing; Esc, chords and named keys cancel', () => {
  const labels = ['a', 'b', 'ca', 'cb'];
  assert.deepEqual(labelKey(labels, '', key('Shift')), { kind: 'ignore' });
  assert.deepEqual(labelKey(labels, 'c', key('Control')), { kind: 'ignore' });
  assert.deepEqual(labelKey(labels, '', key('Escape')), { kind: 'cancel' });
  assert.deepEqual(labelKey(labels, '', key('a', { ctrl: true })), { kind: 'cancel' });
  assert.deepEqual(labelKey(labels, '', key('ArrowDown')), { kind: 'cancel' });
  assert.deepEqual(labelKey(labels, '', key('c')), { kind: 'narrow', prefix: 'c' });
  assert.deepEqual(labelKey(labels, 'c', key('a')), { kind: 'jump', index: 2 });
});

test('9. leader leader h/j/k/l shows; the leader then anything else releases what was held', () => {
  assert.deepEqual(leaderStep(0, key(';'), ';'), { do: 'hold', next: 1 });
  assert.deepEqual(leaderStep(1, key(';'), ';'), { do: 'hold', next: 2 });
  for (const d of ['h', 'j', 'k', 'l']) assert.deepEqual(leaderStep(2, key(d), ';'), { do: 'show', dir: d });
  assert.deepEqual(leaderStep(1, key('x'), ';'), { do: 'release', held: 1 });
  assert.deepEqual(leaderStep(1, key('l'), ';'), { do: 'release', held: 1 });
  assert.deepEqual(leaderStep(2, key('x'), ';'), { do: 'release', held: 2 });
  assert.deepEqual(leaderStep(2, key(';'), ';'), { do: 'release', held: 2 });
  assert.deepEqual(leaderStep(2, key('L'), ';'), { do: 'release', held: 2 });
});

test('10. no leader held: other keys and a chorded leader are not part of a sequence', () => {
  assert.deepEqual(leaderStep(0, key('l'), ';'), { do: 'none' });
  assert.deepEqual(leaderStep(0, key(';', { ctrl: true }), ';'), { do: 'none' });
  assert.deepEqual(leaderStep(1, key(';', { alt: true }), ';'), { do: 'release', held: 1 });
});

test('11. a modifier pressed alone keeps the held leaders, so a shifted leader works', () => {
  assert.deepEqual(leaderStep(1, key('Shift'), ':'), { do: 'none' });
  assert.deepEqual(leaderStep(1, key(':'), ':'), { do: 'hold', next: 2 });
  assert.deepEqual(leaderStep(2, key('Shift'), ':'), { do: 'none' });
});

test('12. leader setting: exactly one character, else ;', () => {
  assert.equal(normalizeLeader(','), ',');
  assert.equal(normalizeLeader(' '), ' ');
  assert.equal(normalizeLeader(''), ';');
  assert.equal(normalizeLeader(',,'), ';');
  assert.equal(normalizeLeader(undefined), ';');
  assert.equal(vimKeyOf(';'), ';');
  assert.equal(vimKeyOf(' '), '<Space>');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`

Expected: esbuild stops with `✘ [ERROR] Could not resolve "src/webview/canvas/jumpLabels.ts"`.

- [ ] **Step 3: Write the module**

Create `src/webview/canvas/jumpLabels.ts`:

```ts
/**
 * Jump labels (EasyMotion style), the pure part: leader leader h/j/k/l puts a label on every target on
 * that side, typing a label moves there. editorJumpLabels.ts (Monaco) and CanvasView.tsx (nodes) find
 * the targets with the functions here, draw the labels and read the keys.
 */
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
  return typeof raw === 'string' && [...raw].length === 1 ? raw : DEFAULT_LEADER;
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
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`

Expected: `# tests 12`, `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/jumpLabels.ts tests/jump-labels.mjs
git commit -m "feat(jump): label assignment, typed-key matching and leader keys"
```

---

### Task 2: Word starts and line starts (pure)

**Files:**
- Modify: `src/webview/canvas/jumpLabels.ts` (append at the end)
- Modify: `tests/jump-labels.mjs:4-6` (import), append at the end

A word start follows vim's `w`, as the spec states it: the first character of a run of letters, digits and `_`, or of a run of other non-blank characters. Letters outside ASCII count as letters (`\p{L}`). Columns are 1-based UTF-16 columns, as Monaco counts them.

- [ ] **Step 1: Write the failing tests**

In `tests/jump-labels.mjs`, find:

```js
import {
  DEFAULT_JUMP_LABELS, assignLabels, labelKey, leaderStep, matchKeys, normalizeLeader, vimKeyOf,
} from './.build/jumpLabels.mjs';
```

replace with:

```js
import {
  DEFAULT_JUMP_LABELS, assignLabels, labelKey, leaderStep, lineStarts, matchKeys, normalizeLeader, vimKeyOf, wordStarts,
} from './.build/jumpLabels.mjs';
```

Then append to the end of `tests/jump-labels.mjs`, after one blank line:

```js
// - lines 4-8 are on screen; the cursor is on line 5 at column 7 (the `b` of `bar`)
//   col: 123456789012345
const LINES = [
  { line: 4, text: 'x = 1' },
  { line: 5, text: '  foo.bar(baz_2)' },
  { line: 6, text: '' },
  { line: 7, text: '\tif (a)' },
  { line: 8, text: '    ' },
];
const CURSOR = { line: 5, col: 7 };
const at = (line, col) => ({ line, col });

test('13. word starts after the cursor: runs of word characters and runs of other non-blanks, in document order', () => {
  assert.deepEqual(wordStarts(LINES, CURSOR, 'forward'), [
    at(5, 10), at(5, 11), at(5, 16),   // - `(`, `baz_2`, `)`
    at(7, 2), at(7, 5), at(7, 6), at(7, 7),   // - `if`, `(`, `a`, `)`
  ]);
});

test('14. word starts before the cursor, nearest first: the cursor word start itself is excluded', () => {
  assert.deepEqual(wordStarts(LINES, CURSOR, 'backward'), [
    at(5, 6), at(5, 3),   // - `.`, `foo`
    at(4, 5), at(4, 3), at(4, 1),   // - `1`, `=`, `x`
  ]);
  assert.deepEqual(wordStarts(LINES, at(5, 8), 'backward')[0], at(5, 7));   // - mid-word: back to its start
});

test('15. letters outside ASCII are word characters', () => {
  assert.deepEqual(wordStarts([{ line: 1, text: 'été+ça' }], at(1, 1), 'forward'), [at(1, 4), at(1, 5)]);
});

test('16. line starts below the cursor: first non-blank character, column 1 for an empty or blank line', () => {
  assert.deepEqual(lineStarts(LINES, 5, 'down'), [at(6, 1), at(7, 2), at(8, 1)]);
});

test('17. line starts above the cursor, nearest first; the cursor line is never a target', () => {
  assert.deepEqual(lineStarts(LINES, 5, 'up'), [at(4, 1)]);
  assert.deepEqual(lineStarts(LINES, 8, 'up').map(p => p.line), [7, 6, 5, 4]);
  assert.deepEqual(lineStarts(LINES, 4, 'up'), []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`

Expected: `SyntaxError: The requested module './.build/jumpLabels.mjs' does not provide an export named 'lineStarts'`, `# fail 1`.

- [ ] **Step 3: Write the functions**

Append to the end of `src/webview/canvas/jumpLabels.ts`, after one blank line:

```ts
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
  for (let i = 0; i < text.length; i++) {
    const c = charClass(text[i]);
    if (c !== 0 && c !== prev) out.push(i + 1);
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
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`

Expected: `# tests 17`, `# pass 17`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/jumpLabels.ts tests/jump-labels.mjs
git commit -m "feat(jump): word starts and line starts for the editor labels"
```

---

### Task 3: Nodes on one side of the focused node (pure)

**Files:**
- Modify: `src/webview/canvas/jumpLabels.ts:1-5` (type import after the header comment), append at the end
- Modify: `tests/jump-labels.mjs:4-6` (import), append at the end

`NavNode` (`{ id, x, y, w, h }`) and `Rect` (`{ left, top, right, bottom }`) are the existing types in `src/webview/canvas/spatialNav.ts:16` and `:180`; here both are in flow coordinates.

- [ ] **Step 1: Write the failing tests**

In `tests/jump-labels.mjs`, find:

```js
import {
  DEFAULT_JUMP_LABELS, assignLabels, labelKey, leaderStep, lineStarts, matchKeys, normalizeLeader, vimKeyOf, wordStarts,
} from './.build/jumpLabels.mjs';
```

replace with:

```js
import {
  DEFAULT_JUMP_LABELS, assignLabels, labelKey, leaderStep, lineStarts, matchKeys, nodesInDirection, normalizeLeader,
  vimKeyOf, wordStarts,
} from './.build/jumpLabels.mjs';
```

Then append to the end of `tests/jump-labels.mjs`, after one blank line:

```js
// - focused node F (centre 500,500) in a 1000x1000 view; R right, L left, D below, U above, RD right and
//   below (counts for l and j), OFF right but outside the view, EDGE right and only partly inside it
const nav = (id, x, y, w = 100, h = 100) => ({ id, x, y, w, h });
const F = nav('F', 450, 450);
const R = nav('R', 650, 450);
const L = nav('L', 150, 450);
const D = nav('D', 450, 750);
const U = nav('U', 450, 50);
const RD = nav('RD', 800, 800);
const OFF = nav('OFF', 1200, 450);
const EDGE = nav('EDGE', 950, 450);
const NODES = [F, R, L, D, U, RD, OFF, EDGE];
const VIEW = { left: 0, top: 0, right: 1000, bottom: 1000 };
const ORIGIN = { x: 500, y: 500 };
const ids = nodes => nodes.map(n => n.id);

test('18. l: visible nodes whose centre is right of the origin, nearest centre first', () => {
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'l')), ['R', 'RD', 'EDGE']);
});

test('19. h, j, k: the other three sides; the focused node is never a target', () => {
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'h')), ['L']);
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'j')), ['D', 'RD']);
  assert.deepEqual(ids(nodesInDirection(NODES, ORIGIN, VIEW, 'k')), ['U']);
});

test('20. equal distances keep the input order; no visible node on that side gives nothing', () => {
  const a = nav('a', 650, 300), b = nav('b', 650, 600);   // - both 158.1 from the origin
  assert.deepEqual(ids(nodesInDirection([b, a], ORIGIN, VIEW, 'l')), ['b', 'a']);
  assert.deepEqual(nodesInDirection([F, L], ORIGIN, VIEW, 'l'), []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`

Expected: `SyntaxError: The requested module './.build/jumpLabels.mjs' does not provide an export named 'nodesInDirection'`, `# fail 1`.

- [ ] **Step 3: Write the function**

In `src/webview/canvas/jumpLabels.ts`, find:

```ts
 * the targets with the functions here, draw the labels and read the keys.
 */
```

replace with:

```ts
 * the targets with the functions here, draw the labels and read the keys.
 */
import type { NavNode, Rect } from './spatialNav';

```

Then append to the end of `src/webview/canvas/jumpLabels.ts`, after one blank line:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npx esbuild src/webview/canvas/jumpLabels.ts --bundle --format=esm --outfile=tests/.build/jumpLabels.mjs && node --test tests/jump-labels.mjs`

Expected: `# tests 20`, `# pass 20`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/jumpLabels.ts tests/jump-labels.mjs
git commit -m "feat(jump): canvas nodes on one side of the focused node"
```

---

### Task 4: Settings `skena.vim.leader` and `skena.vim.jumpLabels`

**Files:**
- Modify: `package.json:340-342` (two entries after `skena.markdownMaxWidth`)
- Modify: `src/shared/types.ts:508`, `src/shared/types.ts:1011-1014`
- Modify: `src/extension/settings.ts:25`, `src/extension/settings.ts:147-148`
- Modify: `src/extension/editor-provider.ts:23`, `src/extension/editor-provider.ts:280-283`, `src/extension/editor-provider.ts:768-769`
- Create: `src/webview/canvas/vimSettings.ts`
- Modify: `src/webview/App.tsx:21`, `src/webview/App.tsx:156-157`

How settings reach the webview today (checked): `markdownConfig` is sent once in the `webviewReady` case of `editor-provider.ts` (`:326-342`) and read in `App.tsx`'s message switch (`:139`); `onDidChangeConfiguration` (`:757-769`) already reacts to `skena.ai`, vaults and kernels. `vimConfig` follows the same path. It is sent before `canvasLoaded` so the canvas never takes a key with the defaults when the user has set other keys.

The editors read the store on every key, not once when they mount: the chat input mounts with `FloatingChat`, which `App.tsx` mounts before the host has sent anything (`App.tsx:332-334`, "FloatingChat is always mounted"), so a value read at mount would always be the default there. The spec says a change applies to editors opened after it; with this it also applies to editors already open.

No unit test: the store only keeps what it is given; `normalizeLeader` is covered by Task 1, test 12.

- [ ] **Step 1: Declare the settings**

In `package.json` (lines 340-342), find:

```json
          "description": "Max line length (in characters) for rendered markdown nodes — widening a node past this keeps a readable text column instead of reflowing full width. 0 = unlimited. Try ~88.",
          "scope": "window"
        },
```

replace with:

```json
          "description": "Max line length (in characters) for rendered markdown nodes — widening a node past this keeps a readable text column instead of reflowing full width. 0 = unlimited. Try ~88.",
          "scope": "window"
        },
        "skena.vim.leader": {
          "type": "string",
          "default": ";",
          "minLength": 1,
          "maxLength": 1,
          "description": "Leader key for jump labels, one key. Leader leader h/j/k/l labels the word starts (h/l) or line starts (j/k) on that side of the cursor in an editor's vim normal mode, and the visible nodes on that side of the focused node on the canvas; typing a label moves there. The leader followed by any other key keeps its own meaning (in an editor, ; repeats the last f/t).",
          "scope": "window"
        },
        "skena.vim.jumpLabels": {
          "type": "string",
          "default": "asdfghjklqwertyuiopzxcvbnm",
          "description": "Characters for jump labels, given to the nearest targets first. More targets than characters: the nearest keep one-character labels and the rest get two-character ones. The leader key is never used as a label.",
          "scope": "window"
        },
```

- [ ] **Step 2: Add the message type**

In `src/shared/types.ts` (line 508), find:

```ts
  | MsgMarkdownConfig
```

replace with:

```ts
  | MsgMarkdownConfig
  | MsgVimConfig
```

In `src/shared/types.ts` (lines 1011-1014), find:

```ts
export interface MsgMarkdownConfig {
  type:   'markdownConfig';
  config: MarkdownConfig;
}
```

replace with:

```ts
export interface MsgMarkdownConfig {
  type:   'markdownConfig';
  config: MarkdownConfig;
}

/** - skena.vim.*: the jump-label leader key and the label characters, as set (the webview checks them) */
export interface VimConfig {
  leader:     string;   // - skena.vim.leader
  jumpLabels: string;   // - skena.vim.jumpLabels
}

export interface MsgVimConfig {
  type:   'vimConfig';
  config: VimConfig;
}
```

- [ ] **Step 3: Read the settings on the host**

In `src/extension/settings.ts` (line 25), find:

```ts
import { VaultConfig } from '../shared/types';
```

replace with:

```ts
import { VaultConfig, VimConfig } from '../shared/types';
```

In `src/extension/settings.ts` (lines 147-148), find:

```ts
  return typeof v === 'number' && v >= 0 ? v : 24;
}
```

replace with:

```ts
  return typeof v === 'number' && v >= 0 ? v : 24;
}

/** - skena.vim.* for the webview: the jump-label leader key and the label characters, as set */
export function getVimConfig(): VimConfig {
  const cfg = vscode.workspace.getConfiguration('skena.vim');
  return {
    leader:     cfg.get<string>('leader') ?? ';',
    jumpLabels: cfg.get<string>('jumpLabels') ?? 'asdfghjklqwertyuiopzxcvbnm',
  };
}
```

- [ ] **Step 4: Send them to the webview**

In `src/extension/editor-provider.ts` (line 23), find:

```ts
import { getVaults, getKnowledgeServers, getKnowledgeRefreshAfterHours } from './settings';
```

replace with:

```ts
import { getVaults, getKnowledgeServers, getKnowledgeRefreshAfterHours, getVimConfig } from './settings';
```

In `src/extension/editor-provider.ts` (lines 280-283), find:

```ts
            } catch {
              this.knowledge.configure([]);
            }
            send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath, refPath: this.refPathFor(document) });
```

replace with:

```ts
            } catch {
              this.knowledge.configure([]);
            }
            // - the jump-label keys, before the canvas can take a key
            send({ type: 'vimConfig', config: getVimConfig() });
            send({ type: 'canvasLoaded', canvas, canvasPath: document.uri.fsPath, refPath: this.refPathFor(document) });
```

In `src/extension/editor-provider.ts` (lines 768-769), find:

```ts
      if (e.affectsConfiguration('skena.jupyter.kernels')) manager.reloadConfig();
    });
```

replace with:

```ts
      if (e.affectsConfiguration('skena.jupyter.kernels')) manager.reloadConfig();
      // - the editors and the canvas use new jump-label keys from the next key on
      if (e.affectsConfiguration('skena.vim')) send({ type: 'vimConfig', config: getVimConfig() });
    });
```

- [ ] **Step 5: Keep them in the webview**

Create `src/webview/canvas/vimSettings.ts`:

```ts
import type { VimConfig } from '../../shared/types';
import { DEFAULT_JUMP_LABELS, DEFAULT_LEADER, normalizeLeader } from './jumpLabels';

let current: VimConfig = { leader: DEFAULT_LEADER, jumpLabels: DEFAULT_JUMP_LABELS };

/**
 * skena.vim.* as the host sent them last (App.tsx). The editors and the canvas read them on every
 * key, so a change applies at once.
 */
export function vimSettings(): VimConfig {
  return current;
}

export function setVimSettings(c: VimConfig): void {
  current = {
    leader:     normalizeLeader(c.leader),
    jumpLabels: typeof c.jumpLabels === 'string' && c.jumpLabels !== '' ? c.jumpLabels : DEFAULT_JUMP_LABELS,
  };
}
```

In `src/webview/App.tsx` (line 21), find:

```tsx
import { installThemeVars } from './theme';
```

replace with:

```tsx
import { installThemeVars } from './theme';
import { setVimSettings } from './canvas/vimSettings';
```

In `src/webview/App.tsx` (lines 156-157), find:

```tsx
        case 'fileContent':
        case 'fileError':
```

replace with:

```tsx
        case 'vimConfig':
          setVimSettings(msg.config);
          break;
        case 'fileContent':
        case 'fileError':
```

- [ ] **Step 6: Typecheck and parse package.json**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"`
Expected: nothing.

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json parses')"`
Expected: `package.json parses`.

- [ ] **Step 7: Commit**

```bash
git add package.json src/shared/types.ts src/extension/settings.ts src/extension/editor-provider.ts src/webview/canvas/vimSettings.ts src/webview/App.tsx
git commit -m "feat(settings): skena.vim.leader and skena.vim.jumpLabels reach the webview"
```

---

### Task 5: Jump labels in one Monaco editor

**Files:**
- Create: `src/webview/canvas/editorJumpLabels.ts`
- Modify: `src/webview/styles/canvas.css` (append after the last line, 336)

Checked in the installed versions:
- `initVimMode` returns the adapter (`VimAdapterInstance`, `node_modules/monaco-vim/dist/index.d.mts`); `VimMode.Vim` is the Vim API object (TextNode's `getVimSingleton` reads it the same way, `TextNode.tsx:109-113`).
- Vim state per editor: `cm.state.vim` with `insertMode`, `visualMode`, `inputState.keyBuffer` (starts as `[]`, then a string), `inputState.operator`, `lastMotion`, `lastHPos` (`keymap_vim.ts:1336-1375`, `InputState` `:1764-1774`). Replace mode (`R`) sets `insertMode` too.
- After the first vim command `cm.curOp.isVimOp` stays `true` (`keymap_vim.ts:1726`; `operation()` only calls its function, `cm_adapter.ts:710-712`), so a cursor move from outside vim does not reset `lastHPos` through `handleExternalSelection` (`keymap_vim.ts:6948-6995`), and `moveByLines` (`:2808-2826`) reuses the old column after a vertical move. `jump` sets `lastMotion = null` and `lastHPos` itself.
- Monaco 0.55.1 (`node_modules/monaco-editor/monaco.d.ts`): `createDecorationsCollection` `:2870`, `IEditorDecorationsCollection.set`/`clear` `:2901`/`:2909`, `beforeContentClassName` `:1797`, `getVisibleRanges` `:6294`, `getContainerDomNode` `:6318`, `hasTextFocus` `:2702`, `onDidBlurEditorText` `:6030`, `onMouseDown` `:6072`.
- An inline (`inlineClassName`) decoration on an empty range is dropped when a line is drawn (`esm/vs/editor/common/viewLayout/lineDecorations.js:58-63`); a `beforeContentClassName` one is not, so a label on an empty line (`j`/`k`) is drawn. The before-content span is empty and its `::after` is absolutely positioned, so no text moves. VS Code draws decoration `contentText` the same way (a class plus a generated `::before`/`::after` rule).
- Monaco's own key bindings listen on the same container in the bubble phase (`esm/vs/editor/standalone/browser/standaloneServices.js:257-266`); `stopPropagation` in the capture phase stops them as well, so Esc while labels are shown does not reach any Monaco binding or the node's Esc handler.

- [ ] **Step 1: Write the module**

Create `src/webview/canvas/editorJumpLabels.ts`:

```ts
import type { editor as MonacoEditor } from 'monaco-editor';
import { VimMode, type VimAdapterInstance } from 'monaco-vim';
import { assignLabels, labelKey, leaderStep, lineStarts, vimKeyOf, wordStarts, type JumpDir, type LeaderState, type TextPos, type VisibleLine } from './jumpLabels';
import { vimSettings } from './vimSettings';

// - the parts of monaco-vim's per-editor state read and written here (keymap_vim.ts maybeInitVimState, InputState)
interface VimState {
  insertMode: boolean;
  visualMode: boolean;
  inputState: { keyBuffer: unknown; operator: string | null };
  lastMotion: unknown;
  lastHPos:   number;
}

// - VimMode.Vim is monaco-vim's Vim API object; handleKey(cm, key) runs one key as if typed
const Vim = (VimMode as unknown as { Vim: { handleKey(cm: unknown, key: string): unknown } }).Vim;

const STYLE_ID = 'skena-jump-labels';

function vimState(vim: VimAdapterInstance): VimState | null {
  return (vim as unknown as { state: { vim?: VimState | null } }).state.vim ?? null;
}

// - normal mode with nothing typed yet: no count, no pending f/t/r/m/'/", no operator. A leader typed
//   after one of those belongs to it (f; finds a ;).
function idleNormal(s: VimState | null): boolean {
  return !!s && !s.insertMode && !s.visualMode && !s.inputState.operator && String(s.inputState.keyBuffer ?? '') === '';
}

function cssString(s: string): string {
  return `"${s.replace(/["\\]/g, m => `\\${m}`)}"`;
}

// - the label text of each index, as ::after rules in one <style> shared by every editor; only the
//   focused editor shows labels, so the rules are rewritten each time labels are shown
function writeLabelStyle(labels: readonly string[]): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = labels.map((l, i) => `.monaco-editor .skena-jl-${i}::after { content: ${cssString(l)}; }`).join('\n');
}

// - the model lines Monaco shows in the viewport, ascending; folded lines are left out
function visibleLines(editor: MonacoEditor.IStandaloneCodeEditor): VisibleLine[] {
  const model = editor.getModel();
  if (!model) return [];
  const out: VisibleLine[] = [];
  let last = 0;
  for (const r of editor.getVisibleRanges()) {
    for (let line = Math.max(r.startLineNumber, last + 1); line <= r.endLineNumber; line++) {
      out.push({ line, text: model.getLineContent(line) });
      last = line;
    }
  }
  return out;
}

function targetsFor(dir: JumpDir, lines: VisibleLine[], cursor: TextPos): TextPos[] {
  switch (dir) {
    case 'l': return wordStarts(lines, cursor, 'forward');
    case 'h': return wordStarts(lines, cursor, 'backward');
    case 'j': return lineStarts(lines, cursor.line, 'down');
    case 'k': return lineStarts(lines, cursor.line, 'up');
  }
}

/**
 * Leader leader h/j/k/l in vim normal mode: a label over each word start (h/l) or line start (j/k)
 * on that side of the cursor in the visible lines; typing a label moves the cursor there.
 *
 * monaco-vim cannot bind it: its matcher (commandDispatcher.matchCommand) runs a full match at once
 * even when a longer mapping starts with it, so `;` (repeat f/t) would fire before a second key
 * arrives. The keys are read instead at capture on the editor's container, before Monaco and vim see
 * them. A leader that is not followed by a second leader is handed to vim then.
 *
 * Call once per editor, after initVimMode. The settings are read on every key: the chat input mounts
 * before the host has sent them.
 */
export function installJumpLabels(editor: MonacoEditor.IStandaloneCodeEditor, vim: VimAdapterInstance): void {
  const decorations = editor.createDecorationsCollection();
  let held: LeaderState = 0;
  let shown: { labels: string[]; targets: TextPos[]; typed: string } | null = null;

  // - an empty span before the target character; its ::after draws the label over the character(s)
  //   (canvas.css), so no text moves
  const draw = () => {
    if (!shown) { decorations.clear(); return; }
    const { labels, targets, typed } = shown;
    decorations.set(targets.flatMap((t, i) => (labels[i].startsWith(typed) ? [{
      range:   { startLineNumber: t.line, startColumn: t.col, endLineNumber: t.line, endColumn: t.col },
      options: { beforeContentClassName: `skena-jump-label skena-jl-${i}` },
    }] : [])));
  };

  const hide = () => {
    held = 0;
    if (!shown) return;
    shown = null;
    decorations.clear();
  };

  const show = (dir: JumpDir) => {
    const pos = editor.getPosition();
    if (!pos) return;
    const targets = targetsFor(dir, visibleLines(editor), { line: pos.lineNumber, col: pos.column });
    const { leader, jumpLabels } = vimSettings();
    const labels = assignLabels(targets.length, jumpLabels, leader);
    if (labels.length === 0) return;
    shown = { labels, targets: targets.slice(0, labels.length), typed: '' };
    writeLabelStyle(labels);
    draw();
  };

  const jump = (t: TextPos) => {
    editor.setPosition({ lineNumber: t.line, column: t.col });
    // - vim keeps the column of the last vertical move for the next j/k (moveByLines); without this a
    //   j right after the jump would go back to that old column
    const s = vimState(vim);
    if (s) {
      s.lastMotion = null;
      s.lastHPos = t.col - 1;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const k = { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
    if (shown) {
      // - every key is the labels' while they are shown: Monaco, vim and the node never see it
      e.preventDefault();
      e.stopPropagation();
      const m = labelKey(shown.labels, shown.typed, k);
      if (m.kind === 'ignore') return;
      if (m.kind === 'narrow') {
        shown = { ...shown, typed: m.prefix };
        draw();
        return;
      }
      const target = m.kind === 'jump' ? shown.targets[m.index] : null;
      hide();
      if (target) jump(target);
      return;
    }
    if (!editor.hasTextFocus()) return;
    if (held === 0 && !idleNormal(vimState(vim))) return;
    const { leader } = vimSettings();
    const step = leaderStep(held, k, leader);
    if (step.do === 'none') return;
    if (step.do === 'release') {
      // - the held leaders run as vim's own key (; repeats the last f/t), then this key goes on to vim
      held = 0;
      for (let i = 0; i < step.held; i++) Vim.handleKey(vim, vimKeyOf(leader));
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (step.do === 'hold') { held = step.next; return; }
    held = 0;
    show(step.dir);
  };

  const node = editor.getContainerDomNode();
  node.addEventListener('keydown', onKeyDown, { capture: true });
  const subs = [
    editor.onDidBlurEditorText(hide),
    editor.onMouseDown(hide),
    editor.onDidChangeModelContent(hide),
  ];
  editor.onDidDispose(() => {
    node.removeEventListener('keydown', onKeyDown, { capture: true });
    subs.forEach(d => d.dispose());
  });
}
```

- [ ] **Step 2: Add the label style**

Append to the end of `src/webview/styles/canvas.css`, after one blank line:

```css
/* - jump labels in an editor (editorJumpLabels.ts): Monaco puts an empty span before the target
   - character; its ::after draws the label over the character(s), so no text moves. The label text
   - comes from a rule per label in <style id="skena-jump-labels">. */
.monaco-editor .skena-jump-label { position: relative; }
.monaco-editor .skena-jump-label::after {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 3;
  background: #f01010;
  color: #fff;
  font-weight: 700;
  white-space: pre;
  pointer-events: none;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"`
Expected: nothing.

- [ ] **Step 4: Commit**

```bash
git add src/webview/canvas/editorJumpLabels.ts src/webview/styles/canvas.css
git commit -m "feat(jump): jump labels in a Monaco editor"
```

---

### Task 6: Text notes, code cells and the chat input

**Files:**
- Modify: `src/webview/canvas/nodes/TextNode.tsx:43`, `src/webview/canvas/nodes/TextNode.tsx:866-867`
- Modify: `src/webview/canvas/nodes/CodeNode.tsx:25`, `src/webview/canvas/nodes/CodeNode.tsx:354`, `src/webview/canvas/nodes/CodeNode.tsx:365-366`
- Modify: `src/webview/canvas/chat/ChatInput.tsx:10`, `src/webview/canvas/chat/ChatInput.tsx:201-203`, `src/webview/canvas/chat/ChatInput.tsx:211-212`

Each mount already calls `initVimMode` and the `patchVim…` functions; `installJumpLabels` goes after them. TextNode keeps the adapter in `vimMode` (`TextNode.tsx:855`); CodeNode and ChatInput need to keep theirs.

- [ ] **Step 1: Text notes**

In `src/webview/canvas/nodes/TextNode.tsx` (line 43), find:

```tsx
import { ensureCanvasWordCompletion } from '../canvasWordCompletion';
```

replace with:

```tsx
import { ensureCanvasWordCompletion } from '../canvasWordCompletion';
import { installJumpLabels } from '../editorJumpLabels';
```

In `src/webview/canvas/nodes/TextNode.tsx` (lines 866-867), find:

```tsx
    patchVimJoin(editorInstance, vimStatusRef.current);
    bindSuggestNav(editorInstance, monacoInstance);
```

replace with:

```tsx
    patchVimJoin(editorInstance, vimStatusRef.current);
    bindSuggestNav(editorInstance, monacoInstance);
    installJumpLabels(editorInstance, vimMode);
```

- [ ] **Step 2: Code cells**

In `src/webview/canvas/nodes/CodeNode.tsx` (line 25), find:

```tsx
import { applyVimClipboard, patchVimNewlineAndIndent, patchVimLastLine, patchVimBlockCursorBlink, patchVimVisualCursor, patchVimExternalSelection, patchVimDeleteLastLine, patchVimJoin, bindSuggestNav } from './TextNode';
```

replace with:

```tsx
import { applyVimClipboard, patchVimNewlineAndIndent, patchVimLastLine, patchVimBlockCursorBlink, patchVimVisualCursor, patchVimExternalSelection, patchVimDeleteLastLine, patchVimJoin, bindSuggestNav } from './TextNode';
import { installJumpLabels } from '../editorJumpLabels';
```

In `src/webview/canvas/nodes/CodeNode.tsx` (line 354), find:

```tsx
    initVimMode(editorInstance, vimStatusRef.current ?? undefined);
```

replace with:

```tsx
    const vimMode = initVimMode(editorInstance, vimStatusRef.current ?? undefined);
```

In `src/webview/canvas/nodes/CodeNode.tsx` (lines 365-366), find:

```tsx
    patchVimJoin(editorInstance, vimStatusRef.current);
    if (savedViewState.current) editorInstance.restoreViewState(savedViewState.current);
```

replace with:

```tsx
    patchVimJoin(editorInstance, vimStatusRef.current);
    installJumpLabels(editorInstance, vimMode);
    if (savedViewState.current) editorInstance.restoreViewState(savedViewState.current);
```

- [ ] **Step 3: Chat input**

In `src/webview/canvas/chat/ChatInput.tsx` (line 10), find:

```tsx
import { ensureCanvasWordCompletion } from '../canvasWordCompletion';
```

replace with:

```tsx
import { ensureCanvasWordCompletion } from '../canvasWordCompletion';
import { installJumpLabels } from '../editorJumpLabels';
```

In `src/webview/canvas/chat/ChatInput.tsx` (lines 201-203), find:

```tsx
    vimRef.current = initVimMode(editor, null) as { dispose: () => void };
    // - track the vim mode so Shift+H/J/K/L scroll only outside insert mode
    (vimRef.current as unknown as { on?: (ev: string, cb: (e: { mode: string }) => void) => void })
```

replace with:

```tsx
    const vim = initVimMode(editor, null);
    vimRef.current = vim;
    // - track the vim mode so Shift+H/J/K/L scroll only outside insert mode
    (vim as unknown as { on?: (ev: string, cb: (e: { mode: string }) => void) => void })
```

In `src/webview/canvas/chat/ChatInput.tsx` (lines 211-212), find:

```tsx
    applyVimClipboard();
    bindSuggestNav(editor, monaco);
```

replace with:

```tsx
    applyVimClipboard();
    bindSuggestNav(editor, monaco);
    installJumpLabels(editor, vim);
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"`
Expected: nothing.

Run: `npm run build`
Expected: three `⚡ Done in …` lines, no `✘ [ERROR]`. Leave the rewritten `.vscode/skena-mcp.js` unstaged.

- [ ] **Step 5: Commit**

```bash
git add src/webview/canvas/nodes/TextNode.tsx src/webview/canvas/nodes/CodeNode.tsx src/webview/canvas/chat/ChatInput.tsx
git commit -m "feat(jump): jump labels in text notes, code cells and the chat input"
```

- [ ] **Step 6: Manual check (the user runs this)**

Press Ctrl+F5 in VS Code; it builds and opens the Extension Development Host on `test/`. Open any canvas there. Settings at their defaults (leader `;`). The implementer reports this step as not run.

Text note: double-click a note, type a few lines with several words each, one empty line and one indented line, press `Esc` once (vim normal mode), put the cursor in the middle of a word on line 2.
- [ ] `;;l`: a red label with white text over the first character of each word start after the cursor in the visible lines; the nearest is `a`, then `s`, `d`… No text moves.
- [ ] Type the label of the third target: the cursor is on that word's first character, the labels are gone, the status bar still shows normal mode. Then `j`: the cursor goes down from the new column, not from an older one.
- [ ] `;;h`: labels on the word starts before the cursor, nearest first; the start of the word the cursor is in has `a`.
- [ ] `;;j`: a label on the first non-blank character of each line below; the empty line has its label in column 1. `;;k`: the same above. The cursor's own line has no label.
- [ ] Enough text for more than 26 targets after the cursor: the far ones have two-character labels. Type the first character: only labels that start with it stay. Type the second: the cursor jumps.
- [ ] `;;l` then `Esc`: labels gone, cursor not moved, the note is still in edit mode.
- [ ] `;;l` then a character no label starts with (e.g. `9`): labels gone, nothing typed or deleted.
- [ ] `;;l` then click in the text: labels gone.
- [ ] `fa` (cursor moves to the next `a`), then `;` then `l`: the cursor goes to the following `a`, then one to the right (the held `;` ran as vim's repeat-find before `l`).
- [ ] `f;` on a line containing `;`: the cursor moves to the `;` (a leader after `f` is vim's).
- [ ] `i` (insert mode), type `;;l`: the text `;;l` is inserted. `Esc`, `v` (visual), `;;l`: no labels.

Code cell: open a cell with `Enter`, `Esc` to normal mode.
- [ ] `;;j` and a label: the cursor moves; `Esc` with labels shown closes only the labels and the cell stays in edit mode.

Chat input: click into the chat input, type three lines, `Esc` to normal mode.
- [ ] `;;k` on the last line: labels on the two lines above; a label moves the cursor.

If a check fails, write down the editor, the keys pressed and what was seen.

---

### Task 7: Jump tags on the canvas

**Files:**
- Create: `src/webview/canvas/JumpTags.tsx`
- Modify: `src/webview/styles/canvas.css` (append after the rules from Task 5)
- Modify: `src/webview/canvas/gChord.ts:3`
- Modify: `src/webview/canvas/CanvasView.tsx:62`, `:550`, `:2567-2568`, `:2696`, `:2739`, `:3323-3328`, `:3332`, `:4206`

Checked in `CanvasView.tsx`:
- `h/j/k/l` focus a node with `focusNodeById(id)` (`:1790-1796`): `recordPreviousPosition` (the `` ` `` register), `lastFocusedNodeId`, selection, the `skena:focusNode` event, and `revealNode` (the smallest pan that shows it). A jump calls the same function.
- The keydown handler (`handler`, `:2652` on) returns early while the focus is in Monaco or an input (`inField`, `:2696`); the `g` chord's next key is read by `readGKey` (`:2552-2565`, called at `:2739`); `gCapture` (`:3316-3321`) takes every key at capture while the `g` badges are shown, and `G_BADGES_ATTR` on `<html>` makes a code cell's own window listener leave the key alone (`CodeNode.tsx:490`). The tags reuse both.
- Folded members: `hiddenByFoldRef` (`:880-881`). Groups never become React Flow nodes (`toFlowNodes`, `:165`), so `nodesRef` holds none. The pane rectangle above the docked chat console: `paneArea` (`:124-130`), the same one `revealNode` uses. Flow coordinates from pane pixels: `(paneX − viewport.x) / zoom`.
- `;` has no binding on the canvas today (no `e.key === ';'` in `CanvasView.tsx`).
- The badges are drawn by `EdgeFollowHints` (`EdgeFollowHints.tsx`) inside `<ReactFlow>` (`:4206`), projected with `useStore(s => s.transform)`. `JumpTags` does the same.

- [ ] **Step 1: The tag layer**

Create `src/webview/canvas/JumpTags.tsx`:

```tsx
import React from 'react';
import { useStore } from '@xyflow/react';

/** - one tag: the node it leads to, its label, and the node's top-left corner in flow coordinates */
export interface JumpTag { id: string; label: string; x: number; y: number }
/** - the tags leader leader h/j/k/l put on screen, and the keys typed so far */
export interface ShownTags { tags: JumpTag[]; typed: string }

/**
 * The tags shown after leader leader h/j/k/l on the canvas: a pointer-transparent layer over the pane,
 * like EdgeFollowHints, with the flow coordinates projected through React Flow's transform. Each tag
 * sits on its node's top-left corner, moved inside the pane when that corner is off screen. Once a
 * first character is typed only the tags that start with it stay.
 */
export function JumpTags({ shown }: { shown: ShownTags | null }): JSX.Element | null {
  const tx = useStore(s => s.transform[0]);
  const ty = useStore(s => s.transform[1]);
  const zoom = useStore(s => s.transform[2]);
  if (shown === null) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6, overflow: 'hidden' }}>
      {shown.tags.filter(t => t.label.startsWith(shown.typed)).map(t => (
        <div
          key={t.id}
          className="skena-jump-tag"
          style={{ left: Math.max(0, t.x * zoom + tx), top: Math.max(0, t.y * zoom + ty) }}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
```

Append to the end of `src/webview/styles/canvas.css`, after one blank line:

```css
/* - jump tags on the canvas (JumpTags.tsx): one on each target node's top-left corner */
.skena-jump-tag {
  position: absolute;
  padding: 1px 4px;
  border-radius: 3px;
  background: #f01010;
  color: #fff;
  font: 700 12px/14px 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  white-space: pre;
  user-select: none;
}
```

In `src/webview/canvas/gChord.ts` (line 3), find:

```ts
// - set on <html> while the badges are on screen, so a node's own key listener leaves the key to them
```

replace with:

```ts
// - set on <html> while the g badges or the jump tags are on screen, so a node's own key listener
//   leaves the key to them
```

- [ ] **Step 2: Imports and tag state in CanvasView**

In `src/webview/canvas/CanvasView.tsx` (line 62), find:

```tsx
import { G_BADGES_ATTR, gChordStep } from './gChord';
```

replace with:

```tsx
import { G_BADGES_ATTR, gChordStep } from './gChord';
import { JumpTags, type ShownTags } from './JumpTags';
import { assignLabels, labelKey, leaderStep, nodesInDirection, type JumpDir, type LeaderState } from './jumpLabels';
import { vimSettings } from './vimSettings';
```

In `src/webview/canvas/CanvasView.tsx` (line 550), find:

```tsx
  useEffect(() => closeG, [canvasPath, closeG]);
```

replace with:

```tsx
  useEffect(() => closeG, [canvasPath, closeG]);
  // - leader leader h/j/k/l: the leader presses held back so far (the keydown handler), and the tags
  //   on screen with the node each label leads to (jumpCapture reads the keys while they are shown)
  const leaderHeldRef = useRef<LeaderState>(0);
  const jumpRef       = useRef<{ labels: string[]; ids: string[]; typed: string } | null>(null);
  const [jumpShown, setJumpShown] = useState<ShownTags | null>(null);
  // - drop the tags and a held leader. G_BADGES_ATTR is set while the tags are shown, so a code
  //   cell's own key listener leaves the keys to them.
  const closeJump = useCallback(() => {
    leaderHeldRef.current = 0;
    jumpRef.current = null;
    document.documentElement.removeAttribute(G_BADGES_ATTR);
    setJumpShown(null);
  }, []);
  // - a click anywhere closes the tags; the click itself goes on as usual
  useEffect(() => {
    if (jumpShown === null) return;
    window.addEventListener('pointerdown', closeJump, { capture: true });
    return () => window.removeEventListener('pointerdown', closeJump, { capture: true });
  }, [jumpShown, closeJump]);
  // - a canvas switch drops the tags and a held leader
  useEffect(() => closeJump, [canvasPath, closeJump]);
```

- [ ] **Step 3: Show the tags and read their keys**

These go inside the keyboard `useEffect`, after `readGKey` and before `currentLane`; they use `focusedNode` and `toNav` defined above them in the same effect.

In `src/webview/canvas/CanvasView.tsx` (lines 2567-2568), find:

```tsx
    // - the section the keys act on: the focused node's, or — after a fold dropped the selection —
    //   the one holding the node focused last
```

replace with:

```tsx
    // - leader leader h/j/k/l: a tag on every visible node whose centre is on that side of the focused
    //   node's centre (the view's centre with nothing focused), nearest first. Visible: overlapping the
    //   part of the pane above the chat console, not in a folded section. Groups are never React Flow
    //   nodes (toFlowNodes), so they need no filter here.
    const showJumpTags = (dir: JumpDir) => {
      if (!wrapperRef.current) return;
      const area = paneArea(wrapperRef.current);
      const { x: vx, y: vy, zoom } = rfRef.current.getViewport();
      const view: Rect = {
        left: (area.left - vx) / zoom, top: (area.top - vy) / zoom,
        right: (area.right - vx) / zoom, bottom: (area.bottom - vy) / zoom,
      };
      const from = focusedNode();
      const f = from ? toNav(from) : null;
      const origin = f
        ? { x: f.x + f.w / 2, y: f.y + f.h / 2 }
        : { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
      const navs = nodesRef.current.filter(n => !hiddenByFoldRef.current.has(n.id)).map(toNav);
      const near = nodesInDirection(navs, origin, view, dir);
      const { leader, jumpLabels } = vimSettings();
      const labels = assignLabels(near.length, jumpLabels, leader);
      if (labels.length === 0) return;
      const targets = near.slice(0, labels.length);
      jumpRef.current = { labels, ids: targets.map(n => n.id), typed: '' };
      document.documentElement.setAttribute(G_BADGES_ATTR, '1');
      setJumpShown({ tags: targets.map((n, i) => ({ id: n.id, label: labels[i], x: n.x, y: n.y })), typed: '' });
    };

    // - a key while the tags are shown: a whole label focuses its node as h/j/k/l would, a first
    //   character keeps the tags that start with it, Esc or any other key closes them and does nothing else
    const readJumpKey = (e: KeyboardEvent) => {
      const shown = jumpRef.current;
      if (!shown) return;
      const m = labelKey(shown.labels, shown.typed, { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
      if (m.kind === 'ignore') return;
      if (m.kind === 'narrow') {
        jumpRef.current = { ...shown, typed: m.prefix };
        setJumpShown(s => (s ? { ...s, typed: m.prefix } : s));
        return;
      }
      closeJump();
      if (m.kind === 'jump') focusNodeById(shown.ids[m.index]);
    };

    // - the section the keys act on: the focused node's, or — after a fold dropped the selection —
    //   the one holding the node focused last
```

- [ ] **Step 4: The leader keys in the keydown handler**

In `src/webview/canvas/CanvasView.tsx` (line 2696), find:

```tsx
      if (inField) return;
```

replace with:

```tsx
      if (inField) { leaderHeldRef.current = 0; return; }
```

In `src/webview/canvas/CanvasView.tsx` (line 2739), find:

```tsx
      if (readGKey(e)) return;
```

replace with:

```tsx
      if (readGKey(e)) return;

      // - leader leader h/j/k/l shows the jump tags. The leader followed by any other key is dropped
      //   and that key is handled below as usual.
      const lead = leaderStep(leaderHeldRef.current, { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }, vimSettings().leader);
      if (lead.do === 'hold') { e.preventDefault(); leaderHeldRef.current = lead.next; return; }
      if (lead.do === 'show') { e.preventDefault(); leaderHeldRef.current = 0; showJumpTags(lead.dir); return; }
      if (lead.do === 'release') leaderHeldRef.current = 0;
```

- [ ] **Step 5: Read the keys at capture while the tags are shown**

In `src/webview/canvas/CanvasView.tsx` (lines 3323-3328), find:

```tsx
    // - gCapture before panCapture: listeners on one target run in the order they were added
    window.addEventListener('keydown', gCapture, { capture: true });
    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', panCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', gCapture, { capture: true });
```

replace with:

```tsx
    // - while the tags are shown the next key is theirs, wherever the focus sits (as gCapture)
    const jumpCapture = (e: KeyboardEvent) => {
      if (!jumpRef.current) return;
      readJumpKey(e);
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // - jumpCapture and gCapture before panCapture: listeners on one target run in the order they were added
    window.addEventListener('keydown', jumpCapture, { capture: true });
    window.addEventListener('keydown', gCapture, { capture: true });
    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', panCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', jumpCapture, { capture: true });
      window.removeEventListener('keydown', gCapture, { capture: true });
```

In `src/webview/canvas/CanvasView.tsx` (line 3332), find:

```tsx
withKeepRow, canvasPath, closeG, revealBox]); // - nodesRef + spaceSelectedRef carry live state
```

replace with:

```tsx
withKeepRow, canvasPath, closeG, revealBox, closeJump]); // - nodesRef + spaceSelectedRef carry live state
```

- [ ] **Step 6: Draw the tags**

In `src/webview/canvas/CanvasView.tsx` (line 4206), find:

```tsx
        <EdgeFollowHints shown={gShown} />
```

replace with:

```tsx
        <EdgeFollowHints shown={gShown} />
        <JumpTags shown={jumpShown} />
```

- [ ] **Step 7: Typecheck, build, run the existing canvas tests**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/extension/editor-provider.ts"`
Expected: nothing.

Run: `npm run build`
Expected: three `⚡ Done in …` lines, no `✘ [ERROR]`.

Run: `npx esbuild src/webview/canvas/gChord.ts --bundle --format=esm --outfile=tests/.build/gChord.mjs && node --test tests/g-chord.mjs`
Expected: `# pass 5`, `# fail 0`.

Run: `npx esbuild src/webview/canvas/spatialNav.ts --bundle --format=esm --outfile=tests/.build/spatialNav.mjs && node --test tests/spatial-nav.mjs`
Expected: `# pass 61`, `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/webview/canvas/JumpTags.tsx src/webview/styles/canvas.css src/webview/canvas/gChord.ts src/webview/canvas/CanvasView.tsx
git commit -m "feat(jump): jump tags on the canvas"
```

- [ ] **Step 9: Manual check (the user runs this)**

Ctrl+F5, open a canvas with a dozen or more nodes in more than one direction from some node. The implementer reports this step as not run.
- [ ] Focus a node with neighbours on all sides. `;;l`: a red tag on the top-left corner of every visible node whose centre is right of the focused node's centre; the nearest has `a`. Nodes in a folded section and nodes hidden under the chat console have no tag.
- [ ] Type a tag: that node is selected and the view pans by the smallest move that shows it, as `l` does. Then `` ` ` ``: back to the node you came from.
- [ ] `;;h`, `;;j`, `;;k`: the same for left, below, above.
- [ ] Click empty canvas so nothing is selected, then `;;l`: tags on the nodes right of the view's centre.
- [ ] Zoom out until more than 26 nodes are on one side: the far ones have two-character tags; the first character leaves only the tags that start with it; the second jumps.
- [ ] `;;l` then `Esc`: tags gone, selection unchanged. `;;l` then `9`: tags gone, nothing else happens.
- [ ] Select a code cell (not editing), `;;l`, then `Enter`: tags gone, the cell does not open its editor.
- [ ] `;;l`, then click a node: tags gone, the node is selected.
- [ ] `;` then `l`: plain `l` navigation (the `;` is dropped). `;` then `z`: zooms in as `z` always does.
- [ ] `;;l` with the tags shown, switch to another canvas tab and back: no tags left over.
- [ ] `g` still shows its badges; `gg` still goes to the first node of the section.

If a check fails, write down the node label, the keys pressed and what was seen.

---

### Task 8: Settings check

**Files:** none. The user runs this; the implementer reports it as not run.

- [ ] In the Extension Development Host, open Settings and search `skena.vim`: two entries, `Vim: Leader` (`;`) and `Vim: Jump Labels` (`asdfghjklqwertyuiopzxcvbnm`).
- [ ] Set `"skena.vim.leader": ","` in the user settings JSON. Without reloading: on the canvas `,,l` shows tags and `;;l` does not. In a text note already in edit mode, normal mode: `,,j` shows labels; `fa` then `,` then `l` moves back to the previous `a` and then right (vim's `,`).
- [ ] Set `"skena.vim.jumpLabels": "fj"` (leader still `,`). On the canvas `,,l` with two nodes on that side: tags `f` and `j`; with three: `f`, `jf`, `jj`; with four: `ff`, `fj`, `jf`, `jj`; a fifth node gets no tag.
- [ ] Set `"skena.vim.jumpLabels": ","` (only the leader): the labels fall back to the default characters, without `,`.
- [ ] Remove both settings: `;` works again as the leader.

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| Leader is `skena.vim.leader`, one key, default `;` | Task 4 (`package.json` `minLength`/`maxLength` 1, `normalizeLeader`, Task 1 test 12) |
| leader leader `l`/`h`: word starts after/before the cursor in the visible lines | `wordStarts` (Task 2, tests 13-15), `visibleLines` + `targetsFor` (Task 5) |
| leader leader `j`/`k`: first non-blank of each visible line below/above, column 1 if empty | `lineStarts` (Task 2, tests 16-17) |
| Canvas: visible nodes whose centre is right/left/below/above the focused node's centre | `nodesInDirection` (Task 3, tests 18-20), `showJumpTags` (Task 7) |
| Visible: overlap the view, not folded, not groups; no focus → view centre | `showJumpTags` (`paneArea`, `hiddenByFoldRef`, groups not in `nodesRef`, origin fallback) |
| Editors: normal mode only; insert and visual untouched | `idleNormal` (Task 5); manual check Task 6 |
| Leader then another key keeps the leader's meaning (editor: `;` runs, then the key; canvas: as if not pressed) | `leaderStep` `release` (Task 1 tests 9-11); `Vim.handleKey` replay (Task 5); canvas `release` (Task 7) |
| Label characters from `skena.vim.jumpLabels`; leader never a label | `assignLabels` (Task 1 tests 5-6) |
| Nearest first; T ≤ N one character; T > N two-character groups; no prefix | `assignLabels` (Task 1 tests 1-4); targets ordered by Tasks 2-3 |
| Drawn over the first character(s), text unchanged; canvas tags top-left; red `#f01010`, white | `beforeContentClassName` + `::after` (Task 5 CSS), `JumpTags` + `.skena-jump-tag` (Task 7) |
| First character of a two-character label narrows; full label jumps; Esc or a non-matching key cancels and is not passed on | `matchKeys`/`labelKey` (Task 1 tests 7-8); both key readers stop the key (Tasks 5, 7) |
| Editor: cursor to the target, mode stays normal | `jump` (Task 5) |
| Canvas: focus exactly as `h/j/k/l` | `focusNodeById` (Task 7) |
| Settings read by the webview; editors opened after a change and the canvas at once | `vimConfig` message + store (Task 4); read on every key (reaches open editors too, see below) |
| Tests: word/line starts, label assignment, typed keys, canvas direction filter | `tests/jump-labels.mjs`, 20 tests |
| Out of scope (operators, visual mode, jump list, cross-node jumps, Leap/Flash, off-screen) | none of these are implemented |

## Points the spec does not settle, or that differ from it

Each is in the code as described; the user may want another choice.
1. **Binding through monaco-vim's `Vim` object** is not possible for `;;l` while `;` keeps its meaning (see "Why the editor keys are not bound through monaco-vim"). Keys are read at capture on the editor container instead.
2. **Settings in editors** are read on every key, not at mount, because the chat input mounts before the host sends them. A change therefore also reaches editors already open.
3. **Leader leader + a key other than `h/j/k/l`**: the spec covers only "leader followed by anything other than the leader". Here: in an editor both leaders run as vim's `;` (twice), then the key; on the canvas both are dropped and the key is handled as usual. Leader leader leader: the third leader is a new key for vim (editor) or nothing (canvas).
4. **A leader with its own canvas binding** (e.g. space, `z`, `c`): on the canvas that key's own action is lost when it is followed by another key, as the spec's "handled as if the leader had not been pressed" says. With the default `;` nothing is lost.
5. **A leader typed after a count, `f`/`t`/`r`/`m`/`'`/`"` or an operator** goes to vim (`f;` finds `;`, `d;` deletes to the repeated find). `idleNormal` checks this.
6. **Empty lines are not word starts** (`h`/`l`), following the spec's rule; vim's `w` does stop on them. A line of only blanks gives column 1 for `j`/`k`, like an empty line.
7. **A modifier pressed alone** (Shift, Ctrl, Alt, Meta) keeps the labels and a held leader, so a label character or leader typed with Shift works. (`g` badges close on it.)
8. **After the first character of a two-character label** the remaining labels still show both characters.
9. **Canvas tag position**: a node whose top-left corner is off screen gets its tag at the pane's edge, so every labelled node shows its tag. "Visible" is the part of the pane above the docked chat console.
10. **More than N × N targets** (676 with the default characters): the farthest get no label.
11. **The jump resets vim's remembered column** (`lastHPos`, `lastMotion`), so `j`/`k` after it start from the new column.
