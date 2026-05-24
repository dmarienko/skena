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

import { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode, VimMode } from 'monaco-vim';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ChatMessage } from '../../shared/types';
import { useFloatingChat } from '../hooks/useFloatingChat';

// ─── constants ─────────────────────────────────────────────────────────────────

const HEADER_H    = 26;   // - collapsed bar height
const INPUT_COL_W = 240;  // - right-side input column width
const HINT_BAR_H  = 20;   // - send-hint bar below Monaco

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
  postMessage:  (msg: unknown) => void;

  onDelta:           (handler: (delta: string)       => void) => () => void;
  onDone:            (handler: ()                    => void) => () => void;
  onError:           (handler: (msg: string)         => void) => () => void;
  onNodeAdded:       (handler: (note: string)        => void) => () => void;
  onHistoryRestored: (handler: (payload: {
    history:    ChatMessage[];
    collapsed?: boolean;
    pos?:       { x: number; y: number };
    size?:      { w: number; h: number };
  }) => void) => () => void;
}

// ─── component ────────────────────────────────────────────────────────────────

export function FloatingChat({
  activeNodeId,
  agentName = 'claude',
  postMessage,
  onDelta,
  onDone,
  onError,
  onNodeAdded,
  onHistoryRestored,
}: Props): JSX.Element {
  const chat             = useFloatingChat(postMessage);
  const outputEl         = useRef<HTMLDivElement>(null);
  const editorRef        = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const vimRef           = useRef<{ dispose: () => void } | null>(null);
  const pendingPasteRef  = useRef(false);
  const [isChatFocused, setIsChatFocused] = useState(false);

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
  useEffect(() => onNodeAdded(chat.addNodeAdded),          [onNodeAdded, chat.addNodeAdded]);
  useEffect(() => onHistoryRestored(chat.restoreHistory),  [onHistoryRestored, chat.restoreHistory]);

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

  // ─── auto-scroll output ────────────────────────────────────────────────

  useEffect(() => {
    outputEl.current?.scrollTo({ top: outputEl.current.scrollHeight, behavior: 'smooth' });
  }, [chat.history, chat.streaming]);

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

    // - vim mode without status bar element
    vimRef.current = initVimMode(editor, null) as { dispose: () => void };

    // - patch o/O newline command and wire clipboard relay
    patchVimNewlineAndIndent();
    applyVimClipboard();
    editor.onDidFocusEditorText(() => {
      applyVimClipboard();
      vscodePostMessage({ type: 'requestClipboardRead' });
      setIsChatFocused(true);
    });
    editor.onDidBlurEditorText(() => setIsChatFocused(false));

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

  return (
    <div
      onKeyDown={e => e.stopPropagation()}
      onKeyUp={e => e.stopPropagation()}
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
          ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 2px rgba(56,189,248,0.55), 0 0 18px rgba(56,189,248,0.25)'
          : '0 8px 32px rgba(0,0,0,0.5)',
        transition:    'box-shadow 0.15s ease',
        overflow:      'hidden',
        fontFamily:    'var(--vscode-font-family)',
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
        <span style={{
          flex:         1,
          fontSize:     11,
          fontWeight:   500,
          color:        'var(--vscode-foreground)',
          opacity:      0.7,
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
        }}>
          Agent: {agentName}
        </span>

        {chat.thinking && (
          <span style={{ fontSize: 9, color: 'var(--vscode-foreground)', opacity: 0.45 }}>
            ●●●
          </span>
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
            width:         INPUT_COL_W,
            flexShrink:    0,
            display:       'flex',
            flexDirection: 'column',
            userSelect:    'text',
          }}>
            {/* - Monaco editor — padding keeps text away from panel border and splitter */}
            <div style={{ flex: 1, minHeight: 0, height: inputEditorH, paddingLeft: 6, paddingRight: 6 }}>
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

          {/* ── Vertical divider ── */}
          <div style={{ width: 1, flexShrink: 0, background: 'var(--vscode-panel-border, #333)' }} />

          {/* ── Right: message output ── */}
          <div
            ref={outputEl}
            style={{
              flex:          1,
              overflowY:     'auto',
              padding:       '8px 10px',
              display:       'flex',
              flexDirection: 'column',
              gap:           10,
              minHeight:     0,
              minWidth:      0,
            }}
          >
            {chat.history.length === 0 && !chat.thinking && !chat.streaming && (
              <div style={{ color: 'var(--vscode-foreground)', opacity: 0.3, fontSize: 11, paddingTop: 6 }}>
                Ask anything about the canvas.
              </div>
            )}

            {chat.history.map((msg, i) => (
              <ChatBubble key={i} msg={msg} />
            ))}

            {chat.streaming && (
              <ChatBubble
                msg={{ role: 'assistant', content: chat.streaming, timestamp: '' }}
                streaming
              />
            )}

            {chat.thinking && !chat.streaming && (
              <div style={{ color: 'var(--vscode-foreground)', opacity: 0.4, fontSize: 12 }}>
                ● ● ●
              </div>
            )}

            {chat.error && (
              <div style={{
                color:        '#F87171',
                fontSize:     11,
                padding:      '4px 8px',
                background:   'rgba(248,113,113,0.1)',
                borderRadius: 4,
                border:       '1px solid rgba(248,113,113,0.3)',
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

function ChatBubble({
  msg,
  streaming = false,
}: {
  msg:        ChatMessage;
  streaming?: boolean;
}): JSX.Element {
  const isUser = msg.role === 'user';

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'row',
      gap:           6,
      alignItems:    'flex-start',
    }}>
      {/* - role dot: cyan = user, purple = assistant */}
      <div style={{
        width:        5,
        height:       5,
        borderRadius: '50%',
        marginTop:    7,
        flexShrink:   0,
        background:   isUser ? '#38BDF8' : '#A78BFA',
      }} />

      <div style={{
        maxWidth:     '95%',
        padding:      '4px 8px',
        borderRadius: '2px 8px 8px 8px',
        background:   isUser ? 'rgba(56,189,248,0.10)' : 'rgba(167,139,250,0.07)',
        border:       `1px solid ${isUser ? 'rgba(56,189,248,0.18)' : 'rgba(167,139,250,0.13)'}`,
        color:        'var(--vscode-foreground)',
        fontSize:     12,
        lineHeight:   1.55,
        userSelect:   'text',
        wordBreak:    'break-word',
      }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
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
}
