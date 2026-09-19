/**
 * TextNode — inline markdown text node.
 * View mode: renders markdown (including inline images relative to canvas dir).
 * Edit mode: Monaco editor with vim keybindings.
 *
 * Enter edit mode:  double-click OR press Enter while node is focused/selected
 * Exit edit mode:   Esc / Ctrl+Cmd+Enter / click outside — all save content
 *
 * Clipboard (vim mode):
 *   VS Code webview sandbox blocks navigator.clipboard, so all clipboard I/O is
 *   relayed through the extension host via vscode.env.clipboard.
 *
 *   Vim's `+` and `*` registers (system clipboard) are wired to the extension host:
 *     set(text) → writeClipboard → vscode.env.clipboard.writeText
 *     get()     → returns clipboardCache (populated by requestClipboardRead)
 *
 *   clipboard=unnamedplus makes all unnamed y/p operations use `+` (system clipboard),
 *   so `yy` writes to system clipboard and `p` pastes from it — the standard vim way.
 *
 *   Clipboard cache is refreshed:
 *     • when editing starts (so `p` works immediately)
 *     • every time Monaco gains focus (so external copies are picked up)
 *
 *   Ctrl+V (non-vim fallback): sends requestClipboardRead and inserts on response.
 *   Note: in vim normal/visual mode Ctrl+V is intercepted by vim itself (visual block)
 *   so this only fires in Monaco's own insert/non-vim context.
 */

