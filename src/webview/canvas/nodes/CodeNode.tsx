/**
 * CodeNode — editable code cell that runs on a bound kernel node.
 * Header has a Run button + status glyph; body is a Monaco (python) editor.
 * Run is disabled until the cell is connected to a kernel node (see kernelBinding).
 */

import React, { useCallback, useState, useEffect, useRef, memo } from 'react';
import { NodeProps, Handle, Position, NodeResizer, useStore } from '@xyflow/react';
import Editor, { BeforeMount, OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode } from 'monaco-vim';
import { CodeNode } from '../../../shared/types';
import type { CanvasNode, CanvasEdge, MsgAddNodeResult } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';
import { resolveBoundKernel } from '../../../shared/kernelBinding';
import { CodeRenderer } from '../../renderers/CodeRenderer';
import { ScrollableContent } from '../../components/ScrollableContent';
import { ensureKernelCompletion, setActiveCodeCell } from './kernelCompletion';

function vscodePostMessage(msg: unknown) {
  (window as unknown as Record<string, { postMessage: (m: unknown) => void }>)['vscodeApi']?.postMessage(msg);
}

// - Monaco overflow widgets (suggest/hover/signature) render with position:fixed. React
// - Flow's viewport transform would make "fixed" relative to the zoomed pane, hiding them
// - off-screen — so anchor them to a body-level container that has no transformed ancestor.
function overflowWidgetsRoot(): HTMLElement {
  let el = document.getElementById('skena-monaco-overflow');
  if (!el) {
    el = document.createElement('div');
    el.id = 'skena-monaco-overflow';
    el.className = 'monaco-editor';   // - Monaco styles its widgets under this class
    el.style.position = 'absolute';
    el.style.zIndex = '2000';
    document.body.appendChild(el);
  }
  return el;
}

