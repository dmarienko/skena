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

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode, VimMode } from 'monaco-vim';
import { TextNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { ScrollableContent } from '../../components/ScrollableContent';
import { useHeatmap } from '../../context/HeatmapContext';
import { HANDLE_STYLE, useSelectedStyle } from './nodeShared';

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
    this.keyBuffer = [text ?? ''];
    this.linewise  = !!linewise;
    this.blockwise = !!blockwise;
    clipboardCache = { text: text ?? '', linewise: !!linewise };
    vscodePostMessage({ type: 'writeClipboard', text: text ?? '' });
  },
  pushText(text: string, linewise: boolean) {
    if (linewise) {
      if (!this.linewise) this.keyBuffer.push('\n');
      this.linewise = true;
    }
    this.keyBuffer.push(text);
    const full = this.keyBuffer.join('');
    clipboardCache = { text: full, linewise: this.linewise };
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
function patchVimNewlineAndIndent(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CM = VimMode as any;
  if (!CM?.commands) return;

  CM.commands.newlineAndIndent = function(cm: any) {
    const editor = cm.editor as MonacoEditor.IStandaloneCodeEditor;
    const pos = editor.getPosition();
    if (!pos) return;
    // - insert a literal newline at the current (EOL) cursor position
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
 * Wire the clipboard relay register into the vim RegisterController.
 * MUST be called after initVimMode() — the Vim singleton is not available until then.
 * Safe to call on every editor mount (handles re-registration and re-replacement).
 */
function applyVimClipboard(): void {
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

// - module-level skena:clipboardContent listener — registered at bundle load,
// - fires for both the proactive push on webviewReady AND every requestClipboardRead response.
// - Updates clipboardCache AND syncs sysReg.linewise so vim paste reads the right flag.
window.addEventListener('skena:clipboardContent', (e: Event) => {
  const text = (e as CustomEvent<string>).detail ?? '';
  clipboardCache    = { text, linewise: false };
  sysReg.linewise   = false;   // - pasted text from host is always character-wise
  sysReg.keyBuffer  = [text];  // - keep keyBuffer in sync as fallback
});

// ─── component ────────────────────────────────────────────────────────────────

export function TextNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as TextNode & { accentColor?: string };
  const { visible: hmVisible, nodeGlow } = useHeatmap();
  const hmNode = hmVisible ? nodeGlow.get(data.id as string) : undefined;
  const selectedStyle = useSelectedStyle(selected);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const vimStatusRef    = useRef<HTMLDivElement | null>(null);
  const wrapperRef      = useRef<HTMLDivElement | null>(null);
  // - stable ref to the Monaco instance so the clipboard event handler can reach it
  const editorRef       = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  // - persists cursor position across edit sessions (saveViewState / restoreViewState)
  const savedViewState  = useRef<MonacoEditor.ICodeEditorViewState | null>(null);

  const borderColor = node.accentColor ?? '#454545';
  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  const commitEdit = useCallback((text: string) => {
    // - save cursor position before Monaco is destroyed so we can restore it next session
    savedViewState.current = editorRef.current?.saveViewState() ?? null;
    setEditing(false);
    editorRef.current = null;
    setDraft(text);
    if (text !== node.text) {
      window.dispatchEvent(new CustomEvent('skena:nodeTextEdit', { detail: { id, text } }));
    }
    // - restore focus to the node wrapper so Enter key works immediately next time
    requestAnimationFrame(() => wrapperRef.current?.focus());
  }, [node.text, id]);

  // ─── clipboard response handler ─────────────────────────────────────────
  // - permanent (component lifetime) listener:
  //   • always updates clipboardCache so vim's + register get() is up-to-date
  //   • if pendingPaste is set (Ctrl+V was pressed), inserts text into Monaco

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail ?? '';
      clipboardCache = { text, linewise: false };

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
  // - Reads --vscode-editor-background so the Monaco panel matches the webview
  // - background exactly, and adds explicit markdown token colours (Monaco's
  // - built-in vs-dark/vs have no dedicated markdown rules).
  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    const style = getComputedStyle(document.body);
    const bg    = style.getPropertyValue('--vscode-editor-background').trim();
    const dark  = isDark;

    monacoInstance.editor.defineTheme('skena-editor', {
      base:    dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        // - token names come from Monaco's built-in Monarch markdown tokenizer
        { token: 'keyword',         foreground: dark ? '569cd6' : '0070c1',                     },  // headings + list markers
        { token: 'strong',          foreground: dark ? 'dcdcaa' : '795e26', fontStyle: 'bold'   },  // **bold**
        { token: 'emphasis',        foreground: dark ? 'ce9178' : 'a31515', fontStyle: 'italic' },  // *italic*
        { token: 'string.link',     foreground: dark ? '4ec9b0' : '267f99'                      },  // [links](url)
        { token: 'comment',         foreground: dark ? '6a9955' : '008000', fontStyle: 'italic' },  // > blockquotes
        { token: 'string',          foreground: dark ? 'ce9178' : 'a31515'                      },  // ``` fences
        { token: 'variable.source', foreground: dark ? 'd7ba7d' : '795e26'                      },  // code block content
      ],
      colors: {
        'editor.background': bg || (dark ? '#1e1e1e' : '#ffffff'),
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
        vscodePostMessage({ type: 'writeClipboard', text });
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
      className="skena-node"
      style={{
        border:        `1.5px solid ${borderColor}`,
        height:        '100%',
        borderRadius:  6,
        overflow:      'hidden',
        display:       'flex',
        flexDirection: 'column',
        outline:       'none',
        // - heatmap glow overrides: filter (drop-shadow), borderColor, opacity
        ...(hmNode ? {
          filter:      hmNode.glowFilter,
          borderColor: hmNode.borderColor,
          opacity:     hmNode.opacity,
        } : {}),
        // - sci-fi focus ring — box-shadow coexists with heatmap filter
        ...selectedStyle,
      }}
      tabIndex={0}
      onDoubleClick={enterEdit}
      // - Enter key while node is React-Flow-selected AND DOM-focused → enter edit mode
      onKeyDown={e => {
        if (!editing && selected && e.key === 'Enter') {
          e.stopPropagation();
          e.preventDefault();
          enterEdit();
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
        // - (space = pan, arrow keys = nudge, delete = delete node, etc.)
        <div
          style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
        >
          <div style={{ flex: 1 }}>
            <Editor
              height="100%"
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
        <ScrollableContent scrollKey={id} style={{ padding: 8 }}>
          <MarkdownRenderer content={draft} baseUri="." />
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
