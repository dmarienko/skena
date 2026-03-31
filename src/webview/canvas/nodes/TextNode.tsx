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
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode, VimMode } from 'monaco-vim';
import { TextNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';
import { ScrollableContent } from '../../components/ScrollableContent';

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

// ─── vim clipboard wiring (run once at module load) ──────────────────────────
// - VimMode.Vim is the underlying CodeMirror Vim singleton.
// - We define vim's system-clipboard registers (+/*) to relay through extension host.
// - clipboard=unnamedplus makes all unnamed y/p go through these registers,
// - giving `yy` / `p` the same effect as `"+yy` / `"+p` in a full vim setup.
(function setupVimClipboard() {
  const Vim = (VimMode as unknown as Record<string, unknown>).Vim as
    | { defineRegister: (n: string, r: unknown) => void; setOption: (k: string, v: string) => void }
    | undefined;
  if (!Vim?.defineRegister) return;

  const sysReg = {
    set(text: string, linewise: boolean) {
      clipboardCache = { text, linewise };
      vscodePostMessage({ type: 'writeClipboard', text });
    },
    get() {
      return { text: clipboardCache.text, linewise: clipboardCache.linewise };
    },
  };

  // - + = system clipboard, * = X11 primary selection — both wired to host clipboard
  Vim.defineRegister('+', sysReg);
  Vim.defineRegister('*', sysReg);

  // - make unnamed register (`y`/`p`) behave like `"+y`/`"+p`
  try { Vim.setOption('clipboard', 'unnamedplus'); } catch { /* option may not exist */ }
})();

// ─── component ────────────────────────────────────────────────────────────────

export function TextNodeComponent({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as TextNode & { accentColor?: string };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef   = useRef<HTMLDivElement | null>(null);
  // - stable ref to the Monaco instance so the clipboard event handler can reach it
  const editorRef    = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  const borderColor = node.accentColor ?? '#454545';
  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  const commitEdit = useCallback((text: string) => {
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

  const onEditorMount: OnMount = useCallback((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    editorInstance.focus();

    // - refresh clipboard cache whenever Monaco gains focus (covers copy-outside-then-back)
    editorInstance.onDidFocusEditorText(() => {
      vscodePostMessage({ type: 'requestClipboardRead' });
    });

    // - initialise vim mode; status bar shows current vim mode / pending commands
    const vimMode = initVimMode(editorInstance, vimStatusRef.current ?? undefined);

    // - Ctrl/Cmd+Enter → save and close from any mode
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      commitEdit(editorInstance.getValue());
    });

    // - Double-Esc to exit:
    //   editor.onKeyDown fires BEFORE vim processes the key, so the status bar
    //   still shows the current mode at keydown time.
    //   First Esc:  status = "-- INSERT --" → do nothing → vim transitions to NORMAL
    //   Second Esc: status = ""             → normal mode → commit and close
    editorInstance.onKeyDown(e => {
      if (e.browserEvent.key === 'Escape') {
        const status = vimStatusRef.current?.textContent ?? '';
        const inNormalMode = !status.includes('INSERT') &&
                             !status.includes('VISUAL') &&
                             !status.includes('REPLACE');
        if (inNormalMode) {
          commitEdit(editorInstance.getValue());
        }
      }
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

    // - clean up vim mode when the Monaco editor is destroyed
    editorInstance.onDidDispose(() => vimMode.dispose());
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
    <NodeLabelBadge label={node.nodeLabel} />
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
        outline:       'none',   // - suppress focus ring (handled by .selected class)
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
      <Handle type="source" position={Position.Top}    id="top"    />
      <Handle type="source" position={Position.Right}  id="right"  />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left}   id="left"   />

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
              theme={isDark ? 'vs-dark' : 'vs'}
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
    </>
  );
}
