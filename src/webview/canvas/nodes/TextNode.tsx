/**
 * TextNode — inline markdown text node.
 * View mode: renders markdown (including inline images relative to canvas dir).
 * Edit mode: Monaco editor with vim keybindings.
 *
 * Enter edit mode:  double-click OR press Enter while node is focused/selected
 * Exit edit mode:   Esc / Ctrl+Cmd+Enter / click outside — all save content
 */

import React, { useState, useCallback, useRef } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import Editor, { OnMount } from '@monaco-editor/react';
import { initVimMode } from 'monaco-vim';
import { TextNode } from '../../../shared/types';
import { MarkdownRenderer } from '../../renderers/MarkdownRenderer';

export function TextNodeComponent({ data, id }: NodeProps): JSX.Element {
  const node = data as unknown as TextNode & { accentColor?: string };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef   = useRef<HTMLDivElement | null>(null);

  const borderColor = node.accentColor ?? '#454545';
  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  const commitEdit = useCallback((text: string) => {
    setEditing(false);
    setDraft(text);
    if (text !== node.text) {
      window.dispatchEvent(new CustomEvent('skena:nodeTextEdit', { detail: { id, text } }));
    }
    // - restore focus to the node wrapper so Enter key works immediately next time
    requestAnimationFrame(() => wrapperRef.current?.focus());
  }, [node.text, id]);

  const onEditorMount: OnMount = useCallback((editor, monacoInstance) => {
    editor.focus();

    // - initialise vim mode; status bar shows current vim mode / pending commands
    const vimMode = initVimMode(editor, vimStatusRef.current ?? undefined);

    // - Ctrl/Cmd+Enter → save and close from any mode
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      commitEdit(editor.getValue());
    });

    // - Double-Esc to exit:
    //   editor.onKeyDown fires BEFORE vim processes the key, so the status bar
    //   still shows the current mode at keydown time.
    //   First Esc:  status = "-- INSERT --" → do nothing → vim transitions to NORMAL
    //   Second Esc: status = ""             → normal mode → commit and close
    editor.onKeyDown(e => {
      if (e.browserEvent.key === 'Escape') {
        const status = vimStatusRef.current?.textContent ?? '';
        const inNormalMode = !status.includes('INSERT') &&
                             !status.includes('VISUAL') &&
                             !status.includes('REPLACE');
        if (inNormalMode) {
          commitEdit(editor.getValue());
        }
      }
    });

    // - clean up vim mode when the Monaco editor is destroyed
    editor.onDidDispose(() => vimMode.dispose());
  }, [commitEdit]);

  const enterEdit = useCallback(() => setEditing(true), []);

  return (
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
      // - Enter key while node is focused/selected → enter edit mode
      onKeyDown={e => {
        if (!editing && e.key === 'Enter') {
          e.stopPropagation();
          e.preventDefault();
          enterEdit();
        }
      }}
    >
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
        <div style={{ padding: 8, overflow: 'auto', flex: 1 }}>
          <MarkdownRenderer content={draft} baseUri="." />
        </div>
      )}
    </div>
  );
}
