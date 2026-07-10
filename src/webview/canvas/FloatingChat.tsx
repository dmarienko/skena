/**
 * FloatingChat — viewport-pinned AI companion overlay.
 *
 * Lives ABOVE React Flow in screen coordinates (position:fixed).
 * Always visible regardless of canvas pan/zoom.
 *
 * Layout (expanded):
 *   Header  — drag handle, agent label, collapse button
 *   Body    — vertical split: output (left) | input (right)
 *   Resize  — bottom-right corner handle
 *
 * Collapsed: bar snaps to bottom edge of viewport.
 * Toggle: Alt+` (handled in useFloatingChat hook).
 *
 * Clipboard (vim mode):
 *   VS Code webview sandbox blocks navigator.clipboard — same relay as TextNode.
 *   Vim +/* registers and the unnamed " register are wired to the extension host.
 *   applyVimClipboard() is called after initVimMode() AND on every focus event so
 *   FloatingChat re-owns the VIM register controller whenever the input is active
 *   (TextNode overwrites it while a node is being edited; we take it back on refocus).
 *
 *   Ctrl+V  → requestClipboardRead → insert on clipboardContent response
 *   Ctrl+C  → writeClipboard via host
 */

import { useRef, useEffect, useCallback, useState, memo, type CSSProperties } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode, VimMode } from 'monaco-vim';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { ChatItem, ChatMessage, ChatToolEvent, ChatTokenUsage } from '../../shared/types';
import { useFloatingChat } from '../hooks/useFloatingChat';
import { CHAT_USER_RGB, CHAT_ASSISTANT_RGB, CHAT_ERROR_RGB, CHAT_ACCENT_RGB } from './palette';
import { toolCardView } from './chat/toolCardView';

// ─── constants ─────────────────────────────────────────────────────────────────

const HEADER_H    = 26;   // - collapsed bar height
const HINT_BAR_H  = 20;   // - send-hint bar below Monaco

const titleBtnStyle: CSSProperties = {
  background: 'none',
  border:     'none',
  cursor:     'pointer',
  color:      'var(--vscode-foreground)',
  opacity:    0.55,
  fontSize:   12,
  padding:    '0 2px',
  lineHeight: 1,
  userSelect: 'none',
};

// ─── vscode message relay ─────────────────────────────────────────────────────

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// ─── clipboard state (module-level, FloatingChat's own cache) ─────────────────
//
// Separate from TextNode's module-level cache — they live in different module
// scopes in the bundle.  Both listen to skena:clipboardContent and update their
// own cache; the VIM RegisterController uses whichever was last registered
// (i.e. whichever editor was most recently focused).

type VimRegisterLike = {
  setText:               (text: string, linewise: boolean, blockwise?: boolean) => void;
  pushText:              (text: string, linewise: boolean) => void;
  clear:                 () => void;
  toString:              () => string;
  linewise:              boolean;
  blockwise:             boolean;
  keyBuffer:             string[];
  insertModeChanges:     unknown[];
  searchQueries:         string[];
  pushInsertModeChanges?:(changes: unknown) => void;
  pushSearchQuery?:      (query: string)   => void;
};

type VimSingleton = {
  defineRegister:        (n: string, r: unknown) => void;
  getRegisterController: () => { registers: Record<string, VimRegisterLike>; unnamedRegister: VimRegisterLike };
};

let chatClipboardCache: { text: string; linewise: boolean } = { text: '', linewise: false };

/** - relay register: routes vim y/p through the extension-host clipboard */
const chatSysReg: VimRegisterLike = {
  keyBuffer:         [''],
  linewise:          false,
  blockwise:         false,
  insertModeChanges: [],
  searchQueries:     [],

  setText(text: string, linewise: boolean, blockwise?: boolean) {
    this.keyBuffer = [text ?? ''];
    this.linewise  = !!linewise;
    this.blockwise = !!blockwise;
    chatClipboardCache = { text: text ?? '', linewise: !!linewise };
    vscodePostMessage({ type: 'writeClipboard', text: text ?? '' });
  },
  pushText(text: string, linewise: boolean) {
    if (linewise) {
      if (!this.linewise) this.keyBuffer.push('\n');
      this.linewise = true;
    }
    this.keyBuffer.push(text);
    const full = this.keyBuffer.join('');
    chatClipboardCache = { text: full, linewise: this.linewise };
    vscodePostMessage({ type: 'writeClipboard', text: full });
  },
  clear() {
    this.keyBuffer         = [];
    this.linewise          = false;
    this.blockwise         = false;
    this.insertModeChanges = [];
    this.searchQueries     = [];
  },
  toString() {
    return chatClipboardCache.text !== '' ? chatClipboardCache.text : this.keyBuffer.join('');
  },
  pushInsertModeChanges(changes: unknown) { this.insertModeChanges.push(changes); },
  pushSearchQuery(query: string)          { this.searchQueries.push(query); },
};