function CodeNodeInner({ data, id, selected }: NodeProps): JSX.Element {
  const node = data as unknown as CodeNode & { accentColor?: string };
  const bw = useZoomInvariantBorderWidth(1.5);
  const selectedStyle = useSelectedStyle(selected);
  const borderColor = node.accentColor ?? DEFAULT_NODE_BORDER_BY_TYPE.code;
  const [code, setCode] = useState(node.code ?? '');
  const [editing, setEditing] = useState(false);
  // - always-current node geometry for the `o` shortcut (closures would otherwise go stale)
  const geomRef = useRef({ x: node.x, y: node.y, width: node.width, height: node.height });
  geomRef.current = { x: node.x, y: node.y, width: node.width, height: node.height };

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
  // - cursor + scroll position, preserved across edit → preview → edit so re-entering
  // - the cell lands where you left off instead of at line 1
  const savedViewState = useRef<MonacoEditor.ICodeEditorViewState | null>(null);
  const magicDecoRef = useRef<string[]>([]);
  const onEditorMount = useCallback<OnMount>((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    // - the focused cell is the completion target (provider is global per Monaco)
    editorInstance.onDidFocusEditorText(() => setActiveCodeCell(id));

    // - colour IPython magic / shell lines (%, %%, !) distinctly — they aren't valid
    // - Python so the python grammar mis-tokenises them; decorate the magic token.
    const refreshMagic = () => {
      const model = editorInstance.getModel();
      if (!model) return;
      const decos: MonacoEditor.IModelDeltaDecoration[] = [];
      for (let ln = 1; ln <= model.getLineCount(); ln++) {
        const m = model.getLineContent(ln).match(/^(\s*)(%{1,2}\s*[A-Za-z_]\w*|!)/);
        if (m) {
          const from = m[1].length + 1;
          decos.push({
            range: new monacoInstance.Range(ln, from, ln, from + m[2].length),
            options: { inlineClassName: 'skena-magic' },
          });
        }
      }
      magicDecoRef.current = editorInstance.deltaDecorations(magicDecoRef.current, decos);
    };
    editorInstance.onDidChangeModelContent(refreshMagic);
    refreshMagic();
    // - run bindings (per-instance, safe): fire from ANY vim mode and do NOT change it,
    // - so you can type in insert mode, run, and keep typing. Shift+Enter / Ctrl+Enter /
    // - Alt+R / Alt+J all run the cell.
    const bindRun = (keybinding: number) => editorInstance.addCommand(keybinding, () => runRef.current());
    bindRun(monacoInstance.KeyMod.Shift   | monacoInstance.KeyCode.Enter);
    bindRun(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter);
    bindRun(monacoInstance.KeyMod.Alt     | monacoInstance.KeyCode.KeyR);
    bindRun(monacoInstance.KeyMod.Alt     | monacoInstance.KeyCode.KeyJ);

    // - Ctrl+J / Ctrl+K navigate the completion dropdown (like ↓/↑); gated so they only
    // - fire while the suggest widget is open and don't interfere with typing otherwise.
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyJ,
      () => editorInstance.trigger('kb', 'selectNextSuggestion', {}), 'suggestWidgetVisible');
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK,
      () => editorInstance.trigger('kb', 'selectPrevSuggestion', {}), 'suggestWidgetVisible');
    // - vim mode (same editor experience as text nodes); status bar shows the mode
    initVimMode(editorInstance, vimStatusRef.current ?? undefined);
    if (savedViewState.current) editorInstance.restoreViewState(savedViewState.current);
    editorInstance.focus();

    const leaveEdit = () => {
      savedViewState.current = editorInstance.saveViewState();
      setEditing(false);
    };
    // - click / tab away from the editor → leave edit mode back to the preview
    editorInstance.onDidBlurEditorText(leaveEdit);

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
      if (e.browserEvent.key === 'Escape' && !vimIsEditing) leaveEdit();
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

  // - while the node is selected (preview mode): Enter → edit; the run combos run in
  // - place. Capture phase so Alt+J/R beat the spatial-nav handler. (In edit mode the
  // - Monaco addCommands above handle the same combos.)
  useEffect(() => {
    if (!selected || editing) return;
    const onKey = (e: KeyboardEvent) => {
      // - don't hijack keys while the user is typing somewhere else (chat input, search,
      // - another Monaco) — this node can stay React-Flow-"selected" in the background.
      // - check both the event target and the focused element, and any enclosing editor.
      const inField = (el: HTMLElement | null) => !!el && (
        el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable ||
        !!el.closest?.('textarea, input, [contenteditable="true"], .monaco-editor')
      );
      if (inField(e.target as HTMLElement | null) || inField(document.activeElement as HTMLElement | null)) return;
      const runCombo =
        (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && ['r', 'R', 'j', 'J'].includes(e.key)) ||
        ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') ||
        (e.shiftKey && !e.altKey && e.key === 'Enter');
      if (runCombo) { e.preventDefault(); e.stopPropagation(); runRef.current(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setEditing(true); return; }
      // - vim `o`: open a new code cell below, chained to this one (inherits the kernel via
      // - the edge), same width; focus + edit it immediately
      if (e.key === 'o' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); e.stopPropagation();
        const g = geomRef.current;
        const newId = `code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const newNode: CanvasNode = {
          id: newId, type: 'code', code: '', language: 'python',
          x: Math.round(g.x), y: Math.round(g.y + g.height + 350),
          width: g.width, height: 200,
        };
        const newEdge: CanvasEdge = {
          id: `${id}-${newId}-${Date.now()}`,
          fromNode: id, fromSide: 'bottom', toNode: newId, toSide: 'top', toEnd: 'arrow',
        };
        window.dispatchEvent(new CustomEvent('skena:addNodeResult', {
          detail: { type: 'addNodeResult', node: newNode, edge: newEdge, autoEdit: true } satisfies MsgAddNodeResult,
        }));
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [selected, editing]);

  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  // - define the VS Code-synced theme before the editor is created, identical to
  // - TextNode's registration (defineTheme is global by name; keeping it byte-for-byte
  // - identical means re-registration here never clobbers TextNode's colours).
  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    // - register the kernel-backed completion provider once (idempotent)
    ensureKernelCompletion(monacoInstance);
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
                // - render suggest / hover / signature popups at a body-level node so the
                // - node's overflow:hidden doesn't clip them and React Flow's viewport
                // - transform doesn't push the position:fixed widgets off-screen
                fixedOverflowWidgets:  true,
                overflowWidgetsDomNode: overflowWidgetsRoot(),
              }}
            />
            {/* - vim mode status bar */}
            <div ref={vimStatusRef} className="skena-code-vim-status" style={{ fontSize: 10, opacity: 0.6, padding: '0 6px', fontFamily: 'var(--vscode-editor-font-family, monospace)' }} />
          </div>
        ) : (
          /* - read-only highlighted preview; ScrollableContent gives the wheel-guard so it
             - actually scrolls (a bare nowheel div doesn't). Double-click (or Enter) to edit. */
          <ScrollableContent scrollKey={`${id}-code`} className="skena-code-cell-preview" style={{ padding: '4px 0', cursor: 'text' }}>
            <div onDoubleClick={() => setEditing(true)} title="Double-click to edit">
              {code.trim()
                ? <CodeRenderer content={code} language={node.language ?? 'python'} />
                : <div style={{ padding: 8, opacity: 0.5, fontSize: 12, fontStyle: 'italic' }}>empty — double-click to edit</div>}
            </div>
          </ScrollableContent>
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
