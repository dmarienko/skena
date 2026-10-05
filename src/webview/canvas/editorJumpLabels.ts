import type { editor as MonacoEditor } from 'monaco-editor';
import { VimMode, type VimAdapterInstance } from 'monaco-vim';
import { assignLabels, labelKey, leaderStep, lineStarts, vimKeyOf, wordStarts, type JumpDir, type JumpKey, type LeaderState, type TextPos, type VisibleLine } from './jumpLabels';
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

// - set on an editor's container while its labels are shown. A keydown listener on window in the
//   capture phase runs before the container's, so it has to leave such a key alone.
export const JUMP_LABELS_ATTR = 'data-skena-jump-labels';

/** - the key was typed in an editor whose labels are shown */
export function inJumpLabels(e: Event): boolean {
  return e.target instanceof Element && e.target.closest(`[${JUMP_LABELS_ATTR}]`) !== null;
}

// - the editor that holds a leader now; only the focused one can
let holder: { take(e: KeyboardEvent): void } | null = null;

// - a key that ends a held leader: the leader runs as vim's key here and the key goes on untouched, so
//   the window listeners that React effects add later (ChatInput, useFloatingChat) and the editor get it
//   as usual. Added at module load, so it runs before those listeners.
window.addEventListener('keydown', e => holder?.take(e), { capture: true });

function keyOf(e: KeyboardEvent): JumpKey {
  return { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
}

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

// - the targets drawn inside the text area, in the order given, on lines shown whole. A line that does
//   not wrap (code cells) can have word starts scrolled off to the left or right; those get no label.
function onScreen(editor: MonacoEditor.IStandaloneCodeEditor, targets: TextPos[]): TextPos[] {
  const { contentLeft, contentWidth, verticalScrollbarWidth, height, horizontalScrollbarHeight } = editor.getLayoutInfo();
  // - contentWidth includes the vertical scrollbar and height the horizontal one (computeLayout in editorOptions.js)
  const right = contentLeft + contentWidth - verticalScrollbarWidth;
  const bottom = height - horizontalScrollbarHeight;
  return targets.filter(t => {
    const p = editor.getScrolledVisiblePosition({ lineNumber: t.line, column: t.col });
    return !!p && p.left >= contentLeft && p.left < right && p.top >= 0 && p.top + p.height <= bottom;
  });
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
  const node = editor.getContainerDomNode();
  let held: LeaderState = 0;
  let shown: { labels: string[]; targets: TextPos[]; typed: string } | null = null;

  // - the window listener at the top of this module ends a held leader before other window listeners
  //   take the key
  const self = {
    take(e: KeyboardEvent) {
      if (shown || held === 0) return;
      const step = leaderStep(held, keyOf(e), vimSettings().leader);
      if (step.do === 'release') release(step.held);
    },
  };

  const sync = () => {
    node.toggleAttribute(JUMP_LABELS_ATTR, shown !== null);
    if (held !== 0) holder = self;
    else if (holder === self) holder = null;
  };

  // - the held leaders run as vim's own key (; repeats the last f/t); the key that ended them goes on as usual
  const release = (count: 1 | 2) => {
    held = 0;
    sync();
    try {
      for (let i = 0; i < count; i++) Vim.handleKey(vim, vimKeyOf(vimSettings().leader));
    } catch {
      // - the command findKey returns (keymap_vim.ts) resets vim's state and logs the error before rethrowing it
    }
  };

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
    if (shown) {
      shown = null;
      decorations.clear();
    }
    sync();
  };

  const show = (dir: JumpDir) => {
    const pos = editor.getPosition();
    if (!pos) return;
    const targets = onScreen(editor, targetsFor(dir, visibleLines(editor), { line: pos.lineNumber, col: pos.column }));
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

  const readKey = (e: KeyboardEvent) => {
    const k = keyOf(e);
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
      // - the window listener has normally done this already; here for a key that did not reach it
      release(step.held);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (step.do === 'hold') { held = step.next; return; }
    held = 0;
    show(step.dir);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    readKey(e);
    sync();
  };

  node.addEventListener('keydown', onKeyDown, { capture: true });
  const subs = [
    editor.onDidBlurEditorText(hide),
    editor.onMouseDown(hide),
    editor.onDidChangeModelContent(hide),
  ];
  editor.onDidDispose(() => {
    node.removeEventListener('keydown', onKeyDown, { capture: true });
    node.removeAttribute(JUMP_LABELS_ATTR);
    if (holder === self) holder = null;
    subs.forEach(d => d.dispose());
  });
}