function getChatVimSingleton(): VimSingleton | undefined {
  return (VimMode as unknown as Record<string, unknown>).Vim as VimSingleton | undefined;
}

/**
 * Patch monaco-vim's broken newlineAndIndent command.
 *
 * Root cause: CMAdapter.commands.newlineAndIndent calls
 *   editor.trigger("vim", "editor.action.insertLineAfter")
 * which is deferred by Monaco and doesn't fire reliably from inside a vim
 * key-handler callback — `o` jumps to EOL but inserts no newline.
 *
 * Fix: replace with a synchronous executeEdits('\n') at the current cursor.
 * Patching once is enough (global on VimMode.commands); calling it again is
 * idempotent.  Must be called after every initVimMode() because initVimMode
 * can call resetVimGlobalState which recreates the command table.
 */
function patchVimNewlineAndIndent(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CM = VimMode as any;
  if (!CM?.commands) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CM.commands.newlineAndIndent = function(cm: any) {
    const editor = cm.editor as MonacoEditor.IStandaloneCodeEditor;
    const pos = editor.getPosition();
    if (!pos) return;
    editor.executeEdits('vim-o', [{
      range: {
        startLineNumber: pos.lineNumber, startColumn: pos.column,
        endLineNumber:   pos.lineNumber, endColumn:   pos.column,
      },
      text: '\n',
    }]);
  };
}

/**
 * Register chatSysReg as the vim clipboard in the VIM singleton.
 * Must be called after initVimMode() and again on every focus so FloatingChat
 * re-owns the register controller whenever TextNode editing has overwritten it.
 */
function applyVimClipboard(): void {
  const Vim = getChatVimSingleton();
  if (!Vim) return;
  try { Vim.defineRegister('+', chatSysReg); } catch { /* already defined */ }
  try { Vim.defineRegister('*', chatSysReg); } catch { /* already defined */ }
  const rc = Vim.getRegisterController();
  if (rc) {
    rc.registers['"']  = chatSysReg;
    rc.unnamedRegister = chatSysReg;
  }
}

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  activeNodeId: string | null;
  agentName?:   string;
  model?:       string;
  provider?:    string;
  postMessage:  (msg: unknown) => void;

  onDelta:           (handler: (delta: string)       => void) => () => void;
  onDone:            (handler: (usage: { costUsd?: number; deltaUsd?: number }) => void) => () => void;
  onError:           (handler: (msg: string)         => void) => () => void;
  onResetDone:       (handler: ()                    => void) => () => void;
  onNodeAdded:       (handler: (note: string)        => void) => () => void;
  onHistoryRestored: (handler: (payload: {
    history:    unknown[];
    collapsed?: boolean;
    pos?:       { x: number; y: number };
    size?:      { w: number; h: number };
  }) => void) => () => void;
  onToolEvent?:      (cb: (e: ChatToolEvent) => void) => () => void;
  onUsage?:          (cb: (u: ChatTokenUsage) => void) => () => void;
}

// ─── component ────────────────────────────────────────────────────────────────

