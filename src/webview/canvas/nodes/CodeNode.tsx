/**
 * CodeNode — editable code cell that runs on a bound kernel node.
 * Header has a Run button + status glyph; body is a Monaco (python) editor.
 * Run is disabled until the cell is connected to a kernel node (see kernelBinding).
 */

import React, { useCallback, useState, useEffect, useRef, memo } from 'react';
import { NodeProps, Handle, Position, NodeResizer, useStore } from '@xyflow/react';
import Editor, { BeforeMount, OnMount } from '@monaco-editor/react';
import { initVimMode } from 'monaco-vim';
import { CodeNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';
import { resolveBoundKernel } from '../../../shared/kernelBinding';
import { CodeRenderer } from '../../renderers/CodeRenderer';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

function CodeNodeInner({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CodeNode & { accentColor?: string };
  const bw = useZoomInvariantBorderWidth(1.5);
  const selectedStyle = useSelectedStyle(selected);
  const borderColor = node.accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE.code;
  const [code, setCode] = useState(node.code ?? '');
  const [editing, setEditing] = useState(false);

  // - re-sync from an external write (MCP / disk reload) — React Flow keeps this
  // - instance by id, so a changed data.code prop would otherwise leave `code` stale.
  useEffect(() => { setCode(node.code ?? ''); }, [node.code]);

  // - selector returns a primitive (kernel id | null), so default Object.is
  // - equality is safe and does not trigger a render loop.
  const bound = useStore(s => {
    const edges = s.edges.map(e => ({ fromNode: e.source, toNode: e.target }));
    const kernelIds = new Set(
      s.nodes
        .filter(n => (n.data as { type?: string } | undefined)?.type === 'kernel' || n.type === 'kernel')
        .map(n => n.id),
    );
    return resolveBoundKernel(id, edges, nid => kernelIds.has(nid));
  });

  const run = useCallback(() => {
    if (!bound) return;
    vscodePostMessage({ type: 'runCell', cellNodeId: id, code });
  }, [bound, id, code]);

  // - addCommand captures its callback once at mount, so route through a ref
  // - kept fresh with the latest `run` (which closes over bound/code).
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; }, [run]);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const onEditorMount = useCallback<OnMount>((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    // - per-instance binding (safe); Shift+Enter runs the cell from any Monaco context.
    editorInstance.addCommand(monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Enter, () => {
      runRef.current();
    });
    // - vim mode (same editor experience as text nodes); status bar shows the mode
    initVimMode(editorInstance, vimStatusRef.current ?? undefined);
    editorInstance.focus();
    // - click / tab away from the editor → leave edit mode back to the preview
    editorInstance.onDidBlurEditorText(() => setEditing(false));

    // - Esc exits edit mode only from vim NORMAL mode (INSERT/VISUAL just return to normal).
    // - Track the mode from the status bar; MutationObserver runs as a microtask so inside
    // - onKeyDown `vimIsEditing` still holds the pre-key state (same trick as TextNode).
    let vimIsEditing = false;
    if (vimStatusRef.current) {
      const obs = new MutationObserver(() => {
        const t = vimStatusRef.current?.textContent ?? '';
        vimIsEditing = t.includes('INSERT') || t.includes('VISUAL') || t.includes('REPLACE');
      });
      obs.observe(vimStatusRef.current, { childList: true, subtree: true, characterData: true });
      editorInstance.onDidDispose(() => obs.disconnect());
    }
    editorInstance.onKeyDown(e => {
      if (e.browserEvent.key === 'Escape' && !vimIsEditing) setEditing(false);
    });
  }, []);

  // - a freshly-created code cell (autoEdit) or Enter-on-selected fires skena:enterEdit → edit mode
  useEffect(() => {
    const onEnter = (e: Event) => {
      if ((e as CustomEvent).detail?.id === id) setEditing(true);
    };
    window.addEventListener('skena:enterEdit', onEnter);
    return () => window.removeEventListener('skena:enterEdit', onEnter);
  }, [id]);

  // - Enter while the node is selected (and not already editing) → edit mode
  useEffect(() => {
    if (!selected || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setEditing(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, editing]);

  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  // - define the VS Code-synced theme before the editor is created, identical to
  // - TextNode's registration (defineTheme is global by name; keeping it byte-for-byte
  // - identical means re-registration here never clobbers TextNode's colours).
  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    const style = getComputedStyle(document.body);
    const bg    = style.getPropertyValue('--vscode-editor-background').trim();
    const dark  = isDark;

    monacoInstance.editor.defineTheme('skena-editor', {
      base:    dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'keyword',         foreground: dark ? '569cd6' : '0070c1'                      },
        { token: 'strong',          foreground: dark ? 'dcdcaa' : '795e26', fontStyle: 'bold'   },
        { token: 'emphasis',        foreground: dark ? 'ce9178' : 'a31515', fontStyle: 'italic' },
        { token: 'variable',        foreground: dark ? 'd7ba7d' : '795e26'                      },
        { token: 'variable.source', foreground: dark ? 'd7ba7d' : '795e26'                      },
        { token: 'string.link',     foreground: dark ? '4ec9b0' : '267f99'                      },
        { token: 'comment',         foreground: dark ? '6a9955' : '008000', fontStyle: 'italic' },
        { token: 'string',          foreground: dark ? 'ce9178' : 'a31515'                      },
      ],
      colors: {
        'editor.background':               bg || (dark ? '#1e1e1e' : '#ffffff'),
        'editor.lineHighlightBackground':  '#00000000',
        'editor.lineHighlightBorderColor': '#00000000',
      },
    });
  }, [isDark]);

  const status = node.lastStatus;
  const glyph = status === 'running' ? '◗' : status === 'ok' ? '✓' : status === 'error' ? '✗' : '';

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={(node as { createdBy?: string }).createdBy} />
      <div
        className="skena-node skena-node--code"
        style={{
          border:        `${bw}px solid ${borderColor}`,
          height:        '100%',
          display:       'flex',
          flexDirection: 'column',
          borderRadius:  6,
          overflow:      'hidden',
          background:    'var(--vscode-editorWidget-background)',
          ...selectedStyle,
        }}
      >
        <NodeResizer
          minWidth={160} minHeight={90} isVisible={selected}
          onResizeEnd={(_, p) => window.dispatchEvent(new CustomEvent('skena:nodeResize', {
            detail: { id, x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
          }))}
        />
        {/* - padding clears the corner resize handle (left) and the 34px label badge (right) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 40px 3px 14px', fontSize: 12, borderBottom: `1px solid ${borderColor}` }}>
          <button
            onClick={e => { e.stopPropagation(); run(); }}
            disabled={!bound}
            title={bound ? 'Run on bound kernel (Shift+Enter)' : 'Connect this cell to a kernel node to run'}
            style={{ cursor: bound ? 'pointer' : 'not-allowed', background: 'transparent', border: 'none', color: bound ? borderColor : '#6b7280', fontSize: 13, padding: 0 }}
          >▶</button>
          <span style={{ opacity: 0.7 }}>{node.language ?? 'python'}</span>
          <span title={status ?? ''} style={{ marginLeft: 'auto', color: status === 'error' ? '#e5484d' : borderColor, fontSize: 14 }}>{glyph}</span>
        </div>
        {editing ? (
          /* - nodrag/nowheel: let Monaco own pointer + wheel (React Flow otherwise pans/zooms
             and never gives the editor focus); stopPropagation keeps RF hotkeys off while typing */
          <div
            className="nodrag nowheel"
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
          >
            <Editor
              height="100%"
              defaultLanguage="python"
              language="python"
              theme="skena-editor"
              beforeMount={beforeMount}
              onMount={onEditorMount}
              value={code}
              onChange={v => {
                const next = v ?? '';
                setCode(next);
                window.dispatchEvent(new CustomEvent('skena:nodeCodeEdit', { detail: { id, code: next } }));
              }}
              options={{
                minimap:              { enabled: false },
                lineNumbers:          'off',
                fontFamily:           'var(--vscode-editor-font-family, monospace)',
                fontSize:             12,
                scrollBeyondLastLine: false,
                folding:              false,
                glyphMargin:          false,
                overviewRulerLanes:   0,
                renderLineHighlight:  'none',
                scrollbar:            { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
                automaticLayout:      true,
              }}
            />
            {/* - vim mode status bar */}
            <div ref={vimStatusRef} className="skena-code-vim-status" style={{ fontSize: 10, opacity: 0.6, padding: '0 6px', fontFamily: 'var(--vscode-editor-font-family, monospace)' }} />
          </div>
        ) : (
          /* - read-only highlighted preview; double-click (or Enter when selected) to edit */
          <div
            className="nowheel skena-code-cell-preview"
            style={{ flex: 1, minHeight: 0, overflow: 'auto', cursor: 'text' }}
            onDoubleClick={() => setEditing(true)}
            title="Double-click to edit"
          >
            {code.trim()
              ? <CodeRenderer content={code} language={node.language ?? 'python'} />
              : <div style={{ padding: 8, opacity: 0.5, fontSize: 12, fontStyle: 'italic' }}>empty — double-click to edit</div>}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}

export const CodeNodeComponent = memo(CodeNodeInner);
