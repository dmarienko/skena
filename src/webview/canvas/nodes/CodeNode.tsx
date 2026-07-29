/**
 * CodeNode — editable code cell that runs on a bound kernel node.
 * Header has a Run button + status glyph; body is a Monaco (python) editor.
 * Run is disabled until the cell is connected to a kernel node (see kernelBinding).
 */

import React, { useCallback, useState, useEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps, Handle, Position, NodeResizer, useStore } from '@xyflow/react';
import Editor, { BeforeMount, OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { initVimMode } from 'monaco-vim';
import { CodeNode } from '../../../shared/types';
import { NodeLabelBadge } from '../../components/NodeLabelBadge';
import { HANDLE_STYLE, useSelectedStyle, useZoomInvariantBorderWidth } from './nodeShared';
import { DEFAULT_NODE_BORDER_BY_TYPE } from '../palette';
import { resolveBoundKernel } from '../../../shared/kernelBinding';
import { CodeRenderer } from '../../renderers/CodeRenderer';
import { ScrollableContent, setScrollPosition } from '../../components/ScrollableContent';
import { applyVimClipboard, patchVimNewlineAndIndent } from './TextNode';
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
  // - use the VS Code editor font (family + size) so the Monaco editor matches the shiki
  // - preview. These vars ARE injected into webviews (unlike the editor colour vars).
  const editorFont = useMemo(() => {
    const cs = getComputedStyle(document.body);
    const family = cs.getPropertyValue('--vscode-editor-font-family').trim() || 'monospace';
    const size   = parseInt(cs.getPropertyValue('--vscode-editor-font-size'), 10) || 12;
    // - explicit px line height (Monaco rounds a <8 multiplier to px; shiki uses the raw
    // - value → a size mismatch). Use the SAME px for both so preview<->edit don't grow.
    const lineHeight = Math.round(size * 1.3);
    return { family, size, lineHeight };
  }, []);

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

  const isRunning = node.lastStatus === 'running';
  const isRunningRef = useRef(isRunning);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  // - interrupt (SIGINT) the kernel running this cell; the host resolves the bound kernel.
  // - `confirm` asks the host for a modal first (used by the Ctrl+C hotkey, which is easy to mishit).
  const interrupt = useCallback((confirm: boolean) => {
    vscodePostMessage({ type: 'interruptCell', cellNodeId: id, confirm });
  }, [id]);
  const interruptRef = useRef(interrupt);
  useEffect(() => { interruptRef.current = interrupt; }, [interrupt]);

  // - right-click menu (portal'd to body so React Flow's viewport transform doesn't offset it)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('mousedown', onDown, { capture: true });
    return () => window.removeEventListener('mousedown', onDown, { capture: true });
  }, [menu]);
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (editing) return;   // - in edit mode let Monaco show its own context menu
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }, [editing]);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  // - cursor + scroll position, preserved across edit → preview → edit so re-entering
  // - the cell lands where you left off instead of at line 1
  const savedViewState = useRef<MonacoEditor.ICodeEditorViewState | null>(null);
  const magicDecoRef = useRef<string[]>([]);
  const onEditorMount = useCallback<OnMount>((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    // - pin the shiki preview's line-number gutter to Monaco's REAL gutter width so the code
    // - start x is pixel-identical across preview<->edit (no 2-3px shift). contentLeft is the
    // - measured px from the editor's left to the first code glyph (line-numbers + decorations).
    // - Font + minChars are the same for every code cell, so this constant is set globally.
    const syncGutter = () => {
      const cl = editorInstance.getLayoutInfo().contentLeft;
      document.documentElement.style.setProperty('--skena-code-gutter', `${cl}px`);
    };
    syncGutter();
    editorInstance.onDidLayoutChange(syncGutter);
    // - the focused cell is the completion target (provider is global per Monaco); also refresh
    // - the clipboard cache from the host so vim `p` / Ctrl+V paste the current system clipboard
    editorInstance.onDidFocusEditorText(() => {
      setActiveCodeCell(id);
      vscodePostMessage({ type: 'requestClipboardRead' });
    });

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

    // - Ctrl+J / Ctrl+K navigate the completion dropdown (like ↓/↑) — via onKeyDown, NOT
    // - addCommand: registering Ctrl+K globally breaks Monaco's Ctrl+K-prefixed chords
    // - (Ctrl+K Ctrl+C/U = comment/uncomment). Only act while the suggest widget is open;
    // - otherwise the keys fall through to Monaco's normal handling.
    editorInstance.onKeyDown(e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (!document.querySelector('.suggest-widget.visible')) return;
      if (e.keyCode === monacoInstance.KeyCode.KeyJ) { e.preventDefault(); e.stopPropagation(); editorInstance.trigger('kb', 'selectNextSuggestion', {}); }
      else if (e.keyCode === monacoInstance.KeyCode.KeyK) { e.preventDefault(); e.stopPropagation(); editorInstance.trigger('kb', 'selectPrevSuggestion', {}); }
    });
    // - vim mode (same editor experience as text nodes); status bar shows the mode
    initVimMode(editorInstance, vimStatusRef.current ?? undefined);
    // - wire vim y/p to the host clipboard relay (webview sandbox blocks navigator.clipboard);
    // - MUST run after initVimMode (which can recreate the register controller). Also patch
    // - vim o/O newline. Both operate on monaco-vim's global singleton.
    applyVimClipboard();
    patchVimNewlineAndIndent();
    if (savedViewState.current) editorInstance.restoreViewState(savedViewState.current);
    editorInstance.focus();

    const leaveEdit = () => {
      // - save cursor+scroll only while the editor is still alive; a disposed editor's
      // - saveViewState() returns null and would wipe the saved position (reset to line 1)
      if (editorInstance.getModel()) {
        const vs = editorInstance.saveViewState();
        if (vs) savedViewState.current = vs;
        // - hand the editor's scroll offset to the preview so it keeps the same visible frame
        // - (shiki preview shares the editor font + line-height, so scrollTop maps 1:1)
        setScrollPosition(`${id}-code`, editorInstance.getScrollTop());
      }
      setEditing(false);
    };
    // - click / tab away from the editor → leave edit mode back to the preview. BUT a blur
    // - into the vim command/search prompt (`/`, `?`, `:` — monaco-vim renders it into our
    // - status bar) is still "editing"; defer so activeElement is the new target, and stay.
    // - Skip entirely if the editor was already disposed (e.g. Esc-exit already ran leaveEdit).
    editorInstance.onDidBlurEditorText(() => {
      setTimeout(() => {
        if (!editorInstance.getModel()) return;
        if (vimStatusRef.current && vimStatusRef.current.contains(document.activeElement)) return;
        leaveEdit();
      }, 0);
    });

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
      // - Ctrl/Cmd+C interrupts a RUNNING cell (host shows a confirm — it's easy to mishit). Only
      // - fires when this cell is running; otherwise it falls through (no node-copy binding here).
      if (isRunningRef.current && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault(); e.stopPropagation();
        interruptRef.current(true);
        return;
      }
      const runCombo =
        (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && ['r', 'R', 'j', 'J'].includes(e.key)) ||
        ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') ||
        (e.shiftKey && !e.altKey && e.key === 'Enter');
      if (runCombo) { e.preventDefault(); e.stopPropagation(); runRef.current(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setEditing(true); return; }
      // - vim `o`: open a new code cell below, chained to this one. CanvasView computes a
      // - non-overlapping position (it has the full node list) and creates node + edge.
      if (e.key === 'o' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); e.stopPropagation();
        window.dispatchEvent(new CustomEvent('skena:addCodeBelow', { detail: { sourceId: id } }));
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [selected, editing]);

  const isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');

  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    // - register the kernel-backed completion provider once (idempotent)
    ensureKernelCompletion(monacoInstance);
    const style = getComputedStyle(document.body);
    const bg    = style.getPropertyValue('--vscode-editor-background').trim();
    const dark  = isDark;

    // - match the shiki preview: when the factors markdown theme is active, colour the editor
    // - tokens with the same factors palette (teal keywords / amber strings / …) so preview
    // - and edit look like the same theme. Otherwise a VS-Code-Dark+-ish default.
    const factors = document.documentElement.dataset.mdTheme === 'factors';
    const rules = factors
      ? [
          { token: 'comment',    foreground: '56635d', fontStyle: 'italic' },
          { token: 'keyword',    foreground: '4cc8a0' },
          { token: 'string',     foreground: 'd9a23f' },
          { token: 'number',     foreground: 'e5707a' },
          { token: 'type',       foreground: '4cc8a0' },
          { token: 'identifier', foreground: 'c7d1cc' },
          { token: 'operator',   foreground: '7c8a84' },
          { token: 'delimiter',  foreground: '7c8a84' },
        ]
      : [
          { token: 'keyword',    foreground: dark ? '569cd6' : '0070c1'                      },
          { token: 'comment',    foreground: dark ? '6a9955' : '008000', fontStyle: 'italic' },
          { token: 'string',     foreground: dark ? 'ce9178' : 'a31515'                      },
        ];

    monacoInstance.editor.defineTheme('skena-code', {
      base:    dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules,
      // - VS Code doesn't inject editor colours as CSS vars into webviews, so bake the palette
      // - here. Not dynamic — edit these to retune the code cell editor look.
      colors: {
        'editor.background':                        bg || (dark ? '#1e1e1e' : '#ffffff'),
        'editorCursor.foreground':                  '#f01010',
        'editor.lineHighlightBackground':           '#199ce809',
        'editor.lineHighlightBorder':               '#199ce805',
        'editor.selectionBackground':               '#212a66f0',
        'editor.selectionHighlightBackground':      '#ff402030',
        'editor.inactiveSelectionBackground':       '#29328080',
        'editor.wordHighlightBackground':           '#60020247',
        'editor.wordHighlightStrongBackground':     '#ffffff18',
        'editor.wordHighlightBorder':               '#f67e2220',
        'editor.wordHighlightStrongBorder':         '#c4854f50',
        'editorLineNumber.activeForeground':        '#90c0a0',
        'editorLineNumber.foreground':              '#90be065c',
        'editorWidget.border':                      '#000000',
        'editorBracketPairGuide.activeBackground1': '#00e7495e',
        'editorBracketPairGuide.activeBackground2': '#fac9285e',
        'editorBracketPairGuide.activeBackground3': '#057aff5e',
        'editorBracketPairGuide.activeBackground4': '#c122e95e',
        'editorBracketPairGuide.activeBackground5': '#f513845e',
        'editorBracketPairGuide.activeBackground6': '#19f9d85e',
      },
    });
  }, [isDark]);

  const status = node.lastStatus;
  const glyph = status === 'running' ? '◗' : status === 'ok' ? '✓' : status === 'error' ? '✗' : '';

  return (
    <>
      <NodeLabelBadge label={node.nodeLabel} createdBy={(node as { createdBy?: string }).createdBy} />
      <div
        className={`skena-node skena-node--code${node.lastStatus === 'running' ? ' skena-node--running' : ''}`}
        onContextMenu={onContextMenu}
        style={{
          border:        `${bw}px solid ${borderColor}`,
          height:        '100%',
          display:       'flex',
          flexDirection: 'column',
          borderRadius:  6,
          overflow:      'hidden',
          background:    'var(--vscode-editorWidget-background)',
          // - shared line height for the shiki preview (matches the Monaco editor exactly)
          ['--skena-code-lh' as string]: `${editorFont.lineHeight}px`,
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
          {isRunning && (
            <button
              onClick={e => { e.stopPropagation(); interrupt(false); }}
              title="Interrupt execution (Ctrl+C)"
              style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: '#e5484d', fontSize: 12, padding: 0, lineHeight: 1 }}
            >■</button>
          )}
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
              loading={null}   // - Monaco is bundled (loader.config in index.tsx); skip the "Loading…" flash
              defaultLanguage="python"
              language="python"
              theme="skena-code"
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
                lineNumbers:          'relative',
                lineNumbersMinChars:  3,
                fontFamily:           editorFont.family,
                fontSize:             editorFont.size,
                fontLigatures:        true,   // - Monaco defaults OFF; enable so ligature/Nerd-Font glyphs match the preview
                lineHeight:           editorFont.lineHeight,   // - explicit px so it matches the shiki preview exactly
                autoIndent:           'full',  // - keep indentation + indent after `:` on Enter
                tabSize:              4,
                insertSpaces:         true,
                scrollBeyondLastLine: false,
                folding:              false,
                glyphMargin:          false,
                overviewRulerLanes:   0,
                renderLineHighlight:  'all',  // - show the theme's line-highlight bg/border
                scrollbar:            { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
                automaticLayout:      true,
                padding:              { top: 0, bottom: 0 },   // - align top edge with the preview
                lineDecorationsWidth: 6,
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
          <ScrollableContent scrollKey={`${id}-code`} className="skena-code-cell-preview" style={{ padding: 0, cursor: 'text' }}>
            <div onDoubleClick={() => setEditing(true)} title="Double-click to edit">
              {code.trim()
                ? <CodeRenderer content={code} language={node.language ?? 'python'} />
                : <div style={{ padding: 8, opacity: 0.5, fontSize: 12, fontStyle: 'italic' }}>empty — double-click to edit</div>}
            </div>
          </ScrollableContent>
        )}
      </div>
      {menu && createPortal(
        <div
          ref={menuRef}
          className="nodrag"
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000,
            background: 'var(--vscode-menu-background, #252526)',
            color: 'var(--vscode-menu-foreground, #ccc)',
            border: '1px solid var(--vscode-menu-border, rgba(255,255,255,0.15))',
            borderRadius: 6, padding: '4px 0', minWidth: 160, fontSize: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <button
            disabled={!isRunning}
            onClick={() => { interrupt(false); closeMenu(); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '4px 12px',
              background: 'transparent', border: 'none', fontSize: 12,
              cursor: isRunning ? 'pointer' : 'default',
              color: isRunning ? 'inherit' : 'var(--vscode-disabledForeground, #777)',
            }}
            onMouseEnter={e => { if (isRunning) (e.currentTarget as HTMLElement).style.background = 'var(--vscode-menu-selectionBackground, #094771)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >Interrupt execution</button>
        </div>,
        document.body,
      )}
      <Handle type="source" position={Position.Top}    id="top"    style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right}  id="right"  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left}   id="left"   style={HANDLE_STYLE} />
    </>
  );
}

export const CodeNodeComponent = memo(CodeNodeInner);