export function FloatingChat({
  activeNodeId,
  agentName = 'claude',
  model,
  provider,
  postMessage,
  onDelta,
  onDone,
  onError,
  onResetDone,
  onNodeAdded,
  onHistoryRestored,
  onToolEvent,
  onUsage,
}: Props): JSX.Element {
  const chat             = useFloatingChat(postMessage);
  const outputEl         = useRef<HTMLDivElement | null>(null);
  const editorRef        = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const vimRef           = useRef<{ dispose: () => void } | null>(null);
  const pendingPasteRef  = useRef(false);
  // - survive collapse/expand (which unmounts the body): unsent draft
  const draftRef         = useRef('');
  // - current vim mode of the prompt editor; Shift+hjkl scrolls output only in normal mode
  const vimModeRef       = useRef<string>('normal');
  // - true when the chat input held focus as focus LEFT the webview (→ another VS Code
  // - panel); the window-focus effect below re-focuses chat when the webview returns
  const restoreChatOnReturnRef = useRef(false);
  const [isChatFocused, setIsChatFocused] = useState(false);
  // - ref mirror of collapsed so the once-registered window-focus listener reads it live
  const collapsedRef = useRef(chat.collapsed);
  useEffect(() => { collapsedRef.current = chat.collapsed; }, [chat.collapsed]);

  // - stable ref so the window capture handler always calls the latest sendMessage
  // - without needing it in the dependency array
  const sendMessageRef        = useRef(chat.sendMessage);
  useEffect(() => { sendMessageRef.current = chat.sendMessage; }, [chat.sendMessage]);

  // - true when the current expand was triggered by Alt+I from collapsed state;
  // - a second Alt+I while focused should fold back rather than restore canvas
  const altIExpandedRef = useRef(false);

  // - keep a ref so the send command always reads the current activeNodeId
  const activeNodeIdRef = useRef<string | null>(activeNodeId);
  useEffect(() => { activeNodeIdRef.current = activeNodeId; }, [activeNodeId]);

  // ─── wire incoming host events ─────────────────────────────────────────

  useEffect(() => onDelta(chat.appendDelta),               [onDelta, chat.appendDelta]);
  useEffect(() => onDone(chat.completeDelta),              [onDone, chat.completeDelta]);
  useEffect(() => onError(chat.handleError),               [onError, chat.handleError]);
  useEffect(() => onResetDone(chat.clearHistory),          [onResetDone, chat.clearHistory]);
  useEffect(() => onNodeAdded(chat.addNodeAdded),          [onNodeAdded, chat.addNodeAdded]);
  useEffect(() => onHistoryRestored(chat.restoreHistory),  [onHistoryRestored, chat.restoreHistory]);
  useEffect(() => onToolEvent?.(chat.applyTool),           [onToolEvent, chat.applyTool]);
  useEffect(() => onUsage?.(chat.applyUsage),              [onUsage, chat.applyUsage]);

  // ─── clipboard content response handler ────────────────────────────────
  //
  // Handles both:
  //   • proactive refreshes (onDidFocusEditorText → requestClipboardRead)
  //     so vim `p` reads the latest system clipboard
  //   • pendingPaste responses (Ctrl+V pressed, awaiting async clipboard read)

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail ?? '';
      // - sync the module-level cache and sysReg
      chatClipboardCache  = { text, linewise: false };
      chatSysReg.linewise  = false;
      chatSysReg.keyBuffer = [text];

      if (pendingPasteRef.current) {
        pendingPasteRef.current = false;
        const ed  = editorRef.current;
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

  // ─── Ctrl+Enter: send message (capture phase, bypasses vim + addCommand) ──
  //
  // Monaco's addCommand keybinding resolution becomes unreliable when Ctrl+V
  // and Ctrl+C are also registered (they conflict with Monaco's built-in
  // clipboard actions and can silently drop other addCommand bindings).
  // Using a window capture-phase listener is simpler and always wins.

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      // - only fire when the chat Monaco editor actually has focus
      if (!editorRef.current?.hasTextFocus()) return;
      e.preventDefault();
      e.stopPropagation();
      const editor = editorRef.current;
      const text   = editor.getValue().trim();
      if (!text) return;
      sendMessageRef.current(text, activeNodeIdRef.current);
      editor.setValue('');
      editor.focus();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []); // - all mutable values accessed via refs — no deps needed

  // ─── Alt+I: toggle focus between chat input and canvas ────────────────
  //
  // Must use capture phase: Monaco calls stopPropagation() on native keydown
  // events when it has focus, so bubble-phase window listeners never fire.
  // Capture ensures we see Alt+I before Monaco does, regardless of focus.
  //
  //   Alt+I (collapsed)          → expand panel (Monaco auto-focuses on mount)
  //   Alt+I (expanded, unfocused)→ focus Monaco input
  //   Alt+I (expanded, focused)  → blur Monaco, dispatch skena:restoreCanvasFocus

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.key.toLowerCase() !== 'i') return;
      e.preventDefault();
      e.stopPropagation();

      if (chat.collapsed) {
        // - expand; remember this was a collapsed→open via Alt+I
        altIExpandedRef.current = true;
        chat.toggleCollapsed();
        return;
      }

      const editor = editorRef.current;
      if (editor?.hasTextFocus()) {
        if (altIExpandedRef.current) {
          // - was collapsed before this Alt+I session → fold back
          altIExpandedRef.current = false;
          chat.toggleCollapsed();
        } else {
          // - was already expanded → hand focus back to canvas
          (document.activeElement as HTMLElement)?.blur();
          window.dispatchEvent(new CustomEvent('skena:restoreCanvasFocus'));
        }
      } else {
        // - bring focus into chat (user arrived from canvas manually)
        altIExpandedRef.current = false;
        editor?.focus();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [chat.collapsed, chat.toggleCollapsed]);

  // ─── restore chat focus when returning to the canvas from another panel ──────
  //
  // Scenario: chat focused → navigate to another VS Code panel (alt+hjkl) → come back
  // to the canvas. The webview iframe regains focus but VS Code focuses its root, not
  // the chat input, so the user had to press Alt+I again. If chat held focus when we
  // left (restoreChatOnReturnRef, set on the leaving blur), re-focus it on return.
  useEffect(() => {
    // - shared restore: focus the chat input if it held focus when the user left.
    const doRestore = () => {
      if (!restoreChatOnReturnRef.current) return;
      restoreChatOnReturnRef.current = false;
      if (collapsedRef.current) return;   // - only restore into an OPEN chat
      requestAnimationFrame(() => editorRef.current?.focus());
    };

    // - trigger A: host's authoritative "panel became active" — fires when returning from
    // - another EDITOR group (the active editor toggles).
    const onPanelActivated = () => doRestore();

    // - trigger B: webview regained focus — needed when returning from a NON-editor panel
    // - (sidebar/terminal), where the canvas stays the active editor so panelActivated
    // - never fires. window 'focus' is noisy (transient pairs), so defer + confirm we
    // - genuinely hold focus before restoring.
    const onWinFocus = () => {
      if (!restoreChatOnReturnRef.current) return;
      setTimeout(() => {
        if (!document.hasFocus()) return;   // - transient focus that already left → ignore
        doRestore();
      }, 0);
    };

    window.addEventListener('skena:panelActivated', onPanelActivated);
    window.addEventListener('focus', onWinFocus);
    return () => {
      window.removeEventListener('skena:panelActivated', onPanelActivated);
      window.removeEventListener('focus', onWinFocus);
    };
  }, []);

  // ─── Alt+L: forward to VS Code navigateRight while the chat input is focused ──
  //
  // Monaco default-binds Alt+L to "toggle find in selection" and stopPropagation()s
  // it, so the VS Code webview never forwards it → the user's Alt+L (navigateRight)
  // dies only when the chat is focused (Alt+H has no Monaco binding, so it works).
  // Capture phase beats Monaco (same trick as Alt+I above). Guarded by hasTextFocus
  // so it does NOTHING when the chat is unfocused — canvas Alt+L forwards natively,
  // untouched. Pure DOM listener; never touches Monaco's (global) keybinding service.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'l') return;
      if (!editorRef.current?.hasTextFocus()) return;
      e.preventDefault();
      e.stopPropagation();
      vscodePostMessage({ type: 'navigateFocus', dir: 'right' });
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // ─── Shift+{H,J,K,L}: scroll output while prompt focused in vim normal mode ──
  //
  // Capture phase so we beat monaco-vim (which maps J=join, H/L=screen-move in
  // normal mode). Only fires when the input has focus AND is NOT in insert mode,
  // so typing capital letters in insert mode is untouched.

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!['H', 'J', 'K', 'L'].includes(e.key)) return;
      if (!editorRef.current?.hasTextFocus() || vimModeRef.current !== 'normal') return;
      const el = outputEl.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const vStep = el.clientHeight / 4;
      const hStep = el.clientWidth  / 4;
      switch (e.key) {
        case 'J': el.scrollBy({ top:  vStep, behavior: 'smooth' }); break;
        case 'K': el.scrollBy({ top: -vStep, behavior: 'smooth' }); break;
        case 'L': el.scrollBy({ left:  hStep, behavior: 'smooth' }); break;
        case 'H': el.scrollBy({ left: -hStep, behavior: 'smooth' }); break;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  // ─── pin output to the latest message ──────────────────────────────────
  // - fires on open/expand (collapsed→false remounts the body), on restored
  // - history, and while streaming. RAF waits for the (re)mounted list to lay
  // - out so scrollHeight is final; instant jump on open, no top-flash.
  useEffect(() => {
    if (chat.collapsed) return;
    const el = outputEl.current;
    if (!el) return;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [chat.collapsed, chat.history, chat.streaming]);

  // ─── Monaco theme ──────────────────────────────────────────────────────

  const handleBeforeMount: BeforeMount = useCallback((monacoInstance) => {
    const style = getComputedStyle(document.body);
    const bg    = style.getPropertyValue('--vscode-editor-background').trim();

    monacoInstance.editor.defineTheme('skena-editor', {
      base:    'vs-dark',
      inherit: true,
      rules:   [],
      colors: {
        'editor.background':               bg || '#1e1e2e',
        'editor.lineHighlightBackground':  '#00000000',
        'editor.lineHighlightBorderColor': '#00000000',
      },
    });
  }, []);

  // ─── Monaco editor mount ───────────────────────────────────────────────

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    editor.updateOptions({
      minimap:              { enabled: false },
      lineNumbers:          'off',
      glyphMargin:          false,
      folding:              false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars:  0,
      overviewRulerLanes:   0,
      scrollBeyondLastLine: false,
      wordWrap:             'on',
      scrollbar:            { vertical: 'auto', horizontal: 'hidden', alwaysConsumeMouseWheel: false },
      padding:              { top: 6, bottom: 6 },
    });

    // - restore an unsent draft typed before the panel was collapsed
    if (draftRef.current) {
      editor.setValue(draftRef.current);
      const model = editor.getModel();
      if (model) editor.setPosition(model.getFullModelRange().getEndPosition());
    }
    // - mirror every edit into draftRef so it survives the next collapse/unmount
    editor.onDidChangeModelContent(() => { draftRef.current = editor.getValue(); });

    // - vim mode without status bar element
    vimRef.current = initVimMode(editor, null) as { dispose: () => void };

    // - track vim mode so Shift+hjkl only hijacks keys when NOT editing text (insert)
    (vimRef.current as unknown as { on?: (ev: string, cb: (e: { mode: string }) => void) => void })
      .on?.('vim-mode-change', (ev) => { vimModeRef.current = ev.mode; });

    // - patch o/O newline command and wire clipboard relay
    patchVimNewlineAndIndent();
    applyVimClipboard();
    editor.onDidFocusEditorText(() => {
      applyVimClipboard();
      vscodePostMessage({ type: 'requestClipboardRead' });
      setIsChatFocused(true);
    });
    editor.onDidBlurEditorText(() => {
      setIsChatFocused(false);
      // - remember to restore chat focus ONLY when focus is leaving the webview entirely
      // - (→ another VS Code panel) vs moving to the canvas within it. document.hasFocus()
      // - is unreliable read synchronously at blur (focus is mid-transition, still true),
      // - so defer one tick to read the settled value.
      setTimeout(() => { restoreChatOnReturnRef.current = !document.hasFocus(); }, 0);
    });

    // - Ctrl+Enter is handled by a window capture-phase listener (see useEffect above)
    // - to avoid Monaco addCommand priority conflicts with Ctrl+V / Ctrl+C.

    // - Ctrl+V fallback paste (fires only when vim doesn't intercept — i.e. insert mode)
    // - in vim normal mode Ctrl+V = visual block (vim wins)
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV,
      () => {
        pendingPasteRef.current = true;
        vscodePostMessage({ type: 'requestClipboardRead' });
      },
    );

    // - Ctrl+C fallback copy (fires when vim doesn't intercept)
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC,
      () => {
        const sel   = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model) return;
        const text = sel.isEmpty()
          ? model.getLineContent(sel.startLineNumber) + '\n'
          : model.getValueInRange(sel);
        if (text) {
          chatClipboardCache = { text, linewise: sel.isEmpty() };
          vscodePostMessage({ type: 'writeClipboard', text });
        }
      },
    );

    setTimeout(() => editor.focus(), 100);
  }, []); // - no chat.sendMessage dep: Ctrl+Enter now uses sendMessageRef via capture listener

  // - cleanup vim on unmount
  useEffect(() => {
    return () => { vimRef.current?.dispose(); };
  }, []);

  // ─── computed layout ───────────────────────────────────────────────────

  const { pos, size, collapsed } = chat;
  const inputEditorH = size.h - HEADER_H - HINT_BAR_H;

  // - collapsed: snap to bottom edge; expanded: use saved position
  const positionStyle = collapsed
    ? { left: pos.x, bottom: 0,     top: 'auto' as const }
    : { left: pos.x, top:  pos.y,   bottom: 'auto' as const };

  // ─── render ────────────────────────────────────────────────────────────
  //
  // onKeyDown/onKeyUp stop propagation so CanvasView's keyboard handlers
  // (space=pin, hjkl=nav) don't consume Monaco's keystrokes.
  // Alt-combos MUST bubble to window: VS Code's keybinding forwarder listens
  // there — swallowing them killed user bindings like Alt+H. Skena's own
  // Alt+I / Alt+` are consumed earlier in capture phase, so they never get here.

  return (
    <div
      onKeyDown={e => { if (!e.altKey) e.stopPropagation(); }}
      onKeyUp={e => { if (!e.altKey) e.stopPropagation(); }}
      style={{
        position:      'fixed',
        ...positionStyle,
        width:         size.w,
        height:        collapsed ? HEADER_H : size.h,
        zIndex:        9000,
        display:       'flex',
        flexDirection: 'column',
        borderRadius:  collapsed ? '6px 6px 0 0' : 8,
        border:        '1px solid var(--vscode-panel-border, #333)',
        background:    'var(--vscode-sideBar-background, #1e1e2e)',
        boxShadow:     isChatFocused
          ? `0 8px 32px rgba(0,0,0,0.5), 0 0 0 2px rgba(${CHAT_ACCENT_RGB},0.55), 0 0 18px rgba(${CHAT_ACCENT_RGB},0.25)`
          : '0 8px 32px rgba(0,0,0,0.5)',
        transition:    'box-shadow 0.15s ease',
        overflow:      'hidden',
        fontFamily:    'var(--vscode-editor-font-family, var(--vscode-font-family))',
        fontSize:      13,
      }}
    >
      {/* ── Header ── */}
      <div
        onMouseDown={chat.onHeaderMouseDown}
        style={{
          display:      'flex',
          alignItems:   'center',
          gap:          5,
          padding:      '0 6px',
          height:       HEADER_H,
          flexShrink:   0,
          cursor:       'grab',
          userSelect:   'none',
          background:   'var(--vscode-titleBar-activeBackground, #1a1a2e)',
          borderBottom: collapsed ? 'none' : '1px solid var(--vscode-panel-border, #333)',
        }}
      >
        <span
          title={provider ? `provider: ${provider}` : undefined}
          style={{
            flex:         1,
            fontSize:     11,
            fontWeight:   500,
            color:        'var(--vscode-foreground)',
            opacity:      0.7,
            whiteSpace:   'nowrap',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Agent: {model ? `${model} @ ${agentName}` : agentName}
        </span>

        {chat.thinking && (
          <span style={{ fontSize: 9, color: 'var(--vscode-foreground)', opacity: 0.45 }}>
            ●●●
          </span>
        )}

        {chat.usage && (
          <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 8, color: 'var(--vscode-foreground)' }}>
            {chat.usage.inputTokens + chat.usage.cacheReadTokens}▸{chat.usage.outputTokens} tok
          </span>
        )}

        {!collapsed && (
          <>
            <button
              onClick={() => postMessage({ type: 'floatingChatCompact' })}
              title="Compact session (summarise to shrink context)"
              style={titleBtnStyle}
            >
              ⤵
            </button>
            <button
              // - host shows a modal confirm; history is cleared on the resetDone ack
              onClick={() => postMessage({ type: 'floatingChatReset' })}
              title="Reset — new session, clear history"
              style={titleBtnStyle}
            >
              ⟲
            </button>
          </>
        )}

        <button
          onClick={chat.toggleCollapsed}
          title={collapsed ? 'Expand (Alt+`)' : 'Collapse (Alt+`)'}
          style={{
            background: 'none',
            border:     'none',
            cursor:     'pointer',
            color:      'var(--vscode-foreground)',
            opacity:    0.55,
            fontSize:   12,
            padding:    '0 2px',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          {collapsed ? '□' : '−'}
        </button>
      </div>

      {/* ── Body: vertical split — input | output ── */}
      {!collapsed && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>

          {/* ── Left: input column ── */}
          <div style={{
            width:         Math.min(chat.inputW, size.w - 180),
            flexShrink:    0,
            display:       'flex',
            flexDirection: 'column',
            userSelect:    'text',
            position:      'relative',
          }}>
            {/* - prompt glyph: decorative chat-input marker in the left gutter */}
            <div style={{
              position:      'absolute',
              top:           7,
              left:          6,
              color:         `rgb(${CHAT_ACCENT_RGB})`,
              fontSize:      12,
              opacity:       0.9,
              pointerEvents: 'none',
              zIndex:        1,
            }}>
              ➤
            </div>
            {/* - Monaco editor — left padding clears the prompt glyph + panel border */}
            <div style={{ flex: 1, minHeight: 0, height: inputEditorH, paddingLeft: 20, paddingRight: 6 }}>
              <Editor
                height={inputEditorH}
                defaultLanguage="markdown"
                theme="skena-editor"
                beforeMount={handleBeforeMount}
                onMount={handleEditorMount}
                options={{
                  fontSize:            13,
                  lineHeight:          20,
                  suggest:             { showWords: false },
                  quickSuggestions:    false,
                  parameterHints:      { enabled: false },
                  renderLineHighlight: 'none',
                  automaticLayout:     true,
                }}
              />
            </div>

            {/* - send hint */}
            <div style={{
              height:         HINT_BAR_H,
              flexShrink:     0,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'flex-end',
              padding:        '0 8px',
              borderTop:      '1px solid var(--vscode-panel-border, #333)',
              background:     'var(--vscode-sideBar-background, #1e1e2e)',
            }}>
              <span style={{ fontSize: 10, color: 'var(--vscode-foreground)', opacity: 0.3 }}>
                Ctrl+Enter
              </span>
            </div>
          </div>

          {/* ── Vertical divider — draggable input/output splitter ── */}
          <div
            onMouseDown={chat.onSplitMouseDown}
            title="Drag to resize input/output split"
            style={{
              width:      5,
              flexShrink: 0,
              cursor:     'col-resize',
              // - 1px visible line centered in a 5px grab area
              background: 'linear-gradient(to right, transparent 2px, var(--vscode-panel-border, #333) 2px, var(--vscode-panel-border, #333) 3px, transparent 3px)',
            }}
          />

          {/* ── Right: message output ── */}
          <div
            ref={node => { outputEl.current = node; }}
            style={{
              flex:          1,
              overflowY:     'auto',
              padding:       0,
              display:       'flex',
              flexDirection: 'column',
              gap:           0,
              minHeight:     0,
              minWidth:      0,
            }}
          >
            {chat.history.length === 0 && !chat.thinking && !chat.streaming && (
              <div style={{ color: 'var(--vscode-foreground)', opacity: 0.3, fontSize: 11, padding: '10px 12px' }}>
                Ask anything about the canvas.
              </div>
            )}

            {chat.history.map((it, i) => {
              const key = it.kind === 'tool' ? it.id : `${it.kind}-${i}`;
              return it.kind === 'text'     ? <ChatBubble key={key} msg={it} />
                   : it.kind === 'thinking' ? <ThinkingBlock key={key} content={it.content} />
                   :                          <ToolCard key={key} item={it} />;
            })}

            {chat.streaming && (
              <ChatBubble
                msg={{ role: 'assistant', content: chat.streaming, timestamp: '' }}
                streaming
              />
            )}

            {chat.thinking && !chat.streaming && (
              <div style={{ color: 'var(--vscode-foreground)', opacity: 0.4, fontSize: 12, padding: '10px 12px' }}>
                ● ● ●
              </div>
            )}

            {chat.error && (
              <div style={{
                color:        `rgb(${CHAT_ERROR_RGB})`,
                fontSize:     11,
                padding:      '4px 8px',
                background:   `rgba(${CHAT_ERROR_RGB},0.1)`,
                borderRadius: 4,
                border:       `1px solid rgba(${CHAT_ERROR_RGB},0.3)`,
              }}>
                Error: {chat.error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Resize handle (expanded only) ── */}
      {!collapsed && (
        <div
          onMouseDown={chat.onResizeMouseDown}
          style={{
            position:   'absolute',
            bottom:     0,
            right:      0,
            width:      14,
            height:     14,
            cursor:     'se-resize',
            opacity:    0.4,
            background: 'linear-gradient(135deg, transparent 50%, var(--vscode-foreground) 50%)',
          }}
        />
      )}
    </div>
  );
}

// ─── ChatBubble ───────────────────────────────────────────────────────────────

// - memoized: history rows must NOT re-render when FloatingChat re-renders for an
// - unrelated reason (e.g. hjkl move → activeNodeId prop change). With stable item
// - objects only changed/streaming rows re-render — keeps a long transcript cheap.
const ChatBubble = memo(function ChatBubble({
  msg,
  streaming = false,
}: {
  msg:        ChatMessage;
  streaming?: boolean;
}): JSX.Element {
  const isUser = msg.role === 'user';
  const accent = isUser ? `rgb(${CHAT_USER_RGB})` : `rgb(${CHAT_ASSISTANT_RGB})`;

  // - full-width area (not a bubble): subtle background tint + left accent rule
  return (
    <div style={{
      width:        '100%',
      padding:      '8px 12px',
      background:   isUser ? `rgba(${CHAT_USER_RGB},0.06)` : 'transparent',
      borderLeft:   `2px solid ${isUser ? `rgba(${CHAT_USER_RGB},0.55)` : `rgba(${CHAT_ASSISTANT_RGB},0.45)`}`,
      borderBottom: '1px solid var(--vscode-panel-border, #2a2a3a)',
    }}>
      {/* - role label + per-reply cost (harness provider only) */}
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'baseline',
        fontSize:       9,
        fontWeight:     700,
        letterSpacing:  '0.5px',
        textTransform:  'uppercase',
        opacity:        0.65,
        color:          accent,
        marginBottom:   3,
      }}>
        <span>{isUser ? 'You' : 'Claude'}</span>
        {!isUser && msg.deltaUsd !== undefined && (
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--vscode-foreground)', opacity: 0.7 }}>
            Δ ${msg.deltaUsd.toFixed(2)}{msg.costUsd !== undefined ? ` · Σ $${msg.costUsd.toFixed(2)}` : ''}
          </span>
        )}
      </div>

      <div style={{
        // - user text in green so prompts stand out from assistant replies
        color:        isUser ? `rgb(${CHAT_USER_RGB})` : 'var(--vscode-foreground)',
        fontSize:     12,
        lineHeight:   1.55,
        userSelect:   'text',
        wordBreak:    'break-word',
      }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { output: 'mathml', throwOnError: false }]]}
          components={{
            p: ({ children }) => <p style={{ margin: '0 0 4px 0' }}>{children}</p>,
            code: ({ children, className }) => {
              const isBlock = className?.includes('language-');
              return isBlock
                ? <pre style={{ margin: '4px 0', padding: '4px 6px', background: 'rgba(0,0,0,0.3)', borderRadius: 3, overflow: 'auto' }}><code style={{ fontSize: 11 }}>{children}</code></pre>
                : <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.25)', padding: '0 3px', borderRadius: 2 }}>{children}</code>;
            },
          }}
        >
          {msg.content}
        </ReactMarkdown>
        {streaming && (
          <span style={{ display: 'inline-block', width: 6, height: 12, background: 'var(--vscode-foreground)', opacity: 0.5, marginLeft: 2, borderRadius: 1 }} />
        )}
      </div>
    </div>
  );
});