import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode, VimMode } from 'monaco-vim';
import { TextNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { useHighlightedHtml } from '../../lib/codeHighlight';
import { useHostMarkdown } from '../../hooks/useHostMarkdown';
import { ScrollableContent } from '../../components/ScrollableContent';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { nodeBorderColor } from '../palette';
import { stripForHost, rememberWritten, classifyHostText } from '../vimClipboard';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// ─── module-level clipboard state ────────────────────────────────────────────
// - shared across all TextNode instances; only one Monaco editor is active at a time

/** - cached system clipboard text; vim's + register get() reads this synchronously */
let clipboardCache: { text: string; linewise: boolean } = { text: '', linewise: false };

/**
 * - true when Ctrl+V was pressed and we're waiting for the async clipboard response.
 * - The clipboardContent handler checks this flag and inserts text into Monaco.
 */
let pendingPaste = false;

/**
 * Hand text to the host clipboard and record it, so a read-back can be recognised as ours.
 * `full` is the register form; `out` overrides what the host gets for callers that are not
 * writing a register (the Ctrl+C copy sends the selection verbatim).
 */
function writeHostClipboard(full: string, linewise: boolean, out?: string): void {
  const sent = out ?? stripForHost(full, linewise);
  rememberWritten(sent, full, linewise);
  vscodePostMessage({ type: 'writeClipboard', text: sent });
}

// ─── vim clipboard wiring ────────────────────────────────────────────────────
//
// - monaco-vim 0.4.4 does NOT implement the `clipboard` option (unnamedplus),
// - so setOption('clipboard','unnamedplus') silently does nothing.
// - y/p always use the unnamed " register, never the + register.
//
// - Fix: replace the unnamed " register (and + / * aliases) in the
// - RegisterController with a custom relay register that:
// -   setText / pushText → writes to clipboardCache + sends writeClipboard to host
// -   toString           → reads from clipboardCache (async-updated; covers cross-canvas)
// -   linewise           → synced from clipboardCache on every clipboardContent event
//
// - The register must implement the full vim Register interface:
// -   setText, pushText, clear, toString, pushInsertModeChanges, pushSearchQuery.
//
// - applyVimClipboard() MUST be called after every initVimMode() because
// - initVimMode can call resetVimGlobalState which recreates RegisterController.

type VimRegisterLike = {
  setText:                (text: string, linewise: boolean, blockwise?: boolean) => void;
  pushText:               (text: string, linewise: boolean) => void;
  clear:                  () => void;
  toString:               () => string;
  linewise:               boolean;
  blockwise:              boolean;
  keyBuffer:              string[];
  insertModeChanges:      unknown[];
  searchQueries:          string[];
  pushInsertModeChanges?: (changes: unknown) => void;
  pushSearchQuery?:       (query: string) => void;
};

type VimSingleton = {
  defineRegister:        (n: string, r: unknown) => void;
  getRegisterController: () => { registers: Record<string, VimRegisterLike>; unnamedRegister: VimRegisterLike };
};

function getVimSingleton(): VimSingleton | undefined {
  // - VimMode is the default export of keymap_vim (the CodeMirror object)
  // - which has Vim = Vim() set on it at module load.
  return (VimMode as unknown as Record<string, unknown>).Vim as VimSingleton | undefined;
}

/** - relay register: replaces " (unnamed), + and * to route all y/p through extension-host clipboard */
const sysReg: VimRegisterLike = {
  keyBuffer:         [''],
  linewise:          false,
  blockwise:         false,
  insertModeChanges: [],
  searchQueries:     [],

  setText(text: string, linewise: boolean, blockwise?: boolean) {
    const full = text ?? '';
    this.keyBuffer = [full];
    this.linewise  = !!linewise;
    this.blockwise = !!blockwise;
    clipboardCache = { text: full, linewise: !!linewise };
    writeHostClipboard(full, !!linewise);
  },
  pushText(text: string, linewise: boolean) {
    if (linewise) {
      if (!this.linewise) this.keyBuffer.push('\n');
      this.linewise = true;
    }
    this.keyBuffer.push(text);
    const full = this.keyBuffer.join('');
    clipboardCache = { text: full, linewise: this.linewise };
    writeHostClipboard(full, this.linewise);
  },
  clear() {
    this.keyBuffer         = [];
    this.linewise          = false;
    this.blockwise         = false;
    this.insertModeChanges = [];
    this.searchQueries     = [];
  },
  toString() {
    // - prefer async-updated cache: covers cross-canvas paste where clipboardCache
    // - was refreshed via requestClipboardRead ↔ clipboardContent round-trip.
    return clipboardCache.text !== '' ? clipboardCache.text : this.keyBuffer.join('');
  },
  pushInsertModeChanges(changes: unknown) { this.insertModeChanges.push(changes); },
  pushSearchQuery(query: string)          { this.searchQueries.push(query); },
};

/**
 * Patch monaco-vim's broken newlineAndIndent command.
 *
 * Root cause: CMAdapter.commands.newlineAndIndent calls
 *   editor.trigger("vim", "editor.action.insertLineAfter")
 * which is queued/deferred by Monaco and doesn't fire reliably when invoked
 * from inside a vim key-handler callback (the action runs after insertMode is
 * already set, producing no visible effect — just 'A' without the newline).
 *
 * Fix: replace with a synchronous executeEdits('\n') at the current cursor.
 * The cursor is already at EOL when newlineAndIndent is called (set by
 * newLineAndEnterInsertMode before it invokes this function), so inserting
 * '\n' there is exactly right for both 'o' (after: true) and 'O' (after: false).
 *
 * VimMode IS the CMAdapter class (default export from cm/keymap_vim which
 * re-exports cm_adapter), so VimMode.commands is the static commands table.
 * Patching it once here is global and persists across editor mounts.
 */
export function patchVimNewlineAndIndent(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CM = VimMode as any;
  if (!CM?.commands) return;

  CM.commands.newlineAndIndent = function(cm: any) {
    const editor = cm.editor as MonacoEditor.IStandaloneCodeEditor;
    const pos = editor.getPosition();
    if (!pos) return;
    // - autoindent: carry the current line's leading whitespace onto the new line (vim `o`/`O`),
    //   plus one extra step after a Python block opener (`:`) so `def f():`→o lands indented
    const model = editor.getModel();
    const line  = model ? model.getLineContent(pos.lineNumber) : '';
    const base  = (line.match(/^[ \t]*/) ?? [''])[0];
    const extra = /:\s*(#.*)?$/.test(line) ? '    ' : '';
    const indent = base + extra;
    editor.executeEdits('vim-o', [{
      range: {
        startLineNumber: pos.lineNumber, startColumn: pos.column,
        endLineNumber:   pos.lineNumber, endColumn:   pos.column,
      },
      text: '\n' + indent,
    }]);
    // - place the cursor after the inserted indent on the new line
    editor.setPosition({ lineNumber: pos.lineNumber + 1, column: indent.length + 1 });
  };
}

/**
 * Make vim's linewise ranges reach the last line.
 *
 * CodeMirror's document has a position one line past the last line, and vim builds every linewise
 * range to end on it ({line: lastLine + 1, ch: 0}). Monaco has no such position: validatePosition
 * clamps the LINE but keeps the COLUMN, so the range ends at column 1 of the last line and that
 * line falls outside it. On a one-line cell `yy` yanks "\n" and `dd` does nothing; `j dd` on
 * "ab\ncd" joins the two lines; `V j y` on "ab\ncd" yanks "ab\n".
 *
 * Fix: clip any position past the document end to the END of the last line, the way CodeMirror's
 * clipPos does, in the four adapter methods that receive CM positions from vim.
 *
 * VimMode IS the CMAdapter class, so patching its prototype covers every editor instance.
 * Idempotent via a flag on the prototype, and independent of when it runs vs initVimMode().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clipPastDocEnd(pos: any, model: MonacoEditor.ITextModel, lastLine: number): any {
  if (!pos || typeof pos.line !== 'number' || pos.line <= lastLine) return pos;
  // - CM lines are 0-based, Monaco's 1-based; getLineMaxColumn is one past the last character
  return { line: lastLine, ch: model.getLineMaxColumn(lastLine + 1) - 1 };
}

export function patchVimLastLine(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const P = (VimMode as any)?.prototype;
  if (!P || P.__skenaLastLineClip) return;

  const origSetSelections = P.setSelections;
  P.setSelections = function(this: any, selections: any[], primIndex?: number) {
    const model = this.editor.getModel();
    let sels = selections;
    if (model && sels) {
      const lastLine = model.getLineCount() - 1;
      sels = sels.map((sel: any) => ({
        ...sel,
        anchor: clipPastDocEnd(sel.anchor, model, lastLine),
        head:   clipPastDocEnd(sel.head,   model, lastLine),
      }));
    }
    return origSetSelections.call(this, sels, primIndex);
  };

  const origSetSelection = P.setSelection;
  P.setSelection = function(this: any, frm: any, to: any) {
    const model = this.editor.getModel();
    if (!model) return origSetSelection.call(this, frm, to);
    const lastLine = model.getLineCount() - 1;
    return origSetSelection.call(this, clipPastDocEnd(frm, model, lastLine), clipPastDocEnd(to, model, lastLine));
  };

  const origGetRange = P.getRange;
  P.getRange = function(this: any, start: any, end: any) {
    const model = this.editor.getModel();
    if (!model) return origGetRange.call(this, start, end);
    const lastLine = model.getLineCount() - 1;
    return origGetRange.call(this, clipPastDocEnd(start, model, lastLine), clipPastDocEnd(end, model, lastLine));
  };

  const origReplaceRange = P.replaceRange;
  P.replaceRange = function(this: any, text: string, start: any, end: any) {
    const model = this.editor.getModel();
    if (!model) return origReplaceRange.call(this, text, start, end);
    const lastLine = model.getLineCount() - 1;
    // - `end` is optional: replaceRange(text, pos) is an insert at `pos`
    return origReplaceRange.call(this, text, clipPastDocEnd(start, model, lastLine),
      end ? clipPastDocEnd(end, model, lastLine) : end);
  };

  P.__skenaLastLineClip = true;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Draw vim's block cursor on the last SELECTED character in visual mode.
 *
 * monaco-vim keeps cursorStyle "block" in visual mode, and Monaco draws the block at the
 * selection END, which is exclusive: on "12345", `v l l l` selects "1234" but the block sits
 * on "5". Vim draws it on "4". CodeMirror's vim fixes this with $customCursor
 * (transformCursor), which the Monaco adapter ignores; its markText() is a no-op too.
 *
 * So: hide Monaco's own cursor while visual mode is on and paint a one-character decoration at
 * vim.sel.head, which is the inclusive cursor character in char, line and block visual mode.
 *
 * The sync runs in a microtask because exitVisualMode() calls cm.setCursor() BEFORE it clears
 * vim.visualMode — a synchronous hook would leave a stale block after Esc. Rendering happens
 * after microtasks, so nothing flickers.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function syncVisualCursor(cm: any): void {
  const editor = cm.editor as MonacoEditor.IStandaloneCodeEditor;
  const vim    = cm.state?.vim;
  const model  = editor.getModel();
  if (!model) return;

  const collection = (cm.__skenaFatCursor ??= editor.createDecorationsCollection());
  // - the container, not getDomNode(): Monaco rewrites the .monaco-editor element's whole
  // - className on focus / theme / config change, which would drop the class on refocus
  const dom    = editor.getContainerDomNode();
  const visual = !!vim?.sel?.head && vim.visualMode && !vim.insertMode;

  if (!visual) {
    collection.clear();
    dom?.classList.remove('skena-vim-visual');
    return;
  }

  // - clamp: vim state can name a line the model no longer has (an edit landed between the
  // - key and this microtask) and getLineMaxColumn throws past the end
  const head = vim.sel.head;                      // - CodeMirror 0-based {line, ch}
  const line = Math.min(Math.max(1, head.line + 1), model.getLineCount());
  const max  = model.getLineMaxColumn(line);
  const col  = Math.min(Math.max(1, head.ch + 1), max);
  collection.set([col < max
    ? {
      range:   { startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col + 1 },
      options: { inlineClassName: 'skena-vim-fat-cursor' },
    }
    : {
      // - empty line or head past the last character: no glyph to paint over
      range:   { startLineNumber: line, startColumn: max, endLineNumber: line, endColumn: max },
      options: { afterContentClassName: 'skena-vim-fat-cursor-eol' },
    }]);
  dom?.classList.add('skena-vim-visual');
}

export function scheduleVisualCursorSync(cm: any): void {
  if (cm.__skenaFatPending) return;
  cm.__skenaFatPending = true;
  queueMicrotask(() => { cm.__skenaFatPending = false; syncVisualCursor(cm); });
}

export function patchVimVisualCursor(): void {
  const P = (VimMode as any)?.prototype;
  if (!P || P.__skenaVisualCursor) return;

  for (const name of ['setSelections', 'setSelection', 'setCursor'] as const) {
    const orig = P[name];
    if (!orig) continue;
    P[name] = function(this: any, ...args: any[]) {
      const r = orig.apply(this, args);
      scheduleVisualCursorSync(this);
      return r;
    };
  }

  P.__skenaVisualCursor = true;
}

/**
 * Let a selection made with the mouse put vim into visual mode.
 *
 * monaco-vim's onCursorActivity only calls handleExternalSelection (the function that enters or
 * leaves visual mode to match a selection vim did not make) when cm.curOp.isVimOp is false.
 * CodeMirror builds a fresh curOp per operation so the flag resets by itself; the Monaco adapter
 * creates one curOp in its constructor and its operation() is just `fn()`, so the first vim key
 * sets isVimOp = true and nothing ever clears it. From then on every mouse drag is treated as
 * vim's own work: vim stays in normal mode, `y` yanks the old selection, and the block cursor
 * drawn by patchVimVisualCursor never moves.
 *
 * Fix: clear isVimOp only while dispatching a cursorActivity that Monaco itself marked as
 * pointer-driven. Monaco's ViewController stamps source: 'mouse' on every click, drag and
 * double-click (viewController.js:177/192/202/233); that travels through CursorStateChangedEvent
 * into the ICursorPositionChangedEvent the adapter hands to dispatch (codeEditorWidget.js:1314).
 * Nothing vim does carries that source, so every vim key path keeps isVimOp exactly as
 * monaco-vim left it — including the ones that run OUTSIDE cm.operation and would otherwise be
 * read as external: Esc (handleEsc sits in findKey, before the operation), the / prompt's
 * onPromptClose, and :s///c's confirm loop.
 */
export function patchVimExternalSelection(): void {
  const P = (VimMode as any)?.prototype;
  if (!P || P.__skenaExternalSelection) return;

  const origDispatch = P.dispatch;
  P.dispatch = function(this: any, signal: string, ...args: any[]) {
    // - the adapter dispatches cursorActivity as (cm, monacoEvent)
    const mouse = signal === 'cursorActivity' && args[1]?.source === 'mouse' && this.curOp;
    let r;
    if (mouse) {
      const was = this.curOp.isVimOp;
      this.curOp.isVimOp = false;
      try { r = origDispatch.call(this, signal, ...args); }
      finally { this.curOp.isVimOp = was; }
    } else {
      r = origDispatch.call(this, signal, ...args);
    }
    // - handleExternalSelection is one of the cursorActivity listeners, so by now vim.sel
    // - holds the mouse selection and the microtask paints the block on its head
    if (signal === 'cursorActivity') scheduleVisualCursorSync(this);
    return r;
  };

  P.__skenaExternalSelection = true;
}

/**
 * Keep the newline that joined a deleted last line to the line above out of the register.
 *
 * `dd` on the last line has to delete the newline BEFORE that line — there is none after it —
 * so monaco-vim widens the range back to the end of the previous line. The text it takes from
 * that widened range starts with that newline, and pushText then appends another one because
 * the delete is linewise. On "ab\ncd", `j dd` leaves the buffer as "ab" (right) but registers
 * "\ncd\n" instead of "cd\n", so `p` pastes a blank line first.
 *
 * Fix: re-register the delete operator with the original body, dropping that leading line break
 * from the register text only. The buffer edit uses the positions, not the text, so it is
 * unchanged. The one-line-buffer case (anchor.ch = 0) was already right and stays as it was.
 *
 * The guard is also widened from monaco-vim's "anchor is the last line and head is one past it"
 * to "head is past the last line", which is the condition the widening actually exists for: a
 * linewise range reaching the document end has no newline after it, whatever line it starts on.
 * Without that, `dG` / `Vjd` starting anywhere above the last line left a stray empty line.
 */
export function patchVimDeleteLastLine(): void {
  const CM = VimMode as any;
  const P  = CM?.prototype;
  const Vim = CM?.Vim;
  if (!P || !Vim?.defineOperator || !Vim.getVimGlobalState_ || P.__skenaDeleteLastLine) return;
  const Pos = CM.Pos;

  const lineLength  = (cm: any, line: number): number => cm.getLine(line).length;
  const firstNonWS  = (text: string): number => {
    if (!text) return 0;
    const at = text.search(/\S/);
    return at === -1 ? text.length : at;
  };
  const isBefore    = (a: any, b: any): boolean => a.line < b.line || (a.line === b.line && a.ch < b.ch);
  const clipToContent = (cm: any, cur: any): any => {
    const vim = cm.state.vim;
    // - insert and visual mode may sit one past the last character
    const includeLineBreak = vim.insertMode || vim.visualMode;
    const line  = Math.min(Math.max(cm.firstLine(), cur.line), cm.lastLine());
    const maxCh = lineLength(cm, line) - 1 + (includeLineBreak ? 1 : 0);
    return new Pos(line, Math.min(Math.max(0, cur.ch), maxCh));
  };

  Vim.defineOperator('delete', function(cm: any, args: any, ranges: any[]) {
    cm.pushUndoStop();
    let finalHead: any, text: string;
    const vim = cm.state.vim;
    if (!vim.visualBlock) {
      let anchor = ranges[0].anchor;
      const head = ranges[0].head;
      let widenedToPrevLine = false;
      if (args.linewise && head.line > cm.lastLine()) {
        if (anchor.line === cm.firstLine()) {
          anchor.ch = 0;
        } else {
          anchor = new Pos(anchor.line - 1, lineLength(cm, anchor.line - 1));
          widenedToPrevLine = true;
        }
      }
      // - relies on patchVimLastLine having clipped the past-the-end head for getRange and
      // - replaceRange, so this must run after it
      text = cm.getRange(anchor, head);
      cm.replaceRange('', anchor, head);
      // - the model's own line break, which may be CRLF; the register keeps plain \n
      if (widenedToPrevLine) text = text.slice(cm.editor.getModel()?.getEOL().length ?? 1);
      finalHead = anchor;
      if (args.linewise) finalHead = new Pos(anchor.line, firstNonWS(cm.getLine(anchor.line)));
    } else {
      text = cm.getSelection();
      cm.replaceSelections(new Array(ranges.length).fill(''));
      finalHead = isBefore(ranges[0].head, ranges[0].anchor) ? ranges[0].head : ranges[0].anchor;
    }
    Vim.getVimGlobalState_().registerController.pushText(
      args.registerName, 'delete', text, args.linewise, vim.visualBlock,
    );
    return clipToContent(cm, finalHead);
  });

  P.__skenaDeleteLastLine = true;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Wire the clipboard relay register into the vim RegisterController.
 * MUST be called after initVimMode() — the Vim singleton is not available until then.
 * Safe to call on every editor mount (handles re-registration and re-replacement).
 */
export function applyVimClipboard(): void {
  const Vim = getVimSingleton();
  if (!Vim) return;

  // - define + and * registers (named system-clipboard aliases)
  // - throws "Register already defined" on 2nd+ call — caught and ignored
  try { Vim.defineRegister('+', sysReg); } catch { /* already defined */ }
  try { Vim.defineRegister('*', sysReg); } catch { /* already defined */ }

  // - replace the unnamed " register directly so plain yy / p go through sysReg.
  // - clipboard=unnamedplus does NOT exist in monaco-vim 0.4.4 so we must do this
  // - by directly overwriting the RegisterController's unnamed register reference.
  const rc = Vim.getRegisterController();
  if (rc) {
    rc.registers['"'] = sysReg;
    rc.unnamedRegister = sysReg;
  }
}

/**
 * Fix monaco-vim's J (join lines): its built-in join misbehaves under Monaco. Intercept Shift+J
 * at the Monaco level and, when vim is in NORMAL mode (read from the status bar text, the same
 * signal the Esc handler uses), join the current + next line vim-style — single space, drop the
 * next line's leading whitespace — in one synchronous edit. In INSERT/VISUAL/REPLACE we bail so
 * vim/Monaco handle the key normally. Best-effort unmap of the built-in J so it can't also fire.
 */
export function patchVimJoin(
  editor:   MonacoEditor.IStandaloneCodeEditor,
  statusEl: HTMLElement | null,
): void {
  const Vim = getVimSingleton() as unknown as { unmap?: (lhs: string, ctx: string) => void } | undefined;
  try { Vim?.unmap?.('J', 'normal'); } catch { /* built-in map may not be user-removable */ }

  editor.onKeyDown(e => {
    // - Shift+J only (plain J is 'j'); ignore chorded variants so Ctrl/Cmd/Alt+J pass through
    if (e.browserEvent.key !== 'J' || e.ctrlKey || e.metaKey || e.altKey) return;
    const mode = statusEl?.textContent ?? '';
    if (mode.includes('INSERT') || mode.includes('VISUAL') || mode.includes('REPLACE')) return;

    const model = editor.getModel();
    const pos   = editor.getPosition();
    if (!model || !pos || pos.lineNumber >= model.getLineCount()) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault();
    e.stopPropagation();
    const ln   = pos.lineNumber;
    const cur  = model.getLineContent(ln);
    const next = model.getLineContent(ln + 1).replace(/^\s+/, '');   // - vim J drops the next line's indent
    const sep  = (cur.length === 0 || cur.endsWith(' ')) ? '' : ' ';
    editor.executeEdits('vim-join', [{
      range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln + 1, endColumn: model.getLineMaxColumn(ln + 1) },
      text: cur + sep + next,
    }]);
    editor.setPosition({ lineNumber: ln, column: cur.length + 1 });   // - cursor at the junction (vim behaviour)
  });
}

/**
 * Take the host clipboard text into the relay register, with the right linewise flag.
 * A read fires on every editor focus, so our own yank comes straight back — classifyHostText
 * recognises it and restores the register form, newline and all.
 */
export function noteHostClipboard(text: string): void {
  const got        = classifyHostText(text);
  clipboardCache   = got;
  sysReg.linewise  = got.linewise;
  sysReg.keyBuffer = [got.text];
}

// - module-level skena:clipboardContent listener — registered at bundle load,
// - fires for both the proactive push on webviewReady AND every requestClipboardRead response.
window.addEventListener('skena:clipboardContent', (e: Event) => {
  noteHostClipboard((e as CustomEvent<string>).detail ?? '');
});

// ─── component ────────────────────────────────────────────────────────────────

export function TextNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as TextNode & { accentColor?: string };
  const selectedStyle = useSelectedStyle(selected);
  const bw = useZoomInvariantBorderWidth(1.5);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const hostHtml = useHostMarkdown(draft);
  const shownHtml = useHighlightedHtml(hostHtml);

  // - re-sync the view buffer when node.text changes from OUTSIDE this component
  // - (external MCP write / disk reload → soft re-sync updates the data.text prop, but
  // -  React Flow keeps this instance by id so `draft` would stay stale → the edit is
  // -  invisible). Skip while editing so it never clobbers in-progress typing; on local
  // -  edit-exit node.text already equals the typed text, so this is a no-op there.
  useEffect(() => {
    if (!editing) setDraft(node.text);
  }, [node.text, editing]);
  const vimStatusRef    = useRef<HTMLDivElement | null>(null);
  const wrapperRef      = useRef<HTMLDivElement | null>(null);
  // - stable ref to the Monaco instance so the clipboard event handler can reach it
  const editorRef       = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  // - persists cursor position across edit sessions (saveViewState / restoreViewState)
  const savedViewState  = useRef<MonacoEditor.ICodeEditorViewState | null>(null);
  // - ref to the markdown scroll container so we can restore the viewing position
  const scrollableRef   = useRef<HTMLDivElement | null>(null);
  // - cursor-line fraction (0–1): fallback when text-anchor search fails
  const pendingScrollFraction = useRef<number | null>(null);
  // - stripped text near cursor line: used to find the matching rendered element
  const pendingAnchorText = useRef<string | null>(null);

  const borderColor = nodeBorderColor('text', node.accentColor);
  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  const commitEdit = useCallback((text: string) => {
    // - save cursor position before Monaco is destroyed so we can restore it next session
    savedViewState.current = editorRef.current?.saveViewState() ?? null;
    // - save where the cursor was as a fraction of total lines so the markdown
    // - viewer can scroll to the same area after the editor closes
    const editor = editorRef.current;
    if (editor) {
      const pos   = editor.getPosition();
      const model = editor.getModel();
      if (pos && model) {
        // - fallback: line-fraction (inaccurate but always available)
        const lineCount = model.getLineCount();
        pendingScrollFraction.current = (pos.lineNumber - 1) / Math.max(lineCount - 1, 1);

        // - primary: strip markdown markers from cursor line (and up to 5 lines above)
        // - to get the plain text that ReactMarkdown will render, then search for it
        // - in the rendered DOM.  Much more accurate than fraction×scrollHeight.
        let anchor = '';
        for (let ln = pos.lineNumber; ln >= Math.max(1, pos.lineNumber - 5); ln--) {
          const stripped = model.getLineContent(ln)
            .replace(/^#{1,6}\s+/, '')              // - headings
            .replace(/^\s*[-*+>]\s+/, '')           // - list / blockquote markers
            .replace(/^\s*\d+\.\s+/, '')            // - numbered list
            .replace(/\*\*([^*]+)\*\*/g, '$1')      // - **bold**
            .replace(/__([^_]+)__/g, '$1')           // - __bold__
            .replace(/\*([^*]+)\*/g, '$1')           // - *italic*
            .replace(/_([^_]+)_/g, '$1')             // - _italic_
            .replace(/`([^`]+)`/g, '$1')             // - `code`
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // - [link](url)
            .trim();
          if (stripped.length >= 8) { anchor = stripped.slice(0, 60); break; }
        }
        pendingAnchorText.current = anchor || null;
      } else {
        pendingScrollFraction.current = null;
        pendingAnchorText.current     = null;
      }
    }
    setEditing(false);
    editorRef.current = null;
    setDraft(text);
    if (text !== node.text) {
      window.dispatchEvent(new CustomEvent('skena:nodeTextEdit', { detail: { id, text } }));
    }
    // - restore focus to the node wrapper so Enter key works immediately next time
    requestAnimationFrame(() => wrapperRef.current?.focus());
  }, [node.text, id]);

  // - when edit mode closes, scroll the markdown view to the cursor position.
  //
  // - Strategy: text-anchor search (primary) + fraction fallback.
  //
  // - Text-anchor: strip markdown markers from the cursor line, search the rendered
  //   DOM for an element containing that plain text, then centre it in the viewport.
  //   Accurate because it anchors to actual rendered content.
  //
  // - Fraction fallback: used when the cursor was on an empty/too-short line
  //   (no text to anchor on). Forces content-visibility:visible before measuring
  //   so scrollHeight reflects real rendered heights, not 80px estimates.
  //
  // - All DOM reads/writes happen in one synchronous useLayoutEffect tick — the
  //   browser never paints the intermediate state (no visible flicker).
  useLayoutEffect(() => {
    if (editing) return;
    if (pendingAnchorText.current === null && pendingScrollFraction.current === null) return;

    const anchor   = pendingAnchorText.current;
    const fraction = pendingScrollFraction.current;
    pendingAnchorText.current     = null;
    pendingScrollFraction.current = null;

    const el = scrollableRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;

    // - force all content-visibility:auto blocks to render so positions are accurate
    const cvEls = el.querySelectorAll<HTMLElement>('.skena-markdown > *');
    cvEls.forEach(c => { c.style.contentVisibility = 'visible'; });

    let scrollSet = false;

    if (anchor) {
      const search = anchor.slice(0, 25);
      const query  = '.skena-markdown h1,.skena-markdown h2,.skena-markdown h3,' +
                     '.skena-markdown h4,.skena-markdown h5,.skena-markdown h6,' +
                     '.skena-markdown p,.skena-markdown li,.skena-markdown blockquote';
      const containerTop = el.getBoundingClientRect().top;
      for (const elem of Array.from(el.querySelectorAll<HTMLElement>(query))) {
        if ((elem.textContent ?? '').includes(search)) {
          // - offset from container's current visible top → centre the element
          const relTop = elem.getBoundingClientRect().top - containerTop;
          el.scrollTop = Math.max(0, el.scrollTop + relTop - (el.clientHeight - elem.offsetHeight) / 2);
          scrollSet = true;
          break;
        }
      }
    }

    if (!scrollSet && fraction !== null) {
      // - fallback: scrollHeight is now accurate (all blocks forced visible above)
      el.scrollTop = Math.max(0, Math.round(fraction * el.scrollHeight - el.clientHeight / 2));
    }

    // - restore the CSS optimisation — the inline override is removed so the
    // - .skena-markdown > * { content-visibility:auto } class rule takes back over
    cvEls.forEach(c => { c.style.contentVisibility = ''; });
  }, [editing]);

  // ─── clipboard response handler ─────────────────────────────────────────
  // - permanent (component lifetime) listener:
  //   • always updates clipboardCache so vim's + register get() is up-to-date
  //   • if pendingPaste is set (Ctrl+V was pressed), inserts text into Monaco

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail ?? '';
      noteHostClipboard(text);

      if (pendingPaste) {
        pendingPaste = false;
        const ed = editorRef.current;
        if (!ed) return;
        const sel = ed.getSelection();
        if (!sel) return;
        ed.executeEdits('system-paste', [{ range: sel, text, forceMoveMarkers: true }]);
        ed.focus();
      }
    };
    window.addEventListener('skena:clipboardContent', handler);
    return () => window.removeEventListener('skena:clipboardContent', handler);
  }, []);

  // - eagerly refresh clipboard when entering edit mode so `p` works immediately
  useEffect(() => {
    if (editing) vscodePostMessage({ type: 'requestClipboardRead' });
  }, [editing]);

  // ─── Monaco setup ─────────────────────────────────────────────────────────

  // - define a VS Code-synced theme before the editor is created.
  //
  // - Monaco's markdown Monarch grammar uses tokenPostfix ".md", so the runtime
  // - token names are "keyword.md", "strong.md", "variable.md", etc.
  //
  // - We use UN-suffixed rule tokens ("keyword", "strong", …).  Monaco's trie
  // - match() falls back to the parent node's rule when no child exists for a
  // - segment, so "keyword" matches "keyword.md" via prefix — this is the
  // - documented and stable prefix-matching behaviour.
  //
  // - Using un-suffixed names is safer than ".md"-suffixed names because it
  // - avoids interactions with vs-dark's deeper rules (keyword.flow, keyword.json,
  // - string.key.json, …) that create intermediate trie nodes and can corrupt
  // - the clone chain when our ".md" child is inserted.
  //
  // - vs-dark base theme has "strong" and "emphasis" with fontStyle only (no
  // - foreground colour), so bold/italic text appears as plain white.  We
  // - override those rules with colours here.
  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    const style = getComputedStyle(document.body);
    const bg    = style.getPropertyValue('--vscode-editor-background').trim();
    const dark  = isDark;

    monacoInstance.editor.defineTheme('skena-editor', {
      base:    dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        // - headings (#, ##, …), list markers (-, *, +), table dividers (|)
        { token: 'keyword',         foreground: dark ? '569cd6' : '0070c1'                      },
        // - **bold** / __bold__   — vs-dark has fontStyle:bold but NO foreground; add colour
        { token: 'strong',          foreground: dark ? 'dcdcaa' : '795e26', fontStyle: 'bold'   },
        // - *italic* / _italic_   — vs-dark has fontStyle:italic but NO foreground; add colour
        { token: 'emphasis',        foreground: dark ? 'ce9178' : 'a31515', fontStyle: 'italic' },
        // - `inline code`         — vs-dark maps 'variable' to faint blue; prefer gold
        { token: 'variable',        foreground: dark ? 'd7ba7d' : '795e26'                      },
        // - code block content    — more specific than 'variable'; wins for block lines
        { token: 'variable.source', foreground: dark ? 'd7ba7d' : '795e26'                      },
        // - [link text](url)
        { token: 'string.link',     foreground: dark ? '4ec9b0' : '267f99'                      },
        // - > blockquotes
        { token: 'comment',         foreground: dark ? '6a9955' : '008000', fontStyle: 'italic' },
        // - ``` fenced code block markers
        { token: 'string',          foreground: dark ? 'ce9178' : 'a31515'                      },
      ],
      colors: {
        'editor.background':           bg || (dark ? '#1e1e1e' : '#ffffff'),
        // - kill the line-highlight rectangle visible on single-line edits
        'editor.lineHighlightBackground':  '#00000000',
        'editor.lineHighlightBorderColor': '#00000000',
      },
    });
  }, [isDark]);

  const onEditorMount: OnMount = useCallback((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    // - restore cursor position from previous edit session (if any)
    if (savedViewState.current) {
      editorInstance.restoreViewState(savedViewState.current);
      savedViewState.current = null;
    }
    editorInstance.focus();

    // - refresh clipboard cache whenever Monaco gains focus (covers copy-outside-then-back)
    editorInstance.onDidFocusEditorText(() => {
      vscodePostMessage({ type: 'requestClipboardRead' });
    });

    // - initialise vim mode; status bar shows current vim mode / pending commands
    const vimMode = initVimMode(editorInstance, vimStatusRef.current ?? undefined);

    // - wire clipboard relay into RegisterController; MUST be after initVimMode()
    // - which initialises the Vim singleton and (re)creates the RegisterController.
    applyVimClipboard();
    patchVimNewlineAndIndent();
    patchVimLastLine();
    patchVimVisualCursor();
    patchVimExternalSelection();
    patchVimDeleteLastLine();
    patchVimJoin(editorInstance, vimStatusRef.current);

    // ─── vim mode tracking via MutationObserver ──────────────────────────────
    //
    // Problem: editor.onKeyDown can fire AFTER monaco-vim has already processed
    // the key and updated the status bar DOM. Reading the status bar text inside
    // onKeyDown would then see the POST-key state, not the pre-key state.
    //
    // Fix: MutationObserver callbacks are microtasks — they run AFTER the current
    // synchronous call stack. So inside onKeyDown (sync), `vimIsEditing` still
    // reflects the mode BEFORE the current key, regardless of whether vim's handler
    // ran before or after Monaco's onKeyDown listeners.
    //
    //   ESC pressed while in INSERT:
    //     vim processes → status → "" → mutation QUEUED (microtask, not yet fired)
    //     onKeyDown fires (sync) → vimIsEditing = true (old value) → don't commit ✓
    //     microtask fires → vimIsEditing = false
    //
    //   ESC pressed while in NORMAL:
    //     no status change → no mutation → onKeyDown fires → vimIsEditing = false → commit ✓
    //
    let vimIsEditing = false;

    const statusObserver = new MutationObserver(() => {
      const text = vimStatusRef.current?.textContent ?? '';
      vimIsEditing = text.includes('INSERT') || text.includes('VISUAL') || text.includes('REPLACE');
    });
    if (vimStatusRef.current) {
      statusObserver.observe(vimStatusRef.current, {
        childList: true, subtree: true, characterData: true,
      });
    }

    // - Ctrl/Cmd+Enter → save and close from any mode
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      commitEdit(editorInstance.getValue());
    });

    // - ESC: exit editing only when vim is already in NORMAL mode.
    // - vimIsEditing is safe to read here: MutationObserver (microtask) hasn't
    // - fired yet for the current keydown, so it still holds the pre-key state.
    editorInstance.onKeyDown(e => {
      if (e.browserEvent.key !== 'Escape') return;
      if (!vimIsEditing) {
        commitEdit(editorInstance.getValue());
      }
      // - if vimIsEditing: vim handles ESC → transitions to NORMAL → don't close
    });

    // ─── Ctrl+V fallback paste (fires only when vim doesn't intercept it) ──
    // - in vim NORMAL mode Ctrl+V = visual block (vim wins); in non-vim / insert
    // - contexts Monaco's addCommand fires and we relay through the host.
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyV, () => {
      pendingPaste = true;
      vscodePostMessage({ type: 'requestClipboardRead' });
    });

    // - Ctrl+C fallback copy — fires when vim doesn't intercept (e.g. Monaco-only context)
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyC, () => {
      const sel   = editorInstance.getSelection();
      const model = editorInstance.getModel();
      if (!sel || !model) return;
      const text = sel.isEmpty()
        ? model.getLineContent(sel.startLineNumber) + '\n'
        : model.getValueInRange(sel);
      if (text) {
        clipboardCache = { text, linewise: sel.isEmpty() };
        // - the host gets the selection verbatim; recording it stops the next read-back from
        // - matching an earlier yank of the same text and restoring that yank's linewise flag
        writeHostClipboard(text, sel.isEmpty(), text);
      }
    });

    // - clean up vim mode and observer when the Monaco editor is destroyed
    editorInstance.onDidDispose(() => {
      vimMode.dispose();
      statusObserver.disconnect();
    });
  }, [commitEdit]);

  const enterEdit = useCallback(() => setEditing(true), []);

  // - receive DOM focus when keyboard navigation lands on this node
  useEffect(() => {
    const handler = (e: Event) => {
      const { id: targetId } = (e as CustomEvent<{ id: string }>).detail;
      if (targetId === id) wrapperRef.current?.focus();
    };
    window.addEventListener('skena:focusNode', handler);
    return () => window.removeEventListener('skena:focusNode', handler);
  }, [id]);

  // - auto-open Monaco when a new text note is created via QuickPick
  useEffect(() => {
    const handler = (e: Event) => {
      const { id: targetId } = (e as CustomEvent<{ id: string }>).detail;
      if (targetId === id) setEditing(true);
    };
    window.addEventListener('skena:enterEdit', handler);
    return () => window.removeEventListener('skena:enterEdit', handler);
  }, [id]);

  return (
    <>
    <NodeLabelBadge label={node.nodeLabel} createdBy={(node as any).createdBy} />
    <div
      ref={wrapperRef}
      className="skena-node skena-node--text"
      style={{
        border:        `${bw}px solid ${borderColor}`,
        height:        '100%',
        borderRadius:  6,
        overflow:      'hidden',
        display:       'flex',
        flexDirection: 'column',
        outline:       'none',
        // - sci-fi focus ring
        ...selectedStyle,
      }}
      tabIndex={0}
      onDoubleClick={enterEdit}
      // - Enter key while node is React-Flow-selected AND DOM-focused → enter edit mode
      onKeyDown={e => {
        if (e.key === 'Enter') {
          if (editing) {
            // - Monaco is open but lost focus (user clicked away then navigated back);
            // - re-focus the editor so editing can continue without a mouse click
            e.stopPropagation();
            e.preventDefault();
            editorRef.current?.focus();
          } else if (selected) {
            e.stopPropagation();
            e.preventDefault();
            enterEdit();
          }
        }
      }}
    >
      <NodeResizer
        minWidth={120} minHeight={80}
        isVisible={selected && !editing}
        onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
          detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        }))}
      />
      {editing ? (
        // - block React Flow from stealing pointer AND keyboard events while Monaco is active
        // - (space = pan, arrow keys = nudge, delete = delete node, etc.); the click is stopped too,
        // - or placing the cursor would run onNodeClick's reveal pan
        <div
          style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
        >
          <div style={{ flex: 1 }}>
            <Editor
              height="100%"
              loading={null}   // - Monaco is bundled (loader.config in index.tsx); skip the "Loading…" flash
              defaultLanguage="markdown"
              value={draft}
              theme="skena-editor"
              beforeMount={beforeMount}
              onMount={onEditorMount}
              onChange={value => setDraft(value ?? '')}
              options={{
                minimap:              { enabled: false },
                lineNumbers:          'off',
                wordWrap:             'on',
                scrollBeyondLastLine: false,
                fontSize:             13,
                fontFamily:           'var(--vscode-editor-font-family, monospace)',
                padding:              { top: 6, bottom: 6 },
                overviewRulerLanes:   0,
                renderLineHighlight:  'none',
                scrollbar:            { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
                automaticLayout:      true,
              }}
            />
          </div>
          {/* - vim status bar: shows mode (INSERT / NORMAL / VISUAL) and pending commands */}
          <div
            ref={vimStatusRef}
            style={{
              height:     20,
              background: 'var(--vscode-statusBar-background, #007acc)',
              color:      'var(--vscode-statusBar-foreground, #fff)',
              fontSize:   11,
              padding:    '2px 8px',
              fontFamily: 'var(--vscode-editor-font-family, monospace)',
              flexShrink: 0,
            }}
          />
        </div>
      ) : (
        // - baseUri="." so relative image paths (./img.png) resolve against canvas dir
        <ScrollableContent ref={scrollableRef} scrollKey={id} style={{ padding: '6px 8px 6px 12px' }}>
          {hostHtml !== null
            ? <div className="skena-markdown" dangerouslySetInnerHTML={{ __html: shownHtml ?? hostHtml }} />
            : <MarkdownRenderer content={draft} baseUri="." />}
        </ScrollableContent>
      )}
    </div>
    {/* - handles outside overflow:hidden wrapper → not clipped, render above scrollable content */}
    <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
    <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}