// ─── ToolCard / ThinkingBlock ───────────────────────────────────────────────────

const ToolCard = memo(function ToolCard({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }): JSX.Element | null {
  const v = toolCardView(item.name, item.input);
  const [open, setOpen] = useState(false);
  if (v.hidden) return null;
  const glyph = item.status === 'running' ? '⏳' : item.status === 'ok' ? '✓' : '✗';
  const color = item.status === 'error' ? `rgb(${CHAT_ERROR_RGB})` : 'var(--vscode-foreground)';
  return (
    <div style={{ margin: '3px 8px', padding: '4px 8px', borderRadius: 4, background: 'var(--vscode-editorWidget-background)', border: '1px solid var(--vscode-panel-border, #333)', fontSize: 11 }}>
      <div style={{ display: 'flex', gap: 6, cursor: v.kind === 'todo' ? 'default' : 'pointer', color }} onClick={v.kind === 'todo' ? undefined : () => setOpen(o => !o)}>
        <span>{glyph}</span><span style={{ fontWeight: 600 }}>{v.title}</span>
      </div>
      {v.kind === 'todo' && v.todos && (
        <div style={{ marginTop: 3, opacity: 0.85 }}>
          {v.todos.map((t, j) => <div key={j}>{t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} {t.text}</div>)}
        </div>
      )}
      {open && v.kind !== 'todo' && (
        <pre style={{ marginTop: 3, whiteSpace: 'pre-wrap', opacity: 0.7, fontSize: 10 }}>{JSON.stringify(item.input, null, 1)}</pre>
      )}
      {v.showResult && item.resultPreview && (
        <div style={{ marginTop: 3, opacity: 0.7, whiteSpace: 'pre-wrap', fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: 10 }}>{item.resultPreview}</div>
      )}
    </div>
  );
});

const ThinkingBlock = memo(function ThinkingBlock({ content }: { content: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '3px 8px', fontSize: 11, opacity: 0.55 }}>
      <div style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>💭 thinking{open ? ' ▾' : ' ▸'}</div>
      {open && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10, marginTop: 2 }}>{content}</pre>}
    </div>
  );
});
